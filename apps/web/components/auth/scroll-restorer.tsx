'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { RETURN_SCROLL_KEY } from './auth-prompt';

/**
 * Khôi phục vị trí cuộn sau vòng đăng nhập từ AuthPromptModal (§3.3, T2.4).
 * Đọc `sessionStorage[auth:returnScroll]`; nếu đường dẫn khớp trang hiện tại thì
 * cuộn về đúng chỗ.
 *
 * VÌ SAO PHẢI DAI: feed vô hạn dựng chiều cao BẤT ĐỒNG BỘ, và ngay sau đăng nhập
 * `ApolloProviderWithSession.resetStore()` chạy lại query ⇒ danh sách nháy loading
 * rồi mới cao trở lại. Nếu cuộn quá sớm (trang chưa đủ cao) thì `scrollTo` không
 * đi đâu và vị trí kẹt ở 0. Nên:
 *   • chỉ cuộn khi trang ĐÃ đủ cao (scrollHeight ≥ target),
 *   • thử lại tới ~5s,
 *   • CHỈ xoá cờ khi cuộn THÀNH CÔNG (hoặc hết giờ) — không xoá sớm.
 *
 * Chỉ dùng `usePathname` (không `useSearchParams`) để khỏi ép Suspense.
 */
export function ScrollRestorer() {
  const pathname = usePathname();

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(RETURN_SCROLL_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let saved: { path: string; y: number } | null = null;
    try {
      saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    if (!saved || typeof saved.y !== 'number') return;
    if (saved.path.split('?')[0] !== pathname) return;

    const targetY = saved.y;
    let done = false;
    let tries = 0;
    const MAX_TRIES = 45; // ~45 × 120ms ≈ 5.4s

    const clear = () => {
      try {
        sessionStorage.removeItem(RETURN_SCROLL_KEY);
      } catch {
        /* ignore */
      }
    };

    const attempt = () => {
      if (done) return;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll >= targetY - 8) {
        window.scrollTo(0, targetY);
        if (Math.abs(window.scrollY - targetY) <= 24) {
          done = true;
          clear();
          return;
        }
      }
      tries += 1;
      if (tries < MAX_TRIES) {
        timer = setTimeout(attempt, 120);
      } else {
        clear(); // bỏ cuộc — trang không bao giờ đủ cao / bị chặn
      }
    };

    let timer = setTimeout(attempt, 100);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
