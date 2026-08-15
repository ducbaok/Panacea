import { NextResponse } from 'next/server';
import { verifyEmail, BackendHttpError } from '@/lib/auth-backend';

/**
 * A5 xác minh email — gọi POST /auth/verify-email (KHÔNG phải GET, route GET đã
 * xoá ở §6.4). Backend ba nhánh lỗi:
 *   404 "Invalid verification token" → 'invalid'  (token không tồn tại)
 *   400 "Token expired"              → 'expired'  (có nút gửi lại — token cũ vẫn tra ngược được)
 *   400 "Invalid token"              → 'malformed' (thiếu userId — gộp UI với 'invalid')
 */
export async function POST(req: Request) {
  let token = '';
  try {
    token = String((await req.json())?.token ?? '');
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' });
  }

  try {
    await verifyEmail(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendHttpError) {
      const body = err.bodyText.toLowerCase();
      if (err.statusCode === 404) return NextResponse.json({ ok: false, reason: 'invalid' });
      if (body.includes('expired')) return NextResponse.json({ ok: false, reason: 'expired' });
      return NextResponse.json({ ok: false, reason: 'malformed' });
    }
    return NextResponse.json({ ok: false, reason: 'network' });
  }
}
