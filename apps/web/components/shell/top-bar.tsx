'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { ThemeToggle } from '@/components/theme-toggle';
import { BellIcon, SearchIcon } from './icons';
import { useUnreadCount } from './use-unread-count';
import { useMeUsername } from './use-me-username';
import { useT } from '@/lib/i18n/provider';

/**
 * TopBar sticky (QĐ-3b, mockup Panacea §3.2).
 *
 * Số đo khớp mockup:
 *   • Sticky top:0, min-h 60px, padding 10px 24px, nền background, viền dưới
 *     border, flex-wrap wrap.
 *   • Z-index: --z-header (45, giữa dropdown 40 và sheet 50) — không viết số
 *     trần vào component; xem globals.css §"Tầng z" cho lý do (brief §4.2).
 *
 * Search input:
 *   • flex:1 1 260px, max-width 560px, nền surface-muted, viền border, bo 999px.
 *   • Enter → useRouter.push('/search?q=<value>'). Màn D1 chưa có ⇒ 404 mặc
 *     định của Next; đừng dựng màn (brief §5).
 *
 * Chuông chỉ render khi authenticated. Huy hiệu ẩn khi unread=0 (bell trần
 * không phải tin tức thì đừng dụ người dùng bấm).
 *
 * Mobile (< 768px, khung-ui-ux QĐ-3b): rút gọn còn logo + kính lúp + avatar.
 * Theme chip và ô tìm kiếm ẩn — người dùng bấm kính lúp đi tới /search (nơi
 * FE-D1 sẽ dựng ô tìm kiếm to bên trong màn).
 */
export function TopBar() {
  const t = useT();
  const router = useRouter();
  const { data: session, status } = useSession();
  const unread = useUnreadCount();
  const meUsername = useMeUsername();
  const [query, setQuery] = useState('');

  const isAuth = status === 'authenticated';

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const userName = session?.user?.name ?? session?.user?.email ?? '';
  const initial = userName ? userName.charAt(0).toUpperCase() : '?';

  return (
    <header
      className="sticky top-0 flex flex-wrap items-center gap-3"
      style={{
        zIndex: 'var(--z-header)',
        minHeight: '60px',
        padding: '10px 24px',
        background: 'var(--color-background)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Logo mobile — chỉ hiện dưới md */}
      <Link
        href="/"
        className="md:hidden"
        style={{
          fontFamily: 'var(--font-display), var(--font-sans), sans-serif',
          fontSize: '20px',
          color: 'var(--color-primary-strong)',
        }}
      >
        Panacea
      </Link>

      {/* Search — desktop dạng ô đầy đủ, mobile chỉ còn nút kính lúp */}
      <form
        role="search"
        onSubmit={onSearch}
        className="hidden md:flex items-center gap-2"
        style={{
          flex: '1 1 260px',
          maxWidth: '560px',
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          borderRadius: '999px',
          padding: '9px 16px',
        }}
      >
        <SearchIcon width={17} height={17} style={{ color: 'var(--color-muted)' }} />
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('nav.searchPlaceholder')}
          aria-label={t('nav.searchBoxLabel')}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: 'var(--color-foreground)' }}
        />
      </form>

      {/* Kính lúp mobile — link tới /search (FE-D1 sẽ dựng màn có ô lớn) */}
      <Link
        href="/search"
        aria-label={t('nav.search')}
        className="md:hidden inline-flex items-center justify-center rounded-full"
        style={{
          width: '40px',
          height: '40px',
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-muted)',
          marginLeft: 'auto',
        }}
      >
        <SearchIcon />
      </Link>

      {/* Đẩy nhóm phải sang phải khi ở desktop (mobile đã có ml-auto ở kính lúp) */}
      <div className="hidden md:block flex-1" />

      {/* Theme chip — chỉ desktop */}
      <div className="hidden md:inline-flex">
        <ThemeToggle />
      </div>

      {/* Chuông + huy hiệu — chỉ khi đã đăng nhập */}
      {isAuth && (
        <Link
          href="/notifications"
          aria-label={
            unread > 0
              ? t('nav.notificationsAriaUnread', { count: unread })
              : t('nav.notificationsAria')
          }
          className="relative inline-flex items-center justify-center rounded-full"
          style={{
            width: '40px',
            height: '40px',
            background: 'transparent',
            color: 'var(--color-foreground)',
          }}
        >
          <BellIcon />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute inline-flex items-center justify-center text-[10px] font-bold"
              style={{
                top: '-3px',
                right: '-3px',
                minWidth: '17px',
                height: '17px',
                borderRadius: '9px',
                padding: '0 5px',
                background: 'var(--color-primary-strong)',
                color: 'var(--color-primary-foreground)',
              }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
      )}

      {/* Avatar hoặc nút Đăng nhập */}
      {isAuth ? (
        <Link
          href={meUsername ? `/@${meUsername}` : '/'}
          aria-label={t('nav.myProfile')}
          className="inline-flex items-center justify-center rounded-full overflow-hidden"
          style={{
            width: '38px',
            height: '38px',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            fontWeight: 700,
            fontSize: '14px',
          }}
        >
          {session?.user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt=""
              width={38}
              height={38}
              style={{ objectFit: 'cover', width: '100%', height: '100%' }}
            />
          ) : (
            initial
          )}
        </Link>
      ) : (
        <Link
          href="/login"
          className="inline-flex items-center rounded-full text-sm font-semibold"
          style={{
            padding: '9px 18px',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
          }}
        >
          {t('nav.login')}
        </Link>
      )}
    </header>
  );
}
