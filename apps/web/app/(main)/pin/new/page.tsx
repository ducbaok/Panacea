import type { Metadata } from 'next';
import { CreatePinView } from '@/components/pin/create-pin-view';

/**
 * B4 — Trang Tạo pin `/pin/new`. Segment TĨNH "new" thắng segment động `[id]`
 * cùng cấp ⇒ KHÔNG bị interceptor `@modal/(.)pin/[id]` bắt (bẫy T2.8). Route đã
 * được `proxy.ts` chặn auth (khách → /login?callbackUrl=/pin/new).
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
