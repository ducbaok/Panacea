// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  PinsService                                                             ║
// ║  Business logic cho Pin: CRUD + cursor-based pagination.                ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Inject PrismaService.                                               ║
// ║  2. createPin(userId, input): prisma.pin.create + trả về pin.           ║
// ║  3. updatePin(userId, input): kiểm tra owner → prisma.pin.update.      ║
// ║  4. deletePin(userId, pinId): soft delete (set deletedAt).              ║
// ║  5. findById(pinId): prisma.pin.findUnique (kiểm tra deletedAt).       ║
// ║  6. exploreFeed(first, after):                                          ║
// ║     - Dùng RAW SQL composite cursor (createdAt DESC, id DESC)           ║
// ║     - LIMIT = first + 1 → hasNextPage = rows > first                   ║
// ║     - decodeCursor(after) nếu có → WHERE clause                         ║
// ║     - encodeCursor(lastItem) → endCursor                                ║
// ║  7. userPins(creatorId, first, after): tương tự exploreFeed             ║
// ║     nhưng thêm WHERE creatorId = $userId                                ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, ReactionType } from '@antigravity/database';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePinInput } from './dto/create-pin.input';
import { UpdatePinInput } from './dto/update-pin.input';
import { normalizeTagNames, dedupeCategoryIds } from './tag-name.util';
import {
  CursorPaginationArgs,
  decodeCursor,
  encodeCursor,
  PageInfo,
  CREATED_DESC,
  keysetPage,
} from '../common/pagination';
import { FeedSource } from './entities/home-feed.entity';

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

