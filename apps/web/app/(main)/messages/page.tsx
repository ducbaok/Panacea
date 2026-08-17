import { MessagesView } from '@/components/messages/messages-view';

/**
 * D3/D4 — `/messages` (FE-9), chưa chọn hội thoại nào. Cần đăng nhập: xem
 * `proxy.ts` — matcher phải liệt kê '/messages' RIÊNG, vì '/messages/:path*'
 * KHÔNG khớp chính '/messages' (bẫy path-to-regexp đã dính ở FE-7 và FE-8).
 */
export default function MessagesPage() {
  return <MessagesView activeId={null} />;
}
