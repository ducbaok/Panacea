import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { resendVerification, BackendHttpError } from '@/lib/auth-backend';

/**
 * Gửi lại email xác thực (A5). Nhận diện người dùng hai đường (spec §6.3):
 *   (a) `{ token }` cũ trong body — tra ngược chủ nhân, dùng cho KHÁCH ở trạng
 *       thái hết hạn;
 *   (c) phiên đăng nhập — forward `session.accessToken` thành Bearer, dùng cho
 *       người ĐANG đăng nhập ở mọi trạng thái.
 * Backend chặn tần suất 60s ⇒ 429 → reason 'rate-limited'.
 */
export async function POST(req: Request) {
  let token: string | undefined;
  try {
    const body = await req.json();
    if (body?.token) token = String(body.token);
  } catch {
    // Body rỗng hợp lệ khi đi đường (c).
  }

  const session = await auth();
  const accessToken = session?.accessToken;

  try {
    await resendVerification(token, accessToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendHttpError) {
      if (err.statusCode === 429) return NextResponse.json({ ok: false, reason: 'rate-limited' });
      return NextResponse.json({ ok: false, reason: 'invalid' });
    }
    return NextResponse.json({ ok: false, reason: 'network' });
  }
}
