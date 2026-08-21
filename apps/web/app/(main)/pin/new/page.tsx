import type { Metadata } from 'next';
import { CreatePinView } from '@/components/pin/create-pin-view';

/**
 * B4 — Trang Tạo pin `/pin/new`. Route đã được `proxy.ts` chặn auth (khách →
 * /login?callbackUrl=/pin/new).
 *
 * 🔴 ĐÍNH CHÍNH REVIEW-1 (18/08/2026). Chỗ này từng ghi: *"Segment TĨNH 'new'
 * thắng segment động `[id]` cùng cấp ⇒ KHÔNG bị interceptor `@modal/(.)pin/[id]`
 * bắt (bẫy T2.8)"* — **sai, và đã trả giá bằng một bug người dùng gặp**.
 *
 * Vế đầu đúng nhưng không đủ: segment tĩnh chỉ thắng trong cây `children`.
 * Slot `@modal` là một cây SONG SONG, resolve độc lập — trong đó ứng viên duy
 * nhất là `(.)pin/[id]`, nên nó khớp `id="new"` và đè modal "Không tìm thấy
 * pin này." lên trang chủ. Bấm "Tạo" ⇒ người dùng không bao giờ thấy form.
 *
 * Đo 18/08 trên trình duyệt: soft-nav ⇒ hỏng, F5 ⇒ đúng (interception theo
 * định nghĩa chỉ áp cho soft navigation). Hai hướng sửa gốc đều đã đo và
 * TRƯỢT — chi tiết ở field `hardNav` trong `components/shell/nav-items.ts`.
 * Đường đang dùng: nút "Tạo" điều hướng CỨNG + lưới an toàn trong `pin-modal.tsx`.
 *
 * Server wrapper mỏng: metadata tĩnh + render client `CreatePinView` (upload,
 * form, dirty-tracking đều là hành vi client).
 */
export const metadata: Metadata = {
  title: 'Tạo pin · Panacea',
};

export default function CreatePinPage() {
  return <CreatePinView />;
}
