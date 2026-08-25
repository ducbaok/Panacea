import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/errors'))['errors'];

export const errors: Mirror<Vi> = {
  // Lỗi board — backend giữ nguyên tiếng Anh, khớp bằng includes
  'errors.board.maxBoards': 'You can only create up to 200 boards.',
  'errors.board.noEditPermission': 'You do not have permission to edit this board.',
  'errors.board.maxSections': 'A board can have at most 50 sections.',
  'errors.board.onlyOwnerInvites': 'Only the board owner can invite collaborators.',
  'errors.board.cannotInviteSelf': 'You cannot invite yourself.',
  'errors.board.coverMustBeSaved': 'Only a pin saved in this board can be used as its cover.',
  'errors.board.notCollaborator': 'This person is no longer a collaborator on this board.',
  'errors.board.noRemovePermission': 'You do not have permission to remove this collaborator.',
  'errors.board.alreadyFollowing': 'You already follow this person.',
  'errors.board.alreadyCollaborator': 'This person is already a collaborator on this board.',

  // Lỗi vòng tròn — F1/XH-8, backend giữ nguyên tiếng Anh (khớp bằng includes)
  'errors.circle.maxCircles':
    'You already have 20 circles — the cap for one account. Delete or merge one, then try again.',
  'errors.circle.maxMembers':
    'This circle already holds 50 people — the cap for one circle. Make a new circle if you need more.',
  'errors.circle.cannotAddSelf': 'You always see your own pins — no need to add yourself.',
  'errors.circle.userNotFound': 'That person could not be found.',
  'errors.circle.blocked': 'You cannot add someone you have blocked (or who blocked you).',
  'errors.circle.notAdHoc': 'This circle already has a name.',

  // Lỗi upload ảnh (5 chuỗi đã duyệt 16/08/2026)
  'errors.upload.tooLarge': 'Image is over 10MB — pick a smaller one.',
  'errors.upload.unsupportedType': 'Unsupported format — only JPG, PNG, WEBP and GIF are accepted.',
  'errors.upload.tooSmall': 'Image is too small (1KB minimum).',
  'errors.upload.generic': 'Could not upload the image — check your connection and try again.',
};
