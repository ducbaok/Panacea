import { CircleDetailView } from '@/components/settings/circle-detail-view';

/**
 * XH-CIRCLES · chi tiết một vòng. `params` là **Promise** ở bản Next của repo
 * này (bẫy 6 của `PLAN_FRONTEND.md` §4 — đọc `params.id` thẳng cho `undefined`
 * mà KHÔNG báo lỗi).
 */
export default async function CircleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CircleDetailView id={id} />;
}
