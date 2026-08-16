import type { Metadata } from 'next';
import { EditPinView } from '@/components/pin/edit-pin-view';

/**
 * B5 — Trang Sửa pin `/pin/[id]/edit`. Route chốt ở spec-man-con-lai.md §6.
 * Segment `edit` sau `[id]` ⇒ KHÔNG bị interceptor `@modal/(.)pin/[id]` bắt
 * (interceptor chỉ khớp đúng `/pin/[id]`). Đã được `proxy.ts` chặn auth.
 *
 * Guard quyền (pin không phải của mình → denied) + 7 trạng thái nằm trong
 * client `EditPinView`; server wrapper chỉ bóc `params` (Promise ở Next 16).
 */
export const metadata: Metadata = {
  title: 'Sửa pin · Panacea',
};

export default async function EditPinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditPinView pinId={id} />;
}
