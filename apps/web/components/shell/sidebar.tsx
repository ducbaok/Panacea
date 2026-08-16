'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMeUsername } from './use-me-username';
import {
  MAIN_NAV_AUTH,
  MAIN_NAV_GUEST,
  SUB_NAV_AUTH,
  SUB_NAV_GUEST,
  type NavItem,
} from './nav-items';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { useUnreadCount } from './use-unread-count';

/**
 * Sidebar desktop (QĐ-3, mockup Panacea §3.1).
 *
 * ⚠️ CHỈ HIỆN ≥ 768px. Dưới 768px, ẩn hoàn toàn — BottomTabBar tiếp quản
 * (QĐ-4). Class Tailwind `hidden md:flex` xử lý việc này ở ngoài component,
 * xem app/(main)/layout.tsx.
 *
 * Số đo khớp mockup:
 *   • Bề rộng: 240px mở / 72px thu, chuyển 180ms (--duration-sidebar).
 *   • Sticky top:0, height:100vh, overflow-y:auto — cột không tụt khi cuộn.
 *   • Nền surface, viền phải border.
 *   • Brand 60px, "Panacea" 22px primary-strong, font-display (Varela Round).
 *   • Nav item padding 11px 13px (thu gọn: 11px 0, canh giữa), bo 12px, icon
 *     20px stroke 1.7, gap 12px.
 *   • Active: nền primary-soft + font-weight 700 (mục khác 500).
 *   • Huy hiệu: nền primary, chữ primary-foreground, cao 20px, bo 10px — ẩn
 *     khi thu gọn (không đủ chỗ, và số trên chuông TopBar đã thay).
 *   • Group label: 11px/700 uppercase, letter-spacing .07em, muted — ẩn khi thu.
 *   • Nút thu/mở đáy: full width, padding 10px, bo 12px, viền border.
 *
 * KHÔNG chép nhóm "Màn khác" — brief §4.3.
 *
 * State thu gọn:
 *   • Lưu localStorage['sidebar-collapsed'] = 'true' | 'false'.
 *   • Mounted guard tránh hydration mismatch — render lần đầu là bản mở rộng
 *     (khớp SSR), sau tick đầu client mới apply state đã lưu.
 *   • QĐ-3 gợi ý tự thu gọn khi < 1280px, nhưng nếu người dùng đã CÓ lựa chọn
 *     lưu, tôn trọng lựa chọn — kiểm tra localStorage TRƯỚC width.
 */

const COLLAPSE_STORAGE_KEY = 'sidebar-collapsed';
const AUTO_COLLAPSE_WIDTH = 1280;

/**
 * ⚠️ BẮT BUỘC dùng pixel value, KHÔNG dùng var(--sidebar-expanded/collapsed)
 * cho inline `width`.
 *
 * Bẫy đã kiểm ngày 13/08 (docs/debug_history.md):
 *   Chrome không tái đánh giá var() khi property đang transition — nếu inline
 *   `style.width` đổi từ `var(--sidebar-expanded)` sang `var(--sidebar-collapsed)`,
 *   computed width KẸT ở giá trị cũ (240px), không xuống 72px. Chỉ số var()
 *   thay đổi nhưng browser không rerun transition machinery.
 *
 * Hai giá trị này PHẢI khớp --sidebar-expanded/collapsed trong globals.css;
 * nếu đổi token, đổi cả đây (grep 'SIDEBAR_WIDTH').
 */
const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

function readStoredCollapsed(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredCollapsed(value: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(value));
  } catch {
    /* ignore */
  }
}

/**
 * Ghép href hồ sơ với username thật. Route /@{handle} do FE-6 dựng; nếu chưa
 * có username, link vào "/@me" — hiện tại 404, chấp nhận được ở FE-2.
 */
function resolveHref(item: NavItem, username: string | null): string {
  if (item.key === 'profile' && username) return `/@${username}`;
  return item.href;
}

