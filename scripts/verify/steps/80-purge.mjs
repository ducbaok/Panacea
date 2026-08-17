// Bước 80 — B-9: hard-delete tài khoản đã xoá mềm quá hạn ân hạn
//
// ⚠️ ĐÂY LÀ BƯỚC DUY NHẤT TRONG BỘ VERIFY GỌI MỘT LỆNH XOÁ CỨNG CÓ CASCADE.
// Đọc `apps/api/src/maintenance/purge.service.ts` trước khi sửa gì ở đây.
//
// VÌ SAO BƯỚC NÀY TỒN TẠI ĐƯỢC (và vì sao B-9 có endpoint chứ không chỉ @Cron):
// một `@Cron` thuần không có bề mặt nào để gọi vào, nên bằng chứng mạnh nhất
// trình được sẽ là "gọi thẳng method trong service" — đúng loại bằng chứng mà
// dự án đã ba lần trả giá vì tin. `POST /internal/purge-deleted` biến job này
// thành thứ kiểm được bằng **request thật**. Phân tích đầy đủ: `LEARNING_NOTES.md` §30.
//
// AN TOÀN CỦA CHÍNH BƯỚC NÀY:
//   • Nó chỉ chạm tài khoản có `deletedAt` khác NULL. 5 tài khoản seed
//     (bao/alice/john/jane/bob) có `deletedAt = NULL` nên KHÔNG THỂ lọt vào
//     danh sách ứng viên — và phép kiểm bên dưới khẳng định điều đó tường minh
//     thay vì tin tưởng.
//   • Tài khoản probe của bước 00 lúc này VẪN CHƯA bị xoá mềm (bước 90 mới
//     `deleteAccount` nó), nên bước này không thể cướp mất tiền đề của bước 90.
//   • `graceDays: 0` chỉ được server chấp nhận ngoài production — xem
//     `purge.service.ts`.

import { API, readApiEnv } from '../lib/client.mjs';

const PURGE_PATH = '/internal/purge-deleted';

