// Bước 10 — Pins: me, exploreFeed, pin, userPins, CRUD pin, reaction
//
// Tạo `state.PIN` — pin nền cho comment (bước 40) và board (bước 30).

import { assertBatched } from '../lib/query-count.mjs';
import { readApiEnv } from '../lib/client.mjs';
import { SEED, USERS, isSeedPinId } from '../lib/seedrefs.mjs';

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/query');

  const meD = await gql('me', `{ me { id email username followerCount followingCount } }`, {}, { token: state.T1 });
  state.ME = meD?.me?.id;
  const me2 = await gql('me (alice)', `{ me { id username } }`, {}, { token: state.T2 });
  state.ME2 = me2?.me?.id;
  const me3 = await h.silent(`{ me { id } }`, {}, state.T3);
  state.ME3 = me3?.data?.me?.id;

  const f1 = await gql(
    'exploreFeed',
    `query($f:Int!){ exploreFeed(first:$f){ items{ id title creator{ username } reactionCount commentCount savedCount } pageInfo{ hasNextPage endCursor } } }`,
    { f: 3 },
    { token: state.T1 },
  );
  const cur = f1?.exploreFeed?.pageInfo?.endCursor;
  const f2 = await gql(
    'exploreFeed (trang 2, keyset)',
    `query($f:Int!,$a:String){ exploreFeed(first:$f, after:$a){ items{ id } pageInfo{ endCursor } } }`,
    { f: 3, a: cur },
    { token: state.T1 },
  );

  // P0 #6 — keyset pagination KHÔNG được lặp item giữa 2 trang.
  h.setGroup('GQL/pagination');
  {
    const p1 = (f1?.exploreFeed?.items ?? []).map((x) => x.id);
    const p2 = (f2?.exploreFeed?.items ?? []).map((x) => x.id);
    const dup = p1.filter((id) => p2.includes(id));
    if (p2.length === 0) h.rec('exploreFeed không lặp item giữa 2 trang', 'OK', 'trang 2 rỗng, không có gì để lặp');
    else if (dup.length) h.rec('exploreFeed không lặp item giữa 2 trang', 'FAIL', `lặp: ${dup.join(',')}`);
    else h.rec('exploreFeed không lặp item giữa 2 trang', 'OK', `p1=[${p1}] p2=[${p2}]`);
  }
  await gql(
    'exploreFeed (cursor hỏng → 400)',
    `query($f:Int!,$a:String){ exploreFeed(first:$f, after:$a){ items{ id } } }`,
    { f: 3, a: 'not-base64!!' },
    { token: state.T1, expect: /cursor/i },
  );

  // ─── B-5: lọc exploreFeed theo categorySlug + tagName ─────────────────────
  //
  // Thêm HAI tham số TUỲ CHỌN vào `exploreFeed` (giữ nguyên chữ ký cũ). Chi
  // tiết ở docs/debug_history.md §23. Phép QUAN TRỌNG NHẤT của nhóm này là
  // hồi quy id-đối-id: nếu tham số tuỳ chọn vô tình đổi hành vi cũ (ví dụ
  // WHERE bị ép sang OR do thiếu ngoặc quanh EXISTS), tất cả code cũ đi qua
  // `exploreFeed` KHÔNG tham số sẽ lệch đúng theo kiểu không có gì ném lỗi.
  h.setGroup('GQL/explore-filter');

  // Sự thật nền: chụp trước khi bất kỳ mutation nào của step 10 chạy — bao
  // chưa chặn ai, chưa tạo pin mới, chưa lưu thêm. Nếu dời phép này xuống sau
  // `createPin` thì baseline chứa cả pin mới và mất ý nghĩa "trước ↔ sau".
  const baseSnap = await h.silent(
    `query{ exploreFeed(first:20){ items{ id } } }`,
    {},
    state.T1,
  );
  const baseIds = (baseSnap?.data?.exploreFeed?.items ?? []).map((x) => x.id);

  const paramFeed = await gql(
    'exploreFeed không tham số ⇒ giữ nguyên tập id + thứ tự (hồi quy id-đối-id)',
    `query{ exploreFeed(first:20){ items{ id } } }`,
    {},
    { token: state.T1 },
  );
  const paramIds = (paramFeed?.exploreFeed?.items ?? []).map((x) => x.id);
  h.assert(
    'hồi quy exploreFeed không tham số: TỪNG id + thứ tự khớp baseline',
    baseIds.length === paramIds.length && baseIds.every((id, i) => id === paramIds[i]),
    `baseline=${baseIds.length} pin · paramFeed=${paramIds.length} pin · trùng khớp theo thứ tự=${baseIds.every((id, i) => id === paramIds[i])}`,
  );

  // HAI NHÁNH TRONG CÙNG MỘT LẦN CHẠY: `travel` có pin, `nature` không. Đối
  // chiếu `pin { categories { slug } }` trong cùng response chứng minh lọc đo
  // đúng ĐẶC ĐIỂM chứ không phải "trả về gì đó cỡ đúng".
  const travelFeed = await gql(
    'exploreFeed categorySlug:"travel" ⇒ chỉ pin thuộc category travel',
    `query{ exploreFeed(first:20, categorySlug:"travel"){ items{ id creator{ id } categories{ slug } } } }`,
    {},
    { token: state.T1 },
  );
  const travelItems = travelFeed?.exploreFeed?.items ?? [];
  h.assert(
    'travel: >0 pin và MỌI pin đều mang slug "travel" (đọc trong cùng response)',
    travelItems.length > 0 &&
      travelItems.every((p) => p.categories.some((c) => c.slug === 'travel')),
    `${travelItems.length} pin · slug quan sát: ${[...new Set(travelItems.flatMap((p) => p.categories.map((c) => c.slug)))].join(',')}`,
  );

  const emptyCatFeed = await gql(
    'exploreFeed categorySlug:"nature" (category tồn tại nhưng rỗng) ⇒ 0 pin, KHÔNG ném lỗi',
    `query{ exploreFeed(first:20, categorySlug:"nature"){ items{ id } } }`,
    {},
    { token: state.T1 },
  );
  h.assert(
    'nature rỗng: 0 pin, không lỗi (nhánh empty của filter phải im lặng, không 500)',
    (emptyCatFeed?.exploreFeed?.items?.length ?? -1) === 0,
    `${emptyCatFeed?.exploreFeed?.items?.length ?? 'no items key'} pin`,
  );

  // TAG: 'modern' — seed gắn cho pin_2/3/6/7 (mảng `TAG_RULES` ở seed.ts).
  const tagFeed = await gql(
    'exploreFeed tagName:"modern" ⇒ tập pin đúng bằng tập pin mang tag "modern"',
    `query{ exploreFeed(first:20, tagName:"modern"){ items{ id tags{ name } } } }`,
    {},
    { token: state.T1 },
  );
  const tagItems = tagFeed?.exploreFeed?.items ?? [];
  h.assert(
    'modern: >0 pin và MỌI pin đều mang tag "modern" (đối chiếu nội dung, không chỉ "có kết quả")',
    tagItems.length > 0 && tagItems.every((p) => p.tags.some((t) => t.name === 'modern')),
    `${tagItems.length} pin · tag quan sát: ${[...new Set(tagItems.flatMap((p) => p.tags.map((t) => t.name)))].join(',')}`,
  );

  // SLUG KHÔNG TỒN TẠI: không ném lỗi. Filter không nên validate cứng ở tầng
  // nghiệp vụ vì slug hợp lệ có thể "biến mất" giữa hai lần deploy tài liệu.
  await gql(
    'exploreFeed categorySlug không tồn tại ⇒ 0 pin, không lỗi',
    `query{ exploreFeed(first:20, categorySlug:"khong-co-that"){ items{ id } } }`,
    {},
    { token: state.T1 },
  );

  // CHẶN VẪN HIỆU LỰC dưới lọc chủ đề. Chọn `tagName:"outdoor"` vì đó là tag
  // DUY NHẤT trong seed có pin của NHIỀU CHỦ (pin_9/11/12 của john + pin_17/18
  // của bob) — dùng `travel` không được: 100% pin travel thuộc john nên block
  // xoá sạch và phép chẳng khẳng định điều gì (0=0 vẫn đúng). Ở đây khối bob
  // phải CÒN NGUYÊN thì mới phân biệt được "lọc cộng hợp" với "lọc thay thế".
  const beforeOut = await h.silent(
    `query{ exploreFeed(first:20, tagName:"outdoor"){ items{ id creator{ id } } } }`,
    {},
    state.T1,
  );
  const beforeOutItems = beforeOut?.data?.exploreFeed?.items ?? [];
  const johnBefore = beforeOutItems.filter((p) => p.creator.id === state.ME3).length;

  await h.silent(`mutation($u:String!){ blockUser(userId:$u) }`, { u: state.ME3 }, state.T1);
  const blockedOut = await gql(
    'exploreFeed tagName:"outdoor" khi bao chặn john ⇒ pin của john mất, pin của bob còn nguyên',
    `query{ exploreFeed(first:20, tagName:"outdoor"){ items{ id creator{ id } } } }`,
    {},
    { token: state.T1 },
  );
  const afterOutItems = blockedOut?.exploreFeed?.items ?? [];
  h.assert(
    'chặn 2 chiều + tag filter: pin của john biến mất, pin của người khác còn nguyên (bộ lọc cộng hợp, không thay thế)',
    johnBefore > 0 &&
      afterOutItems.length > 0 &&
      afterOutItems.every((p) => p.creator.id !== state.ME3) &&
      afterOutItems.length === beforeOutItems.length - johnBefore,
    `trước block=${beforeOutItems.length} pin outdoor (john ${johnBefore}) · sau block=${afterOutItems.length} · john còn=${afterOutItems.filter((p) => p.creator.id === state.ME3).length}`,
  );
  await h.silent(`mutation($u:String!){ unblockUser(userId:$u) }`, { u: state.ME3 }, state.T1);
  // `blockUser` xoá follow HAI CHIỀU vĩnh viễn; dựng lại theo cùng khuôn ở
  // 65-blocking / 40-comments (mutual bao↔john nằm trong tiền đề seed).
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: state.ME3 }, state.T1);
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: state.ME }, state.T3);

  // PHÂN TRANG cùng filter: `first:2` lần lượt qua N trang cho tới hasNextPage=
  // false, gộp lại phải BẰNG ĐÚNG tập first:20 travel (không trùng, không thiếu,
  // và cùng thứ tự — cursor lệch mà tổng vẫn bằng thì permutation ⇒ vẫn đỏ).
  {
    let cursor = null;
    let hasNext = true;
    const gathered = [];
    for (let page = 0; page < 25 && hasNext; page++) {
      const r = await h.silent(
        `query($a:String){ exploreFeed(first:2, after:$a, categorySlug:"travel"){ items{ id } pageInfo{ hasNextPage endCursor } } }`,
        { a: cursor },
        state.T1,
      );
      const ef = r?.data?.exploreFeed;
      gathered.push(...(ef?.items ?? []).map((x) => x.id));
      hasNext = ef?.pageInfo?.hasNextPage ?? false;
      cursor = ef?.pageInfo?.endCursor ?? null;
    }
    const fullTravel = travelItems.map((x) => x.id);
    h.assert(
      'phân trang first:2 với cùng categorySlug: id gộp = first:20 travel (không trùng · không thiếu · đúng thứ tự)',
      gathered.length === new Set(gathered).size &&
        gathered.length === fullTravel.length &&
        gathered.every((id, i) => id === fullTravel[i]),
      `gộp=${gathered.length} pin · full=${fullTravel.length} pin · duy nhất=${new Set(gathered).size} · trùng khớp theo thứ tự=${gathered.length === fullTravel.length && gathered.every((id, i) => id === fullTravel[i])}`,
    );
  }

  h.setGroup('GQL/query');
  state.seedPin = f1?.exploreFeed?.items?.[0]?.id;
  await gql(
    'pin',
    `query($id:ID!){ pin(id:$id){ id title creator{ id username } reactionCount commentCount } }`,
    { id: state.seedPin },
    { token: state.T1 },
  );
  await gql(
    'userPins',
    `query($u:ID!,$f:Int!){ userPins(userId:$u, first:$f){ items{ id title } pageInfo{ endCursor } } }`,
    { u: state.ME, f: 5 },
    { token: state.T1 },
  );

  // ─── Đợt 3a — guard optional làm 3 query Pins BIẾT viewer ───
  //
  // Trước 05/08/2026 cả `pin`/`exploreFeed`/`userPins` đều KHÔNG có
  // `@UseGuards`, nên `@CurrentUser()` trong mọi `@ResolveField` chạy dưới
  // chúng luôn `null` ⇒ `User.isFollowedByViewer` (users.resolver.ts) trả
  // `false` cho MỌI creator dù token hợp lệ. Bug này biên dịch sạch, không ném
  // lỗi, và mọi phép kiểm tra "field có trả về giá trị không" đều xanh — đúng
  // hình dạng "build xanh, luôn trả false".
  //
  // Guard có hiệu lực cho TOÀN BỘ request chứ không riêng method gắn nó, nên
  // một dòng ở PinsResolver sửa được field nằm ở UsersResolver.
  h.setGroup('GQL/viewer-aware');

  const FEED_VIEWER_Q = `query($f:Int!){ exploreFeed(first:$f){ items{ id creator{ id username isFollowedByViewer } } } }`;
  const PIN_VIEWER_Q = `query($id:ID!){ pin(id:$id){ id creator{ id username isFollowedByViewer } } }`;
  const USERPINS_VIEWER_Q = `query($u:ID!,$f:Int!){ userPins(userId:$u, first:$f){ items{ id creator{ id username isFollowedByViewer } } } }`;

  // Sự thật nền lấy từ `following` — query này đã có guard optional từ trước
  // (social.resolver.ts), nên nó là nguồn ĐỘC LẬP với thứ đang bị kiểm tra.
  // Không hardcode "bao follow jane/john" vì chạy lại mà chưa reseed sẽ có
  // thêm bao→alice do bước 20 tạo; phép kiểm tra phải đúng ở cả hai trường hợp.
  const flw = await h.silent(`query($u:String!){ following(userId:$u, first:50){ items{ id } } }`, { u: state.ME }, state.T1);
  const followedIds = new Set((flw?.data?.following?.items ?? []).map((x) => x.id));

  const feedAuth = await h.silent(FEED_VIEWER_Q, { f: 20 }, state.T1);
  const authItems = feedAuth?.data?.exploreFeed?.items ?? [];
  const authCreators = new Map(authItems.map((i) => [i.creator.id, i.creator]));

  // BẰNG CHỨNG CHÍNH của Đợt 3a. `first:20` chứ không phải `first:5`: seed có
  // 20 pin chia đều 5 user nên chỉ trang 20 mới chắc chắn gặp đủ 5 creator,
  // tức chắc chắn lẫn cả `true` lẫn `false`.
  //
  // Đối chiếu TỪNG creator với `followedIds` chứ không chỉ đếm "có true không":
  // loader gom nhầm key sẽ gán CÙNG một giá trị cho mọi item, và chỉ phép so
  // từng người mới bắt được.
  {
    const wrong = [...authCreators.values()].filter((c) => c.isFollowedByViewer !== followedIds.has(c.id));
    const sawTrue = [...authCreators.values()].some((c) => c.isFollowedByViewer === true);
    const sawFalse = [...authCreators.values()].some((c) => c.isFollowedByViewer === false);
    h.assert(
      'exploreFeed có token: isFollowedByViewer khớp đúng từng creator, lẫn cả true lẫn false trong cùng một response',
      authCreators.size >= 2 && sawTrue && sawFalse && wrong.length === 0,
      `${authItems.length} item · ${authCreators.size} creator · ` +
        [...authCreators.values()].map((c) => `${c.username}=${c.isFollowedByViewer}`).join(' · ') +
        ` · bao follow ${followedIds.size} người` +
        (wrong.length ? ` · SAI: ${wrong.map((c) => c.username).join(',')}` : ''),
    );
  }

  // Nhánh KHÔNG token. Đây là phép kiểm tra hồi quy quan trọng nhất của đợt
  // này: gắn nhầm `GqlAuthGuard` (bản bắt buộc — cùng import từ một file, tên
  // gần giống) sẽ biến 3 query public thành 401. Không có 3 phép này thì lỗi đó
  // chỉ lộ ra ở tầng xa hơn nhiều. `gql` không truyền `expect` ⇒ lỗi 401 sẽ
  // được ghi FAIL, đúng như mong muốn.
  const anonFeed = await gql('exploreFeed (KHÔNG token → vẫn 200)', FEED_VIEWER_Q, { f: 20 }, {});
  const anonPin = await gql('pin (KHÔNG token → vẫn 200)', PIN_VIEWER_Q, { id: state.seedPin }, {});
  const anonUserPins = await gql('userPins (KHÔNG token → vẫn 200)', USERPINS_VIEWER_Q, { u: state.ME, f: 5 }, {});

  {
    const anonFlags = [
      ...(anonFeed?.exploreFeed?.items ?? []).map((i) => i.creator.isFollowedByViewer),
      ...(anonPin?.pin ? [anonPin.pin.creator.isFollowedByViewer] : []),
      ...(anonUserPins?.userPins?.items ?? []).map((i) => i.creator.isFollowedByViewer),
    ];
    h.assert(
      'khách vãng lai: isFollowedByViewer toàn false trên cả 3 query (guard optional, KHÔNG phải guard bắt buộc)',
      anonFlags.length > 0 && anonFlags.every((v) => v === false),
      `${anonFlags.length} giá trị, phân bố {${[...new Set(anonFlags)].join(',')}}`,
    );
  }

  // `pin` và `userPins` trên CÙNG một creator, hai nhánh token. Chọn creator
  // theo `followedIds` (nguồn độc lập) chứ không theo chính field đang kiểm —
  // lấy đối tượng thử bằng thước cần đo thì phép đo không chứng minh được gì.
  {
    const target = authItems.find((i) => followedIds.has(i.creator.id));
    if (!target) {
      h.rec(
        'pin/userPins: isFollowedByViewer đổi theo token trên cùng một creator',
        'FAIL',
        `không có pin nào của người bao đang follow trong exploreFeed(first:20) — bao follow ${followedIds.size} người`,
      );
    } else {
      const pinAuth = await h.silent(PIN_VIEWER_Q, { id: target.id }, state.T1);
      const pinAnon = await h.silent(PIN_VIEWER_Q, { id: target.id }, null);
      const upAuth = await h.silent(USERPINS_VIEWER_Q, { u: target.creator.id, f: 5 }, state.T1);
      const upAnon = await h.silent(USERPINS_VIEWER_Q, { u: target.creator.id, f: 5 }, null);
      const pa = pinAuth?.data?.pin?.creator?.isFollowedByViewer;
      const pn = pinAnon?.data?.pin?.creator?.isFollowedByViewer;
      const ua = upAuth?.data?.userPins?.items?.[0]?.creator?.isFollowedByViewer;
      const un = upAnon?.data?.userPins?.items?.[0]?.creator?.isFollowedByViewer;
      h.assert(
        'pin/userPins: isFollowedByViewer đổi theo token trên cùng một creator',
        pa === true && pn === false && ua === true && un === false,
        `creator=${target.creator.username} · pin: token=${pa} khách=${pn} · userPins: token=${ua} khách=${un}`,
      );
    }
  }

  // ─── Đợt 3c — isSavedByViewer + viewerReaction trên Pin ───
  //
  // Bằng chứng đỏ chụp trước khi sửa (05/08/2026): cả hai field CHƯA TỒN TẠI,
  // GraphQL trả 400 `Cannot query field "isSavedByViewer" on type "Pin"`. Đó là
  // kiểu "đỏ" yếu hơn Đợt 3a (ở đó field có thật nhưng trả sai giá trị), nên
  // phép kiểm quyết định bên dưới là GIÁ TRỊ ĐÚNG CHO TỪNG PIN, không phải
  // "field có tồn tại không".
  //
  // Đây cũng là bài học rút từ vụ Đợt 4 bị ghi nhầm ✅: `40-comments.mjs:16` có
  // select `replyCount` nhưng chỉ ghi nhận "query chạy được", mà `0` là giá trị
  // hợp lệ — nên 3 resolver `return 0` rỗng ruột sống sót qua mọi lần chạy.
  const FEED_SAVED_Q = `query($f:Int!){ exploreFeed(first:$f){ items{ id isSavedByViewer viewerReaction } } }`;
  const PIN_SAVED_Q = `query($id:ID!){ pin(id:$id){ id isSavedByViewer viewerReaction } }`;

  // ╔═══════════════════════════════════════════════════════════════════════════╗
  // ║  ĐỀ KHÁNG RESIDUE — dọn `SavedPin` ngoài seed TRƯỚC khi đo (17/08/2026)  ║
  // ║                                                                          ║
  // ║  VÌ SAO CÓ KHỐI NÀY: phép kiểm ngay bên dưới đối chiếu với bảng kỳ vọng  ║
  // ║  của seed — bao chỉ được lưu ĐÚNG một pin. Nhưng `savePin` là mutation   ║
  // ║  công khai: **một cú "Lưu nhanh" trên trình duyệt** (FE dùng chính tài   ║
  // ║  khoản bao để thử tay) là `savePin(boardId: null)`, và nó đủ làm đỏ phép ║
  // ║  kiểm này ở một pin chẳng liên quan. Đó chính xác là cái FAIL "trôi" đã   ║
  // ║  quan sát sau FE-7 (`pin_20_id`, `boardId=null`) — tái lập lại được      ║
  // ║  17/08 bằng đúng một lời gọi `savePin`, xem `docs/debug_history.md §30`. ║
  // ║                                                                          ║
  // ║  VÌ SAO DỌN CHỨ KHÔNG NỚI PHÉP KIỂM: nới ra ("miễn là pin_5 saved") sẽ   ║
  // ║  giết mất nhánh-false của phép kiểm — thứ DUY NHẤT phân biệt loader      ║
  // ║  đúng với loader gán chung một giá trị cho mọi item (bài học §13).       ║
  // ║                                                                          ║
  // ║  VÌ SAO DỌN QUA API CHỨ KHÔNG QUA SQL: bộ verify cố ý không có client    ║
  // ║  Postgres — nó là bằng chứng "API chạy được", không phải công cụ quản    ║
  // ║  trị DB. `unsavePin(pinId, boardId: null)` xoá đúng dòng không-board,     ║
  // ║  tức đúng hình dạng mà "Lưu nhanh" và các run verify đứt gánh để lại.    ║
  // ║                                                                          ║
  // ║  Việc dọn được GHI LẠI (không im lặng): residue là tín hiệu vận hành —   ║
  // ║  im lặng dọn tức là im lặng che một nguồn nhiễu đang tồn tại thật.       ║
  // ╚═══════════════════════════════════════════════════════════════════════════╝
  {
    const before = await h.silent(FEED_SAVED_Q, { f: 20 }, state.T1);
    const residue = (before?.data?.exploreFeed?.items ?? [])
      .filter((p) => isSeedPinId(p.id) && p.isSavedByViewer === true && p.id !== SEED.baoSavedAndReactedPinId)
      .map((p) => p.id);

    for (const pinId of residue) {
      await h.silent(`mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`, { p: pinId, b: null }, state.T1);
    }

    // Đọc lại: residue có `boardId` (lưu vào board thật qua trình duyệt) KHÔNG
    // bị `boardId: null` chạm tới. Trường hợp đó phép này đỏ và nói rõ pin nào —
    // đúng ý đồ: nó là dữ liệu người thật tạo ra, bộ verify không được tự xoá.
    const after = await h.silent(FEED_SAVED_Q, { f: 20 }, state.T1);
    const left = (after?.data?.exploreFeed?.items ?? [])
      .filter((p) => isSeedPinId(p.id) && p.isSavedByViewer === true && p.id !== SEED.baoSavedAndReactedPinId)
      .map((p) => p.id);

    h.assert(
      'dọn được SavedPin ngoài seed của bao trước khi đo (đề kháng residue)',
      left.length === 0,
      residue.length === 0
        ? 'không có residue'
        : `đã dọn ${residue.length}: ${residue.join(',')}` +
            (left.length
              ? ` · CÒN SÓT sau khi dọn: ${left.join(',')} — dòng SavedPin có boardId thật, ` +
                `bộ verify KHÔNG tự xoá (dữ liệu người dùng); dọn tay rồi chạy lại`
              : ''),
    );
  }

  {
    const d = await h.silent(FEED_SAVED_Q, { f: 20 }, state.T1);
    // Chỉ đối chiếu pin seed: bảng kỳ vọng dưới đây là bảng của seed. Một pin
    // do verify tạo còn sót lại từ run bị ngắt giữa chừng không thuộc bảng đó.
    const items = (d?.data?.exploreFeed?.items ?? []).filter((p) => isSeedPinId(p.id));
    const wrong = items.filter(
      (p) =>
        p.isSavedByViewer !== (p.id === SEED.baoSavedAndReactedPinId) ||
        p.viewerReaction !== (p.id === SEED.baoSavedAndReactedPinId ? SEED.baoReactionOnThatPin : null),
    );
    const hit = items.find((p) => p.id === SEED.baoSavedAndReactedPinId);
    h.assert(
      'exploreFeed có token: isSavedByViewer/viewerReaction đúng từng pin, lẫn cả hai nhánh trong cùng một response',
      items.length >= 2 && Boolean(hit) && wrong.length === 0,
      `${items.length} pin seed · ${SEED.baoSavedAndReactedPinId}: saved=${hit?.isSavedByViewer} reaction=${hit?.viewerReaction} ` +
        `· ${items.filter((p) => p.isSavedByViewer).length} pin saved=true · ` +
        `${items.filter((p) => p.viewerReaction).length} pin có reaction` +
        (wrong.length ? ` · SAI: ${wrong.map((p) => `${p.id}(saved=${p.isSavedByViewer},r=${p.viewerReaction})`).join(',')}` : ''),
    );
  }

  // Khách vãng lai. Resolver thoát sớm TRƯỚC khi chạm loader, nên phép này còn
  // canh một thứ nữa ngoài giá trị: `perViewer` không bao giờ bị gọi với khoá
  // rỗng (một instance loader dùng chung cho mọi khách trong cùng request).
  const anonSaved = await gql('exploreFeed KHÔNG token (field viewer-aware của 3c) → vẫn 200', FEED_SAVED_Q, { f: 20 }, {});
  {
    const items = anonSaved?.exploreFeed?.items ?? [];
    h.assert(
      'khách vãng lai: isSavedByViewer toàn false và viewerReaction toàn null',
      items.length > 0 &&
        items.every((p) => p.isSavedByViewer === false) &&
        items.every((p) => p.viewerReaction === null),
      `${items.length} pin · saved {${[...new Set(items.map((p) => String(p.isSavedByViewer)))].join(',')}} · ` +
        `reaction {${[...new Set(items.map((p) => String(p.viewerReaction)))].join(',')}}`,
    );
  }

  // CÙNG MỘT PIN, ba token khác nhau ⇒ ba kết quả khác nhau. Đây là phép bắt
  // được lỗi loader dùng nhầm viewer — thứ mà `perViewer` phải chống, và là lý
  // do `name` phải nằm trong khoá cache của nó (dataloader.service.ts:68).
  {
    const [rBao, rAlice, rJohn] = await Promise.all([
      h.silent(PIN_SAVED_Q, { id: SEED.pinId }, state.T1),
      h.silent(PIN_SAVED_Q, { id: SEED.pinId }, state.T2),
      h.silent(PIN_SAVED_Q, { id: SEED.pinId }, state.T3),
    ]);
    const got = {
      bao: rBao?.data?.pin?.viewerReaction ?? null,
      alice: rAlice?.data?.pin?.viewerReaction ?? null,
      john: rJohn?.data?.pin?.viewerReaction ?? null,
    };
    const want = SEED.reactionsOnFirstPin;
    h.assert(
      `pin(${SEED.pinId}): viewerReaction đổi theo token trên cùng một pin`,
      got.bao === want.bao && got.alice === want.alice && got.john === want.john,
      `bao=${got.bao} alice=${got.alice} john=${got.john} · kỳ vọng bao=${want.bao} alice=${want.alice} john=${want.john}`,
    );
  }

  // Một pin có NHIỀU dòng SavedPin của cùng một người — hợp lệ vì
  // `@@unique([userId,pinId,boardId])` có `boardId` NULLABLE. bao đã lưu pin
  // này vào board_1 từ seed; lưu thêm lần nữa KHÔNG kèm board sẽ tạo dòng thứ
  // hai với `boardId = null`.
  //
  // Đây là phép kiểm bảo vệ quyết định thiết kế `findMany` + Set của loader:
  // `findUnique` biên dịch sạch nhưng sẽ ném ngay tại đây vì khoá không định
  // danh được một dòng. Không có phép này thì lỗi đó chỉ lộ ra ở production,
  // với đúng những người dùng lưu một pin vào nhiều board.
  await gql(
    'savePin lần 2 cùng pin, khác board (boardId=null) — nhiều dòng SavedPin là HỢP LỆ',
    `mutation($i:SavePinInput!){ savePin(input:$i){ id boardId } }`,
    { i: { pinId: SEED.baoSavedAndReactedPinId } },
    { token: state.T1 },
  );
  {
    const d = await h.silent(PIN_SAVED_Q, { id: SEED.baoSavedAndReactedPinId }, state.T1);
    h.assert(
      'isSavedByViewer vẫn true (không lỗi) khi cùng một pin có NHIỀU dòng SavedPin',
      d?.data?.pin?.isSavedByViewer === true,
      `pin=${SEED.baoSavedAndReactedPinId} saved=${d?.data?.pin?.isSavedByViewer} reaction=${d?.data?.pin?.viewerReaction}` +
        (d?.errors ? ` · lỗi: ${d.errors[0]?.message}` : ''),
    );
  }
  // Dọn dòng vừa tạo, trả DB về đúng trạng thái seed. `boardId` bỏ trống ⇒
  // boards.service.ts:303 lọc `boardId: null`, tức xoá ĐÚNG dòng vừa thêm và
  // không đụng tới dòng board_1 của seed.
  await gql(
    'unsavePin (dọn dòng vừa tạo, giữ nguyên dòng seed)',
    `mutation($p:ID!,$b:ID){ unsavePin(pinId:$p, boardId:$b) }`,
    { p: SEED.baoSavedAndReactedPinId, b: null },
    { token: state.T1 },
  );

  h.setGroup('GQL/mut');
  await gql(
    'updateProfile',
    `mutation($i:UpdateProfileInput!){ updateProfile(input:$i){ id bio } }`,
    { i: { bio: `verified ${new Date().toISOString()}` } },
    { token: state.T1 },
  );

  // ─── REVIEW-1 (#6) — cột `User.coverUrl` mới ───────────────────────────────
  // Hai phép, không phải một: mutation trả về đúng giá trị mới CHƯA chứng minh
  // nó được ghi xuống DB (resolver có thể vọng lại input). Phép thứ hai đọc lại
  // bằng một query KHÁC, của một đường code khác.
  {
    const COVER = `http://localhost:4000/uploads/r1-cover-probe.jpg`;
    const setCover = await gql(
      'updateProfile(coverUrl) — REVIEW-1 #6',
      `mutation($i:UpdateProfileInput!){ updateProfile(input:$i){ id coverUrl } }`,
      { i: { coverUrl: COVER } },
      { token: state.T1 },
    );
    // `gql()` trả thẳng phần `data`, KHÔNG bọc `{data}` như `h.silent()`.
    const readBack = await h.silent(
      `query($u:String!){ userByUsername(username:$u){ id coverUrl } }`,
      { u: USERS.bao.username },
      state.T1,
    );
    h.assert(
      'REVIEW-1 coverUrl: đọc lại qua userByUsername ra ĐÚNG giá trị vừa ghi',
      setCover?.updateProfile?.coverUrl === COVER &&
        readBack?.data?.userByUsername?.coverUrl === COVER,
      `mutation trả: ${setCover?.updateProfile?.coverUrl ?? 'null'} · đọc lại: ${readBack?.data?.userByUsername?.coverUrl ?? 'null'}`,
    );
    // Trả về null để hồ sơ seed không mang URL ảnh không tồn tại sang lần sau.
    await h.silent(
      `mutation($i:UpdateProfileInput!){ updateProfile(input:$i){ id coverUrl } }`,
      { i: { coverUrl: null } },
      state.T1,
    );
  }

  // Whitelist domain chống SSRF (pins.service.ts) chỉ cho localhost/S3/GCS/Cloudinary
  const imageUrl =
    state.uploadedUrl && /^https?:\/\//.test(state.uploadedUrl)
      ? state.uploadedUrl
      : 'http://localhost:4000/uploads/probe.png';
  const cp = await gql(
    'createPin',
    `mutation($i:CreatePinInput!){ createPin(input:$i){ id title imageUrl } }`,
    {
      i: {
        imageUrl,
        imageWidth: 64,
        imageHeight: 64,
        title: `probe ${state.uniq}`,
        description: 'verification probe',
      },
    },
    { token: state.T1 },
  );
  state.PIN = cp?.createPin?.id;

  await gql(
    'createPin (domain lạ → phải chặn)',
    `mutation($i:CreatePinInput!){ createPin(input:$i){ id } }`,
    { i: { imageUrl: 'https://evil.example.com/x.jpg', imageWidth: 10, imageHeight: 10 } },
    { token: state.T1, expect: /Image URL domain is not allowed/ },
  );
  await gql(
    'updatePin',
    `mutation($i:UpdatePinInput!){ updatePin(input:$i){ id title } }`,
    { i: { id: state.PIN, title: `probe ${state.uniq} edited` } },
    { token: state.T1 },
  );
  await gql(
    'updatePin (không phải chủ → phải chặn)',
    `mutation($i:UpdatePinInput!){ updatePin(input:$i){ id } }`,
    { i: { id: state.PIN, title: 'hacked' } },
    { token: state.T2, expect: /only edit your own pins/ },
  );
  // ─── Đợt 3d — `type` là enum ReactionType, không còn String ───
  //
  // Hai phép dưới đây trước 05/08/2026 khai `$t:String!`. Đổi sang
  // `$t:ReactionType!` KHÔNG phải chuyện làm đẹp: nếu SDL còn là `String!` thì
  // GraphQL từ chối ngay với "Variable $t of type ReactionType! used in position
  // expecting type String!". Nói cách khác chính hai dòng này là phép kiểm
  // chứng minh SDL đã đổi thật.
  //
  // ─── B-19 (17/08/2026) — mutation trả `Pin!`, không còn `Boolean!` ───
  //
  // Selection set dưới đây là BẮT BUỘC, không phải để đọc thêm cho vui: với
  // object type, `{ togglePinReaction(...) }` trần bị GraphQL từ chối ngay ở
  // tầng validation ("must have a selection of subfields"). Ba phép này vì thế
  // cũng là phép chứng minh SDL đã đổi thật — y hệt vai trò `$t:ReactionType!`
  // đã làm cho Đợt 3d ở trên.
  await gql(
    'togglePinReaction (bật)',
    `mutation($p:ID!,$t:ReactionType!){ togglePinReaction(pinId:$p, type:$t){ id reactionCount viewerReaction } }`,
    { p: state.PIN, t: 'HEART' },
    { token: state.T2 },
  );
  await gql(
    'togglePinReaction (tắt)',
    `mutation($p:ID!,$t:ReactionType!){ togglePinReaction(pinId:$p, type:$t){ id reactionCount viewerReaction } }`,
    { p: state.PIN, t: 'HEART' },
    { token: state.T2 },
  );
  // NĂNG LỰC MỚI của 3d, và là lý do nó đáng làm. Đo được trên code cũ
  // (05/08/2026): với `String!`, giá trị rác KHÔNG bị chặn ở tầng schema — nó đi
  // thẳng xuống `prisma.reaction.create()` rồi nổ ở đó, API trả **HTTP 200 kèm
  // lỗi runtime của Prisma** chứ không phải 400 validation. `type as any` ở
  // resolver chính là thứ bịt miệng tsc để chuyện đó qua được.
  await gql(
    'togglePinReaction (giá trị rác → GraphQL chặn ở TẦNG SCHEMA, không rơi xuống Prisma)',
    // ⚠️ Selection set ở đây phải ĐÚNG, dù phép này cố tình đỏ. Thiếu nó thì
    // GraphQL vẫn đỏ — nhưng đỏ vì "must have a selection of subfields", tức là
    // phép kiểm sẽ *trông như* vẫn đạt trong khi năng lực nó canh (enum chặn giá
    // trị rác trước khi chạm Prisma) không còn được đo nữa. Regex `expect` dưới
    // đây cố ý KHÔNG khớp thông điệp subfields, nên nhánh đó sẽ hiện thành FAIL.
    `mutation($p:ID!,$t:ReactionType!){ togglePinReaction(pinId:$p, type:$t){ id } }`,
    { p: state.PIN, t: 'NOPE' },
    { token: state.T2, expect: /ReactionType|not a valid|Expected type/ },
  );

  // ─── Lambda callback: nhánh THÀNH CÔNG ───
  //
  // Đây là lần ĐẦU TIÊN endpoint `PATCH /internal/pins/:id/processed` chạy được
  // kể từ khi viết: trước 04/08/2026 `ProcessedDto` không có decorator
  // class-validator nào nên `forbidNonWhitelisted` chặn mọi payload.
  //
  // Đặt ở bước 10 chứ không phải bước 00 vì phép kiểm tra này GHI THẬT vào pin.
  // Dùng `state.PIN` — pin do chính bộ verify tạo và sẽ xoá ở bước 90 — để giữ
  // bất biến "chỉ đụng tài nguyên của chính mình", không sửa pin seed.
  h.setGroup('REST/internal');
  const internalSecret = readApiEnv('INTERNAL_API_SECRET');
  if (!internalSecret) {
    h.rec(
      'PATCH /internal/pins/:id/processed (secret đúng → 200)',
      'SKIP',
      'không đọc được INTERNAL_API_SECRET từ env lẫn apps/api/.env',
    );
  } else {
    await h.rest('PATCH /internal/pins/:id/processed (secret đúng → 200)', 'PATCH', `/internal/pins/${state.PIN}/processed`, {
      headers: { 'x-internal-secret': internalSecret },
      body: {
        thumbnailUrl: 'https://example.com/t.jpg',
        mediumUrl: 'https://example.com/m.jpg',
        largeUrl: 'https://example.com/l.jpg',
      },
    });
  }

  // ─── Bằng chứng DataLoader thật sự batch ───
  //
  // Nhóm riêng `GQL/perf` để phép so với baseline 94 bản ghi của Đợt 0 không
  // bị lệch — phép đo này là NĂNG LỰC MỚI, không thuộc bộ 103 phép được port.
  // (Baseline `_original/` đã xoá 05/08/2026 khi Đợt 3a xanh, nhưng việc tách
  // nhóm vẫn giữ: nó phân biệt "phép kiểm hành vi" với "phép đo hiệu năng".)
  //
  // Đặt ở `exploreFeed` vì đây là nơi loader ĐANG batch đúng: mục tiêu ở Đợt 0
  // là chứng minh bộ đếm hoạt động trên nền 0 FAIL, chưa phải đi bắt lỗi.
  h.setGroup('GQL/perf');
  await assertBatched(
    h,
    h.counter,
    'exploreFeed: số query bất biến theo kích thước trang',
    (first) =>
      h.silent(
        `query($f:Int!){ exploreFeed(first:$f){ items{ id title creator{ id username } reactionCount commentCount savedCount } } }`,
        { f: first },
        state.T1,
      ),
  );

  // Probe thứ hai, có `isFollowedByViewer` trong selection.
  //
  // ⚠️ Probe này KHÔNG đỏ-trước được, và đó là chủ đích — đừng kết luận nó hỏng
  // khi thấy nó xanh ngay lần đầu:
  //   - Trước Đợt 3a: không có guard ⇒ loader thoát sớm ở `if (!viewer) return
  //     false`, chẳng chạm database ⇒ Δ=0 (XANH GIẢ).
  //   - Sau Đợt 3a + 3b: loader chạy thật NHƯNG đã memo theo viewer ⇒ Δ=0 (xanh
  //     thật).
  // Nó là phép kiểm CHÉO: chỉ có nghĩa khi CẢ 3a (guard) lẫn 3b (memo) cùng
  // đúng, và nó sẽ bắt được nếu ai đó làm hỏng memo của 3b về sau — lúc đó
  // guard vẫn còn nên loader chạy thật, và Δ sẽ tăng theo số creator.
  //
  // Giữ small=5/large=20 mặc định: seed có 20 pin nên trang lớn THẬT SỰ chứa
  // nhiều item hơn trang nhỏ. (Ngoại lệ `followers` ở bước 20 phải hạ xuống
  // 1 vs 4 vì tối đa chỉ có 4 dòng — đừng bê con số đó sang đây.)
  await assertBatched(
    h,
    h.counter,
    'exploreFeed: số query bất biến theo kích thước trang (creator.isFollowedByViewer)',
    (first) => h.silent(FEED_VIEWER_Q, { f: first }, state.T1),
  );

  // Probe thứ ba — 2 loader của Đợt 3c.
  //
  // ⚠️ Giống probe ngay trên, probe này KHÔNG đỏ-trước được: field chưa tồn tại
  // thì query còn chẳng chạy. Nó là phép kiểm CHÉO với 3b — hai loader mới đi
  // qua `perViewer`, nên nếu ai đó làm hỏng phần memo thì Δ sẽ tăng theo số pin
  // trong trang chứ không phải theo số creator, tức bắt được lỗi mà probe
  // `isFollowedByViewer` không bắt được.
  //
  // Số tuyệt đối đo được ngày 05/08/2026, GIỐNG HỆT ở first=5 và first=20:
  //   SELECT * FROM "Pin"            ← feed (raw SQL của pins.service)
  //   SELECT ... FROM "SavedPin" WHERE userId = $1 AND pinId IN (...)
  //   SELECT ... FROM "Reaction" WHERE userId = $1 AND pinId IN (...)
  // Đúng 3, không phải 5: selection này KHÔNG lấy `creator` nên không kích hoạt
  // loader User/Follows. Mỗi loader mới tốn ĐÚNG 1 query cho cả trang — N+1 sẽ
  // là 5 và 20.
  //
  // Nhưng phép kiểm vẫn là Δ=0 chứ không phải con số 3: con số đổi theo
  // selection và theo số loader, còn bất biến thì không.
  await assertBatched(
    h,
    h.counter,
    'exploreFeed: số query bất biến theo kích thước trang (isSavedByViewer + viewerReaction)',
    (first) => h.silent(FEED_SAVED_Q, { f: first }, state.T1),
  );

  return Boolean(state.ME && state.PIN);
}
