import type { Metadata } from 'next';
import { EditPinView } from '@/components/pin/edit-pin-view';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * B5 — Trang Sửa pin `/pin/[id]/edit`. Route chốt ở spec-man-con-lai.md §6.
 * Segment `edit` sau `[id]` ⇒ KHÔNG bị interceptor `@modal/(.)pin/[id]` bắt
 * (interceptor chỉ khớp đúng `/pin/[id]`). Đã được `proxy.ts` chặn auth.
 *
 * Guard quyền (pin không phải của mình → denied) + 7 trạng thái nằm trong
 * client `EditPinView`; server wrapper chỉ bóc `params` (Promise ở Next 16).
 */
/* i18n (23/08/2026): hằng `metadata` không đọc được cookie ⇒ đổi sang hàm. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(await getLocale(), 'pin.editMeta') };
}

export default async function EditPinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditPinView pinId={id} />;
}
