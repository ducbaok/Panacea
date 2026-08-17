import { notFound } from 'next/navigation';
import { FollowsView } from '@/components/profile/follows-view';

/**
 * C3 tab "followers" — `/@username/followers` (QĐ-C).
 *
 * Cùng component với `.../following`; tab suy từ SEGMENT nên F5/back/chia sẻ link
 * đều giữ đúng tab (xem follows-view.tsx).
 *
 * 🔴 Hai bẫy đã trả giá ở các đợt trước, đừng lặp:
 *   1. Thư mục là `[handle]`, `@` nằm trong GIÁ TRỊ handle — thư mục mở đầu `@`
 *      là parallel route slot của App Router (§4 bẫy 7).
 *   2. `params` là Promise ở Next 16 ⇒ `await params`. Đọc `params.handle` đồng
 *      bộ cho `undefined` mà KHÔNG báo lỗi (§4 bẫy 6).
 *
 * Auth TUỲ CHỌN — route này CỐ Ý không nằm trong proxy.ts matcher (khách xem
 * được danh sách, chỉ nút Theo dõi mới bị AuthPrompt chặn).
 */
export default async function FollowersPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  if (!decoded.startsWith('@')) notFound();
  const username = decoded.slice(1);
  if (!username) notFound();
  return <FollowsView username={username} tab="followers" />;
}
