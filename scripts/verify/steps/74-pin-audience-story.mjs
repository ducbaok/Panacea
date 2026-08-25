// Bước 74 — XH-4a + XH-6 + XH-9a: đường GHI của khán giả, kho, và đăng lại
// (PLAN_XAHOI.md §6 · xahoi-dieu-phoi.md §6 luồng A)
//
// KHÁC BƯỚC 72 Ở CHỖ NÀO: 72 chứng minh đường ĐỌC lọc đúng, với vòng tròn và
// pin fixture seed THẲNG VÀO DB (lúc đó chưa có API nào tạo được chúng). Bước
// này chứng minh đường GHI: mọi pin và mọi vòng tròn dưới đây sinh ra từ
// `createPin`/`updatePin` THẬT — kể cả vòng ad-hoc, vì `audienceUserIds` chính
// là đường tạo vòng đầu tiên của dự án (API vòng tròn là luồng B, chưa merge).
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 3 lần — PLAN_XAHOI.md §7). Trạng thái
// sống lâu bước này đẻ ra: `Pin` (tiền tố tiêu đề `xh74`), `Circle` ad-hoc +
// `CircleMember` của chúng. Nhận diện vòng của bước này bằng `memberHash IS NOT
// NULL` chứ KHÔNG phải `isAdHoc`: fixture của bước 72 có một vòng `isAdHoc`
// nhưng `memberHash` null, xoá nhầm nó là phá dữ liệu của bước khác.
//
// ⚠️ HAI PHÉP DÙNG `sleep` THẬT (~2.5s mỗi phép) và đó là điều KHÔNG tránh
// được: XH-QĐ-7 nói hết hạn đánh giá LÚC ĐỌC, nên cách duy nhất chứng minh nó
// bằng request thật là đặt hạn gần rồi chờ nó trôi qua. Sửa `expiresAt` thẳng
// vào DB sẽ chứng minh một đường đi khác với đường người dùng thật đi.
//
// Vai trong ma trận (bao = T1 · alice = T2 · john = T3):
//   xh74 public     (bao, PUBLIC)                  — ai cũng thấy
//   xh74 followers  (bao, FOLLOWERS)               — alice + john đều theo dõi bao ⇒ cùng thấy
//   xh74 circle     (bao, CIRCLE ad-hoc [alice])   — alice thấy · john KHÔNG,
//                                                    dù john CŨNG theo dõi bao
//                                                    (thành viên vòng ≠ follower)
//   xh74 onlyme     (bao, ONLY_ME)                 — chỉ bao

import { createRequire } from 'node:module';
import { USERS } from '../lib/seedrefs.mjs';
import { readApiEnv, sleep } from '../lib/client.mjs';
import { openPinRateCleaner, pinCreatePerMin } from '../lib/pin-rate.mjs';

const require = createRequire(import.meta.url);

/** Ảnh giả — chỉ cần đúng domain whitelist, không cần tồn tại thật. */
const IMG = 'http://localhost:4000/uploads/xh74.png';
const EVIL = 'https://evil.example.com/xh74.png';
/** Mọi pin của bước này mang tiền tố tiêu đề duy nhất để dọn được. */
const T = (s) => `xh74 ${s}`;

