// Bước 72 — XH-2: bộ lọc khán giả `getVisiblePinWhere` (PLAN_XAHOI.md §3)
//
// MA TRẬN 4 CẤP × các bề mặt đọc, bằng request thật của bao(T1)/alice(T2)/
// john(T3)/khách — mỗi phép nhìn thấy HAI NHÁNH trong cùng một response
// (người trong khán giả thấy, người ngoài không), đúng chuẩn nhà.
//
// ⚠️ SETUP ĐI THẲNG VÀO DB (PrismaClient của packages/database) — lệch chuẩn
// "request thật" MỘT CÁCH CÓ CỜ, đã báo chủ dự án (xahoi-dieu-phoi.md §7 mục 3):
// ở mốc M0 chưa có API tạo vòng (XH-3) lẫn createPin(visibility) (XH-4a), nên
// vòng tròn + pin fixture phải seed thẳng — CÙNG bản chất với seed.ts. BẰNG
// CHỨNG thì vẫn 100% là request GraphQL thật. Khi luồng A/B merge, các phép
// setup này nên đổi dần sang mutation thật.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 3 lần): Circle/CircleMember/PinView là
// state sống lâu của tính năng này; pin/board/notification/message fixture
// nhận diện bằng tiền tố `xh_`/`xh-`/`xh:`.
//
// ⚠️ TIỀN ĐỀ TOPOLOGY (kiểm bằng máy ở đầu bước, drift seed sẽ báo thẳng):
//   • alice → bob (seed)      ⇒ alice là FOLLOWER của bob
//   • john KHÔNG follow bob   ⇒ john là người-ngoài cho pin FOLLOWERS của bob
//   (Không dùng "người không follow BAO" vì sau bước 20 thì cả alice/john/bob
//   đều follow bao — không còn ai làm đối chứng.)
//
// Vai trong ma trận:
//   xh_pin_public    (bao, PUBLIC)               — ai cũng thấy
//   xh_pin_followers (bob, FOLLOWERS)            — alice thấy, john không
//   xh_pin_circle    (bao, CIRCLE vòng alice)    — alice thấy, john KHÔNG dù
//                                                  john follow bao (follower ≠ thành viên vòng)
//   xh_pin_circle2   (bao, CIRCLE vòng john)     — john thấy, alice không
//   xh_pin_onlyme    (bao, ONLY_ME)              — chỉ bao
//   xh_pin_expired   (bao, PUBLIC + hết hạn)     — KHÔNG ai thấy trong danh sách,
//                                                  kể cả bao (kho là query riêng của XH-6);
//                                                  bao vẫn mở được qua URL thẳng (findById)

import { createRequire } from 'node:module';
import { USERS } from '../lib/seedrefs.mjs';
import { readApiEnv } from '../lib/client.mjs';

const require = createRequire(import.meta.url);

const P = {
  pub: 'xh_pin_public',
  fol: 'xh_pin_followers',
  cir: 'xh_pin_circle',
  cir2: 'xh_pin_circle2',
  me: 'xh_pin_onlyme',
  exp: 'xh_pin_expired',
};
const C = { alice: 'xh_circle_alice', john: 'xh_circle_john' };
/** Từ khoá riêng để search chỉ khớp fixture của bước này. */
const TERM = 'xhviz';

const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const show = (s) => `{${[...s].sort().join(', ')}}`;