/**
 * Route active khớp bằng exact hoặc prefix cho các nhánh sâu:
 *   • '/' phải exact — không được prefix (mọi route đều bắt đầu bằng '/').
 *   • '/pin/new' → active khi pathname === '/pin/new'.
 *   • '/notifications' → active cả khi pathname === '/notifications/xyz'.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

type NavItemRowProps = {
  item: NavItem;
  href: string;
  collapsed: boolean;
  active: boolean;
  badge?: number;
};

function NavItemRow({ item, href, collapsed, active, badge }: NavItemRowProps) {
  const { Icon, label } = item;
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className="flex items-center rounded-[12px] transition-colors"
      style={{
        padding: collapsed ? '11px 0' : '11px 13px',
        gap: collapsed ? 0 : '12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        background: active ? 'var(--color-primary-soft)' : 'transparent',
        color: 'var(--color-foreground)',
        fontWeight: active ? 700 : 500,
        fontSize: '14px',
      }}
    >
      <Icon />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {typeof badge === 'number' && badge > 0 && (
            <span
              className="inline-flex items-center justify-center text-[11px] font-bold"
              style={{
                background: 'var(--color-primary)',
                color: 'var(--color-primary-foreground)',
                minWidth: '20px',
                height: '20px',
                borderRadius: '10px',
                padding: '0 6px',
              }}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

export function Sidebar() {
  const { status } = useSession();
  const pathname = usePathname() || '/';
  const unreadCount = useUnreadCount();

  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = readStoredCollapsed();
    if (stored !== null) {
      setCollapsed(stored);
    } else if (typeof window !== 'undefined' && window.innerWidth < AUTO_COLLAPSE_WIDTH) {
      setCollapsed(true);
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeStoredCollapsed(next);
      return next;
    });
  }, []);

  const isAuth = status === 'authenticated';
  const mainNav = isAuth ? MAIN_NAV_AUTH : MAIN_NAV_GUEST;
  const subNav = isAuth ? SUB_NAV_AUTH : SUB_NAV_GUEST;
  const username = useMeUsername();

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  return (
    <aside
      role="navigation"
      aria-label="Điều hướng chính"
      data-sidebar-collapsed={mounted ? String(collapsed) : 'false'}
      className="hidden md:flex flex-col shrink-0 sticky top-0 h-screen overflow-y-auto"
      style={{
        width,
        transition: 'width var(--duration-sidebar) ease',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        className="flex items-center px-4"
        style={{
          height: '60px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          color: 'var(--color-primary-strong)',
          fontFamily: 'var(--font-display), var(--font-sans), sans-serif',
          fontSize: '22px',
          fontWeight: 400,
          letterSpacing: '0.01em',
        }}
      >
        {collapsed ? 'P' : 'Panacea'}
      </Link>

      {/* Nav chính */}
      <nav className="flex flex-col gap-1 px-3 pb-2">
        {!collapsed && (
          <div
            className="px-3 pt-2 pb-1 uppercase"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: 'var(--color-muted)',
            }}
          >
            Chính
          </div>
        )}
        {mainNav.map((item) => (
          <NavItemRow
            key={item.key}
            item={item}
            href={resolveHref(item, username)}
            collapsed={collapsed}
            active={isActive(pathname, resolveHref(item, username))}
            badge={item.key === 'notifications' ? unreadCount : undefined}
          />
        ))}
      </nav>

      {/* Nav phụ */}
      <nav className="flex flex-col gap-1 px-3 pt-3 pb-2 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {!collapsed && (
          <div
            className="px-3 pt-1 pb-1 uppercase"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: 'var(--color-muted)',
            }}
          >
            {isAuth ? 'Tài khoản' : 'Bắt đầu'}
          </div>
        )}
        {subNav.map((item) => (
          <NavItemRow
            key={item.key}
            item={item}
            href={resolveHref(item, username)}
            collapsed={collapsed}
            active={isActive(pathname, resolveHref(item, username))}
          />
        ))}
      </nav>

      {/* Đẩy nút thu/mở xuống đáy */}
      <div className="flex-1" />

      {/* Nút thu/mở — chỉ render sau mounted để không nháy trạng thái */}
      {mounted && (
        <div className="p-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Mở rộng cột trái' : 'Thu gọn cột trái'}
            aria-pressed={collapsed}
            className="w-full flex items-center rounded-[12px] transition-colors"
            style={{
              padding: '10px',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-muted)',
              gap: collapsed ? 0 : '8px',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            {!collapsed && <span>Thu gọn</span>}
          </button>
        </div>
      )}
    </aside>
  );
}
