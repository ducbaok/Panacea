export const common = {
  // Metadata gốc (app/layout.tsx)
  'common.appDescription': 'Antigravity — nơi lưu và khám phá cảm hứng bằng hình ảnh.',

  // Nút và trạng thái dùng lại khắp app
  'common.save': 'Lưu',
  'common.saving': 'Đang lưu…',
  'common.cancel': 'Huỷ',
  'common.delete': 'Xoá',
  'common.edit': 'Sửa',
  'common.close': 'Đóng',
  'common.loading': 'Đang tải…',
  'common.loadMore': 'Xem thêm',
  'common.retry': 'Thử lại',
  'common.back': 'Quay lại',
  'common.goHome': 'Về trang chủ',
  'common.checkNetwork': 'Kiểm tra mạng rồi thử lại.',

  // Nhãn mặc định của ConfirmDialog
  'common.agree': 'Đồng ý',

  // D1 — Tìm kiếm
  'search.placeholder': 'Tìm pin, người dùng, board',
  'search.boxAria': 'Ô tìm kiếm',
  'search.resultsFor': 'Kết quả cho “{query}”',
  'search.tabsAria': 'Loại kết quả',
  'search.tabPins': 'Pin',
  'search.tabUsers': 'Người dùng',
  'search.tabBoards': 'Board',
  'search.prompt': 'Nhập từ khoá để tìm pin, người dùng và board.',
  'search.loadFailed': 'Không tải được kết quả',
  'search.noPins': 'Không có pin nào khớp',
  'search.noPinsHint': 'Thử từ khoá ngắn hơn, hoặc xem tab Người dùng và Board.',
  'search.noUsers': 'Không tìm thấy người dùng nào',
  'search.noUsersHint': 'Thử tên hoặc @tên đăng nhập khác.',
  'search.noBoards': 'Không có board nào khớp',
  'search.noBoardsHint': 'Thử từ khoá ngắn hơn, hoặc xem tab Pin và Người dùng.',
  'search.unfollowFailed': 'Không bỏ theo dõi được, thử lại sau.',

  // Thời gian tương đối (lib/format.ts)
  'notif.justNow': 'Vừa xong',
  'notif.minutesAgo': '{n} phút trước',
  'notif.hoursAgo': '{n} giờ trước',
  'notif.yesterday': 'Hôm qua',
  'notif.daysAgo': '{n} ngày trước',
  'notif.weeksAgo': '{n} tuần trước',

  // D2 — Thông báo
  'notif.title': 'Thông báo',
  'notif.typeFollow': 'đã theo dõi bạn',
  'notif.typeComment': 'đã bình luận về pin của bạn',
  'notif.typeReply': 'đã trả lời bình luận của bạn',
  'notif.typeSave': 'đã lưu pin của bạn',
  'notif.typeReaction': 'đã thả cảm xúc về pin của bạn',
  'notif.typeMention': 'đã nhắc tới bạn',
  'notif.markAllRead': 'Đánh dấu tất cả đã đọc',
  'notif.markAllFailed': 'Không đánh dấu được, thử lại sau.',
  'notif.reconnecting': 'Đang kết nối lại…',
  'notif.loadFailed': 'Không tải được thông báo',
  'notif.empty': 'Chưa có thông báo nào',
  'notif.emptyHint': 'Khi có người theo dõi, lưu pin hoặc nhắc tới bạn, thông báo sẽ hiện ở đây.',
  'notif.someone': 'Ai đó',
  'notif.unread': 'Chưa đọc',
} as const;