export default async function (h) {
  const { gql, silent, rec, assert, state } = h;
  h.setGroup('GQL/visibility');

  // ─── Prisma client cho setup (KHÔNG dùng cho bằng chứng) ───────────────────
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
    // ─── DỌN Ở ĐẦU BƯỚC ──────────────────────────────────────────────────────
    await prisma.notification.deleteMany({ where: { pinId: { startsWith: 'xh_' } } });
    await prisma.message.deleteMany({ where: { content: { startsWith: 'xh:' } } });
    await prisma.savedPin.deleteMany({ where: { pinId: { startsWith: 'xh_' } } });
    await prisma.savedPin.deleteMany({ where: { board: { name: { startsWith: 'xh-' } } } });
    await prisma.board.deleteMany({ where: { name: { startsWith: 'xh-' } } });
    await prisma.pinView.deleteMany({});
    await prisma.pin.deleteMany({ where: { id: { startsWith: 'xh_' } } });
    await prisma.circleMember.deleteMany({});
    await prisma.circle.deleteMany({});

    // ─── Tiền đề topology ────────────────────────────────────────────────────
    const bobFollowers = new Set(
      (
        await prisma.follows.findMany({
          where: { followingId: USERS.bob.id },
          select: { followerId: true },
        })
      ).map((e) => e.followerId),
    );
    assert(
      'tiền đề: alice follow bob (seed) + john không',
      bobFollowers.has(USERS.alice.id) && !bobFollowers.has(USERS.john.id),
      `followers(bob)=${[...bobFollowers].join(',')} — seed đổi thì sửa header bước này`,
    );
    if (!bobFollowers.has(USERS.alice.id) || bobFollowers.has(USERS.john.id)) return false;

    // ─── Fixtures ────────────────────────────────────────────────────────────
    await prisma.circle.create({
      data: {
        id: C.alice,
        ownerId: USERS.bao.id,
        name: 'xh vòng thân',
        members: { create: [{ userId: USERS.alice.id }] },
      },
    });
    await prisma.circle.create({
      data: {
        id: C.john,
        ownerId: USERS.bao.id,
        name: 'xh vòng john',
        isAdHoc: true,
        members: { create: [{ userId: USERS.john.id }] },
      },
    });

    const mkPin = (id, creatorId, title, extra = {}) =>
      prisma.pin.create({
        data: {
          id,
          creatorId,
          title,
          imageUrl: 'http://localhost/xh.png',
          imageWidth: 100,
          imageHeight: 100,
          ...extra,
        },
      });
    await mkPin(P.pub, USERS.bao.id, `${TERM} public`);
    await mkPin(P.fol, USERS.bob.id, `${TERM} followers`, { visibility: 'FOLLOWERS' });
    await mkPin(P.cir, USERS.bao.id, `${TERM} circle`, {
      visibility: 'CIRCLE',
      audienceCircleId: C.alice,
    });
    await mkPin(P.cir2, USERS.bao.id, `${TERM} circle john`, {
      visibility: 'CIRCLE',
      audienceCircleId: C.john,
    });
    await mkPin(P.me, USERS.bao.id, `${TERM} onlyme`, { visibility: 'ONLY_ME' });
    await mkPin(P.exp, USERS.bao.id, `${TERM} expired`, {
      expiresAt: new Date(Date.now() - 3600_000),
    });

    // Tag chung cho phép relatedPins: pub ↔ cir chia một tag riêng của bước.
    await prisma.tag.upsert({ where: { name: 'xh-shared' }, update: {}, create: { name: 'xh-shared' } });
    await prisma.pin.update({ where: { id: P.pub }, data: { tags: { connect: { name: 'xh-shared' } } } });
    await prisma.pin.update({ where: { id: P.cir }, data: { tags: { connect: { name: 'xh-shared' } } } });

    // ═══ 1. exploreFeed — 4 người xem, mỗi response chứa cả nhánh thấy lẫn nhánh ẩn ═══
    const xhIds = (items) => new Set((items ?? []).map((i) => i.id).filter((id) => id.startsWith('xh_')));
    const feed = async (token) => {
      const r = await silent(`query{ exploreFeed(first:50){ items{ id } } }`, {}, token);
      return { err: r?.errors?.[0]?.message ?? null, ids: xhIds(r?.data?.exploreFeed?.items) };
    };

    const expectFeed = {
      guest: new Set([P.pub]),
      bao: new Set([P.pub, P.cir, P.cir2, P.me]),
      alice: new Set([P.pub, P.fol, P.cir]),
      john: new Set([P.pub, P.cir2]),
    };
    for (const [who, token] of [
      ['guest', undefined],
      ['bao', state.T1],
      ['alice', state.T2],
      ['john', state.T3],
    ]) {
      const { err, ids } = await feed(token);
      assert(
        `exploreFeed (${who}) đúng tập 6 pin fixture`,
        !err && setEq(ids, expectFeed[who]),
        err ? `query LỖI: ${err}` : `thấy ${show(ids)} ≠ kỳ vọng ${show(expectFeed[who])}`,
      );
    }

    // ═══ 2. homeFeed FOLLOWING — follower vẫn KHÔNG thấy CIRCLE/ONLY_ME/hết hạn ═══
    const home = async (token) => {
      const r = await silent(
        `query{ homeFeed(first:50, source: FOLLOWING){ source items{ id } } }`,
        {},
        token,
      );
      return { err: r?.errors?.[0]?.message ?? null, ids: xhIds(r?.data?.homeFeed?.items) };
    };
    {
      const a = await home(state.T2);
      assert(
        'homeFeed FOLLOWING (alice): pub+followers+circle, KHÔNG onlyme/expired',
        !a.err && setEq(a.ids, new Set([P.pub, P.fol, P.cir])),
        a.err ?? `thấy ${show(a.ids)}`,
      );
      const j = await home(state.T3);
      assert(
        'homeFeed FOLLOWING (john): follow bao nhưng KHÔNG thấy pin vòng người khác',
        !j.err && setEq(j.ids, new Set([P.pub, P.cir2])),
        j.err ?? `thấy ${show(j.ids)}`,
      );
    }

    // ═══ 3. userPins(bao) — hồ sơ tác giả dưới 4 con mắt ═══
    const userPins = async (token, first = 50) => {
      const r = await silent(
        `query($u:ID!,$f:Int!){ userPins(userId:$u, first:$f){ items{ id } pageInfo{ hasNextPage endCursor } } }`,
        { u: USERS.bao.id, f: first },
        token,
      );
      return {
        err: r?.errors?.[0]?.message ?? null,
        ids: xhIds(r?.data?.userPins?.items),
        page: r?.data?.userPins,
      };
    };
    const expectProfile = {
      guest: new Set([P.pub]),
      bao: new Set([P.pub, P.cir, P.cir2, P.me]), // exp vắng: kho, không phải hồ sơ
      alice: new Set([P.pub, P.cir]),
      john: new Set([P.pub, P.cir2]),
    };
    for (const [who, token] of [
      ['guest', undefined],
      ['bao', state.T1],
      ['alice', state.T2],
      ['john', state.T3],
    ]) {
      const { err, ids } = await userPins(token);
      assert(
        `userPins(bao) dưới mắt ${who}`,
        !err && setEq(ids, expectProfile[who]),
        err ? `query LỖI: ${err}` : `thấy ${show(ids)} ≠ ${show(expectProfile[who])}`,
      );
    }

    // Bất biến kích thước trang (bẫy 1 — lọc SAU fetch sẽ rớt phép này): đi
    // từng trang first:2 phải gom được ĐÚNG tập của first:50.
    {
      const whole = await userPins(state.T2, 50);
      const walked = new Set();
      let after = undefined;
      for (let i = 0; i < 15; i++) {
        const r = await silent(
          `query($u:ID!,$a:String){ userPins(userId:$u, first:2, after:$a){ items{ id } pageInfo{ hasNextPage endCursor } } }`,
          { u: USERS.bao.id, a: after },
          state.T2,
        );
        const pg = r?.data?.userPins;
        if (!pg) break;
        for (const it of pg.items) if (it.id.startsWith('xh_')) walked.add(it.id);
        if (!pg.pageInfo.hasNextPage) break;
        after = pg.pageInfo.endCursor;
      }
      assert(
        'keyset bất biến: userPins first:2 đi hết trang == first:50 (alice)',
        setEq(walked, whole.ids),
        `từng-trang ${show(walked)} ≠ một-lần ${show(whole.ids)}`,
      );
    }

    // ═══ 4. pin(id) — URL thẳng: 404, không 403, không phân biệt với không-tồn-tại ═══
    const Q_PIN = `query($id:ID!){ pin(id:$id){ id title } }`;
    await gql('pin(circle) — alice trong vòng đọc được', Q_PIN, { id: P.cir }, { token: state.T2 });
    await gql('pin(circle) — john ngoài vòng ăn 404', Q_PIN, { id: P.cir }, { token: state.T3, expect: /Pin not found/ });
    await gql('pin(circle) — khách vãng lai ăn 404 (fail-closed)', Q_PIN, { id: P.cir }, { expect: /Pin not found/ });
    await gql('pin(onlyme) — alice ăn 404', Q_PIN, { id: P.me }, { token: state.T2, expect: /Pin not found/ });
    await gql('pin(expired) — CHÍNH CHỦ mở được từ kho qua link', Q_PIN, { id: P.exp }, { token: state.T1 });
    await gql('pin(expired) — alice ăn 404 (hết hạn = biến mất)', Q_PIN, { id: P.exp }, { token: state.T2, expect: /Pin not found/ });

    // ═══ 5. search — SQL thô, nơi từng là bản-viết-tay-thứ-hai ═══
    const search = async (token) => {
      const r = await silent(
        `query($q:String!){ search(query:$q, type:PIN, first:20){ pins{ items{ id } } } }`,
        { q: TERM },
        token,
      );
      return { err: r?.errors?.[0]?.message ?? null, ids: xhIds(r?.data?.search?.pins?.items) };
    };
    for (const [who, token, expSet] of [
      ['alice', state.T2, expectFeed.alice],
      ['john', state.T3, expectFeed.john],
      ['guest', undefined, expectFeed.guest],
    ]) {
      const { err, ids } = await search(token);
      assert(
        `search "${TERM}" (${who}) — cùng tập với feed`,
        !err && setEq(ids, expSet),
        err ? `query LỖI: ${err}` : `thấy ${show(ids)} ≠ ${show(expSet)}`,
      );
    }

    // ═══ 6. relatedPins — pin giới hạn không được "gợi ý" ra ngoài khán giả ═══
    const related = async (token) => {
      const r = await silent(
        `query($p:ID!){ relatedPins(pinId:$p, first:20){ items{ id } } }`,
        { p: P.pub },
        token,
      );
      return { err: r?.errors?.[0]?.message ?? null, ids: xhIds(r?.data?.relatedPins?.items) };
    };
    {
      const a = await related(state.T2);
      const j = await related(state.T3);
      assert(
        'relatedPins(public): alice thấy pin vòng (tag chung), john thì không',
        !a.err && !j.err && a.ids.has(P.cir) && !j.ids.has(P.cir),
        a.err ?? j.err ?? `alice=${show(a.ids)} john=${show(j.ids)}`,
      );
    }

    // ═══ 7. savePin — XH-QĐ-4 + luật §4.6, và 404 phải THẮNG thông điệp rào chắn ═══
    const M_BOARD = `mutation($n:String!,$s:Boolean!){ createBoard(input:{name:$n, isSecret:$s}){ id } }`;
    const M_SAVE = `mutation($p:ID!,$b:ID){ savePin(input:{pinId:$p, boardId:$b}){ id } }`;

    const alicePub = (await silent(M_BOARD, { n: 'xh-alice-public', s: false }, state.T2))?.data?.createBoard;
    const aliceSec = (await silent(M_BOARD, { n: 'xh-alice-secret', s: true }, state.T2))?.data?.createBoard;
    if (!alicePub || !aliceSec) {
      rec('setup: board của alice', 'FAIL', 'createBoard không trả id');
      return false;
    }
    await gql('savePin(circle) không-board — chặn (luật §4.6, cửa sau boardId=null)', M_SAVE, { p: P.cir, b: null }, { token: state.T2, expect: /secret board/i });
    await gql('savePin(circle) vào board CÔNG KHAI của alice — chặn', M_SAVE, { p: P.cir, b: alicePub.id }, { token: state.T2, expect: /secret board/i });
    await gql('savePin(circle) vào board BÍ MẬT của alice — được', M_SAVE, { p: P.cir, b: aliceSec.id }, { token: state.T2 });
    await gql(
      'savePin(circle) — john nhận 404 "Pin not found", KHÔNG lộ thông điệp rào chắn',
      M_SAVE,
      { p: P.cir, b: null },
      { token: state.T3, expect: /Pin not found/ },
    );

    // ═══ 8. Bẫy 5 — lật board bí mật → công khai, pin giới hạn KHÔNG lộ ═══
    const baoSec = (await silent(M_BOARD, { n: 'xh-bao-secret', s: true }, state.T1))?.data?.createBoard;
    if (!baoSec) {
      rec('setup: board của bao', 'FAIL', 'createBoard không trả id');
      return false;
    }
    await gql('bao lưu pin vòng vào board bí mật CỦA MÌNH — được (XH-QĐ-4)', M_SAVE, { p: P.cir, b: baoSec.id }, { token: state.T1 });
    await gql(
      'bao LẬT board bí mật → công khai (isSecret sửa được là sự thật, không phải bug)',
      `mutation($id:ID!){ updateBoard(input:{id:$id, isSecret:false}){ id isSecret } }`,
      { id: baoSec.id },
      { token: state.T1 },
    );
    const boardPinsOf = async (token) => {
      const r = await silent(
        `query($b:ID!){ boardPins(boardId:$b, first:50){ items{ id pin{ id } } } }`,
        { b: baoSec.id },
        token,
      );
      return {
        err: r?.errors?.[0]?.message ?? null,
        pinIds: new Set((r?.data?.boardPins?.items ?? []).map((i) => i.pin?.id).filter(Boolean)),
      };
    };
    {
      const a = await boardPinsOf(state.T2);
      const j = await boardPinsOf(state.T3);
      assert(
        'boardPins sau khi lật: alice (trong vòng) thấy pin, john KHÔNG — lọc lúc đọc thắng rào chắn',
        !a.err && !j.err && a.pinIds.has(P.cir) && !j.pinIds.has(P.cir),
        a.err ?? j.err ?? `alice=${show(a.pinIds)} john=${show(j.pinIds)}`,
      );
      const cover = async (token) => {
        const r = await silent(`query($b:ID!){ board(id:$b){ id coverPin{ id } } }`, { b: baoSec.id }, token);
        return r?.data?.board?.coverPin?.id ?? null;
      };
      assert(
        'coverPin của board lật: alice thấy, john thấy null (bịt đường rò qua ảnh bìa)',
        (await cover(state.T2)) === P.cir && (await cover(state.T3)) === null,
        `alice=${await cover(state.T2)} john=${await cover(state.T3)}`,
      );
      const sj = await silent(
        `query($u:ID!){ savedPins(userId:$u, first:50){ items{ pin{ id } } } }`,
        { u: USERS.bao.id },
        state.T3,
      );
      const sjIds = new Set((sj?.data?.savedPins?.items ?? []).map((i) => i.pin?.id).filter(Boolean));
      assert(
        'savedPins(bao) dưới mắt john: pin vòng không lộ qua đường đã-lưu',
        !sj?.errors && !sjIds.has(P.cir),
        sj?.errors?.[0]?.message ?? `john thấy ${show(sjIds)}`,
      );
    }

    // ═══ 9. Bình luận + reaction — existence-oracle phải câm ═══
    const M_CMT = `mutation($p:String!,$c:String!){ createComment(input:{pinId:$p, content:$c}){ id } }`;
    await gql('createComment lên pin vòng — alice (trong vòng) được', M_CMT, { p: P.cir, c: 'xh: comment của alice' }, { token: state.T2 });
    await gql('createComment lên pin vòng — john ăn 404, không phải lỗi khác', M_CMT, { p: P.cir, c: 'xh: dò tồn tại' }, { token: state.T3, expect: /Pin not found/ });
    await gql('pinComments(pin vòng) — alice đọc được thread', `query($p:String!){ pinComments(pinId:$p, first:10){ items{ id } } }`, { p: P.cir }, { token: state.T2 });
    await gql('pinComments(pin vòng) — john ăn 404 cả thread', `query($p:String!){ pinComments(pinId:$p, first:10){ items{ id } } }`, { p: P.cir }, { token: state.T3, expect: /Pin not found/ });
    await gql('togglePinReaction(pin vòng) — john ăn 404', `mutation($p:ID!){ togglePinReaction(pinId:$p, type:HEART){ id } }`, { p: P.cir }, { token: state.T3, expect: /Pin not found/ });
    await gql('trackPinView(pin vòng) — john ăn 404 (không bơm được số liệu)', `mutation($p:ID!){ trackPinView(pinId:$p) }`, { p: P.cir }, { token: state.T3, expect: /Pin not found/ });

    // ═══ 10. Thông báo — notification trỏ tới pin ngoài khán giả biến mất im lặng ═══
    const unread = async () =>
      (await silent(`query{ unreadNotificationCount }`, {}, state.T3))?.data?.unreadNotificationCount;
    {
      const before = await unread();
      await prisma.notification.create({
        data: { type: 'SAVE', recipientId: USERS.john.id, actorId: USERS.alice.id, pinId: P.cir },
      });
      const afterHidden = await unread();
      await prisma.notification.create({
        data: { type: 'SAVE', recipientId: USERS.john.id, actorId: USERS.alice.id, pinId: P.cir2 },
      });
      const afterVisible = await unread();
      assert(
        'unreadNotificationCount(john): +0 cho notification pin-ngoài-khán-giả, +1 cho pin-trong',
        typeof before === 'number' && afterHidden === before && afterVisible === before + 1,
        `before=${before} sauẨn=${afterHidden} sauHiện=${afterVisible}`,
      );
      const list = await silent(`query{ notifications(first:50){ items{ id pin{ id } } } }`, {}, state.T3);
      const pinRefs = new Set(
        (list?.data?.notifications?.items ?? []).map((i) => i.pin?.id).filter((id) => id?.startsWith('xh_')),
      );
      assert(
        'notifications(john): danh sách chứa pin vòng-john, KHÔNG chứa pin vòng-alice',
        !list?.errors && pinRefs.has(P.cir2) && !pinRefs.has(P.cir),
        list?.errors?.[0]?.message ?? `refs=${show(pinRefs)}`,
      );
    }

    // ═══ 11. DM — attachedPin định hình theo NGƯỜI XEM, tin nhắn vẫn còn ═══
    const conv = (
      await silent(`mutation($u:String!){ createConversation(userId:$u){ id } }`, { u: USERS.john.id }, state.T1)
    )?.data?.createConversation;
    if (!conv) {
      rec('setup: conversation bao↔john', 'FAIL', 'createConversation không trả id (mutual follow seed đổi?)');
      return false;
    }
    // Kiểu biến đối chiếu SDL thật: SendMessageInput.conversationId là ID!,
    // còn query messages(conversationId:) lại là String! — hai chỗ NGƯỢC nhau.
    const M_MSG = `mutation($c:ID!,$t:String,$p:ID){ sendMessage(input:{conversationId:$c, content:$t, attachedPinId:$p}){ id } }`;
    await gql('bao gửi DM kèm pin vòng-john (john trong khán giả)', M_MSG, { c: conv.id, t: 'xh: kèm vòng john', p: P.cir2 }, { token: state.T1 });
    await gql('bao gửi DM kèm pin vòng-alice (john NGOÀI khán giả)', M_MSG, { c: conv.id, t: 'xh: kèm vòng alice', p: P.cir }, { token: state.T1 });
    await gql('john gửi DM kèm pin vòng-alice — 404 từ cửa gửi', M_MSG, { c: conv.id, t: 'xh: dò', p: P.cir }, { token: state.T3, expect: /Pin not found/ });
    await gql('gửi DM kèm pinId rác — 404 sạch, không nổ P2003/500', M_MSG, { c: conv.id, t: 'xh: rác', p: 'xh_khong_ton_tai' }, { token: state.T1, expect: /Pin not found/ });
    {
      const r = await silent(
        `query($c:String!){ messages(conversationId:$c, first:10){ items{ id content attachedPin{ id } } } }`,
        { c: conv.id },
        state.T3,
      );
      const items = r?.data?.messages?.items ?? [];
      const byContent = (t) => items.find((m) => m.content === t);
      const inAud = byContent('xh: kèm vòng john');
      const outAud = byContent('xh: kèm vòng alice');
      assert(
        'getMessages(john): pin trong khán giả hiện, pin ngoài khán giả = null mà TIN VẪN CÒN',
        !r?.errors && inAud?.attachedPin?.id === P.cir2 && outAud != null && outAud.attachedPin === null,
        r?.errors?.[0]?.message ??
          `trong=${inAud?.attachedPin?.id ?? 'null'} ngoài=${outAud ? (outAud.attachedPin?.id ?? 'null') : 'MẤT TIN'}`,
      );
      const rb = await silent(
        `query($c:String!){ messages(conversationId:$c, first:10){ items{ content attachedPin{ id } } } }`,
        { c: conv.id },
        state.T1,
      );
      const baoSees = (rb?.data?.messages?.items ?? []).find((m) => m.content === 'xh: kèm vòng alice');
      assert(
        'getMessages(bao): CHÍNH CHỦ pin vẫn thấy ảnh mình đính kèm',
        !rb?.errors && baoSees?.attachedPin?.id === P.cir,
        rb?.errors?.[0]?.message ?? `bao thấy=${baoSees?.attachedPin?.id ?? 'null'}`,
      );
    }

    return true;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}
