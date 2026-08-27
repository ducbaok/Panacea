// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Visible pins — nguồn sự thật DUY NHẤT cho "ai được thấy pin nào"         ║
// ║  (XH-2, 21/08/2026 — PLAN_XAHOI.md §3)                                    ║
// ║                                                                           ║
// ║  Đây là cơ chế thứ hai cùng loại với `getBlockedUserIds` (file bên cạnh): ║
// ║  MỌI bề mặt đọc pin đều phải đi qua nó. Chặn và quyền riêng tư CỘNG DỒN   ║
// ║  (AND), không thay thế nhau.                                              ║
// ║                                                                           ║
// ║  ⚠️ BA HÌNH THÁI CỦA CÙNG MỘT LUẬT — SỬA MỘT LÀ PHẢI SỬA CẢ BA:          ║
// ║    1. `visiblePinWhere`   — Prisma where (các bề mặt dùng Prisma)         ║
// ║    2. `visiblePinSql`     — mảnh SQL (5 chỗ $queryRawUnsafe: exploreFeed  ║
// ║       · relatedPins · homeFeed · userPins của PinsService, và searchPins) ║
// ║    3. `isPinVisibleInCtx` — predicate in-memory (định hình attachedPin    ║
// ║       trong tin nhắn, findById, savePin)                                  ║
// ║  Chúng cố ý nằm CẠNH NHAU trong một file để không thể lệch mà không ai    ║
// ║  thấy. Bước verify `72-visibility.mjs` đối chiếu cả ba qua 10 bề mặt.     ║
// ║                                                                           ║
// ║  BA LUẬT CỘNG DỒN (AND) trong cả ba hình thái:                            ║
// ║    1. còn hạn sống   — `expiresAt` NULL hoặc chưa tới                     ║
// ║    2. đúng khán giả  — PUBLIC / chính chủ / FOLLOWERS / CIRCLE            ║
// ║    3. CHỦ PIN CÒN SỐNG (26/08/2026) — `User.deletedAt IS NULL`            ║
// ║                                                                           ║
// ║  Luật 3 thêm sau, từ một sự cố THẬT: một tài khoản bị xoá (soft delete)   ║
// ║  để lại 5 pin trong feed công khai. Middleware soft-delete lọc user đã    ║
// ║  xoá khỏi mọi query ⇒ loader trả `null` cho `Pin.creator`, mà field đó    ║
// ║  khai NON-NULLABLE ⇒ GraphQL huỷ TOÀN BỘ response `exploreFeed`, không    ║
// ║  phải chỉ một thẻ. Triệu chứng: trang chủ TRẮNG với tất cả mọi người,     ║
// ║  khách lẫn người đã đăng nhập, không một thông báo lỗi nào. Job purge có  ║
// ║  ân hạn 30 ngày nên trạng thái hỏng đó kéo dài 30 ngày chứ không tự khỏi. ║
// ║  ⇒ Đây KHÔNG phải luật thẩm mỹ. Gỡ nó ra là trang chủ trắng trở lại.      ║
// ║                                                                           ║
// ║  FAIL-CLOSED: thiếu định danh người xem ⇒ khách ⇒ CHỈ thấy PUBLIC.        ║
// ║  (xahoi-phi-chuc-nang.md §1.2 — dự án đã dính lớp bug "im lặng trả false" ║
// ║  với các field viewer-aware; với quyền riêng tư thì chiều sai là RÒ RỈ.)  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ngữ cảnh khán giả của MỘT người xem trong MỘT request — lấy MỘT lần rồi
 * truyền xuống (xahoi-phi-chuc-nang.md §3.1: quy mọi điều kiện về `IN` trên
 * danh sách id có index, tuyệt đối không lồng `some:` cho từng pin).
 */
export interface PinAudienceCtx {
  /** `null` = khách vãng lai. */
  viewerId: string | null;
  /** Người TÔI đang theo dõi — vế FOLLOWERS. */
  followingIds: string[];
  /** Vòng tôi LÀ THÀNH VIÊN (không phải vòng tôi sở hữu) — vế CIRCLE. */
  memberCircleIds: string[];
}

/** Ngữ cảnh của khách vãng lai — hằng, không chạm database. */
export const GUEST_AUDIENCE_CTX: PinAudienceCtx = Object.freeze({
  viewerId: null,
  followingIds: [],
  memberCircleIds: [],
});

/**
 * Lấy ngữ cảnh khán giả cho `viewerId`. Hàm THUẦN nhận `prisma` — cùng lý do
 * với `getBlockedUserIds`: dùng được từ cả service singleton lẫn
 * `DataloaderService` (Scope.REQUEST) mà không kéo scope lan sang bên nào.
 *
 * Hai query, cả hai chạy trên index (`Follows_followerId_idx`,
 * `CircleMember_userId_idx`). ⚠️ Ngưỡng đã ghi nhận trước (không tối ưu sớm):
 * `followingIds` phình theo số người theo dõi — quy mô học tập thì ổn, một tài
 * khoản theo dõi hàng nghìn người thì phải đổi sang join
 * (xahoi-phi-chuc-nang.md §3.1).
 */
