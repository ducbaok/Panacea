/**
 * QĐ-8 (§5d ban-do-man-panacea.md) — bản dịch CHÍNH THỨC các chuỗi lỗi board mà
 * backend CỐ Ý giữ nguyên tiếng Anh (còn dùng cho log + consumer khác). Frontend
 * ánh xạ sang tiếng Việt. MỘT bảng, MỘT chỗ (§4.8 brief FE-7) — C5 dùng 2 chuỗi
 * đầu; C6 (ngoài phạm vi FE-7) sẽ dùng lại "permission to edit".
 *
 * Khoá khớp bằng `includes` vì thông điệp GraphQL có thể được join/bọc thêm.
 */
const BOARD_ERROR_VI: ReadonlyArray<readonly [string, string]> = [
  ['You can only create up to 200 boards.', 'Bạn chỉ tạo được tối đa 200 board.'],
  ['You do not have permission to edit this board', 'Bạn không có quyền sửa board này.'],
  ['Max 50 sections per board', 'Mỗi board tối đa 50 section.'],
  ['Only board owner can invite collaborators', 'Chỉ chủ board mới mời được cộng tác viên.'],
  ['Cannot invite yourself', 'Không thể tự mời chính mình.'],
];

/** Trả bản dịch nếu message chứa một khoá đã biết; null nếu không khớp. */
export function translateBoardError(rawMessage: string | null | undefined): string | null {
  if (!rawMessage) return null;
  for (const [en, vi] of BOARD_ERROR_VI) {
    if (rawMessage.includes(en)) return vi;
  }
  return null;
}
