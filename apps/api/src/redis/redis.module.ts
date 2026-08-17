import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { serializePubSubPayload, deserializePubSubPayload } from './pubsub-serde';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const PUB_SUB = 'PUB_SUB';

/**
 * RedisModule — nguồn DUY NHẤT của `REDIS_CLIENT` và `PUB_SUB` trong app.
 *
 * HƯỚNG DẪN CODE LẠI — REDIS_CLIENT:
 * 1. Đọc `redis.url` từ ConfigService (map sang env `REDIS_URL`).
 * 2. Tạo `new Redis(url, {...})` với retryStrategy có backoff (times * 100, trần 3000ms).
 * 3. BẮT BUỘC gắn `.on('error')`. ioredis là EventEmitter: sự kiện `error`
 *    KHÔNG có listener sẽ thành uncaught exception và **chết cả process**.
 *    Đây là lỗi đã tồn tại ở bản `common/pubsub/` (đã xoá 01/08/2026).
 *
 * HƯỚNG DẪN CODE LẠI — PUB_SUB (RedisPubSub cho GraphQL Subscriptions):
 * 1. Publisher: **tái dùng** `REDIS_CLIENT`, không tạo connection mới.
 *    Tiết kiệm 1 kết nối; publish không đẩy connection vào subscriber mode.
 * 2. Subscriber: PHẢI là connection RIÊNG → `redisClient.duplicate()`.
 *    Lý do: một connection Redis đang ở subscriber mode chỉ chạy được
 *    các lệnh SUBSCRIBE/UNSUBSCRIBE — dùng chung sẽ hỏng mọi lệnh khác.
 * 3. Trả về `new RedisPubSub({ publisher, subscriber })`.
 * ⇒ Tổng cộng 2 kết nối Redis cho toàn app.
 *
 * ⚠️ ĐỪNG tạo provider `'PUB_SUB'` thứ hai ở nơi khác. Token của Nest là
 * chuỗi, so sánh THEO GIÁ TRỊ — đường dẫn import không phân biệt được chúng.
 * Provider trùng token trong scope của một module sẽ che mất provider global này.
 *
 * 📌 Lưu ý mở rộng — ĐÃ TỚI LÚC ĐÓ, VÀ ĐÃ CÂN NHẮC RỒI QUYẾT ĐỊNH CHƯA TÁCH.
 * Publisher dùng chung `REDIS_CLIENT` với phần còn lại của app. Từ Đợt 7
 * (10/08/2026) `AuthService` cũng chạy `TTL`/`INCR`/`EXPIRE`/`SET`/`DEL` trên
 * đúng connection đó, nên PUBLISH và limiter giờ THẬT SỰ xếp hàng chung.
 *
 * Vẫn giữ nguyên một connection, có chủ đích:
 *   • ioredis pipeline lệnh trên một connection — đây là tranh THỨ TỰ, không
 *     phải tranh khoá; không lệnh nào chặn lệnh nào quá vài chục micro-giây.
 *   • Lưu lượng thật của limiter là vài lệnh MỖI LẦN ĐĂNG NHẬP SAI. Ở quy mô
 *     hiện tại (1 tiến trình, tải test) chưa đo được ảnh hưởng nào.
 *   • Tách ra là +1 kết nối Redis cho TOÀN APP để đổi lấy một lợi ích chưa
 *     đo được.
 *
 * ⚠️ Mốc để làm: khi limiter bị dùng nhiều (đăng nhập sai ở mức tấn công thật)
 * HOẶC khi có lệnh Redis chậm/chặn nào đó chạy trên `REDIS_CLIENT` (SCAN, Lua
 * dài, BLPOP). Cách gỡ vẫn là tách publisher thành `.duplicate()` riêng —
 * một dòng, không ảnh hưởng subscriber.
 *
 * ⚠️ Nếu tách: publisher mới PHẢI GIỮ `commandTimeout` (tức `.duplicate()`
 * trần, KHÔNG copy cái override `{ commandTimeout: undefined }` của subscriber).
 * Publisher là nơi `commandTimeout` có ích nhất — xem khối bên dưới.
 */
