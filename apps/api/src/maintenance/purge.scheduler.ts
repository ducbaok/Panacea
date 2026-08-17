import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';
import { PurgeService } from './purge.service';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PurgeScheduler — LỚP KÍCH HOẠT, cố ý tách khỏi logic                    ║
 * ║                                                                          ║
 * ║  File này chỉ trả lời câu "KHI NÀO chạy". Câu "chạy CÁI GÌ" nằm trọn ở   ║
 * ║  `PurgeService`, và bề mặt để kiểm chứng nằm ở `PurgeController`. Tách   ║
 * ║  ba thứ đó là có chủ đích: lịch chạy là quyết định VẬN HÀNH (đổi theo    ║
 * ║  môi trường, theo số container, theo việc đã có EventBridge hay chưa),   ║
 * ║  còn logic xoá là quyết định NGHIỆP VỤ. Trộn chúng lại thì mỗi lần đổi   ║
 * ║  chỗ deploy là một lần đụng vào code xoá dữ liệu.                        ║
 * ║  Phân tích đầy đủ + khi nào KHÔNG nên tách như vầy: `LEARNING_NOTES.md`  ║
 * ║  §30.                                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/** Khoá chống hai instance cùng purge. TTL > thời gian chạy tối đa dự kiến. */
const PURGE_LOCK_KEY = 'purge:accounts:lock';
const PURGE_LOCK_TTL_SEC = 3600;

@Injectable()
export class PurgeScheduler {
  private readonly logger = new Logger(PurgeScheduler.name);

  constructor(
    private readonly purgeService: PurgeService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * 03:00 mỗi ngày — giờ thấp điểm, và cách xa mọi mốc báo cáo.
   *
   * ⚠️ `@Cron` chạy trong TỪNG tiến trình API. Hôm nay `PLAN_DEPLOYMENT.md`
   * chốt 2 task (1 API + 1 Web) nên chỉ có một bản chạy, nhưng "hôm nay chỉ có
   * một" là thứ hết hạn im lặng đúng vào lúc ai đó tăng desired count. Khoá
   * Redis bên dưới làm cho việc scale KHÔNG còn là quyết định có hệ quả ở đây.
   * (Cùng bài học với brute-force limiter: `Map` in-memory đúng cho tới đúng
   * cái ngày lên multi-task — `docs/debug_history.md` §19.)
   */
  @Cron('0 3 * * *')
  async handleDailyPurge(): Promise<void> {
    // ── Khoá: SET NX EX, đúng khuôn đã dùng ở `auth.service.ts:661` ──────────
    //
    // 🔴 FAIL-CLOSED, NGƯỢC HẲN VỚI LIMITER. Brute-force limiter cố ý
    // fail-OPEN khi Redis chết (thà cho đăng nhập còn hơn khoá cả hệ thống).
    // Ở đây phải ngược lại: Redis chết ⇒ **không biết** có instance nào đang
    // xoá hay không ⇒ BỎ QUA lượt này. Bỏ lỡ một đêm purge là chuyện không ai
    // nhận ra; hai instance cùng cascade-delete một tập user thì không.
    let lock: string | null = null;
    try {
      lock = await this.redis.set(PURGE_LOCK_KEY, '1', 'EX', PURGE_LOCK_TTL_SEC, 'NX');
    } catch (e) {
      this.logger.warn(
        `[purge] không lấy được khoá Redis (${(e as Error).message}) — BỎ QUA lượt này (fail-closed)`,
      );
      return;
    }
    if (lock === null) {
      this.logger.log('[purge] một instance khác đang chạy — bỏ qua lượt này');
      return;
    }

    try {
      // `dryRun: false` — đây là lần chạy thật. Không truyền `graceDays`: hạn
      // ân hạn của job theo lịch LUÔN là hằng số nghiệp vụ 30 ngày.
      const report = await this.purgeService.purgeDeletedAccounts({ dryRun: false });
      this.logger.log(
        `[purge] cron xong · found=${report.found} purged=${report.purged}${report.capped ? ' · CÒN DƯ, lượt sau dọn tiếp' : ''}`,
      );
    } catch (e) {
      // Nuốt lỗi có chủ đích: `@nestjs/schedule` không có retry, và một exception
      // thoát ra khỏi cron handler chỉ thành `unhandledRejection`. Ghi log rồi
      // để lượt sau chạy lại — job này idempotent theo bản chất (bản ghi đã xoá
      // thì lần sau không còn trong danh sách ứng viên).
      this.logger.error(`[purge] cron THẤT BẠI: ${(e as Error).message}`);
    } finally {
      // Nhả khoá sớm thay vì chờ hết TTL, để lần chạy tay ngay sau đó không bị
      // chặn oan. TTL vẫn là lưới an toàn nếu tiến trình chết giữa chừng.
      await this.redis.del(PURGE_LOCK_KEY).catch(() => undefined);
    }
  }
}
