// Bước 20 — Social: userByUsername, followers/following, block/unblock, follow
//
// ⚠️ THỨ TỰ TRONG BƯỚC NÀY LÀ HỢP ĐỒNG, KHÔNG PHẢI SỞ THÍCH.
//
// `blockUser` xoá quan hệ follow CẢ HAI CHIỀU (social.service.ts:104) — đó là
// hành vi đúng và có chủ đích. Nhưng nó đặt ra một ràng buộc cho bộ verify:
// bước 50 cần mutual follow bao↔alice còn sống thì `createConversation` mới
// chạy được ("Mutual follow is required to send Direct Messages").
//
// Bản gốc `verify2.mjs` tuyến tính nên né được: khối block nằm SAU phần
// messages. Khi cắt thành từng bước thì thứ tự đó biến mất, nên phải dựng lại
// tường minh ở đây:
//
//        block → unblock → RỒI MỚI follow ×2
//
// Đảo lại (follow trước, block sau) thì bước 20 vẫn xanh trọn vẹn, và bước 50
// mới chết — cách xa nguyên nhân, rất tốn công truy.

import { USERS, PASSWORD } from '../lib/seedrefs.mjs';
import { login } from '../lib/client.mjs';
import { assertBatched } from '../lib/query-count.mjs';

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/query');

  await gql(
    'userByUsername',
    `query($u:String!){ userByUsername(username:$u){ id username isFollowedByViewer isFollowingViewer } }`,
    { u: USERS.alice.username },
    { token: state.T1 },
  );
  await gql(
    'followers',
    `query($u:String!,$f:Int!){ followers(userId:$u, first:$f){ items{ id username } pageInfo{ endCursor } } }`,
    { u: state.ME, f: 5 },
    { token: state.T1 },
  );
  await gql(
    'following',
    `query($u:String!,$f:Int!){ following(userId:$u, first:$f){ items{ id username } pageInfo{ endCursor } } }`,
    { u: state.ME, f: 5 },
    { token: state.T1 },
  );

  h.setGroup('GQL/mut');

  // Block TRƯỚC — xem khối ghi chú đầu file.
  await gql('blockUser', `mutation($u:String!){ blockUser(userId:$u) }`, { u: state.ME2 }, { token: state.T1 });
  await gql('unblockUser', `mutation($u:String!){ unblockUser(userId:$u) }`, { u: state.ME2 }, { token: state.T1 });

  // Reset quan hệ follow trước khi dựng lại: `follow()` cố ý từ chối trùng
  // ("Already following this user") và seed có thể đã có sẵn quan hệ này.
  // Dùng silent() vì việc dọn thất bại KHÔNG phải một phép kiểm tra hỏng.
  await h.silent(`mutation($u:String!){ unfollow(userId:$u) }`, { u: state.ME2 }, state.T1);
  await h.silent(`mutation($u:String!){ unfollow(userId:$u) }`, { u: state.ME }, state.T2);

  const f1 = await gql('follow (bao→alice)', `mutation($u:String!){ follow(userId:$u) }`, { u: state.ME2 }, { token: state.T1 });
  const f2 = await gql('follow (alice→bao)', `mutation($u:String!){ follow(userId:$u) }`, { u: state.ME }, { token: state.T2 });

  // Mutual follow là tiền đề cứng của bước 50. Không có nó thì mọi phép kiểm
  // tra DM sẽ FAIL vì thiếu dữ liệu nền, chứ không phải vì code sai.
  state.mutualFollow = Boolean(f1?.follow && f2?.follow);

  // ─── Đợt 3b: bằng chứng buildIsFollowedByLoader THẬT SỰ batch ───────────────
  //
  // ĐẶT Ở `followers`, KHÔNG PHẢI `exploreFeed`. `followers` đã có
  // GqlOptionalAuthGuard (social.resolver.ts:93) nên `@CurrentUser()` có thật và
  // loader chạy thật. `exploreFeed` chưa có guard (tới Đợt 3a) ⇒ resolve field
  // thoát sớm ở `if (!viewer) return false` và KHÔNG chạm loader — probe đặt ở
  // đó sẽ XANH GIẢ.
  //
  // ⚠️ KÍCH THƯỚC TRANG LÀ 1 vs 4, KHÔNG PHẢI 5 vs 20 NHƯ CÁC PROBE KHÁC.
  // Seed chỉ có 5 user (seed.ts:82) nên bao nhiều nhất có 4 follower. Gọi
  // first=5 rồi first=20 sẽ trả về CÙNG 4 dòng đó ⇒ Δ=0 kể cả khi loader còn
  // N+1 — đúng cái bẫy xanh-giả vừa nói ở trên, chỉ đổi chỗ. Phép đo chỉ có
  // nghĩa khi trang lớn thật sự chứa nhiều item hơn trang nhỏ.
  //
  // Biên phân giải: 3 item chênh × 2 resolve field = Δ≈6 khi còn N+1, so với
  // tolerance 2 và Δ=0 khi đã memo.
  h.setGroup('GQL/perf');

  // Dựng đủ 4 follower cho bao. Seed đã có jane→bao, john→bao; alice→bao vừa
  // tạo ở trên. Còn thiếu bob. silent() vì "đã follow rồi" khi chạy lại mà
  // chưa reseed KHÔNG phải một phép kiểm tra hỏng.
  const T5 = await login(USERS.bob.email, PASSWORD);
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: state.ME }, T5);

  const FOLLOWERS_Q = `query($u:String!,$f:Int!){ followers(userId:$u, first:$f){ items{ id username isFollowedByViewer isFollowingViewer } } }`;

  await assertBatched(
    h,
    h.counter,
    'followers: số query bất biến theo kích thước trang (isFollowedByViewer/isFollowingViewer)',
    (first) => h.silent(FOLLOWERS_Q, { u: state.ME, f: first }, state.T1),
    { small: 1, large: 4 },
  );

  // Phép kiểm ĐÚNG ĐẮN, tách hẳn khỏi phép đo hiệu năng ở trên: batch sai vẫn
  // trả đúng giá trị, nên hai thứ này không thay thế được cho nhau. Ngược lại,
  // batch đúng mà gom nhầm key thì mọi item sẽ nhận CÙNG một giá trị — chỉ có
  // phép kiểm này bắt được, và nó phải thấy cả `true` lẫn `false` TRONG CÙNG
  // MỘT response mới loại trừ được khả năng đó.
  //
  // Dữ liệu: bao follow lại jane/john/alice nhưng KHÔNG follow bob, trong khi
  // cả 4 đều follow bao ⇒ isFollowedByViewer phải lẫn true/false, còn
  // isFollowingViewer phải toàn true (định nghĩa của "người follow bao").
  const corr = await h.silent(FOLLOWERS_Q, { u: state.ME, f: 10 }, state.T1);
  const items = corr?.data?.followers?.items ?? [];
  const bob = items.find((i) => i.username === USERS.bob.username);
  const others = items.filter((i) => i.username !== USERS.bob.username);

  h.assert(
    'isFollowedByViewer phân biệt đúng từng người trong cùng một response',
    items.length >= 2 &&
      bob?.isFollowedByViewer === false &&
      others.length > 0 &&
      others.every((i) => i.isFollowedByViewer === true) &&
      items.every((i) => i.isFollowingViewer === true),
    `${items.length} follower — ` +
      (items.map((i) => `${i.username}:followedBy=${i.isFollowedByViewer},following=${i.isFollowingViewer}`).join(' · ') ||
        'không có dữ liệu'),
  );

  return state.mutualFollow;
}
