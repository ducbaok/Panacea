import type { TranslationKey } from '@/lib/i18n/translate';

/**
 * QĐ-8 (§5d ban-do-man-panacea.md) — bảng ánh xạ các chuỗi lỗi board mà backend
 * CỐ Ý giữ nguyên tiếng Anh (còn dùng cho log + consumer khác) sang chữ hiện ra
 * mắt người dùng. MỘT bảng, MỘT chỗ (§4.8 brief FE-7).
 *
 * 🔵 23/08/2026 — file này TRƯỚC ĐÂY tên `board-error-vi.ts` và trả thẳng chuỗi
 * tiếng Việt. Nay trả KEY từ điển (`errors.board.*`); màn gọi `t(key)`. Đổi vì
 * bảng chữ cứng chỉ phục vụ được một thứ tiếng — thêm English là phải nhân đôi
 * bảng, và hai bản chép sẽ trôi khỏi nhau (đúng hình dạng lỗi mà chính chú
 * thích cũ của file này cảnh báo).
 *
 * Khoá khớp bằng `includes` vì thông điệp GraphQL có thể được join/bọc thêm.
 *
 * 🔴 BẪY FE-10 §4.4 — backend có HAI chuỗi "không có quyền sửa board" KHÁC nhau,
 * ném từ hai đường khác nhau, và bản vẽ C6 chỉ ghi chuỗi thứ nhất:
 *   - `You do not have permission to edit this board` ← chỉ `updateBoard` (C5).
 *   - `You do not have editor access to this board`   ← `checkBoardEditorAccess`,
 *     tức là TẤT CẢ thao tác section/collaborator/setBoardCover của C6/C7.
 * Chép cứng chuỗi bản vẽ ⇒ runtime ném chuỗi thứ hai ⇒ ánh xạ hụt, banner rơi
 * về nhánh dự phòng mà không báo lỗi. Cả hai cùng trỏ một key.
 *
 * ⚠️ Khoá là chuỗi EN NGUYÊN VĂN (NestJS BadRequest/Forbidden/NotFound, không có
 * mã lỗi máy đọc được) ⇒ ai sửa chữ ở backend là gãy ánh xạ trong im lặng. Gọi
 * kèm nhánh dự phòng ở phía màn, đừng giả định luôn khớp.
 */
const BOARD_ERROR_KEYS: ReadonlyArray<readonly [string, TranslationKey]> = [
  // ── QĐ-8 §5d (FE-7, C5) ──
  ['You can only create up to 200 boards.', 'errors.board.maxBoards'],
  ['You do not have permission to edit this board', 'errors.board.noEditPermission'],
  ['Max 50 sections per board', 'errors.board.maxSections'],
  ['Only board owner can invite collaborators', 'errors.board.onlyOwnerInvites'],
  ['Cannot invite yourself', 'errors.board.cannotInviteSelf'],

  // ── FE-10 §4.10 (C6 · C7 · setBoardCover) ──
  ['You do not have editor access to this board', 'errors.board.noEditPermission'],
  ['Pin must be saved in this board to be a cover', 'errors.board.coverMustBeSaved'],
  ['User is not a collaborator of this board', 'errors.board.notCollaborator'],
  ['No permission to remove this collaborator', 'errors.board.noRemovePermission'],
  ['Already following this user', 'errors.board.alreadyFollowing'],
  // Mời trùng: `inviteCollaborator` create thẳng, không kiểm tồn tại ⇒ vướng
  // @@unique([boardId,userId]) và ném Prisma P2002 THÔ (§4.6). P2002 không có
  // message thân thiện; phần ổn định trong chuỗi Prisma là "Unique constraint
  // failed". C7 còn guard ở client (đã trong danh sách ⇒ khoá nút Mời) nên đây
  // là lưới thứ hai cho tình huống đua.
  ['Unique constraint failed', 'errors.board.alreadyCollaborator'],
];

/** Key từ điển nếu message chứa một khoá đã biết; null nếu không khớp. */
export function boardErrorKey(rawMessage: string | null | undefined): TranslationKey | null {
  if (!rawMessage) return null;
  for (const [en, key] of BOARD_ERROR_KEYS) {
    if (rawMessage.includes(en)) return key;
  }
  return null;
}
