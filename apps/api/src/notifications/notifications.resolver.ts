import { Resolver, Query, Mutation, Args, Subscription, ObjectType } from '@nestjs/graphql';
import { UseGuards, Inject } from '@nestjs/common';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { CursorPaginationArgs, createPaginatedType } from '../common/pagination/cursor-pagination';
import { PUB_SUB } from '../redis/redis.module';
import { RedisPubSub } from 'graphql-redis-subscriptions';

@ObjectType()
export class PaginatedNotifications extends createPaginatedType(Notification) {}

@Resolver(() => Notification)
export class NotificationsResolver {
  constructor(
    private readonly notificationsService: NotificationsService,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub,
  ) {}

  /**
   * Lấy danh sách thông báo của người dùng hiện tại (có phân trang)
   * Get paginated notifications for current user
   */
  @UseGuards(GqlAuthGuard)
  @Query(() => PaginatedNotifications)
  async notifications(
    @CurrentUser() user: AuthUser,
    @Args() args: CursorPaginationArgs,
  ) {
    // 1. Gọi service getNotifications với userId, args.first, args.after.
    // Call service to get notifications.
    return this.notificationsService.getNotifications(user.userId, args.first, args.after);
  }

  /**
   * Đếm số lượng thông báo chưa đọc
   * Get unread notification count
   */
  @UseGuards(GqlAuthGuard)
  @Query(() => Number)
  async unreadNotificationCount(@CurrentUser() user: AuthUser) {
    // 1. Gọi service getUnreadCount
    // Call service to get unread count.
    return this.notificationsService.getUnreadCount(user.userId);
  }

  /**
   * Đánh dấu 1 thông báo là đã đọc
   * Mark a notification as read
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async markNotificationRead(
    @CurrentUser() user: AuthUser,
    @Args('id') id: string,
  ) {
    // 1. Gọi service markAsRead
    // Call service to mark notification as read.
    return this.notificationsService.markAsRead(id, user.userId);
  }

  /**
   * Đánh dấu tất cả thông báo là đã đọc
   * Mark all notifications as read
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async markAllNotificationsRead(@CurrentUser() user: AuthUser) {
    // 1. Gọi service markAllAsRead
    // Call service to mark all notifications as read.
    return this.notificationsService.markAllAsRead(user.userId);
  }

  /**
   * Subscription nhận thông báo mới realtime qua WebSockets/RedisPubSub.
   * Subscribe to new notifications realtime.
   */
  @UseGuards(GqlAuthGuard)
  @Subscription(() => Notification, {
    filter: (payload, variables, context) => {
      // 1. Kiểm tra payload.notificationReceived.recipientId === user đang kết nối.
      // Check if the notification recipient is the connected user.
      //
      // LƯU Ý: `request.user` do JwtStrategy.validate() gắn vào có shape
      // `AuthUser = { userId, email }`. Trước đây chỗ này đọc `.id` → luôn
      // undefined → so sánh luôn false → subscription KHÔNG BAO GIỜ bắn ra
      // event nào, dù RedisPubSub hoạt động hoàn toàn bình thường.
      const viewer: AuthUser | undefined = context?.req?.user;
      if (!viewer) return false;
      return payload.notificationReceived.recipientId === viewer.userId;
    },
  })
  notificationReceived() {
    // 1. Lắng nghe event 'notificationReceived' từ pubSub.
    // Listen to 'notificationReceived' event.
    return this.pubSub.asyncIterableIterator('notificationReceived');
  }
}
