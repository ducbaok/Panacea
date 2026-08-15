import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import { BottomTabBar } from '@/components/shell/bottom-tab-bar';
import { ScrollRestorer } from '@/components/auth/scroll-restorer';

/**
 * Layout của nhóm route `(main)` — shell chính có Sidebar + TopBar + BottomTabBar.
 * Nhóm này bao mọi màn của sản phẩm (khung-ui-ux §2). Nhóm `(auth)` sẽ dựng ở
 * FE-5, KHÔNG có shell (căn giữa, không Sidebar/TopBar).
 *
 * Parallel route `@modal`:
 *   • Slot `modal` nhận nội dung từ `app/(main)/@modal/(.)pin/[id]/page.tsx`
 *     (sẽ dựng ở FE-4 khi làm chi tiết pin).
 *   • `@modal/default.tsx` trả null ⇒ khi không có modal, slot rỗng, không
 *     render gì thêm.
 *   • Dựng khung slot NGAY từ FE-2 (không đợi FE-4) vì thêm parallel route sau
 *     khi đã có 5 màn dùng layout sẽ phải sửa lại layout — mỗi lần sửa phải
 *     kiểm lại 5 chỗ.
 *
 * KHÔNG dùng 'use client' — layout chỉ compose 3 client component; giữ ở tầng
 * server để không kéo react hooks vào bundle root của route.
 *
 * padding-bottom mobile: dành 80px cho BottomTabBar (fixed) khỏi đè nội dung.
 * Trên md+ (>=768px), tab bar ẩn ⇒ md:pb-0.
 */
export default function MainLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
      </div>
      {modal}
      <BottomTabBar />
      <ScrollRestorer />
    </div>
  );
}
