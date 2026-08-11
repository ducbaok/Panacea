// Bước 69 — Đợt 7 (#15): brute-force limiter chuyển từ `Map` in-memory sang Redis
//
// ⚠️ ĐỌC TRƯỚC KHI SỬA FILE NÀY — CÁI BẪY LỚN NHẤT CỦA ĐỢT 7:
//
// `00-auth.mjs:42` CỐ Ý đăng nhập sai mật khẩu của **bao** mỗi lần chạy. Với
// `Map` cũ, trạng thái đó bốc hơi mỗi lần restart API nên chưa ai từng thấy nó.
// Với Redis nó SỐNG SÓT qua restart, qua cả ngày. Hệ quả: nếu bộ đếm của bao
// có lúc nào đó chạm ngưỡng thì `00-auth.mjs:21` trả **403**, `state.T1` thành
// `undefined`, và TOÀN BỘ bộ verify sụp ngay ở bước 00 kèm một tràng lỗi thứ
// cấp không liên quan gì tới thứ đang được sửa — đúng khuôn hỏng dây chuyền của
// trần-20-pin (§17).
//
// Vì vậy:
//   • Bước này dùng email DÙNG-MỘT-LẦN của riêng nó. TUYỆT ĐỐI không đụng
//     bao/alice/john — ba tài khoản đó là tiền đề cứng của 11 bước còn lại.
//   • Nó tự dọn mọi khoá Redis nó tạo ra, cùng hợp đồng "tự dọn sau lưng" như
//     bước 65/67/68.
//   • Phép đầu tiên là một DÂY BẪY trên chính bộ đếm của bao: trạng thái đúng
//     là `fail = 1` (vì `:21` login THÀNH CÔNG chạy TRƯỚC `:42` và xoá bộ đếm),
//     KHÔNG tích luỹ. Nếu con số đó bò lên, bước này đỏ ngay tại đây với thông
//     điệp nói thẳng nguyên nhân — thay vì để lần chạy SAU sụp ở bước 00.
//
// ⚠️ BẪY 7 (Đợt 3e đã dính thật, §16): gần như MỌI phép ở đây lấy *"phải bị từ
// chối"* làm bằng chứng. `rest(..., { expect })` chỉ phân loại lỗi KHI CÓ lỗi —
// request THÀNH CÔNG thì harness ghi OK chứ không ghi FAIL. Phép "gõ sai lần
// thứ MAX ⇒ 403" mà dùng `expect` sẽ XANH VĨNH VIỄN đúng lúc cần đỏ. Nên mọi
// phép dưới đây gọi `fetch` trần rồi tự `h.assert` trên status VÀ thông điệp.
//
// ⚠️ HAI PHÉP KHÔNG BỎ VỪA VÀO ĐÂY — cố ý, đã cân nhắc, ghi ở docs/debug_history.md §19:
//   1. "khoá SỐNG SÓT qua restart API" — bằng chứng đóng đinh của cả đợt, và là
//      thứ DUY NHẤT phân biệt Redis với Map. Không tự động hoá được vì bước này
//      không thể giết chính cái API mà 3 bước sau còn cần.
//      Bản thay thế tự động hoá được nằm ở phép QUYẾT ĐỊNH bên dưới: `DEL` khoá
//      thẳng trong Redis ⇒ login lại được NGAY mà KHÔNG restart. Nó chứng minh
//      đúng cùng một điều — nguồn sự thật là Redis chứ không phải bộ nhớ tiến
//      trình — chỉ là đi từ hướng ngược lại.
//   2. Fail-OPEN (`docker compose stop redis` ⇒ login vẫn thành công): `stop
//      redis` giết luôn `PUB_SUB`, mà bước 70 chạy WebSocket thật và cần Redis
//      sống. Để tự động sẽ phải đặt sau bước 70 + tự `start` lại + chờ healthy,
//      đổi lấy rủi ro bỏ Redis ở trạng thái stopped mỗi khi bước 70 flake.
//
// VỊ TRÍ 69: sau 68 (không đụng gì của nhau), trước 70 (bước này không chạm
// Redis pub/sub, chỉ chạm khoá `login:*`). Phải TRƯỚC 90 vì 90 đăng nhập bằng
// `state.probeEmail` — một email khác, khoá khác, nhưng thứ tự này giữ cho mọi
// thao tác auth nằm gọn trước bước dọn cuối.

