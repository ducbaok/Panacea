import { NextResponse } from 'next/server';
import { registerAccount, BackendHttpError } from '@/lib/auth-backend';

/**
 * A1 đăng ký. Tạo tài khoản qua /auth/register; client sẽ `signIn('credentials')`
 * ngay sau `ok:true` để vào phiên (T2.5 — đăng ký xong tự đăng nhập).
 *
 * `RegisterDto` đòi `name` (2..50) ⇒ A1 BẮT BUỘC có ô "Tên hiển thị" (§4.1), nếu
 * không backend 400 ngay tại cửa.
 */
export async function POST(req: Request) {
  let email = '';
  let password = '';
  let name = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '');
    password = String(body?.password ?? '');
    name = String(body?.name ?? '');
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' });
  }

  try {
    await registerAccount(email, password, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendHttpError) {
      if (err.statusCode === 409) return NextResponse.json({ ok: false, reason: 'email-taken' });
      // 400 — ràng buộc field (email/password/name) không hợp lệ.
      return NextResponse.json({ ok: false, reason: 'invalid' });
    }
    return NextResponse.json({ ok: false, reason: 'network' });
  }
}
