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
    const memberIds = await this.getMemberIds(conversationId);
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

    return keysetPage(CREATED_DESC as any, messages as any, first);
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
