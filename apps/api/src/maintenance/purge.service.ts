import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PurgeService — B-9: hard-delete tài khoản đã xoá mềm quá 30 ngày        ║
 * ║                                                                          ║
 * ║  Đây là job XOÁ THẬT, CÓ CASCADE, và là thứ ĐẦU TIÊN trong dự án kích    ║
 * ║  hoạt cascade của `User` ở quy mô thật. Đọc hết khối này trước khi sửa.  ║
 * ║                                                                          ║
 * ║  ─── SỨC CÔNG PHÁ (đo từ schema.prisma, 17/08/2026) ────────────────     ║
 * ║  Xoá 1 `User` kéo cascade qua **18 model**: Account · Session ·          ║
 * ║  VerificationToken · RefreshToken · DeviceToken · Follows (cả 2 vai) ·   ║
 * ║  BlockedUser (cả 2 vai) · Pin · Board · BoardCollaborator · SavedPin ·   ║
 * ║  Reaction · Comment · CommentReaction · ConversationMember · Message ·   ║
 * ║  Notification (cả `recipient` LẪN `actor`).                             ║
 * ║                                                                          ║
 * ║  🔴 BA HỆ QUẢ RƠI VÀO TÀI KHOẢN KHÔNG HỀ XOÁ GÌ — đã báo user 17/08:     ║
 * ║    • `Message.sender` Cascade  ⇒ tin nhắn của người đã xoá BIẾN MẤT      ║
 * ║      khỏi hộp thoại của người còn lại (đoạn chat thủng lỗ).             ║
 * ║    • `Notification.actor` Cascade ⇒ thông báo *về* họ biến khỏi hộp thư  ║
 * ║      người khác.                                                         ║
 * ║    • `Comment.user` Cascade ⇒ bình luận của họ trên pin người khác mất.  ║
 * ║  (Ngược lại `Comment.parent` là SetNull ⇒ reply của người khác SỐNG,     ║
 * ║   chỉ nổi lên thành comment gốc. Đó là hành vi đúng.)                    ║
 * ║                                                                          ║
 * ║  Đây là hành vi CÓ SẴN trong schema, không phải thứ B-9 tạo ra. Ghi lại  ║
 * ║  ở đây vì đây là chỗ duy nhất nó thành hiện thực.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/** Quyết định #5 / BR-25: soft delete → hard delete sau **30 ngày**. */
export const PURGE_GRACE_DAYS = 30;

/**
 * Trần số tài khoản xoá trong MỘT lần chạy.
 *
 * Không phải để tối ưu, mà là **cầu chì**: một lỗi logic ở mệnh đề lọc sẽ xoá
 * tối đa chừng này rồi dừng, thay vì quét sạch bảng trong một nhát. Còn dư thì
 * lần chạy sau dọn tiếp — job này chạy hằng ngày, không có gì gấp.
 */
export const PURGE_DEFAULT_LIMIT = 100;

export interface PurgeReport {
  /** `true` = chỉ liệt kê, KHÔNG xoá. Mặc định của service là `true`. */
  dryRun: boolean;
  /** Số ngày ân hạn THỰC SỰ được áp dụng (xem `graceOverrideIgnored`). */
  graceDays: number;
  /** Mốc thời gian: tài khoản có `deletedAt` cũ hơn mốc này mới bị xoá. */
  cutoff: string;
  /** Số tài khoản đủ điều kiện tìm được (đã cắt theo `limit`). */
  found: number;
  /** Số tài khoản THỰC SỰ bị xoá cứng. `0` khi `dryRun`. */
  purged: number;
  /** Danh sách id — cùng một danh sách dùng cho cả liệt kê lẫn lệnh xoá. */
  userIds: string[];
  /** `true` khi còn tài khoản đủ điều kiện ngoài `limit` (lần sau dọn tiếp). */
  capped: boolean;
  /** `true` khi caller gửi `graceDays` nhưng môi trường production bỏ qua nó. */
  graceOverrideIgnored: boolean;
}