@Injectable()
export class PinsService {
  private readonly logger = new Logger(PinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Taxonomy (Đợt 6) ────────────────────────────────────────────────────────

  /**
   * Chuẩn bị hai quan hệ m2m cho `createPin`/`updatePin`: chuẩn hoá đầu vào,
   * tạo trước những Tag chưa tồn tại, và khẳng định mọi categoryId là có thật.
   *
   * TRẢ VỀ `undefined` cho field client KHÔNG gửi — bên gọi dựa vào đúng dấu
   * hiệu đó để phân biệt "không đụng" với "xoá hết". Xem quy ước ba trạng thái
   * ở `update-pin.input.ts`.
   *
   * ⚠️ VÌ SAO KHÔNG DÙNG `connectOrCreate` CHO TAG — chống race P2002:
   * `connectOrCreate` đọc rồi mới ghi, nên hai request cùng gửi tag `design`
   * trong cùng mili giây đều thấy "chưa tồn tại" và cùng `INSERT` ⇒ một trong
   * hai vỡ `Tag_name_key` và trả 500 cho một người dùng chẳng làm gì sai.
   * `createMany({ skipDuplicates: true })` đẩy phép khử trùng xuống chính DB,
   * biến cuộc đua thành no-op: kẻ thua đơn giản là không chèn gì. Sau đó
   * `connect` theo `name` luôn tìm thấy bản ghi, bất kể ai thắng.
   */
  private async prepareTaxonomy(input: { tagNames?: string[]; categoryIds?: string[] }) {
    const tagNames = normalizeTagNames(input.tagNames);
    const categoryIds = dedupeCategoryIds(input.categoryIds);

    if (tagNames?.length) {
      await this.prisma.tag.createMany({
        data: tagNames.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }

    // Kiểm tra category tồn tại TRƯỚC khi ghi, chứ không chỉ dựa vào P2025.
    // Lý do là thông điệp lỗi: P2025 của Prisma chỉ nói "một bản ghi cần thiết
    // không tìm thấy" — không nói id nào, cũng không nói là category hay tag.
    // Với client thì đó là 400 vô nghĩa. Một câu SELECT đổi lấy một thông điệp
    // chỉ đúng thủ phạm là đánh đổi đáng, vì đây là mutation chứ không phải
    // đường đọc feed. P2025 vẫn được bắt ở dưới làm lưới an toàn cho khe hở
    // giữa lúc kiểm và lúc ghi.
    if (categoryIds?.length) {
      const found = await this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const unknown = categoryIds.filter((id) => !foundIds.has(id));
      if (unknown.length) {
        throw new BadRequestException(`Unknown categoryId: ${unknown.join(', ')}`);
      }
    }

    return { tagNames, categoryIds };
  }

  /**
   * Dịch P2025 (bản ghi cần cho `connect`/`set` không tồn tại) thành 400.
   *
   * Không có hàm này thì id category rác cho ra HTTP 200 kèm một lỗi runtime
   * của Prisma — đúng hình dạng đã bị bắt ở Đợt 3d với `togglePinReaction`:
   * lỗi của người dùng bị báo cáo như sự cố của server, và bảng theo dõi lỗi
   * đầy những thứ không ai sửa được.
   */
  private rethrowTaxonomyError(e: any): never {
    if (e?.code === 'P2025') {
      throw new BadRequestException(
        'Unknown categoryId or tag — one of the records to connect no longer exists',
      );
    }
    throw e;
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  /**
   * Tạo pin mới.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Validate imageUrl: Chỉ cho phép các domain tin cậy (như localhost, s3.amazonaws.com). Nếu không hợp lệ -> ném BadRequestException.
   * 2. Kiểm tra giới hạn 20 pins/ngày cho user này (prisma.pin.count với filter createdAt >= đầu ngày). Nếu >= 20 -> ném ForbiddenException.
   * 3. prisma.pin.create({ data: { imageUrl, imageWidth, imageHeight, title, description, sourceUrl, creatorId: userId } }).
   * 4. imageUrl ở đây là S3 key (raw/...), sẽ được Lambda xử lý sau.
   * 5. Return pin vừa tạo.
   */
  async createPin(userId: string, input: CreatePinInput) {
    // 1. Validate imageUrl domain
    const whitelist = ['localhost', 's3.amazonaws.com', 'storage.googleapis.com', 'res.cloudinary.com'];
    try {
      const url = new URL(input.imageUrl);
      if (!whitelist.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) {
        throw new BadRequestException('Image URL domain is not allowed');
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('Invalid image URL');
    }

    // 2. Check limit 20 pins/day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // ⚠️ `deletedAt: null` PHẢI khai tường minh ở đây.
    // Middleware soft-delete (prisma.service.ts:53) chỉ intercept `findMany` +
    // `findFirst` — `count` KHÔNG nằm trong danh sách đó. Thiếu dòng này thì pin
    // đã xoá mềm vẫn bị tính vào trần ngày, tức tạo rồi xoá 20 pin là khoá hết
    // ngày. Đo được 11/08/2026: alice có 0 pin sống của hôm nay mà vẫn bị chặn.
    const todayPinsCount = await this.prisma.pin.count({
      where: {
        creatorId: userId,
        createdAt: { gte: startOfDay },
        deletedAt: null
      }
    });

    if (todayPinsCount >= 20) {
      throw new ForbiddenException('Daily pin limit exceeded (20/day)');
    }

    // 3. Taxonomy (Đợt 6) — chuẩn hoá tag, tạo trước Tag mới, kiểm category có
    //    thật. Chạy SAU phép kiểm trần vì không có lý do gì tạo Tag mới cho một
    //    request sắp bị từ chối.
    const { tagNames, categoryIds } = await this.prepareTaxonomy(input);

    try {
      return await this.prisma.pin.create({
        data: {
          imageUrl: input.imageUrl,
          imageWidth: input.imageWidth,
          imageHeight: input.imageHeight,
          title: input.title,
          description: input.description,
          sourceUrl: input.sourceUrl,
          creatorId: userId,
          // Trải có điều kiện, KHÔNG viết `tags: { connect: [] }` khi rỗng:
          // với `create` thì hai cách tương đương, nhưng giữ cùng một hình dạng
          // với `updatePin` (nơi khác biệt là thật) làm hai hàm đọc song song
          // được mà không phải nhớ ngoại lệ.
          ...(tagNames?.length ? { tags: { connect: tagNames.map((name) => ({ name })) } } : {}),
          ...(categoryIds?.length ? { categories: { connect: categoryIds.map((id) => ({ id })) } } : {}),
        },
      });
    } catch (e) {
      this.rethrowTaxonomyError(e);
    }
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  /**
   * Cập nhật pin (chỉ owner mới được sửa).
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Dùng findFirst (KHÔNG dùng findUnique) vì Prisma middleware
   *    không intercept findUnique cho soft delete.
   * 2. Middleware tự động thêm deletedAt: null, nhưng code vẫn check pin.deletedAt
   *    như belt-and-suspenders.
   * 3. Check pin.creatorId === userId (only owner can edit).
   * 4. prisma.pin.update({ where: { id }, data: { title, description, sourceUrl } }).
   *
   * ⚠️ QUY ƯỚC BA TRẠNG THÁI cho `tagNames`/`categoryIds` (Đợt 6) — đọc kỹ,
   * đây là loại nhập nhằng gây bug thầm lặng:
   *
   *     undefined      ⇒ KHÔNG ĐỤNG tới quan hệ hiện có
   *     []             ⇒ XOÁ HẾT
   *     ['a','b']      ⇒ THAY THẾ TOÀN BỘ bằng đúng danh sách này
   *
   * `set` của Prisma làm đúng ngữ nghĩa "thay thế toàn bộ" cho cả `[]` lẫn danh
   * sách khác rỗng. Thứ phải tự lo là trạng thái THỨ BA: `undefined` phải làm
   * cho khoá `tags` KHÔNG XUẤT HIỆN trong `data`. Viết `tags: { set: [] }` khi
   * client không gửi field sẽ xoá sạch tag của họ mỗi lần họ sửa mỗi tiêu đề —
   * không lỗi, không cảnh báo, chỉ mất dữ liệu.
   */
  async updatePin(userId: string, input: UpdatePinInput) {
    const pin = await this.prisma.pin.findFirst({
      where: { id: input.id },
    });

    if (!pin || pin.deletedAt) {
      throw new NotFoundException('Pin not found');
    }

    if (pin.creatorId !== userId) {
      throw new ForbiddenException('You can only edit your own pins');
    }

    const { tagNames, categoryIds } = await this.prepareTaxonomy(input);

    try {
      return await this.prisma.pin.update({
        where: { id: input.id },
        data: {
          title: input.title,
          description: input.description,
          sourceUrl: input.sourceUrl,
          // `!== undefined` chứ KHÔNG phải `?.length` — đây chính là chỗ tách
          // "xoá hết" (`[]`, phải chạy `set: []`) khỏi "không đụng"
          // (`undefined`, phải bỏ hẳn khoá). `?.length` gộp cả hai thành "bỏ
          // qua" và trạng thái `[]` sẽ im lặng không làm gì.
          ...(tagNames !== undefined ? { tags: { set: tagNames.map((name) => ({ name })) } } : {}),
          ...(categoryIds !== undefined
            ? { categories: { set: categoryIds.map((id) => ({ id })) } }
            : {}),
        },
      });
    } catch (e) {
      this.rethrowTaxonomyError(e);
    }
  }

  // ─── Soft Delete ─────────────────────────────────────────────────────────────

  /**
   * Soft delete pin (chỉ owner mới được xóa).
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Dùng findFirst + check deletedAt (tương tự updatePin).
   * 2. Check ownership: pin.creatorId === userId.
   * 3. Soft delete: prisma.pin.update({ data: { deletedAt: new Date() } }).
   *    KHÔNG xóa thật record khỏi DB.
   */
  async deletePin(userId: string, pinId: string) {
    const pin = await this.prisma.pin.findFirst({
      where: { id: pinId },
    });

    if (!pin || pin.deletedAt) {
      throw new NotFoundException('Pin not found');
    }

    if (pin.creatorId !== userId) {
      throw new ForbiddenException('You can only delete your own pins');
    }

    return this.prisma.pin.update({
      where: { id: pinId },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Find by ID ─────────────────────────────────────────────────────────────

  /**
   * Tìm pin theo ID.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Dùng findFirst (middleware tự thêm deletedAt: null).
   * 2. Vẫn check pin.deletedAt thủ công như layer bảo vệ thêm.
   * 3. Ném NotFoundException nếu không thấy.
   *
   * Đợt 3e — pin của người bị chặn ném ĐÚNG `NotFoundException` như pin đã xoá,
   * và đó là chủ đích: lọc khỏi feed mà vẫn cho đọc qua link trực tiếp thì bộ
   * lọc chỉ là trang trí. Dùng 404 (không phải 403) vì 403 tự nó đã tiết lộ
   * rằng pin có tồn tại.
   */
  async findById(pinId: string, blockedIds: string[]) {
    const pin = await this.prisma.pin.findFirst({
      where: { id: pinId },
    });

    if (!pin || pin.deletedAt || blockedIds.includes(pin.creatorId)) {
      throw new NotFoundException('Pin not found');
    }

    return pin;
  }

  // ─── Reactions ──────────────────────────────────────────────────────────────

  /**
   * Toggle reaction trên pin.
   * HƯỚNG DẪN CODE LẠI:
   * 1. Kiểm tra pin tồn tại.
   * 2. Tìm reaction cũ của user trên pin này.
   * 3. Nếu có và type giống nhau -> Xóa (Bỏ react).
   * 4. Nếu có và type khác nhau -> Update type mới.
   * 5. Nếu chưa có -> Tạo mới và gửi Notification.
   */
  async toggleReaction(userId: string, pinId: string, type: ReactionType) {
    const pin = await this.prisma.pin.findFirst({ where: { id: pinId } });
    if (!pin || pin.deletedAt) throw new NotFoundException('Pin not found');

    const existingReaction = await this.prisma.reaction.findUnique({
      where: { userId_pinId: { userId, pinId } },
    });

    if (existingReaction) {
      if (existingReaction.type === type) {
        await this.prisma.reaction.delete({ where: { id: existingReaction.id } });
        return { success: true, status: 'REMOVED' };
      } else {
        await this.prisma.reaction.update({
          where: { id: existingReaction.id },
          data: { type },
        });
        return { success: true, status: 'UPDATED' };
      }
    } else {
      await this.prisma.reaction.create({
        data: { userId, pinId, type },
      });

      // --- PHASE 2.5: Gửi thông báo REACTION cho chủ nhân pin ---
      await this.notificationsService.createNotification({
        type: NotificationType.REACTION,
        actorId: userId,
        recipientId: pin.creatorId,
        pinId,
      });

      return { success: true, status: 'ADDED' };
    }
  }

  // ─── Explore Feed (Public) ───────────────────────────────────────────────────

  /**
   * Explore Feed — tất cả pins mới nhất, dùng raw SQL composite cursor.
   *
   * SQL Pattern (từ PLAN.md):
   * ```sql
   * SELECT * FROM "Pin"
   * WHERE "deletedAt" IS NULL
   *   AND ("createdAt", "id") < ($lastCreatedAt, $lastId)   -- nếu có cursor
   * ORDER BY "createdAt" DESC, "id" DESC
   * LIMIT first + 1;
   * ```
   *
   * take+1 strategy: lấy thêm 1 item, nếu có → hasNextPage = true
   */
  async exploreFeed(
    pagination: CursorPaginationArgs,
    blockedIds: string[],
    filters?: { categorySlug?: string; tagName?: string },
  ): Promise<PaginatedResult<any>> {
    const { first, after } = pagination;
    const take = first + 1; // lấy thêm 1 để check hasNextPage

    const q = this._sqlParams();
    const where = ['"deletedAt" IS NULL'];

    if (after) {
      // Decode cursor → lấy createdAt và id để WHERE
      const cursor = decodeCursor(after);
      where.push(
        `("createdAt", "id") < (${q.bind(cursor.createdAt)}::timestamp, ${q.bind(cursor.id)}::text)`,
      );
    }

    const notInBlocked = this._notInBlocked(q, blockedIds);
    if (notInBlocked) where.push(notInBlocked);

    // ─── B-5: lọc theo category slug và tag name ─────────────────────────────
    //
    // Dùng `EXISTS` thay vì `JOIN`: một pin có nhiều category/tag, `JOIN` sẽ
    // nhân bản dòng `Pin` theo số cạnh khớp và làm HỎNG cả `LIMIT + 1` (nền tảng
    // của keyset) LẪN cursor sinh ra ở trang sau. `EXISTS` chỉ hỏi "có tồn tại
    // một cạnh không" nên số dòng `Pin` không đổi.
    //
    // ⚠️ CỘT `A`/`B` NGƯỢC CHIỀU NHAU giữa hai bảng nối (migration.sql:507-522).
    // Prisma đặt A/B theo THỨ TỰ CHỮ CÁI CỦA TÊN MODEL, không theo tên relation:
    //   `_PinToCategory`: A=`Category.id`, B=`Pin.id`    ⇒ pin ở cột B
    //   `_PinToTag`:      A=`Pin.id`,      B=`Tag.id`     ⇒ pin ở cột A
    // Đoán nhầm KHÔNG có lỗi cú pháp: câu SQL vẫn chạy và trả sai — không có
    // exception nào ném ra. Đó là lý do phép "hai nhánh trong CÙNG một response"
    // và đối chứng âm ở `10-pins.mjs` là bắt buộc.
    //
    // Không cần index mới: `_PinToCategory_AB_unique(A,B)` dẫn đầu bằng
    // `A`=Category đã phục vụ tra theo category; `_PinToTag_B_index(B)` đã phục
    // vụ tra theo tag.
    if (filters?.categorySlug) {
      where.push(
        `EXISTS (
           SELECT 1 FROM "_PinToCategory" pc
                      JOIN "Category" c ON c."id" = pc."A"
            WHERE pc."B" = "Pin"."id"
              AND c."slug" = ${q.bind(filters.categorySlug)}
         )`,
      );
    }
    if (filters?.tagName) {
      where.push(
        `EXISTS (
           SELECT 1 FROM "_PinToTag" pt
                      JOIN "Tag" t ON t."id" = pt."B"
            WHERE pt."A" = "Pin"."id"
              AND t."name" = ${q.bind(filters.tagName)}
         )`,
      );
    }

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Pin"
         WHERE ${where.join('\n           AND ')}
         ORDER BY "createdAt" DESC, "id" DESC
         LIMIT ${q.bind(take)}`,
      ...q.values,
    );

    return this._buildPaginatedResult(rows, first);
  }

  // ─── Home Feed (yêu cầu đăng nhập) ───────────────────────────────────────────

  /**
   * Home Feed v1 — pin của những người viewer đang follow, rơi về explore khi
   * viewer chưa follow ai.
   *
   * ```sql
   * SELECT p.* FROM "Pin" p
   * INNER JOIN "Follows" f ON f."followingId" = p."creatorId" AND f."followerId" = $1
   * WHERE p."deletedAt" IS NULL
   *   [AND p."creatorId" NOT IN (…)]                              -- chỉ khi có blocked
   *   [AND (p."createdAt", p."id") < ($n::timestamp, $m::text)]   -- chỉ khi có cursor
   * ORDER BY p."createdAt" DESC, p."id" DESC
   * LIMIT $last
   * ```
   *
   * ⚠️ BA QUYẾT ĐỊNH DƯỚI ĐÂY LÀ HÌNH DẠNG CỦA HÀM, KHÔNG PHẢI CHI TIẾT:
   *
   * **1. Chọn nhánh bằng `followingCount`, KHÔNG bao giờ bằng cursor và cũng
   * không bằng "trang này rỗng".** Cursor sinh từ nhánh FOLLOWING *kỹ thuật vẫn
   * hợp lệ* với nhánh EXPLORE — cùng bảng `Pin`, cùng khoá `(createdAt, id)` —
   * nên đổi nhánh giữa chừng KHÔNG ném lỗi nào cả: nó chỉ lặng lẽ nhảy cóc mất
   * pin, `tsc` xanh, HTTP 200, dữ liệu trông hợp lý. Đây là lý do điều kiện
   * fallback phải là TRẠNG THÁI NGƯỜI DÙNG (đã follow ai chưa) chứ không phải
   * trạng thái của trang: luật "nhánh follow trả 0 item thì rơi sang explore"
   * làm người cuộn tới cuối feed follow bỗng nhiên thấy explore chèn vào — với
   * một cursor thuộc nhánh sai.
   *
   * **2. Đếm bằng `prisma.follows.count` chứ KHÔNG dùng `followingCountLoader`
   * của `DataloaderService`.** Loader đó có sẵn và batch tốt hơn, nhưng
   * `DataloaderService` là `Scope.REQUEST`; NestJS truyền scope NGƯỢC LÊN mọi
   * thứ inject nó, nên `PinsService` (singleton) sẽ kéo theo cả `PinsController`
   * — endpoint callback của Lambda — thành request-scoped. Biên dịch sạch, chỉ
   * đổi vòng đời. Đúng cái bẫy Đợt 3e đã né bằng cách để memo ở resolver.
   *
   * **3. Fallback nằm ở service, không ở resolver.** Chọn nguồn feed là quyết
   * định nghiệp vụ; resolver không cần biết `exploreFeed` tồn tại.
   */
  async homeFeed(
    viewerId: string,
    pagination: CursorPaginationArgs,
    blockedIds: string[],
    forcedSource?: FeedSource,
  ): Promise<PaginatedResult<any> & { source: FeedSource }> {
    // ── Chọn nguồn ────────────────────────────────────────────────────────────
    // `forcedSource` có giá trị (§6b.1 / QĐ-1): client ÉP nguồn ⇒ tôn trọng tuyệt
    // đối, KHÔNG fallback. Ép FOLLOWING khi follow 0 người ⇒ nhánh raw SQL bên
    // dưới INNER JOIN "Follows" khớp 0 dòng ⇒ trả RỖNG kèm source=FOLLOWING —
    // đúng thứ card rỗng B1 cần, và là lý do KHÔNG đụng followingCount ở nhánh này.
    //
    // `forcedSource` bỏ trống ⇒ hành vi cũ: suy nhánh từ followingCount, có
    // fallback. Vẫn giữ quyết định #1 ở docblock — chọn nhánh bằng TRẠNG THÁI
    // NGƯỜI DÙNG (đã follow ai chưa), không bằng cursor hay "trang này rỗng".
    let source: FeedSource;
    if (forcedSource) {
      source = forcedSource;
    } else {
      // Một query đếm cho mỗi request. `@@index([followerId])` đã có sẵn
      // (schema.prisma:165) nên đây là index-only scan, không phải seq scan.
      const followingCount = await this.prisma.follows.count({
        where: { followerId: viewerId },
      });
      source = followingCount === 0 ? FeedSource.EXPLORE : FeedSource.FOLLOWING;
    }

    if (source === FeedSource.EXPLORE) {
      const explore = await this.exploreFeed(pagination, blockedIds);
      return { ...explore, source: FeedSource.EXPLORE };
    }

    const { first, after } = pagination;
    const take = first + 1;

    const q = this._sqlParams();
    // Bind TRƯỚC vì nó nằm trong mệnh đề JOIN, tức trước `where` trong văn bản
    // SQL. (Postgres đánh số tham số theo GIÁ TRỊ chứ không theo vị trí xuất
    // hiện, nên thứ tự này chỉ để đọc cho thuận — nhưng đọc thuận là cách duy
    // nhất để soát lại một câu SQL dựng động.)
    const follower = q.bind(viewerId);

    // Mọi cột của `Pin` PHẢI có tiền tố `p.`: `Follows` cũng có `createdAt`
    // (schema.prisma:159) nên `"createdAt"` trần là "column reference is
    // ambiguous" — lỗi này nổ thẳng lúc chạy chứ không âm thầm, nhưng chỉ nổ
    // khi có cursor, tức KHÔNG phải ở trang đầu.
    const where = ['p."deletedAt" IS NULL'];

    if (after) {
      const cursor = decodeCursor(after);
      where.push(
        `(p."createdAt", p."id") < (${q.bind(cursor.createdAt)}::timestamp, ${q.bind(cursor.id)}::text)`,
      );
    }

    // Gộp lọc block. Với nhánh FOLLOWING mệnh đề này gần như luôn thừa —
    // `blockUser` đã xoá quan hệ follow cả hai chiều (social.service.ts:104) —
    // nhưng vẫn giữ vì nó rẻ (bỏ hẳn khi danh sách rỗng) và vì chuỗi
    // "A follow B → B chặn A" vẫn để lại cạnh follow nếu block đi đường khác.
    const notInBlocked = this._notInBlocked(q, blockedIds, 'p.');
    if (notInBlocked) where.push(notInBlocked);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.* FROM "Pin" p
         INNER JOIN "Follows" f
                 ON f."followingId" = p."creatorId"
                AND f."followerId" = ${follower}
         WHERE ${where.join('\n           AND ')}
         ORDER BY p."createdAt" DESC, p."id" DESC
         LIMIT ${q.bind(take)}`,
      ...q.values,
    );

    return {
      ...this._buildPaginatedResult(rows, first),
      source: FeedSource.FOLLOWING,
    };
  }

  // ─── User Pins ───────────────────────────────────────────────────────────────

  /**
   * Pins của một user cụ thể — cursor pagination tương tự.
   */
  async userPins(
    creatorId: string,
    pagination: CursorPaginationArgs,
    blockedIds: string[],
  ): Promise<PaginatedResult<any>> {
    const { first, after } = pagination;
    const take = first + 1;

    // Chính chủ nằm trong danh sách chặn ⇒ trang RỖNG, không ném lỗi. 403 sẽ
    // rò rỉ đúng thứ tính năng này che: "người này tồn tại và đã chặn bạn".
    // Trả sớm ở đây cũng tránh sinh một câu SQL chắc chắn không có kết quả.
    if (blockedIds.includes(creatorId)) {
      return this._buildPaginatedResult([], first);
    }

    const q = this._sqlParams();
    const where = ['"deletedAt" IS NULL', `"creatorId" = ${q.bind(creatorId)}`];

    if (after) {
      const cursor = decodeCursor(after);
      where.push(
        `("createdAt", "id") < (${q.bind(cursor.createdAt)}::timestamp, ${q.bind(cursor.id)}::text)`,
      );
    }

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Pin"
         WHERE ${where.join('\n           AND ')}
         ORDER BY "createdAt" DESC, "id" DESC
         LIMIT ${q.bind(take)}`,
      ...q.values,
    );

    return this._buildPaginatedResult(rows, first);
  }

  // ─── Internal: Lambda callback ───────────────────────────────────────────────

  /**
   * Được gọi bởi Lambda sau khi resize ảnh xong.
   * PATCH /internal/pins/:id/processed
   */
  async markProcessed(
    pinId: string,
    thumbnailUrl: string,
    mediumUrl: string,
    largeUrl: string,
  ) {
    return this.prisma.pin.update({
      where: { id: pinId },
      data: { thumbnailUrl, mediumUrl, largeUrl },
    });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Bộ đếm placeholder cho raw SQL — sinh `$1`, `$2`, … THEO THỨ TỰ GỌI.
   *
   * VÌ SAO CẦN (Đợt 3e): 4 câu query ở trên trước đây đánh số placeholder BẰNG
   * TAY. Thêm một mệnh đề `NOT IN` với số phần tử thay đổi theo request có
   * nghĩa là mọi số thứ tự phía sau phải dịch lại — và sai một số thì Postgres
   * hoặc báo lỗi bind, hoặc tệ hơn là bind đúng cú pháp nhưng **lọc theo nhầm
   * giá trị** rồi vẫn trả 200. Ở đây số thứ tự và giá trị luôn được sinh cùng
   * một chỗ nên hai thứ không thể lệch nhau.
   */
  private _sqlParams() {
    const values: any[] = [];
    return {
      values,
      /** Ghi nhận một giá trị, trả về placeholder tương ứng. */
      bind(v: any): string {
        values.push(v);
        return `$${values.length}`;
      },
    };
  }

  /**
   * Mệnh đề loại bỏ pin của người bị chặn, hoặc `null` nếu không cần lọc.
   *
   * ⚠️ MẢNG RỖNG PHẢI TRẢ `null`, KHÔNG ĐƯỢC SINH MỆNH ĐỀ. `NOT IN ()` là lỗi
   * cú pháp của Postgres, và mảng rỗng KHÔNG phải trường hợp biên hiếm gặp: đó
   * là đường đi của mọi khách vãng lai và của mọi người dùng chưa chặn ai —
   * tức là gần như toàn bộ lưu lượng thật.
   *
   * Dùng placeholder động `($3,$4,$5)` bind từng giá trị, cố ý KHÔNG dùng
   * `= ANY($1::text[])`: cả hai đều parameterized, nhưng bản này không phụ
   * thuộc vào cách driver Prisma serialize mảng — thứ mà `tsc` không kiểm
   * chứng được (`PLAN_P1.md` §3e).
   *
   * `prefix` — tiền tố bảng (`'p.'`) cho câu có JOIN. Mặc định rỗng vì 3 câu
   * query một-bảng ở trên không có alias; `homeFeed` truyền `'p.'`. Ở đây giá
   * trị mặc định KHÔNG tạo ra lỗi im lặng như một `blockedIds = []` sẽ tạo:
   * quên tiền tố thì hoặc Postgres báo "ambiguous", hoặc — như trường hợp
   * `creatorId` chỉ tồn tại ở `Pin` — nó vẫn phân giải đúng về cùng một cột.
   */
  private _notInBlocked(
    q: { bind: (v: any) => string },
    blockedIds: string[],
    prefix = '',
  ): string | null {
    if (blockedIds.length === 0) return null;
    return `${prefix}"creatorId" NOT IN (${blockedIds.map((id) => q.bind(id)).join(',')})`;
  }

  /**
   * Xây dựng PaginatedResult từ raw query rows.
   *
   * P1 Đợt 2 §3d — chuyển sang `keysetPage(CREATED_DESC, …)` để bỏ bản sao
   * thứ 3 của logic phân trang. Khác biệt duy nhất giữa hai bản là hình dạng
   * `endCursor` (bản cũ trả `undefined` khi rỗng, bản chung trả `null`);
   * GraphQL serialize cả hai thành `null`, client không phân biệt được.
   *
   * `CREATED_DESC.encodePart` chấp nhận cả `Date` lẫn ISO string — cần thiết
   * vì 3 hàm raw SQL (`exploreFeed`, `homeFeed`, `userPins`) trả row từ
   * `$queryRawUnsafe`, nên `row.createdAt` có thể là string thay vì Date.
   */
  private _buildPaginatedResult(
    rows: any[],
    first: number,
  ): PaginatedResult<any> {
    // Cast qua `any` vì `PageInfo.endCursor` khai `string | undefined` (mất
    // ngữ nghĩa `null` do decorator `@Field({nullable:true})` không sinh union
    // với `null`). `keysetPage` trả `string | null` — GraphQL serialize cả hai
    // thành `null`, client không phân biệt được. Ép về `any` để tsc thông,
    // hành vi runtime không đổi.
    return keysetPage(CREATED_DESC as any, rows as any, first) as any;
  }
}
