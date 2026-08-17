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
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
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
  RELATED_PINS_KEYSET,
  decodeKeysetValues,
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
    // `RedisModule` là @Global nên inject được mà không cần import module.
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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

  // ─── B-4: View / click tracking ─────────────────────────────────────────────
  //
  // ╔═══════════════════════════════════════════════════════════════════════════╗
  // ║  QUYẾT ĐỊNH ĐÃ CHỐT VỚI USER 16/08/2026 (hướng A) — đừng tự đảo:         ║
  // ║   • debounce bằng **Redis TTL theo cặp (người xem, pin)**                ║
  // ║   • "view" đếm khi **mở chi tiết pin**, KHÔNG đếm impression trên lưới   ║
  // ║   • "click" = bấm link ngoài ⇒ chỉ pin CÓ link mới có sự kiện           ║
  // ║   • khách vãng lai định danh bằng **anonId do client giữ, KHÔNG dùng IP**║
  // ║     (sau ALB mọi request chung một IP tới khi HT-3 vá `trust proxy`)     ║
  // ║                                                                          ║
  // ║  ĐÍNH CHÍNH TÊN FIELD: brief gọi là `pin.link`; trong schema nó tên      ║
  // ║  **`sourceUrl`** (`schema.prisma:216`, `String?`). Không có field `link`.║
  // ╚═══════════════════════════════════════════════════════════════════════════╝

  /**
   * TTL cửa sổ debounce — **30 phút**.
   *
   * Biên dưới của khoảng 30–60′ mà user duyệt. Chọn biên dưới vì thứ cửa sổ này
   * cần khử là **burst**: F5, back/forward, mở lại tab. Những thứ đó xảy ra
   * trong vài giây tới vài phút, nên 30′ đã trùm trọn; nới lên 60′ chỉ đánh mất
   * lượt xem thật của người quay lại sau bữa trưa. Đổi số này là đổi ngữ nghĩa
   * của `viewCount`, nên nếu đổi thì phải ghi lại mốc đổi.
   */
  private static readonly TRACK_DEBOUNCE_TTL_SEC = 30 * 60;

  /**
   * Ghi nhận một sự kiện đếm được, có khử trùng lặp.
   *
   * @returns `true` nếu lần gọi NÀY làm bộ đếm tăng; `false` nếu bị debounce
   *          hoặc không định danh được người xem.
   *
   * ⚠️ **KHÔNG ĐỊNH DANH ĐƯỢC ⇒ KHÔNG ĐẾM** (`identity` rỗng). Đây là đánh đổi
   * có chủ đích, không phải bỏ sót: quyết định A đã loại IP, nên với một request
   * không token và không `anonId` thì **không tồn tại** khoá debounce nào. Đếm
   * nó = tạo một bộ đếm mà bất kỳ vòng `for` nào cũng bơm được. Thà mất lượt
   * xem của client không gửi anonId còn hơn có một con số vô nghĩa.
   *
   * ⚠️ **GIỚI HẠN ĐÃ BIẾT, GHI RA THAY VÌ GIẢ VỜ ĐÃ GIẢI QUYẾT:** `anonId` do
   * client sinh nên client xoay vòng nó là thổi phồng được `viewCount`. Đó là
   * hệ quả cố hữu của "không dùng IP", không phải lỗi cài đặt. Muốn chặn thật
   * thì cần chữ ký phía server hoặc rate-limit theo IP — và cả hai đều phải chờ
   * `trust proxy` của HT-3 mới có IP thật để mà dựa vào.
   */
  private async _trackOnce(
    kind: 'view' | 'click',
    pinId: string,
    identity: string | null,
  ): Promise<boolean> {
    if (!identity) return false;

    const key = `track:${kind}:${pinId}:${identity}`;
    try {
      const set = await this.redis.set(key, '1', 'EX', PinsService.TRACK_DEBOUNCE_TTL_SEC, 'NX');
      // `null` ⇒ khoá đã tồn tại ⇒ vẫn trong cửa sổ ⇒ KHÔNG đếm lần này.
      if (set === null) return false;
    } catch (e) {
      // ⚠️ FAIL-**OPEN**, ngược với khoá của job purge (`purge.scheduler.ts`).
      // Ở đó fail-closed vì hậu quả của nhánh sai là XOÁ TRÙNG dữ liệu. Ở đây
      // hai nhánh đều vô hại: hoặc mất số liệu, hoặc phồng nhẹ số liệu trong
      // lúc Redis chết. Chức năng CHÍNH là đếm, còn debounce chỉ là bộ lọc chất
      // lượng — nên khi không lọc được thì vẫn đếm.
      // (Hướng fail-safe do HẬU QUẢ quyết định, không do thói quen của codebase.)
      this.logger.warn(`[track] Redis lỗi khi debounce ${kind} ${pinId}: ${(e as Error).message}`);
    }

    await this.prisma.pin.update({
      where: { id: pinId },
      data: kind === 'view' ? { viewCount: { increment: 1 } } : { clickCount: { increment: 1 } },
    });
    return true;
  }

  /**
   * Đếm một lượt **mở chi tiết pin**.
   *
   * `findById` chạy trước và ném `Pin not found` cho pin đã xoá mềm hoặc pin
   * của người bị chặn (2 chiều) — cùng đường với query `pin(id)`, cố ý không
   * viết nhánh kiểm tra thứ hai. Hệ quả đúng: người bị chặn không bơm được
   * lượt xem cho nhau, và pin đã xoá không nhận thêm số liệu.
   */
  async trackPinView(pinId: string, identity: string | null, blockedIds: string[]): Promise<boolean> {
    await this.findById(pinId, blockedIds);
    return this._trackOnce('view', pinId, identity);
  }

  /**
   * Đếm một lượt **bấm link ngoài**.
   *
   * Pin không có `sourceUrl` ⇒ trả `false` chứ không ném lỗi: về mặt nghiệp vụ
   * sự kiện đó không tồn tại (không có link để mà bấm), và một client gọi nhầm
   * không đáng bị coi là lỗi hệ thống.
   */
  async trackPinClick(pinId: string, identity: string | null, blockedIds: string[]): Promise<boolean> {
    const pin = await this.findById(pinId, blockedIds);
    if (!pin.sourceUrl) return false;
    return this._trackOnce('click', pinId, identity);
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
   *
   * B-19 (17/08/2026) — trả **chính pin đó** thay cho `{ success, status }`.
   * Hai lý do, cái sau mới là cái đáng kể:
   *  • `success` luôn `true` (mọi nhánh hỏng đều ném exception) ⇒ nó không mang
   *    tin gì.
   *  • `status` là **nguồn sự thật thứ hai** cho đúng một việc: client phải tự
   *    suy trạng thái mới từ chuỗi `'ADDED'|'UPDATED'|'REMOVED'`, trong khi
   *    `viewerReaction` + `reactionCount` đã tả đúng trạng thái đó và tả bằng
   *    dữ liệu thật. Trả pin ⇒ Apollo tự chuẩn hoá theo `id` ⇒ lưới, modal và
   *    trang đang mở cùng pin đều đúng mà không cần `refetch`.
   *
   * Trả `pin` đọc từ đầu hàm là AN TOÀN: reaction không sửa cột nào của `Pin`.
   * `reactionCount`/`viewerReaction` là ResolveField chạy SAU mutation trong
   * cùng request, qua DataLoader chưa từng được nạp ở request này ⇒ chúng đọc
   * trạng thái đã ghi xong, không phải trạng thái cũ.
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
      } else {
        await this.prisma.reaction.update({
          where: { id: existingReaction.id },
          data: { type },
        });
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
    }

    // Nhánh REMOVED cũng trả pin (không trả `null`): "đã gỡ cảm xúc" vẫn là một
    // pin hợp lệ, chỉ khác ở chỗ `viewerReaction` nay là `null`. Trả `null` ở
    // đây sẽ buộc client phân biệt "gỡ xong" với "không tìm thấy pin".
    return pin;
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

  // ─── B-11: Related pins by tag ───────────────────────────────────────────────

  /**
   * Pin liên quan với `pinId`, xếp theo **số tag chung giảm dần**.
   *
   * ```sql
   * WITH src AS (                       -- tag của pin gốc, CHỈ khi pin gốc còn thấy được
   *   SELECT pt."B" AS tag_id FROM "_PinToTag" pt
   *     JOIN "Pin" sp ON sp."id" = pt."A"
   *    WHERE pt."A" = $1 AND sp."deletedAt" IS NULL [AND sp."creatorId" NOT IN (…)]
   * )
   * SELECT p.*, COUNT(*)::int AS "sharedTagCount"
   *   FROM "Pin" p
   *   JOIN "_PinToTag" pt ON pt."A" = p."id" AND pt."B" IN (SELECT tag_id FROM src)
   *  WHERE p."deletedAt" IS NULL AND p."id" <> $1 [AND p."creatorId" NOT IN (…)]
   *  GROUP BY p."id"
   * [HAVING (COUNT(*)::int, p."createdAt", p."id") < ($n::int,$m::timestamp,$k::text)]
   *  ORDER BY COUNT(*) DESC, p."createdAt" DESC, p."id" DESC
   *  LIMIT $last
   * ```
   *
   * ⚠️ **CỘT `A`/`B` CỦA HAI BẢNG NỐI NGƯỢC CHIỀU NHAU** — bẫy đã trả giá ở B-5.
   * Prisma đặt A/B theo thứ tự chữ cái của TÊN MODEL, không theo tên relation:
   * `_PinToTag` có **Pin ở cột A**, Tag ở cột B (còn `_PinToCategory` thì
   * Category ở A, **Pin ở cột B**). Đoán nhầm KHÔNG sinh lỗi cú pháp: câu vẫn
   * chạy và trả sai. Ở đây nó còn im lặng hơn nữa vì kết quả rỗng trông hệt
   * như "pin này không có pin liên quan" — nên phép kiểm bắt buộc phải là bản
   * đồ pin↔pin đối chiếu từng cặp, không phải "có trả về gì không".
   *
   * ⚠️ **`JOIN` ở đây là CỐ Ý, ngược với `EXISTS` của B-5.** B-5 chỉ hỏi "có
   * tồn tại một cạnh không" nên `JOIN` sẽ nhân bản dòng `Pin` và phá `LIMIT+1`.
   * Ở đây ta CẦN đếm số cạnh, nên phải `JOIN` rồi `GROUP BY p."id"` gom lại —
   * `GROUP BY` khoá chính cho phép `SELECT p.*` (Postgres suy ra phụ thuộc hàm),
   * và sau khi gom thì mỗi pin lại đúng một dòng nên `LIMIT+1` vẫn đúng.
   *
   * ⚠️ **Pin gốc phải bị loại bằng `p."id" <> $1`, không phải bằng "chắc nó
   * không có tag chung với chính nó"** — nó có, và nhiều nhất bảng.
   *
   * Lọc chặn **2 chiều** đi qua `blockedIds` mà resolver lấy từ
   * `getBlockedUserIds` (`common/blocking/`) — dùng lại đúng mảng đó cho **cả
   * hai** chỗ: pin gốc và pin kết quả. Chặn ở pin gốc không thừa: thiếu nó thì
   * người bị chặn vẫn "gợi ý" được nội dung qua chính pin của họ.
   */
  async relatedPins(
    pinId: string,
    pagination: CursorPaginationArgs,
    blockedIds: string[],
  ): Promise<PaginatedResult<any>> {
    const { first, after } = pagination;
    const take = first + 1;

    const q = this._sqlParams();
    const pinIdParam = q.bind(pinId);

    const srcBlocked = this._notInBlocked(q, blockedIds, 'sp.');
    const rowBlocked = this._notInBlocked(q, blockedIds, 'p.');

    // Keyset 3 thành phần, CÙNG hướng desc ⇒ diễn đạt được bằng so sánh theo
    // HÀNG. `sharedTagCount` là aggregate nên mệnh đề phải nằm ở `HAVING`,
    // không phải `WHERE` (ở `WHERE` thì Postgres báo lỗi "aggregate functions
    // are not allowed in WHERE" — lỗi ồn ào, không phải lỗi im lặng).
    let having = '';
    if (after) {
      const [count, createdAt, id] = decodeKeysetValues(RELATED_PINS_KEYSET, after);
      having = `HAVING (COUNT(*)::int, p."createdAt", p."id")
                     < (${q.bind(count)}::int, ${q.bind(createdAt)}::timestamp, ${q.bind(id)}::text)`;
    }

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `WITH src AS (
         SELECT pt."B" AS tag_id
           FROM "_PinToTag" pt
           JOIN "Pin" sp ON sp."id" = pt."A"
          WHERE pt."A" = ${pinIdParam}
            AND sp."deletedAt" IS NULL
            ${srcBlocked ? `AND ${srcBlocked}` : ''}
       )
       SELECT p.*, COUNT(*)::int AS "sharedTagCount"
         FROM "Pin" p
         JOIN "_PinToTag" pt ON pt."A" = p."id"
                            AND pt."B" IN (SELECT tag_id FROM src)
        WHERE p."deletedAt" IS NULL
          AND p."id" <> ${pinIdParam}
          ${rowBlocked ? `AND ${rowBlocked}` : ''}
        GROUP BY p."id"
        ${having}
        ORDER BY COUNT(*) DESC, p."createdAt" DESC, p."id" DESC
        LIMIT ${q.bind(take)}`,
      ...q.values,
    );

    // KHÔNG dùng `_buildPaginatedResult` (nó chốt cứng `CREATED_DESC`): cursor
    // phải mang cả `sharedTagCount`, nếu không trang 2 sẽ lọc theo nhầm khoá.
    return keysetPage(RELATED_PINS_KEYSET as any, rows as any, first) as any;
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
