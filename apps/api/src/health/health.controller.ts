import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';

import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  HealthController — HT-3 lỗ hổng #2                                      ║
 * ║                                                                          ║
 * ║  🔴 ĐỎ-TRƯỚC ĐO ĐƯỢC 17/08/2026, VÀ NÓ NẶNG HƠN TÀI LIỆU GHI.            ║
 * ║  `PLAN_HATANG.md` §1 ghi *"`app.controller.ts` chỉ có `@Get()` →         ║
 * ║  `getHello()`"*, tức giả định có một endpoint hời hợt. Sự thật: `curl`   ║
 * ║  `GET /` trả **404** — `AppController` **chưa từng được đăng ký** trong  ║
 * ║  `AppModule` (`controllers` của nó rỗng). Tức là **không có** endpoint   ║
 * ║  health nào, kể cả loại vô dụng.                                        ║
 * ║                                                                          ║
 * ║  Hệ quả trên ECS còn tệ hơn "xanh giả": ALB health check trỏ vào `/` sẽ  ║
 * ║  nhận 404 với MỌI task ⇒ không task nào từng healthy ⇒ dịch vụ không     ║
 * ║  bao giờ lên. `AppController`/`AppService` là di sản `nest new`, không   ║
 * ║  nơi nào tham chiếu — đã xoá cùng đợt này.                              ║
 * ║                                                                          ║
 * ║  ⚠️ REDIS MẤT ⇒ **degraded, KHÔNG 503** — quyết định đã ghi ở            ║
 * ║  `PLAN_HATANG.md` §HT-3. Lý do: brute-force limiter cố ý **fail-OPEN**   ║
 * ║  (§19), nên Redis chết thì đăng nhập/đọc/ghi vẫn chạy đúng, chỉ mất lớp  ║
 * ║  bảo vệ và mất subscription. Trả 503 ở đây là biến một suy giảm cục bộ   ║
 * ║  thành **mất toàn bộ dịch vụ**: ALB rút hết task khỏi target group.      ║
 * ║  Đúng là "đừng biến fail-open thành fail-closed ở tầng health".         ║
 * ║  DB mất thì ngược lại — không có gì trong app chạy được nếu thiếu DB.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * Trần thời gian cho MỖI phép thăm dò.
 *
 * Bản thân endpoint health không được phép treo: ALB có hạn chờ riêng, và một
 * health check treo bị tính là **fail** sau khi đã giữ một connection suốt thời
 * gian đó. `REDIS_CLIENT` đã có `commandTimeout: 500` nên nhánh Redis tự có
 * trần; nhánh Prisma thì không, nên phải bọc.
 */
const PROBE_TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

interface DependencyStatus {
  ok: boolean;
  error?: string;
}

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check thật — chạm DB và Redis (HT-3 #2)' })
  @ApiResponse({ status: 200, description: 'ok (mọi thứ chạy) hoặc degraded (Redis mất).' })
  @ApiResponse({ status: 503, description: 'unhealthy — mất DB.' })
  async health() {
    const [db, redis] = await Promise.all([this._checkDb(), this._checkRedis()]);

    const body = {
      status: db.ok ? (redis.ok ? 'ok' : 'degraded') : 'unhealthy',
      db,
      redis,
      uptimeSec: Math.round(process.uptime()),
    };

    // Chỉ DB mới hạ được task xuống unhealthy — xem khối giải thích ở đầu file.
    if (!db.ok) throw new ServiceUnavailableException(body);
    return body;
  }

  /**
   * `SELECT 1` — cố ý là câu rẻ nhất chạm THẬT tới server.
   *
   * Không dùng `$connect()` hay đếm bản ghi: cái đầu có thể trả về ngay từ
   * trạng thái pool đã cache (xanh trong khi server đã chết), cái sau đắt và
   * đổi theo dữ liệu. Bài học "healthy chỉ chứng minh container tự nói chuyện
   * được với chính nó" (`LEARNING_NOTES.md` §11) áp dụng nguyên xi ở đây.
   */
  private async _checkDb(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  }

  private async _checkRedis(): Promise<DependencyStatus> {
    try {
      const pong = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS);
      return pong === 'PONG' ? { ok: true } : { ok: false, error: `PING trả "${pong}"` };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  }
}
