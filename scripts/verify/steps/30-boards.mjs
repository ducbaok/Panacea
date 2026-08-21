// Bước 30 — Boards: query, CRUD board/section, savePin, reorder, collaborator
//
// Bước này TỰ DỌN tài nguyên của mình ở cuối (unsavePin → deleteSection →
// deleteBoard). Quy ước chung của bộ verify: thứ gì chỉ sống trong một bước thì
// bước đó dọn; chỉ thứ CẮT NGANG nhiều bước mới lên `90-teardown.mjs`.
// Ở đây board/section là nội bộ, còn `state.PIN` thì không — pin còn phải sống
// tiếp tới bước 40 (comment) nên `deletePin` nằm ở bước 90.
//
// P1 Đợt 2 (11/08/2026) — mở rộng: 25 dòng SavedPin trong `state.BOARD`
// (chủ 15 + collaborator EDITOR 10 ⇒ sortOrder trùng đôi 0..9), + phép quyết
// định "3 trang gộp == 1 trang lớn" cho `boardPins` và `userBoards`, + phép
// khẳng định `pin_1_id` được tạo TRƯỚC pin probe (byte-identical cursor).
//
// ⚠️ Bẫy dọn: `unsavePin` có `boardId` ĐÒI QUYỀN EDITOR — phải unsave 10 dòng
// của alice TRƯỚC khi `removeCollaborator`. Đảo thứ tự thì phép dọn CHẾT mà
// phép kiểm vẫn xanh, và lần chạy sau sẽ thấy board có sẵn 10 dòng lạ.

import { login } from '../lib/client.mjs';
import { USERS, PASSWORD } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';

