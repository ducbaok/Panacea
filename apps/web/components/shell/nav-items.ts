import type { ComponentType, SVGProps } from 'react';
import {
  BellIcon,
  CompassIcon,
  HomeIcon,
  LoginIcon,
  MessageCircleIcon,
  PlusIcon,
  RegisterIcon,
  SettingsIcon,
  UserIcon,
} from './icons';

/**
 * Định nghĩa nav dùng CHUNG cho Sidebar (desktop) và BottomTabBar (mobile).
 *
 * Vì sao gộp về đây, không nhân đôi:
 *   Nếu Sidebar và BottomTabBar mỗi bên tự định nghĩa 5–8 mục, mọi lần đổi
 *   route đích (VD: /pins/new → /pin/new) sẽ phải sửa 2 chỗ và người sửa hay
 *   quên một. Cùng một danh mục có 2 nguồn ⇒ 100% sẽ lệch.
 *
 * KHÔNG chép nhóm "Màn khác" của mockup (Tìm kiếm · Chi tiết board · Hệ trạng
 * thái · Mobile) — đó là giàn giáo của người xem mockup, không phải nav thật
 * (brief FE-2 §4.3).
 *
 * ⚠️ Route đích:
 *   • Mục "Hồ sơ" trỏ tới `/@${username}`; nếu chưa đăng nhập KHÔNG hiện mục
 *     này (guest sidebar không có phần phụ này).
 *   • "Tin nhắn" trên Sidebar desktop; BottomTabBar mobile CỐ Ý thay bằng
 *     "Hồ sơ" (QĐ-4, khung-ui-ux.md dòng 79).
 *   • 🔴 REVIEW-1 (18/08/2026) — mục "Khám phá" ĐÃ BỎ khỏi cả ba danh mục.
 *     Người dùng chốt: dải chip chủ đề chuyển vào tab "Khám phá" của trang
 *     chủ, `/explore` chỉ còn là redirect. Đây là ĐẢO một quyết định thiết kế
 *     cũ (`docs/khung-ui-ux.md` §QĐ-1 từng ghi "dải gợi ý là thứ duy nhất
 *     phân biệt hai màn — đừng bỏ"); lý do đảo: dải gợi ý đó thuộc đợt
 *     FE-ONBOARDING chưa làm, nên trên sản phẩm thật hai màn trông y hệt nhau.
 *   • `/pin/new` mang cờ `hardNav` — xem chú thích của field đó.
 */

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type NavItem = {
  key: string;
  label: string;
  href: string;
  Icon: NavIcon;
  /**
   * Có đòi hỏi phiên đăng nhập không? Dùng để lọc ở shell khách vãng lai.
   * true = ẩn hoàn toàn khi khách; false hoặc undefined = luôn hiện.
   */
  authRequired?: boolean;
  /**
   * Bắt buộc điều hướng CỨNG (thẻ `<a>` thường, full page load) thay vì
   * `<Link>` soft-nav.
   *
   * 🔴 REVIEW-1 (#3) — chỉ dùng cho `/pin/new`, và đây là một cách NÉ chứ
   * không phải cách sửa gốc. Bệnh: slot `@modal` resolve độc lập với cây
   * `children`, nên soft-nav tới `/pin/new` bị ứng viên duy nhất trong slot
   * là `(.)pin/[id]` khớp với `id="new"` ⇒ modal "Không tìm thấy pin này."
   * đè lên trang chủ. Đã ĐO trên trình duyệt 18/08/2026, và đã đo cả hai
   * hướng sửa gốc — **cả hai đều trượt**:
   *   • `@modal/pin/new/page.tsx` (route thường, KHÔNG marker): interception
   *     vẫn thắng ⇒ vẫn "Không tìm thấy pin này."
   *   • `(.)pin/[id]` trả `null` khi `id === 'new'`: modal biến mất nhưng
   *     `children` ĐÓNG BĂNG ở trang cũ ⇒ bấm "Tạo" **không có gì xảy ra**.
   * Doc Next xác nhận lý do: interception là hành vi của soft navigation —
   * "when navigating … by refreshing the page … No route interception should
   * occur". Nên đường thoát chắc chắn duy nhất là KHÔNG soft-nav.
   *
   * Lưới an toàn thứ hai nằm ở `@modal/(.)pin/[id]/pin-modal.tsx` (tự thoát
   * khi `id === 'new'`), phòng đường vào nào khác quên cờ này.
   */
  hardNav?: boolean;
};

