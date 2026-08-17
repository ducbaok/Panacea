// Bước 40 — Comments: query, CRUD, reply, reaction
//
// Comment bám vào `state.PIN` (bước 10 tạo). Đó là lý do `deletePin` KHÔNG nằm
// ở đây mà ở bước 90: xoá pin trước thì comment mất theo và các phép kiểm tra
// dưới đây sẽ FAIL vì thiếu dữ liệu nền chứ không phải vì code sai.

import { SEED } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';
import { API } from '../lib/client.mjs';
import { PASSWORD } from '../lib/seedrefs.mjs';

/**
 * ⚠️ SỐ NÀY PHẢI KHỚP `MAX_MENTIONS_PER_COMMENT` ở comments.service.ts. Nếu
 * đổi cap ở service mà quên đổi ở đây, phép "trần" trong nhóm GQL/mention xanh
 * giả — mọi nhánh của assert đều nói về CÙNG một con số.
 */
const MENTION_CAP = 10;

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
    // B-19 (17/08/2026) — mutation trả `Comment!` thay cho `Boolean!`, nên
    // selection set là bắt buộc: `{ toggleCommentReaction(input:$i) }` trần bị
    // GraphQL từ chối ở tầng validation.
    `mutation($i:ToggleCommentReactionInput!){ toggleCommentReaction(input:$i){ id reactionCount isReactedByViewer } }`,
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

  // ─── B-8: bóc @mention, gửi notification ────────────────────────────────
  //
  // Luồng ĐÃ có nhánh mention từ trước (comments.service.ts:createComment); B-8
  // vá 5 khiếm khuyết: chuẩn hoá hoa/thường, lọc block hai chiều, trừ chủ pin
  // / chủ comment cha, cap 10, và sửa comment cũng phải bóc lại chỉ báo người
  // MỚI. Xem docs/debug_history.md §23 để biết vì sao mỗi phép lại chọn đúng
  // pin/actor đó chứ không phải một cấu hình khác.
  h.setGroup('GQL/mention');

  const JOHN_PIN = 'pin_10_id'; // seed.ts:235 · creatorId=user_3_id (john).

  /**
   * Đếm số notification có `commentId = <chính comment vừa tạo>` — filter theo
   * commentId là hạt duy nhất phân biệt CHÍNH lần chạy này với mọi notification
   * cũ còn sót lại. Tuyệt đối KHÔNG dùng `unreadNotificationCount`: nó gộp mọi
   * loại lẫn mọi comment.
   */
  async function notifsFor(commentId, token) {
    const r = await h.silent(
      `query{ notifications(first:50){ items{ id type commentId } } }`,
      {},
      token,
    );
    return (r?.data?.notifications?.items ?? []).filter((n) => n.commentId === commentId);
  }
  const countMention = (list) => list.filter((n) => n.type === 'MENTION').length;

  // Test 1 — chuẩn hoá hoa/thường. alice comment lên pin của john ⇒ bao KHÔNG
  // là chủ pin, không bị chặn, không phải actor ⇒ MENTION đúng nghĩa. Nội dung
  // chỉ có dạng viết HOA — trước khi vá, `findMany({ username: { in: ['Bao_Developer']}})`
  // trả về rỗng và bao im lặng không nhận gì (bug 1). Đây cũng là phép mà đối
  // chứng âm dưới cuối §B-8 sẽ khu trú vào — bỏ `toLowerCase()` là con số này
  // rớt về 0.
  const cUpper = await h.silent(
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
    { i: { pinId: JOHN_PIN, content: 'probe @Bao_Developer test' } },
    state.T2,
  );
  const cUpperId = cUpper?.data?.createComment?.id;
  const upperBao = countMention(await notifsFor(cUpperId, state.T1));
  h.assert(
    '@Bao_Developer (viết HOA) ⇒ bao nhận đúng 1 MENTION (chuẩn hoá lowercase một phía trước khi tra DB)',
    upperBao === 1,
    `bao MENTION cho comment này = ${upperBao} (đúng 1) · commentId=${cUpperId}`,
  );

  // Test 2 — chặn hai chiều. bao chặn john ⇒ getBlockedUserIds(john) = [bao].
  // john comment lên pin của CHÍNH mình (excludeSet chỉ có {john}), nhắc CẢ bao
  // lẫn alice ⇒ bao mất MENTION do bị lọc block, alice vẫn nhận. Hai giá trị
  // trong CÙNG một bình luận chứng minh lọc đúng chỗ chứ không lọc sạch.
  await h.silent(`mutation($u:String!){ blockUser(userId:$u) }`, { u: state.ME3 }, state.T1);
  const cBlk = await h.silent(
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
    { i: { pinId: JOHN_PIN, content: 'blocked probe @bao_developer @alice_chef' } },
    state.T3,
  );
  const cBlkId = cBlk?.data?.createComment?.id;
  const baoBlk = countMention(await notifsFor(cBlkId, state.T1));
  const aliceBlk = countMention(await notifsFor(cBlkId, state.T2));
  h.assert(
    'chặn 2 chiều: bao (bị chặn) mất MENTION, alice (không bị chặn) vẫn nhận — trong CÙNG một bình luận',
    baoBlk === 0 && aliceBlk === 1,
    `bao=${baoBlk} (đúng 0) · alice=${aliceBlk} (đúng 1)`,
  );
  await h.silent(`mutation($u:String!){ unblockUser(userId:$u) }`, { u: state.ME3 }, state.T1);
  // `blockUser` xoá follow HAI CHIỀU vĩnh viễn (social.service.ts:104), unblock
  // KHÔNG khôi phục — dựng lại đây để bước 65 và các bước sau còn nguyên tiền
  // đề mutual follow bao↔john như seed. Xem cùng khuôn ở 65-blocking.mjs.
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: state.ME3 }, state.T1);
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: state.ME }, state.T3);

  // Test 3 — trùng chủ pin. alice comment lên state.PIN (chủ = bao) và nhắc
  // @bao_developer. Nếu KHÔNG trừ pin.creatorId khỏi danh sách mention thì bao
  // nhận CẢ COMMENT lẫn MENTION cho MỘT hành động. Đo tổng notification cho
  // commentId ⇒ đúng 1 (COMMENT), MENTION = 0.
  const cDup = await h.silent(
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
    { i: { pinId: state.PIN, content: 'dup probe @bao_developer' } },
    state.T2,
  );
  const cDupId = cDup?.data?.createComment?.id;
  const dupList = await notifsFor(cDupId, state.T1);
  h.assert(
    'nhắc trúng chủ pin ⇒ họ nhận ĐÚNG 1 notification (COMMENT), không cộng thêm MENTION',
    dupList.length === 1 && countMention(dupList) === 0,
    `bao tổng cho comment này = ${dupList.length} (đúng 1) · trong đó MENTION = ${countMention(dupList)} (đúng 0)`,
  );

  // Test 4 — trần MENTION_CAP mention/comment. Seed chỉ có 5 user nên đăng ký
  // N=MENTION_CAP+2 tài khoản dùng-một-lần ⇒ đủ N unique @s hợp lệ để chứng
  // minh cap cắt phần thừa. Song song hoá đăng ký và query notifications để
  // tổng thời gian test này gần bằng một cặp round-trip chứ không phải N cặp.
  const N = MENTION_CAP + 2;
  const menteeUsers = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      // `_generateUsername` băm về `[^a-z0-9]` ⇒ trước khi gửi phải chắc rằng
      // `name` sau khi băm còn ≥ 3 ký tự (regex mention). `state.uniq` là base36
      // ≥ 6 chữ số, cộng chỉ số i ⇒ luôn ≥ 7 ký tự sạch.
      const name = `mt${state.uniq}${i}`;
      const email = `${name}@example.com`;
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, name }),
      });
      const j = await r.json();
      return { email, token: j?.accessToken, username: name.toLowerCase() };
    }),
  );
  const capContent = 'cap ' + menteeUsers.map((u) => `@${u.username}`).join(' ');
  const cCap = await h.silent(
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
    { i: { pinId: JOHN_PIN, content: capContent } },
    state.T2,
  );
  const cCapId = cCap?.data?.createComment?.id;
  const capCounts = await Promise.all(
    menteeUsers.map((u) => notifsFor(cCapId, u.token).then(countMention)),
  );
  const notified = capCounts.filter((c) => c === 1).length;
  const zero = capCounts.filter((c) => c === 0).length;
  h.assert(
    `${N} mention hợp lệ ⇒ đúng ${MENTION_CAP} MENTION notification (cap cắt phần thừa, không ném lỗi)`,
    notified === MENTION_CAP && zero === N - MENTION_CAP,
    `${notified} nhận đúng 1 · ${zero} nhận 0 (cap = ${MENTION_CAP}, tổng đăng ký = ${N})`,
  );

  // Test 5 — sửa bình luận: chỉ báo người MỚI xuất hiện, KHÔNG lặp cho người
  // đã báo. Ba lần sửa liên tiếp trên CÙNG một comment: (a) thêm bao, (b) giữ
  // nguyên bao (đổi từ ngoài), (c) thêm bob. Nếu updateComment không bóc lại,
  // (a) trả bao=0. Nếu bóc lại nhưng KHÔNG hỏi `alreadyNotified`, (b) làm bao
  // tăng lên 2. Chỉ khi có ĐỦ hai nhánh mới cho ra bộ số dưới đây.
  const cUpd = await h.silent(
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
    { i: { pinId: JOHN_PIN, content: 'no mention here' } },
    state.T2,
  );
  const cUpdId = cUpd?.data?.createComment?.id;

  await h.silent(
    `mutation($i:UpdateCommentInput!){ updateComment(input:$i){ id } }`,
    { i: { id: cUpdId, content: 'edited @bao_developer' } },
    state.T2,
  );
  const bao1 = countMention(await notifsFor(cUpdId, state.T1));
  await h.silent(
    `mutation($i:UpdateCommentInput!){ updateComment(input:$i){ id } }`,
    { i: { id: cUpdId, content: 'edited @bao_developer typo fixed' } },
    state.T2,
  );
  const bao2 = countMention(await notifsFor(cUpdId, state.T1));
  await h.silent(
    `mutation($i:UpdateCommentInput!){ updateComment(input:$i){ id } }`,
    { i: { id: cUpdId, content: 'edited @bao_developer @bob_photographer' } },
    state.T2,
  );
  const bao3 = countMention(await notifsFor(cUpdId, state.T1));

  // bob không có T-token, đăng nhập tay để đọc inbox. Password chuẩn seed.
  const bobLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bob@example.com', password: PASSWORD }),
  }).then((r) => r.json());
  const bob3 = countMention(await notifsFor(cUpdId, bobLogin?.accessToken));

  h.assert(
    'sửa comment: bao nhận đúng 1 (không lặp qua nhiều lần sửa), bob nhận đúng 1 khi mới thêm',
    bao1 === 1 && bao2 === 1 && bao3 === 1 && bob3 === 1,
    `sửa#1 thêm bao: bao=${bao1} (đúng 1) · sửa#2 giữ nguyên: bao=${bao2} (đúng 1, không lặp) · sửa#3 thêm bob: bao=${bao3} (đúng 1) bob=${bob3} (đúng 1)`,
  );

  // Dọn: xoá 4 comment của bước này (mỗi comment do đúng người tạo mới xoá được),
  // rồi song song deleteAccount cho N mentee ⇒ cascade xoá luôn `mtCap` và mọi
  // notification/comment của họ. KHÔNG dùng gql (ghi bản ghi) — mọi thao tác dọn
  // là h.silent để không đẻ ra phép kiểm giả.
  await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: cUpperId }, state.T2);
  await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: cBlkId }, state.T3);
  await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: cDupId }, state.T2);
  await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: cUpdId }, state.T2);
  await Promise.all(menteeUsers.map((u) => h.silent(`mutation{ deleteAccount }`, {}, u.token)));

  return Boolean(CMT);
}