export async function getPinAudienceCtx(
  prisma: PrismaService,
  viewerId?: string,
): Promise<PinAudienceCtx> {
  if (!viewerId) return GUEST_AUDIENCE_CTX;

  const [follows, memberships] = await Promise.all([
    prisma.follows.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    }),
    prisma.circleMember.findMany({
      where: { userId: viewerId },
      select: { circleId: true },
    }),
  ]);

  return {
    viewerId,
    followingIds: follows.map((f) => f.followingId),
    memberCircleIds: memberships.map((m) => m.circleId),
  };
}

// ─── Hình thái 1: Prisma where ────────────────────────────────────────────────

/**
 * Điều kiện "pin này hiển thị được cho người xem" — dạng Prisma where.
 *
 * Cấu trúc (PLAN_XAHOI.md §3):
 *   AND: [
 *     hết hạn đánh giá LÚC ĐỌC (XH-QĐ-7): expiresAt null HOẶC còn tương lai,
 *     khán giả: PUBLIC ∪ chính chủ ∪ FOLLOWERS(tôi theo dõi tác giả)
 *                       ∪ CIRCLE(tôi là thành viên vòng được ghim)
 *   ]
 *
 * ⚠️ CHIỀU CỦA FOLLOWERS: "người theo dõi TÁC GIẢ được xem" ⇒ điều kiện là
 * `creatorId IN followingIds` (danh sách người TÔI theo dõi). Viết ngược thì
 * không có lỗi nào nổ ra, chỉ là feed sai âm thầm — PLAN_XAHOI.md §3 cảnh báo
 * đích danh chỗ này.
 *
 * ⚠️ PIN HẾT HẠN BỊ ẨN VỚI CẢ CHÍNH CHỦ ở các bề mặt danh sách — kho (archive)
 * là một query RIÊNG của XH-6, không phải một nhánh của bộ lọc này
 * (xahoi-tinh-nang.md §5: "biến mất khỏi mọi luồng, tìm kiếm, hồ sơ"). Ngoại lệ
 * DUY NHẤT là mở pin qua link trực tiếp: `findById` cho CHÍNH CHỦ đi qua trước
 * khi chạm bộ lọc — để màn chi tiết trong kho vẫn mở được.
 *
 * Nhánh rỗng bị BỎ HẲN khỏi OR (không sinh `in: []`) — cùng triết lý
 * `_notInBlocked`: mảng rỗng là đường đi của đa số request thật.
 */
export function visiblePinWhere(ctx: PinAudienceCtx): any {
  const audienceOr: any[] = [{ visibility: 'PUBLIC' }];
  if (ctx.viewerId) {
    audienceOr.push({ creatorId: ctx.viewerId });
  }
  if (ctx.followingIds.length) {
    audienceOr.push({
      visibility: 'FOLLOWERS',
      creatorId: { in: ctx.followingIds },
    });
  }
  if (ctx.memberCircleIds.length) {
    audienceOr.push({
      visibility: 'CIRCLE',
      audienceCircleId: { in: ctx.memberCircleIds },
    });
  }

  return {
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      // Luật 3 (26/08/2026) — CHỦ PIN PHẢI CÒN SỐNG. Xem docblock đầu hàm.
      { creator: { deletedAt: null } },
      { OR: audienceOr },
    ],
  };
}

// ─── Hình thái 2: mảnh SQL cho $queryRawUnsafe ────────────────────────────────

/**
 * Cùng luật với `visiblePinWhere`, dạng mảnh SQL đã bọc ngoặc — AND thẳng vào
 * mệnh đề WHERE của 5 câu raw SQL. `q` là bộ đếm placeholder `_sqlParams()`
 * của bên gọi (pins.service.ts / search.service.ts) — giá trị và số thứ tự
 * sinh cùng một chỗ nên không lệch được.
 *
 * ⚠️ CẢNH BÁO SONG-BẢN (PLAN_XAHOI.md §3 bẫy 4): trước XH-2, search là nơi
 * "điều kiện phải viết tay lần thứ hai". Nay CẢ search LẪN 4 hàm feed đều gọi
 * đúng hàm này — không còn bản chép tay nào. Nếu có ngày ai đó inline điều
 * kiện này vào một câu SQL, người đó vừa tạo lại đúng cái lỗ mà thiết kế này
 * sinh ra để bịt.
 *
 * `prefix` — tiền tố bảng (`'p.'`, `'sp.'`) cho câu có JOIN/alias, cùng quy ước
 * với `_notInBlocked`.
 */
