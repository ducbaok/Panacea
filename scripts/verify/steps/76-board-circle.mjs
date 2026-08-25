// Bước 76 — luồng D: mời NGUYÊN VÒNG vào board (XH-QĐ-17 · QĐ-25) + nguồn thứ
// ba của homeFeed: "xem riêng nội dung của một vòng"
// (xahoi-tinh-nang.md §9 · docs/xahoi-dieu-phoi.md §6 luồng D)
//
// HAI TÍNH NĂNG, MỘT BƯỚC, VÌ CHÚNG DÙNG CHUNG ĐÚNG MỘT NGUỒN SỰ THẬT: bảng
// `CircleMember`. Cái thứ nhất ĐỌC nó MỘT LẦN rồi quên (lời mời nở thành từng
// dòng `BoardCollaborator`); cái thứ hai đọc nó MỖI LẦN (feed vòng lọc lúc
// đọc). Tách đôi thành hai bước thì phép quyết định của cả luồng — bớt một
// người khỏi vòng và xem hai bề mặt trả lời KHÁC NHAU trong cùng một khoảnh
// khắc — không viết được ở đâu cả.
//
// 🔴 PHÉP QUYẾT ĐỊNH (mục 3): bao bớt alice khỏi vòng ⇒
//     · alice VẪN là cộng tác viên của board  (XH-QĐ-17 — đi NGƯỢC luật hồi tố)
//     · alice MẤT quyền xem chính pin gửi cho vòng đó (§3 luật hồi tố, giữ nguyên)
//   Cặp khẳng định đó là thứ duy nhất phân biệt bản cài đặt "nở lúc mời" với
//   bản "giữ circleId rồi tính lúc đọc". Bản thứ hai xanh mọi phép khác ở đây
//   và chỉ chết ở đúng phép này — nó cũng là bản mà một người đọc spec vội sẽ
//   viết, vì mọi thứ khác trong nhánh xã hội đều tính lúc đọc.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 4 lần). Trạng thái sống lâu bước này đẻ ra:
//   · `Circle`/`CircleMember` — xoá SẠCH, cùng lý do bước 74/75: trần 20
//     vòng/người chỉ đúng khi điểm xuất phát là 0, và không được tin bước
//     trước dọn hộ.
//   · `Board` tên `xh76*` — kéo theo `BoardCollaborator` bằng ON DELETE CASCADE.
//     Board KHÔNG dùng cuid cố định nên bản sót lại của lần chạy trước sẽ làm
//     phép đếm cộng tác viên đọc nhầm board.
//   · `Pin` tên `xh76*`.
//
// KHÔNG đo bộ lọc CHẶN ở feed vòng, cố ý: mệnh đề `_notInBlocked` dùng CHUNG
// với `exploreFeed`/`homeFeed`/`userPins` và đã có bằng chứng ở bước 65 + 67.
// Dựng lại nó ở đây bắt buộc phải block một trong hai cạnh `bao↔alice` —
// tiền đề cứng của bước 70 (subscription) mà bước 67 đã phải tự dựng lại bằng
// tay sau khi block. Đổi một phép trùng lặp lấy nguy cơ đó là lỗ vốn.
//
// Vai: bao = T1 (chủ board + chủ vòng) · alice = T2 (trong vòng) · john = T3 (ngoài).

import { createRequire } from 'node:module';
import { USERS } from '../lib/seedrefs.mjs';
import { readApiEnv } from '../lib/client.mjs';
import { clearPinRate, pinCreatePerMin } from '../lib/pin-rate.mjs';

const require = createRequire(import.meta.url);

const IMG = 'http://localhost:4000/uploads/xh76.png';
const T = (s) => `xh76 ${s}`;

const M_CIRCLE = `mutation($i:CreateCircleInput!){ createCircle(input:$i){ id name memberCount } }`;
const M_ADD_MEM = `mutation($i:CircleMembersInput!){ addCircleMembers(input:$i){ id memberCount } }`;
const M_RM_MEM = `mutation($c:ID!,$u:ID!){ removeCircleMember(circleId:$c, userId:$u){ id memberCount } }`;
const M_BOARD = `mutation($i:CreateBoardInput!){ createBoard(input:$i){ id name } }`;
const M_PIN = `mutation($i:CreatePinInput!){ createPin(input:$i){ id title visibility audienceCircleId } }`;
const M_INVITE_CIRCLE = `mutation($b:ID!,$c:ID!,$r:CollaboratorRole!){
  inviteCircleToBoard(boardId:$b, circleId:$c, role:$r){
    boardId circleId memberCount addedCount alreadyCount
    added{ id role user{ id username } }
  }
}`;
const M_ROLE = `mutation($b:ID!,$u:ID!,$r:CollaboratorRole!){ updateCollaboratorRole(boardId:$b, userId:$u, role:$r) }`;
const M_RM_COLLAB = `mutation($b:ID!,$u:ID!){ removeCollaborator(boardId:$b, userId:$u) }`;