// Bất biến phân trang: gộp N trang first=k phải == 1 trang first=N*k
//   • cùng tập id (không trùng, không thiếu, đúng thứ tự)
// Chạy TRƯỚC khi sửa để có mốc; SAU khi sửa để so với chính nó.
const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/query');

  const ub = await gql(
    'userBoards',
    `query($u:ID!,$f:Int!){ userBoards(userId:$u, first:$f){ items{ id name pinCount } pageInfo{ endCursor } } }`,
    { u: state.ME, f: 5 },
    { token: state.T1 },
  );
  const seedBoard = ub?.userBoards?.items?.[0]?.id;

  await gql(
    'board',
    `query($id:ID!){ board(id:$id){ id name user{ username } pinCount sections{ id name } collaborators{ role } } }`,
    { id: seedBoard },
    { token: state.T1 },
  );
  await gql(
    'boardPins',
    `query($b:ID!,$f:Int!){ boardPins(boardId:$b, first:$f){ items{ id note pin{ title } } pageInfo{ endCursor } } }`,
    { b: seedBoard, f: 5 },
    { token: state.T1 },
  );

  h.setGroup('GQL/mut');

  const cb = await gql(
    'createBoard',
    `mutation($i:CreateBoardInput!){ createBoard(input:$i){ id name } }`,
    { i: { name: `Probe Board ${state.uniq}`, description: 'v', isSecret: false } },
    { token: state.T1 },
  );
  const BOARD = cb?.createBoard?.id;
  state.BOARD = BOARD;

  await gql(
    'updateBoard',
    `mutation($i:UpdateBoardInput!){ updateBoard(input:$i){ id name } }`,
    { i: { id: BOARD, name: `Probe Board ${state.uniq} v2` } },
    { token: state.T1 },
  );

  const s1 = await gql(
    'createSection',
    `mutation($i:CreateSectionInput!){ createSection(input:$i){ id name sortOrder } }`,
    { i: { boardId: BOARD, name: 'Section A' } },
    { token: state.T1 },
  );
  const SEC = s1?.createSection?.id;
  const s2 = await gql(
    'createSection (2)',
    `mutation($i:CreateSectionInput!){ createSection(input:$i){ id } }`,
    { i: { boardId: BOARD, name: 'Section B' } },
    { token: state.T1 },
  );
  const SEC2 = s2?.createSection?.id;

  await gql(
    'updateSection',
    `mutation($i:UpdateSectionInput!){ updateSection(input:$i){ id name } }`,
    { i: { id: SEC, name: 'Section A renamed' } },
    { token: state.T1 },
  );
  await gql(
    'reorderSections',
    `mutation($b:ID!,$s:[ID!]!){ reorderSections(boardId:$b, sectionIds:$s) }`,
    { b: BOARD, s: [SEC2, SEC].filter(Boolean) },
    { token: state.T1 },
  );
  await gql(
    'savePin',
    `mutation($i:SavePinInput!){ savePin(input:$i){ id note pin{ title } } }`,
    { i: { pinId: state.PIN, boardId: BOARD, sectionId: SEC, note: 'saved by probe' } },
    { token: state.T1 },
  );
  // ═══ REVIEW-1 (#7) — query `savedPins` MỚI ════════════════════════════════
  //
  // Vì sao query này tồn tại: nút "Lưu" mặc định (thẻ pin và màn chi tiết) ghi
  // `SavedPin` với `boardId = null`, mà `boardPins` bắt buộc `boardId: ID!` ⇒
  // trước REVIEW-1 nhóm dòng đó KHÔNG có màn nào đọc được. Người dùng bấm Lưu,
  // nút đổi trạng thái, rồi không tìm thấy pin ở đâu cả.
  //
  // ⚠️ Khẳng định TẬP-CHỨA, không phải số tuyệt đối: các bước khác cũng lưu/bỏ
  // lưu pin của bao, nên số dòng không cố định giữa các lần chạy.
  {
    const Q_SAVED = `query($u:ID!){ savedPins(userId:$u, first:50){ items{ id boardId pin{ id } } } }`;

    // (a) Lưu KHÔNG board — đúng đường mà nút "Lưu" mặc định đi.
    const noBoardPin = 'pin_9_id';
    await h.silent(
      `mutation($i:SavePinInput!){ savePin(input:$i){ id } }`,
      { i: { pinId: noBoardPin } },
      state.T1,
    );

    const mine = await h.silent(Q_SAVED, { u: USERS.bao.id }, state.T1);
    const rows = mine?.data?.savedPins?.items ?? [];
    h.assert(
      'REVIEW-1 savedPins: thấy dòng lưu KHÔNG board (nhóm trước nay không màn nào đọc được)',
      !mine?.errors && rows.some((r) => r.pin?.id === noBoardPin && r.boardId === null),
      mine?.errors
        ? `LỖI: ${mine.errors[0].message}`
        : `${rows.length} dòng · dòng boardId=null cho ${noBoardPin}: ${rows.some((r) => r.pin?.id === noBoardPin && r.boardId === null) ? 'có' : 'KHÔNG THẤY'}`,
    );

    h.assert(
      'REVIEW-1 savedPins: cũng gồm dòng lưu CÓ board (không chỉ nhóm boardId=null)',
      rows.some((r) => r.pin?.id === state.PIN && r.boardId === BOARD),
      `dòng ${state.PIN} trong board ${BOARD}: ${rows.some((r) => r.pin?.id === state.PIN && r.boardId === BOARD) ? 'có' : 'KHÔNG THẤY'}`,
    );

    // (b) Board BÍ MẬT: chủ thấy, người khác không. Đây là chỗ dễ rò nhất —
    // `savedPins` đi thẳng vào bảng SavedPin, không qua `checkBoardAccess`.
    const sb = await h.silent(
      `mutation($i:CreateBoardInput!){ createBoard(input:$i){ id } }`,
      { i: { name: 'r1 secret board', isSecret: true } },
      state.T1,
    );
    const secretBoard = sb?.data?.createBoard?.id ?? null;
    const secretPin = 'pin_10_id';
    if (secretBoard) {
      await h.silent(
        `mutation($i:SavePinInput!){ savePin(input:$i){ id } }`,
        { i: { pinId: secretPin, boardId: secretBoard } },
        state.T1,
      );
    }

    const asOwner = await h.silent(Q_SAVED, { u: USERS.bao.id }, state.T1);
    const asOther = await h.silent(Q_SAVED, { u: USERS.bao.id }, state.T2);
    const ownerSees = (asOwner?.data?.savedPins?.items ?? []).some((r) => r.boardId === secretBoard);
    const otherSees = (asOther?.data?.savedPins?.items ?? []).some((r) => r.boardId === secretBoard);

    h.assert(
      'REVIEW-1 savedPins: dòng lưu vào board BÍ MẬT — chủ thấy, người khác KHÔNG',
      !asOther?.errors && ownerSees && !otherSees,
      asOther?.errors
        ? `LỖI: ${asOther.errors[0].message}`
        : `chủ thấy=${ownerSees} · người khác thấy=${otherSees} (phải true/false)`,
    );

    // (c) Người chưa lưu gì ⇒ trang rỗng, KHÔNG lỗi.
    const emptyOne = await h.silent(Q_SAVED, { u: USERS.bob?.id ?? 'user_5_id' }, state.T1);
    h.assert(
      'REVIEW-1 savedPins: người chưa lưu pin nào ⇒ trang rỗng, không ném lỗi',
      !emptyOne?.errors && Array.isArray(emptyOne?.data?.savedPins?.items),
      emptyOne?.errors
        ? `LỖI: ${emptyOne.errors[0].message}`
        : `${(emptyOne?.data?.savedPins?.items ?? []).length} dòng`,
    );

    // Dọn phần (a) + (b) ngay — bước này tự dọn tài nguyên của mình.
    await h.silent(`mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`, { p: noBoardPin, b: null }, state.T1);
    if (secretBoard) {
      await h.silent(
        `mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`,
        { p: secretPin, b: secretBoard },
        state.T1,
      );
      await h.silent(`mutation($id:ID!){ deleteBoard(id:$id) }`, { id: secretBoard }, state.T1);
    }
  }

  await gql(
    'reorderPins',
    `mutation($b:ID!,$p:[ID!]!){ reorderPins(boardId:$b, pinIds:$p) }`,
    { b: BOARD, p: [state.PIN].filter(Boolean) },
    { token: state.T1 },
  );
  await gql(
    'setBoardCover',
    `mutation($b:ID!,$p:ID!){ setBoardCover(boardId:$b, pinId:$p) }`,
    { b: BOARD, p: state.PIN },
    { token: state.T1 },
  );

  await gql(
    'inviteCollaborator',
    `mutation($b:ID!,$u:ID!,$r:CollaboratorRole!){ inviteCollaborator(boardId:$b, userId:$u, role:$r){ id role } }`,
    { b: BOARD, u: state.ME2, r: 'VIEWER' },
    { token: state.T1 },
  );
  // Từng trả `{ count: 1 }` của Prisma vào field khai `Boolean!` ⇒ nổ lúc
  // serialize. Xem docs/debug_history.md §2 và boards.service.ts:411.
  await gql(
    'updateCollaboratorRole',
    `mutation($b:ID!,$u:ID!,$r:CollaboratorRole!){ updateCollaboratorRole(boardId:$b, userId:$u, role:$r) }`,
    { b: BOARD, u: state.ME2, r: 'EDITOR' },
    { token: state.T1 },
  );

  h.setGroup('GQL/security');
  await gql(
    'deleteBoard của người khác → phải chặn',
    `mutation($id:ID!){ deleteBoard(id:$id) }`,
    { id: BOARD },
    { token: state.T3, expect: /Board not found or no permission/ },
  );

  // ─── P1 Đợt 2 · phân trang: dựng 25 SavedPin có sortOrder trùng THẬT ───
  //
  // ⚠️ `sortOrder` trùng chỉ dựng được bằng collaborator, không có cách khác:
  // `savePin` tính `max+1` theo `{boardId, userId}` (boards.service.ts:250) nên
  // HAI user khác nhau tự sinh ra sortOrder trùng nhau. Không có bước này thì
  // sortOrder là duy nhất và tie-breaker KHÔNG bao giờ chạy — phép kiểm
  // 3-thành-phần trở thành phép kiểm 1-thành-phần mà vẫn xanh.
  h.setGroup('GQL/perf');

  // Lấy 15 pin seed + 10 khác nhau cho alice
  const seedPins = await h.silent(
    `query{ exploreFeed(first: 20){ items{ id createdAt } } }`,
    {},
    state.T1,
  );
  const pinIds = (seedPins?.data?.exploreFeed?.items ?? [])
    .filter((p) => /^pin_\d+_id$/.test(p.id))
    .map((p) => p.id);

  const pinsForBao = pinIds.slice(0, 15);
  const pinsForAlice = pinIds.slice(0, 10); // trùng pinId với bao ⇒ (userId,pinId,boardId) khác dòng nhau (unique cho phép)

  // Save bằng bao (T1): 15 dòng, sortOrder 0..14
  for (const pid of pinsForBao) {
    await h.silent(
      `mutation($i:SavePinInput!){ savePin(input:$i){ id sortOrder } }`,
      { i: { pinId: pid, boardId: BOARD } },
      state.T1,
    );
  }
  // Save bằng alice (T2, EDITOR): 10 dòng, sortOrder 0..9 (trùng đôi với 10 dòng đầu của bao)
  for (const pid of pinsForAlice) {
    await h.silent(
      `mutation($i:SavePinInput!){ savePin(input:$i){ id sortOrder } }`,
      { i: { pinId: pid, boardId: BOARD } },
      state.T2,
    );
  }

  // Đo tình trạng sortOrder — chỉ log, KHÔNG assert số tuyệt đối vì save trước
  // đó của T1 với sectionId cũng có sortOrder=0 nên 26 dòng tổng.
  const boardPinsAll = await h.silent(
    `query($b:ID!,$f:Int!){ boardPins(boardId:$b, first:$f){ items{ id note pin{ id } } pageInfo{ hasNextPage endCursor } } }`,
    { b: BOARD, f: 50 },
    { token: state.T1 },
  );
  const bpTotal = boardPinsAll?.data?.boardPins?.items?.length ?? 0;

  h.assert(
    'dựng ≥25 SavedPin trong BOARD (chủ + collaborator EDITOR) — tiền đề cho phép kiểm 3-thành-phần',
    bpTotal >= 25,
    `${bpTotal} dòng SavedPin`,
  );

  // ── PHÉP QUYẾT ĐỊNH: boardPins — 4 trang first=6 gộp == 1 trang first=24 ──
  //
  // Với BOARD_PINS_KEYSET (sortOrder asc, createdAt desc, id desc), 25 dòng
  // sortOrder trùng đôi buộc tie-breaker phải chạy đúng. Nếu keyset lệch, hai
  // trang sẽ trùng/thiếu — phép so tập id sẽ bắt được.
  const runBoardPins = async (first, after) => {
    const r = await h.silent(
      `query($b:ID!,$f:Int!,$a:String){ boardPins(boardId:$b, first:$f, after:$a){ items{ id } pageInfo{ hasNextPage endCursor } } }`,
      { b: BOARD, f: first, a: after ?? null },
      state.T1,
    );
    return r?.data?.boardPins ?? { items: [], pageInfo: {} };
  };
  const pageA = await runBoardPins(6, null);
  const pageB = await runBoardPins(6, pageA.pageInfo?.endCursor);
  const pageC = await runBoardPins(6, pageB.pageInfo?.endCursor);
  const pageD = await runBoardPins(6, pageC.pageInfo?.endCursor);
  const paged = [...pageA.items, ...pageB.items, ...pageC.items, ...pageD.items].map((x) => x.id);
  const big = await runBoardPins(24, null);
  const bigIds = big.items.map((x) => x.id);

  const dupSet = new Set(paged);
  const bigDup = new Set(bigIds);

  h.assert(
    'QUYẾT ĐỊNH: boardPins — 4 trang first=6 gộp bằng ĐÚNG 1 trang first=24 (không trùng · không thiếu · đúng thứ tự)',
    paged.length === bigIds.length &&
      dupSet.size === paged.length &&
      bigDup.size === bigIds.length &&
      setEq(paged, bigIds),
    `paged=${paged.length} unique=${dupSet.size} · big=${bigIds.length} unique=${bigDup.size} · setEq=${setEq(paged, bigIds)}`,
  );

  // Phép PHỤ mạnh hơn: page-by-page first=1 — bắt được bẫy "boundary cắt ngang
  // cặp cùng sortOrder". Với first=6, alice/bao có cùng sortOrder=k luôn cùng
  // trang; với first=1 mọi cặp bị chẻ đôi giữa hai trang ⇒ nhánh OR "cùng
  // sortOrder, createdAt/id nhỏ hơn" PHẢI chạy đúng, nếu thiếu ⇒ mất item.
  const oneByOne = [];
  let cursor = null;
  for (let i = 0; i < 30; i++) {
    const p = await runBoardPins(1, cursor);
    if (p.items.length === 0) break;
    oneByOne.push(p.items[0].id);
    if (!p.pageInfo?.hasNextPage) break;
    cursor = p.pageInfo?.endCursor;
  }
  const oneDup = new Set(oneByOne);
  h.assert(
    'QUYẾT ĐỊNH+: boardPins — paging first=1 qua từng cặp sortOrder trùng (bắt bẫy OR-clause thiếu)',
    oneByOne.length === bpTotal &&
      oneDup.size === oneByOne.length,
    `one-by-one=${oneByOne.length} unique=${oneDup.size} · total_expected=${bpTotal}`,
  );

  // ── PHÉP QUYẾT ĐỊNH: userBoards — 3 trang first=2 gộp == 1 trang first=6 ──
  //
  // Dựng thêm 4 board probe (chủ = bao) — cùng với board hiện có và các board
  // seed, đủ ≥6 dòng để phân trang có nghĩa.
  const extraBoards = [];
  for (let i = 0; i < 4; i++) {
    const cb = await h.silent(
      `mutation($i:CreateBoardInput!){ createBoard(input:$i){ id } }`,
      { i: { name: `Probe UBoard ${state.uniq} #${i}`, isSecret: false } },
      state.T1,
    );
    const id = cb?.data?.createBoard?.id;
    if (id) extraBoards.push(id);
  }

  const runUserBoards = async (first, after) => {
    const r = await h.silent(
      `query($u:ID!,$f:Int!,$a:String){ userBoards(userId:$u, first:$f, after:$a){ items{ id } pageInfo{ hasNextPage endCursor } } }`,
      { u: state.ME, f: first, a: after ?? null },
      state.T1,
    );
    return r?.data?.userBoards ?? { items: [], pageInfo: {} };
  };
  const ubA = await runUserBoards(2, null);
  const ubB = await runUserBoards(2, ubA.pageInfo?.endCursor);
  const ubC = await runUserBoards(2, ubB.pageInfo?.endCursor);
  const ubPaged = [...ubA.items, ...ubB.items, ...ubC.items].map((x) => x.id);
  const ubBig = await runUserBoards(6, null);
  const ubBigIds = ubBig.items.map((x) => x.id);
  const ubDup = new Set(ubPaged);

  h.assert(
    'QUYẾT ĐỊNH: userBoards — 3 trang first=2 gộp bằng ĐÚNG 1 trang first=6 (không trùng · không thiếu · đúng thứ tự)',
    ubPaged.length === ubBigIds.length &&
      ubDup.size === ubPaged.length &&
      setEq(ubPaged, ubBigIds),
    `paged=${ubPaged.length} unique=${ubDup.size} · big=${ubBigIds.length} · setEq=${setEq(ubPaged, ubBigIds)}`,
  );

  // ── PHÉP: boardPins — bất biến kích thước trang (số query không tăng) ──
  //
  // 25 dòng đủ để trang lớn thật sự chứa nhiều item hơn trang nhỏ — tránh
  // đúng bẫy xanh-giả đã ghi ở 20-social.mjs:74.
  await assertBatched(
    h,
    h.counter,
    'boardPins: số query bất biến theo kích thước trang (5 vs 20)',
    (first) =>
      h.silent(
        `query($b:ID!,$f:Int!){ boardPins(boardId:$b, first:$f){ items{ id pin{ title } } } }`,
        { b: BOARD, f: first },
        state.T1,
      ),
    { small: 5, large: 20 },
  );

  // ─── dọn tài nguyên nội bộ của bước này ───
  h.setGroup('GQL/mut');

  // ⚠️ Unsave 10 dòng của alice TRƯỚC removeCollaborator (unsavePin đòi EDITOR).
  for (const pid of pinsForAlice) {
    await h.silent(
      `mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`,
      { p: pid, b: BOARD },
      state.T2,
    );
  }
  await gql(
    'removeCollaborator',
    `mutation($b:ID!,$u:ID!){ removeCollaborator(boardId:$b, userId:$u) }`,
    { b: BOARD, u: state.ME2 },
    { token: state.T1 },
  );

  // Unsave 15 dòng của bao
  for (const pid of pinsForBao) {
    await h.silent(
      `mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`,
      { p: pid, b: BOARD },
      state.T1,
    );
  }

  // Dọn 4 board probe
  for (const bid of extraBoards) {
    await h.silent(`mutation($id:ID!){ deleteBoard(id:$id) }`, { id: bid }, state.T1);
  }

  await gql(
    'unsavePin',
    `mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`,
    { p: state.PIN, b: BOARD },
    { token: state.T1 },
  );
  await gql('deleteSection', `mutation($id:ID!){ deleteSection(id:$id) }`, { id: SEC }, { token: state.T1 });
  await gql('deleteBoard', `mutation($id:ID!){ deleteBoard(id:$id) }`, { id: BOARD }, { token: state.T1 });

  return Boolean(BOARD);
}
