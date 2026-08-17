// Bước 71 — B-7: onboarding backend (`updateMyCategories` + `completeOnboarding`)
//
// ⚠️ CHẠY TRÊN TÀI KHOẢN THROWAWAY, KHÔNG DÙNG `bao`.
// Cả hai mutation ở đây ghi trạng thái LÂU DÀI lên User (`categories` thay thế
// toàn bộ, `isOnboarded` không có đường quay lại). `bao` là tài khoản mốc của
// gần như mọi bước khác; đổi sở thích của nó là gieo đúng loại residue mà bước
// 10 vừa phải học cách đề kháng (§30). Tài khoản mới đăng ký còn cho thêm một
// thứ mà `bao` không có: `isOnboarded = false` NGUYÊN BẢN, tức nhánh đỏ tự
// nhiên của `completeOnboarding`.
//
// BẢNG SLUG lấy từ `CATEGORY_SLUGS` (`lib/seedrefs.mjs`) chứ KHÔNG hardcode
// `Category.id`: id là cuid và đổi sau mỗi lần re-seed.
//
// 📌 Bước này cố ý KHÔNG kiểm `Category.name` bằng chuỗi tiếng Việt. Tên hiển
// thị là thứ user đổi được bất cứ lúc nào (Đ7a vừa đổi cả 12 tên); phép kiểm
// bám vào nó sẽ đỏ mỗi lần ai đó sửa một chữ. `slug` mới là hợp đồng.

import { CATEGORY_SLUGS } from '../lib/seedrefs.mjs';

/** Chuỗi lỗi là HỢP ĐỒNG NGUYÊN VĂN với frontend (QĐ-8) — khớp từng chữ. */
const ERR_TOO_FEW = 'You must select at least 3 categories.';
const ERR_UNKNOWN = 'Some category slugs do not exist.';

const ME_Q = `query{ me{ id isOnboarded categories{ slug } } }`;

