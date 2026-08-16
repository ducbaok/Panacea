import { BoardView } from '@/components/board/board-view';

/**
 * C4 — Chi tiết board (FE-6). `board(id)` là auth-TUỲ CHỌN (§4.4) ⇒ KHÔNG thêm
 * route này vào matcher của proxy.ts (§9). Board secret bị backend chặn người
 * ngoài (boards.service.ts:63) ⇒ BoardView xử lý nhánh "không tìm thấy".
 *
 * `params` là Promise ở Next 16 (`await params`); id truyền xuống client
 * BoardView (Apollo client-only, FE-0).
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BoardView id={id} />;
}