import { createHash } from 'node:crypto';
import { API, readApiEnv } from '../lib/client.mjs';
import { connectRedis } from '../lib/redis-probe.mjs';
import { USERS, PASSWORD } from '../lib/seedrefs.mjs';

/**
 * Dẫn xuất khoá ĐỘC LẬP với server — cố ý viết lại chứ không import từ API.
 * Nếu server đổi cách băm, `DEL` ở đây sẽ không trúng khoá nào và phép QUYẾT
 * ĐỊNH đỏ ngay. Dùng chung một hàm thì hợp đồng đặt tên khoá sẽ không còn được
 * kiểm chứng bởi bất cứ thứ gì.
 */
const keyHash = (email) => createHash('sha256').update(email).digest('hex').slice(0, 32);
const failKeyOf = (email) => `login:fail:${keyHash(email)}`;
const lockKeyOf = (email) => `login:lock:${keyHash(email)}`;

const MAX = Number(readApiEnv('LOGIN_MAX_ATTEMPTS') ?? 5);
const WINDOW = Number(readApiEnv('LOGIN_FAIL_WINDOW_SEC') ?? 900);
const LOCK = Number(readApiEnv('LOGIN_LOCK_SEC') ?? 900);

/** POST /auth/login trần — KHÔNG qua `h.rest` (bẫy 7). Trả status + thân thô. */
async function rawLogin(email, password) {
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return { status: r.status, text: (await r.text()).slice(0, 200) };
  } catch (e) {
    return { status: 0, text: `threw: ${e.message}` };
  }
}

