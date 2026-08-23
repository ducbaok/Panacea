export const errors = {
  // Lỗi board — backend giữ nguyên tiếng Anh, khớp bằng includes
  'errors.board.maxBoards': 'Bạn chỉ tạo được tối đa 200 board.',
  'errors.board.noEditPermission': 'Bạn không có quyền sửa board này.',
  'errors.board.maxSections': 'Mỗi board tối đa 50 section.',
  'errors.board.onlyOwnerInvites': 'Chỉ chủ board mới mời được cộng tác viên.',
  'errors.board.cannotInviteSelf': 'Không thể tự mời chính mình.',
  'errors.board.coverMustBeSaved': 'Chỉ ghim ảnh đã lưu trong board này mới đặt được làm bìa.',
  'errors.board.notCollaborator': 'Người này không còn là cộng tác viên của board.',
  'errors.board.noRemovePermission': 'Bạn không có quyền gỡ cộng tác viên này.',
  'errors.board.alreadyFollowing': 'Bạn đã theo dõi người này rồi.',
  'errors.board.alreadyCollaborator': 'Người này đã là cộng tác viên của board.',

  // Lỗi upload ảnh (5 chuỗi đã duyệt 16/08/2026)
  'errors.upload.tooLarge': 'Ảnh vượt quá 10MB — chọn ảnh nhỏ hơn.',
  'errors.upload.unsupportedType': 'Định dạng không được hỗ trợ — chỉ nhận JPG, PNG, WEBP, GIF.',
  'errors.upload.tooSmall': 'Ảnh quá nhỏ (tối thiểu 1KB).',
  'errors.upload.generic': 'Không tải được ảnh lên — kiểm tra kết nối rồi thử lại.',
} as const;
