// Bước 79 — LUẬT 3 "chủ pin còn sống" + `categories(withPinsOnly:)` (27/08/2026)
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  BƯỚC NÀY CANH MỘT SỰ CỐ ĐÃ XẢY RA THẬT, KHÔNG PHẢI MỘT GIẢ THUYẾT.      ║
// ║                                                                           ║
// ║  Một tài khoản bị xoá mềm để lại 5 pin PUBLIC trong feed. Middleware       ║
// ║  soft-delete lọc user đã xoá khỏi mọi query ⇒ loader trả `null` cho       ║
// ║  `Pin.creator`, mà field đó khai NON-NULLABLE ⇒ GraphQL huỷ **TOÀN BỘ**   ║
// ║  response `exploreFeed`, không phải chỉ một thẻ. Triệu chứng: TRANG CHỦ   ║
// ║  TRẮNG với tất cả mọi người, khách lẫn người đã đăng nhập, không một      ║
// ║  thông báo lỗi nào. Job purge có ân hạn 30 ngày ⇒ trạng thái hỏng đó kéo  ║
// ║  dài 30 ngày chứ không tự khỏi.                                          ║
// ║                                                                           ║
// ║  🔴 PHÉP QUAN TRỌNG NHẤT LÀ 4a — "exploreFeed VẪN TRẢ VỀ MẢNG".          ║
// ║  Các phép "pin bị ẩn" (4b/4c/4d) đều xanh một cách giả tạo khi response   ║
// ║  bị huỷ sạch: không có items thì đương nhiên pin không nằm trong items.   ║
// ║  Phải đo `errors` TRƯỚC, và đo rằng feed còn ĐẦY (còn pin seed), rồi mới  ║
// ║  đo pin của người đã xoá biến mất.                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//
// PHẠM VI: cả hai thay đổi của commit `a4610c6` — chúng dùng CHUNG một bộ lọc,
// nên tách ra hai bước sẽ dựng cùng một tiền đề hai lần.
//   · luật 3 ở `common/blocking/visible-pins.util.ts` (3 hình thái: `where`
//     của Prisma, SQL thô, và bản in-memory) + `findById`;
//   · `categories(withPinsOnly:)` ở `pins.service.ts` — mệnh đề EXISTS của nó
//     là BẢN SAO Y bộ lọc `exploreFeed`. Đây chính là chỗ dễ trôi nhất: đếm
//     thô "danh mục có pin nào không" cũng cho ra một danh sách trông hợp lý,
//     chỉ sai với đúng người dùng đang xem.
//
// ⚠️ HÌNH DẠNG "DANH SÁCH RỖNG" LÀ BẪY CHUNG CỦA CẢ BƯỚC (bẫy 8 của bước 68):
// một query BỊ TỪ CHỐI và một query trả về đúng-không-có-gì cho ra cùng một
// hình dạng. Mọi phép dưới đây đọc `errors` trước `data`.
//
// ⚠️ ĐỐI CHỨNG ÂM BẮT BUỘC (mục 5): `categories` mặc định (`withPinsOnly:false`)
// PHẢI vẫn trả đủ 12 danh mục sau khi chủ pin bị xoá. Thiếu phép này thì một
// bản cài đặt lỡ tay lọc cho MỌI lời gọi vẫn xanh trọn vẹn — và màn onboarding
// (nơi hỏi sở thích, cố ý dùng `false`) sẽ chỉ còn vài chip mà không ai biết.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 5 lần). Trạng thái sống lâu ở đây:
//   · `Pin` tiêu đề `ca79*` — pin của lần chạy trước lọt vào exploreFeed của
//     bước 80/90 và làm lệch phép đối chiếu tập pin;
//   · `User` email `ca79_*` — bước này CỐ Ý xoá mềm một tài khoản. Còn sót lại
//     thì bước 80 (purge, `graceDays=0`) đếm thêm một ứng viên, và pin mồ côi
//     của nó lại tái tạo đúng sự cố mà bước này đang canh.
//
// VỊ TRÍ 79: sau 78 (78 dọn tài khoản dùng-một-lần của nó ở `finally`), TRƯỚC
// 80 — bước 80 hard-delete mọi tài khoản đã xoá mềm, nên chạy sau nó thì tiền
// đề "user xoá mềm còn nằm trong bảng" không còn dựng được.

