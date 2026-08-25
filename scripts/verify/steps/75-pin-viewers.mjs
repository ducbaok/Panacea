// Bước 75 — XH-5: "ai đã xem" · ẩn viewCount · gợi ý @mention theo khán giả
// (PLAN_XAHOI.md §4 bốn luật con · XH-QĐ-15 chốt 24/08/2026)
//
// KHÁC BƯỚC 74 Ở CHỖ NÀO: 74 chứng minh đường GHI của khán giả (pin nào gửi
// cho ai). Bước này chứng minh thứ SINH RA TỪ việc đọc pin đó — một bảng
// `PinView` chỉ mọc lên ở đúng bốn điều kiện, một con số bị giấu đi, và một
// danh sách gợi ý bị thu hẹp lại.
//
// PHÉP QUYẾT ĐỊNH của cả bước là **XH-QĐ-15**: bớt alice khỏi vòng ⇒ alice biến
// mất khỏi `pinViewers` NGAY, **trong khi dòng `PinView` của alice vẫn còn
// nguyên trong DB**. Cặp khẳng định đó là thứ duy nhất phân biệt "lọc lúc đọc"
// với "xoá dữ liệu" — một bản cài đặt xoá dòng khi bớt thành viên sẽ xanh mọi
// phép khác ở đây và chỉ chết ở phép này. Quyết định 15 cố ý ĐẢO đề xuất "giữ —
// lịch sử là lịch sử", để nhất quán hồi tố với XH-QĐ-3 (rời vòng phải im lặng).
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 4 lần — xem `verify-step-must-clean…`).
// Trạng thái sống lâu bước này đẻ ra hoặc phụ thuộc:
//   · `PinView` — bảng MỚI của XH-5, không có dòng nào trong seed. Dòng sót lại
//     của lần chạy trước trỏ vào pin đã xoá thì vô hại, nhưng phép "pin PUBLIC
//     KHÔNG đẻ dòng nào" đếm trên toàn bảng nên phải xuất phát từ 0.
//   · `Circle`/`CircleMember` — xoá SẠCH, cùng lý do (và cùng tiền lệ) đã ghi ở
//     bước 74 mục dọn: trần 20 vòng/người chỉ đúng khi điểm xuất phát là 0, và
//     bước sau không được tin bước trước dọn hộ.
//   · `track:view:*` — cửa sổ debounce 30′ dài hơn khoảng cách hai lần chạy
//     verify. Pin của bước này mang id cuid MỚI mỗi lần chạy nên về lý thuyết
//     không đụng khoá cũ, nhưng bước 18 đã trả giá đúng bài học này một lần —
//     dọn khoá của CHÍNH mình ngay sau khi biết id, trước khi đo.
//
// Vai (bao = T1 · alice = T2 · john = T3):
//   xh75 public    (bao, PUBLIC)                       — ai cũng xem, KHÔNG ghi PinView
//   xh75 circle    (bao, CIRCLE vòng đặt tên [alice, john])
//   xh75 followers (bao, FOLLOWERS)                    — alice + john đều theo dõi bao
//   xh75 onlyme    (bao, ONLY_ME)                      — khán giả đúng một người
//
// Vòng ĐẶT TÊN chứ không ad-hoc: `removeCircleMember` từ chối vòng ad-hoc
// (`circles.service._assertNotAdHoc`), mà bớt thành viên chính là phép quyết
// định ở trên. Ad-hoc đã được bước 74 phủ ở đường ghi.

import { createRequire } from 'node:module';
import { USERS } from '../lib/seedrefs.mjs';
import { connectRedis } from '../lib/redis-probe.mjs';
import { readApiEnv, API, sleep } from '../lib/client.mjs';

const require = createRequire(import.meta.url);

const IMG = 'http://localhost:4000/uploads/xh75.png';
const T = (s) => `xh75 ${s}`;

