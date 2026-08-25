/**
 * F1 (XH-8 + XH-9b) — chữ của nhóm màn XÃ HỘI: bộ chọn khán giả, nhãn quyền
 * trên lưới, quản lý vòng tròn ở /settings, màn chụp ảnh.
 *
 * Chuỗi chép NGUYÊN VĂN từ `Panacea-v3.1.html` (XH-AUD · XH-LABEL · XH-CIRCLES
 * · XH-CAM). "Vẽ ra là chốt" — chỗ nào bản vẽ đã có chữ thì không sáng tác lại.
 * Ba chỗ CỐ Ý khác bản vẽ, đều ghi lý do tại chỗ dùng:
 *   • nhãn nút vào màn chụp là "Chụp ảnh" chứ không phải "Chụp / Quay" (phần
 *     video vẽ sẵn nhưng KHÔNG thuộc phạm vi F1 — `xahoi-dieu-phoi.md` §2);
 *   • phụ đề mức FOLLOWERS lấy số người theo dõi THẬT, bản vẽ ghi cứng 1.204;
 *   • nhãn vòng ad-hoc do FE sinh ("Nhóm N người") vì backend cố ý lưu `name`
 *     rỗng, không nhét chuỗi tiếng Việt vào database.
 */
export const circles = {
  // ── Bộ chọn khán giả (XH-AUD) ──
  'circles.audienceLabel': 'Ai xem được pin này',
  'circles.visPublic': 'Công khai',
  'circles.visPublicSub': 'Ai cũng xem được, kể cả người chưa đăng nhập',
  'circles.visFollowers': 'Người theo dõi',
  'circles.visFollowersSub': '{count} người đang theo dõi bạn',
  'circles.visFollowersSubUnknown': 'Những người đang theo dõi bạn',
  'circles.visCircle': 'Một vòng tròn',
  'circles.visCircleSub': 'Chọn đúng một vòng — trộn hai vòng nghĩa là tạo vòng mới',
  'circles.visOnlyMe': 'Chỉ mình tôi',
  'circles.visOnlyMeSub': 'Không ai khác thấy pin này',
  'circles.yourCircles': 'Vòng của bạn',
  'circles.memberCount': '{count} người',
  'circles.rankSuffix': 'mức thân thiết {rank}',
  'circles.noRank': 'chưa xếp mức',
  'circles.pickPeopleInline': '+ Chọn người tại chỗ',
  'circles.adhocHeading': 'Chọn người — gợi ý từ bạn của bạn',
  'circles.adhocNone': 'Chưa chọn ai',
  'circles.adhocChosen': 'Đã chọn {count} người',
  'circles.saveThisCircle': 'Lưu vòng tròn này',
  'circles.adhocNote':
    'Không lưu thì vẫn đăng được — vòng tại chỗ không cần tên và không hiện trong danh sách vòng.',
  'circles.adhocSaved': 'Đã lưu vòng tròn',
  'circles.adhocSavePrompt': 'Đặt tên cho vòng này',
  'circles.pickerEmptyTitle': 'Bạn chưa có vòng nào',
  'circles.pickerEmptyBody':
    'Vòng tròn là nhóm người bạn muốn chia sẻ riêng. Tạo một vòng rồi quay lại đây.',
  'circles.createCircle': 'Tạo vòng tròn',
  'circles.adHocName': 'Nhóm {count} người',
  'circles.sharedPrivately': 'Chia sẻ riêng',

  // ── Hạn sống (QĐ-23) ──
  'circles.expiryHeading': 'Hạn sống',
  'circles.expiryNone': 'Không đặt',
  'circles.expiry24h': '24 giờ',
  'circles.expiry7d': '7 ngày',
  'circles.expiryCustom': 'Tự chọn…',
  'circles.expiryDate': 'Ngày',
  'circles.expiryTime': 'Giờ',
  'circles.expiryEcho': 'Hết hạn {time} ngày {date} — {left}.',
  'circles.expiryPast': 'Chọn một thời điểm trong tương lai.',
  'circles.expiryNoteNone': 'Pin ở lại cho tới khi bạn xoá.',
  'circles.expiryNoteSet':
    'Hết hạn, pin biến mất khỏi mọi bề mặt — kể cả hồ sơ của bạn — và rơi vào Kho. Bình luận và cảm xúc giữ nguyên.',
  'circles.leftHours': 'còn {count} giờ',
  'circles.leftDays': 'còn {count} ngày',

  // ── Chống đăng nhầm: confirm riêng → công khai ──
  'circles.confirmPublicTitle': 'Chuyển pin này thành công khai?',
  'circles.confirmPublicBody':
    'Đang chỉ {audience} xem được. Công khai nghĩa là bất kỳ ai cũng thấy, kể cả người chưa đăng nhập.',
  'circles.confirmPublicYes': 'Chuyển công khai',
  'circles.audienceCircleName': 'vòng {name}',
  'circles.audienceFollowers': 'người theo dõi bạn',
  'circles.audienceOnlyMe': 'riêng bạn',
  'circles.audienceEveryone': 'mọi người',

  // ── Quản lý vòng tròn ở /settings (XH-CIRCLES) ──
  'circles.title': 'Vòng tròn',
  'circles.subtitle':
    'Một chiều: người được thêm không được hỏi, không nhận thông báo. Rời vòng là mất quyền xem hồi tố, im lặng.',
  'circles.settingsCardBody':
    'Nhóm người bạn chia sẻ riêng. Một chiều — người được thêm không được hỏi và không nhận thông báo.',
  'circles.settingsCardAction': 'Quản lý vòng tròn',
  'circles.settingsCardCount': '{count} vòng',
  'circles.capNote':
    'Trần: 20 vòng một người (tính cả vòng tại chỗ) · 50 người một vòng. Vòng tại chỗ không hiện ở màn này.',
  'circles.newCircle': 'Tạo vòng mới',
  'circles.emptyListTitle': 'Bạn chưa có vòng nào',
  'circles.emptyListBody':
    'Vòng tròn là nhóm người bạn muốn chia sẻ riêng — bạn thân, gia đình, nhóm cùng sở thích.',
  'circles.createFirst': 'Tạo vòng đầu tiên',
  'circles.backAll': 'Tất cả vòng',
  'circles.editNameRank': 'Sửa tên / mức',
  'circles.duplicate': 'Nhân bản vòng',
  'circles.deleteCircle': 'Xoá vòng',
  'circles.noMembersTitle': 'Vòng này chưa có ai',
  'circles.noMembersBody':
    'Pin chia sẻ cho vòng rỗng thì không ai xem được — giống Chỉ mình tôi. Thêm người ở dưới.',
  'circles.addPeople': 'Thêm người',
  'circles.searchPlaceholder': 'Gõ tên hoặc @username',
  'circles.suggestHeading': 'Gợi ý từ bạn của bạn',
  'circles.searchHeading': 'Kết quả tìm kiếm',
  'circles.add': 'Thêm',
  'circles.drop': 'Bớt',
  'circles.loadFailed': 'Không tải được vòng tròn.',
  'circles.notFound': 'Vòng này không tồn tại, hoặc không phải của bạn.',

  // Tên + mức khi tạo / sửa
  'circles.namePrompt': 'Tên vòng',
  'circles.namePlaceholder': 'Bạn thân, Gia đình, Nhóm nấu ăn…',
  'circles.rankPrompt': 'Mức thân thiết (tuỳ chọn)',
  'circles.rankPlaceholder': 'Số nhỏ = thân hơn',
  'circles.duplicateNameSuffix': '{name} (2)',
  'circles.created': 'Đã tạo vòng “{name}”',
  'circles.updated': 'Đã lưu thay đổi',
  'circles.duplicated': 'Đã tạo bản sao “{name}”',
  'circles.deleted': 'Đã xoá vòng',
  'circles.memberAdded': 'Đã thêm {name} vào vòng',
  'circles.memberDropped': 'Đã bớt {name}',

  // Confirm — nội dung nêu rõ tính hồi tố (spec §3)
  'circles.confirmDropTitle': 'Bớt {name} khỏi vòng?',
  'circles.confirmDropBody':
    'Họ mất quyền xem mọi pin đã chia sẻ cho vòng này, kể cả pin cũ. Không có thông báo nào gửi đi.',
  'circles.confirmDropYes': 'Bớt khỏi vòng',
  'circles.confirmDeleteTitle': 'Xoá vòng “{name}”?',
  'circles.confirmDeleteBody':
    'Mọi người trong vòng mất quyền xem các pin đã chia sẻ cho vòng này. Pin không bị xoá.',
  'circles.confirmDeleteYes': 'Xoá vòng',

  // ── Màn chụp ảnh (XH-CAM) ──
  'capture.open': 'Chụp ảnh',
  'capture.back': 'Quay lại tạo pin',
  'capture.title': 'Chụp ảnh',
  'capture.subtitle':
    'Chụp xong đi tiếp vào bộ chọn khán giả — không có luồng đăng thứ hai.',
  'capture.promptTitle': 'Panacea cần dùng camera',
  'capture.promptBody': 'Ảnh chỉ rời máy khi bạn bấm Đăng.',
  'capture.allow': 'Cho phép camera',
  'capture.pickFromDisk': 'Chọn ảnh từ máy',
  'capture.deniedTitle': 'Trình duyệt đang chặn camera',
  'capture.deniedBody':
    'Mở biểu tượng ổ khoá trên thanh địa chỉ → Camera → Cho phép, rồi tải lại trang. Hoặc cứ chọn ảnh có sẵn như cũ.',
  'capture.noCamNote':
    'Không dò thấy camera trên thiết bị này — nút chụp để mờ thay vì ẩn, để bạn biết tính năng có tồn tại. Dùng “Chọn ảnh từ máy”.',
  'capture.insecureNote':
    'Camera chỉ chạy trên HTTPS hoặc localhost. Trang này không thoả điều kiện đó — dùng “Chọn ảnh từ máy”.',
  'capture.shoot': 'Chụp',
  'capture.use': 'Dùng ảnh này',
  'capture.retake': 'Chụp lại',
  'capture.reviewNote':
    'Giữ nguyên hướng EXIF — ảnh dọc không được thành ngang. imageWidth/Height gửi lên là số đo ảnh gốc để lưới chừa đúng chỗ.',
  'capture.startFailed': 'Không mở được camera. Thử chọn ảnh từ máy.',
  'capture.previewAlt': 'Ảnh vừa chụp',
  'capture.streamAria': 'Khung ngắm camera',
} as const;