export default async function (h) {
  const { state } = h;
  h.setGroup('REST/bruteforce');

  const email = `bf_${state.uniq}@example.com`;
  const ghost = `bf_ghost_${state.uniq}@example.com`; // KHÔNG bao giờ tồn tại trong DB

  const redis = await connectRedis(readApiEnv('REDIS_URL'));
  const num = async (...args) => {
    const v = await redis.cmd(...args);
    return v instanceof Error ? NaN : Number(v);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DÂY BẪY — bộ đếm của bao KHÔNG được tích luỹ
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Đây không phải phép kiểm của Đợt 7; nó canh cái bẫy mà Đợt 7 tạo ra. Chi
  // phí một lệnh `GET`, đổi lấy việc không bao giờ phải truy ngược một lần
  // "bước 00 sụp không rõ lý do" vào một buổi sáng nào đó.
  if (!redis) {
    h.rec(
      'DÂY BẪY: bộ đếm sai-mật-khẩu của bao (do 00-auth.mjs:42 tạo ra) không tích luỹ qua các lần chạy',
      'SKIP',
      'không kết nối được Redis ⇒ không đo được',
    );
  } else {
    const raw = await redis.cmd('GET', failKeyOf(USERS.bao.email));
    const n = raw == null ? 0 : Number(raw);
    h.assert(
      'DÂY BẪY: bộ đếm sai-mật-khẩu của bao (do 00-auth.mjs:42 tạo ra) không tích luỹ qua các lần chạy',
      Number.isFinite(n) && n <= 1,
      `${failKeyOf(USERS.bao.email)} = ${raw ?? '(không có)'} · ngưỡng khoá = ${MAX}. ` +
        (n <= 1
          ? 'Đúng: `00-auth.mjs:21` login THÀNH CÔNG chạy trước `:42` nên bộ đếm bị xoá mỗi lần chạy.'
          : `⚠️ ĐANG BÒ LÊN. Chạm ${MAX} là bước 00 trả 403, state.T1 = undefined và CẢ BỘ VERIFY SỤP. ` +
            `Gỡ ngay: redis-cli DEL ${failKeyOf(USERS.bao.email)} ${lockKeyOf(USERS.bao.email)}`),
    );
  }

  // ─── Dựng tài khoản dùng-một-lần ───────────────────────────────────────────
  let token = null;
  {
    const r = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Brute-force probe' }),
    });
    const body = await r.json().catch(() => null);
    token = body?.accessToken ?? null;
    // Tên bản ghi cố ý KHÔNG chứa email/hash thật: chúng đổi mỗi lần chạy, mà
    // mốc hồi quy giữa các đợt là đối chiếu `results.json` theo cặp
    // `group::name`. Tên biến động ⇒ mọi bản ghi ở đây trông như "biến mất +
    // thêm mới" ở mọi lần diff. Giá trị thật đi vào `detail`.
    h.assert(
      'đăng ký tài khoản dùng-một-lần bf_<uniq>@example.com (KHÔNG dùng bao/alice/john — xem đầu file)',
      r.ok && Boolean(token),
      `${email} → ${r.ok ? `${r.status}, có accessToken` : `${r.status} ${JSON.stringify(body).slice(0, 150)}`}`,
    );
    if (!token) return false;
  }

  {
    const r = await rawLogin(email, PASSWORD);
    h.assert(
      'tiền đề: tài khoản mới đăng nhập ĐƯỢC (chưa có khoá nào) — không có phép này thì mọi 403 bên dưới vô nghĩa',
      r.status === 200,
      `${r.status} ${r.text.slice(0, 80)}`,
    );
    if (r.status !== 200) return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Ngưỡng: MAX-1 lần đầu là 401, lần thứ MAX là 403
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const got = [];
    for (let i = 1; i < MAX; i++) got.push(await rawLogin(email, 'wrongpassword'));
    h.assert(
      `${MAX - 1} lần sai đầu ⇒ 401 "Invalid credentials" (CHƯA khoá — biên dưới của ngưỡng)`,
      got.every((r) => r.status === 401 && /Invalid credentials/.test(r.text)),
      got.map((r, i) => `#${i + 1}=${r.status}`).join(' ') + ` · thân cuối: ${got.at(-1)?.text.slice(0, 90)}`,
    );
  }

  {
    const r = await rawLogin(email, 'wrongpassword');
    h.assert(
      `lần sai thứ ${MAX} ⇒ 403 "Too many failed attempts" (biên trên của ngưỡng, và là lần ĐẶT khoá)`,
      r.status === 403 && /Too many failed attempts/.test(r.text),
      `${r.status} ${r.text.slice(0, 120)}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Khoá phải là KHOÁ THẬT TRONG REDIS, có hạn — bằng chứng lỗi (a) đã sửa
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // `Map` cũ không có hạn nào cả. Ở đây phép đo là `TTL` DƯƠNG: một bản cài đặt
  // quên `EX` sẽ tạo khoá vĩnh viễn và `TTL` trả `-1` — vẫn "có khoá", vẫn 403,
  // vẫn xanh ở mọi phép chỉ nhìn status. Chỉ con số TTL phân biệt được.
  const LOCK_NAME = 'khoá `login:lock:<sha256(email)[0:32]>` tồn tại THẬT trong Redis và có TTL dương (lỗi (a): Map không có hạn)';
  const FAIL_NAME = `bộ đếm \`login:fail:<…>\` bị XOÁ ngay lúc khoá (lỗi (b): hết khoá là đếm lại từ 0, không khoá tiếp ${LOCK}s)`;

  if (!redis) {
    h.rec(LOCK_NAME, 'SKIP', 'không kết nối được Redis');
    h.rec(FAIL_NAME, 'SKIP', 'không kết nối được Redis');
  } else {
    const ttl = await num('TTL', lockKeyOf(email));
    h.assert(
      LOCK_NAME,
      ttl > 0 && ttl <= LOCK,
      `${lockKeyOf(email)} · TTL = ${ttl} (chờ 0 < TTL ≤ ${LOCK}) · -2 = không có khoá · -1 = có khoá NHƯNG VĨNH VIỄN, chính là lỗi (a)`,
    );

    // Lỗi (b) đo được NGAY, không phải chờ hết khoá: cơ chế sửa nó là `del`
    // bộ đếm đúng lúc đặt khoá. Bản cũ giữ `count ≥ MAX` mãi mãi, nên cú gõ sai
    // đầu tiên SAU khi hết khoá lại khoá tiếp 15 phút — vĩnh viễn, cho tới khi
    // login đúng. Phép end-to-end (LOGIN_LOCK_SEC=5, chờ hết hạn, gõ sai lần
    // nữa phải là 401) cần đổi env + restart API nên nằm ở §19.
    const failExists = await num('EXISTS', failKeyOf(email));
    h.assert(
      FAIL_NAME,
      failExists === 0,
      `${failKeyOf(email)} · ` +
        (failExists === 0
          ? 'EXISTS = 0 — bộ đếm khởi động lại sạch sau khi khoá hết hạn'
          : `EXISTS = ${failExists} — bộ đếm CÒN, tức vẫn ≥ ${MAX}: gõ sai một cái sau khi hết khoá là khoá tiếp ⇒ LỖI (b) CHƯA SỬA`),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Đường ĐỌC khoá — khác đường GHI, phải kiểm riêng
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Hai thông điệp 403 cố ý KHÁC NHAU. Lần thứ MAX là nhánh GHI ("Too many
  // failed attempts"); lần thứ MAX+1 là nhánh ĐỌC ("Try again in Ns"). Một bản
  // cài đặt quên hẳn nhánh đọc vẫn trả 403 ở cả hai (vì `incr` lại chạm ngưỡng)
  // và xanh ở mọi phép chỉ so status. Thông điệp là thứ phân biệt.
  {
    const r = await rawLogin(email, 'wrongpassword');
    h.assert(
      `lần sai thứ ${MAX + 1} ⇒ 403 nhánh ĐỌC khoá, kèm số giây còn lại (khác thông điệp nhánh GHI)`,
      r.status === 403 && /Account temporarily locked\. Try again in \d+s\./.test(r.text),
      `${r.status} ${r.text.slice(0, 120)}`,
    );
  }

  {
    const r = await rawLogin(email, PASSWORD);
    h.assert(
      'đang bị khoá thì MẬT KHẨU ĐÚNG cũng bị từ chối 403 (khoá chặn TRƯỚC khi so mật khẩu)',
      r.status === 403 && /Account temporarily locked/.test(r.text),
      `${r.status} ${r.text.slice(0, 120)}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Email KHÔNG TỒN TẠI cũng bị đếm — và khoá của nó TỰ HẾT HẠN
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Đây là nhánh đã làm `Map` phình vô hạn: bản cũ `set()` cho mọi email kể cả
  // email không tồn tại, mà `delete()` chỉ chạy khi login THÀNH CÔNG — điều
  // không bao giờ xảy ra với email không tồn tại. Entry nằm lại vĩnh viễn ⇒
  // attacker điều khiển được lượng bộ nhớ server bằng cách gõ email rác.
  //
  // Vẫn phải ĐẾM (chứ không phải bỏ qua): chỉ khoá email có thật sẽ biến chính
  // cái khoá thành máy dò email tồn tại.
  {
    const r = await rawLogin(ghost, 'wrongpassword');
    if (!redis) {
      h.rec('email KHÔNG TỒN TẠI cũng bị đếm, và bộ đếm của nó CÓ HẠN (lỗi (a): Map giữ vĩnh viễn)', 'SKIP', 'không kết nối được Redis');
    } else {
      const n = await num('GET', failKeyOf(ghost));
      const ttl = await num('TTL', failKeyOf(ghost));
      h.assert(
        'email KHÔNG TỒN TẠI cũng bị đếm, và bộ đếm của nó CÓ HẠN (lỗi (a): Map giữ vĩnh viễn)',
        r.status === 401 && /Invalid credentials/.test(r.text) && n === 1 && ttl > 0 && ttl <= WINDOW,
        `login → ${r.status} · ${failKeyOf(ghost)} = ${n} · TTL = ${ttl} (chờ 0 < TTL ≤ ${WINDOW}; -1 = vĩnh viễn = lỗi (a))`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHÉP QUYẾT ĐỊNH của cả đợt
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Xoá khoá THẲNG TRONG REDIS ⇒ login lại được NGAY, KHÔNG restart API, KHÔNG
  // deploy lại. Đây là thứ duy nhất trong bước này mà bản `Map` KHÔNG THỂ làm
  // xanh: với `Map`, trạng thái nằm trong bộ nhớ tiến trình nên xoá gì trong
  // Redis cũng vô nghĩa — tài khoản vẫn khoá đủ 15 phút.
  //
  // Nó cũng khoá luôn HỢP ĐỒNG ĐẶT TÊN KHOÁ: `keyHash` ở đầu file dẫn xuất độc
  // lập với server, nên nếu server băm kiểu khác thì `DEL` không trúng gì và
  // phép này đỏ.
  //
  // Cặp song sinh của nó — "restart API ⇒ khoá VẪN CÒN" — không tự động hoá
  // được ở đây (xem đầu file) và nằm ở §19.
  if (!redis) {
    h.rec('QUYẾT ĐỊNH: DEL khoá trong Redis ⇒ login lại được NGAY, KHÔNG restart API (nguồn sự thật là Redis, không phải bộ nhớ tiến trình)', 'SKIP', 'không kết nối được Redis');
  } else {
    const deleted = await num('DEL', failKeyOf(email), lockKeyOf(email));
    const after = await rawLogin(email, PASSWORD);
    h.assert(
      'QUYẾT ĐỊNH: DEL khoá trong Redis ⇒ login lại được NGAY, KHÔNG restart API (nguồn sự thật là Redis, không phải bộ nhớ tiến trình)',
      deleted >= 1 && after.status === 200,
      `DEL xoá ${deleted} khoá · login ngay sau đó → ${after.status} ${after.status === 200 ? '(có accessToken)' : after.text.slice(0, 110)}`,
    );
  }

  // ─── Tự dọn sau lưng ───────────────────────────────────────────────────────
  //
  // KHÔNG phải dọn trang trí. Khoá `login:*` sống sót qua restart API và qua cả
  // ngày — đó chính là điều đợt này vừa làm cho đúng — nên mọi thứ bước này tạo
  // ra sẽ nằm lại nếu không xoá. Tài khoản dùng-một-lần cũng bị xoá để không
  // tích tụ mỗi lần chạy.
  let leftover = null;
  if (redis) {
    await redis.cmd('DEL', failKeyOf(ghost), lockKeyOf(ghost), failKeyOf(email), lockKeyOf(email));
    leftover = await num('EXISTS', failKeyOf(email), lockKeyOf(email), failKeyOf(ghost), lockKeyOf(ghost));
  }

  const del = await h.silent(`mutation{ deleteAccount }`, {}, token);
  const accountGone = !del?.errors;

  const cleaned = accountGone && (redis ? leftover === 0 : true);
  h.assert(
    'đã dọn: 4 khoá Redis của bước này + tài khoản dùng-một-lần (khoá `login:*` SỐNG SÓT qua restart nên không dọn là tích tụ)',
    cleaned,
    (redis ? `còn sót ${leftover}/4 khoá · ` : 'không có Redis ⇒ 4 khoá tự hết hạn theo TTL · ') +
      `deleteAccount ${accountGone ? 'ok' : 'LỖI: ' + JSON.stringify(del?.errors?.[0]?.message ?? del).slice(0, 120)}`,
  );

  redis?.close();
  return cleaned;
}
