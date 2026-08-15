import { VerifyView } from './verify-view';

/**
 * A5 — Xác minh email. `?token=` ở query string (Promise — await). Không có
 * token ⇒ trạng thái `notoken`. Màn KHÔNG tự gọi API lúc mở (§4.2 — bắt bấm nút,
 * chống mail client prefetch tiêu mất token).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const t = typeof token === 'string' ? token : Array.isArray(token) ? token[0] : undefined;
  return <VerifyView token={t ?? null} />;
}
