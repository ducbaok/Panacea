import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CirclesService } from './circles.service';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { Circle } from './entities/circle.entity';
import { User } from '../users/entities/user.entity';
import { CreateCircleInput } from './dto/create-circle.input';
import { UpdateCircleInput } from './dto/update-circle.input';
import { DuplicateCircleInput } from './dto/duplicate-circle.input';
import { CircleMembersInput } from './dto/circle-members.input';
import { CreateAdHocCircleInput } from './dto/create-ad-hoc-circle.input';
import { SaveAdHocCircleInput } from './dto/save-ad-hoc-circle.input';

/**
 * CirclesResolver — XH-3.
 *
 * ⚠️ MỌI operation ở đây dùng `GqlAuthGuard`, KHÔNG có bản `Optional`. Vòng
 * tròn là dữ liệu quản lý của chính viewer, không có khái niệm "xem vòng của
 * người khác" — cùng lý do `blockedUsers` bắt buộc đăng nhập còn `followers`
 * thì không (social.resolver.ts). Không có guard thì passport không chạy và
 * `@CurrentUser()` sẽ null, biến toàn bộ luật sở hữu thành code chết.
 *
 * `ownerId` LUÔN lấy từ token, KHÔNG BAO GIỜ từ Args. Nhận `ownerId` từ client
 * là mở đúng cửa mà luật "vòng người khác = 404" sinh ra để đóng.
 */
@Resolver(() => Circle)
export class CirclesResolver {
  constructor(private readonly circlesService: CirclesService) {}

  // ─── Query ─────────────────────────────────────────────────────────────────

  /**
   * Danh sách vòng của tôi cho màn `/settings`.
   *
   * Không phân trang, có chủ đích: trần cứng 20 vòng/người (XH-QĐ-13) nên tập
   * kết quả không thể phình. Cùng hình dạng `suggestedUsers` — thêm cursor vào
   * một danh sách bị chặn trên là thêm mặt để sai mà không mua được gì.
   */
  @Query(() => [Circle])
  @UseGuards(GqlAuthGuard)
  async myCircles(
    @Args('includeAdHoc', { type: () => Boolean, nullable: true, defaultValue: false })
    includeAdHoc: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.getMyCircles(user.userId, includeAdHoc ?? false);
  }

  /** Chi tiết một vòng. Vòng của người khác ⇒ 404 "Circle not found". */
  @Query(() => Circle)
  @UseGuards(GqlAuthGuard)
  async circle(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthUser) {
    return this.circlesService.getCircle(user.userId, id);
  }

  /**
   * Gợi ý người để thêm vào vòng (xahoi-tinh-nang.md §2).
   *
   * `circleId` tuỳ chọn: có thì loại sẵn thành viên hiện có (màn sửa vòng),
   * không có thì là gợi ý cho vòng sắp lập (màn tạo vòng / chọn khán giả).
   */
  @Query(() => [User])
  @UseGuards(GqlAuthGuard)
  async circleMemberSuggestions(
    @Args('circleId', { type: () => ID, nullable: true }) circleId: string | null,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 10 }) first: number,
    @CurrentUser() user: AuthUser,
  ) {
    const limit = Math.min(Math.max(first ?? 10, 1), 50);
    return this.circlesService.getMemberSuggestions(user.userId, circleId, limit);
  }

  // ─── Mutation ──────────────────────────────────────────────────────────────

  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async createCircle(
    @Args('input') input: CreateCircleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.createCircle(user.userId, input);
  }

  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async updateCircle(
    @Args('input') input: UpdateCircleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.updateCircle(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deleteCircle(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.deleteCircle(user.userId, id);
  }

  /** Nhân bản vòng — "để không phải tick lại 20 người". */
  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async duplicateCircle(
    @Args('input') input: DuplicateCircleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.duplicateCircle(user.userId, input);
  }

  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async addCircleMembers(
    @Args('input') input: CircleMembersInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.addMembers(user.userId, input);
  }

  /**
   * Bớt một người khỏi vòng.
   *
   * Trả về `Circle` chứ không phải `Boolean`: người gọi cần thấy `memberCount`
   * mới ngay, và quan trọng hơn — phía người BỊ bớt không được nhận bất cứ tín
   * hiệu nào (XH-QĐ-3, biến mất im lặng), nên toàn bộ phản hồi của thao tác này
   * chỉ nói chuyện với chủ vòng.
   *
   * Hai `@Args` đơn lẻ (không phải InputType) nên KHÔNG dính bẫy trộn `@Args()`
   * không tên với ArgsType — xem common/pagination/cursor-pagination.ts.
   */
  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async removeCircleMember(
    @Args('circleId', { type: () => ID }) circleId: string,
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.removeMember(user.userId, circleId, userId);
  }

  /**
   * Khán giả chọn tại chỗ (XH-QĐ-5) — tìm-hoặc-tạo theo tập thành viên.
   *
   * Gọi hai lần với cùng tập người trả về CÙNG một vòng, nên client gọi lại
   * thoải mái mà không đốt trần 20.
   */
  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async createAdHocCircle(
    @Args('input') input: CreateAdHocCircleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.createAdHocCircle(user.userId, input);
  }

  /** "Lưu vòng tròn này" — đặt tên cho vòng ad-hoc để nó thành vòng thường. */
  @Mutation(() => Circle)
  @UseGuards(GqlAuthGuard)
  async saveAdHocCircle(
    @Args('input') input: SaveAdHocCircleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.circlesService.saveAdHocCircle(user.userId, input);
  }
}
