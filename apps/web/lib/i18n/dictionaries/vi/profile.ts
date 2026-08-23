export const profile = {
  // Hook đổi ảnh đại diện / ảnh bìa
  'profile.avatarUpdated': 'Đã cập nhật ảnh đại diện.',
  'profile.coverUpdated': 'Đã cập nhật ảnh bìa.',

  // C1 — Hồ sơ: trạng thái và nhãn
  'profile.loading': 'Đang tải hồ sơ…',
  'profile.loadFailed': 'Không tải được hồ sơ',
  'profile.notFound': 'Không tìm thấy người dùng',
  'profile.notFoundBody': '@{username} không tồn tại hoặc đã đổi tên.',
  'profile.blockedTitle': 'Đã chặn @{username}',
  'profile.followsYou': 'Đang theo dõi bạn',
  'profile.followerLabel': 'người theo dõi',
  'profile.followingLabel': 'đang theo dõi',

  // C1 — Hồ sơ: hàng nút
  'profile.editProfile': 'Sửa hồ sơ',
  'profile.messages': 'Tin nhắn',
  'profile.follow': 'Theo dõi',
  'profile.following': 'Đang theo dõi',
  'profile.unfollow': 'Bỏ theo dõi',
  'profile.more': 'Thêm',
  'profile.block': 'Chặn @{username}',
  'profile.unblock': 'Bỏ chặn',
  'profile.messagesMutualOnly': 'Tin nhắn chỉ mở khi hai người theo dõi nhau.',

  // C1 — Hồ sơ: hành động theo dõi/chặn
  'profile.nowFollowing': 'Đang theo dõi {name}',
  'profile.followFailed': 'Không theo dõi được, thử lại sau.',
  'profile.unfollowed': 'Đã bỏ theo dõi {name}',
  'profile.undo': 'Hoàn tác',
  'profile.genericError': 'Lỗi, thử lại sau.',
  'profile.openChatFailed': 'Không mở được cuộc trò chuyện. Thử lại nhé.',
  'profile.blockTitle': 'Chặn @{username}?',
  'profile.blockBody': 'Họ không thấy pin của bạn và bạn không thấy pin của họ.',
  'profile.blockYes': 'Chặn',
  'profile.blocked': 'Đã chặn @{username}',
  'profile.blockFailed': 'Không chặn được, thử lại sau.',
  'profile.unblockTitle': 'Bỏ chặn @{username}?',
  'profile.unblockBody': 'Họ sẽ thấy lại pin của bạn và bạn thấy lại pin của họ.',
  'profile.unblocked': 'Đã bỏ chặn @{username}',
  'profile.unblockFailed': 'Không bỏ chặn được, thử lại sau.',

  // C1 — Hồ sơ: tab và lưới
  'profile.tabPins': 'Pin',
  'profile.tabBoards': 'Board',
  'profile.tabSaved': 'Đã lưu',
  'profile.emptyPins': 'Không có pin nào để hiển thị',
  'profile.emptySavedSelf': 'Bạn chưa lưu pin nào',
  'profile.emptySavedOther': 'Chưa lưu pin nào',
  'profile.loadingBoards': 'Đang tải board…',
  'profile.emptyBoards': 'Chưa có board nào',
  'profile.secret': 'Riêng tư',
  'profile.pinCount': '{countText} pin',
  'profile.changeCover': 'Đổi ảnh bìa',
  'profile.changeAvatar': 'Đổi ảnh đại diện',

  // C3 — Follower / Following
  'profile.emptyFollowers': 'Chưa có ai theo dõi',
  'profile.emptyFollowing': 'Chưa theo dõi ai',
  'profile.followToggleFailed': 'Không đổi được trạng thái theo dõi, thử lại sau.',
  'profile.backToProfile': 'Quay lại hồ sơ',
  'profile.followTabsAria': 'Follower và Following',
  'profile.followerCount': '{countText} người theo dõi',
  'profile.followingCount': '{countText} đang theo dõi',
  'profile.listLoadFailed': 'Không tải được danh sách',
} as const;