/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  commandTimeout — vì sao 500ms, và vì sao subscriber KHÔNG có nó          ║
 * ║                                                                          ║
 * ║  VẤN ĐỀ ĐO ĐƯỢC (Đợt 7, 10/08/2026): khi Redis chết, brute-force limiter ║
 * ║  fail-OPEN đúng như thiết kế — login vẫn trả 200, không 500, không 403 —  ║
 * ║  NHƯNG độ trễ nổ từ ~250ms lên **7–24 GIÂY**:                            ║
 * ║                                                                          ║
 * ║      docker compose stop redis                                           ║
 * ║      login ĐÚNG mật khẩu → 200 (7 260ms) … → 200 (23 725ms)              ║
 * ║                                                                          ║
 * ║  Nguyên nhân KHÔNG nằm ở `auth.service.ts` mà ở đây: `enableOfflineQueue` ║
 * ║  mặc định `true` nên lệnh bị XẾP HÀNG trong lúc mất kết nối, còn          ║
 * ║  `maxRetriesPerRequest: 3` + `retryStrategy` trần 3000ms nghĩa là mỗi     ║
 * ║  lệnh chờ tới ~9 giây mới chịu bị từ chối. Ở tải thật, một sự cố Redis    ║
 * ║  vài phút biến đăng nhập thành 20 giây/request — đủ để cạn connection     ║
 * ║  pool và chạm timeout của client. **Về logic là fail-open, về sản phẩm    ║
 * ║  vẫn là sự cố.**                                                         ║
 * ║                                                                          ║
 * ║  CHỌN 500ms THEO SỐ ĐO, không theo cảm tính. PING ×200 từ Node qua đúng   ║
 * ║  socket mà API dùng: **p50 = 0,40ms · p95 = 0,68ms · p99 = 0,98ms ·       ║
 * ║  max = 1,85ms**. 500ms là ~270× giá trị lớn nhất từng đo, nên một lệnh    ║
 * ║  khoẻ mạnh không thể chạm ngưỡng; đồng thời nó chặn trần thiệt hại lúc    ║
 * ║  Redis chết ở ~1 giây cho cả đường login (login chạy tối đa 2 lệnh).      ║
 * ║                                                                          ║
 * ║  Không chọn nhỏ hơn (100–300ms) vì `commandTimeout` đếm giờ trên event    ║
 * ║  loop: một khoảng nghẽn do GC hay burst đồng thời có thể đẩy một lệnh     ║
 * ║  khoẻ mạnh qua ngưỡng, và **timeout giả ở đây = limiter im lặng tắt**     ║
 * ║  (fail-open). Thà chậm 1 giây trong sự cố còn hơn tự tắt bảo vệ lúc bình  ║
 * ║  thường. (`bcrypt` async chạy trên threadpool của libuv nên KHÔNG chặn    ║
 * ║  event loop — đã kiểm; nếu nó chặn thì con số này phải nới rộng.)         ║
 * ║                                                                          ║
 * ║  ⚠️ SUBSCRIBER CỐ Ý ĐƯỢC MIỄN. `duplicate(override)` của ioredis là       ║
 * ║  `new Redis({ ...this.options, ...override })` ⇒ nó **kế thừa nguyên**    ║
 * ║  `commandTimeout` nếu không ghi đè. Với connection subscriber thì đó là   ║
 * ║  rủi ro không đổi lấy gì: vấn đề cần sửa nằm trên đường LOGIN, còn        ║
 * ║  `SUBSCRIBE` chạm ngưỡng chỉ làm GraphQL subscription dựng hụt. Nó vốn    ║
 * ║  đã bị chặn trên bởi `maxRetriesPerRequest: 3`, nên miễn ở đây là         ║
 * ║  **giữ nguyên hành vi cũ**, không phải bỏ sót.                           ║
 * ║  `commandTimeout: undefined` tắt hẳn vì ioredis chỉ bật khi              ║
 * ║  `typeof options.commandTimeout === 'number'` (Redis.js:341).            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
const REDIS_COMMAND_TIMEOUT_MS = 500;

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('redis.url')!;
        const client = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 100, 3000),
          lazyConnect: false,
          commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        });

        client.on('connect', () => console.log('[Redis] Connected'));
        client.on('error', (err) => console.error('[Redis] Error:', err.message));

        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: PUB_SUB,
      useFactory: (redisClient: Redis) => {
        return new RedisPubSub({
          // Publisher dùng chung `REDIS_CLIENT` ⇒ `PUBLISH` CÓ `commandTimeout`.
          // Đó là chủ đích: publish treo 9 giây thì mutation gọi nó cũng treo
          // theo (`messages.service.ts:182` cố ý `await`). Xem cảnh báo về
          // unhandled rejection ở `notifications.service.ts`.
          publisher: redisClient,
          // Subscriber được MIỄN commandTimeout — xem khối giải thích bên trên.
          subscriber: redisClient.duplicate({ commandTimeout: undefined }),
          // Vận chuyển GIỮ KIỂU `Date` thay vì `JSON.stringify`/`JSON.parse`
          // trần. Thiếu cặp này thì MỌI subscription chọn một field `DateTime`
          // đều trả `data: null` + lỗi serialize. Nguyên nhân gốc + vì sao
          // không dùng `reviver`: `pubsub-serde.ts`.
          serializer: serializePubSubPayload,
          deserializer: deserializePubSubPayload,
        });
      },
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [REDIS_CLIENT, PUB_SUB],
})
export class RedisModule {}
