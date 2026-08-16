import type { Metadata } from 'next';
import { EditBoardView } from '@/components/board/board-form-view';

/**
 * C5 edit — `/board/[id]/edit`. `params` là Promise (Next 16). Guard quyền
 * (không phải chủ → denied) nằm trong client `EditBoardView`. Đã được `proxy.ts`
 * chặn auth.
 */
export const metadata: Metadata = {
  title: 'Sửa board · Panacea',
};

export default async function EditBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditBoardView boardId={id} />;
}
