export const messages = {
  // D4 — Danh sách trò chuyện
  'messages.title': 'Tin nhắn',
  'messages.reconnecting': 'Đang kết nối lại…',
  'messages.listLoadFailed': 'Không tải được danh sách trò chuyện.',
  'messages.emptyList': 'Chưa có cuộc trò chuyện nào.',
  'messages.mutualOnly': 'Tin nhắn chỉ mở khi hai người theo dõi nhau.',
  'messages.pickConversation': 'Chọn một cuộc trò chuyện để bắt đầu.',
  'messages.someUser': 'Người dùng',
  'messages.unread': 'Chưa đọc',
  'messages.sentAPin': 'Đã gửi một pin',

  // D4 — Khung chat
  'messages.revoked': 'Tin nhắn đã thu hồi',
  'messages.revoke': 'Thu hồi',
  'messages.revokeTitle': 'Thu hồi tin nhắn?',
  'messages.revokeBody': 'Tin nhắn sẽ biến mất với cả hai người.',
  'messages.revokeFailed': 'Không thu hồi được. Thử lại nhé.',
  'messages.sendFailed': 'Không gửi được. Thử lại nhé.',
  'messages.loadFailed': 'Không tải được tin nhắn.',
  'messages.emptyThread': 'Chưa có tin nhắn nào. Gửi lời chào đi.',
  'messages.loadOlder': 'Xem tin cũ hơn',
  'messages.attachPinSoon': 'Đính pin sẽ có ở bản sau',
  'messages.composerPlaceholder': 'Nhắn gì đó',
  'messages.send': 'Gửi',

  // D4 — Lỗi messaging (backend trả tiếng Anh)
  'messages.errMutualRequired': 'Tin nhắn chỉ mở khi hai người theo dõi nhau.',
  'messages.errBlocked': 'Không mở được trò chuyện do đã chặn nhau.',
  'messages.errSelf': 'Không thể tự nhắn cho chính mình.',
  'messages.errNotMember': 'Bạn không còn trong cuộc trò chuyện này.',
  'messages.errNotOwnMessage': 'Chỉ thu hồi được tin của chính bạn.',
  'messages.errGeneric': 'Có lỗi xảy ra. Thử lại nhé.',
} as const;
