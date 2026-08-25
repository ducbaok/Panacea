/**
 * F2 (XH-10) — chữ của hai màn: KHO (XH-ARCHIVE) và AI ĐÃ XEM (XH-VIEWERS).
 *
 * Chuỗi chép NGUYÊN VĂN từ `Panacea-v3.1.html`. "Vẽ ra là chốt" — chỗ nào bản
 * vẽ đã có chữ thì không sáng tác lại. Bốn chỗ CỐ Ý khác bản vẽ, đều ghi lý do
 * tại chỗ dùng:
 *   • nhãn nhóm tháng: bản vẽ ghi cứng "Tháng này / Tháng 7 / Tháng 6"; ở đây
 *     sinh từ ngày thật, và có thêm biến thể kèm NĂM cho pin cũ hơn 12 tháng —
 *     bản vẽ không có trạng thái đó vì mock chỉ dựng 3 tháng gần nhau;
 *   • badge "Hết hạn X trước": bản vẽ ghi cứng từng chuỗi cho từng thẻ mock,
 *     ở đây là 3 mốc (giờ · ngày · tháng) tính từ `expiresAt` thật;
 *   • dòng đếm người xem: bản vẽ ghi cứng "3 người đã xem", ở đây lấy độ dài
 *     mảng `pinViewers` thật;
 *   • KHÔNG có cột thời điểm xem bên phải mỗi hàng người xem (bản vẽ có
 *     "14:02 hôm nay"). Lý do: `pinViewers` trả `[User!]!` — backend cố ý dùng
 *     `firstViewedAt` để XẾP THỨ TỰ rồi bỏ đi, không khai ra schema. Xem
 *     `pin-viewers.tsx` và mục "docs cần sửa" của báo cáo F2.
 */
export const archive = {
  // ── Kho (XH-ARCHIVE) ──
  'archive.tab': 'Kho',
  'archive.loading': 'Đang tải kho…',
  'archive.emptyTitle': 'Kho đang trống',
  'archive.emptyBody':
    'Pin bạn đặt hạn sống sẽ về đây sau khi hết hạn, kèm nguyên bình luận cũ.',

  // Nhãn nhóm theo tháng. KHÔNG có dải "một năm trước hôm nay" — QĐ-24 chốt bỏ.
  // `monthName` là tên tháng theo locale (bản vi không dùng tới, bản en dùng).
  'archive.groupThisMonth': 'Tháng này',
  'archive.groupMonth': 'Tháng {month}',
  'archive.groupMonthYear': 'Tháng {month}/{year}',

  // Badge trên thẻ — dấu hiệu "đã hết hạn lúc nào" (spec §1 trạng thái 1).
  'archive.expiredHoursAgo': 'Hết hạn {count} giờ trước',
  'archive.expiredDaysAgo': 'Hết hạn {count} ngày trước',
  'archive.expiredMonthsAgo': 'Hết hạn {count} tháng trước',
  'archive.expiredJustNow': 'Vừa hết hạn',

  // Đăng lại — CÓ confirm, nội dung nêu rõ "về đúng chỗ cũ theo ngày đăng gốc".
  'archive.republish': 'Đăng lại',
  'archive.republishConfirmTitle': 'Đăng lại “{title}”?',
  'archive.republishConfirmBody':
    '{audience} sẽ thấy lại pin này. Pin về đúng chỗ cũ theo ngày đăng gốc, bình luận cũ vẫn còn.',
  'archive.republished': 'Đã đăng lại pin',
  'archive.republishFailed': 'Đăng lại không thành công',

  // Chủ ngữ đầu câu của body confirm — viết hoa, KHÁC bộ `circles.audience*`
  // vốn nằm giữa câu ("Đang chỉ vòng Bạn thân xem được").
  'archive.audienceEveryone': 'Mọi người',
  'archive.audienceFollowers': 'Người theo dõi bạn',
  'archive.audienceCircle': 'Vòng {name}',
  'archive.audienceOnlyMe': 'Chỉ mình bạn',

  // ── Ai đã xem (XH-VIEWERS) ──
  'viewers.count': '{count} người đã xem',
  'viewers.none': 'Chưa ai xem',
  'viewers.onlyYou': 'chỉ bạn thấy dòng này',
  'viewers.loading': 'Đang tải…',
  'viewers.emptyTitle': 'Chưa ai mở pin này',
  'viewers.emptyBody':
    'Bạn vừa đăng thôi. Khi ai đó trong vòng mở ra, họ sẽ hiện ở đây.',
  'viewers.note':
    'Sắp theo lần xem đầu, mới nhất trước. Khách vãng lai không có tên nên không vào danh sách. Ai bị bớt khỏi vòng thì biến mất khỏi đây.',
} as const;
