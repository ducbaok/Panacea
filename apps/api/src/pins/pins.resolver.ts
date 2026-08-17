// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  PinsResolver — GraphQL Resolver cho Pin                                ║
// ║  Queries, Mutations, và ResolveField với DataLoader.                    ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Inject PinsService + DataloaderService.                             ║
// ║  2. Queries:                                                             ║
// ║     - pin(id): tìm pin theo ID                                          ║
// ║     - exploreFeed(first, after): public feed, cursor pagination         ║
// ║     - userPins(userId, first, after): pins của user cụ thể              ║
// ║     - homeFeed(first, after): feed của người mình follow — query DUY    ║
// ║       NHẤT ở đây BẮT BUỘC đăng nhập (Đợt 5)                             ║
// ║  3. Mutations:                                                           ║
// ║     - createPin(input): yêu cầu auth, tạo pin mới                      ║
// ║     - updatePin(input): yêu cầu auth, owner only                       ║
// ║     - deletePin(id): yêu cầu auth, soft delete, owner only             ║
// ║  4. ResolveField (giải N+1 bằng DataLoader):                           ║
// ║     - creator: userByIdLoader.load(pin.creatorId)                       ║
// ║     - savedCount: savedCountByPinIdLoader.load(pin.id)                  ║
// ║     - reactionCount: reactionCountByPinIdLoader.load(pin.id)            ║
// ║     - commentCount: commentCountByPinIdLoader.load(pin.id)              ║
// ║     - isSavedByViewer / viewerReaction: memo THEO VIEWER, thoát sớm     ║
// ║       false/null khi không có token (Đợt 3c)                            ║
// ║  5. Guard: GqlAuthGuard cho mutations. Cả 3 query dùng                  ║
// ║     GqlOptionalAuthGuard — vẫn public (không token vẫn 200), nhưng      ║
// ║     BIẾT viewer khi có token. Guard có hiệu lực toàn bộ request nên     ║
// ║     mọi ResolveField viewer-aware chạy bên dưới đọc được @CurrentUser() ║
// ║     — kể cả field nằm ở resolver khác (User.isFollowedByViewer).        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import {
  Resolver,
  Query,
  Mutation,
  Args,
  ResolveField,
  Parent,
  Int,
  ID,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Pin, PaginatedPins } from './entities/pin.entity';
