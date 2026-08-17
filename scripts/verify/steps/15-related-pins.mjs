// Bước 15 — B-11: `relatedPins(pinId)` — pin liên quan theo TAG CHUNG
//
// ⚠️ BƯỚC NÀY CỐ Ý KHÔNG CHẠM `blockUser`. `blockUser` xoá quan hệ follow CẢ
// HAI CHIỀU và `unblockUser` không khôi phục — bước 20 (chạy sau) đối chiếu
// `followers(bao)` của seed. Phần lọc-chặn của B-11 nằm ở bước 65, nơi cửa sổ
// block đã được mở sẵn và có luôn phần dựng lại follow. Xem ghi chú đầu
// `65-blocking.mjs`.
//
// BẰNG CHỨNG QUYẾT ĐỊNH KHÔNG PHẢI "query chạy được". `relatedPins` trả mảng
// rỗng trong RẤT nhiều trường hợp hợp lệ (pin không tag, pin không tồn tại,
// pin gốc bị chặn) — nên "trả về 200 kèm một mảng" là thứ xanh vĩnh viễn.
// Hai bẫy cụ thể mà một phép kiểm hời hợt không thấy:
//
//   1. `_PinToTag` có **Pin ở cột A**, còn `_PinToCategory` có **Pin ở cột B**
//      (hai bảng nối NGƯỢC CHIỀU nhau — đã trả giá ở B-5). Đoán nhầm cột thì
//      câu SQL vẫn chạy, không exception, chỉ trả **rỗng** — trông y hệt
//      "pin này không có pin liên quan".
//   2. Xếp hạng theo số tag chung: một bản cài đặt bỏ quên `ORDER BY COUNT(*)`
//      vẫn trả ĐÚNG TẬP pin, chỉ sai thứ tự — và "đúng tập" là thứ dễ kiểm
//      nhất nên rất dễ dừng lại ở đó.
//
// Vì vậy phép kiểm ở đây đối chiếu với **bảng kỳ vọng dẫn xuất ĐỘC LẬP từ
// `SEED_PIN_TAGS`** (nguồn: `TAG_RULES` trong seed.ts), gồm cả **số tag chung
// của từng pin**, chứ không đọc gì từ API để tự xác nhận mình.

import { SEED_PIN_TAGS } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';

/**
 * Pin gốc được chọn theo tiêu chí, không theo cảm tính: nó phải sinh ra **cả
 * hai nhánh trong cùng một response** — vài pin có NHIỀU tag chung và vài pin
 * chỉ có MỘT. `pin_18_id` (4 tag: landscape/organic/outdoor/seasonal) cho 3 pin
 * ×2 tag chung và 5 pin ×1. Một pin gốc mà mọi kết quả đều cùng số tag chung
 * sẽ làm phép kiểm thứ tự trở nên vô nghĩa.
 */
const SRC = 'pin_18_id';

/** Pin seed KHÔNG có tag nào — nhánh rỗng hợp lệ (giữ nguyên chủ đích ở Đợt 6). */
const SRC_NO_TAG = 'pin_20_id';

/** Số tag chung với `SRC`, dẫn xuất từ bảng seed — KHÔNG hỏi API. */
function expectedSharedCounts(srcId) {
  const srcTags = new Set(SEED_PIN_TAGS[srcId] ?? []);
  const m = new Map();
  for (const [id, tags] of Object.entries(SEED_PIN_TAGS)) {
    if (id === srcId) continue;
    const n = tags.filter((t) => srcTags.has(t)).length;
    if (n > 0) m.set(id, n);
  }
  return m;
}

