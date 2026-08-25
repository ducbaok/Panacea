// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Bộ đếm `pincreate:<userId>` — trạng thái SỐNG LÂU mà XH-4b vừa đẻ ra     ║
// ║                                                                          ║
// ║  Trần 10 pin/phút (XH-4b · XH-QĐ-12) là hành vi sản phẩm THẬT, nên bộ    ║
// ║  verify chạy với đúng cấu hình mặc định của nó chứ không nới ra cho dễ   ║
// ║  chạy. Cái giá phải trả: mọi bước đăng pin bằng CÙNG một tài khoản giờ   ║
// ║  chia nhau một hạn mức 60 giây — bước 74/75/76 đều đăng pin bằng `bao`   ║
// ║  và chạy sát nhau, nên bước sau có thể đỏ vì bước TRƯỚC đã tiêu hết      ║
// ║  quota. Đúng khuôn hỏng dây chuyền mà luật "tự dọn state Ở ĐẦU BƯỚC" ra  ║
// ║  đời để chặn (`xahoi-phi-chuc-nang.md` §5.2) — và là lần thứ NĂM dự án   ║
// ║  gặp nó, sau `login:*`, `SavedPin`, `track:*`, residue 73→74.            ║
// ║                                                                          ║
// ║  Vì vậy: bước nào đăng pin thì gọi `clearPinRate` Ở ĐẦU BƯỚC. Không có   ║
// ║  Redis ⇒ trả `null`; bên gọi ghi vào `detail` chứ KHÔNG được coi là đã   ║
// ║  dọn — nhưng cũng không phát SKIP, vì đây là khâu DỌN, không phải phép   ║
// ║  đo. Phép đo thật của trần này nằm trọn ở bước 77.                       ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { readApiEnv } from './client.mjs';
import { connectRedis } from './redis-probe.mjs';

/**
 * Cửa sổ đếm, giây. Hằng số này là BẢN SAO của `PIN_CREATE_WINDOW_SEC` trong
 * `pins.service.ts` — cố ý viết lại chứ không import, cùng lý do `keyHash` của
 * bước 69: nếu server đổi cửa sổ mà không ai sửa ở đây thì phép kiểm TTL của
 * bước 77 phải ĐỎ, chứ không được im lặng trôi theo.
 */
export const PIN_RATE_WINDOW_SEC = 60;

/** Hình dạng khoá, cũng là một hợp đồng được bước 77 kiểm chứng độc lập. */
export const pinRateKey = (userId) => `pincreate:${userId}`;

/** Trần đang chạy thật của API (đọc `apps/api/.env`), mặc định 10. */
export const pinCreatePerMin = () => {
  const n = Number(readApiEnv('PIN_CREATE_PER_MIN') ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
};

/**
 * Mở MỘT kết nối Redis dùng lại được, cho bước nào phải gỡ trần trước MỖI lời
 * gọi `createPin` (bước 74: hơn 30 lời gọi, kể cả các phép ÂM — request bị từ
 * chối vẫn tiêu quota vì chốt đứng TRƯỚC validate). `clearPinRate` mở rồi đóng
 * một kết nối mỗi lần, dùng cho việc dọn MỘT lần ở đầu bước; hàm này dùng cho
 * việc gỡ lặp lại.
 *
 * Không có Redis ⇒ vẫn trả về đối tượng dùng được (`ok: false`, `clear` không
 * làm gì): lúc đó trần đang fail-open nên chẳng có gì phải gỡ.
 */
export async function openPinRateCleaner() {
  const redis = await connectRedis(readApiEnv('REDIS_URL'));
  if (!redis) return { ok: false, clear: async () => null, close: () => {} };
  return {
    ok: true,
    clear: async (userIds) => {
      const v = await redis.cmd('DEL', ...userIds.map(pinRateKey));
      return v instanceof Error ? null : Number(v);
    },
    close: () => redis.close(),
  };
}

/**
 * Xoá bộ đếm tạo pin của một danh sách user.
 *
 * @returns số khoá thực sự bị xoá, hoặc `null` nếu không kết nối được Redis.
 */
export async function clearPinRate(userIds) {
  const redis = await connectRedis(readApiEnv('REDIS_URL'));
  if (!redis) return null;
  try {
    const v = await redis.cmd('DEL', ...userIds.map(pinRateKey));
    return v instanceof Error ? null : Number(v);
  } finally {
    redis.close();
  }
}
