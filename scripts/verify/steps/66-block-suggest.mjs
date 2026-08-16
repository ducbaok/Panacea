// Bước 66 — FE-6 (QĐ-1/QĐ-2/QĐ-7): ba việc backend mới của đợt FE-6
//
//   §6b.3  User.isBlockedByViewer (MỘT chiều) + query blockedUsers (MỘT chiều)
//   §6b.2  query suggestedUsers (loại: đã follow · chính mình · bị chặn 2 chiều)
//   §6b.1  homeFeed(source:) — ép nguồn, KHÔNG fallback
//
// ⚠️ VỊ TRÍ LÀ HỢP ĐỒNG (cùng lý do bước 65/67): chạy SAU 65 (john đã được dựng
// lại mutual) và TRƯỚC 67. Bước này CŨNG block→unblock john và PHẢI tự dựng lại
// 2 cạnh bao↔john trước khi kết thúc — `blockUser` xoá follow cả hai chiều,
// `unblockUser` không khôi phục. Không restore ⇒ bước 67 (`before` kỳ vọng bao
// follow cả john) và bước 20 của lần chạy sau sẽ đỏ, cách xa nguyên nhân.
//
// ⚠️ BẪY 7 (như 65/67): "item xuất hiện/biến mất" trùng hình dạng với "query bị
// từ chối" — mọi phép dưới đây đọc `errors` TRƯỚC `data`.
//
// State-robust: KHÔNG chốt con số tuyệt đối cho tập following của bao (bước 20
// đổi nó). Phép suggestedUsers đọc `following(bao)` trong CÙNG request rồi khẳng
// định quan hệ TẬP HỢP, không phải danh sách cố định.

import { login } from '../lib/client.mjs';
import { USERS, PASSWORD } from '../lib/seedrefs.mjs';

const Q_SUGGEST = `query($f:Int!,$u:String!){
  suggestedUsers(first:$f){ id username isFollowedByViewer isBlockedByViewer }
  following(userId:$u, first:50){ items{ id } }
}`;

const Q_PROFILE = `query($u:String!){ userByUsername(username:$u){ id isBlockedByViewer isFollowedByViewer } }`;
const Q_BLOCKED = `query{ blockedUsers(first:50){ items{ id username } pageInfo{ hasNextPage endCursor } } }`;

const Q_HOME_SRC = `query($f:Int!,$s:FeedSource){ homeFeed(first:$f, source:$s){ source items{ id } } }`;
const Q_HOME_AUTO = `query($f:Int!){ homeFeed(first:$f){ source items{ id } } }`;
const Q_EXPLORE = `query($f:Int!){ exploreFeed(first:$f){ items{ id } } }`;
const Q_FOLLOWING_N = `query($u:String!){ following(userId:$u, first:50){ items{ id } } }`;

