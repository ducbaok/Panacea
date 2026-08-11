// Bước 50 — Messages: conversations, DM, rò rỉ DM
//
// TIỀN ĐỀ: mutual follow bao↔alice, do bước 20 dựng. DM chỉ mở khi mutual
// follow (quyết định nghiệp vụ đã chốt — PLAN_PHASE_2.md). Nếu bước 20 chạy
// `blockUser` SAU khi dựng follow thì quan hệ bị xoá cả hai chiều và
// `createConversation` dưới đây sẽ chết — xem khối ghi chú ở đầu 20-social.mjs.
//
// P1 Đợt 2 (11/08/2026) — mở rộng:
//   • Tạo bao↔jane + bao↔john (seed đã mutual cả hai) ⇒ 3 hội thoại.
//   • Gửi 7 tin vào một hội thoại.
//   • Phép QUYẾT ĐỊNH của Đợt 2 §3c: giải mã `endCursor` phải ra `updatedAt`,
//     KHÔNG PHẢI `createdAt` (bug hiện tại encode nhầm cột). Đây là lô DUY
//     NHẤT có đỏ-trước thật đo được qua API.
//   • Phép "3 trang gộp == 1 trang lớn" cho conversations và messages.
//   • Gửi 1 tin giữa trang 1 và trang 2 để ghi lại hành vi (kỳ vọng: có thể
//     thấy trùng — đó là ĐÚNG UX inbox, khoá mutable, KHÔNG được ghi FAIL).
//
// ⚠️ Hội thoại và tin nhắn TỒN TẠI XUYÊN CÁC LẦN CHẠY (bước này chỉ xoá MSG,
// không xoá hội thoại). ⇒ CẤM khẳng định số tuyệt đối, chỉ khẳng định tập
// bằng tập. Cùng lý do 65-blocking.mjs không thể chốt "còn N bản ghi".

import { login } from '../lib/client.mjs';
import { USERS, PASSWORD } from '../lib/seedrefs.mjs';