export default async function (h) {
  const { gql, rest, state } = h;

  h.setGroup('GQL/onboarding');

  // ─── Tài khoản throwaway ────────────────────────────────────────────────────
  const uniq = Date.now().toString(36);
  const reg = await rest('đăng ký tài khoản throwaway cho B-7', 'POST', '/auth/register', {
    body: { email: `onb_${uniq}@example.com`, password: 'password123', name: 'Onboarding Probe' },
  });
  const TO = reg?.accessToken;
  if (!TO) {
    h.rec('B-7 onboarding', 'FAIL', 'không đăng ký được tài khoản throwaway');
    return true;
  }

  const me = async () => {
    const r = await h.silent(ME_Q, {}, TO);
    return {
      ok: !r?.errors,
      isOnboarded: r?.data?.me?.isOnboarded,
      slugs: (r?.data?.me?.categories ?? []).map((c) => c.slug).sort(),
      err: r?.errors?.[0]?.message,
    };
  };

  const setCats = async (slugs, token = TO) =>
    h.silent(
      `mutation($s:[String!]!){ updateMyCategories(slugs:$s){ id categories{ slug } } }`,
      { s: slugs },
      token,
    );

  // ─── 1. Trạng thái nguyên bản: chưa onboard, chưa có category nào ───────────
  //
  // Đây là nhánh ĐỎ TỰ NHIÊN của cả mục: trước B-7 không có đường nào trong API
  // đổi được `isOnboarded` (đính chính: `UpdateProfileInput` KHÔNG có field đó),
  // và SDL cũng chưa hề có `User.categories`.
  const before = await me();
  h.assert(
    'tài khoản mới: isOnboarded=false và chưa có category nào (nhánh đỏ tự nhiên)',
    before.ok && before.isOnboarded === false && before.slugs.length === 0,
    `isOnboarded=${before.isOnboarded} · categories=[${before.slugs.join(',')}]` +
      (before.err ? ` · LỖI: ${before.err}` : ''),
  );

  // ─── 2. Chọn 3 slug thật ⇒ đọc lại đúng 3, HAI NHÁNH trong cùng response ────
  const pick1 = CATEGORY_SLUGS.slice(0, 3);           // 3 slug đầu bảng
  const notPicked = CATEGORY_SLUGS.slice(3);          // 9 slug còn lại
  await setCats(pick1);
  const after1 = await me();
  h.assert(
    'updateMyCategories 3 slug: slug ĐÃ gửi có mặt VÀ slug KHÔNG gửi vắng mặt (cùng một response)',
    after1.ok &&
      after1.slugs.length === 3 &&
      pick1.every((s) => after1.slugs.includes(s)) &&
      notPicked.every((s) => !after1.slugs.includes(s)),
    `gửi [${pick1.join(',')}] · đọc lại [${after1.slugs.join(',')}] · ` +
      `9 slug không gửi: ${notPicked.filter((s) => after1.slugs.includes(s)).length} cái lọt vào (phải 0)`,
  );

  // ─── 3. THAY THẾ, không cộng dồn — phép chốt ngữ nghĩa `set:` ───────────────
  //
  // Một bản cài đặt dùng `connect:` thay vì `set:` sẽ qua được TOÀN BỘ phép
  // trên (bộ mới vẫn có mặt đủ) và chỉ chết ở đây. Đây cũng là hình dạng hỏng
  // nguy hiểm nhất về mặt sản phẩm: người dùng bỏ chọn một chủ đề mà nó không
  // bao giờ biến mất, và không có lỗi nào phát ra.
  const pick2 = CATEGORY_SLUGS.slice(5, 9);           // 4 slug KHÁC HẲN bộ đầu
  await setCats(pick2);
  const after2 = await me();
  h.assert(
    'gọi lần 2 với bộ slug khác ⇒ bộ CŨ biến mất hoàn toàn (semantics THAY-THẾ, không cộng dồn)',
    after2.ok &&
      after2.slugs.length === pick2.length &&
      pick2.every((s) => after2.slugs.includes(s)) &&
      pick1.every((s) => !after2.slugs.includes(s) || pick2.includes(s)),
    `bộ 1 [${pick1.join(',')}] → bộ 2 [${pick2.join(',')}] · đọc lại [${after2.slugs.join(',')}]` +
      ` (cộng dồn sẽ ra ${new Set([...pick1, ...pick2]).size} slug)`,
  );

  // ─── 4. Hai nhánh lỗi — chuỗi phải khớp NGUYÊN VĂN (hợp đồng với FE) ───────
  //
  // ⚠️ Dùng `h.silent` + `h.assert` chứ KHÔNG `gql(..., { expect })`: `expect`
  // chỉ phân loại lỗi KHI CÓ lỗi — query thành công thì `client.mjs:135` ghi
  // OK, không ghi FAIL. Phép kiểm lấy "phải ném lỗi" làm bằng chứng mà viết
  // bằng `expect` sẽ xanh vĩnh viễn đúng lúc cần đỏ (bài học Đợt 3e).
  const tooFew = await setCats(CATEGORY_SLUGS.slice(0, 2));
  h.assert(
    `updateMyCategories 2 slug ⇒ ném ĐÚNG NGUYÊN VĂN "${ERR_TOO_FEW}"`,
    (tooFew?.errors?.[0]?.message ?? '') === ERR_TOO_FEW,
    tooFew?.errors ? `nhận: "${tooFew.errors[0].message}"` : 'KHÔNG ném lỗi (2 slug vẫn qua được ngưỡng ≥3)',
  );

  const bogus = await setCats([CATEGORY_SLUGS[0], CATEGORY_SLUGS[1], 'khong-ton-tai-slug']);
  h.assert(
    `updateMyCategories có slug rác ⇒ ném ĐÚNG NGUYÊN VĂN "${ERR_UNKNOWN}"`,
    (bogus?.errors?.[0]?.message ?? '') === ERR_UNKNOWN,
    bogus?.errors ? `nhận: "${bogus.errors[0].message}"` : 'KHÔNG ném lỗi (slug rác vẫn được nhận)',
  );

  // Slug lặp lại KHÔNG được tính là 3 lựa chọn — nếu không, người dùng bấm một
  // chủ đề ba lần là qua được ngưỡng, và ràng buộc Q2 thành hình thức.
  const dup = await setCats([CATEGORY_SLUGS[0], CATEGORY_SLUGS[0], CATEGORY_SLUGS[0]]);
  h.assert(
    'ba slug TRÙNG NHAU vẫn bị chặn (chuẩn hoá trước khi đếm, không đếm thô)',
    (dup?.errors?.[0]?.message ?? '') === ERR_TOO_FEW,
    dup?.errors ? `nhận: "${dup.errors[0].message}"` : 'KHÔNG ném lỗi — 1 chủ đề lặp 3 lần qua được ngưỡng',
  );

  // Trạng thái phải KHÔNG đổi sau ba lần gọi lỗi.
  const afterErrors = await me();
  h.assert(
    'ba lời gọi lỗi KHÔNG làm thay đổi danh sách category đang có',
    afterErrors.slugs.length === after2.slugs.length &&
      after2.slugs.every((s) => afterErrors.slugs.includes(s)),
    `trước [${after2.slugs.join(',')}] · sau [${afterErrors.slugs.join(',')}]`,
  );

  // ─── 5. completeOnboarding — idempotent, không tham số ─────────────────────
  const done1 = await h.silent(`mutation{ completeOnboarding{ id isOnboarded } }`, {}, TO);
  const done2 = await h.silent(`mutation{ completeOnboarding{ id isOnboarded } }`, {}, TO);
  const afterDone = await me();
  h.assert(
    'completeOnboarding: false → true, và gọi lần 2 vẫn true KHÔNG lỗi (idempotent)',
    done1?.data?.completeOnboarding?.isOnboarded === true &&
      !done2?.errors &&
      done2?.data?.completeOnboarding?.isOnboarded === true &&
      afterDone.isOnboarded === true,
    `trước=${before.isOnboarded} · lần1=${done1?.data?.completeOnboarding?.isOnboarded} · ` +
      `lần2=${done2?.data?.completeOnboarding?.isOnboarded}${done2?.errors ? ` LỖI: ${done2.errors[0].message}` : ''} · đọc lại=${afterDone.isOnboarded}`,
  );

  // ─── 6. Khách không token gọi cả hai ⇒ lỗi auth đúng khuôn nhà ─────────────
  for (const [label, mutation] of [
    ['updateMyCategories', `mutation($s:[String!]!){ updateMyCategories(slugs:$s){ id } }`],
    ['completeOnboarding', `mutation{ completeOnboarding{ id } }`],
  ]) {
    const anon = await h.silent(mutation, { s: CATEGORY_SLUGS.slice(0, 3) }, undefined);
    h.assert(
      `${label} KHÔNG token ⇒ Unauthorized (guard bắt buộc, khách không có "sở thích")`,
      /unauthor/i.test(anon?.errors?.[0]?.message ?? ''),
      anon?.errors ? `ném đúng: ${anon.errors[0].message}` : `KHÔNG chặn — trả về ${JSON.stringify(anon?.data)}`,
    );
  }

  // ─── 7. Seed user không bị lùa vào onboarding ──────────────────────────────
  // Guard phía FE điều hướng theo `isOnboarded`; 5 tài khoản mốc mà `false` thì
  // mọi đợt T2 sau này sẽ bị chặn ở màn onboarding trước khi tới được thứ cần đo.
  const baoMe = await h.silent(`query{ me{ id isOnboarded } }`, {}, state.T1);
  h.assert(
    'tài khoản seed (bao) có isOnboarded=true ⇒ không bị guard FE lùa vào onboarding',
    baoMe?.data?.me?.isOnboarded === true,
    `bao.isOnboarded=${baoMe?.data?.me?.isOnboarded}`,
  );

  // ─── 8. Dọn: xoá tài khoản throwaway ───────────────────────────────────────
  await h.silent(`mutation{ deleteAccount }`, {}, TO);

  return true;
}