@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Tìm (và tuỳ chọn xoá) tài khoản đã xoá mềm quá hạn ân hạn.
   *
   * ⚠️ **DRY-RUN LÀ MẶC ĐỊNH.** Xoá thật phải truyền `dryRun: false` tường
   * minh. Với một job xoá có cascade 18 bảng thì mặc định an toàn không phải
   * lịch sự — nó là thứ ngăn một lời gọi nhầm khỏi thành sự cố dữ liệu.
   */
  async purgeDeletedAccounts(
    options: { dryRun?: boolean; limit?: number; graceDays?: number } = {},
  ): Promise<PurgeReport> {
    const dryRun = options.dryRun ?? true;
    const limit = Math.max(1, Math.min(options.limit ?? PURGE_DEFAULT_LIMIT, PURGE_DEFAULT_LIMIT));

    // ── Hạn ân hạn: cho phép ghi đè, NHƯNG KHÔNG trên production ──────────────
    //
    // VÌ SAO CẦN GHI ĐÈ: bộ verify không thể chờ 30 ngày để có một bản ghi đủ
    // tuổi, mà "đường code chưa từng chạy" chính là hình dạng hỏng mà dự án đã
    // trả giá nhiều lần (endpoint `/internal/pins/:id/processed` chết 100% từ
    // ngày viết — `docs/debug_history.md` §2 Bug D). Không có đường này thì
    // nhánh XOÁ THẬT của B-9 vĩnh viễn không có bằng chứng.
    //
    // VÌ SAO CHẶN TRÊN PRODUCTION: hạn ân hạn 30 ngày CHÍNH LÀ tính năng —
    // nó là cửa sổ để người đổi ý lấy lại tài khoản. Ai cầm `INTERNAL_API_SECRET`
    // vốn đã xoá được mọi tài khoản QUÁ HẠN; cho họ chọn luôn hạn thì thành xoá
    // được cả tài khoản vừa xoá một giây trước — đó là leo thang thật, không
    // phải lo xa. Chặn ở đây là đánh đổi có chủ đích, và `graceOverrideIgnored`
    // trong report nói thật cho caller biết nó đã bị bỏ qua.
    const isProduction = this.configService.get<string>('nodeEnv') === 'production'
      || process.env.NODE_ENV === 'production';
    const wantsOverride = options.graceDays !== undefined;
    const graceOverrideIgnored = wantsOverride && isProduction;
    const graceDays = graceOverrideIgnored || !wantsOverride
      ? PURGE_GRACE_DAYS
      : Math.max(0, options.graceDays!);

    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

    // ── Tìm ứng viên ─────────────────────────────────────────────────────────
    //
    // 🔴 BẮT BUỘC DÙNG RAW SQL, KHÔNG DÙNG `prisma.user.findMany`.
    //
    // Middleware soft-delete (`prisma.service.ts:60-63`) chặn `findMany` và
    // `findFirst` cho `User`, và cách nó chặn là:
    //     params.args.where = { ...params.args.where, deletedAt: null }
    // — tức `deletedAt: null` nằm SAU cùng nên nó **GHI ĐÈ** điều kiện của ta.
    // `findMany({ where: { deletedAt: { lt: cutoff } } })` sẽ lặng lẽ biến
    // thành `deletedAt: null` và trả về **0 dòng**. Không exception, không
    // cảnh báo, không dòng log nào — job chạy mỗi đêm và không bao giờ xoá gì,
    // mà mọi phép kiểm "job có chạy không" đều xanh.
    //
    // Đây đúng là ngoại lệ hợp lệ mà `AGENT_HANDOFF.md` §3.3 mô tả: **cố ý**
    // muốn thấy bản ghi đã xoá ⇒ đi đường không qua middleware và ghi comment
    // nói rõ (cùng nếp `_assertEmailNotSoftDeleted`).
    //
    // Lấy `limit + 1` để biết còn dư hay không mà không phải đếm lần hai.
    const rows = await this.prisma.$queryRaw<Array<{ id: string; deletedAt: Date }>>`
      SELECT "id", "deletedAt"
        FROM "User"
       WHERE "deletedAt" IS NOT NULL
         AND "deletedAt" < ${cutoff}
       ORDER BY "deletedAt" ASC
       LIMIT ${limit + 1}
    `;

    const capped = rows.length > limit;
    const candidates = capped ? rows.slice(0, limit) : rows;

    // ── Kiểm lại BẤT BIẾN trong JS trước khi xoá ─────────────────────────────
    //
    // Chủ ý KHÔNG dùng danh sách chặn theo id/email (kiểu "đừng đụng
    // user_1_id"): danh sách như vậy bảo vệ đúng những cái tên ta nghĩ ra
    // được, và im lặng để lọt mọi thứ khác — trong khi thứ cần bảo vệ là
    // **điều kiện**, không phải danh tính. Ở đây khẳng định lại đúng cái điều
    // kiện mà câu SQL vừa hứa; lệch một chút là ném ngay, chưa xoá gì cả.
    for (const r of candidates) {
      const at = r.deletedAt instanceof Date ? r.deletedAt : new Date(r.deletedAt);
      if (!r.deletedAt || isNaN(at.getTime()) || at >= cutoff) {
        throw new Error(
          `[purge] BẤT BIẾN VỠ: ${r.id} có deletedAt=${String(r.deletedAt)} không cũ hơn mốc ${cutoff.toISOString()} — DỪNG, không xoá gì`,
        );
      }
    }

    const userIds = candidates.map((r) => r.id);

    const report: PurgeReport = {
      dryRun,
      graceDays,
      cutoff: cutoff.toISOString(),
      found: userIds.length,
      purged: 0,
      userIds,
      capped,
      graceOverrideIgnored,
    };

    if (dryRun || userIds.length === 0) {
      this.logger.log(
        `[purge] ${dryRun ? 'DRY-RUN' : 'không có ứng viên'} · grace=${graceDays}d · cutoff=${report.cutoff} · found=${userIds.length}${capped ? ' (còn dư)' : ''}` +
          (userIds.length ? ` · ids=${userIds.join(',')}` : ''),
      );
      return report;
    }

    // ── Xoá thật ─────────────────────────────────────────────────────────────
    //
    // Xoá theo **danh sách id đã kiểm** chứ không chạy lại mệnh đề lọc. Nhờ đó
    // lệnh xoá không thể chạm bản ghi nào mà bản dry-run không liệt kê ra —
    // kể cả khi có bản ghi mới đủ điều kiện chen vào giữa hai lời gọi.
    //
    // `deleteMany` KHÔNG bị middleware soft-delete chạm tới (nó chỉ chặn
    // `findMany`/`findFirst`), nên đây là xoá cứng thật. Cascade xảy ra ở tầng
    // DB qua FK `ON DELETE CASCADE` — xem khối sức-công-phá ở đầu file.
    this.logger.warn(
      `[purge] XOÁ CỨNG ${userIds.length} tài khoản (grace=${graceDays}d, cutoff=${report.cutoff}): ${userIds.join(',')}`,
    );
    const result = await this.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    report.purged = result.count;

    this.logger.warn(`[purge] đã xoá ${result.count}/${userIds.length} tài khoản`);
    return report;
  }
}