// Giải mã endCursor (base64(ISO|id)) — dùng để chứng minh cursor mã hoá cột
// nào. Đây là bằng chứng của Đợt 2 §3c: trước sửa = createdAt, sau sửa = updatedAt.
function decodeCursor(b64) {
  const raw = Buffer.from(b64, 'base64').toString('utf-8');
  const [iso, id] = raw.split('|');
  return { iso, id, date: new Date(iso.endsWith('Z') ? iso : iso + 'Z') };
}
const setEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/query');
  await gql(
    'conversations',
    `query($f:Int!){ conversations(first:$f){ items{ id members{ userId } } pageInfo{ endCursor } } }`,
    { f: 5 },
    { token: state.T1 },
  );

  h.setGroup('GQL/mut');
  // john chưa mutual với alice ⇒ phải bị chặn. Đây là phép kiểm tra chứng minh
  // luật mutual-follow thật sự có hiệu lực, không phải chỉ có trong tài liệu.
  await gql(
    'createConversation (john, chưa mutual → phải chặn)',
    `mutation($u:String!){ createConversation(userId:$u){ id } }`,
    { u: state.ME2 },
    { token: state.T3, expect: /Mutual follow is required/ },
  );

  const cv = await gql(
    'createConversation (mutual)',
    `mutation($u:String!){ createConversation(userId:$u){ id members{ userId } } }`,
    { u: state.ME2 },
    { token: state.T1 },
  );
  const CONV = cv?.createConversation?.id;

  const sm = await gql(
    'sendMessage',
    `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id content sender{ username } } }`,
    { i: { conversationId: CONV, content: 'probe message' } },
    { token: state.T1 },
  );
  const MSG = sm?.sendMessage?.id;

  h.setGroup('GQL/query');
  await gql(
    'messages',
    `query($c:String!,$f:Int!){ messages(conversationId:$c, first:$f){ items{ id content sender{ username } } pageInfo{ endCursor } } }`,
    { c: CONV, f: 5 },
    { token: state.T1 },
  );

  // Lỗ rò rỉ DM cũ sinh ra vì filter so `variables.conversationId` với chính nó
  // — tức là kiểm tra bằng chính thứ client gửi lên. Xem AGENT_HANDOFF.md §3.5.
  h.setGroup('GQL/security');
  await gql(
    'messages của hội thoại người khác → phải chặn',
    `query($c:String!,$f:Int!){ messages(conversationId:$c, first:$f){ items{ id content } } }`,
    { c: CONV, f: 5 },
    { token: state.T3, expect: /Not a member of this conversation/ },
  );

  h.setGroup('GQL/mut');
  await gql('markMessageRead', `mutation($m:String!){ markMessageRead(messageId:$m) }`, { m: MSG }, { token: state.T2 });
  await gql('deleteMessage', `mutation($m:String!){ deleteMessage(messageId:$m) }`, { m: MSG }, { token: state.T1 });

  // ─── P1 Đợt 2 §3c — QUYẾT ĐỊNH: endCursor phải mã hoá updatedAt, không createdAt ───
  //
  // sendMessage cập nhật conversation.updatedAt trong CÙNG transaction
  // (messages.service.ts:167) ⇒ sau khi gửi 1 tin thì updatedAt > createdAt.
  // Trước sửa: encodeCursor(convos[…].createdAt, …) ⇒ endCursor.iso = createdAt.
  // Sau sửa:                                           endCursor.iso = updatedAt.
  h.setGroup('GQL/pagination');

  // 1) Dựng 3 hội thoại nếu chưa có (bao mutual với jane/john/alice từ seed + bước 20).
  //    createConversation là idempotent — có sẵn thì trả về conversation cũ.
  await h.silent(
    `mutation($u:String!){ createConversation(userId:$u){ id } }`,
    { u: 'user_2_id' },
    state.T1,
  );
  await h.silent(
    `mutation($u:String!){ createConversation(userId:$u){ id } }`,
    { u: 'user_3_id' },
    state.T1,
  );

  // 2) Gửi 1 tin vào hội thoại đầu để chắc chắn updatedAt > createdAt.
  const first1 = await h.silent(
    `query{ conversations(first:1){ items{ id createdAt updatedAt } pageInfo{ endCursor } } }`,
    {},
    state.T1,
  );
  const conv1 = first1?.data?.conversations?.items?.[0];
  const conv1Id = conv1?.id;

  if (conv1Id) {
    await h.silent(
      `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id } }`,
      { i: { conversationId: conv1Id, content: `bump ${state.uniq}` } },
      state.T1,
    );
  }

  // 3) Đọc lại conversations(first:1) — endCursor.iso phải == updatedAt.
  const after = await h.silent(
    `query{ conversations(first:1){ items{ id createdAt updatedAt } pageInfo{ endCursor } } }`,
    {},
    state.T1,
  );
  const cAfter = after?.data?.conversations?.items?.[0];
  const endCursor = after?.data?.conversations?.pageInfo?.endCursor;

  if (endCursor && cAfter) {
    const dec = decodeCursor(endCursor);
    // So sánh CHUẨN XÁC bằng ISO string (không cho phép tolerance) — cursor được
    // sinh bởi `date.toISOString()` nên phải khớp từng chữ với chính field mã hoá.
    // Tolerance sẽ nuốt bug khi createdAt/updatedAt cách nhau vài ms (sendMessage
    // nhanh) — đúng loại xanh-giả mà bộ này chống.
    const isoUpdated = new Date(cAfter.updatedAt).toISOString();
    const isoCreated = new Date(cAfter.createdAt).toISOString();
    const matchUpdated = dec.iso === isoUpdated;
    const matchCreated = dec.iso === isoCreated;
    const drift = new Date(cAfter.updatedAt).getTime() - new Date(cAfter.createdAt).getTime();

    h.assert(
      'QUYẾT ĐỊNH: conversations.endCursor.iso == updatedAt (KHÔNG phải createdAt) — chứng minh encode đúng cột',
      matchUpdated && !matchCreated,
      `cursor.iso=${dec.iso} · isoUpdated=${isoUpdated} · isoCreated=${isoCreated} · drift=${drift}ms · match_updated=${matchUpdated} · match_created=${matchCreated}`,
    );
  } else {
    h.rec(
      'GQL/pagination',
      'QUYẾT ĐỊNH: conversations.endCursor.iso == updatedAt',
      'FAIL',
      `endCursor=${endCursor} conv=${JSON.stringify(cAfter)}`,
    );
  }

  // 4) Phép so tập: 3 trang first=1 gộp bằng ĐÚNG 1 trang first=3 (không trùng, không thiếu, đúng thứ tự).
  //    Không chốt số tuyệt đối vì hội thoại sống xuyên các lần chạy.
  const runConvs = async (first, afterCursor) => {
    const r = await h.silent(
      `query($f:Int!,$a:String){ conversations(first:$f, after:$a){ items{ id updatedAt } pageInfo{ endCursor hasNextPage } } }`,
      { f: first, a: afterCursor ?? null },
      state.T1,
    );
    return r?.data?.conversations ?? { items: [], pageInfo: {} };
  };
  const pa = await runConvs(1, null);
  const pb = await runConvs(1, pa.pageInfo?.endCursor);
  const pc = await runConvs(1, pb.pageInfo?.endCursor);
  const pagedConvs = [...pa.items, ...pb.items, ...pc.items].map((x) => x.id);
  const bigConvs = (await runConvs(3, null)).items.map((x) => x.id);
  const convDup = new Set(pagedConvs);

  h.assert(
    'QUYẾT ĐỊNH: conversations — 3 trang first=1 gộp bằng ĐÚNG 1 trang first=3 (không trùng · không thiếu · đúng thứ tự)',
    pagedConvs.length === bigConvs.length &&
      convDup.size === pagedConvs.length &&
      setEq(pagedConvs, bigConvs),
    `paged=${pagedConvs.length} unique=${convDup.size} · big=${bigConvs.length} · setEq=${setEq(pagedConvs, bigConvs)}`,
  );

  // 5) Ghi lại hành vi "gửi 1 tin giữa trang 1 và trang 2" — CÓ THỂ THẤY TRÙNG,
  //    ĐÓ LÀ ĐÚNG (updatedAt mutable đẩy hội thoại lên đầu). Chỉ ghi log, KHÔNG assert FAIL.
  const page1 = await runConvs(1, null);
  if (conv1Id) {
    await h.silent(
      `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id } }`,
      { i: { conversationId: conv1Id, content: `bump-mid ${state.uniq}` } },
      state.T1,
    );
  }
  const page2 = await runConvs(1, page1.pageInfo?.endCursor);
  const overlap = page1.items[0]?.id && page2.items[0]?.id && page1.items[0].id === page2.items[0].id;
  h.assert(
    'gửi tin giữa 2 trang: có thể thấy trùng (khoá mutable, ĐÚNG UX inbox — KHÔNG FAIL)',
    true, // luôn OK; phần detail ghi lại hành vi thật
    `page1=${page1.items[0]?.id ?? 'null'} · page2=${page2.items[0]?.id ?? 'null'} · overlap=${overlap ? 'yes (ĐÚNG)' : 'no'}`,
  );

  // 6) messages — 4 trang first=2 gộp == 1 trang first=8.
  //    Dựng 8 tin nếu chưa đủ (idempotent: chỉ gửi thêm để có ≥8 dòng).
  if (conv1Id) {
    for (let i = 0; i < 8; i++) {
      await h.silent(
        `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id } }`,
        { i: { conversationId: conv1Id, content: `m${i} ${state.uniq}` } },
        state.T1,
      );
    }
    const runMsgs = async (first, afterCursor) => {
      const r = await h.silent(
        `query($c:String!,$f:Int!,$a:String){ messages(conversationId:$c, first:$f, after:$a){ items{ id } pageInfo{ endCursor } } }`,
        { c: conv1Id, f: first, a: afterCursor ?? null },
        state.T1,
      );
      return r?.data?.messages ?? { items: [], pageInfo: {} };
    };
    const m1 = await runMsgs(2, null);
    const m2 = await runMsgs(2, m1.pageInfo?.endCursor);
    const m3 = await runMsgs(2, m2.pageInfo?.endCursor);
    const m4 = await runMsgs(2, m3.pageInfo?.endCursor);
    const mPaged = [...m1.items, ...m2.items, ...m3.items, ...m4.items].map((x) => x.id);
    const mBig = (await runMsgs(8, null)).items.map((x) => x.id);
    const mDup = new Set(mPaged);

    h.assert(
      'QUYẾT ĐỊNH: messages — 4 trang first=2 gộp bằng ĐÚNG 1 trang first=8 (không trùng · không thiếu · đúng thứ tự)',
      mPaged.length === mBig.length &&
        mDup.size === mPaged.length &&
        setEq(mPaged, mBig),
      `paged=${mPaged.length} unique=${mDup.size} · big=${mBig.length} · setEq=${setEq(mPaged, mBig)}`,
    );
  }

  return Boolean(CONV && MSG);
}
