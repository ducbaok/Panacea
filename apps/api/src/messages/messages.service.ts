import { Injectable, BadRequestException, ForbiddenException, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialService } from '../social/social.service';
import { PUB_SUB } from '../redis/redis.module';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import {
  CursorPaginationArgs,
  encodeCursor,
  decodeCursor,
  CREATED_DESC,
  CONVERSATION_KEYSET,
  keysetWhere,
  keysetOrderBy,
  keysetPage,
} from '../common/pagination';
// XH-2 (21/08/2026) — ảnh đính kèm trong tin nhắn là bề mặt số 10 của
// PLAN_XAHOI.md §3, và TRƯỚC XH-2 nó là bề mặt DUY NHẤT đọc Pin mà không qua
// bất kỳ bộ lọc nào (Prisma `include` — không block, không visibility).
import { getPinAudienceCtx, isPinVisibleInCtx } from '../common/blocking';
import type { PinAudienceCtx } from '../common/blocking';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socialService: SocialService,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub,
  ) {}

  /**
   * Tạo hoặc lấy Conversation giữa 2 user.
   * HƯỚNG DẪN CODE LẠI:
   * 1. Kiểm tra mutual follow thông qua socialService.getMutualFollowStatus.
   * 2. Kiểm tra isBlocked thông qua socialService.isBlocked.
   * 3. Tìm Conversation tồn tại có đúng 2 user này. Nếu có trả về luôn.
   * 4. Nếu chưa có, tạo mới Conversation và thêm 2 ConversationMember.
   */
  async createConversation(userId1: string, userId2: string) {
    if (userId1 === userId2) {
      throw new BadRequestException('Cannot create conversation with yourself');
    }

    const isBlocked = await this.socialService.isBlocked(userId1, userId2);
    if (isBlocked) {
      throw new ForbiddenException('Cannot start conversation due to block status');
    }

    const mutualFollow = await this.socialService.getMutualFollowStatus(userId1, userId2);
    if (!mutualFollow) {
      throw new ForbiddenException('Mutual follow is required to send Direct Messages');
    }

    // Tìm conversation hiện tại giữa 2 người
    // Bằng cách đếm số lượng member trùng nhau trong cùng conversationId
    const existingConvos = await this.prisma.conversation.findMany({
      where: {
        members: {
          every: {
            userId: { in: [userId1, userId2] }
          }
        }
      },
      include: { members: true }
    });

    // Lọc lấy conversation có đúng 2 members là userId1 và userId2
    const conversation = existingConvos.find(c => c.members.length === 2 && 
      c.members.some(m => m.userId === userId1) && 
      c.members.some(m => m.userId === userId2)
    );

    if (conversation) return conversation;

    // Tạo mới
    return this.prisma.conversation.create({
      data: {
        members: {
          create: [
            { userId: userId1 },
            { userId: userId2 },
          ]
        }
      },
      include: { members: true }
    });
  }

  /**
   * Lấy danh sách Conversation của user (phân trang cursor).
   *
   * P1 Đợt 2 §3c — dùng `CONVERSATION_KEYSET` `(updatedAt desc, id desc)`.
   * SỬA HAI LỖI ĐANG CHỒNG LÊN NHAU trong bản trước:
   *   (1) `orderBy: { updatedAt: 'desc' }` nhưng `encodeCursor(...createdAt...)`
   *       — mã hoá NHẦM CỘT. Cursor decode trên trang sau sẽ lọc theo
   *       `createdAt`, không phải `updatedAt` ⇒ nhảy cóc/lặp trang.
   *   (2) THIẾU tie-breaker `id` — hai hội thoại trùng `updatedAt` (rất dễ
   *       xảy ra khi 2 tin nhắn cùng mili-giây) thì thứ tự không xác định.
   *
   * ⚠️ BREAKING CHANGE IM LẶNG: cursor cũ mã hoá `createdAt` sẽ được decode
   * thành `updatedAt` — cùng 2 phần nên KHÔNG lỗi, chỉ ra sai trang. Chấp
   * nhận được vì chưa có client, nhưng ghi vào commit message.
   *
   * `updatedAt` là khoá MUTABLE (tin nhắn mới đẩy hội thoại lên đầu inbox)
   * ⇒ có thể thấy trùng khi cuộn giữa 2 trang — ĐÚNG UX inbox, không phải bug.
   */
  async getConversations(userId: string, args: CursorPaginationArgs) {
    const { first, after } = args;
    const base = { members: { some: { userId } } };

    const convos = await this.prisma.conversation.findMany({
      where: keysetWhere(CONVERSATION_KEYSET, after, base) as any,
      take: first + 1,
      orderBy: keysetOrderBy(CONVERSATION_KEYSET),
      include: {
        members: { include: { user: true } },
      },
    });

    return keysetPage(CONVERSATION_KEYSET as any, convos as any, first);
  }

  /**
   * Xác nhận `userId` là thành viên của `conversationId`, ném 403 nếu không.
   *
   * Tách riêng vì có 3 nơi cần đúng phép kiểm tra này: sendMessage,
   * getMessages, và — mới thêm ở P0 #3 — subscription `messageReceived`.
   * Trước đây subscription KHÔNG kiểm tra gì cả nên bất kỳ user đăng nhập nào
   * biết `conversationId` cũng đọc lén được DM realtime của người khác.
   */
  async assertConversationMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this conversation');
  }

  /** Lấy toàn bộ userId của các thành viên trong 1 conversation. */
  private async getMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /**
   * Gửi tin nhắn.
   * HƯỚNG DẪN CODE LẠI:
   * 1. Kiểm tra sender có trong conversation không.
   * 2. Tạo Message (nội dung text hoặc đính kèm Pin).
   * 3. Cập nhật updatedAt của Conversation.
   * 4. Publish 'messageReceived' event qua PubSub — KÈM danh sách memberIds
   *    để subscription filter kiểm tra quyền mà không phải query DB lại.
   */
  async sendMessage(senderId: string, conversationId: string, content?: string, attachedPinId?: string) {
    if (!content && !attachedPinId) {
      throw new BadRequestException('Message must have content or an attached pin');
    }

    await this.assertConversationMember(senderId, conversationId);

    // 🔴 REVIEW-1 (18/08/2026) — chặn người dùng phải có hiệu lực ở ĐÂY, không
    // chỉ ở `createConversation`.
    //
    // Lỗ hổng cũ: block chỉ được kiểm lúc TẠO hội thoại. Hai người đã nhắn tin
    // với nhau từ trước rồi mới chặn nhau thì hội thoại cũ vẫn gửi/nhận/subscribe
    // bình thường — tức nút "Chặn" không làm được đúng việc người dùng nghĩ nó làm.
    //
    // Người dùng chốt hình dạng (18/08): CẤM GỬI MỚI, GIỮ LỊCH SỬ ĐỌC ĐƯỢC —
    // giống Messenger. Nên chỗ này ném lỗi, còn `getMessages`/`conversations`
    // KHÔNG lọc: hội thoại cũ vẫn nằm trong hộp thư và đọc lại được.
    //
    // `getMemberIds` dời lên TRƯỚC transaction để dùng lại cho cả phép kiểm này
    // lẫn publish bên dưới ⇒ 0 query phát sinh thêm.
    const memberIds = await this.getMemberIds(conversationId);
    const otherId = memberIds.find((id) => id !== senderId);
    if (otherId && (await this.socialService.isBlocked(senderId, otherId))) {
      throw new ForbiddenException('Cannot message this user (blocked)');
    }

    // XH-2 — người GỬI phải thấy được pin mình đính kèm; pin ngoài khán giả
    // (hoặc không tồn tại) trả 404 y như nhau. Trước đây attachedPinId không
    // được kiểm gì cả: id rác đi thẳng xuống FK và nổ P2003 thành 500.
    if (attachedPinId) {
      const pin = await this.prisma.pin.findFirst({ where: { id: attachedPinId } });
      const senderCtx = await getPinAudienceCtx(this.prisma, senderId);
      if (
        !pin ||
        pin.deletedAt ||
        (pin.creatorId !== senderId && !isPinVisibleInCtx(pin, senderCtx))
      ) {
        throw new NotFoundException('Pin not found');
      }
    }

    // Create message and update conversation updatedAt
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          senderId,
          content,
          attachedPinId,
        },
        include: { sender: true, attachedPin: true }
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() }
      })
    ]);

    // Publish to GraphQL subscriptions.
    //
    // `memberIds` đi kèm payload có chủ đích: subscription filter chạy lại cho
    // MỖI subscriber ở MỖI event. Nếu filter tự query DB thì 1 tin nhắn trong
    // phòng N người = N query. Đính sẵn vào payload là 1 query lúc publish.
    //
    // `await` chứ không fire-and-forget: publish lỗi (Redis rớt) mà nuốt im
    // thì client mất tin nhắn realtime mà server vẫn báo thành công.
    //
    // `memberIds` lấy ở đầu hàm (xem phép kiểm chặn) — cùng một giá trị.
    await this.pubSub.publish('messageReceived', { messageReceived: message, memberIds });

    return message;
  }

  /**
   * Lấy danh sách tin nhắn trong 1 Conversation.
   *
   * P1 Đợt 2 §3a — dùng `CREATED_DESC`. Cursor byte-identical với bản cũ
   * (orderBy đã là `[createdAt desc, id desc]` từ trước).
   */
  async getMessages(userId: string, conversationId: string, args: CursorPaginationArgs) {
    await this.assertConversationMember(userId, conversationId);

    const { first, after } = args;
    const base = { conversationId, deletedAt: null };

    const messages = await this.prisma.message.findMany({
      where: keysetWhere(CREATED_DESC, after, base) as any,
      take: first + 1,
      orderBy: keysetOrderBy(CREATED_DESC),
      include: { sender: true, attachedPin: true },
    });

    // XH-2 — ĐỊNH HÌNH chứ không lọc dòng: tin nhắn vẫn hiện (lịch sử đọc được
    // là quyết định REVIEW-1), chỉ ảnh đính kèm ngoài khán giả bị thay bằng
    // null — với người xem thì hệt tin nhắn không đính kèm gì. Không đụng số
    // dòng nên keyset an toàn (khác hẳn lọc-sau-fetch ở bề mặt danh sách pin).
    const viewerCtx = await getPinAudienceCtx(this.prisma, userId);
    for (const m of messages as any[]) {
      this._hideInvisibleAttachedPin(m, viewerCtx);
    }

    return keysetPage(CREATED_DESC as any, messages as any, first);
  }

  /**
   * XH-2 — thay attachedPin ngoài khán giả của `viewerCtx` bằng null (đột biến
   * tại chỗ, chỉ dùng cho object vừa fetch riêng cho viewer này). attachedPinId
   * cũng xoá: giữ id lại là giữ một tín hiệu "có tồn tại một pin bị giấu".
   * Chính chủ pin luôn thấy (vế creatorId trong predicate — kể cả ONLY_ME),
   * pin hết hạn thì ẩn với mọi người trong DM, kể cả chủ (kho là chỗ xem lại).
   */
  private _hideInvisibleAttachedPin(
    message: { attachedPin?: any; attachedPinId?: string | null },
    viewerCtx: PinAudienceCtx,
  ): void {
    const pin = message.attachedPin;
    if (!pin) return;
    if (pin.deletedAt || !isPinVisibleInCtx(pin, viewerCtx)) {
      message.attachedPin = null;
      message.attachedPinId = null;
    }
  }

  /**
   * XH-2 — bản định hình theo NGƯỜI NHẬN cho đường subscription realtime.
   * Payload publish dùng CHUNG cho mọi subscriber, nên ở đây trả về BẢN SAO khi
   * phải giấu (đột biến payload chung là giấu nhầm cho cả người trong khán giả).
   * Ctx lấy TƯƠI mỗi event — rời vòng phải có hiệu lực ngay, đúng XH-QĐ-3.
   */
  async shapeMessageForViewer<T extends { attachedPin?: any; attachedPinId?: string | null }>(
    message: T,
    viewerId: string,
  ): Promise<T> {
    const pin = message.attachedPin;
    if (!pin || pin.visibility === 'PUBLIC') return message;
    if (pin.creatorId === viewerId && pin.expiresAt == null) return message;

    const ctx = await getPinAudienceCtx(this.prisma, viewerId);
    if (!pin.deletedAt && isPinVisibleInCtx(pin, ctx)) return message;
    return { ...message, attachedPin: null, attachedPinId: null };
  }

  /**
   * Đánh dấu tin nhắn đã đọc.
   */
  async markAsRead(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId },
      include: { conversation: { include: { members: true } } }
    });

    if (!message) throw new NotFoundException('Message not found');

    const isMember = message.conversation.members.some(m => m.userId === userId);
    if (!isMember) throw new ForbiddenException('Not authorized');

    if (message.senderId === userId) return true; // Can't read own message

    await this.prisma.message.update({
      where: { id: messageId },
      data: { readAt: new Date() }
    });

    return true;
  }

  /**
   * Xóa tin nhắn (Soft Delete).
   */
  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) throw new ForbiddenException('Can only delete your own messages');

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() }
    });

    return true;
  }
}