const Q = `query($p:ID!,$f:Int!,$a:String){
  relatedPins(pinId:$p, first:$f, after:$a){
    items{ id }
    pageInfo{ hasNextPage endCursor }
  }
}`;

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/related');

  const want = expectedSharedCounts(SRC);
  const wantIds = [...want.keys()].sort();

  // ─── 1. Đúng TẬP, và cả hai nhánh (có tag chung ↔ không) trong cùng response ──
  const d = await gql(
    `relatedPins(${SRC}) trả về đúng tập pin có tag chung`,
    Q,
    { p: SRC, f: 20 },
    { token: state.T1 },
  );
  const gotIds = (d?.relatedPins?.items ?? []).map((p) => p.id);

  {
    const missing = wantIds.filter((id) => !gotIds.includes(id));
    const extra = gotIds.filter((id) => !want.has(id));
    h.assert(
      'relatedPins: tập kết quả KHỚP bảng tag của seed (thiếu 0 · thừa 0)',
      missing.length === 0 && extra.length === 0 && gotIds.length > 0,
      `nhận ${gotIds.length} pin · kỳ vọng ${wantIds.length}` +
        (missing.length ? ` · THIẾU: ${missing.join(',')}` : '') +
        (extra.length ? ` · THỪA: ${extra.join(',')}` : ''),
    );
  }

  // Nhánh VẮNG MẶT phải được khẳng định TƯỜNG MINH, không suy ra từ "extra=0":
  // `pin_10`/`pin_20` không có tag nào, `pin_1..4` có tag nhưng KHÔNG tag nào
  // chung với SRC. Hai loại vắng mặt này chứng minh hai thứ khác nhau.
  {
    const noTagPins = Object.entries(SEED_PIN_TAGS).filter(([, t]) => t.length === 0).map(([id]) => id);
    const taggedButUnrelated = Object.entries(SEED_PIN_TAGS)
      .filter(([id, t]) => id !== SRC && t.length > 0 && !want.has(id))
      .map(([id]) => id);
    h.assert(
      'relatedPins: pin KHÔNG tag chung vắng mặt (cả pin 0-tag lẫn pin có tag nhưng khác hẳn)',
      noTagPins.every((id) => !gotIds.includes(id)) &&
        taggedButUnrelated.every((id) => !gotIds.includes(id)) &&
        taggedButUnrelated.length > 0,
      `0-tag: ${noTagPins.join(',')} · có-tag-nhưng-không-chung: ${taggedButUnrelated.join(',')}`,
    );
  }

  h.assert(
    'relatedPins: pin GỐC không tự nằm trong kết quả của chính nó',
    !gotIds.includes(SRC),
    `pin gốc=${SRC} · kết quả=[${gotIds.join(',')}]`,
  );

  // ─── 2. XẾP HẠNG theo số tag chung — phép phân biệt "đúng tập" với "đúng" ────
  {
    const counts = gotIds.map((id) => want.get(id));
    const nonIncreasing = counts.every((n, i) => i === 0 || counts[i - 1] >= n);
    const distinct = new Set(counts);
    h.assert(
      'relatedPins: nhiều tag chung xếp TRƯỚC (dãy số tag chung không tăng, và có ÍT NHẤT 2 mức khác nhau)',
      nonIncreasing && distinct.size >= 2,
      `dãy số tag chung theo thứ tự trả về: [${counts.join(',')}] · số mức khác nhau=${distinct.size}` +
        (distinct.size < 2 ? ' — CHỈ MỘT MỨC ⇒ phép kiểm thứ tự không chứng minh được gì' : ''),
    );
  }

  // ─── 3. Phân trang: 3 trang gộp lại = đúng tập đầy đủ, không trùng không thiếu ─
  {
    const pages = [];
    let cursor = undefined;
    let guard = 0;
    do {
      const p = await h.silent(Q, { p: SRC, f: 3, a: cursor }, state.T1);
      const items = p?.data?.relatedPins?.items ?? [];
      pages.push(items.map((x) => x.id));
      cursor = p?.data?.relatedPins?.pageInfo?.endCursor;
      if (!p?.data?.relatedPins?.pageInfo?.hasNextPage) break;
    } while (++guard < 10);

    const flat = pages.flat();
    const unique = new Set(flat);
    h.assert(
      'relatedPins: gộp các trang first=3 ra ĐÚNG tập đầy đủ, không trùng không thiếu',
      flat.length === unique.size && unique.size === wantIds.length && wantIds.every((id) => unique.has(id)),
      `${pages.length} trang [${pages.map((p) => p.length).join('+')}] = ${flat.length} item · unique=${unique.size} · kỳ vọng=${wantIds.length}`,
    );

    // Cursor phải mang được cả `sharedTagCount`: nếu nó chỉ mang (createdAt,id)
    // như mọi query khác thì trang 2 lọc theo nhầm khoá và sẽ **nhảy cóc mất
    // pin có nhiều tag chung** — mất im lặng, tổng số item vẫn trông hợp lý.
    // Phép trên bắt được đúng thứ đó; phép này ghi lại hình dạng cursor để lần
    // sau ai đổi spec thì thấy ngay.
    const c0 = pages.length > 1 ? Buffer.from(
      (await h.silent(Q, { p: SRC, f: 3 }, state.T1))?.data?.relatedPins?.pageInfo?.endCursor ?? '',
      'base64',
    ).toString('utf8') : '';
    h.assert(
      'relatedPins: cursor gồm ĐỦ 3 phần (sharedTagCount|createdAt|id)',
      c0.split('|').length === 3,
      `giải base64 ra: "${c0}"`,
    );
  }

  // ─── 4. Nhánh rỗng HỢP LỆ — phải rỗng mà KHÔNG lỗi ──────────────────────────
  for (const [label, pinId] of [
    [`pin không có tag nào (${SRC_NO_TAG})`, SRC_NO_TAG],
    ['pinId không tồn tại', 'khong_ton_tai_id'],
  ]) {
    const r = await h.silent(Q, { p: pinId, f: 20 }, state.T1);
    h.assert(
      `relatedPins: ${label} ⇒ rỗng và KHÔNG ném lỗi`,
      !r?.errors && Array.isArray(r?.data?.relatedPins?.items) && r.data.relatedPins.items.length === 0,
      r?.errors ? `LỖI: ${r.errors[0].message}` : `${r?.data?.relatedPins?.items?.length} item`,
    );
  }

  // ─── 5. Khách vãng lai: guard OPTIONAL, không token vẫn 200 và cùng tập ──────
  {
    const anon = await gql('relatedPins KHÔNG token → vẫn 200 (guard optional)', Q, { p: SRC, f: 20 }, {});
    const anonIds = (anon?.relatedPins?.items ?? []).map((p) => p.id);
    h.assert(
      'relatedPins: khách vãng lai thấy cùng tập với người đã đăng nhập (chưa chặn ai)',
      anonIds.length === gotIds.length && anonIds.every((id, i) => id === gotIds[i]),
      `khách=[${anonIds.join(',')}] · bao=[${gotIds.join(',')}]`,
    );
  }

  // ─── 6. Hiệu năng: số query bất biến theo kích thước trang ───────────────────
  h.setGroup('GQL/perf');
  await assertBatched(
    h,
    h.counter,
    'relatedPins: số query bất biến theo kích thước trang',
    (first) => h.silent(Q, { p: SRC, f: first }, state.T1),
    { small: 2, large: 8 }, // tập đầy đủ chỉ 8 pin — 5/20 sẽ cho hai trang BẰNG NHAU ⇒ Δ=0 giả
  );

  return true;
}
