export const pin = {
  // Lưới masonry
  'pin.loadingMore': 'Đang tải thêm',

  // Thẻ pin trong lưới
  'pin.imageLoadFailed': 'Không tải được ảnh',
  'pin.saved': 'Đã lưu',
  'pin.save': 'Lưu',
  'pin.unsaved': 'Đã bỏ lưu',
  'pin.undo': 'Hoàn tác',
  'pin.saveFailed': 'Không lưu được, thử lại sau.',
  'pin.moreOptions': 'Thêm tuỳ chọn',
  'pin.reactedAria': 'Đã thả cảm xúc {reaction}',

  // Nhãn cảm xúc (lib/reactions.ts)
  'pin.reactionHeart': 'Yêu',
  'pin.reactionIdea': 'Hữu ích',
  'pin.reactionThanks': 'Cảm ơn',
  'pin.reactionWow': 'Tuyệt',
  'pin.reactionFunny': 'Cười',

  // Chi tiết pin — trạng thái tải/lỗi
  'pin.loadingAria': 'Đang tải pin',
  'pin.notFound': 'Không tìm thấy pin này.',
  'pin.serverUnreachable': 'Không kết nối được máy chủ.',
  'pin.loadFailed': 'Không tải được pin.',
  'pin.untitled': 'Pin không tiêu đề',
  'pin.someUser': 'Người dùng',
  'pin.thisPin': 'pin này',

  // Chi tiết pin — theo dõi tác giả · chia sẻ
  'pin.reactFailed': 'Không gửi được cảm xúc, thử lại sau.',
  'pin.following': 'Đang theo dõi',
  'pin.follow': 'Theo dõi',
  'pin.nowFollowing': 'Đang theo dõi {name}',
  'pin.unfollowed': 'Đã bỏ theo dõi {name}',
  'pin.followFailed': 'Không theo dõi được, thử lại sau.',
  'pin.linkCopied': 'Đã copy liên kết',

  // Chi tiết pin — menu chủ pin
  'pin.deleteTitle': 'Xoá "{title}"?',
  'pin.deleteBody': 'Pin và bình luận trên đó sẽ không còn hiển thị.',
  'pin.deleteYes': 'Xoá pin',
  'pin.deleted': 'Đã xoá pin',
  'pin.deleteFailed': 'Không xoá được pin, thử lại sau.',
  'pin.edit': 'Sửa pin',

  // Chi tiết pin — thanh hành động và chân trang
  'pin.closeEscHint': 'ESC để đóng · bấm nền để đóng',
  'pin.share': 'Chia sẻ',
  'pin.pickBoardAria': 'Chọn board để lưu pin',
  'pin.saveToBoard': 'Lưu vào bảng ▾',
  'pin.pickReactionAria': 'Chọn cảm xúc',
  'pin.source': 'Nguồn:',
  'pin.comments': 'Bình luận',
  'pin.openFullPage': 'Mở trang đầy đủ (F5 / link trực tiếp) →',
  'pin.followerCount': '{countText} người theo dõi',

  // Bình luận — ô soạn và danh sách
  'pin.commentPlaceholder': 'Bình luận công khai',
  'pin.send': 'Gửi',
  'pin.sending': 'Đang gửi…',
  'pin.commentTooLong': 'Bình luận tối đa {max} ký tự.',
  'pin.commentTwoLevels': 'Bình luận chỉ 2 tầng — không trả lời vào một trả lời.',
  'pin.loadingComments': 'Đang tải bình luận…',
  'pin.noComments': 'Chưa có bình luận nào.',
  'pin.loadMoreComments': 'Xem thêm bình luận',
  'pin.loadingReplies': 'Đang tải trả lời…',
  'pin.loadMoreReplies': 'Xem thêm trả lời',

  // Bình luận — lỗi và xác nhận
  'pin.commentFailed': 'Không gửi được bình luận, thử lại sau.',
  'pin.replyToReplyFailed': 'Không trả lời được vào một trả lời.',
  'pin.commentEditFailed': 'Không sửa được bình luận, thử lại sau.',
  'pin.commentDeleteTitle': 'Xoá bình luận này?',
  'pin.commentDeleteBody': 'Bình luận và các trả lời trên đó sẽ không còn hiển thị.',
  'pin.commentDeleteYes': 'Xoá bình luận',
  'pin.commentDeleteFailed': 'Không xoá được bình luận, thử lại sau.',

  // Bình luận — hành động trên từng dòng
  'pin.removeReaction': 'Bỏ cảm xúc',
  'pin.addReaction': 'Thả cảm xúc',
  'pin.commentOptions': 'Tuỳ chọn bình luận',
  'pin.reply': 'Trả lời',
  'pin.hideReplies': 'Ẩn trả lời',
  'pin.showReplies': 'Xem {count} trả lời',
  'pin.editComment': 'Sửa bình luận',
  'pin.replyTo': 'Trả lời {name}',

  // Bình luận — thời gian tương đối (dạng ngắn cạnh tên)
  'pin.timeSeconds': '{n}s',
  'pin.timeMinutes': '{n} phút',
  'pin.timeHours': '{n} giờ',
  'pin.timeDays': '{n} ngày',
  'pin.timeMonths': '{n} tháng',
  'pin.timeYears': '{n} năm',

  // B4 — Tạo pin (tiêu đề trang + metadata)
  'pin.createTitle': 'Tạo pin',
  'pin.createSubtitle': 'Trang riêng, không phải modal. Rời trang khi đã chọn ảnh sẽ hỏi xác nhận.',
  'pin.createMeta': 'Tạo pin · Panacea',
  'pin.editMeta': 'Sửa pin · Panacea',
  'pin.notFoundMeta': 'Pin không tồn tại · Panacea',
  'pin.metaByline': 'Bởi {name} · Panacea',
  'pin.metaSomeone': 'người dùng',

  // B4 — lỗi và xác nhận rời trang
  'pin.tooManyPins': 'Bạn đang đăng hơi nhanh. Thử lại sau {seconds} giây nhé.',
  'pin.tooManyPinsNoTime': 'Bạn đang đăng hơi nhanh. Chờ một chút rồi thử lại nhé.',
  'pin.saveToBoardFailed': 'Đã tạo pin, nhưng chưa lưu được vào board — thử lại từ trang pin.',
  'pin.createFailed': 'Không đăng được pin, thử lại sau.',
  'pin.leaveTitle': 'Rời trang khi chưa đăng?',
  'pin.leaveBody': 'Ảnh đã chọn và nội dung bạn nhập sẽ mất.',
  'pin.leaveYes': 'Rời trang',
  'pin.leaveNo': 'Ở lại',

  // B4 — cột ảnh
  'pin.previewAlt': 'Xem trước ảnh sắp đăng',
  'pin.uploaded': 'Đã tải lên',
  'pin.changeImage': 'Đổi ảnh khác',
  'pin.uploading': 'Đang tải lên',
  'pin.dropImage': 'Kéo thả ảnh vào đây',
  'pin.dropImageHint': 'Hoặc chọn từ máy. Bước 1 của 2.',
  'pin.pickAnotherImage': 'Chọn ảnh khác',
  'pin.pickImage': 'Chọn ảnh',
  'pin.uploadLimits': 'Tối đa 10MB · tối thiểu 1KB · chỉ nhận JPG, PNG, WEBP, GIF · tối đa 10 pin mỗi phút.',

  // B4/B5 — các trường của form pin
  'pin.fieldTitle': 'Tiêu đề',
  'pin.fieldTitlePlaceholder': 'Thêm tiêu đề',
  'pin.fieldDescription': 'Mô tả',
  'pin.fieldDescriptionPlaceholder': 'Nói thêm về pin này',
  'pin.fieldSourceUrl': 'Link nguồn',
  'pin.errSourceUrl': 'Link nguồn phải là URL hợp lệ.',
  'pin.fieldTags': 'Thẻ',
  'pin.removeTag': 'Bỏ thẻ {tag}',
  'pin.tagsFull': 'Đã đủ thẻ',
  'pin.tagInputPlaceholder': 'Nhập thẻ rồi Enter',
  'pin.tagsLeft': 'Còn {n} thẻ',
  'pin.tagsCapped': 'Đạt trần 10 thẻ',
  'pin.tagsCappedHint': 'Đạt trần 10 thẻ — bỏ một thẻ trước khi thêm thẻ khác.',
  'pin.fieldCategories': 'Danh mục',
  'pin.categoriesLeft': 'Còn {n} danh mục',
  'pin.categoriesCapped': 'Tối đa 3 danh mục cho mỗi pin.',
  'pin.fieldBoard': 'Board',
  'pin.pickBoardOptional': 'Chọn board (tuỳ chọn)',
  'pin.publishing': 'Đang đăng…',
  'pin.publish': 'Đăng',

  // B5 — Sửa pin · modal chi tiết
  'pin.editSubtitle': 'Ảnh không đổi được sau khi tạo — muốn ảnh khác thì phải xoá pin và tạo lại.',
  'pin.editImageNote': 'Ảnh gốc giữ nguyên. Không thể thay ảnh ở màn này.',
  'pin.backToPin': 'Quay lại pin',
  'pin.backToGrid': 'Quay lại lưới',
  'pin.editSaved': 'Đã lưu thay đổi.',
  'pin.editDenied': 'Bạn không có quyền sửa pin này.',
  'pin.editNotFound': 'Pin không tồn tại hoặc đã bị xoá.',
  'pin.editNetErr': 'Không lưu được — mất kết nối. Dữ liệu bạn nhập vẫn còn ở đây.',
  'pin.saveChanges': 'Lưu thay đổi',
  'pin.savedCheck': 'Đã lưu ✓',
  'pin.modalAria': 'Chi tiết pin',

  // Trang 404 riêng của /pin/[id]
  'pin.notFoundTitle': 'Không tìm thấy pin',
  'pin.notFoundBody': 'Pin có thể đã bị xoá, hoặc bạn không có quyền xem.',
} as const;
