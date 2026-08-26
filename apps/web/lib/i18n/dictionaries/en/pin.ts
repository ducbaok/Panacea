import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/pin'))['pin'];

export const pin: Mirror<Vi> = {
  // Lưới masonry
  'pin.loadingMore': 'Loading more',

  // Thẻ pin trong lưới
  'pin.imageLoadFailed': 'Image failed to load',
  'pin.saved': 'Saved',
  'pin.save': 'Save',
  'pin.unsaved': 'Removed from saved',
  'pin.undo': 'Undo',
  'pin.saveFailed': 'Could not save, try again later.',
  'pin.moreOptions': 'More options',
  'pin.reactedAria': 'Reacted {reaction}',

  // Nhãn cảm xúc (lib/reactions.ts)
  'pin.reactionHeart': 'Love',
  'pin.reactionIdea': 'Helpful',
  'pin.reactionThanks': 'Thanks',
  'pin.reactionWow': 'Wow',
  'pin.reactionFunny': 'Funny',

  // Chi tiết pin — trạng thái tải/lỗi
  'pin.loadingAria': 'Loading pin',
  'pin.notFound': 'This pin could not be found.',
  'pin.serverUnreachable': 'Could not reach the server.',
  'pin.loadFailed': 'Could not load this pin.',
  'pin.untitled': 'Untitled pin',
  'pin.someUser': 'Someone',
  'pin.thisPin': 'this pin',

  // Chi tiết pin — theo dõi tác giả · chia sẻ
  'pin.reactFailed': 'Could not send your reaction, try again later.',
  'pin.following': 'Following',
  'pin.follow': 'Follow',
  'pin.nowFollowing': 'Now following {name}',
  'pin.unfollowed': 'Unfollowed {name}',
  'pin.followFailed': 'Could not follow, try again later.',
  'pin.linkCopied': 'Link copied',

  // Chi tiết pin — menu chủ pin
  'pin.deleteTitle': 'Delete “{title}”?',
  'pin.deleteBody': 'The pin and its comments will stop being shown.',
  'pin.deleteYes': 'Delete pin',
  'pin.deleted': 'Pin deleted',
  'pin.deleteFailed': 'Could not delete the pin, try again later.',
  'pin.edit': 'Edit pin',

  // Chi tiết pin — thanh hành động và chân trang
  'pin.closeEscHint': 'ESC to close · click the backdrop to close',
  'pin.share': 'Share',
  'pin.pickBoardAria': 'Pick a board to save this pin to',
  'pin.saveToBoard': 'Save to board ▾',
  'pin.pickReactionAria': 'Pick a reaction',
  'pin.source': 'Source:',
  'pin.comments': 'Comments',
  'pin.openFullPage': 'Open the full page (F5 / direct link) →',
  'pin.followerCount': '{countText} follower|{countText} followers',

  // Bình luận — ô soạn và danh sách
  'pin.commentPlaceholder': 'Add a public comment',
  'pin.send': 'Send',
  'pin.sending': 'Sending…',
  'pin.commentTooLong': 'Comments can be at most {max} characters.',
  'pin.commentTwoLevels': 'Comments go two levels deep — you cannot reply to a reply.',
  'pin.loadingComments': 'Loading comments…',
  'pin.noComments': 'No comments yet.',
  'pin.loadMoreComments': 'Load more comments',
  'pin.loadingReplies': 'Loading replies…',
  'pin.loadMoreReplies': 'Load more replies',

  // Bình luận — lỗi và xác nhận
  'pin.commentFailed': 'Could not post your comment, try again later.',
  'pin.replyToReplyFailed': 'You cannot reply to a reply.',
  'pin.commentEditFailed': 'Could not edit the comment, try again later.',
  'pin.commentDeleteTitle': 'Delete this comment?',
  'pin.commentDeleteBody': 'The comment and its replies will stop being shown.',
  'pin.commentDeleteYes': 'Delete comment',
  'pin.commentDeleteFailed': 'Could not delete the comment, try again later.',

  // Bình luận — hành động trên từng dòng
  'pin.removeReaction': 'Remove reaction',
  'pin.addReaction': 'React',
  'pin.commentOptions': 'Comment options',
  'pin.reply': 'Reply',
  'pin.hideReplies': 'Hide replies',
  'pin.showReplies': 'Show {count} reply|Show {count} replies',
  'pin.editComment': 'Edit comment',
  'pin.replyTo': 'Reply to {name}',

  // Bình luận — thời gian tương đối (dạng ngắn cạnh tên)
  'pin.timeSeconds': '{n}s',
  'pin.timeMinutes': '{n}m',
  'pin.timeHours': '{n}h',
  'pin.timeDays': '{n}d',
  'pin.timeMonths': '{n}mo',
  'pin.timeYears': '{n}y',

  // B4 — Tạo pin (tiêu đề trang + metadata)
  'pin.createTitle': 'Create pin',
  'pin.createSubtitle': 'A page of its own, not a modal. Leaving after picking an image asks for confirmation.',
  'pin.createMeta': 'Create pin · Panacea',
  'pin.editMeta': 'Edit pin · Panacea',
  'pin.notFoundMeta': 'Pin not found · Panacea',
  'pin.metaByline': 'By {name} · Panacea',
  'pin.metaSomeone': 'someone',

  // B4 — lỗi và xác nhận rời trang
  'pin.tooManyPins': 'You’re posting a bit fast. Try again in {seconds}s.',
  'pin.tooManyPinsNoTime': 'You’re posting a bit fast. Give it a moment and try again.',
  'pin.saveToBoardFailed': 'The pin was created but could not be saved to the board — try again from the pin page.',
  'pin.createFailed': 'Could not publish the pin, try again later.',
  'pin.leaveTitle': 'Leave before publishing?',
  'pin.leaveBody': 'The image you picked and everything you typed will be lost.',
  'pin.leaveYes': 'Leave',
  'pin.leaveNo': 'Stay',

  // B4 — cột ảnh
  'pin.previewAlt': 'Preview of the image you are about to publish',
  'pin.uploaded': 'Uploaded',
  'pin.changeImage': 'Pick another image',
  'pin.uploading': 'Uploading',
  'pin.dropImage': 'Drag and drop an image here',
  'pin.dropImageHint': 'Or pick one from your device. Step 1 of 2.',
  'pin.pickAnotherImage': 'Pick another image',
  'pin.pickImage': 'Pick an image',
  'pin.uploadLimits': 'Up to 10MB · at least 1KB · JPG, PNG, WEBP and GIF only · up to 10 pins a minute.',

  // B4/B5 — các trường của form pin
  'pin.fieldTitle': 'Title',
  'pin.fieldTitlePlaceholder': 'Add a title',
  'pin.fieldDescription': 'Description',
  'pin.fieldDescriptionPlaceholder': 'Say more about this pin',
  'pin.fieldTags': 'Tags',
  'pin.removeTag': 'Remove tag {tag}',
  'pin.tagsFull': 'No room for more tags',
  'pin.tagInputPlaceholder': 'Type a tag, then press Enter',
  'pin.tagsLeft': '{n} tag left|{n} tags left',
  'pin.tagsCapped': 'Tag limit of 10 reached',
  'pin.tagsCappedHint': 'Tag limit of 10 reached — remove one before adding another.',
  'pin.fieldBoard': 'Board',
  'pin.pickBoardOptional': 'Pick a board (optional)',
  'pin.publishing': 'Publishing…',
  'pin.publish': 'Publish',

  // B5 — Sửa pin · modal chi tiết
  'pin.editSubtitle': 'The image cannot be changed after creation — to use another image, delete the pin and create it again.',
  'pin.editImageNote': 'The original image stays as it is. It cannot be replaced on this screen.',
  'pin.backToPin': 'Back to the pin',
  'pin.backToGrid': 'Back to the grid',
  'pin.editSaved': 'Changes saved.',
  'pin.editDenied': 'You do not have permission to edit this pin.',
  'pin.editNotFound': 'This pin does not exist or has been deleted.',
  'pin.editNetErr': 'Could not save — connection lost. Everything you typed is still here.',
  'pin.saveChanges': 'Save changes',
  'pin.savedCheck': 'Saved ✓',
  'pin.modalAria': 'Pin detail',

  // Trang 404 riêng của /pin/[id]
  'pin.notFoundTitle': 'Pin not found',
  'pin.notFoundBody': 'The pin may have been deleted, or you may not be allowed to see it.',
};
