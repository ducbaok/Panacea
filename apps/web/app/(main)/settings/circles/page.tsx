import { CirclesListView } from '@/components/settings/circles-list-view';

/**
 * XH-CIRCLES — quản lý vòng tròn. Route con của `/settings` nên đã nằm trong
 * matcher `'/settings/:path*'` của `proxy.ts` ⇒ khách bị đẩy sang /login, không
 * cần guard riêng ở đây (cùng tiền lệ với `/settings/blocked`).
 */
export default function CirclesPage() {
  return <CirclesListView />;
}