import { createRequire } from 'node:module';
import { readApiEnv, API } from '../lib/client.mjs';
import { CATEGORY_SLUGS, isSeedPinId } from '../lib/seedrefs.mjs';

const require = createRequire(import.meta.url);

const TITLE = 'ca79 pin cua tai khoan sap xoa';

const Q_CATS = `query($w:Boolean){ categories(withPinsOnly:$w){ id slug } }`;
const Q_FEED = `query{ exploreFeed(first:50){ items{ id } } }`;
const Q_PIN = `query($id:ID!){ pin(id:$id){ id title } }`;
const M_CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ id } }`;

const errMsg = (r) => {
  const e = r?.errors?.[0];
  if (!e) return null;
  const raw = e.extensions?.originalError?.message ?? e.message;
  return Array.isArray(raw) ? raw.join('; ') : String(raw);
};

/** Ảnh hợp lệ theo whitelist domain (`localhost`) — xem media-host.util.ts. */
const img = () => ({
  imageUrl: 'https://localhost/ca79-probe.jpg',
  imageWidth: 64,
  imageHeight: 64,
});

export default async function (h) {
  const { gql, silent, assert, rec, state } = h;
  h.setGroup('GQL/creator-alive');

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

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═════════════════════════════════════════════════════
    {
      const pins = await prisma.pin.deleteMany({ where: { title: { startsWith: 'ca79' } } });
      const users = await prisma.user.deleteMany({ where: { email: { startsWith: 'ca79_' } } });
      rec(
        'dọn state sống lâu Ở ĐẦU BƯỚC (pin ca79* + tài khoản ca79_* đã xoá mềm của lần trước)',
        'OK',
        `xoá ${pins.count} pin · ${users.count} tài khoản`,
      );
    }

    // ═══ 0. Tài khoản dùng-một-lần — SẼ BỊ XOÁ MỀM, nên phải là tài khoản riêng ═══
    //
    // Không dùng bao/john/alice: xoá mềm một tài khoản seed là phá tiền đề cứng
    // của hàng chục phép ở các bước khác, và `deletedAt` không có đường hoàn tác
    // qua API.
    let token = null;
    {
      const email = `ca79_${state.uniq}@example.com`;
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Creator alive probe' }),
      });
      const body = await r.json().catch(() => null);
      token = body?.accessToken ?? null;
      // Tên bản ghi KHÔNG chứa email thật (đổi mỗi lần chạy): mốc hồi quy đối
      // chiếu `results.json` theo cặp `group::name`.
      assert(
        'đăng ký tài khoản dùng-một-lần ca79_<uniq>@example.com (tài khoản này sẽ bị XOÁ MỀM, không được dùng tài khoản seed)',
        Boolean(token),
        token ? 'có accessToken' : `KHÔNG có accessToken: ${JSON.stringify(body).slice(0, 120)}`,
      );
      if (!token) return false;
    }

    // ═══ 1. Chọn danh mục RỖNG với người xem là KHÁCH ════════════════════════
    //
    // Khách chứ không phải người đã đăng nhập: đây là bề mặt công khai, và là
    // đúng người xem đã gặp sự cố trang chủ trắng.
    let targetSlug = null;
    let targetId = null;
    {
      const full = await silent(Q_CATS, { w: false }, null);
      const fullSlugs = (full?.data?.categories ?? []).map((c) => c.slug).sort();
      assert(
        '`categories` mặc định trả đủ 12 danh mục biên tập cho khách (tiền đề: withPinsOnly KHÔNG phải mặc định)',
        !full?.errors && fullSlugs.length === CATEGORY_SLUGS.length,
        errMsg(full) ? `LỖI: ${errMsg(full)}` : `${fullSlugs.length} danh mục`,
      );

      const before = await gql(
        '`categories(withPinsOnly:true)` chạy được cho khách và trả ÍT hơn danh sách đầy đủ (seed chỉ gắn pin cho 4/12 danh mục)',
        Q_CATS,
        { w: true },
        {},
      );
      const beforeSlugs = (before?.categories ?? []).map((c) => c.slug);
      assert(
        'withPinsOnly=true lọc THẬT: số danh mục nhỏ hơn hẳn 12 (nếu bằng 12 thì tham số đang bị bỏ qua)',
        beforeSlugs.length > 0 && beforeSlugs.length < CATEGORY_SLUGS.length,
        `${beforeSlugs.length}/${CATEGORY_SLUGS.length}: ${beforeSlugs.join(',')}`,
      );

      const empty = (full?.data?.categories ?? []).find((c) => !beforeSlugs.includes(c.slug));
      targetSlug = empty?.slug ?? null;
      targetId = empty?.id ?? null;
      assert(
        'tìm được một danh mục CHƯA có pin nào xem được — tiền đề của phép đỏ-trước/xanh-sau bên dưới',
        Boolean(targetId),
        targetSlug ?? '(không có danh mục rỗng — seed đã đổi?)',
      );
      if (!targetId) return false;
    }

    // ═══ 2. ĐỎ-TRƯỚC → XANH-SAU cho withPinsOnly ════════════════════════════
    let pinId = null;
    {
      const created = await gql(
        'tài khoản dùng-một-lần tạo 1 pin PUBLIC vào đúng danh mục rỗng đó',
        M_CREATE,
        { i: { ...img(), title: TITLE, categoryIds: [targetId] } },
        { token },
      );
      pinId = created?.createPin?.id ?? null;
      assert('pin được tạo thật (có id)', Boolean(pinId), pinId ?? '(không có id)');
      if (!pinId) return false;

      const after = await gql(
        `sau khi có pin: \`categories(withPinsOnly:true)\` của KHÁCH có thêm đúng danh mục vừa dùng`,
        Q_CATS,
        { w: true },
        {},
      );
      const afterSlugs = (after?.categories ?? []).map((c) => c.slug);
      assert(
        'danh mục rỗng lúc nãy NAY xuất hiện trong withPinsOnly=true (mệnh đề EXISTS đọc dữ liệu sống, không phải danh sách tĩnh)',
        afterSlugs.includes(targetSlug),
        `${targetSlug} ∈ [${afterSlugs.join(',')}]`,
      );
    }

    // ═══ 3. Tiền đề: khách THẤY pin đó ở cả hai bề mặt ══════════════════════
    {
      const feed = await silent(Q_FEED, {}, null);
      const ids = (feed?.data?.exploreFeed?.items ?? []).map((p) => p.id);
      assert(
        'trước khi xoá chủ: khách thấy pin trong exploreFeed',
        !feed?.errors && ids.includes(pinId),
        errMsg(feed) ? `LỖI: ${errMsg(feed)}` : `${ids.length} pin trong feed, có pin probe? ${ids.includes(pinId)}`,
      );

      const one = await gql('trước khi xoá chủ: khách mở được URL thẳng tới pin', Q_PIN, { id: pinId }, {});
      assert(
        'pin(id) trả đúng pin probe',
        one?.pin?.id === pinId,
        one?.pin?.title ?? '(không có)',
      );
    }

    // ═══ 4. XOÁ MỀM CHỦ PIN → bốn bề mặt ════════════════════════════════════
    {
      const del = await silent(`mutation{ deleteAccount }`, {}, token);
      assert(
        'xoá mềm chủ pin bằng chính `deleteAccount` (chỉ set User.deletedAt — KHÔNG đụng tới Pin, đó là điều kiện tạo ra sự cố)',
        del?.data?.deleteAccount === true,
        JSON.stringify(del?.errors?.[0]?.message ?? del?.data ?? del).slice(0, 120),
      );

      // ── 4a — PHÉP QUAN TRỌNG NHẤT: response KHÔNG bị huỷ ─────────────────
      const feed = await silent(Q_FEED, {}, null);
      const items = feed?.data?.exploreFeed?.items ?? null;
      const seedCount = Array.isArray(items) ? items.filter((p) => isSeedPinId(p.id)).length : -1;
      assert(
        '🔴 4a — exploreFeed của KHÁCH vẫn trả về mảng pin bình thường (đây là phép canh sự cố "trang chủ trắng": Pin.creator null trên field NON-NULLABLE sẽ huỷ CẢ response, không chỉ một thẻ)',
        !feed?.errors && Array.isArray(items) && seedCount > 0,
        errMsg(feed)
          ? `LỖI — response bị huỷ: ${errMsg(feed)}`
          : `${items?.length ?? 0} pin, trong đó ${seedCount} pin seed`,
      );

      // ── 4b — pin của người đã xoá biến khỏi feed ─────────────────────────
      const ids = Array.isArray(items) ? items.map((p) => p.id) : [];
      assert(
        '4b — pin của tài khoản đã xoá KHÔNG còn trong exploreFeed (hình thái SQL thô: `visiblePinSql` → EXISTS User.deletedAt IS NULL)',
        Array.isArray(items) && !ids.includes(pinId),
        `pin probe còn trong feed? ${ids.includes(pinId)}`,
      );

      // ── 4c — URL thẳng: bề mặt mà phép kiểm feed không với tới ───────────
      await gql(
        '4c — URL thẳng `pin(id)` trả 404 chứ KHÔNG phải 500 (findById include creator.deletedAt; thiếu nó thì link cũ nổ 500)',
        Q_PIN,
        { id: pinId },
        { expect: /not found/i },
      );

      // ── 4d — chip chủ đề rụng theo ──────────────────────────────────────
      const cats = await gql(
        '4d — `categories(withPinsOnly:true)` bỏ lại danh mục đó (bộ lọc của chip TRÙNG KHỚP bộ lọc feed, không đếm thô)',
        Q_CATS,
        { w: true },
        {},
      );
      const slugs = (cats?.categories ?? []).map((c) => c.slug);
      assert(
        'danh mục probe biến mất khỏi withPinsOnly=true sau khi chủ pin bị xoá',
        !slugs.includes(targetSlug),
        `${targetSlug} ∈ [${slugs.join(',')}] ? ${slugs.includes(targetSlug)}`,
      );
    }

    // ═══ 5. ĐỐI CHỨNG ÂM — mặc định KHÔNG được lọc ══════════════════════════
    {
      const full = await gql(
        '5 — đối chứng âm: `categories` mặc định VẪN trả đủ 12 danh mục (nếu bản cài đặt lỡ lọc cho mọi lời gọi, màn onboarding sẽ mất chip mà không phép nào khác đỏ)',
        Q_CATS,
        { w: false },
        {},
      );
      const slugs = (full?.categories ?? []).map((c) => c.slug).sort();
      assert(
        'danh sách mặc định vẫn là đúng 12 slug biên tập, gồm cả danh mục vừa rỗng trở lại',
        slugs.length === CATEGORY_SLUGS.length && slugs.includes(targetSlug),
        `${slugs.length} danh mục · có ${targetSlug}? ${slugs.includes(targetSlug)}`,
      );
    }

    return true;
  } catch (e) {
    rec('bước 79 ném ngoại lệ', 'FAIL', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
    return false;
  } finally {
    // ─── Tự dọn sau lưng ─────────────────────────────────────────────────────
    //
    // Hard-delete tài khoản probe chứ không để lại trạng thái xoá-mềm: bước 80
    // đếm ứng viên purge, và một tài khoản thừa ở đó làm lệch phép đối chiếu
    // `found === purged` của nó. `deleteMany` KHÔNG bị middleware soft-delete
    // đụng tới (middleware chỉ vá `findMany`/`findFirst`).
    const pins = await prisma.pin
      .deleteMany({ where: { title: { startsWith: 'ca79' } } })
      .catch(() => ({ count: -1 }));
    const users = await prisma.user
      .deleteMany({ where: { email: { startsWith: 'ca79_' } } })
      .catch(() => ({ count: -1 }));
    assert(
      'đã dọn: pin ca79* + tài khoản probe bị XOÁ CỨNG (để lại trạng thái xoá mềm sẽ làm lệch phép đếm ứng viên purge của bước 80)',
      pins.count >= 0 && users.count >= 0,
      `xoá ${pins.count} pin · ${users.count} tài khoản`,
    );
    await prisma.$disconnect().catch(() => {});
  }
}
