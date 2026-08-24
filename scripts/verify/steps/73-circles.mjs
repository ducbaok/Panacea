// Bước 73 — XH-3: module vòng tròn bạn bè (PLAN_XAHOI.md §6, xahoi-dieu-phoi.md §3)
//
// BẰNG CHỨNG Ở ĐÂY LÀ REQUEST THẬT, HAI TÀI KHOẢN. Mọi thao tác lên vòng đều
// đi qua GraphQL với token thật của bao(T1)/alice(T2)/john(T3) — khác bước 72,
// nơi vòng tròn buộc phải seed thẳng DB vì lúc đó chưa có API này.
//
// ⚠️ HAI CHỖ VẪN SEED THẲNG DB, có cờ, cùng bản chất seed.ts:
//   1. PIN `xhb_pin_circle` — `createPin(visibility:)` là luồng A (XH-4a), chưa
//      merge ở mốc này. Không có pin giới hạn thì phép XH-QĐ-3 không đo được gì.
//   2. 51 TÀI KHOẢN `xhb_u*` — trần 50 thành viên/vòng không kiểm được bằng 5
//      tài khoản seed. Chúng bị xoá ở `finally` VÀ ở đầu bước: để sót thì lần
//      chạy sau bước 66 (`suggestedUsers`) sẽ làm việc trên một dân số khác.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 3 lần — PLAN_XAHOI.md §7). State sống lâu
// của bước này: `Circle`, `CircleMember`, cộng fixture `xhb_`/`xhb-`. Xoá SẠCH
// bảng Circle như bước 72 làm, chứ không xoá theo tiền tố: trần 20 vòng/người
// chỉ đo được khi biết chắc điểm xuất phát là 0, mà vòng do API sinh ra mang
// cuid nên không có tiền tố nào để bám.
//
// PHÉP ĐẶC BIỆT XH-QĐ-3 (§7 của PLAN_XAHOI, một trong ba phép đặc biệt của cả
// đợt): bao lập vòng có john → pin CIRCLE → john LƯU vào board bí mật của mình
// → bao bớt john khỏi vòng → pin biến mất IM LẶNG khỏi mọi bề mặt của john, kể
// cả board đã lưu và URL thẳng (404, không phải 403). Rồi thêm john lại → pin
// hiện lại. Vế cuối mới là vế chứng minh cơ chế: nếu pin biến mất vì DỮ LIỆU bị
// xoá chứ không phải vì BỘ LỌC lúc đọc, nó sẽ không quay lại được.

import { createRequire } from 'node:module';
import { USERS } from '../lib/seedrefs.mjs';
import { readApiEnv } from '../lib/client.mjs';

const require = createRequire(import.meta.url);

/** Tiền tố riêng của bước này — KHÔNG đụng `xh_`/`xh-` của bước 72. */
const PIN_ID = 'xhb_pin_circle';
const BOARD_NAME = 'xhb-john-secret';
const USER_PREFIX = 'xhb_u';
/** 51 = trần 50 + 1 người thừa. */
const FILLER_COUNT = 51;

const ids = (arr) => new Set((arr ?? []).map((x) => x.id));
const show = (s) => `{${[...s].sort().join(', ')}}`;

// ─── Câu truy vấn dùng lại ───────────────────────────────────────────────────
const Q_MY = `query($a:Boolean){ myCircles(includeAdHoc:$a){ id name rank isAdHoc memberCount members{ id username email } } }`;
const Q_ONE = `query($id:ID!){ circle(id:$id){ id name rank isAdHoc memberCount members{ id } } }`;
const M_CREATE = `mutation($i:CreateCircleInput!){ createCircle(input:$i){ id name rank isAdHoc memberCount members{ id } } }`;
const M_UPDATE = `mutation($i:UpdateCircleInput!){ updateCircle(input:$i){ id name rank memberCount } }`;
const M_DELETE = `mutation($id:ID!){ deleteCircle(id:$id) }`;
const M_DUP = `mutation($i:DuplicateCircleInput!){ duplicateCircle(input:$i){ id name rank isAdHoc memberCount members{ id } } }`;
const M_ADD = `mutation($i:CircleMembersInput!){ addCircleMembers(input:$i){ id memberCount members{ id } } }`;
const M_REMOVE = `mutation($c:ID!,$u:ID!){ removeCircleMember(circleId:$c, userId:$u){ id memberCount members{ id } } }`;
const M_ADHOC = `mutation($i:CreateAdHocCircleInput!){ createAdHocCircle(input:$i){ id name isAdHoc memberCount members{ id } } }`;
const M_SAVE_ADHOC = `mutation($i:SaveAdHocCircleInput!){ saveAdHocCircle(input:$i){ id name rank isAdHoc memberCount } }`;
const Q_SUGGEST = `query($c:ID,$f:Int){ circleMemberSuggestions(circleId:$c, first:$f){ id username email } }`;

