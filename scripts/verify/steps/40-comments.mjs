// Bước 40 — Comments: query, CRUD, reply, reaction
//
// Comment bám vào `state.PIN` (bước 10 tạo). Đó là lý do `deletePin` KHÔNG nằm
// ở đây mà ở bước 90: xoá pin trước thì comment mất theo và các phép kiểm tra
// dưới đây sẽ FAIL vì thiếu dữ liệu nền chứ không phải vì code sai.

import { SEED } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';

/**
 * Selection dùng chung cho mọi phép kiểm của Đợt 4 — cả 3 field trong MỘT
 * response, để mọi khẳng định bên dưới nói về cùng một lần đọc dữ liệu.
 */
const C4 = `query($p:String!,$f:Int!){ pinComments(pinId:$p, first:$f){ items{ id replyCount reactionCount isReactedByViewer } } }`;

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/query');

  await gql(
    'pinComments',
    `query($p:String!,$f:Int!){ pinComments(pinId:$p, first:$f){ items{ id content user{ username } replyCount isReactedByViewer } pageInfo{ endCursor } } }`,
    { p: SEED.pinId, f: 5 },
    { token: state.T1 },
  );
  await gql(
    'commentReplies',
    `query($c:String!,$f:Int!){ commentReplies(commentId:$c, first:$f){ items{ id content } pageInfo{ endCursor } } }`,
    { c: SEED.commentId, f: 5 },
    { token: state.T1 },
  );

  // ─── Đợt 4: replyCount đối chiếu với SỰ THẬT SEED ──────────────────────────
  //
  // VÌ SAO PHÉP KIỂM NÀY TỒN TẠI: query ngay trên ĐÃ chọn `replyCount` từ trước
  // Đợt 4, và nó xanh suốt nhiều ngày trong khi thân hàm là `return 0` — vì
  // `h.gql()` chỉ ghi OK khi không có `errors`, mà `0` là Int hợp lệ. Chọn field
  // không chứng minh được gì; phải KHẲNG ĐỊNH GIÁ TRỊ (§13).
  //
  // Hai comment gốc của `pin_1_id` có replyCount khác nhau (2 và 0) nên một
  // response chứa cả hai nhánh ⇒ loại trừ luôn kiểu hỏng "loader gán chung một
  // giá trị cho mọi item". Xem seedrefs.mjs để biết vì sao chọn đúng hai cái này.
  h.setGroup('GQL/comment-fields');
  const seedRes = await h.silent(C4, { p: SEED.pinId, f: 20 }, state.T1);
  const seedItems = seedRes?.data?.pinComments?.items ?? [];
  const cTwo = seedItems.find((i) => i.id === SEED.commentWithTwoReplies);
  const cZero = seedItems.find((i) => i.id === SEED.commentWithNoReply);
  h.assert(
    'replyCount đúng theo seed, phân biệt được từng comment trong cùng một response',
    seedItems.length === 2 && cTwo?.replyCount === 2 && cZero?.replyCount === 0,
    `${SEED.commentWithTwoReplies}=${cTwo?.replyCount} (đúng 2) · ${SEED.commentWithNoReply}=${cZero?.replyCount} (đúng 0) · ${seedItems.length} comment gốc`,
  );

  h.setGroup('GQL/mut');

  // alice comment lên pin của bao — cần khác chủ pin để phép kiểm tra phân
  // quyền bên dưới có nghĩa.
  const cc = await gql(
    'createComment',
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id content user{ username } } }`,
    { i: { pinId: state.PIN, content: 'probe comment' } },
    { token: state.T2 },
  );
  const CMT = cc?.createComment?.id;

  const cr = await gql(
    'createComment (reply)',
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id parentId } }`,
    { i: { pinId: state.PIN, content: 'probe reply', parentId: CMT } },
    { token: state.T1 },
  );
  const RPL = cr?.createComment?.id;

  await gql(
    'updateComment',
    `mutation($i:UpdateCommentInput!){ updateComment(input:$i){ id content } }`,
    { i: { id: CMT, content: 'probe comment edited' } },
    { token: state.T2 },
  );
  await gql(
    'updateComment (không phải chủ → chặn)',
    `mutation($i:UpdateCommentInput!){ updateComment(input:$i){ id } }`,
    { i: { id: CMT, content: 'hacked' } },
    { token: state.T3, expect: /Not authorized/ },
  );
  await gql(
    'toggleCommentReaction',
    `mutation($i:ToggleCommentReactionInput!){ toggleCommentReaction(input:$i) }`,
    { i: { commentId: CMT, type: 'HEART' } },
    { token: state.T1 },
  );

  h.setGroup('GQL/query');
  await gql(
    'commentReplies (reply vừa tạo)',
    `query($c:String!,$f:Int!){ commentReplies(commentId:$c, first:$f){ items{ id content } } }`,
    { c: CMT, f: 5 },
    { token: state.T1 },
  );

  // ─── Đợt 4: nửa reaction — phải TỰ DỰNG trạng thái ────────────────────────
  //
  // Khác hẳn nửa `replyCount` ngay trên: seed KHÔNG tạo bản ghi `CommentReaction`
  // nào (`seed.ts:36` chỉ deleteMany lúc dọn), nên không có sự thật nền cố định
  // để đối chiếu. Trạng thái vừa dựng xong ở ngay trên: `CMT` có 1 reply (`RPL`
  // của bao) và 1 reaction HEART (cũng của bao).
  h.setGroup('GQL/comment-fields');
  const asBao = await h.silent(C4, { p: state.PIN, f: 20 }, state.T1);
  const asAlice = await h.silent(C4, { p: state.PIN, f: 20 }, state.T2);
  const mBao = (asBao?.data?.pinComments?.items ?? []).find((i) => i.id === CMT);
  const mAlice = (asAlice?.data?.pinComments?.items ?? []).find((i) => i.id === CMT);

  h.assert(
    'replyCount=1 và reactionCount=1 ngay sau khi tạo reply + thả reaction',
    mBao?.replyCount === 1 && mBao?.reactionCount === 1,
    `replyCount=${mBao?.replyCount} reactionCount=${mBao?.reactionCount}`,
  );

  // Cùng MỘT comment, hai viewer: cờ phải khác nhau, số đếm phải giống nhau.
  // Đây là phép bắt lỗi loader dùng nhầm viewer — kiểu hỏng mà một phép kiểm
  // chỉ dùng một token không thể thấy, vì `true` cho người react là đúng cả khi
  // loader trả `true` cho tất cả mọi người.
  h.assert(
    'isReactedByViewer tách theo viewer, reactionCount thì KHÔNG (cùng một comment)',
    mBao?.isReactedByViewer === true &&
      mAlice?.isReactedByViewer === false &&
      mBao?.reactionCount === 1 &&
      mAlice?.reactionCount === 1,
    `bao: viewer=${mBao?.isReactedByViewer}/count=${mBao?.reactionCount} · alice: viewer=${mAlice?.isReactedByViewer}/count=${mAlice?.reactionCount}`,
  );

  // Khách vãng lai: `pinComments` có GqlOptionalAuthGuard nên vẫn 200; resolve
  // field thoát sớm ở `if (!user) return false`. `reactionCount` KHÔNG phụ thuộc
  // viewer nên vẫn phải đếm đúng — cặp này chứng minh lối thoát sớm chỉ tắt
  // đúng field cần tắt, không tắt lây field khác.
  const guest = await gql('pinComments (khách vãng lai, không token)', C4, { p: state.PIN, f: 20 }, {});
  const gItems = guest?.pinComments?.items ?? [];
  const gCmt = gItems.find((i) => i.id === CMT);
  h.assert(
    'khách vãng lai: isReactedByViewer toàn false, reactionCount vẫn đếm đúng',
    gItems.length > 0 && gItems.every((i) => i.isReactedByViewer === false) && gCmt?.reactionCount === 1,
    `${gItems.length} comment · reactionCount(CMT)=${gCmt?.reactionCount}`,
  );

  // ─── Đợt 4: bằng chứng 3 loader THẬT SỰ batch ─────────────────────────────
  //
  // ⚠️ KHÔNG dùng small=5/large=20 mặc định, và cũng KHÔNG dùng `pin_1_id`.
  // `pin_1_id` chỉ có 2 comment gốc nên `first=5` và `first=20` trả về CÙNG 2
  // dòng ⇒ Δ=0 kể cả khi còn N+1 (xanh giả — đúng cái bẫy đã dính ở `followers`
  // bước 20). Chọn cách DỰNG THÊM DỮ LIỆU thay vì hạ xuống 1-vs-2: 1 item chênh
  // × 3 resolve field = Δ≈3, sát tolerance 2 quá, không đủ biên phân giải.
  //
  // 7 comment gốc thêm vào `state.PIN` (đã có `CMT`) ⇒ 8 item. Biên phân giải:
  // 7 item chênh × 3 field = Δ≈21 khi còn N+1, so với Δ=0 khi batch đúng.
  // Dùng `silent` nên chúng không sinh bản ghi kiểm tra nào.
  //
  // ⚠️ Probe này KHÔNG đỏ-trước được: stub `return 0` chẳng chạm database nên
  // Δ=0 sẵn. Nó là phép kiểm CHÉO — sẽ bắt được nếu ai đó làm hỏng `perViewer`
  // hoặc thay `groupBy` bằng một query cho mỗi comment về sau.
  h.setGroup('GQL/perf');
  const filler = [];
  for (let i = 0; i < 7; i++) {
    const r = await h.silent(
      `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
      { i: { pinId: state.PIN, content: `batch probe ${i}` } },
      state.T2,
    );
    const id = r?.data?.createComment?.id;
    if (id) filler.push(id);
  }

  await assertBatched(
    h,
    h.counter,
    'pinComments: số query bất biến theo kích thước trang (replyCount + reactionCount + isReactedByViewer)',
    (first) => h.silent(C4, { p: state.PIN, f: first }, state.T1),
    { small: 1, large: 1 + filler.length },
  );

  for (const id of filler) {
    await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id }, state.T2);
  }

  // ─── dọn nội bộ: reply trước, comment cha sau ───
  h.setGroup('GQL/mut');
  await gql('deleteComment (reply)', `mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: RPL }, { token: state.T1 });

  // ─── Đợt 4: phép kiểm QUAN TRỌNG NHẤT của đợt ─────────────────────────────
  //
  // `RPL` vừa bị SOFT-delete, `CMT` thì chưa. Middleware soft-delete
  // (`prisma.service.ts:53`) chỉ chặn `findMany`/`findFirst`, KHÔNG chặn
  // `groupBy` — nên nếu `replyCountByCommentIdLoader` quên `deletedAt: null`
  // thì con số dưới đây vẫn là 1. Không có phép kiểm này thì cái bẫy đó im
  // lặng hoàn toàn: biên dịch sạch, không ném lỗi, giá trị trông vẫn hợp lý.
  h.setGroup('GQL/comment-fields');
  const afterDel = await h.silent(C4, { p: state.PIN, f: 20 }, state.T1);
  const mDel = (afterDel?.data?.pinComments?.items ?? []).find((i) => i.id === CMT);
  h.assert(
    'xoá reply ⇒ replyCount về 0 (groupBy CÓ lọc deletedAt)',
    mDel?.replyCount === 0,
    `replyCount=${mDel?.replyCount} (trước khi xoá là 1) · quên deletedAt sẽ vẫn ra 1`,
  );

  h.setGroup('GQL/mut');
  await gql('deleteComment', `mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: CMT }, { token: state.T2 });

  return Boolean(CMT);
}
