import { redirect } from 'next/navigation';

/**
 * REVIEW-1 (#2, 18/08/2026) — `/explore` nay chỉ còn là đường chuyển hướng.
 *
 * Trước đợt này đây là màn B2 riêng: h1 "Khám phá" + dải chip chủ đề + lưới
 * `exploreFeed`. Người dùng báo lại rằng trang chủ đã có tab "Khám phá" rồi mà
 * nav vẫn còn một mục "Khám phá" nữa dẫn tới màn trông y hệt.
 *
 * Họ đúng, và lý do lệch nằm ở chỗ khác: `docs/khung-ui-ux.md` §QĐ-1 chấp nhận
 * hai màn cùng nội dung với điều kiện trang chủ có dải gợi ý riêng để phân biệt
 * — nhưng dải đó thuộc đợt FE-ONBOARDING chưa làm, nên điều kiện chưa bao giờ
 * thành hiện thực. Người dùng chốt (18/08): bỏ mục nav, chuyển dải chip chủ đề
 * vào tab "Khám phá" của trang chủ. Đây là ĐẢO một quyết định thiết kế cũ.
 *
 * Giữ lại route thay vì xoá hẳn: link cũ, bookmark và mục "Khám phá" trong
 * lịch sử trình duyệt vẫn còn ngoài kia — xoá file này là chúng thành 404.
 * `redirect` trong server component ⇒ 307, không tốn một lượt render client.
 *
 * Nội dung cũ của màn nay sống ở `components/home/explore-section.tsx`.
 */
export default function ExplorePage() {
  redirect('/');
}
