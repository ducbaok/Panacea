'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Hộp xác nhận DÙNG CHUNG (mockup v2 `confirm`) — MỘT component cho mọi hành động
 * nguy hiểm (FE-6 chạm 2/7: xoá tài khoản, chặn/bỏ chặn). Gọi qua `useConfirm()`:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: '…', body: '…', yesLabel: 'Xoá', danger: true })) { … }
 *
 * - Promise<boolean>: true = đồng ý, false = huỷ/ESC/bấm nền.
 * - ESC đóng được (= huỷ). Bấm nền tối = huỷ.
 * - z-index: token `--z-confirm` (=65), nằm TRÊN modal (60) và DƯỚI toast (70).
 *   KHÔNG chép số 110 của mockup (bẫy §5f mục 1).
 * - Chữ do call-site truyền vào — bản vẽ đã ghi nguyên văn từng chỗ, chép đừng
 *   sáng tác (§9).
 */
export type ConfirmOptions = {
  title: string;
  body?: string;
  yesLabel?: string;
  cancelLabel?: string;
  /** true ⇒ nút đồng ý nền đỏ (--color-danger). */
  danger?: boolean;
};

type Ctx = { confirm: (opts: ConfirmOptions) => Promise<boolean> };
const ConfirmContext = createContext<Ctx>({ confirm: async () => false });
export const useConfirm = () => useContext(ConfirmContext).confirm;

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);
  const open = opts !== null;

  const settle = useCallback((v: boolean) => {
    resolverRef.current?.(v);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => {
    // Nếu có hộp đang mở, huỷ nó trước (resolve false) rồi mở hộp mới.
    resolverRef.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, settle]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && opts && (
        <div
          onClick={() => settle(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 28,
            zIndex: 'var(--z-confirm)' as unknown as number,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={opts.title}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              background: 'var(--color-surface)',
              borderRadius: 20,
              padding: 26,
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <div
              style={{
                fontFamily: "'Varela Round', sans-serif",
                fontSize: 19,
                color: 'var(--color-foreground)',
              }}
            >
              {opts.title}
            </div>
            {opts.body && (
              <div style={{ fontSize: 13.5, color: 'var(--color-muted)', lineHeight: 1.6, marginTop: 10 }}>
                {opts.body}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => settle(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-foreground)',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                {opts.cancelLabel ?? 'Huỷ'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                autoFocus
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: 'none',
                  background: opts.danger ? 'var(--color-danger)' : 'var(--color-primary)',
                  color: opts.danger ? 'var(--color-danger-foreground)' : 'var(--color-primary-foreground)',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                {opts.yesLabel ?? 'Đồng ý'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
