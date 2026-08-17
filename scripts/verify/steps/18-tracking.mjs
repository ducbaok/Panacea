// Bước 18 — B-4: view / click tracking có khử trùng lặp
//
// ĐỎ-TRƯỚC TỰ NHIÊN, HIẾM CÓ: trước đợt này `viewCount`/`clickCount` có trong
// `schema.prisma` VÀ trong SDL, nhưng grep toàn `apps/api/src` không có một chỗ
// nào tăng chúng ⇒ **số 0 vĩnh viễn** ở mọi màn hiện chúng. Không cần dựng
// kịch bản hỏng: sự thật trước đợt này chính là nhánh đỏ.
//
// PHÉP QUYẾT ĐỊNH của cả mục là **"gọi 2 lần trong cửa sổ ⇒ tăng ĐÚNG 1"**.
// Đây là phép duy nhất phân biệt "có tăng" với "tăng đúng": một bản cài đặt bỏ
// quên debounce vẫn làm mọi phép kiểm khác ở đây xanh trọn vẹn.
//
// ⚠️ BƯỚC NÀY PHẢI TỰ DỌN KHOÁ REDIS — và phải dọn Ở ĐẦU BƯỚC.
// Cửa sổ debounce là 30 PHÚT, dài hơn hẳn khoảng cách giữa hai lần chạy verify.
// Không dọn trước khi đo thì lần chạy thứ hai trong vòng 30 phút sẽ thấy lượt
// gọi ĐẦU TIÊN của nó bị khử trùng ⇒ đỏ vì trạng thái sót lại, chẳng liên quan
// gì tới thứ đang đo. Đúng họ với bài học "residue" ở bước 10 và khoá `login:*`
// ở bước 69.

import { connectRedis } from '../lib/redis-probe.mjs';
import { readApiEnv, API } from '../lib/client.mjs';
import { USERS } from '../lib/seedrefs.mjs';

/** Pin của bao, CÓ `sourceUrl` (`https://unsplash.com`) ⇒ dùng cho nhánh click. */
const PIN_WITH_LINK = 'pin_1_id';
/** Pin của bao, KHÔNG có `sourceUrl` ⇒ chứng minh nhánh "không có link để bấm". */
const PIN_NO_LINK = 'pin_3_id';

/**
 * Đọc CẢ HAI pin trong MỘT response.
 *
 * Không phải để tiết kiệm request: nó là hình dạng "hai nhánh trong cùng một
 * response" của dự án. Một bộ đếm tăng cho MỌI pin (ví dụ `updateMany` thiếu
 * `where`) sẽ qua được phép "pin_1 tăng 1", và chỉ chết ở phép này.
 */
