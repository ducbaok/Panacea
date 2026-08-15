import { NextResponse } from 'next/server';
import { resetPassword, BackendHttpError } from '@/lib/auth-backend';

/**
 * A4 đặt lại mật khẩu. Backend phân biệt token SAI với token HẾT HẠN:
 *   400 "Invalid or expired reset token"  → reason 'invalid' (thường là copy thiếu)
 *   400 "Reset token expired"             → reason 'expired' (xin liên kết mới)
 *
 * ⚠️ Cả hai chuỗi đều chứa từ "expired" — phân biệt bằng "invalid" TRƯỚC: chỉ
 * chuỗi token-sai mới chứa "invalid".
 */
export async function POST(req: Request) {
  let token = '';
  let password = '';
  try {
    const body = await req.json();
    token = String(body?.token ?? '');
    password = String(body?.password ?? '');
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' });
  }

  try {
    await resetPassword(token, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendHttpError) {
      const body = err.bodyText.toLowerCase();
      if (body.includes('invalid')) return NextResponse.json({ ok: false, reason: 'invalid' });
      if (body.includes('expired')) return NextResponse.json({ ok: false, reason: 'expired' });
      // 400 mật khẩu < 8 (§6.2) — A4 đã chặn ở client; fallback về 'invalid'.
      return NextResponse.json({ ok: false, reason: 'invalid' });
    }
    return NextResponse.json({ ok: false, reason: 'network' });
  }
}
