'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ThemeToggle 3 trạng thái (QĐ-6b).
 *
 * FE-1a dựng cơ chế (không trang trí); FE-2 khoác giao diện 3 chip theo mockup
 * Panacea §3.2:
 *   • padding 6px 12px, bo 999px, 12px/600
 *   • chip đang chọn: nền surface + shadow-card
 *   • chip khác: trong suốt + màu muted
 *   • nhãn "Sáng · Tối · Auto" (title đầy đủ "Theo hệ thống" cho chip Auto để
 *     người rê chuột thấy nghĩa gốc — mockup gọi tắt là "Auto")
 *
 * Cơ chế bên dưới GIỮ NGUYÊN từ FE-1a — mọi thứ dưới đây ĐÃ QUA T2 rồi:
 *   • 'light'  → localStorage['theme']='light', <html data-theme="light">
 *   • 'dark'   → localStorage['theme']='dark',  <html data-theme="dark">
 *   • 'system' → localStorage xoá, KHÔNG có attribute, CSS bám @media
 *                (prefers-color-scheme: dark). matchMedia listener ở chế độ
 *                'system' bảo đảm giao diện đổi theo ngay khi user đổi cài đặt
 *                OS trong lúc trang đang mở.
 *
 * Bẫy hydration đã tránh: `mounted` guard ẩn nội dung ở lần render đầu để
 * server + client render CÙNG một DOM (một khoảng trống). Anti-flash script
 * trong app/layout.tsx đã đặt sẵn attribute trước paint đầu.
 */

type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string; title: string }> = [
  { value: 'light', label: 'Sáng', title: 'Giao diện sáng' },
  { value: 'dark', label: 'Tối', title: 'Giao diện tối' },
  { value: 'system', label: 'Auto', title: 'Theo hệ thống' },
];

function readStoredChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyChoice(choice: ThemeChoice) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota / disabled storage */
    }
  } else {
    root.setAttribute('data-theme', choice);
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* ignore quota / disabled storage */
    }
  }
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    setMounted(true);
    setChoice(readStoredChoice());
    // KHÔNG cần matchMedia listener ở component này: khi choice='system' và
    // OS đổi cài đặt, background/foreground đổi tự động qua @media trong
    // globals.css — component không hiển thị hiệu ứng nào phụ thuộc systemDark
    // (phép T2.5 vẫn pass nhờ CSS, không nhờ React state). Nếu về sau cần chip
    // active nháy khi effective đổi, thêm state systemDark ở đây.
  }, []);

  const pick = useCallback((next: ThemeChoice) => {
    applyChoice(next);
    setChoice(next);
  }, []);

  // Server render + tick đầu client: hộp có kích thước xấp xỉ để tránh layout
  // shift khi hydrate xong. Ẩn nội dung bằng visibility, không display:none.
  if (!mounted) {
    return (
      <div
        role="group"
        aria-label="Chế độ hiển thị"
        aria-hidden
        style={{ visibility: 'hidden' }}
        className="inline-flex items-center gap-1 rounded-full p-1"
      >
        <span className="px-3 py-1.5 text-xs">Sáng</span>
        <span className="px-3 py-1.5 text-xs">Tối</span>
        <span className="px-3 py-1.5 text-xs">Auto</span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Chế độ hiển thị"
      className="inline-flex items-center gap-1 rounded-full p-1"
      style={{ background: 'var(--color-surface-muted)' }}
    >
      {CHOICES.map((c) => {
        const active = choice === c.value;
        return (
          <button
            key={c.value}
            type="button"
            title={c.title}
            aria-pressed={active}
            onClick={() => pick(c.value)}
            className="px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={{
              background: active ? 'var(--color-surface)' : 'transparent',
              color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
