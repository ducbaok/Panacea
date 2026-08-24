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
import { AnonId } from '../auth/decorators/anon-id.decorator';
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
    // XH-2 — ngữ cảnh khán giả đi cùng blockedIds ở MỌI call-site đọc pin:
    // hai bộ lọc cộng dồn AND, cùng memo theo request.
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user?.userId);
    return this.pinsService.findById(id, blockedIds, audienceCtx);
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
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user?.userId);
    return this.pinsService.exploreFeed(pagination, blockedIds, audienceCtx, { categorySlug, tagName });
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
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user?.userId);
    return this.pinsService.userPins(userId, pagination, blockedIds, audienceCtx);
  }

  /**
   * Kho của chính người gọi — pin đã hết hạn (XH-6).
   *
   * `GqlAuthGuard` chứ KHÔNG phải `GqlOptionalAuthGuard`: đây là query thứ hai
   * trong cả schema bắt buộc đăng nhập (cùng `homeFeed`). Khán giả của kho là
   * đúng một người, nên "khách vãng lai vẫn 200 với danh sách rỗng" không phải
   * một hành vi tử tế mà là một bề mặt vô nghĩa — không có ai để trả kho về.
   *
   * Chỉ có `first`/`after` nên `@Args()` không tên là AN TOÀN ở đây — cảnh báo
   * "không trộn @Args() với @Args('x')" ở `cursor-pagination.ts` chỉ áp cho
   * resolver có thêm args riêng lẻ (xem `userPins` ngay trên).
   */
  @Query(() => PaginatedPins, { name: 'archivedPins' })
  @UseGuards(GqlAuthGuard)
  async archivedPins(
    @Args() pagination: CursorPaginationArgs,
    @CurrentUser() user: AuthUser,
  ) {
    // KHÔNG lấy `blockedIds`/`audienceCtx` — và đó không phải quên: kho chỉ
    // chứa pin của chính người gọi, nên cả hai bộ lọc đều là hằng số ở đây
    // (không ai tự chặn mình, và chính chủ luôn nằm trong khán giả). Lý do đầy
    // đủ nằm ở docblock `PinsService.archivedPins`.
    return this.pinsService.archivedPins(user.userId, pagination);
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
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user?.userId);
    return this.pinsService.relatedPins(pinId, pagination, blockedIds, audienceCtx);
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
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user.userId);
    return this.pinsService.homeFeed(user.userId, pagination, blockedIds, audienceCtx, source);
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
   * Đăng lại pin từ kho — gỡ hạn sống (XH-6). Owner only.
   *
   * Trả `Pin!` chứ không `Boolean!`, cùng lý do đã ghi ở `togglePinReaction`
   * ngay dưới: client chuẩn hoá theo `id` nên lưới + màn kho + modal đang mở
   * cùng pin đó tự đúng sau một request, không phải refetch.
   *
   * Hộp xác nhận trước khi gọi là việc của FE (QĐ-24) — BE không có chỗ nào
   * diễn đạt được "người dùng đã bấm đồng ý", và bịa thêm một tham số
   * `confirmed: true` chỉ tạo cảm giác an toàn giả.
   */
  @Mutation(() => Pin)
  @UseGuards(GqlAuthGuard)
  async republishPin(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pinsService.republishPin(user.userId, id);
  }

  /**
   * Toggle Pin Reaction
   *
   * B-19 (17/08/2026) — `Boolean!` → `Pin!`. Cái `true` cũ không mang tin nào
   * (mọi nhánh hỏng đều ném exception), nên FE phải `refetch` cả pin sau MỖI
   * lần bấm chỉ để biết con số mới. Trả `Pin` ⇒ Apollo chuẩn hoá theo `id` ⇒
   * lưới + modal + trang đang mở cùng pin đó tự đúng, 1 request thay vì 2.
   *
   * 🔴 Đổi kiểu trả về là **breaking change ở tầng validation**, không phải
   * chuyện tương thích ngược: `{ togglePinReaction(...) }` (leaf selection) bị
   * GraphQL từ chối thẳng với "must have a selection of subfields". Mọi call
   * site phải thêm selection set — xem `scripts/verify/steps/10-pins.mjs`.
   */
  @Mutation(() => Pin)
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
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user.userId);
    return this.pinsService.toggleReaction(user.userId, pinId, type, audienceCtx);
  }

  // ─── B-4: view / click tracking ──────────────────────────────────────────────
  //
  // GraphQL chứ không REST: luật §3.1 dành REST cho **Auth / Uploads /
  // Internal**, và đây không thuộc ô nào trong ba.
  //
  // `GqlOptionalAuthGuard` cho cả hai: khách vãng lai xem được chi tiết pin thì
  // lượt xem của họ cũng phải được đếm. Nhưng có `@CurrentUser()` là **bắt buộc
  // có guard** (luật *guard tạo danh tính*) — thiếu guard thì `request.user`
  // không tồn tại, decorator trả `null` kể cả khi client gửi token hợp lệ, và
  // MỌI lượt xem sẽ bị gán nhầm sang nhánh khách vãng lai.
  //
  // Trả `Boolean!` với ngữ nghĩa **"lần gọi này có làm bộ đếm tăng không"**,
  // không phải "đã nhận yêu cầu". Luôn trả `true` thì phép kiểm quyết định
  // ("gọi 2 lần trong cửa sổ ⇒ tăng đúng 1") mất một nửa bằng chứng, và client
  // cũng không phân biệt được "đã đếm" với "bị khử trùng".

  /** Đếm lượt MỞ CHI TIẾT pin (không phải impression trên lưới). */
  @Mutation(() => Boolean)
  @UseGuards(GqlOptionalAuthGuard)
  async trackPinView(
    @Args('pinId', { type: () => ID }) pinId: string,
    @CurrentUser() user?: AuthUser | null,
    @AnonId() anonId?: string | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user?.userId);
    return this.pinsService.trackPinView(pinId, this._identity(user, anonId), blockedIds, audienceCtx);
  }

  /** Đếm lượt BẤM LINK NGOÀI (chỉ pin có `sourceUrl`). */
  @Mutation(() => Boolean)
  @UseGuards(GqlOptionalAuthGuard)
  async trackPinClick(
    @Args('pinId', { type: () => ID }) pinId: string,
    @CurrentUser() user?: AuthUser | null,
    @AnonId() anonId?: string | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    const audienceCtx = await this.dataloaderService.pinAudienceCtx(user?.userId);
    return this.pinsService.trackPinClick(pinId, this._identity(user, anonId), blockedIds, audienceCtx);
  }

  /**
   * Định danh dùng làm khoá debounce.
   *
   * Tiền tố `u:` / `a:` là BẮT BUỘC, không phải trang trí: thiếu nó thì một
   * khách vãng lai chỉ cần đặt `anonId` bằng `userId` của người khác là dùng
   * chung cửa sổ debounce với họ — tức chặn được lượt xem của người đó. Tiền tố
   * làm hai không gian khoá không thể chạm nhau.
   *
   * Người đã đăng nhập LUÔN thắng `anonId`: danh tính đến từ token, còn
   * `anonId` là thứ client tự khai (luật §3.5 số 14).
   */
  private _identity(user: AuthUser | null | undefined, anonId: string | null | undefined): string | null {
    if (user?.userId) return `u:${user.userId}`;
    if (anonId) return `a:${anonId}`;
    return null;
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
   * Id vòng được ghim — CHỈ chính chủ, người khác luôn `null` (XH-4a).
   *
   * Field này KHÔNG cần loader: giá trị đã nằm sẵn trên `pin` mà lưới vừa
   * fetch, việc duy nhất phải làm là quyết định có trả ra hay không. Nó vẫn
   * phải là `@ResolveField` chứ không phải một cột trần vì câu trả lời phụ
   * thuộc NGƯỜI ĐANG GỌI — cùng một pin trả id cho bao và `null` cho alice,
   * đúng họ với `isSavedByViewer` ngay dưới.
   *
   * Vì sao giấu: id vòng là danh tính của một nhóm bạn. Thành viên đọc được id
   * thì đọc được "mình bị xếp vào nhóm nào cùng ai" ngay khi API vòng tròn của
   * luồng B lên — trong khi XH-QĐ-3 cố tình giữ kín cả việc bị bớt khỏi vòng.
   * `null` ở đây không phân biệt được với "pin không ghim vòng nào", và đó là
   * chủ đích chứ không phải mất mát thông tin.
   */
  @ResolveField('audienceCircleId', () => ID, { nullable: true })
  getAudienceCircleId(
    @Parent() pin: Pin,
    @CurrentUser() viewer: AuthUser | null,
  ) {
    if (!viewer || viewer.userId !== pin.creatorId) return null;
    return pin.audienceCircleId ?? null;
  }

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
