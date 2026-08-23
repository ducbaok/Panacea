import type { Metadata } from 'next';
import { CreateBoardView } from '@/components/board/board-form-view';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * C5 create — `/board/new`. Segment TĨNH "new" thắng "[id]" cùng cấp. Đã được
 * `proxy.ts` chặn auth. "+ Tạo board mới" của BoardPicker trỏ tới đây.
 */
/* i18n (23/08/2026): hằng `metadata` không đọc được cookie ⇒ đổi sang hàm. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(await getLocale(), 'board.createMeta') };
}

export default function CreateBoardPage() {
  return <CreateBoardView />;
}
