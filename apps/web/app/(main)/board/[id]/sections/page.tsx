import { SectionManageView } from '@/components/board/section-manage-view';

/**
 * C6 — Quản lý section, `/board/[id]/sections` (FE-10). Nối tiếp `/board/[id]`
 * của FE-6; nút "Quản lý section" ở board-view trỏ vào đây.
 *
 * Auth BẮT BUỘC — đã liệt kê '/board/:id/sections' trong proxy.ts matcher. Quyền
 * sửa (chủ / EDITOR) kiểm thêm ở phía component: người xem được board nhưng
 * không có quyền sửa thì thấy trạng thái `denied`, không phải bị đẩy về /login.
 *
 * `params` là Promise ở Next 16 ⇒ `await params` (§4 bẫy 6).
 */
export default async function BoardSectionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SectionManageView boardId={id} />;
}