import { HomeFeed } from './entities/home-feed.entity';
import { Tag } from './entities/tag.entity';
import { Category } from './entities/category.entity';
import { PinsService } from './pins.service';
import { CreatePinInput } from './dto/create-pin.input';
import { UpdatePinInput } from './dto/update-pin.input';
import { CursorPaginationArgs } from '../common/pagination';
import { UserPinsArgs } from './dto/user-pins.args';
import { ExploreFeedArgs } from './dto/explore-feed.args';
import { RelatedPinsArgs } from './dto/related-pins.args';
import { HomeFeedArgs } from './dto/home-feed.args';
import { DataloaderService } from '../common/dataloader';
import { GqlAuthGuard, GqlOptionalAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { User } from '../users/entities/user.entity';
// Enum GraphQL đã `registerEnumType` — dùng lại bản của comments thay vì khai
// bản thứ hai, vì SDL chỉ chứa được MỘT type tên `ReactionType`.
import { ReactionType } from '../comments/entities/reaction-type.enum';

@Resolver(() => Pin)
export class PinsResolver {
  constructor(
    private readonly pinsService: PinsService,
    private readonly dataloaderService: DataloaderService,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  /**
   * Lấy chi tiết 1 pin theo ID.
   * Public — không token vẫn trả 200. Guard optional chỉ để BIẾT viewer khi
   * có token, cho các ResolveField viewer-aware bên dưới.
   */
  @Query(() => Pin, { name: 'pin', nullable: true })
  @UseGuards(GqlOptionalAuthGuard)
  async getPin(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user?: AuthUser | null,
  ) {
    // Đợt 3e — call-site NGUY HIỂM NHẤT trong ba. `exploreFeed` lọc đúng mà chỗ
    // này quên lọc thì bộ lọc vô nghĩa: mở thẳng link pin là lách được, và
    // không phép kiểm nào của feed phát hiện ra.
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.pinsService.findById(id, blockedIds);
  }

  /**
   * Explore Feed — tất cả pins mới nhất.
   * Cursor-based pagination theo PLAN.md.
   */
  @Query(() => PaginatedPins, { name: 'exploreFeed' })
  @UseGuards(GqlOptionalAuthGuard)
  async exploreFeed(
    // B-5: gộp `categorySlug`/`tagName` vào MỘT ArgsType kế thừa
    // `CursorPaginationArgs`. Trộn `@Args('categorySlug')` với `@Args()
    // CursorPaginationArgs` sẽ giết query — xem cảnh báo trong `explore-feed.args.ts`
    // và `common/pagination/cursor-pagination.ts`.
    @Args() { categorySlug, tagName, ...pagination }: ExploreFeedArgs,
    @CurrentUser() user?: AuthUser | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.pinsService.exploreFeed(pagination, blockedIds, { categorySlug, tagName });
  }

  /**
   * Pins của một user cụ thể.
   */
  @Query(() => PaginatedPins, { name: 'userPins' })
  @UseGuards(GqlOptionalAuthGuard)
  async userPins(
    // Gộp userId + first/after vào MỘT ArgsType. Trộn @Args('userId') với
    // @Args() CursorPaginationArgs làm query luôn trả 400 — xem
    // common/pagination/cursor-pagination.ts.
    @Args() { userId, ...pagination }: UserPinsArgs,
    @CurrentUser() user?: AuthUser | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.pinsService.userPins(userId, pagination, blockedIds);
  }

  /**
   * B-11 — Pin liên quan với một pin, theo **tag chung**, nhiều tag chung xếp
   * trước.
   *
   * `GqlOptionalAuthGuard` chứ không phải `GqlAuthGuard`: khách vãng lai xem
   * được trang chi tiết pin thì cũng phải xem được dải "pin liên quan" dưới đó.
   * Nhưng có `@CurrentUser()` thì **bắt buộc có guard** (luật *guard tạo danh
   * tính*) — thiếu guard, `request.user` không tồn tại và decorator trả `null`
   * **kể cả khi client gửi token hợp lệ**, tức bộ lọc chặn im lặng tắt.
   */
  @Query(() => PaginatedPins, { name: 'relatedPins' })
  @UseGuards(GqlOptionalAuthGuard)
  async relatedPins(
    @Args() { pinId, ...pagination }: RelatedPinsArgs,
    @CurrentUser() user?: AuthUser | null,
  ) {
    // Cùng một mảng `blockedIds` (2 chiều, từ `common/blocking/`) dùng cho CẢ
    // pin gốc lẫn pin kết quả — service lo phần đó. Đừng viết nhánh lọc mới.
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.pinsService.relatedPins(pinId, pagination, blockedIds);
  }

  /**
   * Home Feed — pin của những người mình đang follow.
   *
   * ⚠️ `GqlAuthGuard` (BẮT BUỘC đăng nhập), khác hẳn 3 query trên vốn dùng
   * `GqlOptionalAuthGuard`. Không phải chuyện siết bảo mật: query này không có
   * nghĩa gì khi không biết viewer là ai — "feed của những người TÔI follow"
   * mà không có "tôi" thì chỉ còn là explore feed dưới một cái tên gây hiểu
   * nhầm. Trả 401 nói đúng sự thật; trả explore lặng lẽ thì không.
   *
   * Việc chọn nguồn (FOLLOWING ⇄ EXPLORE) nằm trong service — xem
   * `PinsService.homeFeed`. Resolver cố ý không biết `exploreFeed` tồn tại.
   */
  @Query(() => HomeFeed, { name: 'homeFeed' })
  @UseGuards(GqlAuthGuard)
  async homeFeed(
    // `source` tuỳ chọn (§6b.1): bỏ trống ⇒ backend tự chọn nhánh như cũ; có ⇒
    // client ép nguồn, không fallback. Gộp cùng first/after trong MỘT ArgsType.
    @Args() { source, ...pagination }: HomeFeedArgs,
    @CurrentUser() user: AuthUser,
  ) {
    // Cùng khuôn với 3 query trên (Đợt 3e): resolver đọc memo rồi TRUYỀN XUỐNG.
    // `PinsService` không được inject `DataloaderService` — nó là Scope.REQUEST
    // và sẽ kéo cả `PinsController` theo.
    const blockedIds = await this.dataloaderService.blockedUserIds(user.userId);
    return this.pinsService.homeFeed(user.userId, pagination, blockedIds, source);
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /**
   * Tạo pin mới. Yêu cầu đăng nhập.
   * Client phải gọi Presigned URL trước, upload ảnh, rồi gọi mutation này.
   */
  @Mutation(() => Pin)
  @UseGuards(GqlAuthGuard)
  async createPin(
    @Args('input') input: CreatePinInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pinsService.createPin(user.userId, input);
  }

  /**
   * Cập nhật pin. Owner only.
   */
  @Mutation(() => Pin)
  @UseGuards(GqlAuthGuard)
  async updatePin(
    @Args('input') input: UpdatePinInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pinsService.updatePin(user.userId, input);
  }

  /**
   * Soft delete pin. Owner only.
   */
  @Mutation(() => Pin)
  @UseGuards(GqlAuthGuard)
  async deletePin(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pinsService.deletePin(user.userId, id);
  }

  /**
   * Toggle Pin Reaction
   */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async togglePinReaction(
    @Args('pinId', { type: () => ID }) pinId: string,
    // Đợt 3d — trước đây khai `@Args('type') type: string` nên SDL sinh ra
    // `String!`, và `type as any` bịt luôn cảnh báo của tsc. Hệ quả đo được
    // ngày 05/08/2026: gửi `type: "NOPE"` KHÔNG bị GraphQL chặn, nó đi thẳng
    // xuống `prisma.reaction.create()` và nổ ở đó — API trả HTTP 200 kèm lỗi
    // runtime của Prisma thay vì 400 validation. Khai đúng enum đẩy phép kiểm
    // ngược lên tầng schema, nơi nó thuộc về, và xoá được `as any`.
    @Args('type', { type: () => ReactionType }) type: ReactionType,
    @CurrentUser() user: AuthUser,
  ) {
    await this.pinsService.toggleReaction(user.userId, pinId, type);
    return true;
  }

  // ─── ResolveField (DataLoader) ───────────────────────────────────────────────

  /**
   * Resolve creator field bằng DataLoader.
   * Thay vì N+1 queries, tất cả creatorId sẽ được batch thành 1 query.
   */
  @ResolveField('creator', () => User)
  async getCreator(@Parent() pin: Pin) {
    return this.dataloaderService.userByIdLoader.load(pin.creatorId);
  }

  /**
   * Số lần pin được save bởi tất cả users.
   */
  @ResolveField('savedCount', () => Int)
  async getSavedCount(@Parent() pin: Pin) {
    return this.dataloaderService.savedCountByPinIdLoader.load(pin.id);
  }

  /**
   * Tổng số reactions trên pin.
   */
  @ResolveField('reactionCount', () => Int)
  async getReactionCount(@Parent() pin: Pin) {
    return this.dataloaderService.reactionCountByPinIdLoader.load(pin.id);
  }

  /**
   * Tổng số comments trên pin (không tính soft-deleted).
   */
  @ResolveField('commentCount', () => Int)
  async getCommentCount(@Parent() pin: Pin) {
    return this.dataloaderService.commentCountByPinIdLoader.load(pin.id);
  }

  // ─── Taxonomy (Đợt 6) ───────────────────────────────────────────────────────
  //
  // KHÔNG đọc `@CurrentUser()` — cố ý. Tag/category là thuộc tính của pin, giống
  // `savedCount`, chứ không phải quan hệ giữa pin và người xem như hai field
  // cuối file. Thêm viewer vào đây sẽ làm loader phải memo theo viewer mà không
  // đổi được giá trị nào.

  /** Nhãn tự do của pin. Pin chưa gắn tag nào ⇒ `[]`. */
  @ResolveField('tags', () => [Tag])
  async getTags(@Parent() pin: Pin) {
    return this.dataloaderService.tagsByPinIdLoader.load(pin.id);
  }

  /** Danh mục biên tập của pin. Pin chưa thuộc danh mục nào ⇒ `[]`. */
  @ResolveField('categories', () => [Category])
  async getCategories(@Parent() pin: Pin) {
    return this.dataloaderService.categoriesByPinIdLoader.load(pin.id);
  }

  // ─── ResolveField phụ thuộc viewer (Đợt 3c) ─────────────────────────────────
  //
  // Hai field dưới đọc `@CurrentUser()` ngay tại chỗ, giống
  // `users.resolver.ts:144`/`:160`. Đọc được là nhờ Đợt 3a đã gắn
  // `GqlOptionalAuthGuard` cho cả 3 query ở đầu file — guard có hiệu lực cho
  // toàn bộ request nên viewer còn nguyên khi xuống tới đây.
  //
  // `if (!viewer) return ...` KHÔNG chỉ là lối tắt cho nhanh: nó chặn việc gọi
  // `perViewer(name, '')`. Khoá rỗng sẽ memo MỘT instance loader dùng chung cho
  // mọi khách vãng lai trong cùng request, và loader đó lại query với
  // `userId: ''` — vừa vô nghĩa vừa tốn một round-trip cho câu trả lời đã biết
  // trước.

  /**
   * Viewer đã lưu pin này chưa. Khách vãng lai ⇒ `false`.
   */
  @ResolveField('isSavedByViewer', () => Boolean, { nullable: true })
  async getIsSavedByViewer(
    @Parent() pin: Pin,
    @CurrentUser() viewer: AuthUser | null,
  ) {
    if (!viewer) return false;
    return this.dataloaderService
      .buildIsSavedByViewerLoader(viewer.userId)
      .load(pin.id);
  }

  /**
   * Reaction của riêng viewer trên pin này. Khách vãng lai ⇒ `null`.
   *
   * `null` ở đây là "chưa thả reaction", không phải "không biết" — cùng một
   * pin_1 trả `WOW` cho john, `THANKS` cho alice và `null` cho bao.
   */
  @ResolveField('viewerReaction', () => ReactionType, { nullable: true })
  async getViewerReaction(
    @Parent() pin: Pin,
    @CurrentUser() viewer: AuthUser | null,
  ) {
    if (!viewer) return null;
    return this.dataloaderService
      .buildViewerReactionLoader(viewer.userId)
      .load(pin.id);
  }
}