const M_CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ id title visibility audienceCircleId } }`;
const M_CIRCLE = `mutation($i:CreateCircleInput!){ createCircle(input:$i){ id name memberCount members{ id } } }`;
const M_REMOVE = `mutation($c:ID!,$u:ID!){ removeCircleMember(circleId:$c, userId:$u){ id memberCount members{ id } } }`;
const Q_VIEWERS = `query($p:ID!){ pinViewers(pinId:$p){ id username } }`;
const Q_MENTION = `query($p:ID!,$q:String){ mentionSuggestions(pinId:$p, q:$q){ id username } }`;
/** Hai pin trong MỘT response — điều kiện để loại trừ "trả null cho tất cả". */
const Q_TWO = `query($a:ID!,$b:ID!){
  pub:  pin(id:$a){ id viewCount clickCount }
  lim:  pin(id:$b){ id viewCount clickCount }
}`;

const setOf = (arr) => new Set((arr ?? []).map((u) => u.username));
const show = (s) => `{${[...s].sort().join(', ')}}`;
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const errOf = (r) => r?.errors?.[0]?.extensions?.originalError?.message ?? r?.errors?.[0]?.message ?? null;

export default async function (h) {
  const { gql, silent, rec, assert, state } = h;
  h.setGroup('GQL/pin-viewers');

  // ─── Prisma CHỈ để dọn + đối chứng tầng dữ liệu (không phải bằng chứng) ────
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
  /** Khoá debounce của bước này — gom lại để dọn cả ở đầu lẫn cuối. */
  const trackKeys = [];

  /**
   * Gọi `trackPinView` bằng fetch trần vì cần header `x-anon-id` — harness
   * `gql()` không truyền header phụ được (bước 18 làm y hệt vì cùng lý do).
   */
  const trackView = async (pinId, { token, anon } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (anon !== undefined) headers['x-anon-id'] = anon;
    const r = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: `mutation($p:ID!){ trackPinView(pinId:$p) }`, variables: { p: pinId } }),
    });
    const j = await r.json();
    return { counted: j?.data?.trackPinView, err: errOf(j) };
  };

  const create = async (name, input, token = state.T1) =>
    (await gql(name, M_CREATE, { i: { imageUrl: IMG, imageWidth: 100, imageHeight: 150, ...input } }, { token }))
      ?.createPin ?? null;

  /** `pinViewers` dưới mắt một token — trả tập username + lỗi nếu có. */
  const viewersOf = async (pinId, token) => {
    const r = await silent(Q_VIEWERS, { p: pinId }, token);
    return { err: errOf(r), names: setOf(r?.data?.pinViewers), order: (r?.data?.pinViewers ?? []).map((u) => u.username) };
  };

  const mentionOf = async (pinId, q, token) => {
    const r = await silent(Q_MENTION, { p: pinId, q: q ?? null }, token);
    return { err: errOf(r), names: setOf(r?.data?.mentionSuggestions) };
  };

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═══════════════════════════════════════════════════════
    const wipedViews = await prisma.pinView.deleteMany({});
    const wipedPins = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh75' } } });
    await prisma.circleMember.deleteMany({});
    const wipedCircles = await prisma.circle.deleteMany({});
    rec(
      'dọn state sống lâu Ở ĐẦU BƯỚC (PinView sạch + pin xh75* + xoá SẠCH Circle/CircleMember)',
      'OK',
      `pinView=${wipedViews.count} pin=${wipedPins.count} circle=${wipedCircles.count}`,
    );

    // ─── Tiền đề topology (seed đổi thì mọi phép dưới mất ý nghĩa) ────────────
    const baoFollowers = new Set(
      (await prisma.follows.findMany({ where: { followingId: USERS.bao.id }, select: { followerId: true } })).map(
        (f) => f.followerId,
      ),
    );
    const topoOk = baoFollowers.has(USERS.alice.id) && baoFollowers.has(USERS.john.id);
    assert(
      'tiền đề: CẢ alice VÀ john đều theo dõi bao',
      topoOk,
      `followers(bao)=${[...baoFollowers].join(',')} — cần cả hai cho pin FOLLOWERS`,
    );
    if (!topoOk) return false;

    // ═══ 0. Dựng fixture bằng request THẬT ════════════════════════════════════
    const circle = (
      await gql(
        'bao lập vòng ĐẶT TÊN [alice, john] (ad-hoc không bớt thành viên được)',
        M_CIRCLE,
        { i: { name: T('vòng'), userIds: [USERS.alice.id, USERS.john.id] } },
        { token: state.T1 },
      )
    )?.createCircle;
    if (!circle?.id) {
      rec('setup: vòng của bước 75', 'FAIL', 'không lập được vòng — xem phép ngay trên');
      return false;
    }

    const pub = await create('createPin PUBLIC', { title: T('public') });
    const cir = await create('createPin CIRCLE ghim vòng vừa lập', {
      title: T('circle'),
      visibility: 'CIRCLE',
      audienceCircleId: circle.id,
    });
    const fol = await create('createPin FOLLOWERS', { title: T('followers'), visibility: 'FOLLOWERS' });
    const me = await create('createPin ONLY_ME', { title: T('onlyme'), visibility: 'ONLY_ME' });
    if (!pub || !cir || !fol || !me) {
      rec('setup: 4 pin fixture', 'FAIL', 'thiếu ít nhất một pin — xem 4 phép ngay trên');
      return false;
    }

    // Dọn khoá debounce NGAY khi biết id, TRƯỚC khi đo lượt đầu tiên.
    const ANON = `xh75anon_${Date.now().toString(36)}`;
    for (const p of [pub.id, cir.id, fol.id, me.id]) {
      for (const who of [USERS.bao.id, USERS.alice.id, USERS.john.id]) trackKeys.push(`track:view:${p}:u:${who}`);
      trackKeys.push(`track:view:${p}:a:${ANON}`);
    }
    if (redis) await redis.cmd('DEL', ...trackKeys);

    // ═══ 1. PHÉP NỀN — alice xem pin CIRCLE ⇒ bao thấy alice ═════════════════
    const a1 = await trackView(cir.id, { token: state.T2 });
    assert('alice xem pin CIRCLE ⇒ lượt xem được đếm', a1.counted === true, `trả=${a1.counted}${a1.err ? ` · LỖI: ${a1.err}` : ''}`);
    await sleep(60); // để `firstViewedAt` của hai người không thể trùng mốc
    const j1 = await trackView(cir.id, { token: state.T3 });
    assert('john (cũng trong vòng) xem pin CIRCLE ⇒ được đếm', j1.counted === true, `trả=${j1.counted}${j1.err ? ` · LỖI: ${j1.err}` : ''}`);

    {
      const v = await viewersOf(cir.id, state.T1);
      assert(
        'pinViewers dưới mắt CHỦ PIN: đúng hai người vừa xem',
        !v.err && setEq(v.names, new Set([USERS.alice.username, USERS.john.username])),
        v.err ? `query LỖI: ${v.err}` : `thấy ${show(v.names)}`,
      );
      assert(
        'xếp theo lượt xem MỚI NHẤT trước (john xem sau alice ⇒ john đứng đầu)',
        v.order[0] === USERS.john.username,
        `thứ tự=${v.order.join(' → ')}`,
      );
    }

    // ═══ 2. CHỈ CHỦ PIN — người ĐỌC ĐƯỢC pin cũng không đọc được danh sách ════
    //
    // john nằm TRONG vòng nên `pin(id)` của john trả 200; đúng chỗ đó mới phân
    // biệt được "chặn theo quyền xem" với "chặn theo quyền sở hữu". Một bản cài
    // đặt chỉ kiểm tra `isPinVisibleInCtx` sẽ xanh mọi phép khác và chết ở đây.
    {
      const johnSeesPin = await silent(`query($id:ID!){ pin(id:$id){ id } }`, { id: cir.id }, state.T3);
      assert(
        'tiền đề: john ĐỌC ĐƯỢC pin CIRCLE (nên 404 dưới đây là do SỞ HỮU, không do quyền xem)',
        johnSeesPin?.data?.pin?.id === cir.id,
        `pin(john)=${johnSeesPin?.data?.pin?.id ?? errOf(johnSeesPin)}`,
      );
    }
    await gql('john gọi pinViewers trên pin của bao ⇒ 404 (không 403)', Q_VIEWERS, { p: cir.id }, { token: state.T3, expect: /Pin not found/ });
    await gql('alice (cũng trong vòng) gọi pinViewers ⇒ cùng 404', Q_VIEWERS, { p: cir.id }, { token: state.T2, expect: /Pin not found/ });
    await gql('pinViewers với pinId không tồn tại ⇒ CÙNG thông điệp (không suy ra được pin có thật)', Q_VIEWERS, { p: 'xh75_khong_ton_tai' }, { token: state.T1, expect: /Pin not found/ });
    await gql('pinViewers yêu cầu đăng nhập (khách ⇒ Unauthorized)', Q_VIEWERS, { p: cir.id }, { expect: /Unauthorized/ });

    // ═══ 3. Luật 4 — chủ pin tự xem KHÔNG vào danh sách ══════════════════════
    {
      const before = await prisma.pinView.count({ where: { pinId: cir.id } });
      const self = await trackView(cir.id, { token: state.T1 });
      const after = await prisma.pinView.count({ where: { pinId: cir.id } });
      const v = await viewersOf(cir.id, state.T1);
      assert(
        'bao tự xem pin của mình: lượt xem vẫn đếm nhưng KHÔNG đẻ dòng PinView nào',
        self.counted === true && after === before && !v.names.has(USERS.bao.username),
        `trả=${self.counted} · PinView ${before}→${after} · danh sách=${show(v.names)}`,
      );
    }

    // ═══ 4. Luật 1 + 2 — pin PUBLIC KHÔNG đẻ dòng nào, khách vẫn được đếm ════
    const countOf = async (token, ids = { a: pub.id, b: cir.id }) => {
      const r = await silent(Q_TWO, ids, token);
      return { err: errOf(r), pub: r?.data?.pub ?? null, lim: r?.data?.lim ?? null };
    };
    {
      const base = await countOf(state.T1);
      const anon = await trackView(pub.id, { anon: ANON });
      const byAlice = await trackView(pub.id, { token: state.T2 });
      const after = await countOf(state.T1);
      const rows = await prisma.pinView.count({ where: { pinId: pub.id } });
      assert(
        'pin PUBLIC: khách vãng lai (anonId) + alice đều làm viewCount tăng — TỔNG +2',
        anon.counted === true && byAlice.counted === true && after.pub?.viewCount === base.pub?.viewCount + 2,
        `anon=${anon.counted} alice=${byAlice.counted} · viewCount ${base.pub?.viewCount}→${after.pub?.viewCount}`,
      );
      assert(
        'pin PUBLIC KHÔNG đẻ dòng PinView nào (luật 1 — ghi cho pin công khai vừa đắt vừa phản cảm)',
        rows === 0,
        `PinView(pin PUBLIC) = ${rows}`,
      );
      const allRows = await prisma.pinView.count();
      const limRows = await prisma.pinView.count({ where: { pinId: cir.id } });
      assert(
        'đối chứng: mọi dòng PinView trong DB đều thuộc pin GIỚI HẠN, không dòng nào của khách vãng lai',
        allRows === limRows && limRows === 2,
        `tổng=${allRows} · của pin CIRCLE=${limRows} (kỳ vọng 2 = alice + john)`,
      );
    }

    // ═══ 5. Luật 3 — ẩn viewCount trên pin giới hạn ══════════════════════════
    //
    // HAI NHÁNH TRONG CÙNG MỘT RESPONSE: một bản cài đặt trả `null` cho MỌI pin
    // (hoặc quên hẳn field) vẫn qua được phép "alice không đọc được số".
    {
      const asAlice = await countOf(state.T2);
      const asBao = await countOf(state.T1);
      const asGuest = await countOf(undefined, { a: pub.id, b: pub.id });
      assert(
        'alice: viewCount của pin PUBLIC là SỐ, của pin CIRCLE là null — cùng một response',
        !asAlice.err && typeof asAlice.pub?.viewCount === 'number' && asAlice.lim?.viewCount === null,
        `pub=${asAlice.pub?.viewCount} lim=${asAlice.lim?.viewCount}${asAlice.err ? ` · LỖI: ${asAlice.err}` : ''}`,
      );
      assert(
        'chủ pin đọc được CẢ HAI (số bị giấu với người khác, không phải bị xoá)',
        typeof asBao.pub?.viewCount === 'number' && typeof asBao.lim?.viewCount === 'number',
        `pub=${asBao.pub?.viewCount} lim=${asBao.lim?.viewCount}`,
      );
      assert(
        'khách vãng lai vẫn đọc được viewCount của pin PUBLIC (luật 3 không đụng pin công khai)',
        typeof asGuest.pub?.viewCount === 'number',
        `pub=${asGuest.pub?.viewCount}`,
      );
      assert(
        'clickCount KHÔNG bị giấu (luật 3 nói đích danh viewCount — đừng ẩn dư)',
        typeof asAlice.lim?.clickCount === 'number',
        `clickCount(alice, pin CIRCLE)=${asAlice.lim?.clickCount}`,
      );
    }

    // ═══ 6. Pin FOLLOWERS — cùng đường ghi, khán giả khác ════════════════════
    {
      const jf = await trackView(fol.id, { token: state.T3 });
      const v = await viewersOf(fol.id, state.T1);
      assert(
        'pin FOLLOWERS cũng ghi PinView: john xem ⇒ bao thấy john',
        jf.counted === true && setEq(v.names, new Set([USERS.john.username])),
        `trả=${jf.counted} · danh sách=${show(v.names)}${v.err ? ` · LỖI: ${v.err}` : ''}`,
      );
      const vEmpty = await viewersOf(me.id, state.T1);
      assert(
        'pin ONLY_ME chưa ai xem ⇒ danh sách RỖNG, không phải lỗi',
        !vEmpty.err && vEmpty.names.size === 0,
        vEmpty.err ?? `danh sách=${show(vEmpty.names)}`,
      );
    }

    // ═══ 7. 🔴 PHÉP QUYẾT ĐỊNH — XH-QĐ-15 ═══════════════════════════════════
    {
      const rowsBefore = await prisma.pinView.count({ where: { pinId: cir.id } });
      const rm = await gql(
        'bao bớt alice khỏi vòng (XH-QĐ-3: alice không nhận tín hiệu nào)',
        M_REMOVE,
        { c: circle.id, u: USERS.alice.id },
        { token: state.T1 },
      );
      const v = await viewersOf(cir.id, state.T1);
      const rowsAfter = await prisma.pinView.count({ where: { pinId: cir.id } });
      assert(
        'bớt khỏi vòng ⇒ alice BIẾN MẤT khỏi pinViewers ngay, chỉ còn john',
        rm?.removeCircleMember?.memberCount === 1 && !v.err && setEq(v.names, new Set([USERS.john.username])),
        `memberCount=${rm?.removeCircleMember?.memberCount} · danh sách=${show(v.names)}${v.err ? ` · LỖI: ${v.err}` : ''}`,
      );
      assert(
        'và dòng PinView của alice VẪN CÒN trong DB — lọc lúc ĐỌC, không phải xoá dữ liệu',
        rowsBefore === 2 && rowsAfter === 2,
        `PinView(pin CIRCLE) ${rowsBefore}→${rowsAfter} (xoá dữ liệu sẽ cho 1)`,
      );
      const stillSees = await silent(`query($id:ID!){ pin(id:$id){ id } }`, { id: cir.id }, state.T2);
      assert(
        'đối chứng chiều ĐỌC PIN: alice cũng mất luôn quyền xem chính pin đó (404)',
        stillSees?.data?.pin == null,
        `pin(alice)=${stillSees?.data?.pin?.id ?? errOf(stillSees)}`,
      );
    }

    // ═══ 8. Luật 5 — gợi ý @mention lọc theo khán giả ════════════════════════
    h.setGroup('GQL/mention-suggest');
    {
      // Cặp quyết định: CÙNG một `q`, hai pin, hai câu trả lời. bob không theo
      // dõi ai và không ở trong vòng nào ⇒ ngoài khán giả của pin CIRCLE.
      const onPub = await mentionOf(pub.id, 'bob', state.T1);
      const onCir = await mentionOf(cir.id, 'bob', state.T1);
      assert(
        'q="bob": gợi ý được trên pin PUBLIC nhưng KHÔNG trên pin CIRCLE (cùng q, hai pin, hai câu trả lời)',
        !onPub.err && onPub.names.has(USERS.bob.username) && !onCir.err && !onCir.names.has(USERS.bob.username),
        `PUBLIC=${show(onPub.names)} · CIRCLE=${show(onCir.names)}`,
      );
      const johnOnCir = await mentionOf(cir.id, 'john', state.T1);
      assert(
        'người CÒN trong vòng vẫn được gợi ý (bộ lọc không quét sạch mọi người)',
        !johnOnCir.err && johnOnCir.names.has(USERS.john.username),
        `CIRCLE q="john"=${show(johnOnCir.names)}`,
      );
      const aliceOnCir = await mentionOf(cir.id, 'alice', state.T1);
      assert(
        'người vừa bị bớt khỏi vòng BIẾN MẤT khỏi gợi ý (cùng nguồn khán giả với pinViewers)',
        !aliceOnCir.err && !aliceOnCir.names.has(USERS.alice.username),
        `CIRCLE q="alice"=${show(aliceOnCir.names)}`,
      );
      const selfOnPub = await mentionOf(pub.id, 'bao', state.T1);
      assert(
        'không ai @ chính mình: bao không nằm trong gợi ý của bao',
        !selfOnPub.err && !selfOnPub.names.has(USERS.bao.username),
        `PUBLIC q="bao"=${show(selfOnPub.names)}`,
      );
      // john vẫn trong vòng ⇒ gọi được, và CHỦ PIN phải nằm trong gợi ý của
      // john (bao là người duy nhất chắc chắn đọc được mọi bình luận trên pin).
      const byJohn = await mentionOf(cir.id, null, state.T3);
      assert(
        'dưới mắt thành viên vòng: gợi ý gồm CHỦ PIN, và không có chính john',
        !byJohn.err && byJohn.names.has(USERS.bao.username) && !byJohn.names.has(USERS.john.username),
        `john thấy=${show(byJohn.names)}${byJohn.err ? ` · LỖI: ${byJohn.err}` : ''}`,
      );
      const onMe = await mentionOf(me.id, null, state.T1);
      assert(
        'pin ONLY_ME: khán giả đúng một người ⇒ gợi ý RỖNG (không phải lỗi)',
        !onMe.err && onMe.names.size === 0,
        onMe.err ?? `gợi ý=${show(onMe.names)}`,
      );
      await gql(
        'alice (đã ngoài khán giả) gọi mentionSuggestions ⇒ 404 như mọi bề mặt pin',
        Q_MENTION,
        { p: cir.id, q: null },
        { token: state.T2, expect: /Pin not found/ },
      );
      await gql('mentionSuggestions yêu cầu đăng nhập (khách ⇒ Unauthorized)', Q_MENTION, { p: pub.id, q: null }, { expect: /Unauthorized/ });
    }

    // ═══ 9. Dọn cuối ════════════════════════════════════════════════════════
    h.setGroup('GQL/pin-viewers');
    {
      const p = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh75' } } });
      await prisma.circleMember.deleteMany({});
      const c = await prisma.circle.deleteMany({});
      // `PinView` đi theo pin bằng ON DELETE CASCADE — đếm lại để chắc chắn ràng
      // buộc đó có thật, chứ không chỉ có trong file migration.
      const leftViews = await prisma.pinView.count();
      const leftPins = await prisma.pin.count({ where: { title: { startsWith: 'xh75' } } });
      assert(
        'dọn cuối bước: pin + vòng biến mất, và PinView đi theo pin qua CASCADE',
        leftPins === 0 && leftViews === 0,
        `xoá pin=${p.count} circle=${c.count} · còn sót pin=${leftPins} pinView=${leftViews}`,
      );
    }

    if (redis) {
      await redis.cmd('DEL', ...trackKeys);
      const left = await redis.cmd('EXISTS', ...trackKeys);
      assert('đã dọn khoá debounce của bước này (TTL 30′ dài hơn khoảng cách 2 lần chạy)', left === 0, `còn sót ${left}/${trackKeys.length}`);
    } else {
      rec('đã dọn khoá debounce của bước này', 'SKIP', 'không kết nối được Redis để dọn');
    }

    return true;
  } finally {
    if (redis) redis.close();
    await prisma.$disconnect().catch(() => {});
  }
}
