import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialService } from '../social/social.service';
import { getBlockedUserIds } from '../common/blocking';
// Import THẲNG FILE, không qua barrel `../common/blocking` — file này là vùng
// chung của luồng A và luồng B (hai worktree song song); barrel là chỗ hai bên
// chắc chắn đụng nhau mà nội dung không trùng byte. Xem header của util.
import { AD_HOC_CIRCLE_NAME, computeMemberHash } from '../common/blocking/member-hash.util';
import { MAX_CIRCLES_PER_USER, MAX_MEMBERS_PER_CIRCLE } from './circles.constants';
import { CreateCircleInput } from './dto/create-circle.input';
import { UpdateCircleInput } from './dto/update-circle.input';
import { DuplicateCircleInput } from './dto/duplicate-circle.input';
import { CircleMembersInput } from './dto/circle-members.input';
import { CreateAdHocCircleInput } from './dto/create-ad-hoc-circle.input';
import { SaveAdHocCircleInput } from './dto/save-ad-hoc-circle.input';
import { Circle } from './entities/circle.entity';

// Tên vòng ad-hoc: một hằng DUY NHẤT ở `member-hash.util.ts` (chốt 25/08/2026).
// Bản sao cục bộ `AD_HOC_PLACEHOLDER_NAME` đã bị gỡ — chính nó là nửa kia của
// điểm treo "hai đường tạo lệch nhau": cùng giá trị rỗng, nhưng hai hằng thì
// hai bên tự do trôi khỏi nhau, và đã trôi thật.

/** Kiểu tối thiểu của một dòng `Circle` kèm thành viên đã nạp. */
type CircleRow = {
  id: string;
  ownerId: string;
  name: string;
  rank: number | null;
  isAdHoc: boolean;
  createdAt: Date;
  updatedAt: Date;
  members: { userId: string }[];
};

/**
 * CirclesService — XH-3 (PLAN_XAHOI.md §6), vòng tròn bạn bè.
 *
 * ╔═════════════════════════════════════════════════════════════════════════╗
 * ║  BA LUẬT CHI PHỐI MỌI HÀM TRONG FILE NÀY                                ║
 * ║                                                                         ║
 * ║  1. VÒNG NGƯỜI KHÁC = KHÔNG TỒN TẠI. Mọi thao tác đọc/ghi lên vòng      ║
 * ║     không thuộc sở hữu viewer trả **404 "Circle not found"**, không     ║
 * ║     phải 403 — cùng chính sách với pin ngoài khán giả và với chức năng  ║
 * ║     Chặn (PLAN_XAHOI.md §3 "Chính sách lỗi"). 403 tự nó là tín hiệu rò  ║
 * ║     rỉ: nó xác nhận "có một vòng thật ở id này". Cửa duy nhất đi vào    ║
 * ║     là `_ownedCircleOrThrow`.                                          ║
 * ║                                                                         ║
 * ║  2. MỘT CƠ CHẾ, HAI CÁCH TRÌNH BÀY. `rank` là "level thân thiết";       ║
 * ║     vòng ad-hoc là `Circle` có cờ. Không có bảng thứ hai cho level,     ║
 * ║     không có bảng `PinAudience` riêng (XH-QĐ-5) — mọi khán giả trên     ║
 * ║     toàn hệ thống đều là một dòng của bảng này.                        ║
 * ║                                                                         ║
 * ║  3. BỎ NGƯỜI RA KHỎI VÒNG LÀ HỒI TỐ VÀ IM LẶNG (XH-QĐ-3). Service này  ║
 * ║     KHÔNG phải làm gì thêm để đạt điều đó, và đó chính là chỗ dễ hiểu   ║
 * ║     nhầm nhất: quyền xem pin được tính LÚC ĐỌC từ `CircleMember`        ║
 * ║     (`getPinAudienceCtx` lấy `memberCircleIds` mỗi request), nên xoá    ║
 * ║     một dòng thành viên là pin cũ biến mất khỏi MỌI bề mặt của người    ║
 * ║     đó — kể cả board họ đã lưu. Cấm gửi thông báo "bạn bị bớt khỏi      ║
 * ║     vòng"; cấm để lại bia mộ. Bước `73-circles.mjs` đo đúng điều này.   ║
 * ╚═════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ KHÔNG inject `DataloaderService` vào service này. Nó là `Scope.REQUEST`;
 * kéo vào một provider singleton là kéo cả nhánh phụ thuộc sang request-scope.
 * Ở đây cũng không cần: trần 20 vòng × 50 người (XH-QĐ-13) đóng cứng kích
 * thước response, nên `include` + một lần `user.findMany` là đủ, không có N+1.
 */
