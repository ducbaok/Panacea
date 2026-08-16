'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMeUsername } from './use-me-username';
import {
  BOTTOM_TABS_AUTH,
  BOTTOM_TABS_GUEST,
  type NavItem,
} from './nav-items';

/**
 * BottomTabBar mobile (QĐ-4, mockup Panacea §3.3).
 *
 * ⚠️ CHỈ HIỆN < 768px. Trên desktop, Sidebar tiếp quản — class `md:hidden`.
 *
 * Số đo:
 *   • Fixed bottom, full-width, background surface, viền trên border.
 *   • Icon trên + nhãn dưới, gap 3px.
 *   • Active: primary-strong. Inactive: muted.
 *   • Auth: 5 tab (Trang chủ · Khám phá · Tạo · Thông báo · Hồ sơ) — LƯU Ý
 *     tab thứ 5 là Hồ sơ, KHÔNG phải Tin nhắn (QĐ-4).
 *   • Guest: 3 tab (Trang chủ · Khám phá · Đăng nhập).
 *
 * Layout main phải chừa padding-bottom cho vùng nội dung — xem (main)/layout.tsx.
 * Dùng --z-header (45) để nằm trên nội dung nhưng dưới modal.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function resolveHref(item: NavItem, username: string | null): string {
  if (item.key === 'profile' && username) return `/@${username}`;
  return item.href;
}

export function BottomTabBar() {
  const { status } = useSession();
  const pathname = usePathname() || '/';
  const isAuth = status === 'authenticated';
  const tabs = isAuth ? BOTTOM_TABS_AUTH : BOTTOM_TABS_GUEST;
  const username = useMeUsername();

  return (
    <nav
      role="navigation"
      aria-label="Điều hướng mobile"
      className="md:hidden fixed bottom-0 left-0 right-0 flex items-stretch"
      style={{
        zIndex: 'var(--z-header)',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      {tabs.map((item) => {
        const href = resolveHref(item, username);
        const active = isActive(pathname, href);
        const { Icon, label } = item;
        return (
          <Link
            key={item.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className="flex-1 flex flex-col items-center justify-center"
            style={{
              gap: '3px',
              padding: '10px 4px',
              color: active ? 'var(--color-primary-strong)' : 'var(--color-muted)',
              fontSize: '11px',
              fontWeight: active ? 700 : 500,
            }}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
