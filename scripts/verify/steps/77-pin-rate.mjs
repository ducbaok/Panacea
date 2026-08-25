// Bước 77 — luồng E: trần TẠO PIN theo phút (XH-4b · XH-QĐ-12)
// (`docs/xahoi-phi-chuc-nang.md` §1.5 + §4 · `docs/xahoi-dieu-phoi.md` §6 luồng E)
//
// 🔴 BƯỚC NÀY LÀ NỬA CÒN LẠI CỦA MỘT CẶP. Bước 74 chứng minh trần 20 pin/NGÀY
// đã CHẾT (XH-QĐ-8); bước này chứng minh trần 10 pin/PHÚT còn SỐNG. Bỏ một
// trong hai thì tài liệu đọc ngược lại được: "đã bỏ trần" (mà không nói bỏ
// trần nào) từng là câu làm dự án suýt khôi phục lại đúng thứ vừa cố ý gỡ.
//
// ⚠️ BẪY 7 (§16, đã dính thật): gần như MỌI phép ở đây lấy *"phải bị từ chối"*
// làm bằng chứng, mà `h.gql(..., { expect })` chỉ phân loại lỗi KHI CÓ lỗi —
// request THÀNH CÔNG thì harness ghi OK chứ không ghi FAIL. Phép "pin thứ N+1
// phải bị chặn" viết bằng `expect` sẽ XANH VĨNH VIỄN đúng vào lúc trần chết.
// Nên mọi phép dưới đây gọi `silent()` rồi tự `assert` trên thông điệp lỗi.
//
// ⚠️ DÙNG TÀI KHOẢN DÙNG-MỘT-LẦN, KHÔNG DÙNG bao/alice/john. Cùng lý do bước
// 69 đã ghi: trần này là trạng thái Redis sống 60 giây, và bao là tiền đề cứng
// của hàng chục phép sau. Tiêu hết quota của bao ở đây thì bước sau đỏ vì một
// nguyên nhân không liên quan — đúng khuôn hỏng dây chuyền của trần-20-pin.
// Ngoại lệ có kiểm soát: mục 5 CỐ Ý đăng đúng MỘT pin bằng bao để chứng minh
// trần bám theo NGƯỜI, và dọn khoá của bao ngay sau đó.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 5 lần). Trạng thái sống lâu ở đây:
//   · `pincreate:<userId>` — TTL 60s, sống XUYÊN qua ranh giới bước và qua cả
//     lần chạy verify kế tiếp nếu hai lần cách nhau dưới một phút.
//   · `Pin` tiêu đề `xh77*` — dọn cuối bước; tài khoản dùng-một-lần cũng bị xoá.
//
// MỘT PHÉP KHÔNG BỎ VỪA VÀO ĐÂY — cố ý, cùng lý do đã ghi ở bước 69 mục (2):
// **fail-OPEN** (`docker compose stop redis` ⇒ vẫn đăng được pin). `stop redis`
// giết luôn `PUB_SUB` mà bước 70 cần. Bản thay thế tự động hoá được là phép
// QUYẾT ĐỊNH ở mục 6: `DEL` khoá thẳng trong Redis ⇒ đăng lại được NGAY, không
// restart API — nó chứng minh cùng một điều (nguồn sự thật là Redis, không phải
// bộ nhớ tiến trình) từ hướng ngược lại.
//
// VỊ TRÍ 77: sau 76 (không đụng gì của nhau), trước 80 (80 tự dựng tài khoản
// throwaway riêng và chỉ đăng MỘT pin ⇒ không chạm trần).

import { createRequire } from 'node:module';
import { USERS } from '../lib/seedrefs.mjs';
import { readApiEnv, API, sleep } from '../lib/client.mjs';
import { connectRedis } from '../lib/redis-probe.mjs';
import { PIN_RATE_WINDOW_SEC, pinCreatePerMin, pinRateKey } from '../lib/pin-rate.mjs';

const require = createRequire(import.meta.url);

