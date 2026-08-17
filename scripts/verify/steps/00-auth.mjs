// Bước 00 — REST: auth, device-tokens, internal, uploads (16 endpoint)
//
// Bước này thiết lập `state.T1/T2/T3` (token của bao/alice/john) cho MỌI bước
// sau. Nó thất bại ⇒ toàn bộ phần còn lại vô nghĩa, nên run-all sẽ dừng sớm.

import { makePng } from '../lib/client.mjs';
import { USERS, PASSWORD, SEED } from '../lib/seedrefs.mjs';

export default async function (h) {
  const { rest, state } = h;
  const uniq = Date.now().toString(36);
  state.uniq = uniq;
  state.probeEmail = `probe_${uniq}@example.com`;

  // ─── HT-3 #2 — health check phải TỒN TẠI và phải CHẠM dependency ──────────
  //
  // Vì sao đây là bản ghi verify chứ không phải "kiểm một lần rồi thôi": hình
  // dạng hỏng đã xảy ra thật là **endpoint không tồn tại**. `AppController` là
  // di sản `nest new` và **chưa từng được đăng ký** trong `AppModule`, nên
  // `GET /` trả 404 suốt nhiều tháng mà không ai biết — kể cả `PLAN_HATANG.md`
  // §1 cũng mô tả nhầm là "chỉ có getHello()". Một endpoint biến mất là thứ
  // không tính năng nào khác báo động hộ, còn trên ECS thì nó nghĩa là **không
  // task nào từng healthy**.
  h.setGroup('REST/health');
  {
    const hz = await rest('GET /health → 200', 'GET', '/health');
    h.assert(
      'health CHẠM THẬT tới DB và Redis (không phải endpoint rỗng trả 200)',
      hz?.status === 'ok' && hz?.db?.ok === true && hz?.redis?.ok === true,
      `status=${hz?.status} db=${JSON.stringify(hz?.db)} redis=${JSON.stringify(hz?.redis)}`,
    );
  }

  h.setGroup('REST/auth');

  await rest('POST /auth/register', 'POST', '/auth/register', {
    body: { email: state.probeEmail, password: PASSWORD, name: 'Probe User' },
  });

  const l1 = await rest('POST /auth/login (bao)', 'POST', '/auth/login', {
    body: { email: USERS.bao.email, password: PASSWORD },
  });
  state.T1 = l1?.accessToken;
  state.refreshToken = l1?.refreshToken;

  const l2 = await rest('POST /auth/login (alice)', 'POST', '/auth/login', {
    body: { email: USERS.alice.email, password: PASSWORD },
  });
  state.T2 = l2?.accessToken;

  const l3 = await rest('POST /auth/login (john)', 'POST', '/auth/login', {
    body: { email: USERS.john.email, password: PASSWORD },
  });
  state.T3 = l3?.accessToken;

  await rest('GET /auth/me', 'GET', '/auth/me', { token: state.T1 });
  await rest('GET /auth/me (không token → 401)', 'GET', '/auth/me', {
    expect: [401],
    match: /Unauthorized/,
  });
  await rest('POST /auth/login (sai mật khẩu → 401)', 'POST', '/auth/login', {
    body: { email: USERS.bao.email, password: 'wrongpassword' },
    expect: [401, 403],
    match: /Invalid credentials/,
  });
  await rest('POST /auth/refresh', 'POST', '/auth/refresh', {
    body: { refreshToken: state.refreshToken },
  });
  await rest('POST /auth/forgot-password', 'POST', '/auth/forgot-password', {
    body: { email: USERS.bao.email },
  });
  await rest('POST /auth/reset-password (token rác → 4xx)', 'POST', '/auth/reset-password', {
    body: { token: 'bad-token', password: 'password456' },
    expect: [400, 401, 404],
    match: /Invalid or expired reset token/,
  });
  // GET /auth/verify-email ĐÃ XOÁ 15/08/2026 (spec §6.4): sau QĐ-1, link trong
  // email trỏ về màn A5 của WEB; lá chắn chống mail-client prefetch (bắt người
  // dùng bấm nút) nay do web giữ. Route không còn ⇒ 404. Logic thật vẫn ở POST.
  await rest('GET /auth/verify-email (đã xoá → 404, lá chắn prefetch chuyển sang web)', 'GET', '/auth/verify-email?token=bad-token', {
    expect: [404],
  });
  await rest('POST /auth/verify-email (token rác → 4xx)', 'POST', '/auth/verify-email', {
    body: { token: 'bad-token' },
    expect: [400, 401, 404],
    match: /Invalid verification token/,
  });

  // Phép kiểm tra này từng xanh VÌ SAI LÝ DO: `ExchangeDto` thiếu `@IsOptional()`
  // nên request chết ở ValidationPipe ("name must be a string") trước khi tới
  // lớp secret. Đã sửa DTO 04/08/2026 — regex dưới đây là bằng chứng request
  // giờ đi tới đúng nơi tên nó nói.
  await rest('POST /auth/exchange (secret sai → 4xx)', 'POST', '/auth/exchange', {
    body: { email: USERS.bao.email, provider: 'google', providerAccountId: 'x123' },
    expect: [400, 401, 403],
    match: /Invalid auth secret/,
  });
  await rest('POST /auth/google (idToken rác → 401)', 'POST', '/auth/google', {
    body: { idToken: 'fake' },
    expect: [400, 401, 403],
    match: /Invalid Google token/,
  });

  h.setGroup('REST/device');
  await rest('POST /device-tokens', 'POST', '/device-tokens', {
    token: state.T1,
    body: { token: `fcm-${uniq}`, platform: 'ANDROID' },
  });
  await rest('DELETE /device-tokens/:token', 'DELETE', `/device-tokens/fcm-${uniq}`, { token: state.T1 });

  h.setGroup('REST/internal');
  // Endpoint này từng CHẾT HOÀN TOÀN: `ProcessedDto` không có decorator
  // class-validator nào nên `forbidNonWhitelisted` chặn mọi payload, kể cả `{}`.
  // `_timingSafeCompare` (pins.controller.ts:73) chưa từng chạy. Đã sửa DTO
  // 04/08/2026.
  //
  // ⚠️ Payload phải HỢP LỆ thì request mới qua được ValidationPipe và chạm tới
  // lớp secret. Gửi `{}` như bản cũ giờ sẽ chết ở "thumbnailUrl should not be
  // empty" — vẫn là chết sai chỗ, đúng cái bẫy vừa gỡ.
  await rest('PATCH /internal/pins/:id/processed (không secret → 4xx)', 'PATCH', `/internal/pins/${SEED.pinId}/processed`, {
    body: {
      thumbnailUrl: 'https://example.com/t.jpg',
      mediumUrl: 'https://example.com/m.jpg',
      largeUrl: 'https://example.com/l.jpg',
    },
    expect: [400, 401, 403, 404],
    match: /Invalid internal secret/,
  });

  h.setGroup('REST/uploads');
  // S3 thật chưa cấu hình ⇒ 5xx là EXPECTED. Điều cần biết là route có tồn tại
  // và guard chạy qua, không phải là AWS có trả URL hay không.
  await rest('POST /uploads/presigned-url', 'POST', '/uploads/presigned-url', {
    token: state.T1,
    body: { contentType: 'image/jpeg', folder: 'pins' },
    expect: [403, 500, 502, 503],
  });

  const png = makePng(64);
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'probe.png');
  const up = await rest(`POST /uploads/local (${png.length} byte)`, 'POST', '/uploads/local', {
    token: state.T1,
    form: fd,
  });
  state.uploadedUrl = up?.url ?? up?.imageUrl ?? null;

  // Whitelist MIME (P0 #7) — .exe phải bị chặn dù kích thước hợp lệ
  const fdBad = new FormData();
  fdBad.append('file', new Blob([Buffer.alloc(2048, 0x41)], { type: 'application/x-msdownload' }), 'evil.exe');
  await rest('POST /uploads/local (MIME .exe → phải chặn)', 'POST', '/uploads/local', {
    token: state.T1,
    form: fdBad,
    expect: [400, 415, 422],
    match: /Unsupported file type/,
  });

  return Boolean(state.T1 && state.T2 && state.T3);
}
