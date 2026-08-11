// Bước 67 — Đợt 5 (#11): homeFeed — feed của những người mình follow
//
// ⚠️ VỊ TRÍ CỦA BƯỚC NÀY LÀ HỢP ĐỒNG, KHÔNG PHẢI SỞ THÍCH (cùng lý do bước 65):
//
//   1. SAU bước 20 — bước đó dựng `bao→alice`, nên tại đây bao follow 3 người
//      (jane, john, alice) chứ không phải 2 như lúc seed. Phép kiểm tra KHÔNG
//      được chốt con số tuyệt đối, phải đọc tập following tại đúng thời điểm.
//   2. SAU bước 65 — bước đó block rồi unblock john và tự dựng lại 2 cạnh
//      `bao↔john`. Chạy trước nó thì trạng thái follow ở đây phụ thuộc vào một
//      bước chưa chạy xong.
//   3. TRƯỚC bước 70 — subscription cần cạnh `bao↔alice` còn sống.
//
// Bước này CŨNG block john (không block alice, cùng lý do bước 65: `bao↔alice`
// là tiền đề cứng của DM và subscription) và CŨNG phải tự dựng lại 2 cạnh
// `bao↔john` trước khi kết thúc — `blockUser` xoá follow cả hai chiều và
// `unblockUser` không khôi phục.
//
// ⚠️ BẪY LỚN NHẤT CỦA ĐỢT NÀY — CURSOR XUYÊN NGUỒN. Cursor sinh từ nhánh
// FOLLOWING *kỹ thuật vẫn hợp lệ* với nhánh EXPLORE: cùng bảng `Pin`, cùng khoá
// `(createdAt DESC, id DESC)`. Nên một bản cài đặt chọn nhánh theo cursor, hoặc
// theo luật "trang này rỗng thì rơi sang explore", KHÔNG ném lỗi nào cả — nó
// lặng lẽ nhảy cóc mất pin, `tsc` xanh, HTTP 200, dữ liệu trông hợp lý. Phép
// kiểm duy nhất bắt được nằm ở mục "cursor không xuyên nguồn" bên dưới: gộp
// mọi trang phải bằng ĐÚNG tập đầy đủ, không trùng và không thiếu.
//
// ⚠️ BẪY 7 (bước 65 đã dính thật): mọi bằng chứng ở đây có hình dạng "item xuất
// hiện / biến mất", mà một query BỊ TỪ CHỐI cũng cho ra đúng hình dạng đó —
// `(res.data?.homeFeed?.items ?? []).length` in ra `0` khi query LỖI chứ không
// phải khi lọc thành công. Nên mọi phép dưới đây đọc `errors` TRƯỚC `data`.

import { login } from '../lib/client.mjs';
import { USERS, PASSWORD } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';

/**
 * MỘT document chứa cả ba: `homeFeed`, `following` (nguồn sự thật ĐỘC LẬP) và
 * `exploreFeed` (đối chứng).
 *
 * Gộp vào một request chứ không gọi ba lần là có chủ đích: phép kiểm quyết định
 * của đợt là "mọi creator trả về nằm trong tập following", và tập đó thay đổi
 * theo thời gian (bước 20 thêm alice, block xoá john). Ba request riêng để lại
 * khe hở cho việc so hai ảnh chụp ở hai thời điểm khác nhau — cùng loại mơ hồ
 * mà §13/§15 dạy phải loại trừ. Một request thì không có khe hở nào.
 *
 * `homeFeed` dùng `GqlAuthGuard` còn `following`/`exploreFeed` dùng
 * `GqlOptionalAuthGuard`; trộn trong cùng một document vẫn chạy đúng.
 */
const COMBINED = `query($f:Int!,$u:String!){
  homeFeed(first:$f){ source items{ id creator{ id username } } pageInfo{ hasNextPage endCursor } }
  following(userId:$u, first:50){ items{ id username } }
  exploreFeed(first:$f){ items{ id } }
}`;

const HOME_PAGE = `query($f:Int!,$a:String){
  homeFeed(first:$f, after:$a){ source items{ id } pageInfo{ hasNextPage endCursor } }
}`;

const HOME_PERF = `query($f:Int!){
  homeFeed(first:$f){ source items{ id title creator{ id username } reactionCount commentCount savedCount } }
}`;