export function visiblePinSql(
  ctx: PinAudienceCtx,
  q: { bind: (v: any) => string },
  prefix = '',
): string {
  const col = (c: string) => `${prefix}"${c}"`;

  const audience: string[] = [`${col('visibility')} = 'PUBLIC'`];
  if (ctx.viewerId) {
    audience.push(`${col('creatorId')} = ${q.bind(ctx.viewerId)}`);
  }
  if (ctx.followingIds.length) {
    audience.push(
      `(${col('visibility')} = 'FOLLOWERS' AND ${col('creatorId')} IN (${ctx.followingIds
        .map((id) => q.bind(id))
        .join(',')}))`,
    );
  }
  if (ctx.memberCircleIds.length) {
    audience.push(
      `(${col('visibility')} = 'CIRCLE' AND ${col('audienceCircleId')} IN (${ctx.memberCircleIds
        .map((id) => q.bind(id))
        .join(',')}))`,
    );
  }

  // Luật 3 — chủ pin phải còn sống (xem docblock đầu hàm).
  //
  // `EXISTS` chứ không `JOIN`: quan hệ 1-1 nên JOIN không nhân dòng, nhưng 5 câu
  // gọi hàm này có alias khác nhau (`''`, `'p.'`, `'sp.'`) và một câu đã JOIN
  // sẵn — thêm JOIN nữa là phải sửa cả 5 chỗ. `EXISTS` cắm được vào WHERE của
  // bất kỳ câu nào mà không đụng tới mệnh đề FROM.
  //
  // Alias `cu` (creator user) chứ không phải `u`: `relatedPins` đã có alias
  // `sp`/`p` cho hai bảng Pin, và một ngày nào đó có câu JOIN thêm `"User" u`
  // thì trùng alias sẽ làm Postgres hiểu sang bảng khác — vẫn chạy, vẫn trả sai.
  const creatorAlive =
    `EXISTS (SELECT 1 FROM "User" cu WHERE cu."id" = ${col('creatorId')}` +
    ` AND cu."deletedAt" IS NULL)`;
  return `((${col('expiresAt')} IS NULL OR ${col('expiresAt')} > now())
           AND ${creatorAlive}
           AND (${audience.join('\n             OR ')}))`;
}

// ─── Hình thái 3: predicate in-memory ─────────────────────────────────────────

/** Tập cột tối thiểu để đánh giá được quyền xem một pin đã fetch. */
export interface PinVisibilityFields {
  creatorId: string;
  visibility: string;
  audienceCircleId: string | null;
  expiresAt: Date | string | null;
  /**
   * Luật 3 — chủ pin còn sống. TUỲ CHỌN vì hình thái này nhận pin đã fetch sẵn
   * vì lý do khác, và phần lớn call-site không `include` quan hệ `creator`.
   *
   * `undefined` = bên gọi KHÔNG hỏi ⇒ bỏ qua luật 3 (giữ nguyên hành vi cũ,
   * không âm thầm chặn thêm). `null` hoặc có `deletedAt` = chủ đã xoá ⇒ ẩn.
   *
   * ⚠️ Middleware soft-delete CHỈ vá `where` ở TẦNG TRÊN CÙNG của query, không
   * đụng vào `include` lồng bên trong — nên `include: { creator: … }` trên Pin
   * VẪN trả về bản ghi của user đã xoá, kèm `deletedAt` khác null. Đó là lý do
   * phải so `deletedAt` chứ không chỉ kiểm tra `creator == null`.
   */
  creator?: { deletedAt: Date | string | null } | null;
}

/**
 * Predicate in-memory — CÙNG luật với hai hình thái trên, dùng cho những chỗ
 * pin ĐÃ được fetch vì lý do khác (attachedPin trong tin nhắn, `findById`,
 * `savePin`) và chỉ cần định hình/chặn, không cần thêm query.
 *
 * KHÔNG có ngoại lệ chính-chủ-xem-pin-hết-hạn ở đây — ngoại lệ đó là quyết định
 * của RIÊNG `findById` (mở link trực tiếp từ kho) và phải nằm ở đó, tường minh.
 */
export function isPinVisibleInCtx(
  pin: PinVisibilityFields,
  ctx: PinAudienceCtx,
): boolean {
  if (pin.expiresAt != null && new Date(pin.expiresAt) <= new Date()) {
    return false;
  }

  // Luật 3 — chủ pin còn sống. Đứng TRƯỚC nhánh `visibility === 'PUBLIC'`: pin
  // của tài khoản đã xoá thì PUBLIC hay không cũng không còn ai để hiển thị tên.
  if (pin.creator !== undefined) {
    if (pin.creator === null || pin.creator.deletedAt != null) return false;
  }

  if (pin.visibility === 'PUBLIC') return true;
  if (!ctx.viewerId) return false; // fail-closed
  if (pin.creatorId === ctx.viewerId) return true;

  if (pin.visibility === 'FOLLOWERS') {
    return ctx.followingIds.includes(pin.creatorId);
  }
  if (pin.visibility === 'CIRCLE') {
    return (
      pin.audienceCircleId != null &&
      ctx.memberCircleIds.includes(pin.audienceCircleId)
    );
  }

  // ONLY_ME (đã loại chính chủ ở trên) và mọi giá trị lạ trong tương lai:
  // fail-closed.
  return false;
}