/** Nav chính của Sidebar desktop khi ĐÃ đăng nhập (4 mục). */
export const MAIN_NAV_AUTH: ReadonlyArray<NavItem> = [
  { key: 'home', label: 'Trang chủ', href: '/', Icon: HomeIcon },
  { key: 'create', label: 'Tạo', href: '/pin/new', Icon: PlusIcon, authRequired: true, hardNav: true },
  {
    key: 'notifications',
    label: 'Thông báo',
    href: '/notifications',
    Icon: BellIcon,
    authRequired: true,
  },
  {
    key: 'messages',
    label: 'Tin nhắn',
    href: '/messages',
    Icon: MessageCircleIcon,
    authRequired: true,
  },
];

/** Nav chính của Sidebar khi khách vãng lai (2 mục, per QĐ-1 + brief §3.1). */
export const MAIN_NAV_GUEST: ReadonlyArray<NavItem> = MAIN_NAV_AUTH.filter(
  (i) => !i.authRequired,
);

/**
 * Nav phụ (đáy Sidebar) khi ĐÃ đăng nhập.
 * Href hồ sơ sẽ được ghép runtime với @username — xem components/shell/sidebar.tsx.
 */
export const SUB_NAV_AUTH: ReadonlyArray<NavItem> = [
  { key: 'profile', label: 'Hồ sơ', href: '/@me', Icon: UserIcon, authRequired: true },
  { key: 'settings', label: 'Cài đặt', href: '/settings', Icon: SettingsIcon, authRequired: true },
];

/** Nav phụ khi khách vãng lai (2 nút): Đăng nhập · Đăng ký. */
export const SUB_NAV_GUEST: ReadonlyArray<NavItem> = [
  { key: 'login', label: 'Đăng nhập', href: '/login', Icon: LoginIcon },
  { key: 'register', label: 'Đăng ký', href: '/register', Icon: RegisterIcon },
];

/**
 * BottomTabBar mobile — 5 tab, KHÁC nav Sidebar desktop 1 mục:
 *   desktop nav chính:  Trang chủ · Khám phá · Tạo · Thông báo · Tin nhắn
 *   mobile bottom tab:  Trang chủ · Khám phá · Tạo · Thông báo · Hồ sơ
 *
 * QĐ-4 + khung-ui-ux.md dòng 79: "Tin nhắn không có chỗ trên thanh tab ⇒ đưa
 * vào trang Hồ sơ (mục trong menu) và cho vào Thông báo một lối tắt."
 */
export const BOTTOM_TABS_AUTH: ReadonlyArray<NavItem> = [
  { key: 'home', label: 'Trang chủ', href: '/', Icon: HomeIcon },
  { key: 'create', label: 'Tạo', href: '/pin/new', Icon: PlusIcon, authRequired: true, hardNav: true },
  {
    key: 'notifications',
    label: 'Thông báo',
    href: '/notifications',
    Icon: BellIcon,
    authRequired: true,
  },
  { key: 'profile', label: 'Hồ sơ', href: '/@me', Icon: UserIcon, authRequired: true },
];

/**
 * BottomTabBar mobile khi khách vãng lai — 3 tab (Trang chủ, Khám phá, Đăng
 * nhập). Nếu chỉ còn 2 tab, nút login mất chỗ ⇒ khách khó tìm đường vào; gộp
 * làm 3 tab bảo đảm mọi hành động cần auth vẫn có đường đi.
 */
export const BOTTOM_TABS_GUEST: ReadonlyArray<NavItem> = [
  { key: 'home', label: 'Trang chủ', href: '/', Icon: HomeIcon },
  { key: 'login', label: 'Đăng nhập', href: '/login', Icon: LoginIcon },
];