const Q_COLLABS = `query($b:ID!){ board(id:$b){ id collaborators{ id role user{ id username } } } }`;

/**
 * MỘT document, HAI nguồn: feed vòng và `exploreFeed` của CÙNG người xem.
 *
 * Gộp lại chứ không gọi hai lần vì bằng chứng của cả mục là QUAN HỆ giữa hai
 * tập: feed vòng là tập con THỰC SỰ: pin PUBLIC/FOLLOWERS bị LỌC KHỎI nó chứ
 * không biến mất khỏi hệ thống. Hai request để lại khe hở cho việc so hai ảnh
 * chụp ở hai thời điểm — cùng loại mơ hồ mà bước 67 đã loại trừ bằng cách này.
 *
 * ⚠️ ĐỐI CHỨNG PHẢI LÀ `exploreFeed`, KHÔNG PHẢI `homeFeed` KHÔNG THAM SỐ:
 * nguồn mặc định của bao là FOLLOWING — pin của NGƯỜI KHÁC — nên pin bao vừa
 * đăng không bao giờ có mặt ở đó. Dùng nó làm đối chứng thì phép kiểm đỏ vì
 * một lý do chẳng liên quan gì tới nhánh đang đo (đã dính đúng một lần lúc
 * viết bước này).
 */
const Q_TWO_FEEDS = `query($c:ID!){
  circle: homeFeed(first:50, source:CIRCLE, circleId:$c){
    source items{ id title visibility audienceCircleId }
  }
  explore: exploreFeed(first:50){ items{ id title } }
}`;

const Q_CIRCLE_FEED = `query($c:ID!,$f:Int!,$a:String){
  homeFeed(first:$f, after:$a, source:CIRCLE, circleId:$c){
    source items{ id title } pageInfo{ hasNextPage endCursor }
  }
}`;

const errOf = (r) =>
  r?.errors?.[0]?.extensions?.originalError?.message ?? r?.errors?.[0]?.message ?? null;
const titles = (items) => new Set((items ?? []).map((i) => i.title));
const show = (s) => `{${[...s].sort().join(' · ')}}`;
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

