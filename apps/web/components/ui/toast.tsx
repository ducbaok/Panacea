'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * Toast DÙNG CHUNG (mockup v2 `toasts`) — xếp chồng tối đa 3, tự tắt sau 3.800ms.
 * Gọi qua `useToast()`:
 *
 *   const toast = useToast();
 *   toast({ message: 'Đã bỏ theo dõi @bao' });
 *   toast({ message: '…', action: { label: 'Hoàn tác', onClick: () => follow() } });
 *
 * 🔵 QUY TẮC (ban-do-man-panacea.md §1): nút Hoàn tác CHỈ ở hành động ĐẢO ĐƯỢC
 * (bỏ theo dõi → follow; bỏ lưu → lưu lại). KHÔNG hành động PHÁ HUỶ nào có Hoàn
 * tác (xoá/chặn/rời board chỉ toast thường). Truyền `action` đúng theo luật đó.
 *
 * z-index: token `--z-toast` (=70) — lớp cao nhất, trên cả hộp xác nhận (65).
 */
type ToastAction = { label: string; onClick: () => void };
type ToastInput = { message: string; action?: ToastAction };
type ToastItem = ToastInput & { id: number };

const MAX_STACK = 3;
const AUTO_DISMISS_MS = 3800;

type Ctx = { toast: (t: ToastInput) => void };
const ToastContext = createContext<Ctx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext).toast;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    ({ message, action }: ToastInput) => {
      const id = (idRef.current += 1);
      // Giữ tối đa 3 — thêm cái mới, bỏ cái cũ nhất khi tràn.
      setItems((xs) => [...xs, { id, message, action }].slice(-MAX_STACK));
      window.setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {items.length > 0 && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 'var(--z-toast)' as unknown as number,
            width: 'min(360px, calc(100vw - 32px))',
          }}
        >
          {items.map((t) => (
            <div
              key={t.id}
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 14,
                boxShadow: 'var(--shadow-modal)',
                padding: '12px 16px',
              }}
            >
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--color-foreground)', lineHeight: 1.5 }}>
                {t.message}
              </span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick();
                    remove(t.id);
                  }}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--color-primary-strong)',
                    fontWeight: 700,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    padding: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
