import { ResetForm } from './reset-form';

/**
 * A4 — Đặt lại mật khẩu. `?token=` nằm ở query string; `searchParams` là Promise
 * (bẫy #6) ⇒ await. Không có token ⇒ ResetForm hiện trạng thái `notoken`.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const t = typeof token === 'string' ? token : Array.isArray(token) ? token[0] : undefined;
  return <ResetForm token={t ?? null} />;
}