export default async function (h) {
  const { gql, silent, rec, assert, state } = h;
  h.setGroup('GQL/board-circle');

  // ─── Prisma CHỈ để dọn + già hoá pin hết hạn (không phải bằng chứng) ──────
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

  /** Danh sách cộng tác viên dưới mắt một token — trả map username → role. */
  const collabsOf = async (boardId, token) => {
    const r = await silent(Q_COLLABS, { b: boardId }, token);
    const list = r?.data?.board?.collaborators ?? [];
    return {
      err: errOf(r),
      names: new Set(list.map((c) => c.user?.username).filter(Boolean)),
      roleOf: new Map(list.map((c) => [c.user?.username, c.role])),
    };
  };

  const createPin = async (name, input) =>
    (
      await gql(
        name,
        M_PIN,
        { i: { imageUrl: IMG, imageWidth: 100, imageHeight: 150, ...input } },
        { token: state.T1 },
      )
    )?.createPin ?? null;

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═════════════════════════════════════════════════════
    const wipedPins = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh76' } } });
    const wipedBoards = await prisma.board.deleteMany({ where: { name: { startsWith: 'xh76' } } });
    await prisma.circleMember.deleteMany({});
    const wipedCircles = await prisma.circle.deleteMany({});
    rec(
      'dọn state sống lâu Ở ĐẦU BƯỚC (pin/board xh76* + xoá SẠCH Circle/CircleMember)',
      'OK',
      `pin=${wipedPins.count} board=${wipedBoards.count} circle=${wipedCircles.count}`,
    );
    // Trạng thái sống lâu thêm từ 25/08 (XH-4b): bộ đếm `pincreate:<userId>`
    // TTL 60s, dùng CHUNG giữa các bước vì cùng đăng pin bằng `bao`. Bước 75
    // chạy ngay trước và cũng đăng pin — không dọn thì bước này bắt đầu với
    // quota đã tiêu một phần, và pin thứ N nào đó đỏ vì một luật chẳng liên
    // quan gì tới thứ nó đo.
    const clearedRate = await clearPinRate([USERS.bao.id, USERS.alice.id, USERS.john.id]);
    rec(
      'dọn bộ đếm `pincreate:*` Ở ĐẦU BƯỚC (trần 10 pin/phút XH-4b sống 60s, xuyên qua ranh giới bước)',
      'OK',
      clearedRate === null
        ? 'không kết nối được Redis ⇒ trần đang fail-open, không có gì để dọn'
        : `xoá ${clearedRate} khoá · trần đang chạy = ${pinCreatePerMin()} pin/phút`,
    );

    // ═══ 0. Fixture dựng bằng request THẬT ═══════════════════════════════════
    const circleA = (
      await gql(
        'bao lập vòng A [alice]',
        M_CIRCLE,
        { i: { name: T('vòng A'), userIds: [USERS.alice.id] } },
        { token: state.T1 },
      )
    )?.createCircle;
    const circleB = (
      await gql(
        'bao lập vòng B [john] (đối chứng: feed vòng không được trộn hai vòng)',
        M_CIRCLE,
        { i: { name: T('vòng B'), userIds: [USERS.john.id] } },
        { token: state.T1 },
      )
    )?.createCircle;
    const board = (
      await gql('bao lập board xh76', M_BOARD, { i: { name: T('board') } }, { token: state.T1 })
    )?.createBoard;
    if (!circleA?.id || !circleB?.id || !board?.id) {
      rec('setup: 2 vòng + 1 board', 'FAIL', 'thiếu ít nhất một fixture — xem 3 phép ngay trên');
      return false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PHẦN I — MỜI NGUYÊN VÒNG VÀO BOARD
    // ═══════════════════════════════════════════════════════════════════════

    // ─── 1. Phép nền: một lời gọi ⇒ cả vòng vào board, người ngoài KHÔNG ────
    {
      const r = await gql(
        'inviteCircleToBoard(vòng A, EDITOR) — MỘT lời gọi cho cả vòng',
        M_INVITE_CIRCLE,
        { b: board.id, c: circleA.id, r: 'EDITOR' },
        { token: state.T1 },
      );
      const res = r?.inviteCircleToBoard;
      const c = await collabsOf(board.id, state.T1);
      assert(
        'QUYẾT ĐỊNH: alice (trong vòng) thành cộng tác viên EDITOR, john (ngoài vòng) KHÔNG',
        !c.err &&
          c.names.has(USERS.alice.username) &&
          !c.names.has(USERS.john.username) &&
          c.roleOf.get(USERS.alice.username) === 'EDITOR',
        c.err
          ? `LỖI: ${c.err}`
          : `cộng tác viên=${show(c.names)} · vai trò alice=${c.roleOf.get(USERS.alice.username)}`,
      );
      assert(
        'bản tổng kết khớp thực tế: 1 thành viên · thêm 1 · đã có 0, và `added` trả đúng người',
        res?.memberCount === 1 &&
          res?.addedCount === 1 &&
          res?.alreadyCount === 0 &&
          res?.added?.length === 1 &&
          res.added[0].user?.username === USERS.alice.username &&
          res.added[0].role === 'EDITOR',
        `memberCount=${res?.memberCount} added=${res?.addedCount} already=${res?.alreadyCount} · ` +
          `added=[${(res?.added ?? []).map((a) => `${a.user?.username}:${a.role}`).join(',')}]`,
      );
      assert(
        'chủ board KHÔNG bị thêm vào chính danh sách cộng tác viên của mình',
        !c.names.has(USERS.bao.username),
        `cộng tác viên=${show(c.names)}`,
      );
    }

    // ─── 2. QĐ-25 — mời trùng: chỉ thêm người CÒN THIẾU, vai trò cũ giữ nguyên ─
    //
    // Hạ alice xuống VIEWER trước rồi mời lại CẢ VÒNG với role EDITOR. Một bản
    // cài đặt dùng `upsert`/`updateMany` sẽ nâng alice lên EDITOR — không lỗi
    // nào nổ, và triệu chứng là người dùng bị đổi quyền vì một thao tác họ
    // không hề nhắm vào họ.
    {
      await gql(
        'bao hạ vai trò alice xuống VIEWER (dựng tiền đề cho phép trùng người)',
        M_ROLE,
        { b: board.id, u: USERS.alice.id, r: 'VIEWER' },
        { token: state.T1 },
      );
      await gql(
        'bao thêm john vào vòng A ⇒ vòng thành [alice, john]',
        M_ADD_MEM,
        { i: { circleId: circleA.id, userIds: [USERS.john.id] } },
        { token: state.T1 },
      );
      const r = await gql(
        'mời LẠI cùng vòng A với role EDITOR (alice đã có mặt, john thì chưa)',
        M_INVITE_CIRCLE,
        { b: board.id, c: circleA.id, r: 'EDITOR' },
        { token: state.T1 },
      );
      const res = r?.inviteCircleToBoard;
      const c = await collabsOf(board.id, state.T1);
      assert(
        'QĐ-25: chỉ THÊM john; alice GIỮ NGUYÊN vai trò VIEWER cũ (không bị nâng lên EDITOR)',
        !c.err &&
          c.names.size === 2 &&
          c.roleOf.get(USERS.alice.username) === 'VIEWER' &&
          c.roleOf.get(USERS.john.username) === 'EDITOR',
        c.err
          ? `LỖI: ${c.err}`
          : `alice=${c.roleOf.get(USERS.alice.username)} john=${c.roleOf.get(USERS.john.username)} · ${show(c.names)}`,
      );
      assert(
        'đếm "x/y đã có mặt" đúng: 2 thành viên · thêm 1 · đã có 1',
        res?.memberCount === 2 && res?.addedCount === 1 && res?.alreadyCount === 1,
        `memberCount=${res?.memberCount} added=${res?.addedCount} already=${res?.alreadyCount}`,
      );
    }

    // ─── 2b. MỘT lời gọi ⇒ CẢ VÒNG vào board, không phải từng người một ─────
    //
    // Mục 1 và 2 đều chỉ thêm ĐÚNG MỘT người mỗi lần gọi (vòng 1 người · vòng 2
    // người nhưng 1 đã có mặt), nên cả hai đều xanh với một bản cài đặt chỉ
    // thêm được người ĐẦU TIÊN của vòng rồi dừng — `createMany` viết nhầm
    // thành `create` cho phần tử [0] là lỗi một dòng, không ném gì cả. Phép
    // này là chỗ DUY NHẤT trong bước bắt được: vòng 2 người + board TRẮNG ⇒
    // một request phải đẻ ra ĐÚNG 2 dòng cộng tác viên.
    {
      const board2 = (
        await gql(
          'bao lập board thứ hai (board TRẮNG — chưa ai là cộng tác viên)',
          M_BOARD,
          { i: { name: T('board 2') } },
          { token: state.T1 },
        )
      )?.createBoard;
      if (!board2?.id) {
        rec('setup: board thứ hai', 'FAIL', 'không lập được — xem phép ngay trên');
        return false;
      }
      const r = await gql(
        'MỘT lời gọi inviteCircleToBoard cho vòng A [alice, john] vào board trắng',
        M_INVITE_CIRCLE,
        { b: board2.id, c: circleA.id, r: 'VIEWER' },
        { token: state.T1 },
      );
      const res = r?.inviteCircleToBoard;
      const c = await collabsOf(board2.id, state.T1);
      assert(
        'QUYẾT ĐỊNH: MỘT lời gọi ⇒ CẢ HAI người của vòng thành cộng tác viên (không phải mỗi lần một người)',
        !c.err &&
          c.names.size === 2 &&
          c.names.has(USERS.alice.username) &&
          c.names.has(USERS.john.username) &&
          res?.addedCount === 2 &&
          res?.alreadyCount === 0 &&
          res?.memberCount === 2,
        c.err
          ? `LỖI: ${c.err}`
          : `cộng tác viên=${show(c.names)} · added=${res?.addedCount} already=${res?.alreadyCount} memberCount=${res?.memberCount}`,
      );
      assert(
        'vai trò của lời mời (VIEWER) áp cho CẢ HAI người mới — không rơi về mặc định',
        c.roleOf.get(USERS.alice.username) === 'VIEWER' &&
          c.roleOf.get(USERS.john.username) === 'VIEWER' &&
          (res?.added ?? []).every((a) => a.role === 'VIEWER'),
        `alice=${c.roleOf.get(USERS.alice.username)} john=${c.roleOf.get(USERS.john.username)} · added=[${(res?.added ?? []).map((a) => `${a.user?.username}:${a.role}`).join(',')}]`,
      );
      assert(
        'board thứ nhất KHÔNG bị đụng tới (lời mời chỉ tác động đúng board được chỉ định)',
        (await collabsOf(board.id, state.T1)).roleOf.get(USERS.alice.username) === 'VIEWER',
        `alice ở board 1 = ${(await collabsOf(board.id, state.T1)).roleOf.get(USERS.alice.username)} (phải VIEWER, không bị lời mời board 2 ghi đè)`,
      );
    }

    // ─── 3. 🔴 PHÉP QUYẾT ĐỊNH — XH-QĐ-17 ───────────────────────────────────
    //
    // Pin gửi cho vòng A dựng TRƯỚC khi bớt alice, để cùng một thao tác
    // `removeCircleMember` chạm được vào cả hai bề mặt.
    const pinA = await createPin('createPin CIRCLE → vòng A', {
      title: T('circle A'),
      visibility: 'CIRCLE',
      audienceCircleId: circleA.id,
    });
    if (!pinA?.id) {
      rec('setup: pin gửi cho vòng A', 'FAIL', 'không tạo được — xem phép ngay trên');
      return false;
    }
    {
      const seesBefore = await silent(`query($id:ID!){ pin(id:$id){ id } }`, { id: pinA.id }, state.T2);
      assert(
        'tiền đề: alice ĐANG xem được pin gửi cho vòng A',
        seesBefore?.data?.pin?.id === pinA.id,
        `pin(alice)=${seesBefore?.data?.pin?.id ?? errOf(seesBefore)}`,
      );

      await gql(
        'bao bớt alice khỏi vòng A (XH-QĐ-3: alice không nhận tín hiệu nào)',
        M_RM_MEM,
        { c: circleA.id, u: USERS.alice.id },
        { token: state.T1 },
      );

      const c = await collabsOf(board.id, state.T1);
      const seesAfter = await silent(`query($id:ID!){ pin(id:$id){ id } }`, { id: pinA.id }, state.T2);
      assert(
        '🔴 XH-QĐ-17: rời vòng SAU khi được mời ⇒ alice VẪN là cộng tác viên, vai trò VIEWER còn nguyên',
        !c.err &&
          c.names.has(USERS.alice.username) &&
          c.roleOf.get(USERS.alice.username) === 'VIEWER',
        c.err ? `LỖI: ${c.err}` : `cộng tác viên=${show(c.names)} · alice=${c.roleOf.get(USERS.alice.username)}`,
      );
      assert(
        '🔴 ĐỐI CHỨNG cùng khoảnh khắc: alice MẤT quyền xem pin gửi cho vòng đó (luật hồi tố §3 vẫn nguyên)',
        seesAfter?.data?.pin == null,
        `pin(alice)=${seesAfter?.data?.pin?.id ?? errOf(seesAfter)} — còn đọc được nghĩa là luật hồi tố đã hỏng`,
      );
      const bySelf = await silent(Q_COLLABS, { b: board.id }, state.T2);
      assert(
        'và alice tự thấy mình trong danh sách cộng tác viên (quyền vào board là THẬT, không chỉ còn dòng dữ liệu)',
        !errOf(bySelf) &&
          (bySelf?.data?.board?.collaborators ?? []).some((x) => x.user?.id === USERS.alice.id),
        errOf(bySelf) ?? `alice thấy ${(bySelf?.data?.board?.collaborators ?? []).length} cộng tác viên`,
      );
    }

    // ─── 4. Muốn bỏ thì CHỦ BOARD GỠ TAY (vế còn lại của XH-QĐ-17) ──────────
    {
      await gql(
        'bao gỡ tay alice khỏi board',
        M_RM_COLLAB,
        { b: board.id, u: USERS.alice.id },
        { token: state.T1 },
      );
      const c = await collabsOf(board.id, state.T1);
      assert(
        'gỡ tay ⇒ alice biến mất, john (mời cùng lời mời đó) còn nguyên',
        !c.err && !c.names.has(USERS.alice.username) && c.names.has(USERS.john.username),
        c.err ?? `cộng tác viên=${show(c.names)}`,
      );
    }

    // ─── 5. Phân quyền của chính đường mời vòng ─────────────────────────────
    {
      const aliceCircle = (
        await gql(
          'alice lập vòng riêng (đối chứng: vòng của NGƯỜI KHÁC)',
          M_CIRCLE,
          { i: { name: T('vòng của alice'), userIds: [USERS.bob.id] } },
          { token: state.T2 },
        )
      )?.createCircle;

      await gql(
        'john (không phải chủ board) mời vòng ⇒ từ chối',
        M_INVITE_CIRCLE,
        { b: board.id, c: circleA.id, r: 'EDITOR' },
        { token: state.T3, expect: /Only board owner/ },
      );
      await gql(
        'bao mời vòng của ALICE vào board của mình ⇒ 404 (danh sách thành viên vòng người khác không mượn được)',
        M_INVITE_CIRCLE,
        { b: board.id, c: aliceCircle?.id ?? 'xh76_khong_co', r: 'EDITOR' },
        { token: state.T1, expect: /Circle not found/ },
      );
      await gql(
        'mời vòng KHÔNG TỒN TẠI ⇒ CÙNG thông điệp (không suy ra được vòng kia có thật)',
        M_INVITE_CIRCLE,
        { b: board.id, c: 'xh76_vong_khong_ton_tai', r: 'EDITOR' },
        { token: state.T1, expect: /Circle not found/ },
      );
      await gql(
        'mời vòng vào board KHÔNG TỒN TẠI ⇒ từ chối như board người khác',
        M_INVITE_CIRCLE,
        { b: 'xh76_board_khong_ton_tai', c: circleA.id, r: 'EDITOR' },
        { token: state.T1, expect: /Only board owner/ },
      );
      await gql(
        'inviteCircleToBoard yêu cầu đăng nhập (khách ⇒ Unauthorized)',
        M_INVITE_CIRCLE,
        { b: board.id, c: circleA.id, r: 'EDITOR' },
        { expect: /Unauthorized/ },
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PHẦN II — homeFeed nguồn thứ ba: source=CIRCLE
    // ═══════════════════════════════════════════════════════════════════════
    h.setGroup('GQL/circle-feed');

    // Xếp lại vai cho phần II — vòng A phải có ĐÚNG một thành viên sống (alice)
    // và một người ĐỨNG NGOÀI (john) để hai nhánh quyền truy cập cùng đo được:
    //   · alice quay lại vòng (mục 3 vừa bớt cô ấy ra) ⇒ vai THÀNH VIÊN;
    //   · john ra khỏi vòng (mục 2 vừa thêm anh ấy vào) ⇒ vai NGƯỜI NGOÀI.
    // john vẫn là cộng tác viên của board sau thao tác thứ hai — một lần khẳng
    // định XH-QĐ-17 nữa, lần này trên người được mời cùng lời mời thứ hai.
    await gql(
      'bao thêm alice trở lại vòng A (tiền đề cho nhánh "người xem là THÀNH VIÊN")',
      M_ADD_MEM,
      { i: { circleId: circleA.id, userIds: [USERS.alice.id] } },
      { token: state.T1 },
    );
    await gql(
      'bao bớt john khỏi vòng A (tiền đề cho nhánh "người xem ĐỨNG NGOÀI")',
      M_RM_MEM,
      { c: circleA.id, u: USERS.john.id },
      { token: state.T1 },
    );
    {
      const c = await collabsOf(board.id, state.T1);
      assert(
        'john rời vòng A vẫn là cộng tác viên (XH-QĐ-17 lần thứ hai, trên người của lời mời thứ hai)',
        !c.err && c.names.has(USERS.john.username),
        c.err ?? `cộng tác viên=${show(c.names)}`,
      );
    }

    const pinA2 = await createPin('createPin CIRCLE → vòng A (pin thứ hai, để đo phân trang)', {
      title: T('circle A2'),
      visibility: 'CIRCLE',
      audienceCircleId: circleA.id,
    });
    const pinB = await createPin('createPin CIRCLE → vòng B (đối chứng vòng khác)', {
      title: T('circle B'),
      visibility: 'CIRCLE',
      audienceCircleId: circleB.id,
    });
    const pinPub = await createPin('createPin PUBLIC (đối chứng cấp khán giả khác)', {
      title: T('public'),
    });
    const pinFol = await createPin('createPin FOLLOWERS (đối chứng cấp khán giả khác)', {
      title: T('followers'),
      visibility: 'FOLLOWERS',
    });
    const pinGone = await createPin('createPin CIRCLE → vòng A, sẽ bị già hoá cho hết hạn', {
      title: T('circle A het han'),
      visibility: 'CIRCLE',
      audienceCircleId: circleA.id,
    });
    if (!pinA2 || !pinB || !pinPub || !pinFol || !pinGone) {
      rec('setup: 5 pin fixture của phần II', 'FAIL', 'thiếu ít nhất một pin — xem các phép ngay trên');
      return false;
    }

    // Già hoá bằng Prisma vì `expiresAt` trong quá khứ bị `createPin` từ chối
    // (đúng luật). Đây là dựng fixture, KHÔNG phải bằng chứng — bằng chứng là
    // câu trả lời của API ở phép ngay dưới.
    await prisma.pin.update({
      where: { id: pinGone.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const ALL_A = new Set([T('circle A'), T('circle A2')]);

    // ─── 6. Phép nền + đối chứng cùng response ──────────────────────────────
    {
      const r = await silent(Q_TWO_FEEDS, { c: circleA.id }, state.T1);
      const err = errOf(r);
      const cir = r?.data?.circle;
      const cirTitles = titles(cir?.items);
      const exploreTitles = titles(r?.data?.explore?.items);
      assert(
        'QUYẾT ĐỊNH: source=CIRCLE trả ĐÚNG pin gửi cho vòng đó — không pin vòng khác, không PUBLIC, không FOLLOWERS',
        !err && cir?.source === 'CIRCLE' && setEq(cirTitles, ALL_A),
        err ? `LỖI: ${err}` : `source=${cir?.source} · feed vòng=${show(cirTitles)} (kỳ vọng ${show(ALL_A)})`,
      );
      assert(
        'mọi item đều mang visibility=CIRCLE và audienceCircleId của ĐÚNG vòng được hỏi',
        !err &&
          (cir?.items ?? []).length > 0 &&
          (cir?.items ?? []).every(
            (i) => i.visibility === 'CIRCLE' && i.audienceCircleId === circleA.id,
          ),
        `items=${(cir?.items ?? []).map((i) => `${i.title}[${i.visibility}/${i.audienceCircleId === circleA.id ? 'A' : i.audienceCircleId}]`).join(' · ')}`,
      );
      assert(
        'pin HẾT HẠN gửi cho đúng vòng vẫn bị ẩn — KỂ CẢ với chính chủ (bộ lọc khán giả không bị nhánh mới đi vòng qua)',
        !err && !cirTitles.has(T('circle A het han')),
        `feed vòng=${show(cirTitles)}`,
      );
      assert(
        'ĐỐI CHỨNG cùng response: pin PUBLIC + pin của vòng đều đọc được ở exploreFeed ⇒ feed vòng LỌC, không phải chúng biến mất',
        !err &&
          exploreTitles.has(T('public')) &&
          exploreTitles.has(T('circle A')) &&
          [...cirTitles].every((t) => exploreTitles.has(t)) &&
          cirTitles.size < exploreTitles.size,
        `explore=${exploreTitles.size} pin (có PUBLIC=${exploreTitles.has(T('public'))}, có pin vòng A=${exploreTitles.has(T('circle A'))}) · feed vòng=${cirTitles.size} pin`,
      );
    }

    // ─── 7. Ai đọc được feed vòng: chủ vòng · THÀNH VIÊN · người ngoài ───────
    {
      const asAlice = await silent(Q_TWO_FEEDS, { c: circleA.id }, state.T2);
      const aliceTitles = titles(asAlice?.data?.circle?.items);
      assert(
        'THÀNH VIÊN (alice) đọc được feed vòng và thấy đúng những pin gửi cho vòng',
        !errOf(asAlice) &&
          asAlice?.data?.circle?.source === 'CIRCLE' &&
          setEq(aliceTitles, ALL_A),
        errOf(asAlice) ?? `alice thấy ${show(aliceTitles)}`,
      );
      const asJohn = await silent(Q_CIRCLE_FEED, { c: circleA.id, f: 50 }, state.T3);
      assert(
        'NGƯỜI NGOÀI (john — cộng tác viên của board nhưng KHÔNG còn trong vòng) ⇒ 404, KHÔNG phải danh sách rỗng',
        /Circle not found/.test(errOf(asJohn) ?? '') && asJohn?.data?.homeFeed == null,
        `lỗi=${errOf(asJohn)} · data=${JSON.stringify(asJohn?.data?.homeFeed ?? null).slice(0, 80)}`,
      );
      const ghost = await silent(Q_CIRCLE_FEED, { c: 'xh76_vong_khong_ton_tai', f: 50 }, state.T1);
      assert(
        'vòng KHÔNG TỒN TẠI ⇒ CÙNG thông điệp với vòng của người khác (không phân biệt được hai trường hợp)',
        /Circle not found/.test(errOf(ghost) ?? ''),
        `lỗi=${errOf(ghost)}`,
      );
      const anon = await silent(Q_CIRCLE_FEED, { c: circleA.id, f: 50 }, null);
      assert(
        'khách vãng lai ⇒ Unauthorized (nguồn mới không mở một cửa hậu cho homeFeed)',
        /unauthorized|forbidden/i.test(errOf(anon) ?? ''),
        `lỗi=${errOf(anon)}`,
      );
    }

    // ─── 8. Cặp source ⇄ circleId: sai chiều nào cũng phải NÉM ──────────────
    //
    // Chiều thứ hai (gửi circleId kèm nguồn khác) là chiều nguy hiểm: bỏ qua im
    // lặng thì client tưởng đã lọc theo vòng trong khi feed đang trả nguyên
    // nhánh following — không lỗi nào nổ, dữ liệu trông hợp lý.
    {
      const noId = await silent(
        `query{ homeFeed(first:5, source:CIRCLE){ source items{ id } } }`,
        {},
        state.T1,
      );
      assert(
        'source=CIRCLE mà THIẾU circleId ⇒ ném, không đoán một vòng nào cả',
        /requires circleId/i.test(errOf(noId) ?? '') && noId?.data?.homeFeed == null,
        `lỗi=${errOf(noId)}`,
      );
      const wrongPair = await silent(
        `query($c:ID!){ homeFeed(first:5, source:FOLLOWING, circleId:$c){ source items{ id } } }`,
        { c: circleA.id },
        state.T1,
      );
      assert(
        'circleId gửi kèm source=FOLLOWING ⇒ ném (KHÔNG bỏ qua im lặng rồi trả feed không lọc)',
        /only applies when source is CIRCLE/i.test(errOf(wrongPair) ?? ''),
        `lỗi=${errOf(wrongPair)}`,
      );
      const orphanId = await silent(
        `query($c:ID!){ homeFeed(first:5, circleId:$c){ source items{ id } } }`,
        { c: circleA.id },
        state.T1,
      );
      assert(
        'circleId gửi mà KHÔNG có source ⇒ cũng ném (nhánh tự chọn nguồn không được lặng lẽ nuốt circleId)',
        /only applies when source is CIRCLE/i.test(errOf(orphanId) ?? ''),
        `lỗi=${errOf(orphanId)}`,
      );
    }

    // ─── 9. Cursor KHÔNG xuyên nguồn ────────────────────────────────────────
    //
    // Cùng bẫy bước 67 đã ghi: cursor của nhánh này hợp lệ về mặt kỹ thuật với
    // MỌI nhánh khác (cùng bảng `Pin`, cùng khoá `(createdAt, id)`), nên đổi
    // nhánh giữa chừng không ném lỗi — nó chỉ lặng lẽ trộn pin vòng khác vào.
    {
      const pages = [];
      const seenSources = new Set();
      let cursor = undefined;
      let err = null;
      for (let i = 0; i < 5; i++) {
        const r = await silent(Q_CIRCLE_FEED, { c: circleA.id, f: 1, a: cursor }, state.T1);
        err = errOf(r);
        if (err) break;
        const page = r?.data?.homeFeed;
        if (!page) {
          err = 'không có data.homeFeed';
          break;
        }
        seenSources.add(page.source);
        pages.push(page.items.map((x) => x.title));
        if (!page.pageInfo.hasNextPage) break;
        cursor = page.pageInfo.endCursor;
      }
      const walked = pages.flat();
      const dup = walked.filter((t, i) => walked.indexOf(t) !== i);
      const extra = walked.filter((t) => !ALL_A.has(t));
      const missing = [...ALL_A].filter((t) => !walked.includes(t));
      assert(
        'cursor không xuyên nguồn: gộp các trang first=1 bằng ĐÚNG tập của vòng — không trùng · không thiếu · source giữ nguyên CIRCLE',
        !err &&
          pages.length >= 2 &&
          dup.length === 0 &&
          extra.length === 0 &&
          missing.length === 0 &&
          seenSources.size === 1 &&
          seenSources.has('CIRCLE'),
        err
          ? `LỖI: ${err}`
          : `${pages.length} trang = ${show(new Set(walked))} · source {${[...seenSources].join(',')}}` +
            (dup.length ? ` · TRÙNG: ${dup.join(',')}` : '') +
            (extra.length ? ` · DƯ (pin ngoài vòng lọt vào): ${extra.join(',')}` : '') +
            (missing.length ? ` · THIẾU: ${missing.join(',')}` : ''),
      );
    }

    // ─── 10. Dọn cuối ───────────────────────────────────────────────────────
    h.setGroup('GQL/board-circle');
    {
      const p = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh76' } } });
      const b = await prisma.board.deleteMany({ where: { name: { startsWith: 'xh76' } } });
      await prisma.circleMember.deleteMany({});
      const c = await prisma.circle.deleteMany({});
      // `BoardCollaborator` đi theo board bằng ON DELETE CASCADE — đếm lại để
      // chắc chắn ràng buộc đó có thật, chứ không chỉ có trong file migration.
      const leftCollabs = await prisma.boardCollaborator.count({ where: { boardId: board.id } });
      const leftPins = await prisma.pin.count({ where: { title: { startsWith: 'xh76' } } });
      assert(
        'dọn cuối bước: pin/board/vòng biến mất, và BoardCollaborator đi theo board qua CASCADE',
        leftPins === 0 && leftCollabs === 0,
        `xoá pin=${p.count} board=${b.count} circle=${c.count} · còn sót pin=${leftPins} collaborator=${leftCollabs}`,
      );
    }

    return true;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}
