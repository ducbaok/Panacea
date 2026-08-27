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
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, ReactionType } from '@antigravity/database';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePinInput } from './dto/create-pin.input';
import { UpdatePinInput } from './dto/update-pin.input';
import { normalizeTagNames, dedupeCategoryIds } from './tag-name.util';
// XH-2 (21/08/2026) — bộ lọc quyền xem pin, nguồn sự thật thứ hai cạnh
// getBlockedUserIds. Ctx lấy MỘT lần ở resolver (memo trong DataloaderService)
// rồi truyền xuống — cùng khuôn với blockedIds, cùng lý do vòng đời.
import { visiblePinSql, isPinVisibleInCtx } from '../common/blocking';
import type { PinAudienceCtx } from '../common/blocking';
// XH-4a — khán giả ad-hoc dùng lại CHÍNH `Circle` (XH-QĐ-5). Băm + hai trần
// nằm ở file dùng chung với module circles của luồng B, xem docblock ở đó.
import {
  computeMemberHash,
  MAX_CIRCLES_PER_USER,
  MAX_CIRCLE_MEMBERS,
  AD_HOC_CIRCLE_NAME,
} from '../common/blocking';
import { Visibility } from './entities/visibility.enum';
// XH-5 — chiều NGƯỢC của bộ lọc khán giả: từ PIN ra NGƯỜI. Dùng chung với
// loader `pinViewers` của `DataloaderService`, xem docblock ở file đó.
import { currentAudienceIds } from './pin-audience.util';
import type { PinAudienceRow } from './pin-audience.util';
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
import { mediaHostWhitelist } from '../common/media/media-host.util';
import { FeedSource } from './entities/home-feed.entity';

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

/**
 * Domain được phép cho MỌI URL ảnh gửi lên — `imageUrl` lẫn 3 biến thể của
 * XH-9a (`PLAN_XAHOI.md` §8 bẫy 2).
 *
 * Nâng từ biến cục bộ trong `createPin` lên hằng module vì từ XH-9a nó có BỐN
 * chỗ dùng thay vì một. Bốn bản sao của danh sách này là bốn chỗ để quên thêm
 * domain mới, và cái quên đó không nổ ở đâu cả — nó chỉ chặn đúng một biến thể
 * ảnh và người dùng thấy lưới vỡ ảnh.
 */
// 27/08/2026 — danh sách này KHÔNG còn viết tay ở đây. Host công khai của
// media phụ thuộc môi trường (bucket + region + CloudFront), và bản hardcode cũ
// TRƯỢT chính bucket của mình trên production. Nguồn sự thật:
// `common/media/media-host.util.ts` — đọc docblock đầu file đó trước khi sửa.
// Tính một lần trong constructor: `mediaHostWhitelist` đọc env qua ConfigService
// và env không đổi giữa chừng, nhưng `assertImageUrlAllowed` chạy 4 lần cho MỖI
// createPin (XH-9a) — dựng lại mảng ở mỗi lần gọi là rác không cần thiết.

/**
 * Cửa sổ đếm của trần tạo pin, tính bằng giây. Cố định 60 vì XH-QĐ-12 nói
 * thẳng "10 pin/PHÚT": biến nó thành tham số env sẽ đẻ ra một cấu hình mà
 * chẳng ai chỉnh, đổi lại việc tên hằng số không còn khớp tài liệu.
 */
const PIN_CREATE_WINDOW_SEC = 60;

/**
 * XH-VIDEO (26/08/2026) — trần thời lượng đoạn quay.
 *
 * Mốc dài nhất là 30s (spec capture Q4), nhưng KHÔNG chặn ở đúng 30_000: khâu
 * dừng của `MediaRecorder` là bất đồng bộ, frame cuối luôn rơi trễ vài chục ms
 * so với hẹn giờ, nên một đoạn "30 giây" thực tế đo được 30_040ms. Chặn khít
 * là tự đẻ ra một lỗi 400 ngẫu nhiên ở đúng mốc dùng nhiều nhất. 2 giây dung
 * sai đủ rộng cho máy chậm mà vẫn không cho lọt một đoạn 60s.
 */
const MAX_VIDEO_MS = 32_000;

/** Bản sao của mặc định ở `configuration.ts` — dùng khi ConfigService không trả gì. */
const PIN_CREATE_PER_MIN_DEFAULT = 10;

@Injectable()
export class PinsService {
  private readonly logger = new Logger(PinsService.name);

  /**
   * Trần tạo pin theo phút (XH-4b), đọc MỘT LẦN lúc dựng service — cùng chủ
   * đích với `AuthService.loginMaxAttempts`: đây là tham số chống lạm dụng,
   * không phải cờ bật/tắt lúc chạy, nên đổi `.env` thì phải restart API.
   */
  private readonly pinCreatePerMin: number;

