import type { Metadata } from 'next';
import { EditBoardView } from '@/components/board/board-form-view';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * C5 edit — `/board/[id]/edit`. `params` là Promise (Next 16). Guard quyền
 * (không phải chủ → denied) nằm trong client `EditBoardView`. Đã được `proxy.ts`
 * chặn auth.
 */
/* i18n (23/08/2026): hằng `metadata` không đọc được cookie ⇒ đổi sang hàm. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(await getLocale(), 'board.editMeta') };
}

export default async function EditBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditBoardView boardId={id} />;
}
