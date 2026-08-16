import type { Metadata } from 'next';
import { CreateBoardView } from '@/components/board/board-form-view';

/**
 * C5 create — `/board/new`. Segment TĨNH "new" thắng "[id]" cùng cấp. Đã được
 * `proxy.ts` chặn auth. "+ Tạo board mới" của BoardPicker trỏ tới đây.
 */
export const metadata: Metadata = {
  title: 'Tạo board · Panacea',
};

export default function CreateBoardPage() {
  return <CreateBoardView />;
}