const F_PIN = 'id title visibility audienceCircleId expiresAt thumbnailUrl mediumUrl largeUrl';
const M_CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ ${F_PIN} } }`;
const M_UPDATE = `mutation($i:UpdatePinInput!){ updatePin(input:$i){ ${F_PIN} } }`;
const M_REPUB = `mutation($id:ID!){ republishPin(id:$id){ id expiresAt } }`;
const Q_PIN = `query($id:ID!){ pin(id:$id){ id title visibility audienceCircleId } }`;
const Q_USERPINS = `query($u:ID!){ userPins(userId:$u, first:50){ items{ id } } }`;
const Q_EXPLORE = `query{ exploreFeed(first:50){ items{ id } } }`;
const Q_ARCHIVE = `query{ archivedPins(first:50){ items{ id title expiresAt } pageInfo{ hasNextPage endCursor } } }`;

const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const show = (s) => `{${[...s].sort().join(', ')}}`;
const errOf = (r) => r?.errors?.[0]?.extensions?.originalError?.message ?? r?.errors?.[0]?.message ?? null;

export default async function (h) {
  const { gql: rawGql, silent: rawSilent, rec, assert, state } = h;
  h.setGroup('GQL/pin-audience');

  // ╔═══════════════════════════════════════════════════════════════════════╗
  // ║  VÌ SAO `gql`/`silent` CỦA BƯỚC NÀY BỊ BỌC LẠI (25/08 — XH-4b)        ║
  // ║                                                                       ║
  // ║  Bước này đăng hơn 30 pin bằng CÙNG tài khoản `bao` trong vài giây,    ║
  // ║  còn trần XH-4b chỉ cho 10 pin/phút. Và nó tiêu quota NHIỀU hơn số     ║
  // ║  pin tạo được: chốt trần đứng TRƯỚC validate (có chủ đích — xem        ║
  // ║  `pins.service.ts`), nên mỗi phép ÂM ("ảnh domain lạ ⇒ chặn") cũng     ║
  // ║  tốn một suất. Lần chạy đầu sau khi XH-4b vào: 14 phép đỏ, tất cả với  ║
  // ║  thông điệp "Too many pins created" — tức là đỏ vì một luật KHÔNG      ║
  // ║  phải luật chúng đo.                                                  ║
  // ║                                                                       ║
  // ║  Cách gỡ: xoá bộ đếm phút NGAY TRƯỚC mỗi lời gọi `createPin`. Không   ║
  // ║  nới trần (API vẫn chạy đúng cấu hình sản xuất), chỉ tua nhanh 60      ║
  // ║  giây mà một người thật sẽ phải chờ giữa hai loạt.                    ║
  // ║                                                                       ║
  // ║  Bọc ở ĐÂY chứ không rắc `await clear()` vào 11 chỗ gọi vì bước này    ║
  // ║  còn được thêm phép: một phép mới quên gỡ trần sẽ đỏ ngẫu nhiên tuỳ    ║
  // ║  vị trí nó đứng — loại lỗi tốn nửa ngày để lần ra.                    ║
  // ║                                                                       ║
  // ║  Bước 75/76 KHÔNG cần bọc: mỗi bước đăng dưới 10 pin và đã dọn bộ     ║
  // ║  đếm ở đầu bước, nên không bao giờ chạm trần trong cửa sổ của mình.   ║
  // ╚═══════════════════════════════════════════════════════════════════════╝
  const rate = await openPinRateCleaner();
  const freshQuota = () => rate.clear([USERS.bao.id, USERS.alice.id, USERS.john.id]);
  const isCreate = (q) => typeof q === 'string' && q.includes('createPin');
  const gql = async (name, query, variables, opts) => {
    if (isCreate(query)) await freshQuota();
    return rawGql(name, query, variables, opts);
  };
  const silent = async (query, variables, token) => {
    if (isCreate(query)) await freshQuota();
    return rawSilent(query, variables, token);
  };

  // ─── Prisma CHỈ để dọn + đếm nền (không phải bằng chứng) ───────────────────
  let prisma;
  try {
    const { PrismaClient } = require('../../../packages/database/src/client');
    const url = readApiEnv('DATABASE_URL');
    if (!url) {
      rec('setup: DATABASE_URL', 'FAIL', 'không đọc được từ env lẫn apps/api/.env');
      rate.close();
      return false;
    }
    prisma = new PrismaClient({ datasources: { db: { url } } });
  } catch (e) {
    rec('setup: PrismaClient', 'FAIL', String(e.message).slice(0, 150));
    rate.close();
    return false;
  }

  /** Tạo pin bằng request THẬT, trả về object pin (hoặc null nếu lỗi). */
  const create = async (name, input, token = state.T1, opts = {}) => {
    const d = await gql(name, M_CREATE, { i: { imageUrl: IMG, imageWidth: 100, imageHeight: 150, ...input } }, { token, ...opts });
    return d?.createPin ?? null;
  };

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═════════════════════════════════════════════════════
    const wipedPins = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh74' } } });
    // Xoá SẠCH bảng Circle, không xoá theo điều kiện — cùng lý do 73 đã ghi:
    // phép trần 20 vòng/người (mục 11) chỉ đo được khi điểm xuất phát là 0.
    // Bản đầu chỉ xoá `memberHash IS NOT NULL` và đỏ 4 phép ngay lần chạy
    // full đầu tiên sau merge A+B: bước 73 chạy TRƯỚC để lại ~20 vòng đặt tên
    // (memberHash null) cho john — `finally` của 73 chủ đích chỉ dọn tài khoản
    // độn. Bước sau tự dọn thứ mình phụ thuộc, không tin bước trước dọn hộ.
    await prisma.circleMember.deleteMany({});
    const wipedCircles = await prisma.circle.deleteMany({});
    rec(
      'dọn state sống lâu Ở ĐẦU BƯỚC (pin xh74* + xoá SẠCH Circle/CircleMember)',
      'OK',
      `pin=${wipedPins.count} circle=${wipedCircles.count}`,
    );

    // Trạng thái sống lâu THỨ HAI của bước này, thêm từ 25/08 (XH-4b): bộ đếm
    // `pincreate:<userId>` có TTL 60s nên nó sống XUYÊN QUA ranh giới bước.
    // Bước 73 ngay trước không đăng pin, nhưng một lần chạy lại ngay sau khi
    // bước này vừa chạy xong thì `bao` bắt đầu với quota đã cạn — và phép "21
    // pin trong cùng một ngày" dưới đây sẽ đỏ vì một luật KHÁC hẳn luật nó đo.
    const clearedRate = await freshQuota();
    rec(
      'dọn bộ đếm `pincreate:*` Ở ĐẦU BƯỚC (trần 10 pin/phút XH-4b sống 60s, xuyên qua ranh giới bước)',
      'OK',
      clearedRate === null
        ? 'không kết nối được Redis ⇒ trần đang fail-open, không có gì để dọn'
        : `xoá ${clearedRate} khoá · trần đang chạy = ${pinCreatePerMin()} pin/phút`,
    );

    // ─── Tiền đề topology (seed đổi thì phép dưới mất ý nghĩa) ───────────────
    const baoFollowers = new Set(
      (await prisma.follows.findMany({ where: { followingId: USERS.bao.id }, select: { followerId: true } })).map(
        (f) => f.followerId,
      ),
    );
    const topoOk = baoFollowers.has(USERS.alice.id) && baoFollowers.has(USERS.john.id);
    assert(
      'tiền đề: CẢ alice VÀ john đều theo dõi bao',
      topoOk,
      `followers(bao)=${[...baoFollowers].join(',')} — cần cả hai để chứng minh "thành viên vòng ≠ follower"`,
    );
    if (!topoOk) return false;

    // ═══ 1. Bốn cấp khán giả, tạo bằng mutation THẬT ═════════════════════════
    const pub = await create('createPin PUBLIC (mặc định — không gửi visibility)', { title: T('public') });
    const fol = await create('createPin FOLLOWERS', { title: T('followers'), visibility: 'FOLLOWERS' });
    const cir = await create('createPin CIRCLE — khán giả ad-hoc [alice]', {
      title: T('circle'),
      visibility: 'CIRCLE',
      audienceUserIds: [USERS.alice.id],
    });
    const me = await create('createPin ONLY_ME', { title: T('onlyme'), visibility: 'ONLY_ME' });

    if (!pub || !fol || !cir || !me) {
      rec('setup: 4 pin fixture', 'FAIL', 'thiếu ít nhất một pin — xem 4 phép ngay trên');
      return false;
    }
    assert(
      'không gửi visibility ⇒ PUBLIC, và PUBLIC không ghim vòng nào',
      pub.visibility === 'PUBLIC' && pub.audienceCircleId === null,
      `visibility=${pub.visibility} audienceCircleId=${pub.audienceCircleId}`,
    );
    assert(
      'CIRCLE ad-hoc: server tự tạo vòng và ghim vào pin',
      cir.visibility === 'CIRCLE' && typeof cir.audienceCircleId === 'string' && cir.audienceCircleId.length > 0,
      `visibility=${cir.visibility} audienceCircleId=${cir.audienceCircleId}`,
    );
    const CIRCLE_ID = cir.audienceCircleId;

    // ═══ 2. memberHash — cùng tập người ⇒ CÙNG MỘT vòng, không đẻ vòng mới ═══
    //
    // Gửi lệch đi hai kiểu mà server phải coi là CÙNG một khán giả: trùng lặp
    // (`alice` hai lần) và có cả CHÍNH CHỦ trong danh sách. Cả hai đều là thứ
    // một client thật gửi lên, và cả hai đều làm băm lệch nếu không chuẩn hoá.
    const cirAgain = await create('createPin CIRCLE ad-hoc lần 2 — [alice, alice, bao]', {
      title: T('circle2'),
      visibility: 'CIRCLE',
      audienceUserIds: [USERS.alice.id, USERS.alice.id, USERS.bao.id],
    });
    assert(
      'memberHash tái dùng vòng: cùng tập người ⇒ ĐÚNG MỘT Circle',
      cirAgain?.audienceCircleId === CIRCLE_ID,
      `lần 1=${CIRCLE_ID} · lần 2=${cirAgain?.audienceCircleId}`,
    );
    const adHocRows = await prisma.circle.count({ where: { ownerId: USERS.bao.id, memberHash: { not: null } } });
    assert(
      'đối chứng ở tầng dữ liệu: 2 lần đăng chỉ đẻ 1 vòng ad-hoc',
      adHocRows === 1,
      `Circle(ownerId=bao, memberHash≠null) = ${adHocRows}`,
    );

    // ═══ 3. Vòng của người khác ⇒ 404 (không phải 403) ══════════════════════
    const johnPin = await create(
      'john tạo pin CIRCLE ad-hoc [bob] (dựng vòng của NGƯỜI KHÁC)',
      { title: T('john circle'), visibility: 'CIRCLE', audienceUserIds: [USERS.bob.id] },
      state.T3,
    );
    const JOHN_CIRCLE = johnPin?.audienceCircleId;
    assert('john nhận được id vòng của chính john', typeof JOHN_CIRCLE === 'string', `audienceCircleId=${JOHN_CIRCLE}`);
    await gql(
      'bao ghim vòng của john ⇒ 404 Circle not found (không 403)',
      M_CREATE,
      { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T('steal'), visibility: 'CIRCLE', audienceCircleId: JOHN_CIRCLE } },
      { token: state.T1, expect: /Circle not found/ },
    );
    await gql(
      'ghim vòng KHÔNG TỒN TẠI ⇒ cùng 404, không phân biệt được với vòng người khác',
      M_CREATE,
      { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T('ghost'), visibility: 'CIRCLE', audienceCircleId: 'xh74_khong_ton_tai' } },
      { token: state.T1, expect: /Circle not found/ },
    );
    await gql(
      'bao ghim LẠI vòng của chính mình bằng id ⇒ được',
      M_CREATE,
      { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T('byid'), visibility: 'CIRCLE', audienceCircleId: CIRCLE_ID } },
      { token: state.T1 },
    );

    // ═══ 4. Kết hợp sai ⇒ 400, KHÔNG bỏ qua im lặng ═════════════════════════
    const badCombo = (name, input, expect) =>
      gql(name, M_CREATE, { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T('bad'), ...input } }, { token: state.T1, expect });
    await badCombo('PUBLIC + audienceCircleId ⇒ 400 (không im lặng bỏ vòng)', { audienceCircleId: CIRCLE_ID }, /only apply when visibility is CIRCLE/);
    await badCombo('ONLY_ME + audienceUserIds ⇒ 400', { visibility: 'ONLY_ME', audienceUserIds: [USERS.alice.id] }, /only apply when visibility is CIRCLE/);
    await badCombo('CIRCLE mà không có khán giả ⇒ 400', { visibility: 'CIRCLE' }, /exactly one of audienceCircleId or audienceUserIds/);
    await badCombo(
      'CIRCLE mà gửi CẢ HAI ⇒ 400',
      { visibility: 'CIRCLE', audienceCircleId: CIRCLE_ID, audienceUserIds: [USERS.john.id] },
      /exactly one of audienceCircleId or audienceUserIds/,
    );
    await badCombo('audienceUserIds chỉ có chính mình ⇒ 400', { visibility: 'CIRCLE', audienceUserIds: [USERS.bao.id] }, /at least one user other than yourself/);
    await badCombo('audienceUserIds có id rác ⇒ 400 nói ĐÚNG id sai', { visibility: 'CIRCLE', audienceUserIds: ['xh74_nguoi_ma'] }, /Unknown userId: xh74_nguoi_ma/);
    await badCombo('expiresAt quá khứ ⇒ 400', { expiresAt: new Date(Date.now() - 60_000).toISOString() }, /expiresAt must be in the future/);

    // ═══ 5. Ba URL biến thể (XH-9a) ═════════════════════════════════════════
    const variants = await create('createPin kèm 3 URL biến thể hợp lệ', {
      title: T('variants'),
      thumbnailUrl: IMG + '?s=t',
      mediumUrl: IMG + '?s=m',
      largeUrl: IMG + '?s=l',
    });
    assert(
      '3 biến thể được LƯU đúng như gửi lên',
      variants?.thumbnailUrl === IMG + '?s=t' && variants?.mediumUrl === IMG + '?s=m' && variants?.largeUrl === IMG + '?s=l',
      `thumb=${variants?.thumbnailUrl} medium=${variants?.mediumUrl} large=${variants?.largeUrl}`,
    );
    await badCombo('thumbnailUrl domain lạ ⇒ chặn, và nói RÕ field nào', { thumbnailUrl: EVIL }, /thumbnailUrl domain is not allowed/);
    await badCombo('mediumUrl domain lạ ⇒ chặn', { mediumUrl: EVIL }, /mediumUrl domain is not allowed/);
    await badCombo('largeUrl domain lạ ⇒ chặn', { largeUrl: EVIL }, /largeUrl domain is not allowed/);
    await badCombo('biến thể là URL TƯƠNG ĐỐI ⇒ chặn (phải tuyệt đối)', { thumbnailUrl: '/uploads/xh74.png' }, /Invalid thumbnailUrl/);
    await gql(
      'imageUrl domain lạ ⇒ thông điệp CŨ giữ nguyên (hợp đồng của apps/web)',
      M_CREATE,
      { i: { imageUrl: EVIL, imageWidth: 10, imageHeight: 10 } },
      { token: state.T1, expect: /Image URL domain is not allowed/ },
    );
    // XH-9a: kích thước vẫn là của ẢNH GỐC và vẫn BẮT BUỘC — 3 biến thể không
    // được phép biến chúng thành tuỳ chọn.
    await gql(
      'thiếu imageWidth ⇒ schema từ chối (kích thước ảnh GỐC vẫn bắt buộc)',
      `mutation($i:CreatePinInput!){ createPin(input:$i){ id } }`,
      { i: { imageUrl: IMG, imageHeight: 10, title: T('noW') } },
      { token: state.T1, expect: /imageWidth/ },
    );

    // ═══ 6. Ma trận khán giả trên hồ sơ — HAI NHÁNH trong CÙNG một response ══
    //
    // `userPins(bao)` chứ không phải `exploreFeed`: cùng luật lọc nhưng cửa sổ
    // nhỏ hơn nhiều, nên phép so tập không phụ thuộc vào việc hôm nay DB có bao
    // nhiêu pin. Điểm sắc của ma trận là cặp alice/john: CẢ HAI đều theo dõi
    // bao, nên khác biệt duy nhất giữa hai response là tư cách THÀNH VIÊN VÒNG.
    const mine = new Set([pub.id, fol.id, cir.id, me.id]);
    const seenOf = async (token) => {
      const r = await silent(Q_USERPINS, { u: USERS.bao.id }, token);
      return { err: errOf(r), ids: new Set((r?.data?.userPins?.items ?? []).map((i) => i.id).filter((id) => mine.has(id))) };
    };
    const expected = {
      bao: new Set([pub.id, fol.id, cir.id, me.id]),
      alice: new Set([pub.id, fol.id, cir.id]),
      john: new Set([pub.id, fol.id]),
      guest: new Set([pub.id]),
    };
    for (const [who, token] of [
      ['bao', state.T1],
      ['alice', state.T2],
      ['john', state.T3],
      ['guest', undefined],
    ]) {
      const { err, ids } = await seenOf(token);
      assert(
        `userPins(bao) dưới mắt ${who} — đúng tập 4 pin vừa ĐĂNG THẬT`,
        !err && setEq(ids, expected[who]),
        err ? `query LỖI: ${err}` : `thấy ${show(ids)} ≠ kỳ vọng ${show(expected[who])}`,
      );
    }

    // ═══ 7. updatePin đổi khán giả (XH-4a) ══════════════════════════════════
    const aliceSees = async (id) => {
      const r = await silent(Q_PIN, { id }, state.T2);
      return { err: errOf(r), ok: r?.data?.pin?.id === id };
    };
    await gql('updatePin đổi TIÊU ĐỀ thôi ⇒ không đụng khán giả', M_UPDATE, { i: { id: cir.id, title: T('circle v2') } }, { token: state.T1 });
    {
      const r = await silent(`query($id:ID!){ pin(id:$id){ id visibility audienceCircleId } }`, { id: cir.id }, state.T1);
      const p = r?.data?.pin;
      assert(
        'sửa tiêu đề KHÔNG âm thầm công khai pin (visibility + vòng còn nguyên)',
        p?.visibility === 'CIRCLE' && p?.audienceCircleId === CIRCLE_ID,
        `visibility=${p?.visibility} audienceCircleId=${p?.audienceCircleId}`,
      );
    }
    {
      const before = await aliceSees(me.id);
      const up = await gql(
        'updatePin ONLY_ME → CIRCLE ad-hoc [alice]',
        M_UPDATE,
        { i: { id: me.id, visibility: 'CIRCLE', audienceUserIds: [USERS.alice.id] } },
        { token: state.T1 },
      );
      const after = await aliceSees(me.id);
      assert(
        'đổi khán giả CÓ HIỆU LỰC NGAY: alice không thấy ⇒ thấy (cùng một pin, hai thời điểm)',
        !before.ok && after.ok && up?.updatePin?.audienceCircleId === CIRCLE_ID,
        `trước=${before.ok} sau=${after.ok} vòng=${up?.updatePin?.audienceCircleId} (kỳ vọng tái dùng ${CIRCLE_ID})`,
      );
    }
    {
      const up = await gql('updatePin CIRCLE → ONLY_ME (thu hẹp khán giả)', M_UPDATE, { i: { id: me.id, visibility: 'ONLY_ME' } }, { token: state.T1 });
      const after = await aliceSees(me.id);
      assert(
        'đổi sang cấp khác CIRCLE ⇒ audienceCircleId bị XOÁ, alice mất quyền xem',
        up?.updatePin?.visibility === 'ONLY_ME' && up?.updatePin?.audienceCircleId === null && !after.ok,
        `visibility=${up?.updatePin?.visibility} vòng=${up?.updatePin?.audienceCircleId} alice-còn-thấy=${after.ok}`,
      );
    }
    await gql(
      'updatePin gửi vòng mà KHÔNG gửi visibility ⇒ 400',
      M_UPDATE,
      { i: { id: me.id, audienceCircleId: CIRCLE_ID } },
      { token: state.T1, expect: /must be sent together with visibility: CIRCLE/ },
    );
    await gql(
      'updatePin ghim vòng của john ⇒ 404',
      M_UPDATE,
      { i: { id: me.id, visibility: 'CIRCLE', audienceCircleId: JOHN_CIRCLE } },
      { token: state.T1, expect: /Circle not found/ },
    );

    // ═══ 8. audienceCircleId chỉ chính chủ đọc được ═════════════════════════
    {
      const rAlice = await silent(Q_PIN, { id: cir.id }, state.T2);
      const rBao = await silent(Q_PIN, { id: cir.id }, state.T1);
      assert(
        'alice ĐỌC ĐƯỢC pin vòng nhưng KHÔNG đọc được id vòng (bao thì có)',
        rAlice?.data?.pin?.id === cir.id &&
          rAlice?.data?.pin?.audienceCircleId === null &&
          rBao?.data?.pin?.audienceCircleId === CIRCLE_ID,
        `alice: pin=${rAlice?.data?.pin?.id} vòng=${rAlice?.data?.pin?.audienceCircleId} · bao: vòng=${rBao?.data?.pin?.audienceCircleId}`,
      );
    }

    // ═══ 9. Hạn sống → kho → đăng lại (XH-6) ════════════════════════════════
    h.setGroup('GQL/archive');

    const story = await create('createPin có hạn sống 2.5s, khán giả vòng [alice]', {
      title: T('story'),
      visibility: 'CIRCLE',
      audienceUserIds: [USERS.alice.id],
      expiresAt: new Date(Date.now() + 2500).toISOString(),
    });
    if (!story) {
      rec('setup: pin story', 'FAIL', 'không tạo được pin có hạn — xem phép ngay trên');
      return false;
    }
    const inFeed = async (token, id) => {
      const r = await silent(Q_EXPLORE, {}, token);
      return { err: errOf(r), has: (r?.data?.exploreFeed?.items ?? []).some((i) => i.id === id) };
    };
    const archiveOf = async (token) => {
      const r = await silent(Q_ARCHIVE, {}, token);
      return { err: errOf(r), ids: new Set((r?.data?.archivedPins?.items ?? []).map((i) => i.id)) };
    };

    {
      const a = await inFeed(state.T2, story.id);
      assert('lúc CÒN HẠN: alice (trong vòng) thấy pin trong exploreFeed', !a.err && a.has, a.err ?? `has=${a.has}`);
    }
    const arcBefore = await archiveOf(state.T1);
    assert('lúc CÒN HẠN: pin chưa nằm trong kho của bao', !arcBefore.err && !arcBefore.ids.has(story.id), arcBefore.err ?? `kho=${show(arcBefore.ids)}`);

    await sleep(2600); // để hạn trôi qua THẬT — XH-QĐ-7 đánh giá lúc đọc

    {
      const a = await inFeed(state.T2, story.id);
      assert('HẾT HẠN: alice không còn thấy trong exploreFeed', !a.err && !a.has, a.err ?? `vẫn thấy=${a.has}`);
      const b = await inFeed(state.T1, story.id);
      assert('HẾT HẠN: CHÍNH CHỦ cũng không thấy ở bề mặt danh sách (kho là query riêng)', !b.err && !b.has, b.err ?? `bao vẫn thấy=${b.has}`);
    }
    await gql('HẾT HẠN: alice mở URL thẳng ⇒ 404', Q_PIN, { id: story.id }, { token: state.T2, expect: /Pin not found/ });
    await gql('HẾT HẠN: chính chủ VẪN mở được URL thẳng (màn chi tiết trong kho)', Q_PIN, { id: story.id }, { token: state.T1 });

    const arcAfter = await archiveOf(state.T1);
    assert('kho của bao chứa đúng pin vừa hết hạn', !arcAfter.err && arcAfter.ids.has(story.id), arcAfter.err ?? `kho=${show(arcAfter.ids)}`);
    {
      const arcAlice = await archiveOf(state.T2);
      assert(
        'kho là của RIÊNG người gọi: alice không thấy pin của bao trong kho mình',
        !arcAlice.err && !arcAlice.ids.has(story.id),
        arcAlice.err ?? `kho alice=${show(arcAlice.ids)}`,
      );
    }
    await gql('archivedPins yêu cầu đăng nhập (khách ⇒ Unauthorized)', Q_ARCHIVE, {}, { expect: /Unauthorized/ });

    // Đăng lại — và bằng chứng phải là alice THẤY LẠI, không chỉ là expiresAt null.
    await gql('john đăng lại pin của bao ⇒ 404 (không 403)', M_REPUB, { id: story.id }, { token: state.T3, expect: /Pin not found/ });
    const rep = await gql('bao đăng lại pin từ kho', M_REPUB, { id: story.id }, { token: state.T1 });
    assert('đăng lại gỡ hạn sống (expiresAt = null)', rep?.republishPin?.expiresAt === null, `expiresAt=${rep?.republishPin?.expiresAt}`);
    {
      const a = await inFeed(state.T2, story.id);
      const arc = await archiveOf(state.T1);
      assert(
        'sau khi đăng lại: alice THẤY LẠI trong feed, và pin rời khỏi kho',
        !a.err && a.has && !arc.ids.has(story.id),
        `alice thấy=${a.has} · còn trong kho=${arc.ids.has(story.id)}`,
      );
    }
    await gql('đăng lại pin vốn không có hạn ⇒ 400 (không im lặng thành công)', M_REPUB, { id: pub.id }, { token: state.T1, expect: /no expiry to remove/ });

    // Kho vẫn phân trang keyset được — tạo thêm một pin hết hạn để có 2 dòng.
    const story2 = await create('createPin thứ hai có hạn 2.5s (để kho có 2 dòng)', {
      title: T('story2'),
      expiresAt: new Date(Date.now() + 2500).toISOString(),
    });
    await sleep(2600);
    {
      // Bất biến kích thước trang (bẫy 1 của PLAN_XAHOI §3 — lọc SAU khi fetch
      // sẽ rớt đúng phép này): đi từng trang `first:1` phải gom được ĐÚNG tập
      // của `first:50`.
      const whole = new Set(((await silent(Q_ARCHIVE, {}, state.T1))?.data?.archivedPins?.items ?? []).map((i) => i.id));
      const Q_PAGE = `query($a:String){ archivedPins(first:1, after:$a){ items{ id } pageInfo{ hasNextPage endCursor } } }`;
      const walked = new Set();
      let after;
      for (let i = 0; i < 20; i++) {
        const pg = (await silent(Q_PAGE, { a: after }, state.T1))?.data?.archivedPins;
        if (!pg) break;
        pg.items.forEach((it) => walked.add(it.id));
        if (!pg.pageInfo.hasNextPage) break;
        after = pg.pageInfo.endCursor;
      }
      assert(
        'keyset bất biến: archivedPins first:1 đi hết trang == first:50',
        whole.size >= 2 && setEq(walked, whole),
        `từng-trang ${show(walked)} ≠ một-lần ${show(whole)}`,
      );
      assert('pin mới hết hạn nằm trong kho (story2)', story2 ? whole.has(story2.id) : false, `kho=${show(whole)}`);
    }

    // ═══ 10. Trần 20 pin/ngày ĐÃ CHẾT — XH-QĐ-8 ═════════════════════════════
    h.setGroup('GQL/pin-audience');
    //
    // Bằng chứng là 21 pin LIÊN TIẾP trong cùng một ngày của CÙNG một người.
    // Trước 24/08/2026 phép này dừng ở pin thứ 21 với ForbiddenException
    // "Daily pin limit exceeded (20/day)" — mà thực tế còn sớm hơn, vì bao đã
    // đăng vài pin ở ngay đầu bước này.
    {
      const ids = [];
      let firstErr = null;
      // ⚠️ HAI TRẦN KHÁC NHAU, ĐỪNG GỘP: phép này đo trần theo NGÀY (đã chết —
      // XH-QĐ-8). Trần theo PHÚT (10 pin — XH-4b, XH-QĐ-12) thì CÒN SỐNG, và
      // 21 pin liên tiếp chạm nó ở pin thứ 11 sau vài giây. `silent` đã bọc để
      // gỡ trần phút trước mỗi lời gọi (xem khối đầu hàm), nên vòng lặp này đo
      // đúng thứ nó nói là đo.
      const PER_MIN = pinCreatePerMin();
      for (let i = 1; i <= 21 && !firstErr; i++) {
        const r = await silent(M_CREATE, { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T(`bulk ${i}`) } }, state.T1);
        const e = errOf(r);
        if (e) firstErr = `pin thứ ${i}: ${e}`;
        else ids.push(r?.data?.createPin?.id);
      }
      assert(
        'đăng 21 pin trong CÙNG MỘT NGÀY đều được (trần 20/ngày đã bỏ — XH-QĐ-8)',
        !firstErr && ids.length === 21,
        firstErr ?? `tạo được ${ids.length}/21 · trần PHÚT (${PER_MIN}/phút — XH-4b) được gỡ trước mỗi lời gọi, xem khối đầu hàm`,
      );
      const gone = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh74 bulk' } } });
      assert('dọn 21 pin vừa tạo (giữ exploreFeed đúng kích thước cho bước sau)', gone.count === ids.length, `xoá ${gone.count}/${ids.length}`);
    }

    // ═══ 11. Trần 20 vòng/người — ĐẾM CẢ VÒNG AD-HOC (XH-QĐ-13) ═════════════
    //
    // ⚠️ SETUP ĐI THẲNG DB, CÓ CỜ: 19 vòng độn dưới đây được tạo bằng Prisma,
    // cùng lý do (và cùng tiền lệ đã báo chủ dự án) với bước 72 — đường tạo
    // vòng có tên là API của luồng B, chưa merge. BẰNG CHỨNG vẫn là request
    // thật: chốt trần chỉ được đánh giá qua `createPin`.
    {
      const owned = await prisma.circle.count({ where: { ownerId: USERS.bao.id } });
      const need = 20 - owned;
      if (need > 0) {
        await prisma.circle.createMany({
          data: Array.from({ length: need }, (_, i) => ({
            ownerId: USERS.bao.id,
            name: `xh74 độn ${i}`,
            isAdHoc: true,
            // Băm giả, chỉ để lấp đủ số dòng — không vòng ad-hoc thật nào băm
            // ra chuỗi này, nên nó không thể vô tình bị tái dùng.
            memberHash: `xh74filler${i}`,
          })),
        });
      }
      const atCap = await prisma.circle.count({ where: { ownerId: USERS.bao.id } });
      assert('dựng nền: bao đang sở hữu đúng 20 vòng (tính cả ad-hoc)', atCap === 20, `đếm được ${atCap}`);

      // Tập người MỚI ⇒ buộc phải tạo vòng thứ 21 ⇒ phải bị chặn.
      await gql(
        'chạm trần: khán giả ad-hoc mới ⇒ vòng thứ 21 bị chặn',
        M_CREATE,
        { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T('cap'), visibility: 'CIRCLE', audienceUserIds: [USERS.john.id, USERS.bob.id] } },
        { token: state.T1, expect: /Circle limit reached/ },
      );
      // …nhưng TÁI DÙNG vòng cũ thì vẫn đăng được: không có vòng mới nào sinh
      // ra nên trần không bị chạm. Đây là nửa còn lại của cùng một luật, và
      // thiếu nó thì một bản sửa "chặn thẳng khi đủ 20 vòng" vẫn xanh.
      await gql(
        'ở đúng trần vẫn đăng được cho khán giả CŨ (tái dùng vòng, không đẻ vòng mới)',
        M_CREATE,
        { i: { imageUrl: IMG, imageWidth: 10, imageHeight: 10, title: T('cap reuse'), visibility: 'CIRCLE', audienceUserIds: [USERS.alice.id] } },
        { token: state.T1 },
      );
      const after = await prisma.circle.count({ where: { ownerId: USERS.bao.id } });
      assert('không có vòng thứ 21 nào lọt vào DB', after === 20, `đếm được ${after}`);
    }

    // ═══ 12. Dọn cuối — trả DB về đúng hình dạng trước bước ═════════════════
    //
    // Dọn Ở ĐẦU bước là luật; dọn thêm ở cuối là để bước 80/90 và lần chạy sau
    // không phải nhìn thấy 20 vòng độn và một tá pin fixture. Ghi lại kết quả
    // vì dọn hỏng âm thầm chỉ lộ ra sau vài lần chạy.
    {
      const p = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh74' } } });
      const c = await prisma.circle.deleteMany({ where: { memberHash: { not: null } } });
      const leftPins = await prisma.pin.count({ where: { title: { startsWith: 'xh74' } } });
      const leftCircles = await prisma.circle.count({ where: { memberHash: { not: null } } });
      assert(
        'dọn cuối bước: mọi pin + vòng của bước 74 đã biến mất',
        leftPins === 0 && leftCircles === 0,
        `xoá pin=${p.count} circle=${c.count} · còn sót pin=${leftPins} circle=${leftCircles}`,
      );
    }

    return true;
  } finally {
    rate.close();
    await prisma.$disconnect().catch(() => {});
  }
}
