import { Resolver, Query, Mutation, Args, Subscription, ObjectType } from '@nestjs/graphql';
import { UseGuards, Inject } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { MessagesService } from './messages.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { SendMessageInput } from './dto/send-message.input';
import { CursorPaginationArgs, createPaginatedType } from '../common/pagination/cursor-pagination';
import { MessagesArgs } from './dto/messages.args';
import { PUB_SUB } from '../redis/redis.module';
import { RedisPubSub } from 'graphql-redis-subscriptions';

@ObjectType()
export class PaginatedConversations extends createPaginatedType(Conversation) {}

@ObjectType()
export class PaginatedMessages extends createPaginatedType(Message) {}

@Resolver()
export class MessagesResolver {
  constructor(
    private readonly messagesService: MessagesService,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub,
  ) {}

  /**
   * Tạo hội thoại mới giữa current user và một user khác
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Conversation)
  async createConversation(
    @CurrentUser() user: AuthUser,
    @Args('userId') userId: string,
  ) {
    return this.messagesService.createConversation(user.userId, userId);
  }

  /**
   * Lấy danh sách các cuộc hội thoại
   */
  @UseGuards(GqlAuthGuard)
  @Query(() => PaginatedConversations)
  async conversations(
    @CurrentUser() user: AuthUser,
    @Args() args: CursorPaginationArgs,
  ) {
    return this.messagesService.getConversations(user.userId, args);
  }

  /**
   * Lấy danh sách tin nhắn trong một cuộc hội thoại
   */
  @UseGuards(GqlAuthGuard)
  @Query(() => PaginatedMessages)
  async messages(
    @CurrentUser() user: AuthUser,
    // Gộp conversationId + first/after vào MỘT ArgsType. Trộn @Args('x') với
    // @Args() CursorPaginationArgs làm query luôn trả 400 — xem
    // common/pagination/cursor-pagination.ts.
    @Args() { conversationId, ...args }: MessagesArgs,
  ) {
    return this.messagesService.getMessages(user.userId, conversationId, args);
  }

  /**
   * Gửi tin nhắn
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Message)
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Args('input') input: SendMessageInput,
  ) {
    return this.messagesService.sendMessage(
      user.userId,
      input.conversationId,
      input.content,
      input.attachedPinId,
    );
  }

  /**
   * Đánh dấu tin nhắn đã đọc
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async markMessageRead(
    @CurrentUser() user: AuthUser,
    @Args('messageId') messageId: string,
  ) {
    return this.messagesService.markAsRead(user.userId, messageId);
  }

  /**
   * Xóa tin nhắn
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async deleteMessage(
    @CurrentUser() user: AuthUser,
    @Args('messageId') messageId: string,
  ) {
    return this.messagesService.deleteMessage(user.userId, messageId);
  }

  /**
   * Lắng nghe tin nhắn mới trong một hội thoại.
   *
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  LỖ RÒ RỈ DM (P0 #3) — đã bịt bằng HAI lớp                            ║
   * ║                                                                        ║
   * ║  Bản cũ chỉ so `payload.conversationId === variables.conversationId`. ║
   * ║  `variables.conversationId` là do CLIENT tự khai. Nghĩa là bất kỳ user ║
   * ║  đăng nhập nào biết (hoặc đoán ra) một conversationId đều subscribe    ║
   * ║  được và đọc toàn bộ tin nhắn realtime của hội thoại đó.               ║
   * ║                                                                        ║
   * ║  Lớp 1 — lúc SUBSCRIBE: kiểm tra membership trong DB, không phải       ║
   * ║          thành viên thì ném 403, subscription không mở ra được.        ║
   * ║  Lớp 2 — lúc FILTER mỗi event: đối chiếu viewer với `memberIds` đính   ║
   * ║          kèm payload. Đây là defense-in-depth: nếu sau này ai đó thêm  ║
   * ║          một đường publish mới mà quên check, lớp này vẫn chặn.        ║
   * ║          Cố ý fail-closed — thiếu `memberIds` ⇒ không gửi.             ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  @UseGuards(GqlAuthGuard)
  @Subscription(() => Message, {
    filter: (
      payload: { messageReceived: Message; memberIds?: string[] },
      variables: { conversationId: string },
      context: { req?: { user?: AuthUser } },
    ) => {
      const viewer = context?.req?.user;
      if (!viewer) return false;

      if (payload.messageReceived.conversationId !== variables.conversationId) return false;

      return Array.isArray(payload.memberIds) && payload.memberIds.includes(viewer.userId);
    },
  })
  async messageReceived(
    @CurrentUser() user: AuthUser,
    @Args('conversationId') conversationId: string,
  ) {
    await this.messagesService.assertConversationMember(user.userId, conversationId);

    // XH-2 (21/08/2026) — lớp THỨ BA, riêng cho ảnh đính kèm: payload publish
    // dùng chung cho mọi subscriber, nhưng quyền xem pin đính kèm thì theo
    // TỪNG người nhận (người ngoài vòng nhận tin realtime phải thấy
    // attachedPin = null, y như đọc lại bằng getMessages). Bọc iterator theo
    // từng subscriber vì method này chạy một lần cho MỖI subscription — đúng
    // chỗ duy nhất biết viewer là ai. `shapeMessageForViewer` trả BẢN SAO khi
    // giấu, không đột biến payload chung.
    const source = this.pubSub.asyncIterableIterator('messageReceived');
    const shape = (payload: { messageReceived: Message; memberIds?: string[] }) =>
      this.messagesService
        .shapeMessageForViewer(payload.messageReceived as any, user.userId)
        .then((shaped) =>
          shaped === payload.messageReceived ? payload : { ...payload, messageReceived: shaped },
        );

    return (async function* () {
      try {
        for await (const payload of source as AsyncIterable<any>) {
          yield await shape(payload);
        }
      } finally {
        // Client ngắt subscription ⇒ generator bị .return() ⇒ đóng nguồn thật,
        // nếu không iterator Redis sống mồ côi tới hết process.
        await (source as any).return?.();
      }
    })();
  }
}
