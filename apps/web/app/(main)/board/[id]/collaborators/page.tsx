import { CollaboratorsView } from '@/components/board/collaborators-view';

/**
 * C7 — Cộng tác viên, `/board/[id]/collaborators` (FE-10). Nút "Cộng tác viên" ở
 * board-view trỏ vào đây.
 *
 * Auth BẮT BUỘC — '/board/:id/collaborators' đã có trong proxy.ts matcher. Vai
 * trò (chủ board / cộng tác viên / người ngoài) phân biệt trong component từ
 * `board.user.id` vs `me.id` + `board.collaborators`.
 *
 * `params` là Promise ở Next 16 ⇒ `await params` (§4 bẫy 6).
 */
export default async function BoardCollaboratorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CollaboratorsView boardId={id} />;
}
