import { NextResponse } from 'next/server';
import { loginWithPassword, BackendHttpError } from '@/lib/auth-backend';

/**
 * FE-5 §4.2 Direction A — cửa đăng nhập mật khẩu GIỮ NGUYÊN lỗi backend.
 *
 * Vì sao KHÔNG đăng nhập thẳng qua Credentials provider: `authorize()` của
 * Auth.js v5 buộc phải trả `null` khi lỗi, và v5 làm phẳng mọi lỗi credentials
 * về đúng một `CredentialsSignin` (chống dò tài khoản). Hệ quả: 401 / 403-khoá /
 * lỗi mạng ra cùng một kết quả ⇒ 3/4 trạng thái lỗi ở A2 không hiện đúng.
 *
 * Ở đây route handler gọi thẳng backend, đọc status + body NGUYÊN VẸN, rồi quy
 * về `reason` để A2 render đúng 4 trạng thái. Client CHỈ gọi `signIn('credentials')`
 * SAU KHI route này trả `ok:true` — nên nhánh nuốt-lỗi của `authorize()` chỉ còn
 * chạy trên đường thành công.
 *
 * ⚠️ KHÔNG trả token pair về client: để client tự cầm token rồi nhét vào
 * `signIn` là mở cửa giả mạo phiên (ai cũng gọi được signIn với token bịa). Đổi
 * lại, đường thành công tốn thêm đúng một lần /auth/login bên trong `authorize()`
 * — login thành công tự xoá bộ đếm brute-force nên KHÔNG lệch số lần khoá.
 */
export async function POST(req: Request) {
  let email = '';
  let password = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '');
    password = String(body?.password ?? '');
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' });
  }

  try {
    await loginWithPassword(email, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendHttpError) {
      const body = err.bodyText.toLowerCase();
      if (err.statusCode === 403 && body.includes('too many failed attempts')) {
        // Lần sai thứ 5 — khoảnh khắc ĐẶT khoá (chưa có số giây trong thông điệp).
        return NextResponse.json({ ok: false, reason: 'just-locked' });
      }
      if (err.statusCode === 403 && body.includes('temporarily locked')) {
        // "Account temporarily locked. Try again in {n}s." — nhánh ĐỌC khoá.
        const m = body.match(/(\d+)\s*s/);
        return NextResponse.json({
          ok: false,
          reason: 'locked',
          retryAfterSec: m ? Number(m[1]) : 900,
        });
      }
      // 401 sai mật khẩu · 400 mật khẩu < 8 (§3.2 → hiện như sai thông tin) ·
      // 403 "This account has been deleted" → gộp về một thông điệp trung tính.
      return NextResponse.json({ ok: false, reason: 'invalid' });
    }
    return NextResponse.json({ ok: false, reason: 'network' });
  }
}
