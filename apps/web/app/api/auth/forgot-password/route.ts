import { NextResponse } from 'next/server';
import { forgotPassword, BackendHttpError } from '@/lib/auth-backend';

/**
 * A3 quên mật khẩu. Backend LUÔN 204 kể cả email không tồn tại (không tiết lộ) ⇒
 * `ok:true` là kết quả duy nhất cho cả hai trường hợp. A3 KHÔNG có trạng thái
 * "không tìm thấy email" (§4.5 — phá quyết định bảo mật có chủ đích).
 */
export async function POST(req: Request) {
  let email = '';
  try {
    email = String((await req.json())?.email ?? '');
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' });
  }

  try {
    await forgotPassword(email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // 400 chỉ xảy ra khi email sai định dạng (@IsEmail) — A3 đã chặn ở client.
    if (err instanceof BackendHttpError) return NextResponse.json({ ok: false, reason: 'invalid' });
    return NextResponse.json({ ok: false, reason: 'network' });
  }
}
