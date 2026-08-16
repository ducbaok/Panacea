import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { GqlAuthGuard, GqlOptionalAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { DataloaderService } from '../common/dataloader/dataloader.service';
import { UpdateProfileInput } from './dto/update-profile.input';

/**
 * UsersResolver — xử lý GraphQL queries cho User.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. @Resolver(() => User).
 * 2. Inject UsersService.
 * 3. Query 'me': guarded bởi GqlAuthGuard, trả về user hiện tại.
 * 4. Query 'userByUsername': guarded bởi GqlOptionalAuthGuard (public nhưng biết viewer).
 *    - Nếu viewer không phải owner → ẩn email (set null).
 *    - Trả null nếu không tìm thấy user.
 * 5. Mutation 'updateProfile': guarded bởi GqlAuthGuard.
 *    - Nhận input UpdateProfileInput và user hiện tại từ @CurrentUser().
 *    - Gọi usersService.updateProfile(user.userId, input).
 */
@Resolver(() => User)
export class UsersResolver {
  constructor(
    private readonly usersService: UsersService,
    private readonly dataloaderService: DataloaderService,
  ) {}

  /**
   * Lấy thông tin user hiện tại (đã đăng nhập).
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. @UseGuards(GqlAuthGuard) — yêu cầu JWT hợp lệ.
   * 2. Dùng @CurrentUser() để lấy AuthUser.
   * 3. Gọi usersService.findById(user.userId).
   */
  @Query(() => User)
  @UseGuards(GqlAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return this.usersService.findById(user.userId);
  }

  /**
   * Lấy thông tin user theo username (public query).
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. @UseGuards(GqlOptionalAuthGuard) — không yêu cầu login, nhưng nếu có token → biết viewer.
   * 2. Gọi usersService.findByUsername(username).
   * 3. Nếu không tìm thấy → return null.
   * 4. **Email privacy**: Nếu viewer không phải owner (viewer?.userId !== targetUser.id),
   *    set targetUser.email = null (KHÔNG dùng '' vì GraphQL nullable type cần null).
   * 5. Return targetUser.
   */
  @Query(() => User, { nullable: true })
  @UseGuards(GqlOptionalAuthGuard)
  async userByUsername(
    @Args('username') username: string,
    @CurrentUser() viewer: AuthUser | null
  ) {
    const targetUser = await this.usersService.findByUsername(username);
    if (!targetUser) return null;

    // Email privacy: chỉ trả email nếu viewer là chính user đó
    // Cast as any vì Prisma type khai báo email: string (non-nullable),
    // nhưng GraphQL entity cho phép nullable → trả null cho privacy
    if (!viewer || viewer.userId !== targetUser.id) {
      (targetUser as any).email = null;
    }
    return targetUser;
  }

  /**
   * Cập nhật thông tin profile của user hiện tại.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. @Mutation(() => User).
   * 2. @UseGuards(GqlAuthGuard).
   * 3. updateProfile(@Args('input') input: UpdateProfileInput, @CurrentUser() user: AuthUser).
   * 4. Gọi usersService.updateProfile(user.userId, input).
   */
  @Mutation(() => User)
  @UseGuards(GqlAuthGuard)
  async updateProfile(
    @Args('input') input: UpdateProfileInput,
    @CurrentUser() user: AuthUser
  ) {
    return this.usersService.updateProfile(user.userId, input);
  }

  /**
   * Xóa tài khoản (soft delete). User có 30 ngày để khôi phục.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. @Mutation(() => Boolean).
   * 2. @UseGuards(GqlAuthGuard) — chỉ user đã đăng nhập.
   * 3. Gọi usersService.deleteAccount(user.userId).
   */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deleteAccount(@CurrentUser() user: AuthUser): Promise<boolean> {
    return this.usersService.deleteAccount(user.userId);
  }

  // ─── ResolveFields (Phase 2.1) ─────────────────────────────────────────────

  /**
   * Resolve followerCount bằng Dataloader để tránh N+1.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. @ResolveField(() => Number) followerCount(@Parent() user: User)
   * 2. Trả về dataloaderService.followerCountLoader.load(user.id)
   */
  @ResolveField(() => Number)
  async followerCount(@Parent() user: User) {
    return this.dataloaderService.followerCountLoader.load(user.id);
  }

  /**
   * Resolve followingCount bằng Dataloader.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Gọi followingCountLoader.load(user.id)
   */
  @ResolveField(() => Number)
  async followingCount(@Parent() user: User) {
    return this.dataloaderService.followingCountLoader.load(user.id);
  }

  /**
   * Resolve isFollowedByViewer.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Lấy viewer từ @CurrentUser(). Nếu không có, return false.
   * 2. Gọi buildIsFollowedByLoader(viewer.userId).load(user.id).
   *
   * LƯU Ý: `user` ở đây là entity User của GraphQL (@Parent), nên `user.id`
   * là ĐÚNG. Còn `viewer` là danh tính từ token nên phải dùng `viewer.userId`.
   * Hai khái niệm khác nhau, đừng nhầm — đây là chỗ dễ sai nhất trong file.
   */
  @ResolveField(() => Boolean)
  async isFollowedByViewer(
    @Parent() user: User,
    @CurrentUser() viewer: AuthUser | null,
  ) {
    if (!viewer) return false;
    return this.dataloaderService.buildIsFollowedByLoader(viewer.userId).load(user.id);
  }

  /**
   * Resolve isFollowingViewer.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Lấy viewer từ @CurrentUser(). Nếu không có, return false.
   * 2. Gọi buildIsFollowingLoader(viewer.userId).load(user.id).
   */
  @ResolveField(() => Boolean)
  async isFollowingViewer(
    @Parent() user: User,
    @CurrentUser() viewer: AuthUser | null,
  ) {
    if (!viewer) return false;
    return this.dataloaderService.buildIsFollowingLoader(viewer.userId).load(user.id);
  }

  /**
   * Resolve isBlockedByViewer — "viewer có đang chặn user này không" (một chiều).
   *
   * Cùng khuôn isFollowedByViewer: không viewer ⇒ false (khách chưa chặn ai).
   * Đường vào C1b là `userByUsername` (GqlOptionalAuthGuard) nên @CurrentUser có
   * viewer khi client gửi token — không cần guard riêng ở field, đúng như hai
   * field follow ngay trên (đã chạy thật qua verify).
   */
  @ResolveField(() => Boolean)
  async isBlockedByViewer(
    @Parent() user: User,
    @CurrentUser() viewer: AuthUser | null,
  ) {
    if (!viewer) return false;
    return this.dataloaderService.buildIsBlockedByViewerLoader(viewer.userId).load(user.id);
  }
}

