// Bước 90 — Bảo mật không-token + khối xoá cắt ngang module
//
// VÌ SAO CÓ BƯỚC NÀY (lệch so với 6 bước mà PLAN_P1.md liệt kê):
// khối xoá trong bản gốc chạy CUỐI CÙNG và cắt ngang nhiều module, nên không
// nhét gọn vào bước nào được:
//   • `deletePin`  phải sau bước 40 — comment cần pin còn sống.
//   • `unfollow`   phải sau bước 50 và 70 — DM cần mutual follow còn sống.
// Tài nguyên NỘI BỘ một bước (board, section, comment, message) thì bước đó tự
// dọn ở cuối; chỉ thứ cắt ngang mới lên đây.

import { API } from '../lib/client.mjs';
import { PASSWORD } from '../lib/seedrefs.mjs';

export default async function (h) {
  const { gql, rest, state } = h;

  // ─── guard: thiếu token phải bị chặn ───
  h.setGroup('GQL/security');
  await gql(
    'createPin không token → 401',
    `mutation($i:CreatePinInput!){ createPin(input:$i){ id } }`,
    { i: { imageUrl: 'http://localhost/x.jpg', imageWidth: 1, imageHeight: 1 } },
    { expect: /Unauthorized/ },
  );
  await gql('me không token → 401', `{ me { id } }`, {}, { expect: /Unauthorized/ });

  // ─── xoá thứ cắt ngang module ───
  h.setGroup('GQL/mut');
  await gql('deletePin', `mutation($id:ID!){ deletePin(id:$id){ id } }`, { id: state.PIN }, { token: state.T1 });
  await gql('unfollow', `mutation($u:String!){ unfollow(userId:$u) }`, { u: state.ME2 }, { token: state.T1 });

  // ─── soft delete + KHÔNG được đăng nhập lại (P0 #4) ───
  //
  // Đây là phép kiểm tra đắt nhất trong bộ này. Lỗ hổng gốc: middleware
  // soft-delete CỐ Ý không chặn `findUnique`, mà `login()` lại dùng
  // `findUnique` ⇒ tài khoản đã xoá vẫn đăng nhập được. Build hoàn toàn sạch.
  // Xem AGENT_HANDOFF.md §3.3.
  const probeLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: state.probeEmail, password: PASSWORD }),
  });
  const pl = await probeLogin.json().catch(() => null);

  if (pl?.accessToken) {
    await gql('deleteAccount (user probe)', `mutation{ deleteAccount }`, {}, { token: pl.accessToken });

    const re = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: state.probeEmail, password: PASSWORD }),
    });
    h.setGroup('GQL/security');
    h.rec(
      'tài khoản đã xoá KHÔNG đăng nhập lại được (P0 #4)',
      re.ok ? 'FAIL' : 'OK',
      re.ok ? `vẫn vào được ${re.status}` : `bị chặn ${re.status}`,
    );
  } else {
    h.rec('deleteAccount (user probe)', 'FAIL', 'không đăng nhập được user probe');
  }

  h.setGroup('REST/auth');
  await rest('POST /auth/logout', 'POST', '/auth/logout', {
    token: state.T1,
    body: { refreshToken: state.refreshToken },
  });

  return true;
}