export default async function (h) {
  const { gql, rest, state } = h;
  const secret = readApiEnv('INTERNAL_API_SECRET');

  h.setGroup('REST/purge');

  if (!secret) {
    // Không đọc được secret ⇒ KHÔNG ĐO ĐƯỢC, không phải ĐẠT. Đúng luật SKIP.
    h.rec('B-9 purge', 'SKIP', 'không đọc được INTERNAL_API_SECRET từ apps/api/.env');
    return true;
  }

  // ─── 1. Cổng bảo mật ────────────────────────────────────────────────────────
  // `match` là bắt buộc, không phải trang trí: một 403 có thể đến từ lý do hoàn
  // toàn khác (ValidationPipe, throttler) và phép kiểm vẫn xanh — đúng hình dạng
  // đã để Bug D sống nhiều tháng (`docs/debug_history.md` §2).
  await rest('POST /internal/purge-deleted KHÔNG secret → 403', 'POST', PURGE_PATH, {
    body: {},
    expect: [403],
    match: /invalid internal secret/i,
  });
  await rest('POST /internal/purge-deleted secret SAI → 403', 'POST', PURGE_PATH, {
    body: {},
    headers: { 'x-internal-secret': 'khong-phai-secret-that' },
    expect: [403],
    match: /invalid internal secret/i,
  });

  const purge = async (body) => {
    const r = await fetch(`${API}${PURGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  // ─── 2. Dựng tài khoản throwaway CÓ dữ liệu để cascade có việc làm ──────────
  const uniq = `${Date.now().toString(36)}`;
  const email = `purge_${uniq}@example.com`;
  const reg = await rest('đăng ký tài khoản throwaway cho B-9', 'POST', '/auth/register', {
    body: { email, password: 'password123', name: 'Purge Probe' },
  });
  const TP = reg?.accessToken;
  if (!TP) {
    h.rec('B-9 purge', 'FAIL', 'không đăng ký được tài khoản throwaway');
    return true;
  }
  const meP = await h.silent(`{ me { id } }`, {}, TP);
  const UID = meP?.data?.me?.id;

  // Dữ liệu sẽ bị cascade cuốn theo. Comment đặt trên `pin_1_id` (của bao) là có
  // chủ đích: nó nằm ở bảng của NGƯỜI KHÁC, nên sự biến mất của nó chứng minh
  // cascade thật sự chạy chứ không phải "xoá mọi thứ thuộc user rồi thôi".
  const cp = await h.silent(
    `mutation($i:CreatePinInput!){ createPin(input:$i){ id } }`,
    { i: { imageUrl: 'http://localhost/purge-probe.png', imageWidth: 64, imageHeight: 64, title: `purge probe ${uniq}` } },
    TP,
  );
  const PPIN = cp?.data?.createPin?.id;
  const cc = await h.silent(
    `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
    { i: { pinId: 'pin_1_id', content: `purge probe comment ${uniq}` } },
    TP,
  );
  const PCOMMENT = cc?.data?.createComment?.id;

  h.assert(
    'dựng được tài khoản throwaway kèm pin + comment (tiền đề của phép cascade)',
    Boolean(UID && PPIN && PCOMMENT),
    `user=${UID} pin=${PPIN} comment=${PCOMMENT}`,
  );

  // Chụp lại: comment CÓ mặt trên pin của bao trước khi xoá.
  // ⚠️ `pinId` của `pinComments` khai `String!`, KHÔNG phải `ID!`
  // (`schema.graphql:275`) — khác hẳn `pin(id: ID!)`. Truyền nhầm kiểu thì
  // GraphQL **từ chối cả query** và `items` về rỗng, trông y hệt "comment đã
  // biến mất" ⇒ phép cascade sẽ XANH GIẢ. Đúng bẫy 7 ghi ở đầu `65-blocking.mjs`,
  // và nó đã đỏ thật một lần ở đây (17/08) trước khi sửa kiểu.
  // Vì vậy phép kiểm bên dưới khẳng định CẢ HAI đầu: trước=có VÀ sau=không.
  const seeComment = async () => {
    const r = await h.silent(
      `query($p:String!){ pinComments(pinId:$p, first:50){ items{ id } } }`,
      { p: 'pin_1_id' },
      state.T1,
    );
    if (r?.errors) return { ok: false, has: false, err: r.errors[0].message };
    return { ok: true, has: (r?.data?.pinComments?.items ?? []).some((c) => c.id === PCOMMENT) };
  };
  const commentBefore = await seeComment();

  await h.silent(`mutation{ deleteAccount }`, {}, TP);

  // ─── 3. PHÉP QUYẾT ĐỊNH: hạn ân hạn 30 ngày THẬT SỰ có tác dụng ────────────
  //
  // Đây là phép duy nhất phân biệt "job có xoá" với "job xoá ĐÚNG cái được
  // phép xoá". Một bản cài đặt quên mệnh đề thời gian sẽ xoá sạch mọi tài
  // khoản vừa xoá mềm — và MỌI phép kiểm khác ở bước này vẫn xanh trọn vẹn.
  const d30 = await purge({ dryRun: true });
  h.assert(
    'grace 30 ngày (mặc định): tài khoản vừa xoá mềm KHÔNG nằm trong danh sách purge',
    d30.status === 200 && d30.body.graceDays === 30 && !d30.body.userIds.includes(UID),
    `graceDays=${d30.body?.graceDays} found=${d30.body?.found} · có user vừa xoá? ${d30.body?.userIds?.includes(UID)}`,
  );

  // ─── 4. graceDays=0 ⇒ thấy nó; và dry-run KHÔNG được xoá gì ────────────────
  const dryA = await purge({ dryRun: true, graceDays: 0 });
  h.assert(
    'graceDays=0: danh sách purge CÓ tài khoản vừa xoá mềm',
    dryA.status === 200 && dryA.body.dryRun === true && dryA.body.userIds.includes(UID),
    `found=${dryA.body?.found} purged=${dryA.body?.purged} · có user? ${dryA.body?.userIds?.includes(UID)}`,
  );
  h.assert(
    'dry-run KHÔNG xoá gì (purged=0, và lần gọi sau vẫn thấy đúng tài khoản đó)',
    dryA.body.purged === 0 && (await purge({ dryRun: true, graceDays: 0 })).body.userIds.includes(UID),
    `purged=${dryA.body?.purged}`,
  );

  // Tài khoản seed KHÔNG BAO GIỜ được lọt vào danh sách — chúng có deletedAt=NULL.
  h.assert(
    'không tài khoản seed nào lọt vào danh sách purge (kể cả graceDays=0)',
    dryA.body.userIds.every((id) => !/^user_\d+_id$/.test(id)),
    `ứng viên=[${dryA.body.userIds.join(',')}]`,
  );

  // ─── 5. Xoá THẬT ───────────────────────────────────────────────────────────
  const real = await purge({ dryRun: false, graceDays: 0 });
  h.assert(
    'xoá thật: tài khoản throwaway bị hard-delete (purged khớp found)',
    real.status === 200 &&
      real.body.dryRun === false &&
      real.body.userIds.includes(UID) &&
      real.body.purged === real.body.found &&
      real.body.purged >= 1,
    `found=${real.body?.found} purged=${real.body?.purged} capped=${real.body?.capped}`,
  );

  // Biến mất khỏi bảng `User` — đọc lại qua chính danh sách ứng viên.
  const afterList = await purge({ dryRun: true, graceDays: 0 });
  h.assert(
    'sau purge: tài khoản KHÔNG còn trong bảng User (không còn là ứng viên)',
    !afterList.body.userIds.includes(UID),
    `còn ${afterList.body.found} ứng viên khác`,
  );

  // ─── 6. CASCADE chạm sang dữ liệu nằm ở bảng của NGƯỜI KHÁC ────────────────
  const commentAfter = await seeComment();
  h.assert(
    'cascade: comment của tài khoản đã purge biến mất khỏi pin của bao (trước=CÓ, sau=KHÔNG)',
    commentBefore.ok && commentAfter.ok && commentBefore.has === true && commentAfter.has === false,
    !commentBefore.ok || !commentAfter.ok
      ? `QUERY LỖI (không phải bằng chứng cascade): ${commentBefore.err ?? commentAfter.err}`
      : `trước purge: ${commentBefore.has ? 'có' : 'KHÔNG'} · sau purge: ${commentAfter.has ? 'VẪN CÒN' : 'đã mất'}`,
  );

  const pinGone = await h.silent(`query($id:ID!){ pin(id:$id){ id } }`, { id: PPIN }, state.T1);
  h.assert(
    'cascade: pin của tài khoản đã purge không còn đọc được',
    !pinGone?.data?.pin,
    pinGone?.data?.pin ? `VẪN ĐỌC ĐƯỢC: ${pinGone.data.pin.id}` : `không còn (${pinGone?.errors?.[0]?.message ?? 'null'})`,
  );

  // ─── 7. Tài khoản mốc vẫn sống nguyên sau một lệnh xoá cứng ────────────────
  const baoAlive = await gql('bao vẫn đăng nhập/đọc được sau khi job purge chạy thật', `{ me { id username } }`, {}, { token: state.T1 });
  h.assert(
    'purge KHÔNG đụng tài khoản mốc (bao còn nguyên)',
    baoAlive?.me?.id === 'user_1_id',
    `me.id=${baoAlive?.me?.id}`,
  );

  // ─── 8. Mặc định an toàn: body rỗng ⇒ dry-run ─────────────────────────────
  const bare = await purge({});
  h.assert(
    'body rỗng ⇒ dryRun mặc định TRUE (xoá thật phải yêu cầu tường minh)',
    bare.body.dryRun === true && bare.body.purged === 0 && bare.body.graceDays === 30,
    `dryRun=${bare.body?.dryRun} purged=${bare.body?.purged} graceDays=${bare.body?.graceDays}`,
  );

  return true;
}