export default async function (h) {
  const { gql, state } = h;

  // ══════════════════════════════════════════════════════════════════════════
  // §6b.2 — suggestedUsers: bộ loại trừ đúng (đọc following trong cùng request)
  // ══════════════════════════════════════════════════════════════════════════
  h.setGroup('GQL/social');

  const readSuggest = async (token) => {
    const r = await h.silent(Q_SUGGEST, { f: 10, u: USERS.bao.id }, token);
    return {
      err: r?.errors?.[0]?.message ?? null,
      users: r?.data?.suggestedUsers ?? [],
      ids: (r?.data?.suggestedUsers ?? []).map((u) => u.id),
      following: new Set((r?.data?.following?.items ?? []).map((x) => x.id)),
    };
  };

  const sug0 = await readSuggest(state.T1);
  {
    const self = sug0.ids.includes(USERS.bao.id);
    const alreadyFollowed = sug0.ids.filter((id) => sug0.following.has(id));
    const markedFollowed = sug0.users.filter((u) => u.isFollowedByViewer === true);
    h.assert(
      'suggestedUsers loại đúng: không có chính mình, không có ai đã follow (đọc following cùng request)',
      !sug0.err &&
        sug0.ids.length <= 10 &&
        sug0.ids.length === new Set(sug0.ids).size &&
        !self &&
        alreadyFollowed.length === 0 &&
        markedFollowed.length === 0,
      sug0.err
        ? `LỖI: ${sug0.err}`
        : `gợi ý ${sug0.ids.length} người {${sug0.users.map((u) => u.username).join(',')}} · bao follow ${sug0.following.size} người` +
          (self ? ' · CÓ CHÍNH MÌNH' : '') +
          (alreadyFollowed.length ? ` · CÓ NGƯỜI ĐÃ FOLLOW: ${alreadyFollowed.join(',')}` : '') +
          (markedFollowed.length ? ` · isFollowedByViewer=true: ${markedFollowed.map((u) => u.username).join(',')}` : ''),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §6b.1 — homeFeed(source:) ÉP NGUỒN
  // ══════════════════════════════════════════════════════════════════════════
  h.setGroup('GQL/homefeed');

  // bao follow người có pin ⇒ ép FOLLOWING trả pin kèm source=FOLLOWING; ép
  // EXPLORE trả đúng exploreFeed; bỏ source ⇒ nhánh cũ vẫn FOLLOWING.
  const [hfF, hfE, hfA, expl] = await Promise.all([
    h.silent(Q_HOME_SRC, { f: 20, s: 'FOLLOWING' }, state.T1),
    h.silent(Q_HOME_SRC, { f: 20, s: 'EXPLORE' }, state.T1),
    h.silent(Q_HOME_AUTO, { f: 20 }, state.T1),
    h.silent(Q_EXPLORE, { f: 20 }, state.T1),
  ]);
  {
    const fSrc = hfF?.data?.homeFeed?.source;
    const eSrc = hfE?.data?.homeFeed?.source;
    const aSrc = hfA?.data?.homeFeed?.source;
    const fIds = (hfF?.data?.homeFeed?.items ?? []).map((i) => i.id);
    const eIds = (hfE?.data?.homeFeed?.items ?? []).map((i) => i.id);
    const exIds = (expl?.data?.exploreFeed?.items ?? []).map((i) => i.id);
    const exploreMatches = eIds.length === exIds.length && eIds.every((id, i) => id === exIds[i]);
    h.assert(
      'bao ép source: FOLLOWING⇒source=FOLLOWING (có pin) · EXPLORE⇒source=EXPLORE (trùng exploreFeed) · bỏ source⇒vẫn FOLLOWING',
      !hfF?.errors && !hfE?.errors && !hfA?.errors &&
        fSrc === 'FOLLOWING' && fIds.length > 0 &&
        eSrc === 'EXPLORE' && exploreMatches &&
        aSrc === 'FOLLOWING',
      `ép FOLLOWING: source=${fSrc} ${fIds.length} pin · ép EXPLORE: source=${eSrc} ${eIds.length} pin (trùng explore=${exploreMatches}) · auto: source=${aSrc}` +
        (hfF?.errors ? ` · LỖI F: ${hfF.errors[0].message}` : '') +
        (hfE?.errors ? ` · LỖI E: ${hfE.errors[0].message}` : ''),
    );
  }

  // ─── PHÉP QUYẾT ĐỊNH của §6b.1: 0-follow ép FOLLOWING ⇒ RỖNG, KHÔNG fallback ─
  // Dùng tài khoản probe (bước 00, follow 0 người, bước 90 mới xoá). Đây là phép
  // DUY NHẤT phân biệt "ép nguồn trung thực" với "vẫn fallback về explore": nếu
  // còn fallback thì ép FOLLOWING sẽ trả pin kèm source=EXPLORE (chip nói dối).
  {
    const TP = await login(state.probeEmail, PASSWORD);
    if (!TP) {
      h.rec('§6b.1 ép FOLLOWING khi follow-0 ⇒ RỖNG + source=FOLLOWING (không fallback)', 'FAIL', `không đăng nhập được probe ${state.probeEmail}`);
    } else {
      const meP = await h.silent(`{ me { id } }`, {}, TP);
      const probeId = meP?.data?.me?.id;
      const nf = await h.silent(Q_FOLLOWING_N, { u: probeId }, TP);
      const nFollowing = (nf?.data?.following?.items ?? []).length;
      const pF = await h.silent(Q_HOME_SRC, { f: 20, s: 'FOLLOWING' }, TP);
      const pE = await h.silent(Q_HOME_SRC, { f: 20, s: 'EXPLORE' }, TP);
      const pA = await h.silent(Q_HOME_AUTO, { f: 20 }, TP);
      const pfSrc = pF?.data?.homeFeed?.source;
      const pfN = (pF?.data?.homeFeed?.items ?? []).length;
      h.assert(
        '§6b.1 QUYẾT ĐỊNH: probe (follow 0) ép FOLLOWING ⇒ 0 pin + source=FOLLOWING (KHÔNG fallback); ép EXPLORE & auto ⇒ EXPLORE có pin',
        !pF?.errors && !pE?.errors && !pA?.errors &&
          nFollowing === 0 &&
          pfSrc === 'FOLLOWING' && pfN === 0 &&
          pE?.data?.homeFeed?.source === 'EXPLORE' && (pE?.data?.homeFeed?.items ?? []).length > 0 &&
          pA?.data?.homeFeed?.source === 'EXPLORE',
        `probe follow ${nFollowing} người · ép FOLLOWING → source=${pfSrc} ${pfN} pin (phải 0 + FOLLOWING) · ` +
          `ép EXPLORE → source=${pE?.data?.homeFeed?.source} ${(pE?.data?.homeFeed?.items ?? []).length} pin · auto → source=${pA?.data?.homeFeed?.source}` +
          (pF?.errors ? ` · LỖI: ${pF.errors[0].message}` : ''),
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §6b.3 — isBlockedByViewer (MỘT chiều) + blockedUsers (MỘT chiều)
  // Vòng chặn→bỏ chặn john, có restore đầy đủ ở cuối (như bước 65).
  // ══════════════════════════════════════════════════════════════════════════
  h.setGroup('GQL/social');

  const readBlockState = async () => {
    const [prof, list, sug] = await Promise.all([
      h.silent(Q_PROFILE, { u: USERS.john.username }, state.T1),
      h.silent(Q_BLOCKED, {}, state.T1),
      h.silent(Q_SUGGEST, { f: 10, u: USERS.bao.id }, state.T1),
    ]);
    return {
      err: prof?.errors?.[0]?.message ?? list?.errors?.[0]?.message ?? null,
      isBlocked: prof?.data?.userByUsername?.isBlockedByViewer ?? null,
      listIds: (list?.data?.blockedUsers?.items ?? []).map((u) => u.id),
      sugIds: (sug?.data?.suggestedUsers ?? []).map((u) => u.id),
    };
  };

  // Trước block: john KHÔNG bị chặn, KHÔNG trong blockedUsers.
  const preBlock = await readBlockState();
  h.assert(
    'trước block: isBlockedByViewer(john)=false và john KHÔNG có trong blockedUsers',
    !preBlock.err && preBlock.isBlocked === false && !preBlock.listIds.includes(USERS.john.id),
    preBlock.err ? `LỖI: ${preBlock.err}` : `isBlockedByViewer=${preBlock.isBlocked} · blockedUsers=[${preBlock.listIds.join(',')}]`,
  );

  h.setGroup('GQL/mut');
  await gql('blockUser (bao → john) [fe6]', `mutation($u:String!){ blockUser(userId:$u) }`, { u: USERS.john.id }, { token: state.T1 });

  h.setGroup('GQL/social');
  const postBlock = await readBlockState();
  h.assert(
    'sau block: isBlockedByViewer(john)=true · blockedUsers CÓ john · suggestedUsers KHÔNG có john (dù block vừa unfollow)',
    !postBlock.err &&
      postBlock.isBlocked === true &&
      postBlock.listIds.includes(USERS.john.id) &&
      !postBlock.sugIds.includes(USERS.john.id),
    postBlock.err
      ? `LỖI: ${postBlock.err}`
      : `isBlockedByViewer=${postBlock.isBlocked} · blockedUsers=[${postBlock.listIds.join(',')}] · ` +
        `john trong gợi ý? ${postBlock.sugIds.includes(USERS.john.id)} (phải false — bị chặn thì không gợi ý)`,
  );

  // isBlockedByViewer MỘT chiều: john bị bao chặn, nhưng theo CHIỀU của john thì
  // "john có chặn bao không" = false. Đây là phép phân biệt bản một-chiều với
  // bản hai-chiều getBlockedUserIds (nếu dùng nhầm bản 2-chiều, chiều này = true).
  {
    const johnView = await h.silent(Q_PROFILE, { u: USERS.bao.username }, state.T3);
    const jvBlocked = johnView?.data?.userByUsername?.isBlockedByViewer;
    h.assert(
      'MỘT chiều: bao chặn john ⇒ theo token JOHN, isBlockedByViewer(bao)=false (john chưa chặn ai)',
      !johnView?.errors && jvBlocked === false,
      johnView?.errors ? `LỖI: ${johnView.errors[0].message}` : `john nhìn bao: isBlockedByViewer=${jvBlocked} (phải false)`,
    );
  }

  h.setGroup('GQL/mut');
  await gql('unblockUser (bao → john) [fe6]', `mutation($u:String!){ unblockUser(userId:$u) }`, { u: USERS.john.id }, { token: state.T1 });

  h.setGroup('GQL/social');
  const postUnblock = await readBlockState();
  h.assert(
    'sau unblock: isBlockedByViewer(john)=false và blockedUsers KHÔNG còn john',
    !postUnblock.err && postUnblock.isBlocked === false && !postUnblock.listIds.includes(USERS.john.id),
    postUnblock.err ? `LỖI: ${postUnblock.err}` : `isBlockedByViewer=${postUnblock.isBlocked} · blockedUsers=[${postUnblock.listIds.join(',')}]`,
  );

  // ─── Restore: dựng lại 2 cạnh bao↔john mà blockUser đã xoá (như bước 65) ────
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: USERS.john.id }, state.T1);
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: USERS.bao.id }, state.T3);

  const back = await h.silent(
    `query($u:String!){ userByUsername(username:$u){ id isFollowedByViewer isFollowingViewer } }`,
    { u: USERS.john.username },
    state.T1,
  );
  const rel = back?.data?.userByUsername;
  const restored = rel?.isFollowedByViewer === true && rel?.isFollowingViewer === true;
  h.assert(
    'đã dựng lại mutual follow bao↔john mà blockUser xoá (tiền đề của bước 67 + lần chạy sau)',
    restored,
    rel ? `bao→john=${rel.isFollowedByViewer} · john→bao=${rel.isFollowingViewer}` : 'không đọc được quan hệ',
  );

  // Bước 67 phụ thuộc cạnh follow bao↔john, nên chỉ đi tiếp khi đã khôi phục.
  return restored;
}
