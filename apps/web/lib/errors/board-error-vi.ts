/**
 * QĐ-8 (§5d ban-do-man-panacea.md) — bản dịch CHÍNH THỨC các chuỗi lỗi board mà
 * backend CỐ Ý giữ nguyên tiếng Anh (còn dùng cho log + consumer khác). Frontend
 * ánh xạ sang tiếng Việt. MỘT bảng, MỘT chỗ (§4.8 brief FE-7) — C5 dùng 2 chuỗi
 * đầu; C6/C7/setBoardCover (FE-10) thêm 6 khoá ở nhóm dưới.
 *
 * Khoá khớp bằng `includes` vì thông điệp GraphQL có thể được join/bọc thêm.
 *
 * 🔴 BẪY FE-10 §4.4 — backend có HAI chuỗi "không có quyền sửa board" KHÁC nhau,
 * ném từ hai đường khác nhau, và bản vẽ C6 chỉ ghi chuỗi thứ nhất:
 *   - `You do not have permission to edit this board` ← chỉ `updateBoard` (C5).
 *   - `You do not have editor access to this board`   ← `checkBoardEditorAccess`,
 *     tức là TẤT CẢ thao tác section/collaborator/setBoardCover của C6/C7.
 * Chép cứng chuỗi bản vẽ ⇒ runtime ném chuỗi thứ hai ⇒ ánh xạ hụt, banner rơi
 * về nhánh dự phòng tiếng Anh mà không báo lỗi. Cả hai cùng trỏ một chữ Việt.
 *
 * ⚠️ Khoá là chuỗi EN NGUYÊN VĂN (NestJS BadRequest/Forbidden/NotFound, không có
 * mã lỗi máy đọc được) ⇒ ai sửa chữ ở backend là gãy ánh xạ trong im lặng. Gọi
 * kèm nhánh dự phòng ở phía màn, đừng giả định luôn khớp.
 */
const BOARD_ERROR_VI: ReadonlyArray<readonly [string, string]> = [
  // ── QĐ-8 §5d (FE-7, C5) ──
  ['You can only create up to 200 boards.', 'Bạn chỉ tạo được tối đa 200 board.'],
  ['You do not have permission to edit this board', 'Bạn không có quyền sửa board này.'],
  ['Max 50 sections per board', 'Mỗi board tối đa 50 section.'],
  ['Only board owner can invite collaborators', 'Chỉ chủ board mới mời được cộng tác viên.'],
  ['Cannot invite yourself', 'Không thể tự mời chính mình.'],

  // ── FE-10 §4.10 (C6 · C7 · setBoardCover) ──
  ['You do not have editor access to this board', 'Bạn không có quyền sửa board này.'],
  [
    'Pin must be saved in this board to be a cover',
    'Chỉ ghim ảnh đã lưu trong board này mới đặt được làm bìa.',
  ],
  ['User is not a collaborator of this board', 'Người này không còn là cộng tác viên của board.'],
  ['No permission to remove this collaborator', 'Bạn không có quyền gỡ cộng tác viên này.'],
  ['Already following this user', 'Bạn đã theo dõi người này rồi.'],
  // Mời trùng: `inviteCollaborator` create thẳng, không kiểm tồn tại ⇒ vướng
  // @@unique([boardId,userId]) và ném Prisma P2002 THÔ (§4.6). P2002 không có
  // message thân thiện; phần ổn định trong chuỗi Prisma là "Unique constraint
  // failed". C7 còn guard ở client (đã trong danh sách ⇒ khoá nút Mời) nên đây
  // là lưới thứ hai cho tình huống đua.
  ['Unique constraint failed', 'Người này đã là cộng tác viên của board.'],
];

/** Trả bản dịch nếu message chứa một khoá đã biết; null nếu không khớp. */
export function translateBoardError(rawMessage: string | null | undefined): string | null {
  if (!rawMessage) return null;
  for (const [en, vi] of BOARD_ERROR_VI) {
    if (rawMessage.includes(en)) return vi;
  }
  return null;
}