const IMG = 'http://localhost:4000/uploads/xh77.png';
const EVIL = 'https://evil.example.com/xh77.png';
const T = (s) => `xh77 ${s}`;

const M_CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ id title } }`;

/** Thông điệp mà nhánh chặn PHẢI trả — số giây là thứ phân biệt nó với mọi
 *  ForbiddenException khác của `createPin` (ví dụ "vòng không thuộc về bạn"). */
const BLOCKED = /Too many pins created\. Try again in \d+s\./;

/** Những chữ mà thông điệp lỗi KHÔNG được chứa — lộ hạ tầng cho người ngoài. */
const LEAKY = /redis|pincreate|ttl|expire|incr|key\b/i;

const errOf = (r) =>
  r?.errors?.[0]?.extensions?.originalError?.message ?? r?.errors?.[0]?.message ?? null;

export default async function (h) {
  const { silent, rec, assert, state } = h;
  h.setGroup('GQL/pin-rate');

  const PER_MIN = pinCreatePerMin();

  // ─── Prisma CHỈ để dọn (không phải bằng chứng) ─────────────────────────────
  let prisma;
  try {
    const { PrismaClient } = require('../../../packages/database/src/client');
    const url = readApiEnv('DATABASE_URL');
    if (!url) {
      rec('setup: DATABASE_URL', 'FAIL', 'không đọc được từ env lẫn apps/api/.env');
      return false;
    }
    prisma = new PrismaClient({ datasources: { db: { url } } });
  } catch (e) {
    rec('setup: PrismaClient', 'FAIL', String(e.message).slice(0, 150));
    return false;
  }

  const redis = await connectRedis(readApiEnv('REDIS_URL'));
  const num = async (...args) => {
    const v = await redis.cmd(...args);
    return v instanceof Error ? NaN : Number(v);
  };

  /** Tạo pin bằng request THẬT, KHÔNG ghi kết quả — trả `{ id, err }`. */
  const create = async (token, title, imageUrl = IMG) => {
    const r = await silent(
      M_CREATE,
      { i: { imageUrl, imageWidth: 40, imageHeight: 60, title: T(title) } },
      token,
    );
    return { id: r?.data?.createPin?.id ?? null, err: errOf(r) };
  };

  let probeToken = null;
  let probeId = null;

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═════════════════════════════════════════════════════
    const wiped = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh77' } } });
    const delKeys = redis ? await num('DEL', pinRateKey(USERS.bao.id)) : null;
    rec(
      'dọn state sống lâu Ở ĐẦU BƯỚC (pin xh77* + bộ đếm `pincreate:*` của bao)',
      'OK',
      `pin=${wiped.count} · khoá bao xoá=${delKeys ?? 'không có Redis'} · trần đang chạy = ${PER_MIN} pin/phút`,
    );

    // ═══ 0. Tài khoản dùng-một-lần ═══════════════════════════════════════════
    {
      const email = `pinrate_${state.uniq}@example.com`;
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Pin rate probe' }),
      });
      const body = await r.json().catch(() => null);
      probeToken = body?.accessToken ?? null;
      const me = probeToken ? await silent(`{ me { id } }`, {}, probeToken) : null;
      probeId = me?.data?.me?.id ?? null;
      // Tên bản ghi cố ý KHÔNG chứa email/id thật (đổi mỗi lần chạy): mốc hồi
      // quy đối chiếu `results.json` theo cặp `group::name`.
      assert(
        'đăng ký tài khoản dùng-một-lần pinrate_<uniq>@example.com (KHÔNG tiêu quota của bao — xem đầu file)',
        Boolean(probeToken && probeId),
        `${email} → ${probeToken ? 'có accessToken' : 'KHÔNG có accessToken'} · me.id=${probeId ?? '(không lấy được)'}`,
      );
      if (!probeToken || !probeId) return false;
    }

    const KEY = pinRateKey(probeId);

    // ═══ 1. Biên DƯỚI: N pin đầu trong cùng một phút đều đi lọt ══════════════
    //
    // Không có phép này thì mọi phép "bị chặn" bên dưới vô nghĩa: một bản cài
    // đặt chặn NGAY TỪ PIN ĐẦU cũng xanh ở tất cả chúng.
    {
      const errs = [];
      const ids = [];
      for (let i = 1; i <= PER_MIN; i++) {
        const { id, err } = await create(probeToken, `ok ${i}`);
        if (err) errs.push(`#${i}: ${err}`);
        else ids.push(id);
      }
      assert(
        `${PER_MIN} pin ĐẦU trong cùng một phút đều tạo được (biên DƯỚI của trần — không có phép này thì "chặn từ pin đầu" cũng xanh)`,
        errs.length === 0 && ids.length === PER_MIN,
        errs.length ? errs.slice(0, 2).join(' | ') : `tạo được ${ids.length}/${PER_MIN}`,
      );
    }

    // ═══ 2. Bộ đếm là KHOÁ THẬT trong Redis, và CÓ HẠN ══════════════════════
    //
    // Một bản cài đặt quên `EXPIRE` vẫn chặn đúng pin thứ N+1 và vẫn xanh ở mọi
    // phép chỉ nhìn thông điệp — nhưng người dùng đó bị chặn VĨNH VIỄN. Chỉ con
    // số TTL phân biệt được. Đây đúng là lỗi (a) mà brute-force limiter đã trả
    // giá một lần.
    let ttlAfterQuota = NaN;
    const TTL_NAME = `bộ đếm \`pincreate:<userId>\` tồn tại THẬT trong Redis, đếm đủ ${PER_MIN} và có TTL dương ≤ ${PIN_RATE_WINDOW_SEC}s`;
    if (!redis) {
      rec(TTL_NAME, 'SKIP', 'không kết nối được Redis ⇒ không đo được');
    } else {
      const n = await num('GET', KEY);
      ttlAfterQuota = await num('TTL', KEY);
      assert(
        TTL_NAME,
        n === PER_MIN && ttlAfterQuota > 0 && ttlAfterQuota <= PIN_RATE_WINDOW_SEC,
        `${KEY} = ${n} (chờ ${PER_MIN}) · TTL = ${ttlAfterQuota} (chờ 0 < TTL ≤ ${PIN_RATE_WINDOW_SEC}) · ` +
          `-2 = không có khoá · -1 = có khoá NHƯNG VĨNH VIỄN, tức người này bị chặn không bao giờ gỡ`,
      );
    }

    // Khoảng nghỉ để phép "cửa sổ KHÔNG trượt" ở mục 4 đo được chênh lệch TTL.
    await sleep(1300);

    // ═══ 3. Biên TRÊN: pin thứ N+1 bị chặn, thông điệp nói rõ phải chờ ═══════
    let blockedMsg = null;
    {
      const { id, err } = await create(probeToken, `vượt trần`);
      blockedMsg = err;
      assert(
        `pin thứ ${PER_MIN + 1} trong cùng một phút BỊ CHẶN, kèm số giây phải chờ (biên TRÊN của trần)`,
        Boolean(err) && BLOCKED.test(err) && !id,
        err
          ? `từ chối đúng: ${err.slice(0, 120)}`
          : `KHÔNG bị chặn — đã tạo pin ${id}. Trần ${PER_MIN}/phút đang KHÔNG có hiệu lực.`,
      );
    }

    assert(
      'thông điệp từ chối KHÔNG lộ hạ tầng (không nhắc Redis/khoá/TTL) — người ngoài chỉ biết phải chờ bao lâu',
      Boolean(blockedMsg) && !LEAKY.test(blockedMsg),
      blockedMsg ? `"${blockedMsg.slice(0, 120)}"` : 'không có thông điệp nào để soi (phép trên đã đỏ)',
    );

    // ═══ 4. Cửa sổ KHÔNG TRƯỢT ══════════════════════════════════════════════
    //
    // `expire` gọi mỗi lần `incr` sẽ đẩy hạn về phía trước vô hạn: người đăng
    // đều đặn 59 giây một pin không bao giờ được đặt lại bộ đếm, và tới pin thứ
    // N+1 — dù cách nhau cả chục phút — vẫn bị chặn. Đó là lỗi (a) ở hình dạng
    // khác, và nó KHÔNG lộ ra ở bất kỳ phép nào chỉ nhìn thông điệp.
    const SLIDE_NAME = 'cửa sổ 60s KHÔNG bị đẩy về trước sau mỗi lần chạm trần (TTL phải GIẢM — `expire` chỉ được gọi ở lần đếm đầu)';
    if (!redis) {
      rec(SLIDE_NAME, 'SKIP', 'không kết nối được Redis ⇒ không đo được');
    } else {
      const ttlNow = await num('TTL', KEY);
      assert(
        SLIDE_NAME,
        Number.isFinite(ttlAfterQuota) && ttlNow > 0 && ttlNow < ttlAfterQuota,
        `TTL ${ttlAfterQuota} → ${ttlNow} sau 1.3s + 1 lần bị chặn · ` +
          (ttlNow >= ttlAfterQuota
            ? '⚠️ KHÔNG giảm ⇒ hạn đang bị làm mới mỗi lần đếm: người đăng đều đặn sẽ bị chặn vĩnh viễn'
            : 'đúng: hạn đặt MỘT lần ở lần đếm đầu'),
      );
    }

    // ═══ 5. Trần bám theo NGƯỜI, không phải toàn cục ════════════════════════
    //
    // Một bản cài đặt dùng khoá cố định (`pincreate` không có userId) chặn đúng
    // pin thứ N+1 và xanh ở tất cả các phép trên — nhưng một người đăng nhiều
    // sẽ khoá cả sản phẩm. Đây là ngoại lệ có kiểm soát duy nhất mà bước này
    // đụng tới bao, và khoá của bao được dọn ngay sau đó.
    {
      const { id, err } = await create(state.T1, 'bao vẫn đăng được');
      assert(
        'trần bám theo NGƯỜI: trong lúc tài khoản kia đang bị chặn, bao vẫn đăng được pin (khoá có userId, không phải khoá toàn cục)',
        Boolean(id) && !err,
        err ? `bao BỊ CHẶN LÂY: ${err.slice(0, 120)}` : `bao tạo được pin ${id}`,
      );
      if (redis) await num('DEL', pinRateKey(USERS.bao.id));
    }

    // ═══ 6. PHÉP QUYẾT ĐỊNH: nguồn sự thật là Redis ═════════════════════════
    //
    // Xoá khoá THẲNG trong Redis ⇒ đăng lại được NGAY, KHÔNG restart API. Một
    // bản cài đặt đếm bằng `Map` trong tiến trình (đúng thứ brute-force limiter
    // từng là) xanh ở mọi phép trên và chỉ chết ở đây. Nó cũng khoá luôn HỢP
    // ĐỒNG ĐẶT TÊN KHOÁ: `pinRateKey` ở `lib/pin-rate.mjs` dựng khoá độc lập
    // với server, nên nếu server đổi cách đặt tên thì `DEL` không trúng gì và
    // phép này đỏ.
    //
    // Đây cũng là bản thay thế tự động hoá được của phép "chờ hết 60 giây rồi
    // đăng lại được": chờ thật sẽ cộng 60 giây vào MỌI lần chạy verify để đo
    // đúng một điều mà `TTL` dương ở mục 2 + `DEL` ở đây đã nói đủ.
    const DECIDE_NAME = 'QUYẾT ĐỊNH: DEL bộ đếm trong Redis ⇒ đăng lại được NGAY, KHÔNG restart API (nguồn sự thật là Redis, không phải bộ nhớ tiến trình)';
    if (!redis) {
      rec(DECIDE_NAME, 'SKIP', 'không kết nối được Redis ⇒ không đo được');
    } else {
      const deleted = await num('DEL', KEY);
      const { id, err } = await create(probeToken, 'sau khi gỡ khoá');
      assert(
        DECIDE_NAME,
        deleted === 1 && Boolean(id) && !err,
        `DEL xoá ${deleted} khoá · đăng lại ngay sau đó → ${id ? `pin ${id}` : `LỖI: ${String(err).slice(0, 110)}`}`,
      );
    }

    // ═══ 7. Chốt đứng TRƯỚC validate — request HỎNG cũng bị đếm ═════════════
    //
    // Thứ cần giới hạn là REQUEST, không phải pin thành công. Đặt chốt sau
    // validate thì một script gửi 10.000 request ảnh sai domain vẫn quét sạch
    // connection lẫn CPU mà bộ đếm không nhúc nhích — và đó là hình dạng RẺ
    // NHẤT của một cuộc lạm dụng, không phải hình dạng hiếm nhất.
    //
    // Phép này là thứ duy nhất phân biệt hai thứ tự đó: sau `PER_MIN` request
    // ảnh domain lạ (đều bị từ chối), một request HỢP LỆ phải bị chặn bởi TRẦN
    // — chứ không phải được tạo.
    {
      if (redis) await num('DEL', KEY);
      const rejected = [];
      for (let i = 1; i <= PER_MIN; i++) {
        const { err } = await create(probeToken, `rác ${i}`, EVIL);
        if (err) rejected.push(err);
      }
      const { id, err } = await create(probeToken, 'hợp lệ sau loạt rác');
      assert(
        `chốt đứng TRƯỚC validate: ${PER_MIN} request ảnh domain lạ (đều bị từ chối) vẫn tiêu hết quota ⇒ request hợp lệ kế tiếp bị chặn`,
        rejected.length === PER_MIN && Boolean(err) && BLOCKED.test(err) && !id,
        `bị từ chối vì ảnh: ${rejected.length}/${PER_MIN} · request hợp lệ → ` +
          (err
            ? `${err.slice(0, 100)}`
            : `TẠO ĐƯỢC pin ${id} ⇒ chốt đang nằm SAU validate: request hỏng không tốn quota`),
      );
    }

    return true;
  } catch (e) {
    rec('bước 77 ném ngoại lệ', 'FAIL', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
    return false;
  } finally {
    // ─── Tự dọn sau lưng ─────────────────────────────────────────────────────
    //
    // KHÔNG phải dọn trang trí: khoá `pincreate:*` sống 60 giây nên hai lần
    // chạy verify sát nhau sẽ thừa hưởng quota đã cạn của lần trước, và pin của
    // tài khoản dùng-một-lần thì nằm trong `exploreFeed` của bước 80/90.
    let leftover = null;
    const gone = await prisma.pin
      .deleteMany({ where: { title: { startsWith: 'xh77' } } })
      .catch(() => ({ count: -1 }));
    if (redis && probeId) {
      await redis.cmd('DEL', pinRateKey(probeId), pinRateKey(USERS.bao.id));
      leftover = await num('EXISTS', pinRateKey(probeId), pinRateKey(USERS.bao.id));
    }
    const del = probeToken ? await silent(`mutation{ deleteAccount }`, {}, probeToken) : null;
    const accountGone = Boolean(probeToken) && !del?.errors;
    assert(
      'đã dọn: pin xh77* + 2 khoá `pincreate:*` + tài khoản dùng-một-lần (khoá sống 60s ⇒ không dọn là lần chạy sau thừa hưởng quota cạn)',
      gone.count >= 0 && (redis ? leftover === 0 : true) && accountGone,
      `xoá ${gone.count} pin · ` +
        (redis ? `còn sót ${leftover}/2 khoá · ` : 'không có Redis ⇒ khoá tự hết hạn theo TTL · ') +
        `deleteAccount ${accountGone ? 'ok' : 'LỖI: ' + JSON.stringify(del?.errors?.[0]?.message ?? del).slice(0, 110)}`,
    );
    redis?.close();
    await prisma.$disconnect().catch(() => {});
  }
}
