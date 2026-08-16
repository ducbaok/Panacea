import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SocialService } from './social.service';
import { GqlAuthGuard, GqlOptionalAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { FollowListArgs } from './dto/follow-list.args';
import { CursorPaginationArgs } from '../common/pagination';
import { User, PaginatedUsers } from '../users/entities/user.entity';

@Resolver()
export class SocialResolver {
  constructor(private readonly socialService: SocialService) {}

  /**
   * Mutation: Follow user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Dùng @UseGuards(GqlAuthGuard) để yêu cầu đăng nhập.
   * 2. Nhận followingId từ Args, followerId từ CurrentUser.
   * 3. Gọi socialService.follow(). Trả về Boolean.
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async follow(
    @Args('userId') followingId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.socialService.follow(user.userId, followingId);
  }

  /**
   * Mutation: Unfollow user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Yêu cầu đăng nhập.
   * 2. Gọi socialService.unfollow(user.userId, followingId). Trả về Boolean.
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async unfollow(
    @Args('userId') followingId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.socialService.unfollow(user.userId, followingId);
  }

  /**
   * Mutation: Block user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Yêu cầu đăng nhập.
   * 2. Gọi socialService.blockUser(user.userId, blockedId). Trả về Boolean.
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async blockUser(
    @Args('userId') blockedId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.socialService.blockUser(user.userId, blockedId);
  }

  /**
   * Mutation: Unblock user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Yêu cầu đăng nhập.
   * 2. Gọi socialService.unblockUser(user.userId, blockedId). Trả về Boolean.
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async unblockUser(
    @Args('userId') blockedId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.socialService.unblockUser(user.userId, blockedId);
  }

  /**
   * Query: followers
   * Lấy danh sách người đang follow userId
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Query @Query(() => PaginatedUsers).
   * 2. Nhận userId và CursorPaginationArgs.
   * 3. Lấy CurrentUser (không bắt buộc, nếu có thì dùng để filter blocked).
   * 4. Gọi socialService.getFollowers().
   */
  // GqlOptionalAuthGuard là BẮT BUỘC: không có guard thì passport không chạy,
  // `request.user` không bao giờ được gắn → @CurrentUser() luôn null → bộ lọc
  // block bên dưới thành code chết. Query vẫn public, chỉ là "biết viewer nếu có".
  @Query(() => PaginatedUsers)
  @UseGuards(GqlOptionalAuthGuard)
  async followers(
    // Gộp userId + first/after vào MỘT ArgsType. Trộn @Args('userId') với
    // @Args() CursorPaginationArgs làm query luôn trả 400 — xem
    // common/pagination/cursor-pagination.ts.
    @Args() { userId, ...paginationArgs }: FollowListArgs,
    @CurrentUser() user: AuthUser | null,
  ) {
    return this.socialService.getFollowers(userId, paginationArgs, user?.userId);
  }

  /**
   * Query: following
   * Lấy danh sách người userId đang follow
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Tương tự followers nhưng gọi getFollowing.
   */
  @Query(() => PaginatedUsers)
  @UseGuards(GqlOptionalAuthGuard)
  async following(
    @Args() { userId, ...paginationArgs }: FollowListArgs,
    @CurrentUser() user: AuthUser | null,
  ) {
    return this.socialService.getFollowing(userId, paginationArgs, user?.userId);
  }

  /**
   * Query: blockedUsers — danh sách người TÔI đã chặn (C2b "Người đã chặn").
   *
   * MỘT CHIỀU (blockerId = viewer). Bắt buộc đăng nhập: đây là danh sách quản lý
   * của chính viewer, không phải dữ liệu công khai ⇒ GqlAuthGuard, KHÔNG phải
   * Optional. Chỉ có first/after nên `@Args()` không tên vẫn an toàn (cùng kiểu
   * exploreFeed/notifications/conversations — xem cursor-pagination.ts).
   */
  @Query(() => PaginatedUsers)
  @UseGuards(GqlAuthGuard)
  async blockedUsers(
    @Args() args: CursorPaginationArgs,
    @CurrentUser() user: AuthUser,
  ) {
    return this.socialService.getBlockedUsers(user.userId, args);
  }

  /**
   * Query: suggestedUsers — "gợi ý người theo dõi" cho khối banner B1 (B-12).
   *
   * Bắt buộc đăng nhập: gợi ý phải biết viewer để loại người đã follow / bị chặn
   * / chính mình. `first` là một @Args('...') ĐƠN LẺ nên KHÔNG dính bẫy trộn
   * @Args() không tên. Không phân trang (khối B1 chỉ hiện vài người) ⇒ trả list
   * phẳng; QĐ-9 (co lại/ẩn khi < 3) do frontend xử lý.
   */
  @Query(() => [User])
  @UseGuards(GqlAuthGuard)
  async suggestedUsers(
    @Args('first', { type: () => Int, nullable: true, defaultValue: 10 }) first: number,
    @CurrentUser() user: AuthUser,
  ) {
    const limit = Math.min(Math.max(first ?? 10, 1), 50);
    return this.socialService.getSuggestedUsers(user.userId, limit);
  }
}
