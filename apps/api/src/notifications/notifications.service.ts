import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@antigravity/database';
import { PUB_SUB } from '../redis/redis.module';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  toPaginatedResult,
} from '../common/pagination';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub,
  ) {}

  /**
   * Tạo thông báo mới và gửi FCM Push Notification (nếu có)
   * Create a new notification and send FCM Push Notification (if applicable)
   */
  async createNotification(data: {
    type: NotificationType;
    recipientId: string;
    actorId: string;
    pinId?: string;
    commentId?: string;
  }) {
    // 1. Nếu recipientId == actorId (người dùng tự tương tác với chính mình), bỏ qua không tạo thông báo.
    // If recipient is the actor themselves, skip notification.
    if (data.recipientId === data.actorId) {
      return null;
    }

    // 2. Lưu Notification vào cơ sở dữ liệu bằng Prisma.
    // Save Notification to database using Prisma.
    const notification = await this.prisma.notification.create({
      data: {
        type: data.type,
        recipientId: data.recipientId,
        actorId: data.actorId,
        pinId: data.pinId,
        commentId: data.commentId,
      },
      include: {
        actor: true,
        pin: true,
        comment: true,
      },
    });

    // 3. Publish event 'notificationReceived' qua Redis PubSub cho GraphQL Subscriptions.
    //
    // ⚠️ `.catch()` KHÔNG phải trang trí — thiếu nó là **cả tiến trình chết**.
    // Đây là fire-and-forget (cố ý: thông báo realtime hụt không được phép làm
    // hỏng hành động đã ghi vào DB ở trên — khác `messages.service.ts:182` cố ý
    // `await` vì mất tin nhắn realtime là mất dữ liệu người dùng thấy được).
    // Nhưng một Promise bị reject mà không ai bắt là `unhandledRejection`, và
    // Node ≥15 mặc định **kết thúc tiến trình**.
    //
    // Rủi ro này vốn đã tiềm ẩn (Redis chết ⇒ `PUBLISH` reject sau
    // `maxRetriesPerRequest`), nhưng `commandTimeout: 500ms` thêm vào
    // `redis.module.ts` (10/08/2026) làm nó từ HIẾM thành DỄ XẢY RA: giờ chỉ
    // cần Redis chậm quá nửa giây. Thêm timeout mà không thêm lưới này chính là
    // đổi một sự cố chậm lấy một sự cố sập.
    this.pubSub
      .publish('notificationReceived', { notificationReceived: notification })
      .catch((e: Error) =>
        this.logger.warn(`[pubsub] publish notificationReceived thất bại, BỎ QUA: ${e.message}`),
      );

    // 4. Gửi Push Notification qua FCM (mô phỏng).
    // Simulate sending FCM push notification.
    await this.sendPushNotification(data.recipientId, notification);

    // 5. Trả về thông báo đã tạo.
    // Return the created notification.
    return notification;
  }

  /**
   * Lấy danh sách thông báo của người dùng với phân trang (cursor-based pagination).
   * Get user's notifications with cursor pagination.
   */
  async getNotifications(userId: string, first: number, after?: string) {
    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║  ĐỔI SANG CURSOR BASE64 (P0 #6)                                       ║
    // ║                                                                        ║
    // ║  Bản cũ có `skip: 1` (đúng) nhưng vẫn sai 2 điểm:                     ║
    // ║   • `cursor: { id }` + `orderBy: createdAt` — không có tie-breaker,   ║
    // ║     hai notification trùng mili-giây thì thứ tự không xác định.        ║
    // ║   • `endCursor` trả ID TRẦN, trong khi Pins/Boards/Social/Messages     ║
    // ║     đều trả Base64. Client dùng chung một hàm decode sẽ vỡ ở đúng      ║
    // ║     module này — kiểu bug chỉ lộ ra khi ghép Web/Android vào.          ║
    // ║                                                                        ║
    // ║  Nay dùng chung helper keyset với phần còn lại của app ⇒ một contract  ║
    // ║  duy nhất: `endCursor` LUÔN là Base64 của (createdAt, id).            ║
    // ╚═══════════════════════════════════════════════════════════════════════╝
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        ...buildCursorFilter(after, 'desc'),
      },
      take: first + 1,
      orderBy: buildCursorOrderBy('desc'),
      include: { actor: true, pin: true, comment: true },
    });

    return toPaginatedResult(notifications, first);
  }

  /**
   * Đánh dấu thông báo đã đọc.
   * Mark a notification as read.
   */
  async markAsRead(id: string, userId: string) {
    // 1. Cập nhật record Notification với id và recipientId tương ứng thành isRead = true.
    // Update Notification where id=id and recipientId=userId to isRead: true.
    const updated = await this.prisma.notification.updateMany({
      where: { id, recipientId: userId },
      data: { isRead: true },
    });

    // 2. Trả về true nếu số lượng update > 0, ngược lại trả về false.
    // Return true if count > 0.
    return updated.count > 0;
  }

  /**
   * Đánh dấu tất cả thông báo của người dùng là đã đọc.
   * Mark all notifications of a user as read.
   */
  async markAllAsRead(userId: string) {
    // 1. Cập nhật tất cả Notification của recipientId = userId và isRead = false thành isRead = true.
    // Update all notifications for userId where isRead=false to isRead=true.
    const updated = await this.prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });

    // 2. Trả về true.
    // Return true.
    return true;
  }

  /**
   * Đếm số lượng thông báo chưa đọc.
   * Get unread notification count.
   */
  async getUnreadCount(userId: string) {
    // 1. Đếm số Notification của recipientId = userId và isRead = false.
    // Count notifications for userId where isRead=false.
    return this.prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });
  }

  /**
   * Gửi FCM Push Notification (Mô phỏng).
   * Simulate sending FCM Push Notification.
   *
   * HƯỚNG DẪN TÍCH HỢP FIREBASE (Android App):
   * Để chạy Push Notification thật tới Android, người phụ trách phần này làm theo các bước sau:
   * 1. Cài đặt SDK: `pnpm add firebase-admin --filter api`
   * 2. Vào Firebase Console -> Project Settings -> Service Accounts -> Generate new private key.
   * 3. Tải file JSON về, đặt tên là `firebase-service-account.json` ở thư mục gốc của project (đừng commit file này).
   * 4. Trong `AppModule` hoặc `NotificationsModule`, khởi tạo Firebase:
   *    ```typescript
   *    import * as admin from 'firebase-admin';
   *    admin.initializeApp({
   *      credential: admin.credential.cert(require('../../firebase-service-account.json')),
   *    });
   *    ```
   * 5. Thay thế vòng lặp console.log bên dưới bằng lệnh gửi thật:
   *    ```typescript
   *    const fcmTokens = tokens.map(t => t.token);
   *    const message = {
   *      notification: { title, body },
   *      data: { type: notification.type, pinId: notification.pinId || '' },
   *      tokens: fcmTokens
   *    };
   *    await admin.messaging().sendEachForMulticast(message);
   *    ```
   *    (Nhớ filter ra những token bị lỗi `messaging/registration-token-not-registered` để xóa khỏi DB).
   */
  private async sendPushNotification(userId: string, notification: any) {
    // 1. Lấy tất cả DeviceTokens của userId từ database.
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
    });

    if (!tokens.length) {
      return;
    }

    // 2. Tạo tiêu đề và nội dung thông báo dựa vào notification.type.
    let title = 'Thông báo mới';
    let body = 'Bạn có thông báo mới';

    switch (notification.type) {
      case NotificationType.FOLLOW:
        body = `${notification.actor?.username || 'Ai đó'} đã bắt đầu theo dõi bạn.`;
        break;
      case NotificationType.COMMENT:
        body = `${notification.actor?.username || 'Ai đó'} đã bình luận về ghim của bạn.`;
        break;
      case NotificationType.REPLY:
        body = `${notification.actor?.username || 'Ai đó'} đã trả lời bình luận của bạn.`;
        break;
      case NotificationType.SAVE:
        body = `${notification.actor?.username || 'Ai đó'} đã lưu ghim của bạn.`;
        break;
      case NotificationType.MENTION:
        body = `${notification.actor?.username || 'Ai đó'} đã nhắc đến bạn trong một bình luận.`;
        break;
      case NotificationType.REACTION:
        body = `${notification.actor?.username || 'Ai đó'} đã thả cảm xúc về ghim của bạn.`;
        break;
    }

    // [TODO: Firebase] Thay thế phần mock này bằng admin.messaging().sendEachForMulticast()
    for (const device of tokens) {
      this.logger.log(`[FCM MOCK] Gửi thông báo tới token "${device.token}" (Platform: ${device.platform}): [${title}] ${body}`);
    }
  }

  /**
   * Đăng ký Device Token mới
   * Register a new Device Token
   */
  async registerDeviceToken(userId: string, token: string, platform: string = 'android') {
    // 1. Upsert DeviceToken bằng Prisma: Nếu token đã tồn tại, update userId/platform. Nếu chưa, tạo mới.
    // Upsert DeviceToken: create if not exists, update if exists.
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  /**
   * Xóa Device Token
   * Remove a Device Token
   */
  async removeDeviceToken(token: string) {
    // 1. Xóa DeviceToken có token tương ứng.
    // Delete DeviceToken by token.
    try {
      await this.prisma.deviceToken.delete({ where: { token } });
    } catch (e) {
      // Ignored if not found
    }
  }
}