@Injectable()
export class CirclesService {
  constructor(
    private readonly prisma: PrismaService,
    // Chỉ dùng cho `getMemberSuggestions` — tái dùng xếp hạng bạn-của-bạn của
    // `suggestedUsers` thay vì viết bản xếp hạng thứ hai (xahoi-tinh-nang.md §2).
    private readonly socialService: SocialService,
  ) {}

  // ─── Đọc ───────────────────────────────────────────────────────────────────

  /**
   * Vòng của TÔI, cho màn `/settings`.
   *
   * `includeAdHoc = false` mặc định vì XH-QĐ-5: khán giả chọn tại chỗ **ẩn khỏi
   * màn quản lý**. Cờ này tồn tại cho những chỗ cần bức tranh đầy đủ (ví dụ FE
   * muốn giải thích vì sao trần 20 đã cháy) chứ không phải để bật cho vui.
   *
   * Thứ tự: `rank` tăng dần rồi `createdAt` giảm dần. Postgres xếp NULL **cuối
   * cùng** với ASC theo mặc định, nên vòng có level lên trước, vòng tự đặt tên
   * xuống dưới — đúng thứ tự màn quản lý muốn, không cần `nulls: 'last'`.
   */
  async getMyCircles(ownerId: string, includeAdHoc = false): Promise<Circle[]> {
    const rows = await this.prisma.circle.findMany({
      where: { ownerId, ...(includeAdHoc ? {} : { isAdHoc: false }) },
      orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
      include: { members: { select: { userId: true } } },
    });
    return this._shapeMany(rows as CircleRow[]);
  }

  /** Một vòng theo id — của người khác thì 404 (luật 1). */
  async getCircle(ownerId: string, circleId: string): Promise<Circle> {
    const row = await this._ownedCircleOrThrow(circleId, ownerId);
    return this._shapeOne(row);
  }

  // ─── Ghi: vòng đặt tên ─────────────────────────────────────────────────────

  async createCircle(ownerId: string, input: CreateCircleInput): Promise<Circle> {
    const userIds = [...new Set(input.userIds ?? [])];
    await this._assertCircleQuota(ownerId);
    this._assertMemberCount(0, userIds.length);
    await this._assertUsersAddable(ownerId, userIds);

    const row = await this.prisma.circle.create({
      data: {
        ownerId,
        name: input.name,
        rank: input.rank ?? null,
        isAdHoc: false,
        // Vòng đặt tên KHÔNG mang memberHash. Postgres coi NULL ≠ NULL nên
        // `@@unique([ownerId, memberHash])` không ràng buộc chúng với nhau —
        // người dùng được phép có hai vòng tên khác nhau cùng tập người.
        memberHash: null,
        members: { create: userIds.map((userId) => ({ userId })) },
      },
      include: { members: { select: { userId: true } } },
    });
    return this._shapeOne(row as CircleRow);
  }