const PROBE_Q = `query($f:Int!,$u:String!){
  homeFeed(first:$f){ source items{ id } }
  exploreFeed(first:$f){ items{ id } }
  following(userId:$u, first:50){ items{ id } }
}`;

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/homefeed');

  /** Đọc COMBINED và trả CẢ lỗi lẫn dữ liệu — không bao giờ nuốt `errors`. */
  const readAll = async (token, first = 50) => {
    const r = await h.silent(COMBINED, { f: first, u: USERS.bao.id }, token);
    return {
      err: r?.errors?.[0]?.message ?? null,
      source: r?.data?.homeFeed?.source ?? null,
      items: r?.data?.homeFeed?.items ?? [],
      ids: (r?.data?.homeFeed?.items ?? []).map((i) => i.id),
      following: new Set((r?.data?.following?.items ?? []).map((x) => x.id)),
      followingNames: (r?.data?.following?.items ?? []).map((x) => x.username),
      exploreIds: (r?.data?.exploreFeed?.items ?? []).map((i) => i.id),
    };
  };

  const before = await readAll(state.T1);

  // ─── PHÉP KIỂM QUYẾT ĐỊNH của cả đợt ───────────────────────────────────────
  //
  // "query chạy được" và "trả về có item" đều KHÔNG phải phép kiểm — cả hai đều
  // xanh với một `exploreFeed` đội lốt homeFeed. Thứ phân biệt được hai bản cài
  // đặt là QUAN HỆ giữa creator trả về và tập following đọc từ nguồn khác.
  //
  // `items.length > 0` và `size >= 2` là điều kiện tiên quyết chứ không phải
  // trang trí: `[].every(...)` trả `true`, nên không có chúng thì một feed rỗng
  // sẽ làm phép kiểm này xanh trọn vẹn.
  {
    const outsiders = before.items.filter((i) => !before.following.has(i.creator.id));
    const creators = new Set(before.items.map((i) => i.creator.username));
    h.assert(
      'QUYẾT ĐỊNH: mọi creator của homeFeed nằm trong tập following, đọc trong CÙNG một request',
      !before.err &&
        before.source === 'FOLLOWING' &&
        before.following.size >= 2 &&
        before.ids.length > 0 &&
        creators.size >= 2 &&
        outsiders.length === 0,
      before.err
        ? `LỖI: ${before.err}`
        : `source=${before.source} · ${before.ids.length} pin của ${creators.size} creator {${[...creators].join(',')}} · ` +
          `bao follow ${before.following.size} người {${before.followingNames.join(',')}}` +
          (outsiders.length
            ? ` · NGOÀI TẬP FOLLOWING: ${[...new Set(outsiders.map((i) => `${i.creator.username}(${i.id})`))].join(',')}`
            : ''),
    );
  }

  // Một pin chỉ được xuất hiện MỘT lần. `INNER JOIN "Follows"` mà thiếu điều
  // kiện `f."followerId" = $viewer` vẫn trả về dữ liệu trông hợp lý, nhưng mỗi
  // pin bị nhân bản theo số người follow creator của nó. Đây là hình dạng hỏng
  // mà phép "mọi creator thuộc tập following" bắt được ở nhánh khác, còn phép
  // này bắt được ở nhánh số lượng.
  {
    const dup = before.ids.filter((id, i) => before.ids.indexOf(id) !== i);
    h.assert(
      'homeFeed không nhân bản pin (mỗi pin khớp đúng 1 dòng Follows của viewer)',
      !before.err && before.ids.length > 0 && dup.length === 0,
      dup.length ? `LẶP: ${[...new Set(dup)].join(',')}` : `${before.ids.length} pin, ${new Set(before.ids).size} id khác nhau`,
    );
  }

  // ─── ĐỐI CHỨNG: homeFeed phải là TẬP CON THỰC SỰ của exploreFeed ───────────
  //
  // Không có phép này thì một `homeFeed` chẳng lọc gì (trả nguyên explore) vẫn
  // xanh ở phép trên trong trường hợp bao tình cờ follow mọi creator. Nó cũng
  // là phép đối xứng với "lọc quá tay": bắt cả hai hướng lệch.
  {
    const missingFromExplore = before.ids.filter((id) => !before.exploreIds.includes(id));
    const filteredOut = before.exploreIds.filter((id) => !before.ids.includes(id));
    h.assert(
      'ĐỐI CHỨNG: homeFeed là tập con THỰC SỰ của exploreFeed (lọc thật, không phải explore đổi tên)',
      !before.err &&
        before.exploreIds.length > 0 &&
        before.exploreIds.length < 50 && // explore chưa bị cắt bởi LIMIT ⇒ là tập đầy đủ
        missingFromExplore.length === 0 &&
        filteredOut.length > 0,
      `homeFeed=${before.ids.length} pin · exploreFeed=${before.exploreIds.length} pin · ` +
        `explore có mà home không có: ${filteredOut.length} pin` +
        (missingFromExplore.length ? ` · HOME CÓ MÀ EXPLORE KHÔNG: ${missingFromExplore.join(',')}` : ''),
    );
  }

  // ─── Cursor KHÔNG xuyên nguồn ──────────────────────────────────────────────
  //
  // Phép duy nhất bắt được bẫy lớn nhất của đợt. Đổi nhánh giữa chừng không ném
  // lỗi, nên bằng chứng phải là quan hệ TẬP HỢP: gộp mọi trang == tập đầy đủ,
  // không trùng một id nào, không thiếu một id nào, và `source` giữ nguyên ở
  // MỌI trang. Nhánh EXPLORE chèn vào sẽ kéo theo pin của người bao không
  // follow ⇒ "dư"; nhảy cóc sẽ để lại "thiếu".
  {
    const pages = [];
    const seenSources = new Set();
    let cursor = undefined;
    let err = null;
    for (let i = 0; i < 10; i++) {
      const r = await h.silent(HOME_PAGE, { f: 3, a: cursor }, state.T1);
      if (r?.errors?.length) {
        err = r.errors[0].message;
        break;
      }
      const page = r?.data?.homeFeed;
      if (!page) {
        err = 'không có data.homeFeed';
        break;
      }
      seenSources.add(page.source);
      pages.push(page.items.map((x) => x.id));
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }

    const walked = pages.flat();
    const dup = walked.filter((id, i) => walked.indexOf(id) !== i);
    const missing = before.ids.filter((id) => !walked.includes(id));
    const extra = walked.filter((id) => !before.ids.includes(id));
    h.assert(
      'cursor KHÔNG xuyên nguồn: gộp các trang first=3 bằng ĐÚNG tập đầy đủ, không trùng · không thiếu · source không đổi',
      !err &&
        pages.length >= 2 &&
        dup.length === 0 &&
        missing.length === 0 &&
        extra.length === 0 &&
        seenSources.size === 1 &&
        seenSources.has('FOLLOWING'),
      err
        ? `LỖI: ${err}`
        : `${pages.length} trang [${pages.map((p) => p.length).join('+')}] = ${walked.length} pin · ` +
          `tập đầy đủ ${before.ids.length} pin · source {${[...seenSources].join(',')}}` +
          (dup.length ? ` · TRÙNG: ${[...new Set(dup)].join(',')}` : '') +
          (missing.length ? ` · THIẾU: ${missing.join(',')}` : '') +
          (extra.length ? ` · DƯ (pin ngoài nhánh FOLLOWING lọt vào): ${extra.join(',')}` : ''),
    );
  }

  // ─── Số query bất biến theo kích thước trang ───────────────────────────────
  //
  // ⚠️ MẶC ĐỊNH 5/20 KHÔNG DÙNG ĐƯỢC Ở ĐÂY (bẫy 3). `exploreFeed` đo được với
  // 5/20 vì seed có 21 pin; nhánh FOLLOWING của bao thì chỉ có 12 (jane 4 +
  // john 4 + alice 4). Với `small=5, large=20` cả hai lần gọi đều trả về CÙNG
  // 12 item, tức "trang lớn" không lớn hơn thật — Δ=0 lúc đó chẳng chứng minh
  // được gì, kể cả khi code N+1 hoàn toàn. 2 vs 8 nằm gọn dưới 12 nên trang lớn
  // THẬT SỰ chứa gấp 4 lần số item, đúng điều kiện để phép đo có nghĩa.
  h.setGroup('GQL/perf');
  await assertBatched(
    h,
    h.counter,
    'homeFeed: số query bất biến theo kích thước trang',
    (first) => h.silent(HOME_PERF, { f: first }, state.T1),
    { small: 2, large: 8 },
  );

  h.setGroup('GQL/homefeed');

  // ─── Nhánh EXPLORE ─────────────────────────────────────────────────────────
  //
  // ⚠️ Seed KHÔNG có user nào `followingCount = 0` (bao/jane/john/alice follow
  // 2, bob follow 1), nên nhánh này KHÔNG có sự thật nền cố định — giống hệt
  // Đợt 4 và 3e. Dùng user probe của bước 00: nó follow 0 người và là NGƯỜI
  // DÙNG MỚI THẬT, tức đúng kịch bản nghiệp vụ mà fallback tồn tại để phục vụ.
  // Bước 90 mới xoá nó. Token chưa được lưu vào `state` nên phải tự login.
  {
    const TP = await login(state.probeEmail, PASSWORD);
    if (!TP) {
      h.rec(
        'nhánh EXPLORE: user chưa follow ai ⇒ source=EXPLORE và id trùng khớp exploreFeed',
        'FAIL',
        `không đăng nhập được tài khoản probe ${state.probeEmail}`,
      );
    } else {
      const meP = await h.silent(`{ me { id } }`, {}, TP);
      const probeId = meP?.data?.me?.id;
      const r = await h.silent(PROBE_Q, { f: 50, u: probeId }, TP);
      const err = r?.errors?.[0]?.message ?? null;
      const src = r?.data?.homeFeed?.source ?? null;
      const hIds = (r?.data?.homeFeed?.items ?? []).map((i) => i.id);
      const eIds = (r?.data?.exploreFeed?.items ?? []).map((i) => i.id);
      const nFollowing = (r?.data?.following?.items ?? []).length;
      const same = hIds.length === eIds.length && hIds.every((id, i) => id === eIds[i]);
      h.assert(
        'nhánh EXPLORE: user probe (follow 0 người) ⇒ source=EXPLORE và tập id TRÙNG KHỚP exploreFeed cùng lúc',
        !err && nFollowing === 0 && src === 'EXPLORE' && hIds.length > 0 && same,
        err
          ? `LỖI: ${err}`
          : `probe follow ${nFollowing} người · source=${src} · homeFeed=${hIds.length} pin · exploreFeed=${eIds.length} pin · ` +
            `trùng khớp theo đúng thứ tự: ${same}`,
      );
    }
  }

  // ─── Không token ⇒ phải BỊ TỪ CHỐI ─────────────────────────────────────────
  //
  // ⚠️ KHÔNG DÙNG `gql(..., { expect })` Ở ĐÂY. `expect` chỉ phân loại lỗi KHI
  // CÓ lỗi: query THÀNH CÔNG thì `gql` ghi OK chứ không ghi FAIL (client.mjs:135).
  // Với phép kiểm mà bằng chứng LÀ sự xuất hiện của lỗi — và đây đúng là loại
  // đó: `homeFeed` là query DUY NHẤT của PinsResolver bắt buộc đăng nhập — hình
  // dạng `expect` xanh vĩnh viễn đúng lúc nó cần đỏ. Đợt 3e đã dính thật, xem
  // debug_history §16. Nên khẳng định TƯỜNG MINH.
  {
    const anon = await h.silent(HOME_PAGE, { f: 5 }, null);
    const msg = anon?.errors?.[0]?.message ?? '';
    h.assert(
      'KHÔNG token ⇒ homeFeed bị từ chối (GqlAuthGuard bắt buộc, khác 3 query public còn lại)',
      /unauthorized|forbidden/i.test(msg) && !anon?.data?.homeFeed,
      msg
        ? `ném đúng: ${msg}`
        : `KHÔNG bị từ chối — khách vãng lai đọc được homeFeed: source=${anon?.data?.homeFeed?.source} ` +
          `${(anon?.data?.homeFeed?.items ?? []).length} pin`,
    );
  }

  // ─── Gộp lọc block ─────────────────────────────────────────────────────────
  //
  // Block JOHN, không block alice — `bao↔alice` là tiền đề của bước 70.
  // Sau block bao còn follow 2 người (jane + alice) nên nhánh VẪN là FOLLOWING;
  // chọn người sao cho `followingCount` KHÔNG về 0 là có chủ đích: về 0 thì
  // nhánh đổi sang EXPLORE — hành vi đúng, nhưng nó sẽ trộn hai thứ đang được
  // đo vào một phép kiểm.
  h.setGroup('GQL/mut');
  await gql('blockUser (bao → john) [homefeed]', `mutation($u:String!){ blockUser(userId:$u) }`, { u: USERS.john.id }, { token: state.T1 });

  h.setGroup('GQL/homefeed');
  const afterBlock = await readAll(state.T1);
  {
    const johnPins = before.items.filter((i) => i.creator.id === USERS.john.id).map((i) => i.id);
    const stillThere = johnPins.filter((id) => afterBlock.ids.includes(id));
    const others = before.ids.filter((id) => !johnPins.includes(id));
    const lostOthers = others.filter((id) => !afterBlock.ids.includes(id));
    h.assert(
      'block một người ĐANG follow ⇒ pin của họ biến mất khỏi homeFeed, pin người khác còn nguyên',
      !afterBlock.err &&
        johnPins.length > 0 &&
        stillThere.length === 0 &&
        lostOthers.length === 0 &&
        afterBlock.ids.length === before.ids.length - johnPins.length,
      afterBlock.err
        ? `LỖI: ${afterBlock.err}`
        : `${before.ids.length} → ${afterBlock.ids.length} pin (Δ=${before.ids.length - afterBlock.ids.length}, ` +
          `john có ${johnPins.length} pin trong feed)` +
          (stillThere.length ? ` · CÒN SÓT: ${stillThere.join(',')}` : '') +
          (lostOthers.length ? ` · LỌC QUÁ TAY, mất thêm: ${lostOthers.join(',')}` : ''),
    );
  }

  // Bất biến quyết định phải đúng với tập following ĐÃ THU NHỎ, không phải với
  // ảnh chụp cũ: `blockUser` xoá luôn quan hệ follow cả hai chiều
  // (social.service.ts:104) nên `followingCount` giảm ngay tại đây.
  {
    const outsiders = afterBlock.items.filter((i) => !afterBlock.following.has(i.creator.id));
    h.assert(
      'sau block: bất biến "creator ⊆ following" vẫn đúng với tập following đã thu nhỏ',
      !afterBlock.err &&
        afterBlock.source === 'FOLLOWING' &&
        afterBlock.following.size >= 1 &&
        afterBlock.following.size < before.following.size &&
        afterBlock.ids.length > 0 &&
        outsiders.length === 0,
      `source=${afterBlock.source} · bao follow ${before.following.size} → ${afterBlock.following.size} người ` +
        `{${afterBlock.followingNames.join(',')}} · ${afterBlock.ids.length} pin` +
        (outsiders.length ? ` · NGOÀI TẬP: ${outsiders.map((i) => i.creator.username).join(',')}` : ''),
    );
  }

  // ─── Unblock + dựng lại quan hệ follow mà blockUser đã xoá vĩnh viễn ───────
  //
  // KHÔNG phải dọn dẹp trang trí: bước 70 ngay sau đây và bước 20 của lần chạy
  // KẾ TIẾP đều đối chiếu các cạnh follow của seed. `follow()` cố ý từ chối
  // trùng nên phần gọi dùng `silent()`.
  h.setGroup('GQL/mut');
  await gql('unblockUser (bao → john) [homefeed]', `mutation($u:String!){ unblockUser(userId:$u) }`, { u: USERS.john.id }, { token: state.T1 });

  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: USERS.john.id }, state.T1);
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: USERS.bao.id }, state.T3);

  h.setGroup('GQL/homefeed');
  const restored = await readAll(state.T1);
  const rel = await h.silent(
    `query($u:String!){ userByUsername(username:$u){ id isFollowedByViewer isFollowingViewer } }`,
    { u: USERS.john.username },
    state.T1,
  );
  const r = rel?.data?.userByUsername;
  const mutualBack = r?.isFollowedByViewer === true && r?.isFollowingViewer === true;

  h.assert(
    'sau unblock + dựng lại follow: homeFeed trở lại đúng tập cũ, và mutual follow bao↔john đã khôi phục',
    mutualBack &&
      !restored.err &&
      restored.source === 'FOLLOWING' &&
      restored.ids.length === before.ids.length &&
      before.ids.every((id) => restored.ids.includes(id)),
    `bao→john=${r?.isFollowedByViewer} · john→bao=${r?.isFollowingViewer} · ` +
      `homeFeed ${before.ids.length} → ${afterBlock.ids.length} → ${restored.ids.length} pin · source=${restored.source}` +
      (restored.err ? ` · LỖI: ${restored.err}` : ''),
  );

  // Bước 70 phụ thuộc cạnh follow, nên chỉ đi tiếp khi đã khôi phục xong.
  return mutualBack;
}
