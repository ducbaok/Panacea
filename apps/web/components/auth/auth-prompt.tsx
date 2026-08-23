'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/translate';

/**
 * AuthPromptModal (mockup `showAuthPrompt`) — khách bấm hành động cần đăng nhập
 * (lưu pin / theo dõi / thả cảm xúc / bình luận) thì mở modal thay vì làm gì.
 *
 * Giữ vị trí cuộn (§3.3, T2.4): trước khi rời sang /login lưu `scrollY` + đường
 * dẫn hiện tại vào sessionStorage; sau vòng đăng nhập, `ScrollRestorer` ở layout
 * (main) khôi phục. callbackUrl lấy từ `window.location` (client) nên KHÔNG cần
 * useSearchParams (tránh ép Suspense toàn app).
 *
 * z-index: dùng token `--z-modal` (=60), KHÔNG chép `z-index:90` của mockup (bẫy #3).
 */
/**
 * i18n (23/08/2026) — `openAuthPrompt` nhận KEY, không nhận chữ.
 * Trước đây màn gọi `openAuthPrompt('lưu pin này')` ⇒ tiêu đề modal đứng yên
 * tiếng Việt kể cả khi app đang chạy English. Kiểu `TranslationKey` bắt gõ sai
 * key ở thì biên dịch.
 */
type Ctx = { openAuthPrompt: (actionKey: TranslationKey) => void };
const AuthPromptContext = createContext<Ctx>({ openAuthPrompt: () => {} });
export const useAuthPrompt = () => useContext(AuthPromptContext);

export const RETURN_SCROLL_KEY = 'auth:returnScroll';

export function AuthPromptProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [actionKey, setActionKey] = useState<TranslationKey | null>(null);
  const open = actionKey !== null;

  const openAuthPrompt = useCallback(
    (key: TranslationKey) => setActionKey(key || 'auth.actionDefault'),
    [],
  );
  const close = useCallback(() => setActionKey(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const go = useCallback(
    (base: '/login' | '/register') => {
      const cb = window.location.pathname + window.location.search;
      try {
        sessionStorage.setItem(RETURN_SCROLL_KEY, JSON.stringify({ path: cb, y: window.scrollY }));
      } catch {
        /* sessionStorage không dùng được — bỏ qua khôi phục cuộn, không chặn login */
      }
      setActionKey(null);
      router.push(`${base}?callbackUrl=${encodeURIComponent(cb)}`);
    },
    [router],
  );

  return (
    <AuthPromptContext.Provider value={{ openAuthPrompt }}>
      {children}
      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 28,
            zIndex: 'var(--z-modal)' as unknown as number,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              background: 'var(--color-surface)',
              borderRadius: 22,
              padding: 30,
              boxShadow: 'var(--shadow-modal)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 22, color: 'var(--color-primary-strong)' }}>
              Panacea
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 14, color: 'var(--color-foreground)' }}>
              {t('auth.promptTitle', { action: t(actionKey) })}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--color-muted)', lineHeight: 1.6, marginTop: 8 }}>
              {t('auth.promptBody')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 22 }}>
              <button
                type="button"
                onClick={() => go('/login')}
                style={{
                  padding: 12,
                  borderRadius: 999,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-foreground)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {t('auth.login')}
              </button>
              <button
                type="button"
                onClick={() => go('/register')}
                style={{
                  padding: 12,
                  borderRadius: 999,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-foreground)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {t('auth.createAccount')}
              </button>
              <button
                type="button"
                onClick={close}
                style={{
                  padding: 10,
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {t('auth.later')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthPromptContext.Provider>
  );
}