  async updateCircle(ownerId: string, input: UpdateCircleInput): Promise<Circle> {
    const row = await this._ownedCircleOrThrow(input.id, ownerId);
    this._assertNotAdHoc(row);

    const row2 = await this.prisma.circle.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        // `undefined` = không gửi field ⇒ giữ nguyên. `null` = xoá rank.
        // Prisma coi `undefined` là "bỏ qua" nên phân biệt này miễn phí, nhưng
        // chỉ đúng khi ta KHÔNG viết `input.rank ?? null` — viết thế thì
        // "không gửi" cũng thành "xoá".
        ...(input.rank !== undefined ? { rank: input.rank } : {}),
      },
      include: { members: { select: { userId: true } } },
    });
    return this._shapeOne(row2 as CircleRow);
  }

  /**
   * Xoá vòng.
   *
   * ⚠️ Hệ quả lan sang PIN, và nó là fail-closed có chủ đích:
   * `Pin.audienceCircleId` khai báo `onDelete: SetNull`, nên pin từng ghim vào
   * vòng này còn lại `visibility = CIRCLE` với `audienceCircleId = null`. Điều
   * kiện đọc là `audienceCircleId IN myCircleIds` — `null` không IN gì cả ⇒ chỉ
   * CHÍNH CHỦ còn thấy. Mất khán giả chứ không lộ ra ngoài.
   */
  async deleteCircle(ownerId: string, circleId: string): Promise<boolean> {
    const row = await this._ownedCircleOrThrow(circleId, ownerId);
    await this.prisma.circle.delete({ where: { id: row.id } });
    return true;
  }

  /** Nhân bản: cùng tập thành viên, tên mới, luôn là vòng đặt tên. */
  async duplicateCircle(ownerId: string, input: DuplicateCircleInput): Promise<Circle> {
    const source = await this._ownedCircleOrThrow(input.sourceCircleId, ownerId);
    await this._assertCircleQuota(ownerId);

    // Cố ý KHÔNG chạy `_assertUsersAddable` trên bản sao: đây không phải hành
    // vi "thêm người mới" mà là sao chép một trạng thái đã hợp lệ lúc lập. Nếu
    // trong lúc đó có ai bị chặn hoặc xoá tài khoản, bộ lọc lúc ĐỌC vẫn chặn họ
    // — còn âm thầm bỏ người ra khỏi bản sao sẽ làm người dùng tưởng đã sao
    // chép đủ.
    const row = await this.prisma.circle.create({
      data: {
        ownerId,
        name: input.name,
        rank: input.rank ?? null,
        isAdHoc: false,
        memberHash: null,
        members: { create: source.members.map((m) => ({ userId: m.userId })) },
      },
      include: { members: { select: { userId: true } } },
    });
    return this._shapeOne(row as CircleRow);
  }

  // ─── Ghi: thành viên ───────────────────────────────────────────────────────

  async addMembers(ownerId: string, input: CircleMembersInput): Promise<Circle> {
    const row = await this._ownedCircleOrThrow(input.circleId, ownerId);
    this._assertNotAdHoc(row);

    const existing = new Set(row.members.map((m) => m.userId));
    const incoming = [...new Set(input.userIds)];
    const fresh = incoming.filter((id) => !existing.has(id));

    // Thêm người đã có mặt KHÔNG phải lỗi — chỉ là không có việc gì để làm.
    // Màn quản lý tick cả danh sách rồi bấm một lần; bắt nó phải biết trước ai
    // đã ở trong vòng là đẩy state của server sang client.
    if (fresh.length === 0) return this._shapeOne(row);

    this._assertMemberCount(existing.size, fresh.length);
    await this._assertUsersAddable(ownerId, fresh);

    await this.prisma.circleMember.createMany({
      data: fresh.map((userId) => ({ circleId: row.id, userId })),
      skipDuplicates: true,
    });

    return this.getCircle(ownerId, row.id);
  }

  /**
   * Bớt một người khỏi vòng — XH-QĐ-3 nằm ở đây.
   *
   * Chỉ một dòng `deleteMany`. KHÔNG thông báo, KHÔNG bản ghi lịch sử, KHÔNG
   * dọn `SavedPin` mà người đó đã lưu: pin biến mất khỏi board của họ vì bộ lọc
   * lúc đọc, và nếu họ được thêm lại thì pin hiện lại đúng chỗ cũ. Dọn
   * `SavedPin` ở đây sẽ biến một thao tác hồi tố thành một thao tác PHÁ DỮ
   * LIỆU của người khác.
   *
   * Bớt người vốn không ở trong vòng: không lỗi. Cùng hình dạng với `unfollow`
   * (P2025 ⇒ im lặng) — thao tác này mô tả TRẠNG THÁI MONG MUỐN, không phải
   * một sự kiện phải xảy ra đúng một lần.
   */
  async removeMember(ownerId: string, circleId: string, userId: string): Promise<Circle> {
    const row = await this._ownedCircleOrThrow(circleId, ownerId);
    this._assertNotAdHoc(row);

    await this.prisma.circleMember.deleteMany({ where: { circleId: row.id, userId } });
    return this.getCircle(ownerId, row.id);
  }

  // ─── Ghi: vòng ad-hoc (XH-QĐ-5) ────────────────────────────────────────────

  /**
   * Khán giả chọn tại chỗ: TÌM-HOẶC-TẠO theo `memberHash`.
   *
   * Đây là hàm mà đường ghi pin (luồng A) gọi khi người dùng chọn người ngay
   * trong màn tạo pin, và cũng là cửa duy nhất sinh ra `isAdHoc = true`.
   *
   * Tìm-trước-tạo-sau chứ không `upsert`: `upsert` cần khoá duy nhất đầy đủ và
   * sẽ ghi đè, mà ở đây nhánh "đã có" phải TRẢ VỀ NGUYÊN TRẠNG — vòng cũ có thể
   * đang là khán giả của hàng chục pin.
   *
   * Trần 20 vòng chỉ tính khi PHẢI TẠO MỚI. Tái dùng không tiêu tốn hạn mức —
   * nếu không thì `memberHash` mất một nửa lý do tồn tại.
   */
  async createAdHocCircle(ownerId: string, input: CreateAdHocCircleInput): Promise<Circle> {
    const userIds = [...new Set(input.userIds)];
    await this._assertUsersAddable(ownerId, userIds);

    const memberHash = computeMemberHash(userIds);
    const found = await this.prisma.circle.findFirst({
      where: { ownerId, memberHash },
      include: { members: { select: { userId: true } } },
    });
    if (found) return this._shapeOne(found as CircleRow);

    this._assertMemberCount(0, userIds.length);
    await this._assertCircleQuota(ownerId);

    const row = await this.prisma.circle.create({
      data: {
        ownerId,
        name: AD_HOC_CIRCLE_NAME,
        rank: null,
        isAdHoc: true,
        memberHash,
        members: { create: userIds.map((userId) => ({ userId })) },
      },
      include: { members: { select: { userId: true } } },
    });
    return this._shapeOne(row as CircleRow);
  }

  /** "Lưu vòng tròn này": đặt tên + bỏ cờ ad-hoc + xoá `memberHash`. */
  async saveAdHocCircle(ownerId: string, input: SaveAdHocCircleInput): Promise<Circle> {
    const row = await this._ownedCircleOrThrow(input.circleId, ownerId);
    if (!row.isAdHoc) {
      throw new BadRequestException('This circle is already saved.');
    }

    const row2 = await this.prisma.circle.update({
      where: { id: row.id },
      data: {
        name: input.name,
        rank: input.rank ?? null,
        isAdHoc: false,
        // Xoá hash: xem docblock của SaveAdHocCircleInput.
        memberHash: null,
      },
      include: { members: { select: { userId: true } } },
    });
    return this._shapeOne(row2 as CircleRow);
  }

  // ─── Gợi ý thành viên ──────────────────────────────────────────────────────

  /**
   * Gợi ý người để thêm vào vòng — tái dùng xếp hạng bạn-của-bạn của
   * `suggestedUsers` (xahoi-tinh-nang.md §2), KHÔNG phải gọi thẳng nó.
   *
   * ⚠️ VÌ SAO KHÔNG GỌI THẲNG `getSuggestedUsers`: hàm đó loại bỏ **người tôi
   * đang theo dõi** — hợp lý cho khối "gợi ý người theo dõi", nhưng ngược hoàn
   * toàn ở đây. Ứng viên tự nhiên nhất của một vòng bạn thân chính là người tôi
   * đã theo dõi. Dùng lại nguyên si sẽ cho ra một danh sách toàn người lạ, và
   * nó sẽ "chạy" mà chẳng ai thấy sai.
   *
   * Ba tầng, cắt khi đủ `limit`:
   *   1. Người tôi theo dõi, xếp theo số bạn-của-bạn (đúng phép groupBy của
   *      `getSuggestedUsers`, chỉ khác bộ loại trừ) — thân nhất lên trước.
   *   2. Người tôi theo dõi còn lại, mới theo dõi trước.
   *   3. `socialService.getSuggestedUsers` — bạn-của-bạn NGOÀI tập tôi theo dõi.
   *      Tầng này bổ sung chứ không chồng lấn: nó loại sẵn người tôi đã follow.
   *
   * Loại trừ ở mọi tầng: chính mình · thành viên hiện có của vòng · người bị
   * chặn HAI CHIỀU (`getBlockedUserIds`) — gợi ý một người mà bộ lọc chặn sẽ
   * ném đi là gợi ý một thành viên chết.
   */
  async getMemberSuggestions(
    ownerId: string,
    circleId: string | null | undefined,
    limit: number,
  ) {
    const memberIds = circleId
      ? (await this._ownedCircleOrThrow(circleId, ownerId)).members.map((m) => m.userId)
      : [];

    const [follows, blockedIds] = await Promise.all([
      this.prisma.follows.findMany({
        where: { followerId: ownerId },
        select: { followingId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      getBlockedUserIds(this.prisma, ownerId),
    ]);
    const followingIds = follows.map((f) => f.followingId);
    const excluded = new Set<string>([ownerId, ...memberIds, ...blockedIds]);

    /** Id đã chốt, GIỮ nguyên thứ tự xếp hạng. */
    const picked: string[] = [];
    const take = (ids: string[]) => {
      for (const id of ids) {
        if (picked.length >= limit) return;
        if (excluded.has(id)) continue;
        excluded.add(id); // chống trùng giữa 3 tầng
        picked.push(id);
      }
    };

    // ── Tầng 1: bạn-của-bạn, giới hạn trong tập tôi theo dõi ────────────────
    if (followingIds.length > 0 && picked.length < limit) {
      const rows = await this.prisma.follows.groupBy({
        by: ['followingId'],
        where: {
          followerId: { in: followingIds },
          followingId: { in: followingIds, notIn: [...excluded] },
        },
        _count: { followingId: true },
        orderBy: { _count: { followingId: 'desc' } },
        take: limit,
      });
      take(rows.map((r) => r.followingId));
    }

    // ── Tầng 2: phần còn lại của danh sách đang theo dõi ────────────────────
    if (picked.length < limit) take(followingIds);

    // ── Tầng 3: bạn-của-bạn ngoài tập đang theo dõi ─────────────────────────
    if (picked.length < limit) {
      const extra = await this.socialService.getSuggestedUsers(ownerId, limit);
      take(extra.map((u: { id: string }) => u.id));
    }

    // Nạp User một lần, giữ đúng thứ tự đã xếp. `findMany` đi qua middleware
    // soft-delete nên tài khoản đã xoá rụng tại đây — cả ba tầng trên đều làm
    // việc trên ID nên không tầng nào tự lọc được điều đó.
    return this._loadUsersInOrder(picked);
  }

  // ─── Nội bộ ────────────────────────────────────────────────────────────────

  /**
   * CỬA DUY NHẤT đi vào một vòng. Không sở hữu ⇒ 404, cùng thông điệp với "id
   * không tồn tại" để không phân biệt được hai trường hợp (luật 1).
   */
  private async _ownedCircleOrThrow(circleId: string, ownerId: string): Promise<CircleRow> {
    const row = await this.prisma.circle.findFirst({
      where: { id: circleId, ownerId },
      include: { members: { select: { userId: true } } },
    });
    if (!row) throw new NotFoundException('Circle not found');
    return row as CircleRow;
  }

  /**
   * Vòng ad-hoc KHÔNG sửa được (tên/rank/thành viên) khi chưa lưu.
   *
   * Không phải luật cho có: `memberHash` chỉ đúng khi tập thành viên đứng yên,
   * mà `@@unique([ownerId, memberHash])` thì sẽ nổ P2002 nếu tính lại hash và
   * trúng một vòng ad-hoc khác. Chốt cửa ở đây rẻ hơn nhiều so với xử lý va
   * chạm hash, và cũng đúng với giao diện: vòng ad-hoc ẩn khỏi màn quản lý nên
   * không có nút nào để sửa. Muốn sửa thì `saveAdHocCircle` trước — thao tác đó
   * xoá hash, và từ đó vòng thành vòng thường.
   */
  private _assertNotAdHoc(row: CircleRow) {
    if (row.isAdHoc) {
      throw new BadRequestException(
        'This is an ad-hoc audience. Save it with a name first, then edit it.',
      );
    }
  }

  /** Trần 20 vòng/người — ĐẾM CẢ AD-HOC (XH-QĐ-13). */
  private async _assertCircleQuota(ownerId: string) {
    // `Circle` không có soft-delete nên `count` ở đây không dính bẫy
    // "count không đi qua middleware Prisma" (PLAN_XAHOI.md §3 bẫy 2).
    const count = await this.prisma.circle.count({ where: { ownerId } });
    if (count >= MAX_CIRCLES_PER_USER) {
      throw new BadRequestException(
        `You can only have up to ${MAX_CIRCLES_PER_USER} circles (ad-hoc audiences included).`,
      );
    }
  }

  /** Trần 50 thành viên/vòng — kiểm trên TỔNG SAU KHI THÊM, không phải trên lô. */
  private _assertMemberCount(current: number, adding: number) {
    if (current + adding > MAX_MEMBERS_PER_CIRCLE) {
      throw new BadRequestException(
        `A circle can hold up to ${MAX_MEMBERS_PER_CIRCLE} members.`,
      );
    }
  }

  /**
   * Ba điều kiện để một người được thêm vào vòng của tôi.
   *
   * (a) KHÔNG PHẢI CHÍNH TÔI. Vòng là danh sách khán giả của chủ vòng; chủ luôn
   *     thấy pin của mình rồi. Cho tự thêm là để lại một dòng vô nghĩa ăn vào
   *     trần 50 và làm số thành viên hiển thị sai một đơn vị.
   * (b) NGƯỜI CÓ THẬT. Thiếu bước này thì id rác nổ P2003 (foreign key) thành
   *     500 — đúng hình dạng lỗi mà bước 72 đã bắt ở đường DM đính kèm pin.
   * (c) KHÔNG BỊ CHẶN, hai chiều. Cùng tiền lệ `SocialService.follow`. Người bị
   *     chặn sẽ bị bộ lọc chặn ném đi lúc đọc feed, nên thêm họ vào vòng chỉ
   *     tạo ra một thành viên không bao giờ thấy gì.
   *
   * ⚠️ KHÔNG yêu cầu hai bên phải follow nhau: XH-QĐ-1 chốt vòng tròn MỘT CHIỀU
   * — chủ tự lập danh sách, không cần đối phương đồng ý.
   */
  private async _assertUsersAddable(ownerId: string, userIds: string[]) {
    if (userIds.length === 0) return;

    if (userIds.includes(ownerId)) {
      throw new BadRequestException(
        'You are always the owner of your circle; do not add yourself.',
      );
    }

    const found = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    if (found.length !== userIds.length) {
      const missing = userIds.filter((id) => !found.some((u) => u.id === id));
      throw new BadRequestException(`Unknown userId: ${missing.slice(0, 5).join(', ')}`);
    }

    const blockedIds = await getBlockedUserIds(this.prisma, ownerId);
    const blocked = userIds.filter((id) => blockedIds.includes(id));
    if (blocked.length > 0) {
      throw new BadRequestException('Cannot add a blocked user to a circle.');
    }
  }

  /**
   * Nạp `User` theo đúng thứ tự `ids` và CẮT email.
   *
   * Email bị cắt vì danh sách này trả người KHÁC cho chủ vòng xem: `User.email`
   * chỉ được hiện cho chính chủ tài khoản (users.resolver.ts), còn Prisma thì
   * trả nguyên cột. Trả thẳng row của Prisma ra GraphQL là rò email — không
   * phải giả thiết, đó là đúng lý do `users.resolver` phải set null bằng tay.
   */
  private async _loadUsersInOrder(ids: string[]) {
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const ordered: any[] = [];
    for (const id of ids) {
      const u = byId.get(id);
      if (u) ordered.push({ ...u, email: null });
    }
    return ordered;
  }

  private async _shapeOne(row: CircleRow): Promise<Circle> {
    return (await this._shapeMany([row]))[0];
  }

  /**
   * Dòng Prisma → entity GraphQL, nạp thành viên cho CẢ LÔ bằng MỘT query.
   *
   * Cố ý không dùng `include: { members: { include: { user: true } } }`: quan hệ
   * lồng trong `include` KHÔNG đi qua middleware soft-delete (middleware bắt
   * theo `params.model` + `findMany`/`findFirst` của truy vấn GỐC), nên tài
   * khoản đã xoá vẫn hiện ra như thành viên. Gom id rồi `user.findMany` một
   * lần thì middleware chạy, và vẫn chỉ tốn đúng một query cho cả danh sách.
   *
   * ⚠️ `memberCount` đếm THÀNH VIÊN CÒN SỐNG (sau lọc soft-delete), trong khi
   * trần 50 đếm dòng `CircleMember`. Hai con số lệch nhau đúng bằng số tài
   * khoản đã xoá trong vòng — chấp nhận có ý thức: chỗ hiển thị phải khớp thứ
   * người dùng NHÌN THẤY, còn hạn mức phải khớp thứ database GIỮ.
   */
  private async _shapeMany(rows: CircleRow[]): Promise<Circle[]> {
    const allIds = [...new Set(rows.flatMap((r) => r.members.map((m) => m.userId)))];
    const users =
      allIds.length > 0
        ? await this.prisma.user.findMany({ where: { id: { in: allIds } } })
        : [];
    const byId = new Map(users.map((u) => [u.id, { ...u, email: null } as any]));

    return rows.map((r) => {
      const members = r.members.map((m) => byId.get(m.userId)).filter(Boolean);
      return {
        id: r.id,
        ownerId: r.ownerId,
        name: r.name,
        rank: r.rank,
        isAdHoc: r.isAdHoc,
        members,
        memberCount: members.length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      } as Circle;
    });
  }
}