const Q_PIN = `query($id:ID!){ pin(id:$id){ id title } }`;
const M_BOARD = `mutation($n:String!,$s:Boolean!){ createBoard(input:{name:$n, isSecret:$s}){ id } }`;
const M_SAVEPIN = `mutation($p:ID!,$b:ID){ savePin(input:{pinId:$p, boardId:$b}){ id } }`;
const Q_BOARDPINS = `query($b:ID!){ boardPins(boardId:$b, first:50){ items{ pin{ id } } } }`;
const Q_SAVEDPINS = `query($u:ID!){ savedPins(userId:$u, first:50){ items{ pin{ id } } } }`;
const Q_EXPLORE = `query{ exploreFeed(first:50){ items{ id } } }`;
const Q_NOTIF = `query{ unreadNotificationCount notifications(first:50){ items{ id } } }`;

export default async function (h) {
  const { gql, silent, rec, assert, state } = h;
  h.setGroup('GQL/circles');

  // ─── Prisma cho setup + dọn (KHÔNG dùng làm bằng chứng) ────────────────────
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

  /** Xoá fixture của riêng bước này. Chạy ở ĐẦU bước và lại ở `finally`. */
  const wipeFixtures = async () => {
    await prisma.notification.deleteMany({ where: { pinId: { startsWith: 'xhb_' } } });
    await prisma.savedPin.deleteMany({ where: { pinId: { startsWith: 'xhb_' } } });
    await prisma.savedPin.deleteMany({ where: { board: { name: { startsWith: 'xhb-' } } } });
    await prisma.board.deleteMany({ where: { name: { startsWith: 'xhb-' } } });
    await prisma.pin.deleteMany({ where: { id: { startsWith: 'xhb_' } } });
    // Tài khoản độn: xoá CỨNG (deleteMany không đi qua middleware soft-delete),
    // `CircleMember` rụng theo onDelete: Cascade.
    await prisma.user.deleteMany({ where: { id: { startsWith: USER_PREFIX } } });
  };

  try {
    // ─── DỌN Ở ĐẦU BƯỚC ──────────────────────────────────────────────────────
    await wipeFixtures();
    await prisma.circleMember.deleteMany({});
    await prisma.circle.deleteMany({});
    assert(
      'dọn đầu bước: 0 Circle, 0 CircleMember, 0 tài khoản độn',
      (await prisma.circle.count()) === 0 &&
        (await prisma.circleMember.count()) === 0 &&
        (await prisma.user.count({ where: { id: { startsWith: USER_PREFIX } } })) === 0,
      'còn sót state của lần chạy trước',
    );

    // ═══ 1. CRUD hai tài khoản — mỗi phép thấy CẢ nhánh có quyền lẫn nhánh 404 ═
    const c1 = await gql(
      'createCircle (bao) — vòng đặt tên, rank 1, 1 thành viên',
      M_CREATE,
      { i: { name: 'xhb vòng thân', rank: 1, userIds: [USERS.alice.id] } },
      { token: state.T1 },
    );
    const circleId = c1?.createCircle?.id;
    if (!circleId) {
      rec('setup: createCircle', 'FAIL', 'không trả id — mọi phép sau vô nghĩa');
      return false;
    }
    assert(
      'createCircle trả đúng hình dạng: isAdHoc=false, rank=1, memberCount=1, members=[alice]',
      c1.createCircle.isAdHoc === false &&
        c1.createCircle.rank === 1 &&
        c1.createCircle.memberCount === 1 &&
        c1.createCircle.members?.[0]?.id === USERS.alice.id,
      JSON.stringify(c1.createCircle),
    );

    // Hai tài khoản, MỘT câu query, hai kết quả khác nhau — chuẩn nhà.
    {
      const mine = await silent(Q_MY, { a: false }, state.T1);
      const theirs = await silent(Q_MY, { a: false }, state.T3);
      const myIds = ids(mine?.data?.myCircles);
      const johnIds = ids(theirs?.data?.myCircles);
      assert(
        'myCircles: bao thấy vòng của mình, john KHÔNG thấy nó trong danh sách của john',
        !mine?.errors && !theirs?.errors && myIds.has(circleId) && !johnIds.has(circleId),
        mine?.errors?.[0]?.message ?? theirs?.errors?.[0]?.message ?? `bao=${show(myIds)} john=${show(johnIds)}`,
      );
      const alice = mine?.data?.myCircles?.find((c) => c.id === circleId)?.members?.[0];
      assert(
        'members KHÔNG rò email của người khác (Prisma trả nguyên cột, resolver phải cắt)',
        alice?.id === USERS.alice.id && alice?.email === null,
        `alice.email=${JSON.stringify(alice?.email)} (phải null)`,
      );
    }

    await gql('circle(id) — chính chủ đọc được', Q_ONE, { id: circleId }, { token: state.T1 });
    await gql('circle(id) — john ăn 404 "Circle not found", không phải 403', Q_ONE, { id: circleId }, { token: state.T3, expect: /Circle not found/ });
    await gql('circle(id) rác — cùng thông điệp 404 (không phân biệt được với vòng người khác)', Q_ONE, { id: 'xhb_khong_ton_tai' }, { token: state.T1, expect: /Circle not found/ });
    await gql('myCircles không token → 401 (không có bản Optional cho dữ liệu quản lý)', Q_MY, { a: false }, { expect: /Unauthorized/ });

    // 4 thao tác GHI của người ngoài, cả 4 phải là 404 — 403 tự nó đã là rò rỉ.
    await gql('updateCircle vòng của bao — john ăn 404', M_UPDATE, { i: { id: circleId, name: 'cướp' } }, { token: state.T3, expect: /Circle not found/ });
    await gql('addCircleMembers vòng của bao — john ăn 404', M_ADD, { i: { circleId, userIds: [USERS.john.id] } }, { token: state.T3, expect: /Circle not found/ });
    await gql('removeCircleMember vòng của bao — john ăn 404', M_REMOVE, { c: circleId, u: USERS.alice.id }, { token: state.T3, expect: /Circle not found/ });
    await gql('deleteCircle vòng của bao — john ăn 404', M_DELETE, { id: circleId }, { token: state.T3, expect: /Circle not found/ });
    {
      // 404 phải là TỪ CHỐI, không phải "thành công rồi báo lỗi". Không có phép
      // này thì một `deleteCircle` xoá thật rồi ném 404 vẫn xanh.
      const still = await silent(Q_ONE, { id: circleId }, state.T1);
      assert(
        'sau 4 thao tác 404 của john: vòng của bao CÒN NGUYÊN (404 là từ chối, không phải xoá xong mới báo lỗi)',
        still?.data?.circle?.id === circleId && still?.data?.circle?.memberCount === 1,
        `circle=${JSON.stringify(still?.data?.circle)}`,
      );
    }

    // ── update: rank phân biệt "không gửi" với "gửi null" ─────────────────────
    await gql('updateCircle (bao) — đổi tên, KHÔNG gửi rank ⇒ rank giữ nguyên', M_UPDATE, { i: { id: circleId, name: 'xhb vòng thân v2' } }, { token: state.T1 });
    {
      const r = await silent(Q_ONE, { id: circleId }, state.T1);
      assert(
        'không gửi rank ⇒ GIỮ rank cũ (1), tên đã đổi',
        r?.data?.circle?.rank === 1 && r?.data?.circle?.name === 'xhb vòng thân v2',
        `rank=${r?.data?.circle?.rank} name=${r?.data?.circle?.name}`,
      );
    }
    await gql('updateCircle (bao) — gửi rank:null ⇒ XOÁ rank (vòng thành "tự đặt tên")', M_UPDATE, { i: { id: circleId, rank: null } }, { token: state.T1 });
    {
      const r = await silent(Q_ONE, { id: circleId }, state.T1);
      assert('gửi rank:null ⇒ rank = null', r?.data?.circle?.rank === null, `rank=${r?.data?.circle?.rank}`);
    }

    // ── thành viên: thêm/bớt + 3 cửa chặn ────────────────────────────────────
    const add1 = await gql('addCircleMembers (bao) — thêm john', M_ADD, { i: { circleId, userIds: [USERS.john.id] } }, { token: state.T1 });
    assert(
      'sau thêm: memberCount = 2 (alice + john)',
      add1?.addCircleMembers?.memberCount === 2 &&
        ids(add1.addCircleMembers.members).has(USERS.john.id),
      JSON.stringify(add1?.addCircleMembers),
    );
    const add2 = await gql('addCircleMembers (bao) — thêm LẠI john (thao tác lặp)', M_ADD, { i: { circleId, userIds: [USERS.john.id] } }, { token: state.T1 });
    assert(
      'thêm người đã có mặt KHÔNG lỗi và KHÔNG nhân đôi: memberCount vẫn 2',
      add2?.addCircleMembers?.memberCount === 2,
      `memberCount=${add2?.addCircleMembers?.memberCount}`,
    );
    await gql('addCircleMembers — tự thêm CHÍNH MÌNH bị chặn', M_ADD, { i: { circleId, userIds: [USERS.bao.id] } }, { token: state.T1, expect: /do not add yourself/i });
    await gql('addCircleMembers — userId RÁC trả 400 sạch, KHÔNG nổ P2003/500', M_ADD, { i: { circleId, userIds: ['xhb_nguoi_khong_co'] } }, { token: state.T1, expect: /Unknown userId/ });
    {
      const rm = await gql('removeCircleMember (bao) — bớt alice', M_REMOVE, { c: circleId, u: USERS.alice.id }, { token: state.T1 });
      assert(
        'sau bớt: memberCount = 1, alice không còn trong danh sách',
        rm?.removeCircleMember?.memberCount === 1 && !ids(rm.removeCircleMember.members).has(USERS.alice.id),
        JSON.stringify(rm?.removeCircleMember),
      );
    }
    {
      const rm2 = await gql('removeCircleMember — bớt người vốn KHÔNG ở trong vòng: không lỗi (mô tả trạng thái, không phải sự kiện)', M_REMOVE, { c: circleId, u: USERS.alice.id }, { token: state.T1 });
      assert('bớt lặp lại vẫn memberCount = 1', rm2?.removeCircleMember?.memberCount === 1, `memberCount=${rm2?.removeCircleMember?.memberCount}`);
    }

    // ── nhân bản ─────────────────────────────────────────────────────────────
    {
      const dup = await gql(
        'duplicateCircle (bao) — "để không phải tick lại 20 người"',
        M_DUP,
        { i: { sourceCircleId: circleId, name: 'xhb bản sao', rank: 3 } },
        { token: state.T1 },
      );
      const src = await silent(Q_ONE, { id: circleId }, state.T1);
      assert(
        'bản sao: id KHÁC, tên mới, cùng tập thành viên, luôn là vòng đặt tên',
        dup?.duplicateCircle?.id &&
          dup.duplicateCircle.id !== circleId &&
          dup.duplicateCircle.name === 'xhb bản sao' &&
          dup.duplicateCircle.isAdHoc === false &&
          dup.duplicateCircle.memberCount === src?.data?.circle?.memberCount,
        `sao=${JSON.stringify(dup?.duplicateCircle)} nguồn=${JSON.stringify(src?.data?.circle)}`,
      );
      await gql('duplicateCircle từ vòng của NGƯỜI KHÁC — 404', M_DUP, { i: { sourceCircleId: circleId, name: 'xhb cướp' } }, { token: state.T3, expect: /Circle not found/ });
    }

    // ═══ 2. rank = level: MỘT cơ chế, hai cách trình bày ═══════════════════════
    {
      await silent(M_CREATE, { i: { name: 'xhb level 5', rank: 5 } }, state.T1);
      await silent(M_CREATE, { i: { name: 'xhb không level' } }, state.T1);
      const r = await silent(Q_MY, { a: false }, state.T1);
      const list = r?.data?.myCircles ?? [];
      const ranks = list.map((c) => c.rank);
      const firstNull = ranks.findIndex((x) => x === null);
      const ranked = firstNull === -1 ? ranks : ranks.slice(0, firstNull);
      const tail = firstNull === -1 ? [] : ranks.slice(firstNull);
      assert(
        'myCircles: vòng CÓ level lên trước (rank tăng dần), vòng tự đặt tên xuống cuối — không cần bảng thứ hai cho "level"',
        !r?.errors &&
          ranked.every((v, i) => v !== null && (i === 0 || v >= ranked[i - 1])) &&
          tail.every((v) => v === null),
        r?.errors?.[0]?.message ?? `ranks=[${ranks.join(', ')}]`,
      );
      assert(
        'cùng một danh sách chứa CẢ vòng có rank lẫn vòng rank null (hai nhánh trong một response)',
        ranked.length > 0 && tail.length > 0,
        `có-rank=${ranked.length} không-rank=${tail.length}`,
      );
    }

    // ═══ 3. Vòng ad-hoc + memberHash tái dùng (XH-QĐ-5) ═══════════════════════
    let adHocId;
    {
      const a1 = await gql('createAdHocCircle (bao) — khán giả chọn tại chỗ [alice, john]', M_ADHOC, { i: { userIds: [USERS.alice.id, USERS.john.id] } }, { token: state.T1 });
      adHocId = a1?.createAdHocCircle?.id;
      assert(
        'vòng ad-hoc: isAdHoc=true, tên rỗng (nhãn là việc của FE, DB không chứa bản dịch)',
        a1?.createAdHocCircle?.isAdHoc === true &&
          a1.createAdHocCircle.name === '' &&
          a1.createAdHocCircle.memberCount === 2,
        JSON.stringify(a1?.createAdHocCircle),
      );

      // Điểm mấu chốt của memberHash: THỨ TỰ KHÔNG ĐƯỢC ẢNH HƯỞNG.
      const a2 = await gql('createAdHocCircle (bao) — CÙNG tập người, ĐẢO thứ tự [john, alice]', M_ADHOC, { i: { userIds: [USERS.john.id, USERS.alice.id] } }, { token: state.T1 });
      assert(
        'memberHash TÁI DÙNG: cùng tập người (khác thứ tự) ⇒ ĐÚNG MỘT vòng, không đẻ bản thứ hai',
        a2?.createAdHocCircle?.id === adHocId,
        `lần 1=${adHocId} lần 2=${a2?.createAdHocCircle?.id} — khác nhau nghĩa là hash không sort trước khi băm`,
      );
      const a3 = await gql('createAdHocCircle (bao) — gửi id LẶP [alice, alice, john]', M_ADHOC, { i: { userIds: [USERS.alice.id, USERS.alice.id, USERS.john.id] } }, { token: state.T1 });
      assert('khử trùng trước khi băm: id lặp vẫn ra đúng vòng cũ', a3?.createAdHocCircle?.id === adHocId, `id=${a3?.createAdHocCircle?.id}`);

      // memberHash có khoá theo CHỦ vòng: alice chọn cùng kiểu nhóm ⇒ vòng riêng.
      const a4 = await gql('createAdHocCircle (alice) — tập người khác chủ ⇒ vòng RIÊNG của alice', M_ADHOC, { i: { userIds: [USERS.bao.id, USERS.john.id] } }, { token: state.T2 });
      assert(
        'unique là (ownerId, memberHash): vòng ad-hoc của alice KHÔNG đụng vòng của bao',
        a4?.createAdHocCircle?.id && a4.createAdHocCircle.id !== adHocId,
        `alice=${a4?.createAdHocCircle?.id} bao=${adHocId}`,
      );

      // Ẩn khỏi màn quản lý (XH-QĐ-5) — hai nhánh của cùng một query.
      const hidden = await silent(Q_MY, { a: false }, state.T1);
      const shown = await silent(Q_MY, { a: true }, state.T1);
      assert(
        'myCircles mặc định ẨN vòng ad-hoc; includeAdHoc:true mới hiện — hai nhánh, cùng một query',
        !ids(hidden?.data?.myCircles).has(adHocId) && ids(shown?.data?.myCircles).has(adHocId),
        `ẩn=${show(ids(hidden?.data?.myCircles))} hiện=${show(ids(shown?.data?.myCircles))}`,
      );

      await gql('updateCircle lên vòng ad-hoc — chặn (memberHash chỉ đúng khi tập thành viên đứng yên)', M_UPDATE, { i: { id: adHocId, name: 'xhb sửa lén' } }, { token: state.T1, expect: /ad-hoc audience/i });
      await gql('addCircleMembers lên vòng ad-hoc — chặn', M_ADD, { i: { circleId: adHocId, userIds: [USERS.bao.id] } }, { token: state.T1, expect: /ad-hoc audience/i });

      // ── "Lưu vòng tròn này" ──────────────────────────────────────────────
      const saved = await gql('saveAdHocCircle (bao) — đặt tên ⇒ thành vòng bình thường', M_SAVE_ADHOC, { i: { circleId: adHocId, name: 'xhb đã lưu', rank: 2 } }, { token: state.T1 });
      assert(
        'lưu vòng ad-hoc: CÙNG id (pin đã ghim giữ nguyên khán giả), isAdHoc=false, có tên + rank',
        saved?.saveAdHocCircle?.id === adHocId &&
          saved.saveAdHocCircle.isAdHoc === false &&
          saved.saveAdHocCircle.name === 'xhb đã lưu' &&
          saved.saveAdHocCircle.rank === 2,
        JSON.stringify(saved?.saveAdHocCircle),
      );
      {
        const after = await silent(Q_MY, { a: false }, state.T1);
        assert('sau khi lưu: vòng XUẤT HIỆN ở màn quản lý', ids(after?.data?.myCircles).has(adHocId), show(ids(after?.data?.myCircles)));
      }
      await gql('saveAdHocCircle lần hai — chặn (vòng đã lưu rồi)', M_SAVE_ADHOC, { i: { circleId: adHocId, name: 'xhb lưu lại' } }, { token: state.T1, expect: /already saved/i });
      await gql('saveAdHocCircle vòng của người khác — 404', M_SAVE_ADHOC, { i: { circleId: adHocId, name: 'xhb cướp' } }, { token: state.T3, expect: /Circle not found/ });
      {
        // Hệ quả có chủ đích của việc XOÁ memberHash lúc lưu: lần sau chọn đúng
        // nhóm người này sẽ sinh vòng ad-hoc MỚI, không nuốt mất vòng đã đặt tên.
        const again = await gql('createAdHocCircle lại đúng tập [alice, john] SAU khi đã lưu', M_ADHOC, { i: { userIds: [USERS.alice.id, USERS.john.id] } }, { token: state.T1 });
        assert(
          'lưu vòng xoá memberHash ⇒ vòng ad-hoc mới KHÔNG nuốt vòng đã đặt tên của người dùng',
          again?.createAdHocCircle?.id && again.createAdHocCircle.id !== adHocId,
          `mới=${again?.createAdHocCircle?.id} đã-lưu=${adHocId}`,
        );
      }
    }

    // ═══ 4. Gợi ý thành viên — tái dùng xếp hạng suggestedUsers ═══════════════
    {
      const sug = await gql('circleMemberSuggestions (bao) — cho vòng đang sửa', Q_SUGGEST, { c: circleId, f: 10 }, { token: state.T1 });
      const list = sug?.circleMemberSuggestions ?? [];
      const sugIds = new Set(list.map((u) => u.id));
      const cur = await silent(Q_ONE, { id: circleId }, state.T1);
      const members = new Set((cur?.data?.circle?.members ?? []).map((m) => m.id));
      assert(
        'gợi ý loại đúng: không có chính mình, không có thành viên hiện có, không trùng nhau',
        list.length > 0 &&
          !sugIds.has(USERS.bao.id) &&
          [...members].every((m) => !sugIds.has(m)) &&
          sugIds.size === list.length,
        `gợi ý=${show(sugIds)} thành viên hiện có=${show(members)}`,
      );
      assert('gợi ý KHÔNG rò email', list.every((u) => u.email === null), JSON.stringify(list.map((u) => u.email)));
      // Không truyền circleId = gợi ý cho vòng SẮP lập ⇒ thành viên cũ không bị loại.
      const sug2 = await silent(Q_SUGGEST, { c: null, f: 10 }, state.T1);
      const sug2Ids = new Set((sug2?.data?.circleMemberSuggestions ?? []).map((u) => u.id));
      assert(
        'circleMemberSuggestions không kèm circleId: dành cho vòng sắp lập ⇒ KHÔNG loại thành viên của vòng khác',
        !sug2?.errors && [...members].some((m) => sug2Ids.has(m)),
        sug2?.errors?.[0]?.message ?? `không-vòng=${show(sug2Ids)} thành viên=${show(members)}`,
      );
      await gql('circleMemberSuggestions cho vòng của NGƯỜI KHÁC — 404', Q_SUGGEST, { c: circleId, f: 10 }, { token: state.T3, expect: /Circle not found/ });
    }

    // ═══ 5. PHÉP ĐẶC BIỆT XH-QĐ-3 — rời vòng là mất quyền xem, hồi tố, im lặng ═
    h.setGroup('GQL/circles-qd3');
    {
      const c = await gql('createCircle (bao) — vòng cho phép XH-QĐ-3, thành viên: john', M_CREATE, { i: { name: 'xhb vòng QĐ3', userIds: [USERS.john.id] } }, { token: state.T1 });
      const qd3Circle = c?.createCircle?.id;
      if (!qd3Circle) {
        rec('setup: vòng QĐ3', 'FAIL', 'createCircle không trả id');
        return false;
      }

      // ⚠️ SEED THẲNG DB, có cờ: createPin(visibility:) thuộc luồng A, chưa merge.
      await prisma.pin.create({
        data: {
          id: PIN_ID,
          creatorId: USERS.bao.id,
          title: 'xhb pin vòng QĐ3',
          imageUrl: 'http://localhost/xhb.png',
          imageWidth: 100,
          imageHeight: 100,
          visibility: 'CIRCLE',
          audienceCircleId: qd3Circle,
        },
      });

      // ── Trước khi bị bớt: john thấy pin và LƯU được vào board bí mật ───────
      await gql('john (thành viên) mở pin CIRCLE qua URL thẳng — được', Q_PIN, { id: PIN_ID }, { token: state.T3 });
      const board = (await silent(M_BOARD, { n: BOARD_NAME, s: true }, state.T3))?.data?.createBoard;
      if (!board) {
        rec('setup: board bí mật của john', 'FAIL', 'createBoard không trả id');
        return false;
      }
      await gql('john lưu pin vào board BÍ MẬT của chính mình — được (XH-QĐ-4)', M_SAVEPIN, { p: PIN_ID, b: board.id }, { token: state.T3 });

      const johnSees = async () => {
        const [bp, sp, ex] = await Promise.all([
          silent(Q_BOARDPINS, { b: board.id }, state.T3),
          silent(Q_SAVEDPINS, { u: USERS.john.id }, state.T3),
          silent(Q_EXPLORE, {}, state.T3),
        ]);
        return {
          board: new Set((bp?.data?.boardPins?.items ?? []).map((i) => i.pin?.id).filter(Boolean)),
          saved: new Set((sp?.data?.savedPins?.items ?? []).map((i) => i.pin?.id).filter(Boolean)),
          explore: new Set((ex?.data?.exploreFeed?.items ?? []).map((i) => i.id)),
        };
      };
      const before = await johnSees();
      assert(
        'TRƯỚC khi bị bớt: pin có mặt ở board đã lưu + savedPins + exploreFeed của john',
        before.board.has(PIN_ID) && before.saved.has(PIN_ID) && before.explore.has(PIN_ID),
        `board=${before.board.has(PIN_ID)} saved=${before.saved.has(PIN_ID)} explore=${before.explore.has(PIN_ID)}`,
      );

      const notifBefore = await silent(Q_NOTIF, {}, state.T3);
      const unreadBefore = notifBefore?.data?.unreadNotificationCount;
      const notifCountBefore = (notifBefore?.data?.notifications?.items ?? []).length;

      // ── BỚT JOHN KHỎI VÒNG ────────────────────────────────────────────────
      const rm = await gql('bao bớt john khỏi vòng (XH-QĐ-3)', M_REMOVE, { c: qd3Circle, u: USERS.john.id }, { token: state.T1 });
      assert('sau removeCircleMember: vòng còn 0 thành viên', rm?.removeCircleMember?.memberCount === 0, `memberCount=${rm?.removeCircleMember?.memberCount}`);

      // ── HỒI TỐ: biến mất khỏi MỌI bề mặt của john ─────────────────────────
      await gql('URL THẲNG sau khi bị bớt — john ăn 404 "Pin not found", KHÔNG phải 403', Q_PIN, { id: PIN_ID }, { token: state.T3, expect: /Pin not found/ });
      const after = await johnSees();
      assert(
        'HỒI TỐ: pin biến mất khỏi BOARD ĐÃ LƯU của john (bộ lọc lúc đọc thắng cả pin đã nằm trong board)',
        !after.board.has(PIN_ID),
        `boardPins vẫn còn: ${show(after.board)}`,
      );
      assert('HỒI TỐ: pin biến mất khỏi savedPins của john', !after.saved.has(PIN_ID), show(after.saved));
      assert('HỒI TỐ: pin biến mất khỏi exploreFeed của john', !after.explore.has(PIN_ID), show(after.explore));

      // ── IM LẶNG: không thông báo, không bia mộ ────────────────────────────
      const notifAfter = await silent(Q_NOTIF, {}, state.T3);
      assert(
        'IM LẶNG: john KHÔNG nhận thông báo nào về việc bị bớt khỏi vòng (số chưa đọc + số thông báo đứng yên)',
        notifAfter?.data?.unreadNotificationCount === unreadBefore &&
          (notifAfter?.data?.notifications?.items ?? []).length === notifCountBefore,
        `chưa đọc ${unreadBefore} → ${notifAfter?.data?.unreadNotificationCount}; danh sách ${notifCountBefore} → ${(notifAfter?.data?.notifications?.items ?? []).length}`,
      );

      // ── CHÍNH CHỦ không bị ảnh hưởng ──────────────────────────────────────
      await gql('bao (chủ pin) vẫn mở được pin của mình sau khi vòng rỗng', Q_PIN, { id: PIN_ID }, { token: state.T1 });

      // ── VẾ CHỨNG MINH CƠ CHẾ: dữ liệu của john KHÔNG bị phá ───────────────
      const savedRow = await prisma.savedPin.count({ where: { pinId: PIN_ID, userId: USERS.john.id } });
      assert(
        'dòng SavedPin của john VẪN CÒN trong DB — pin biến mất vì BỘ LỌC lúc đọc, không phải vì xoá dữ liệu của người khác',
        savedRow === 1,
        `SavedPin(john, pin) = ${savedRow} dòng (phải 1)`,
      );
      await gql('bao thêm john trở lại vòng', M_ADD, { i: { circleId: qd3Circle, userIds: [USERS.john.id] } }, { token: state.T1 });
      await gql('sau khi được thêm lại: john mở pin qua URL thẳng — ĐƯỢC (chứng minh cơ chế là lọc, không phải xoá)', Q_PIN, { id: PIN_ID }, { token: state.T3 });
      const back = await johnSees();
      assert(
        'sau khi được thêm lại: pin HIỆN LẠI đúng chỗ cũ trong board đã lưu',
        back.board.has(PIN_ID) && back.saved.has(PIN_ID),
        `board=${back.board.has(PIN_ID)} saved=${back.saved.has(PIN_ID)}`,
      );
    }

    // ═══ 6. Trần 20 vòng/người — ĐẾM CẢ AD-HOC (XH-QĐ-13) ════════════════════
    h.setGroup('GQL/circles-limits');
    {
      // john dùng làm chủ thể vì bao đã có sẵn vòng từ các phép trên.
      const start = await prisma.circle.count({ where: { ownerId: USERS.john.id } });
      for (let i = start; i < 20; i++) {
        await silent(M_CREATE, { i: { name: `xhb trần ${i}` } }, state.T3);
      }
      const now = await prisma.circle.count({ where: { ownerId: USERS.john.id } });
      assert('tiền đề trần: john đang có đúng 20 vòng', now === 20, `đang có ${now}`);
      await gql('vòng thứ 21 — chặn', M_CREATE, { i: { name: 'xhb trần 21' } }, { token: state.T3, expect: /up to 20 circles/i });
      await gql('nhân bản khi đã đủ 20 — cũng chặn (không có cửa sau qua duplicate)', M_DUP, { i: { sourceCircleId: (await silent(Q_MY, { a: true }, state.T3))?.data?.myCircles?.[0]?.id, name: 'xhb trần dup' } }, { token: state.T3, expect: /up to 20 circles/i });
      await gql(
        'vòng AD-HOC khi đã đủ 20 — cũng chặn: trần ĐẾM CẢ ad-hoc (XH-QĐ-13)',
        M_ADHOC,
        { i: { userIds: [USERS.bao.id] } },
        { token: state.T3, expect: /up to 20 circles/i },
      );
    }

    // ═══ 7. Trần 50 thành viên/vòng ══════════════════════════════════════════
    {
      // 51 tài khoản độn — 5 tài khoản seed không đủ để chạm trần 50.
      await prisma.user.createMany({
        data: Array.from({ length: FILLER_COUNT }, (_, i) => ({
          id: `${USER_PREFIX}${i}`,
          email: `${USER_PREFIX}${i}@example.com`,
          username: `${USER_PREFIX}${i}`,
          name: `xhb filler ${i}`,
        })),
        skipDuplicates: true,
      });
      const filler = Array.from({ length: FILLER_COUNT }, (_, i) => `${USER_PREFIX}${i}`);

      const full = await gql('alice tạo vòng đúng 50 thành viên — được', M_CREATE, { i: { name: 'xhb vòng đầy', userIds: filler.slice(0, 50) } }, { token: state.T2 });
      assert('vòng 50 người: memberCount = 50', full?.createCircle?.memberCount === 50, `memberCount=${full?.createCircle?.memberCount}`);

      await gql(
        'thêm người thứ 51 vào vòng đã đủ 50 — chặn (trần tính trên TỔNG sau khi thêm)',
        M_ADD,
        { i: { circleId: full?.createCircle?.id, userIds: [filler[50]] } },
        { token: state.T2, expect: /up to 50 members/i },
      );
      await gql(
        'gửi thẳng 51 id trong MỘT lô — chặn ngay ở tầng validation',
        M_CREATE,
        { i: { name: 'xhb vòng 51', userIds: filler } },
        { token: state.T2, expect: /no more than 50 elements|up to 50 members/i },
      );
    }

    return true;
  } finally {
    // Dọn LẦN HAI ở đây, không phải thay cho lần dọn đầu bước: 51 tài khoản độn
    // để sót sẽ đổi dân số mà bước 66 (`suggestedUsers`) làm việc trên đó ở lần
    // chạy sau — mà bước 66 chạy TRƯỚC bước 73 nên lần dọn đầu bước tới quá muộn.
    await wipeFixtures().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}
