import { HomeView } from '@/components/home/home-view';

/**
 * B1 — Trang chủ (FE-6).
 *
 * Hai trạng thái (`HomeFeed.source`): FOLLOWING / EXPLORE cho người đã đăng
 * nhập; khách vãng lai thấy nội dung Khám phá. Toàn bộ logic ở `HomeView`
 * (client) vì Apollo là client-only (FE-0). Xem components/home/home-view.tsx.
 *
 * FE-4 nối `onOpen` bằng router.push('/pin/'+id) ⇒ intercepting route
 * `@modal/(.)pin/[id]` chặn ⇒ modal đè lưới. Giữ nguyên ở FE-6.
 */
export default function Home() {
  return <HomeView />;
}