const COUNTS_Q = `query($a:ID!,$b:ID!){
  withLink: pin(id:$a){ id viewCount clickCount }
  noLink:   pin(id:$b){ id viewCount clickCount }
}`;

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/tracking');

  // ── Dọn khoá debounce của lần chạy trước ────────────────────────────────────
  const redis = await connectRedis(readApiEnv('REDIS_URL'));
  const trackKeys = [];
  for (const pin of [PIN_WITH_LINK, PIN_NO_LINK]) {
    for (const kind of ['view', 'click']) {
      for (const who of [USERS.bao.id, USERS.alice.id, USERS.john.id]) {
        trackKeys.push(`track:${kind}:${pin}:u:${who}`);
      }
    }
  }
  if (redis) await redis.cmd('DEL', ...trackKeys);

  const counts = async () => {
    const d = await h.silent(COUNTS_Q, { a: PIN_WITH_LINK, b: PIN_NO_LINK }, state.T1);
    return {
      ok: !d?.errors,
      withLink: d?.data?.withLink ?? null,
      noLink: d?.data?.noLink ?? null,
      err: d?.errors?.[0]?.message,
    };
  };

  /** Gọi mutation tracking. `anon` = giá trị header `x-anon-id` (bỏ trống ⇒ không gửi). */
  const track = async (kind, pinId, { token, anon } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (anon !== undefined) headers['x-anon-id'] = anon;
    const r = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `mutation($p:ID!){ ${kind === 'view' ? 'trackPinView' : 'trackPinClick'}(pinId:$p) }`,
        variables: { p: pinId },
      }),
    });
    const j = await r.json();
    return {
      counted: j?.data?.[kind === 'view' ? 'trackPinView' : 'trackPinClick'],
      err: j?.errors?.[0]?.message,
    };
  };

  const base = await counts();
  if (!base.ok) {
    h.rec('B-4 tracking', 'FAIL', `không đọc được viewCount nền: ${base.err}`);
    return true;
  }

  // ═══ 1. PHÉP QUYẾT ĐỊNH — gọi 2 lần trong cửa sổ ⇒ tăng ĐÚNG 1 ═══════════════
  const first = await track('view', PIN_WITH_LINK, { token: state.T2 }); // alice
  const afterFirst = await counts();
  const second = await track('view', PIN_WITH_LINK, { token: state.T2 }); // alice, ngay sau
  const afterSecond = await counts();

  h.assert(
    'trackPinView lần 1: trả true VÀ viewCount tăng đúng 1 (pin kia đứng yên — hai nhánh cùng response)',
    first.counted === true &&
      afterFirst.withLink.viewCount === base.withLink.viewCount + 1 &&
      afterFirst.noLink.viewCount === base.noLink.viewCount,
    `trả=${first.counted} · pin có link: ${base.withLink.viewCount}→${afterFirst.withLink.viewCount} · ` +
      `pin kia: ${base.noLink.viewCount}→${afterFirst.noLink.viewCount}` + (first.err ? ` · LỖI: ${first.err}` : ''),
  );

  h.assert(
    'trackPinView lần 2 CÙNG người trong cửa sổ 30′: trả false VÀ viewCount KHÔNG đổi',
    second.counted === false && afterSecond.withLink.viewCount === afterFirst.withLink.viewCount,
    `trả=${second.counted} · viewCount ${afterFirst.withLink.viewCount}→${afterSecond.withLink.viewCount} ` +
      `(không debounce sẽ là ${afterFirst.withLink.viewCount + 1})`,
  );

  // ═══ 2. Hai người xem KHÁC NHAU ⇒ tăng 2, không bị khoá của nhau chặn ════════
  const byJohn = await track('view', PIN_WITH_LINK, { token: state.T3 });
  const afterJohn = await counts();
  h.assert(
    'người xem KHÁC ⇒ đếm riêng (debounce theo cặp (người xem, pin), không theo pin)',
    byJohn.counted === true && afterJohn.withLink.viewCount === afterSecond.withLink.viewCount + 1,
    `trả=${byJohn.counted} · viewCount ${afterSecond.withLink.viewCount}→${afterJohn.withLink.viewCount}`,
  );

  // ═══ 3. Khách vãng lai: định danh bằng anonId, KHÔNG phải IP ═════════════════
  // Ba lời gọi dưới đây đi từ CÙNG một máy, cùng một IP. Nếu định danh theo IP
  // thì lời gọi thứ ba (anonId khác) sẽ bị khử trùng ⇒ phép này đỏ.
  const anonA = `anonA_${Date.now().toString(36)}`;
  const anonB = `anonB_${Date.now().toString(36)}`;
  const a1 = await track('view', PIN_WITH_LINK, { anon: anonA });
  const afterA1 = await counts();
  const a2 = await track('view', PIN_WITH_LINK, { anon: anonA });
  const afterA2 = await counts();
  const b1 = await track('view', PIN_WITH_LINK, { anon: anonB });
  const afterB1 = await counts();

  h.assert(
    'khách vãng lai: anonId A đếm được, gọi lại bị khử, anonId B (CÙNG IP) vẫn đếm được',
    a1.counted === true &&
      afterA1.withLink.viewCount === afterJohn.withLink.viewCount + 1 &&
      a2.counted === false &&
      afterA2.withLink.viewCount === afterA1.withLink.viewCount &&
      b1.counted === true &&
      afterB1.withLink.viewCount === afterA2.withLink.viewCount + 1,
    `A lần1=${a1.counted} (${afterJohn.withLink.viewCount}→${afterA1.withLink.viewCount}) · ` +
      `A lần2=${a2.counted} (→${afterA2.withLink.viewCount}) · B=${b1.counted} (→${afterB1.withLink.viewCount})`,
  );

  // ═══ 4. Không định danh được ⇒ KHÔNG đếm (đánh đổi có chủ đích) ══════════════
  const noId = await track('view', PIN_WITH_LINK, {});
  const afterNoId = await counts();
  h.assert(
    'không token và không anonId ⇒ trả false, KHÔNG đếm (không có khoá debounce nào ⇒ đếm là để bị bơm)',
    noId.counted === false && afterNoId.withLink.viewCount === afterB1.withLink.viewCount,
    `trả=${noId.counted} · viewCount ${afterB1.withLink.viewCount}→${afterNoId.withLink.viewCount}`,
  );

  const tooLong = await track('view', PIN_WITH_LINK, { anon: 'x'.repeat(65) });
  const afterTooLong = await counts();
  h.assert(
    'anonId dài quá trần (65 ký tự) ⇒ coi như không có, KHÔNG đếm (chặn bơm khoá rác vào Redis)',
    tooLong.counted === false && afterTooLong.withLink.viewCount === afterNoId.withLink.viewCount,
    `trả=${tooLong.counted} · viewCount ${afterNoId.withLink.viewCount}→${afterTooLong.withLink.viewCount}`,
  );

  // ═══ 5. Click — chỉ pin CÓ `sourceUrl` ═══════════════════════════════════════
  const c1 = await track('click', PIN_WITH_LINK, { token: state.T2 }); // alice
  const afterC1 = await counts();
  h.assert(
    'trackPinClick trên pin CÓ sourceUrl: clickCount +1, và viewCount KHÔNG bị đụng',
    c1.counted === true &&
      afterC1.withLink.clickCount === afterTooLong.withLink.clickCount + 1 &&
      afterC1.withLink.viewCount === afterTooLong.withLink.viewCount,
    `trả=${c1.counted} · clickCount ${afterTooLong.withLink.clickCount}→${afterC1.withLink.clickCount} · ` +
      `viewCount giữ nguyên ${afterC1.withLink.viewCount}`,
  );

  // Khoá debounce của `view` và `click` phải TÁCH NHAU: alice vừa bị khử trùng ở
  // `view` (mục 1) nhưng `click` ngay trên cùng pin đó vẫn phải đếm được — và nó
  // đã đếm được ở phép trên. Phép này canh chiều ngược lại.
  const c2 = await track('click', PIN_WITH_LINK, { token: state.T2 });
  const afterC2 = await counts();
  h.assert(
    'click lần 2 cùng người ⇒ bị khử trùng như view (mỗi loại sự kiện một cửa sổ riêng)',
    c2.counted === false && afterC2.withLink.clickCount === afterC1.withLink.clickCount,
    `trả=${c2.counted} · clickCount ${afterC1.withLink.clickCount}→${afterC2.withLink.clickCount}`,
  );

  const cNo = await track('click', PIN_NO_LINK, { token: state.T2 });
  const afterCNo = await counts();
  h.assert(
    'trackPinClick trên pin KHÔNG có sourceUrl ⇒ false, clickCount không đổi (sự kiện đó không tồn tại)',
    cNo.counted === false && afterCNo.noLink.clickCount === afterC2.noLink.clickCount,
    `trả=${cNo.counted} · clickCount ${afterC2.noLink.clickCount}→${afterCNo.noLink.clickCount}`,
  );

  // ═══ 6. Pin không tồn tại ⇒ lỗi đúng khuôn nhà ═══════════════════════════════
  const ghost = await track('view', 'khong_ton_tai_id', { token: state.T2 });
  h.assert(
    'trackPinView với pinId không tồn tại ⇒ Pin not found (không âm thầm tạo bộ đếm)',
    /not found/i.test(ghost.err ?? ''),
    ghost.err ? `ném đúng: ${ghost.err}` : `KHÔNG ném lỗi, trả=${ghost.counted}`,
  );

  // ═══ 7. Tự dọn ══════════════════════════════════════════════════════════════
  if (redis) {
    const anonKeys = [anonA, anonB].map((a) => `track:view:${PIN_WITH_LINK}:a:${a}`);
    await redis.cmd('DEL', ...trackKeys, ...anonKeys);
    const left = await redis.cmd('EXISTS', ...trackKeys, ...anonKeys);
    h.assert(
      'đã dọn khoá debounce của bước này (TTL 30′ dài hơn khoảng cách giữa 2 lần chạy verify)',
      left === 0,
      `còn sót ${left}/${trackKeys.length + anonKeys.length} khoá`,
    );
    redis.close();
  } else {
    h.rec('đã dọn khoá debounce của bước này', 'SKIP', 'không kết nối được Redis để dọn');
  }

  return true;
}