  /** Host được phép cho mọi URL media — xem `common/media/media-host.util.ts`. */
  private readonly imageHostWhitelist: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    // `RedisModule` là @Global nên inject được mà không cần import module.
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // `ConfigModule.forRoot({ isGlobal: true })` ⇒ `pins.module.ts` KHÔNG cần sửa.
    private readonly configService: ConfigService,
  ) {
    this.pinCreatePerMin = this.configService.get<number>('pins.createPerMin') ?? PIN_CREATE_PER_MIN_DEFAULT;
    this.imageHostWhitelist = mediaHostWhitelist({
      cloudfrontDomain: this.configService.get<string>('aws.cloudfrontDomain'),
      s3BucketName: this.configService.get<string>('aws.s3BucketName'),
      region: this.configService.get<string>('aws.region'),
    });
  }

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

  // ─── Khán giả: URL ảnh · hạn sống · vòng tròn (XH-4a/XH-6/XH-9a) ────────────

  /**
   * Khẳng định một URL ảnh nằm trong whitelist domain của dự án.
   *
   * `label` đi vào CẢ HAI thông điệp lỗi vì từ XH-9a có bốn URL trong cùng một
   * request: "domain is not allowed" mà không nói URL nào thì người dùng phải
   * thử từng cái. Nhãn của `imageUrl` giữ nguyên chữ cũ ("Image URL") — thông
   * điệp đó đang là hợp đồng của một phép verify và của `apps/web/lib/errors`.
   */
  private assertImageUrlAllowed(raw: string, label: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      // URL tương đối lọt tới đây: `new URL('/uploads/a.png')` ném, và đó đúng
      // là thứ phải chặn — 3 biến thể của XH-9a bắt buộc là URL TUYỆT ĐỐI.
      throw new BadRequestException(`Invalid ${label}`);
    }
    const ok = this.imageHostWhitelist.some(
      (domain) => url.hostname === domain || url.hostname.endsWith('.' + domain),
    );
    if (!ok) {
      throw new BadRequestException(`${label} domain is not allowed`);
    }
  }

  /**
   * XH-VIDEO — `videoUrl` và `videoDurationMs` phải đi CÙNG NHAU.
   *
   * Vì sao không để nửa cặp lọt qua: một pin có `videoUrl` mà `videoDurationMs`
   * null thì FE không biết đoạn dài bao nhiêu để vẽ badge, còn một pin có
   * `videoDurationMs` mà không có `videoUrl` là pin ẢNH mang thời lượng — cả
   * hai đều là dữ liệu bẩn không ai phát hiện ra cho tới lúc vẽ sai. Bỏ qua im
   * lặng nửa còn thiếu cũng tệ y như thế, nên 400 chứ không "tự điền".
   */
  private assertVideoPairing(videoUrl?: string, videoDurationMs?: number): void {
    const hasUrl = videoUrl != null;
    const hasMs = videoDurationMs != null;
    if (hasUrl !== hasMs) {
      throw new BadRequestException(
        'videoUrl and videoDurationMs must be provided together',
      );
    }
    if (hasMs && videoDurationMs! > MAX_VIDEO_MS) {
      throw new BadRequestException(`Video too long (max ${MAX_VIDEO_MS}ms)`);
    }
  }

  /** Hạn sống phải ở tương lai — xem docblock `expiresAt` ở `CreatePinInput`. */
  private assertFutureExpiry(expiresAt?: Date | null): void {
    if (expiresAt != null && new Date(expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
  }

  /**
   * Quy đầu vào khán giả về ĐÚNG hai cột ghi được: `visibility` +
   * `audienceCircleId`. MỘT hàm cho cả `createPin` lẫn `updatePin` — luật kết
   * hợp bốn field là thứ hai hàm phải giống nhau tuyệt đối, và cách chắc chắn
   * nhất để chúng giống nhau là chỉ có một bản.
   *
   * Khác biệt DUY NHẤT giữa hai bên nằm ở `mode`:
   *   create ⇒ thiếu `visibility` là `PUBLIC` (mặc định của pin mới)
   *   update ⇒ thiếu `visibility` là KHÔNG ĐỤNG (trả `{}`, khoá không xuất
   *            hiện trong `data`) — cùng quy ước ba trạng thái của tag.
   *
   * ⚠️ ĐỔI SANG CẤP KHÁC CIRCLE PHẢI XOÁ `audienceCircleId` (trả `null` tường
   * minh, không phải bỏ khoá). Giữ lại id vòng cũ trên một pin PUBLIC không
   * gây lỗi nào lúc đọc — `visiblePinWhere` chỉ nhìn cột đó khi `visibility =
   * CIRCLE` — nhưng nó để lại một mảnh dữ liệu nói "pin này từng gửi cho vòng
   * X" trên một pin ai cũng đọc được, và sẽ lại có hiệu lực ngay khi có ai đó
   * đổi pin về CIRCLE mà quên gửi vòng.
   */
  private async _resolveAudience(
    userId: string,
    input: {
      visibility?: Visibility;
      audienceCircleId?: string | null;
      audienceUserIds?: string[] | null;
    },
    mode: 'create' | 'update',
  ): Promise<{ visibility?: Visibility; audienceCircleId?: string | null }> {
    const hasCircleId = input.audienceCircleId != null;
    const hasUserIds = input.audienceUserIds != null;
    const visibility =
      input.visibility ?? (mode === 'create' ? Visibility.PUBLIC : undefined);

    if (visibility === undefined) {
      if (hasCircleId || hasUserIds) {
        throw new BadRequestException(
          'audienceCircleId/audienceUserIds must be sent together with visibility: CIRCLE',
        );
      }
      return {};
    }

    if (visibility !== Visibility.CIRCLE) {
      // Bỏ qua im lặng ở đây = người dùng tưởng đã chọn vòng mà pin đang công
      // khai. Đó là lý do nhánh này ném chứ không "ưu tiên field kia".
      if (hasCircleId || hasUserIds) {
        throw new BadRequestException(
          `audienceCircleId/audienceUserIds only apply when visibility is CIRCLE (got ${visibility})`,
        );
      }
      return { visibility, audienceCircleId: null };
    }

    if (hasCircleId === hasUserIds) {
      throw new BadRequestException(
        'visibility: CIRCLE requires exactly one of audienceCircleId or audienceUserIds',
      );
    }

    if (hasCircleId) {
      // `ownerId: userId` nằm TRONG where, không phải một phép so sánh sau khi
      // fetch: vòng của người khác và vòng không tồn tại phải không phân biệt
      // được — cùng chính sách 404 của pin ngoài khán giả.
      const circle = await this.prisma.circle.findFirst({
        where: { id: input.audienceCircleId!, ownerId: userId },
        select: { id: true },
      });
      if (!circle) throw new NotFoundException('Circle not found');
      return { visibility, audienceCircleId: circle.id };
    }

    return {
      visibility,
      audienceCircleId: await this._resolveAdHocCircle(userId, input.audienceUserIds!),
    };
  }

  /**
   * Khán giả chọn tại chỗ ⇒ id của MỘT `Circle` (XH-QĐ-5: một cơ chế khán giả
   * duy nhất, không có bảng `PinAudience` thứ hai).
   *
   * Tái dùng theo `memberHash`: đăng cho đúng ba người đó lần thứ hai KHÔNG đẻ
   * thêm vòng. Đây là lý do cột `memberHash` tồn tại (`PLAN_XAHOI.md` §2 ghi
   * chú 2), và là điều kiện để trần 20 vòng không bị một người dùng bình
   * thường đâm thủng chỉ bằng cách đăng bài.
   *
   * ⚠️ CHÍNH CHỦ BỊ LOẠI KHỎI DANH SÁCH TRƯỚC KHI BĂM. Client hoàn toàn có thể
   * gửi kèm id của chính người đăng; nếu không loại thì `[alice]` và `[alice,
   * bao]` băm ra hai giá trị ⇒ hai vòng cho cùng một khán giả thật. Chủ pin
   * luôn thấy pin của mình qua vế `creatorId = viewerId` của bộ lọc nên tư
   * cách thành viên của chính chủ không mang thêm quyền nào.
   *
   * ⚠️ P2002 KHÔNG PHẢI 500. Hai request song song cùng tập người đều thấy
   * "chưa có vòng" rồi cùng INSERT; `@@unique([ownerId, memberHash])` cho kẻ
   * thua một cú P2002 — và câu trả lời đúng cho kẻ thua là đọc lại vòng mà kẻ
   * thắng vừa tạo, không phải trả lỗi cho người dùng chẳng làm gì sai. Cùng
   * hình dạng với cách `prepareTaxonomy` xử lý cuộc đua trên `Tag.name`.
   */
  private async _resolveAdHocCircle(userId: string, rawUserIds: string[]): Promise<string> {
    const memberIds = [...new Set(rawUserIds)].filter((id) => id !== userId);
    if (!memberIds.length) {
      throw new BadRequestException(
        'audienceUserIds must contain at least one user other than yourself',
      );
    }
    if (memberIds.length > MAX_CIRCLE_MEMBERS) {
      throw new BadRequestException(
        `A circle holds at most ${MAX_CIRCLE_MEMBERS} members (XH-QĐ-13)`,
      );
    }

    // Kiểm người có thật TRƯỚC khi ghi, cùng lý do với `categoryIds` ở
    // `prepareTaxonomy`: P2025 của Prisma không nói id nào sai.
    // (Middleware soft-delete thêm `deletedAt: null` cho `User.findMany` ⇒ tài
    // khoản đã xoá mềm cũng rơi vào nhánh "unknown", đúng ý.)
    const found = await this.prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true },
    });
    if (found.length !== memberIds.length) {
      const foundIds = new Set(found.map((u) => u.id));
      throw new BadRequestException(
        `Unknown userId: ${memberIds.filter((id) => !foundIds.has(id)).join(', ')}`,
      );
    }

    const memberHash = computeMemberHash(memberIds);
    const existing = await this.prisma.circle.findFirst({
      where: { ownerId: userId, memberHash },
      select: { id: true },
    });
    if (existing) return existing.id;

    // Trần 20 vòng ĐẾM CẢ VÒNG AD-HOC (XH-QĐ-13) — vòng ẩn vẫn là bản ghi thật.
    const owned = await this.prisma.circle.count({ where: { ownerId: userId } });
    if (owned >= MAX_CIRCLES_PER_USER) {
      throw new ForbiddenException(
        `Circle limit reached (${MAX_CIRCLES_PER_USER} per user, ad-hoc circles included)`,
      );
    }

    try {
      const created = await this.prisma.circle.create({
        data: {
          ownerId: userId,
          name: AD_HOC_CIRCLE_NAME,
          isAdHoc: true,
          memberHash,
          members: { create: memberIds.map((id) => ({ userId: id })) },
        },
        select: { id: true },
      });
      return created.id;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const raced = await this.prisma.circle.findFirst({
          where: { ownerId: userId, memberHash },
          select: { id: true },
        });
        if (raced) return raced.id;
      }
      throw e;
    }
  }

  // ─── Rate-limit đường tạo pin (Redis · XH-4b) ───────────────────────────────

  /**
   * ╔═════════════════════════════════════════════════════════════════════════╗
   * ║  VÌ SAO ĐƯỜNG TẠO PIN CÓ TRẦN THEO PHÚT (XH-4b · XH-QĐ-12, 21/08/2026)  ║
   * ║                                                                         ║
   * ║  Trần 20 pin/NGÀY từng là giới hạn chống lạm dụng DUY NHẤT ở đây, và    ║
   * ║  nó đã bị bỏ có chủ đích (XH-QĐ-8) vì chặn nhầm người dùng thật. Dự án  ║
   * ║  đã chốt KHÔNG có moderation/report, nên sau khi bỏ trần ngày thì giữa  ║
   * ║  một script đăng ảnh hàng loạt và bảng `Pin` không còn lớp nào cả.      ║
   * ║  Trần theo PHÚT thay chỗ nó: người thật không bao giờ chạm tới 10 pin   ║
   * ║  trong 60 giây, còn script thì chạm ngay ở pin thứ 11.                  ║
   * ║                                                                         ║
   * ║  ⚠️ ĐÂY LÀ MỘT QUYẾT ĐỊNH BỊ ĐẢO RỒI THAY THẾ, KHÔNG PHẢI CODE TRÙNG:  ║
   * ║  ai đọc tài liệu cũ rồi "khôi phục trần 20/ngày cho đúng" là đang đảo   ║
   * ║  ngược XH-QĐ-8; ai xoá chốt này vì "trần đã bỏ rồi mà" là đang gỡ lớp   ║
   * ║  thay thế đã duyệt. Hai thứ là MỘT cặp: `74-pin-audience-story.mjs`     ║
   * ║  chứng minh trần NGÀY đã chết, `77-pin-rate.mjs` chứng minh trần PHÚT   ║
   * ║  còn sống.                                                              ║
   * ║                                                                         ║
   * ║  ⚠️ FAIL-**OPEN**, cùng đánh đổi đã cân nhắc ở brute-force limiter      ║
   * ║  (`auth.service.ts`): Redis chết ⇒ trần im lặng ngừng hoạt động và pin  ║
   * ║  VẪN được tạo (chỉ log `warn`). Fail-closed sẽ biến một sự cố Redis     ║
   * ║  thành "không ai đăng được pin nữa" — sự cố hạ tầng leo thang thành sự  ║
   * ║  cố toàn sản phẩm. Cửa sổ hỏng ngắn, và `ThrottlerModule` vẫn chặn      ║
   * ║  100 req/phút theo IP ở tầng trên (`app.module.ts`).                    ║
   * ║                                                                         ║
   * ║  KHÁC brute-force ở hai điểm, cả hai đều có lý do:                      ║
   * ║   • KHÔNG băm khoá. Khoá của login bám theo EMAIL (PII do client gửi,   ║
   * ║     dài tuỳ ý); khoá ở đây bám theo `userId` — cuid nội bộ, dài cố      ║
   * ║     định, đã nằm khắp Redis (`track:*`). Băm nó chỉ làm khoá khó truy   ║
   * ║     vết lúc sự cố mà không giấu thêm được gì.                           ║
   * ║   • KHÔNG có khoá riêng ngoài bộ đếm. Login cần cặp `fail`+`lock` vì    ║
   * ║     hình phạt (15 phút) DÀI HƠN cửa sổ đếm. Ở đây hình phạt CHÍNH LÀ    ║
   * ║     phần còn lại của cửa sổ, nên một khoá đếm có TTL là đủ — thêm khoá  ║
   * ║     thứ hai là thêm một thứ có thể lệch nhau.                           ║
   * ╚═════════════════════════════════════════════════════════════════════════╝
   */
  private _pinRateKey(userId: string): string {
    return `pincreate:${userId}`;
  }

  /**
   * Ghi nhận một lần gọi `createPin` và cho biết có phải TỪ CHỐI hay không.
   *
   * @returns `0` = cho đi tiếp · `> 0` = bị chặn, và đó là số giây còn lại của
   *   cửa sổ hiện tại.
   *
   * ⚠️ Hàm này KHÔNG ném — bên gọi ném. Cùng cái bẫy mà `_recordLoginFailure`
   * đã ghi: ném `ForbiddenException` từ trong `try` thì chính `catch` fail-open
   * bên dưới nuốt nó, và pin thứ 11 lại được tạo bình thường trong khi Redis
   * vẫn ghi nhận là đã chặn. Tách "quyết định" khỏi "ném" làm bẫy đó không tồn
   * tại được.
   */
  private async _hitPinCreateLimit(userId: string): Promise<number> {
    const key = this._pinRateKey(userId);
    try {
      const n = await this.redis.incr(key);
      // Chỉ đặt hạn ở lần ĐẦU. Gọi `expire` mỗi lần sẽ đẩy cửa sổ trượt về
      // trước vô hạn: người đăng đều đặn 59 giây một pin sẽ không bao giờ được
      // đặt lại bộ đếm, và tới pin thứ 11 — dù cách nhau cả chục phút — vẫn bị
      // chặn. Đó là lỗi (a) của brute-force limiter ở một hình dạng khác.
      if (n === 1) {
        await this.redis.expire(key, PIN_CREATE_WINDOW_SEC);
        return 0;
      }
      if (n <= this.pinCreatePerMin) return 0;

      const ttl = await this.redis.ttl(key);
      if (ttl < 0) {
        // `-1` = bộ đếm KHÔNG có hạn: `INCR` thành công nhưng `EXPIRE` ở lần
        // đầu đã trượt. Bỏ mặc thì người này bị chặn VĨNH VIỄN. Vá lại hạn rồi
        // cho request này đi tiếp — thà bỏ sót một lần chặn còn hơn khoá cứng
        // một tài khoản, đúng logic fail-open đã chọn.
        await this.redis.expire(key, PIN_CREATE_WINDOW_SEC);
        return 0;
      }
      return ttl;
    } catch (e) {
      this.logger.warn(
        `[pin-rate] Redis lỗi khi đếm pin, KHÔNG chặn (fail-open): ${(e as Error).message}`,
      );
      return 0;
    }
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  /**
   * Tạo pin mới.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Validate imageUrl: Chỉ cho phép các domain tin cậy (như localhost, s3.amazonaws.com). Nếu không hợp lệ -> ném BadRequestException.
   * 2. prisma.pin.create({ data: { imageUrl, imageWidth, imageHeight, title, description, sourceUrl, creatorId: userId } }).
   * 3. imageUrl ở đây là S3 key (raw/...), sẽ được Lambda xử lý sau.
   * 4. Return pin vừa tạo.
   *
   * 🔴 TRẦN 20 PIN/NGÀY ĐÃ BỊ BỎ — XH-QĐ-8, chủ dự án chốt 21/08/2026
   * (`PLAN_XAHOI.md` §5). Đây là một quyết định v1 BỊ ĐẢO, không phải đoạn code
   * chết bị dọn nhầm: ai đọc tài liệu cũ rồi "sửa lại cho đúng" là đang đảo
   * ngược quyết định của chủ dự án. `74-pin-audience-story.mjs` có một phép
   * chứng minh trần này đã chết (pin thứ 21 trong ngày phải tạo được).
   *
   * ⚠️ Bỏ trần này lấy đi giới hạn chống lạm dụng DUY NHẤT trên đường tạo pin.
   * Thay thế đã duyệt: rate-limit ~10 pin/phút bằng Redis — XH-4b (XH-QĐ-12).
   * ✅ ĐÃ THI CÔNG 25/08/2026, chốt nằm ngay đầu hàm này (bước 0 bên dưới);
   * xem docblock của `_hitPinCreateLimit`.
   */
  async createPin(userId: string, input: CreatePinInput) {
    // 0. Trần theo phút (XH-4b). ĐỨNG TRƯỚC MỌI VALIDATE là có chủ đích: thứ
    //    cần giới hạn là REQUEST, không phải pin thành công. Đặt sau validate
    //    thì một script gửi 10.000 request ảnh sai domain vẫn quét sạch DB
    //    connection lẫn CPU mà bộ đếm không nhúc nhích — và đó đúng là hình
    //    dạng rẻ nhất của một cuộc lạm dụng.
    const blockedFor = await this._hitPinCreateLimit(userId);
    if (blockedFor > 0) {
      // Thông điệp cố ý KHÔNG nói Redis/khoá/hạ tầng, chỉ nói việc người dùng
      // làm được: chờ bao lâu. Con số giây là thứ phân biệt nhánh này với mọi
      // ForbiddenException khác của `createPin` trong phép kiểm 77.
      throw new ForbiddenException(
        `Too many pins created. Try again in ${blockedFor}s.`,
      );
    }

    // 1. Whitelist domain cho CẢ BỐN url ảnh (XH-9a — PLAN_XAHOI.md §8 bẫy 2).
    //    Ba biến thể là tuỳ chọn: không gửi thì bỏ qua, gửi thì bị soi y hệt
    //    `imageUrl` — một URL biến thể trỏ ra ngoài whitelist chính là đường
    //    nhúng ảnh từ domain lạ vào lưới, đúng thứ whitelist sinh ra để chặn.
    this.assertImageUrlAllowed(input.imageUrl, 'Image URL');
    for (const [label, value] of [
      ['thumbnailUrl', input.thumbnailUrl],
      ['mediumUrl', input.mediumUrl],
      ['largeUrl', input.largeUrl],
      // XH-VIDEO — `videoUrl` đi qua ĐÚNG whitelist domain của ảnh, không có
      // danh sách thứ hai. Một URL video trỏ ra domain lạ cũng là nhúng media
      // ngoài vào trang mình, y hệt thứ whitelist ảnh sinh ra để chặn.
      ['videoUrl', input.videoUrl],
    ] as const) {
      if (value != null) this.assertImageUrlAllowed(value, label);
    }
    this.assertVideoPairing(input.videoUrl, input.videoDurationMs);

    // 2. Khán giả + hạn sống (XH-4a/XH-6). Chạy TRƯỚC `prepareTaxonomy` vì
    //    nhánh ad-hoc có thể GHI (tạo vòng): không có lý do gì tạo cả Tag mới
    //    lẫn vòng mới cho một request sắp bị từ chối vì lý do khác.
    this.assertFutureExpiry(input.expiresAt);
    const audience = await this._resolveAudience(userId, input, 'create');

    // 3. Taxonomy (Đợt 6) — chuẩn hoá tag, tạo trước Tag mới, kiểm category có
    //    thật.
    const { tagNames, categoryIds } = await this.prepareTaxonomy(input);

    try {
      return await this.prisma.pin.create({
        data: {
          imageUrl: input.imageUrl,
          imageWidth: input.imageWidth,
          imageHeight: input.imageHeight,
          thumbnailUrl: input.thumbnailUrl,
          mediumUrl: input.mediumUrl,
          largeUrl: input.largeUrl,
          // XH-VIDEO — `?? null` chứ không để undefined trôi qua: Prisma bỏ qua
          // undefined, và tuy `create` thì hai cách tương đương, giữ null tường
          // minh làm hình dạng ở đây khớp với `expiresAt` ngay dưới.
          videoUrl: input.videoUrl ?? null,
          videoDurationMs: input.videoDurationMs ?? null,
          title: input.title,
          description: input.description,
          sourceUrl: input.sourceUrl,
          creatorId: userId,
          expiresAt: input.expiresAt ?? null,
          visibility: audience.visibility,
          audienceCircleId: audience.audienceCircleId ?? null,
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

    // Khán giả (XH-4a) — CÙNG hàm với `createPin`, khác đúng một tham số
    // `mode`. `{}` trả về từ đó nghĩa là client không gửi field nào của khối
    // khán giả ⇒ hai khoá dưới KHÔNG xuất hiện trong `data` ⇒ pin giữ nguyên
    // cấp đang có. Đây là cùng cái bẫy "ba trạng thái" của tag, ở một cột khác:
    // một dòng `visibility: input.visibility` vô điều kiện sẽ ghi `undefined`…
    // hoặc tệ hơn, ai đó "sửa cho gọn" thành `?? 'PUBLIC'` và mọi lần sửa tiêu
    // đề của pin riêng tư biến nó thành công khai, im lặng.
    this.assertFutureExpiry(input.expiresAt);
    const audience = await this._resolveAudience(userId, input, 'update');

    const { tagNames, categoryIds } = await this.prepareTaxonomy(input);

    try {
      return await this.prisma.pin.update({
        where: { id: input.id },
        data: {
          title: input.title,
          description: input.description,
          sourceUrl: input.sourceUrl,
          // Hai cột đi CÙNG NHAU hoặc không cột nào cả: đổi cấp mà quên xoá
          // vòng cũ là để lại một khán giả cũ nằm chờ trên pin.
          ...(audience.visibility !== undefined
            ? {
                visibility: audience.visibility,
                audienceCircleId: audience.audienceCircleId ?? null,
              }
            : {}),
          // `expiresAt` ở đây chỉ ĐẶT/ĐỔI hạn. Không gửi ⇒ không đụng. GỠ hạn
          // là `republishPin`, không phải một `null` lọt qua đường này —
          // `@IsOptional()` đã nuốt mất khác biệt giữa `null` và `undefined`,
          // nên chấp nhận `null` ở đây là chấp nhận một lệnh mà server không
          // chắc client có thật sự gửi hay không.
          ...(input.expiresAt != null ? { expiresAt: input.expiresAt } : {}),
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
   *
   * XH-2 — pin ngoài khán giả cũng 404, cùng lý do và cùng thông điệp. Đây là
   * call-site "URL thẳng" mà phép kiểm feed không bao giờ bắt được
   * (xahoi-phi-chuc-nang.md §1.4).
   *
   * ⚠️ NGOẠI LỆ CHÍNH CHỦ — duy nhất ở hàm này: chủ pin đi qua TRƯỚC khi chạm
   * bộ lọc, tức chủ mở được cả pin ĐÃ HẾT HẠN qua link trực tiếp (màn chi tiết
   * trong kho của XH-6 cần đúng điều đó). Ở mọi bề mặt DANH SÁCH thì pin hết
   * hạn ẩn với cả chính chủ — xem docblock `visiblePinWhere`.
   */
  async findById(pinId: string, blockedIds: string[], audienceCtx: PinAudienceCtx) {
    const pin = await this.prisma.pin.findFirst({
      where: { id: pinId },
      // Luật 3 (`visible-pins.util.ts`) — chủ pin còn sống. `include` để
      // `isPinVisibleInCtx` bên dưới có dữ liệu mà xét; middleware soft-delete
      // KHÔNG lọc quan hệ lồng nên user đã xoá vẫn về, kèm `deletedAt`.
      //
      // Bề mặt này là "URL thẳng" — nơi phép kiểm feed không bao giờ với tới.
      // Thiếu nó thì một link cũ tới pin của tài khoản đã xoá trả 500 (loader
      // trả null cho `Pin.creator` non-nullable) thay vì 404.
      include: { creator: { select: { deletedAt: true } } },
    });

    if (!pin || pin.deletedAt || blockedIds.includes(pin.creatorId)) {
      throw new NotFoundException('Pin not found');
    }

    // Ngoại lệ chính-chủ ở dưới KHÔNG áp cho luật 3: chủ đã xoá tài khoản thì
    // không còn phiên nào để mà là "chính chủ", và pin phải biến mất kể cả khi
    // ai đó còn giữ token cũ.
    if (pin.creator == null || pin.creator.deletedAt != null) {
      throw new NotFoundException('Pin not found');
    }

    if (pin.creatorId !== audienceCtx.viewerId && !isPinVisibleInCtx(pin, audienceCtx)) {
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
    pin: PinAudienceRow,
    identity: string | null,
    viewerId: string | null,
  ): Promise<boolean> {
    if (!identity) return false;

    const pinId = pin.id;
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

    if (kind === 'view') await this._recordPinView(pin, viewerId);
    return true;
  }

  /**
   * Ghi một dòng "ai đã xem" (XH-5 — PLAN_XAHOI.md §4 luật 1, 2, 4).
   *
   * BA ĐIỀU KIỆN, và cả ba đều là điều kiện KHÔNG GHI chứ không phải bộ lọc lúc
   * đọc — dữ liệu không được sinh ra thì không có gì để rò:
   *   · **pin non-PUBLIC** (luật 1). Ghi cho pin công khai vừa đắt — mỗi lượt
   *     xem một dòng, trên bề mặt có lưu lượng lớn nhất — vừa phản cảm. Giá trị
   *     của "ai đã xem" nằm ở nhóm nhỏ.
   *   · **viewer đăng nhập** (luật 2). Khách vãng lai VẪN tăng `viewCount` (lời
   *     gọi này nằm SAU `pin.update`, không phải trước), nhưng không có danh
   *     tính nào để hiện trong danh sách. `a:<anonId>` là thứ client tự khai —
   *     ghi nó vào bảng là mời người khác tự đặt tên mình.
   *   · **viewer ≠ chủ pin** (luật 4). Chủ mở lại pin của chính mình không phải
   *     là một "lượt xem" theo nghĩa của tính năng này.
   *
   * ⚠️ NẰM TRONG NHÁNH ĐÃ QUA DEBOUNCE, cố ý: khoá `track:view:*` 30′ đã có sẵn
   * và tái dùng nó nghĩa là MỘT sự kiện xem = một lần đếm + một lần thử ghi.
   * Đẻ thêm một khoá thứ hai cho riêng `PinView` sẽ tạo hai cửa sổ lệch nhau mà
   * chẳng mua được gì. Hệ quả đã biết và chấp nhận: pin đổi từ PUBLIC sang giới
   * hạn NGAY TRONG cửa sổ 30′ của một người thì lượt xem thứ hai của người đó
   * bị khử trùng ⇒ họ không vào danh sách. Đổi lại là một bảng không bơm được.
   *
   * `createMany({ skipDuplicates: true })` chứ không `upsert`: cột là
   * `firstViewedAt` — LẦN ĐẦU — nên xem lại KHÔNG được phép đẩy mốc thời gian
   * lên. `ON CONFLICT DO NOTHING` nói đúng ngữ nghĩa đó ở tầng DB và đồng thời
   * miễn nhiễm với race (cùng khuôn với `prepareTaxonomy`).
   */
  private async _recordPinView(pin: PinAudienceRow, viewerId: string | null): Promise<void> {
    if (pin.visibility === Visibility.PUBLIC) return;
    if (!viewerId || viewerId === pin.creatorId) return;

    await this.prisma.pinView.createMany({
      data: [{ pinId: pin.id, viewerId }],
      skipDuplicates: true,
    });
  }

  // ─── XH-5: gợi ý @mention trong khán giả ────────────────────────────────────

  /**
   * Người có thể @mention được TRÊN MỘT PIN CỤ THỂ — §4 luật 5.
   *
   * "Chặn ngay lúc gõ" là quyết định về TRẢI NGHIỆM, nhưng chỗ thi hành phải là
   * BACKEND: một danh sách gợi ý lọc ở client chỉ là gợi ý, người dùng vẫn gõ
   * tay được `@ai_do` và `comments.service._notifyMentions` vẫn bắn thông báo
   * cho họ — rồi họ bấm vào và ăn 404 của `visiblePinWhere`. Bề mặt này là thứ
   * FE dựa vào để không bao giờ ĐỀ XUẤT một cái tên như thế.
   *
   * ⚠️ BỀ MẶT NÀY KHÔNG PHẢI HÀNG RÀO — và cố ý không giả vờ là hàng rào. Nó
   * không chặn được người quyết tâm gõ tay; thứ chặn được là bộ lọc lúc đọc
   * (pin 404) cộng với `notifications.service` đã lọc MENTION theo quyền xem.
   * Đặt một `throw` ở đây thay cho một danh sách lọc sẽ tạo cảm giác an toàn
   * giả mà không thêm một lớp phòng thủ nào.
   *
   * `findById` chạy trước ⇒ người KHÔNG đọc được pin nhận đúng 404 "Pin not
   * found" như mọi bề mặt pin khác, và không suy ra được pin đó có tồn tại.
   *
   * Ba tập, theo `visibility` HIỆN TẠI của pin (không phải lúc pin được đăng):
   *   · `PUBLIC`  — mọi người, thu hẹp bằng `q`. Không có khán giả nào để lọc.
   *   · `FOLLOWERS`/`CIRCLE` — đúng tập của `currentAudienceIds`, tức người bị
   *     bớt khỏi vòng biến mất khỏi gợi ý ngay lập tức (cùng nguồn với
   *     `pinViewers`, XH-QĐ-15).
   *   · `ONLY_ME` — chỉ còn chính chủ sau khi loại người gọi ⇒ danh sách rỗng.
   *
   * Loại trừ ở MỌI nhánh: chính người gọi (không ai @ chính mình) và người bị
   * chặn HAI CHIỀU — gợi ý một người mà bộ lọc chặn sẽ ném đi là gợi ý một cái
   * tên chết, đúng lý do đã ghi ở `circles.service.getMemberSuggestions`.
   */
  async mentionSuggestions(
    pinId: string,
    q: string | null,
    limit: number,
    blockedIds: string[],
    audienceCtx: PinAudienceCtx,
  ) {
    const pin = await this.findById(pinId, blockedIds, audienceCtx);

    const excluded = new Set<string>(blockedIds);
    if (audienceCtx.viewerId) excluded.add(audienceCtx.viewerId);

    const where: any = {};
    const audience = await currentAudienceIds(this.prisma, pin as PinAudienceRow);
    if (audience === null) {
      // PUBLIC: không lọc theo khán giả, chỉ loại trừ.
      if (excluded.size) where.id = { notIn: [...excluded] };
    } else {
      const ids = [...audience].filter((id) => !excluded.has(id));
      // Tập rỗng phải trả về SỚM: `id: { in: [] }` là một câu query chắc chắn
      // rỗng — đúng kết quả nhưng tốn một round-trip cho câu trả lời đã biết.
      if (!ids.length) return [];
      where.id = { in: ids };
    }

    const needle = q?.trim();
    if (needle) {
      where.OR = [
        { username: { contains: needle, mode: 'insensitive' } },
        { name: { contains: needle, mode: 'insensitive' } },
      ];
    }

    // Xếp theo `username` chứ không theo độ liên quan: mention giải bằng
    // `username` (`MENTION_REGEX` của comments.service), nên đó là thứ người
    // dùng đang gõ và là thứ họ quét mắt trong danh sách.
    return this.prisma.user.findMany({ where, orderBy: { username: 'asc' }, take: limit });
  }

  /**
   * Đếm một lượt **mở chi tiết pin**.
   *
   * `findById` chạy trước và ném `Pin not found` cho pin đã xoá mềm hoặc pin
   * của người bị chặn (2 chiều) — cùng đường với query `pin(id)`, cố ý không
   * viết nhánh kiểm tra thứ hai. Hệ quả đúng: người bị chặn không bơm được
   * lượt xem cho nhau, và pin đã xoá không nhận thêm số liệu.
   */
  async trackPinView(
    pinId: string,
    identity: string | null,
    blockedIds: string[],
    audienceCtx: PinAudienceCtx,
  ): Promise<boolean> {
    // Giữ lại `pin` thay vì vứt đi như trước XH-5: `_trackOnce` cần
    // `visibility`/`creatorId` để quyết định có ghi `PinView` không, và pin này
    // vừa được đọc ngay đây — fetch lần thứ hai chỉ để lấy 2 cột là thêm một
    // round-trip cho dữ liệu đã nằm trong tay.
    const pin = await this.findById(pinId, blockedIds, audienceCtx);
    return this._trackOnce('view', pin, identity, audienceCtx.viewerId);
  }

  /**
   * Đếm một lượt **bấm link ngoài**.
   *
   * Pin không có `sourceUrl` ⇒ trả `false` chứ không ném lỗi: về mặt nghiệp vụ
   * sự kiện đó không tồn tại (không có link để mà bấm), và một client gọi nhầm
   * không đáng bị coi là lỗi hệ thống.
   */
  async trackPinClick(
    pinId: string,
    identity: string | null,
    blockedIds: string[],
    audienceCtx: PinAudienceCtx,
  ): Promise<boolean> {
    const pin = await this.findById(pinId, blockedIds, audienceCtx);
    if (!pin.sourceUrl) return false;
    // `viewerId` vẫn truyền xuống cho đủ chữ ký, nhưng nhánh `click` KHÔNG ghi
    // `PinView` — "ai đã xem" là lượt XEM, không phải lượt bấm link.
    return this._trackOnce('click', pin, identity, audienceCtx.viewerId);
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
  async toggleReaction(
    userId: string,
    pinId: string,
    type: ReactionType,
    audienceCtx: PinAudienceCtx,
  ) {
    const pin = await this.prisma.pin.findFirst({ where: { id: pinId } });
    if (!pin || pin.deletedAt) throw new NotFoundException('Pin not found');
    // XH-2 — reaction trên pin ngoài khán giả phải 404: một mutation "thành
    // công" là existence-oracle, vi phạm chính sách không-tiết-lộ-tồn-tại.
    // Chính chủ đi qua (thả/gỡ cảm xúc trên pin trong kho của mình).
    if (pin.creatorId !== userId && !isPinVisibleInCtx(pin, audienceCtx)) {
      throw new NotFoundException('Pin not found');
    }

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
    audienceCtx: PinAudienceCtx,
    filters?: { categorySlug?: string; tagName?: string },
  ): Promise<PaginatedResult<any>> {
    const { first, after } = pagination;
    const take = first + 1; // lấy thêm 1 để check hasNextPage

    const q = this._sqlParams();
    // XH-2 — lọc khán giả TRONG SQL, cấm lọc sau khi fetch (keyset vỡ ngay:
    // first:20 trả 13, cursor lệch). Cùng câu lệnh cho cả 4 hàm feed + search.
    const where = ['"deletedAt" IS NULL', visiblePinSql(audienceCtx, q)];

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

  /**
   * Danh mục CÓ ÍT NHẤT MỘT PIN mà `viewer` thật sự xem được.
   *
   * Vì sao cần hàm này chứ không đếm ở client: `Category` trong SDL không mang
   * số đếm nào, nên frontend không có cách nào biết chip nào sẽ ra lưới rỗng.
   * Trước 26/08/2026 chỗ đó được xử lý bằng một cờ tắt cứng cả dải chip
   * (`explore-section.tsx`) — đúng triệu chứng, sai tầng.
   *
   * ⚠️ BỘ LỌC PHẢI TRÙNG KHỚP `exploreFeed`, KHÔNG ĐƯỢC ĐẾM THÔ. Đếm mọi pin
   * của danh mục là quay lại đúng cái bẫy vừa gỡ, chỉ tinh vi hơn: một danh
   * mục toàn pin ONLYME/CIRCLE/đã hết hạn/của người bị chặn vẫn hiện chip, bấm
   * vào ra lưới trắng — và lần này lỗi chỉ lộ với ĐÚNG người dùng đó, không
   * lộ khi ta tự thử. Ba mệnh đề dưới đây là bản sao y của `exploreFeed`:
   * `deletedAt IS NULL` + `visiblePinSql(ctx)` + loại người bị chặn.
   *
   * `EXISTS` chứ không `COUNT`: câu hỏi là "có hay không", Postgres dừng ngay
   * ở dòng đầu khớp. Index `_PinToCategory_AB_unique(A,B)` dẫn đầu bằng
   * `A`=Category nên tra theo danh mục không cần index mới.
   *
   * ⚠️ `_PinToCategory`: A = Category.id, B = Pin.id (Prisma đặt theo thứ tự
   * chữ cái TÊN MODEL). Đoán ngược không có lỗi cú pháp — câu SQL vẫn chạy và
   * trả sai. Xem chú thích dài ở nhánh `categorySlug` của `exploreFeed`.
   */
  async categoriesWithVisiblePins(
    blockedIds: string[],
    audienceCtx: PinAudienceCtx,
  ): Promise<any[]> {
    const q = this._sqlParams();

    const conds = ['p."deletedAt" IS NULL', visiblePinSql(audienceCtx, q, 'p.')];
    const notInBlocked = this._notInBlocked(q, blockedIds, 'p.');
    if (notInBlocked) conds.push(notInBlocked);

    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c."id", c."name", c."slug", c."icon"
         FROM "Category" c
        WHERE EXISTS (
                SELECT 1
                  FROM "_PinToCategory" pc
                  JOIN "Pin" p ON p."id" = pc."B"
                 WHERE pc."A" = c."id"
                   AND ${conds.join(' AND ')}
              )
        ORDER BY c."name" ASC`,
      ...q.values,
    );
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
    audienceCtx: PinAudienceCtx,
  ): Promise<PaginatedResult<any>> {
    const { first, after } = pagination;
    const take = first + 1;

    const q = this._sqlParams();
    const pinIdParam = q.bind(pinId);

    const srcBlocked = this._notInBlocked(q, blockedIds, 'sp.');
    const rowBlocked = this._notInBlocked(q, blockedIds, 'p.');
    // XH-2 — cùng khuôn hai-chỗ với blockedIds: lọc khán giả áp cho CẢ pin gốc
    // lẫn pin kết quả. Thiếu vế pin gốc thì mở relatedPins của một pin giới hạn
    // vẫn "gợi ý" được nội dung xung quanh nó.
    const srcVisible = visiblePinSql(audienceCtx, q, 'sp.');
    const rowVisible = visiblePinSql(audienceCtx, q, 'p.');

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
            AND ${srcVisible}
            ${srcBlocked ? `AND ${srcBlocked}` : ''}
       )
       SELECT p.*, COUNT(*)::int AS "sharedTagCount"
         FROM "Pin" p
         JOIN "_PinToTag" pt ON pt."A" = p."id"
                            AND pt."B" IN (SELECT tag_id FROM src)
        WHERE p."deletedAt" IS NULL
          AND p."id" <> ${pinIdParam}
          AND ${rowVisible}
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
    audienceCtx: PinAudienceCtx,
    forcedSource?: FeedSource,
    circleId?: string,
  ): Promise<PaginatedResult<any> & { source: FeedSource }> {
    // ── Nguồn THỨ BA: một vòng cụ thể (XH-QĐ-17 / luồng D) ───────────────────
    //
    // Kiểm cặp `source` ⇄ `circleId` TRƯỚC MỌI THỨ KHÁC, và ném ở CẢ HAI chiều
    // sai. Chiều thứ hai (`circleId` gửi kèm nguồn khác) mới là chiều nguy
    // hiểm: bỏ qua im lặng thì client tưởng feed đã lọc theo vòng trong khi nó
    // đang trả nguyên nhánh following — không lỗi nào nổ, dữ liệu trông hợp lý.
    // Cùng lý do `_resolveAudience` ném thay vì "ưu tiên field kia".
    if (forcedSource === FeedSource.CIRCLE || circleId != null) {
      if (forcedSource !== FeedSource.CIRCLE) {
        throw new BadRequestException(
          `circleId only applies when source is CIRCLE (got ${forcedSource ?? 'no source'})`,
        );
      }
      if (circleId == null) {
        throw new BadRequestException('source: CIRCLE requires circleId');
      }
      return this._circleFeed(viewerId, circleId, pagination, blockedIds, audienceCtx);
    }

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
      const explore = await this.exploreFeed(pagination, blockedIds, audienceCtx);
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
    //
    // XH-2 — nhánh FOLLOWING vẫn PHẢI lọc khán giả: viewer theo dõi tác giả
    // nghĩa là vế FOLLOWERS thoả, nhưng pin CIRCLE (không ở trong vòng),
    // ONLY_ME và pin hết hạn thì không. INNER JOIN Follows không thay được bộ
    // lọc.
    const where = ['p."deletedAt" IS NULL', visiblePinSql(audienceCtx, q, 'p.')];

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

  /**
   * Nguồn thứ ba của `homeFeed` — pin đã gửi cho ĐÚNG một vòng.
   *
   * "Nội dung của một vòng" = pin `visibility = CIRCLE` ghim đúng `circleId`
   * đó. KHÔNG phải "pin của những người trong vòng": chỉ chủ vòng ghim được
   * vòng của mình (`_resolveAudience`), nên dưới mắt một THÀNH VIÊN đây đúng
   * là "những gì người ta gửi riêng cho nhóm này", còn dưới mắt CHỦ VÒNG là
   * "mình đã gửi gì cho nhóm này". Gộp thêm pin PUBLIC của các thành viên vào
   * sẽ biến chip vòng thành một bộ lọc người-theo-dõi thứ hai, và pin riêng tư
   * lẫn trong đó thì không còn nhìn ra được nữa.
   *
   * ⚠️ HAI CỬA, KHÔNG PHẢI MỘT:
   *   1. `ownerId = tôi OR tôi là thành viên` — cửa vào chính, 404 nếu trượt.
   *      404 chứ không 403, và CÙNG thông điệp với vòng không tồn tại: "vòng
   *      này có thật và bạn không ở trong đó" là đúng thứ luật 1 của circles
   *      giấu đi.
   *   2. `visiblePinSql` VẪN chạy đầy đủ bên dưới. Cửa 1 đã đủ để chặn người
   *      ngoài, nhưng cửa 2 mới là thứ ẩn pin HẾT HẠN (XH-QĐ-7) — kể cả với
   *      chính chủ, và kể cả pin gửi cho đúng vòng đang mở. Bỏ nó đi thì chip
   *      vòng thành lối vòng qua bộ lọc khán giả, đúng loại rò rỉ §3 liệt kê.
   *
   * `memberCircleIds` KHÔNG dùng để xét quyền vào vòng: nó chỉ chứa vòng tôi
   * là THÀNH VIÊN, không chứa vòng tôi SỞ HỮU (docblock `PinAudienceCtx`), nên
   * chủ vòng sẽ ăn 404 trên chính vòng mình. Phải hỏi `Circle` một câu riêng.
   */
  private async _circleFeed(
    viewerId: string,
    circleId: string,
    pagination: CursorPaginationArgs,
    blockedIds: string[],
    audienceCtx: PinAudienceCtx,
  ): Promise<PaginatedResult<any> & { source: FeedSource }> {
    const circle = await this.prisma.circle.findFirst({
      where: {
        id: circleId,
        OR: [{ ownerId: viewerId }, { members: { some: { userId: viewerId } } }],
      },
      select: { id: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');

    const { first, after } = pagination;
    const take = first + 1;

    const q = this._sqlParams();
    const where = [
      '"deletedAt" IS NULL',
      `"visibility" = 'CIRCLE'`,
      `"audienceCircleId" = ${q.bind(circleId)}`,
      visiblePinSql(audienceCtx, q),
    ];

    if (after) {
      const cursor = decodeCursor(after);
      where.push(
        `("createdAt", "id") < (${q.bind(cursor.createdAt)}::timestamp, ${q.bind(cursor.id)}::text)`,
      );
    }

    // Vòng có thể chứa người mà tôi đã chặn — chủ vòng không thấy được block
    // của tôi nên không cách nào tránh trước. Giữ mệnh đề này để feed vòng
    // không phải là bề mặt duy nhất người bị chặn còn hiện ra.
    const notInBlocked = this._notInBlocked(q, blockedIds);
    if (notInBlocked) where.push(notInBlocked);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Pin"
         WHERE ${where.join('\n           AND ')}
         ORDER BY "createdAt" DESC, "id" DESC
         LIMIT ${q.bind(take)}`,
      ...q.values,
    );

    return { ...this._buildPaginatedResult(rows, first), source: FeedSource.CIRCLE };
  }

  // ─── User Pins ───────────────────────────────────────────────────────────────

  /**
   * Pins của một user cụ thể — cursor pagination tương tự.
   */
  async userPins(
    creatorId: string,
    pagination: CursorPaginationArgs,
    blockedIds: string[],
    audienceCtx: PinAudienceCtx,
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
    // XH-2 — hồ sơ là bề mặt rò rỉ kinh điển: khách mở hồ sơ của tác giả thì
    // chỉ được thấy pin PUBLIC còn sống. Chính chủ xem hồ sơ mình vẫn thấy đủ
    // 4 cấp (vế `creatorId = viewer` trong bộ lọc) — trừ pin hết hạn, thứ đã
    // dọn về kho.
    const where = [
      '"deletedAt" IS NULL',
      `"creatorId" = ${q.bind(creatorId)}`,
      visiblePinSql(audienceCtx, q),
    ];

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

  // ─── Kho (archive) + đăng lại — XH-6 ────────────────────────────────────────

  /**
   * Kho của CHÍNH người gọi: pin đã hết hạn, mới nhất trước.
   *
   * VÌ SAO LÀ MỘT QUERY RIÊNG chứ không phải một cờ của `userPins`
   * (`visible-pins.util.ts` nói cùng điều này ở đầu bên kia): theo XH-QĐ-6/7
   * pin hết hạn "biến mất khỏi mọi luồng, tìm kiếm, hồ sơ" — KỂ CẢ hồ sơ của
   * chính chủ. Một tham số `includeExpired` trên `userPins` sẽ đặt cái quyết
   * định đó vào tay client, và chỉ cần một chỗ gọi quên gửi `false` là pin hết
   * hạn quay lại lưới công khai. Ở đây khán giả là hằng số: chỉ một người.
   *
   * Vì thế bộ lọc KHÁC HẲN `visiblePinSql` và cố ý không gọi nó:
   *   · `creatorId = viewer` — khán giả đúng một người, nên không cần vế nào
   *     của bộ lọc khán giả (và cũng không cần lọc chặn: không ai tự chặn mình);
   *   · `expiresAt <= now()` — ĐẢO NGƯỢC vế hết hạn của bộ lọc kia. Đây là bề
   *     mặt DUY NHẤT trong cả dự án mà pin quá hạn được phép hiện ra danh sách.
   *
   * Keyset `(createdAt, id) DESC` giống hệt `userPins` — cùng `decodeCursor`,
   * cùng `_buildPaginatedResult`, nên cursor của hai bề mặt cùng hình dạng và
   * `PaginatedPins` dùng lại được nguyên vẹn.
   */
  async archivedPins(
    viewerId: string,
    pagination: CursorPaginationArgs,
  ): Promise<PaginatedResult<any>> {
    const { first, after } = pagination;
    const take = first + 1;

    const q = this._sqlParams();
    const where = [
      '"deletedAt" IS NULL',
      `"creatorId" = ${q.bind(viewerId)}`,
      '"expiresAt" IS NOT NULL',
      '"expiresAt" <= now()',
    ];

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

  /**
   * Đăng lại một pin từ kho — gỡ hạn sống (`expiresAt = null`).
   *
   * "Kho là kho, không phải nghĩa địa" (`xahoi-tinh-nang.md` §5). Chỉ chủ pin
   * gọi được; pin của người khác trả 404 CHỨ KHÔNG 403, cùng chính sách với
   * mọi bề mặt pin khác — 403 tự nó đã xác nhận pin đó có thật.
   *
   * ⚠️ KHÔNG ĐỘNG VÀO `createdAt`. Bản vẽ chốt ngày 24/08 (QĐ-24) nói pin quay
   * về ĐÚNG VỊ TRÍ THEO NGÀY ĐĂNG GỐC chứ không nhảy lên đầu feed — mà thứ tự
   * feed là keyset `(createdAt, id) DESC`, nên "không làm gì cả" chính là cách
   * thực hiện yêu cầu đó. Một dòng `createdAt: new Date()` thêm vào đây (rất dễ
   * nghĩ là "đăng lại thì mới") sẽ đảo ngược quyết định của chủ dự án và còn
   * làm cursor của những trang đang mở trỏ sai chỗ.
   *
   * Pin vốn không có hạn ⇒ 400 chứ không phải no-op thành công: nút này chỉ
   * hiện trong kho, nên một lời gọi trên pin thường là client hiểu sai trạng
   * thái — im lặng trả "thành công" sẽ giấu đúng cái hiểu sai đó.
   */
  async republishPin(userId: string, pinId: string) {
    // `findFirst` chứ không `findUnique` — middleware soft-delete không chặn
    // findUnique (prisma.service.ts). Cùng khuôn với `updatePin`/`deletePin`.
    const pin = await this.prisma.pin.findFirst({ where: { id: pinId } });

    if (!pin || pin.deletedAt) {
      throw new NotFoundException('Pin not found');
    }
    if (pin.creatorId !== userId) {
      throw new NotFoundException('Pin not found');
    }
    if (pin.expiresAt == null) {
      throw new BadRequestException('Pin has no expiry to remove');
    }

    return this.prisma.pin.update({
      where: { id: pinId },
      data: { expiresAt: null },
    });
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
