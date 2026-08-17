import { notFound } from 'next/navigation';
import { FollowsView } from '@/components/profile/follows-view';

/**
 * C3 tab "following" — `/@username/following` (QĐ-C). Song sinh với
 * `.../followers`: cùng component, khác `tab`, khác chữ rỗng ("Chưa theo dõi ai"
 * vs "Chưa có ai theo dõi").
 *
 * Bẫy `[handle]` + `await params`: xem ghi chú ở `followers/page.tsx`.
 */
export default async function FollowingPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  if (!decoded.startsWith('@')) notFound();
  const username = decoded.slice(1);
  if (!username) notFound();
  return <FollowsView username={username} tab="following" />;
}
