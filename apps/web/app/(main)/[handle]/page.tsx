import { notFound } from 'next/navigation';
import { ProfileView } from '@/components/profile/profile-view';

/**
 * C1 — Hồ sơ (FE-6). Đường dẫn QĐ-C: `/@username`.
 *
 * 🔴 Thư mục PHẢI là `[handle]`, KHÔNG phải `@[username]` — thư mục mở đầu `@`
 * là parallel route slot của App Router (dự án đang dùng `@modal`), viết sai thì
 * route BIẾN MẤT không báo lỗi (PLAN_FRONTEND §1 QĐ-C, §4 bẫy 7).
 *
 * `handle` KHÔNG mở đầu `@` ⇒ notFound(). Chính việc 404 mọi thứ không có `@`
 * giữ cho route động ở gốc KHÔNG nuốt /explore, /settings… (route tĩnh khớp
 * trước route động cùng cấp).
 *
 * `params` là Promise ở Next 16 (`await params`). Guard `@` chạy ở server để
 * trả 404 sạch; dữ liệu hồ sơ nạp client-side (Apollo client-only, FE-0).
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  if (!decoded.startsWith('@')) notFound();
  const username = decoded.slice(1);
  if (!username) notFound();
  return <ProfileView username={username} />;
}
