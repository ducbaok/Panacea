'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * FE-1a — ThemeToggle 3 trạng thái (QĐ-6b).
 *
 * ⚠️ CỐ Ý KHÔNG TRANG TRÍ. Đây là component CƠ CHẾ:
 *   - Chỉ 3 nút <button> trần và một badge chỉ dấu "đang là gì".
 *   - Style thật, tooltip, icon Sun/Moon/Monitor sẽ dựng ở FE-2 khi làm shell.
 *   - Đừng thêm class Tailwind hay CSS ở đây; nếu thêm, FE-2 sẽ phải gỡ.
 *
 * Ba trạng thái (khớp app/layout.tsx anti-flash script):
 *   - 'light'  → localStorage['theme'] = 'light',  <html data-theme="light">
 *   - 'dark'   → localStorage['theme'] = 'dark',   <html data-theme="dark">
 *   - 'system' → localStorage['theme'] xoá,         KHÔNG có attribute; CSS bám
 *                @media (prefers-color-scheme: dark) tự chọn nền.
 *
 * Phép quyết định T2 (đã kiểm bằng tay, không viết test ở v1):
 *   1. Chọn 'system' → đổi theme OS ⇒ trang đổi theo, KHÔNG cần F5.
 *      (matchMedia listener bên dưới xử lý — nếu bỏ, phép này thất bại.)
 *   2. Chọn 'dark' + throttle mạng ⇒ tải trang KHÔNG có khung hình sáng
 *      loé lên (script chống nháy trong layout.tsx đảm bảo).
 *
 * Bẫy hydration (đã tránh):
 *   - Server không biết localStorage. `mounted` guard ẩn nội dung ở lần render
 *     đầu để server + client render CÙNG một DOM (một khoảng trống). Sau khi
 *     mounted, mới đọc lựa chọn thật.
 *   - <html suppressHydrationWarning> ở layout đã xử lý attribute mismatch
 *     do anti-flash script.
 */

type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

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
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setChoice(readStoredChoice());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const pick = useCallback((next: ThemeChoice) => {
    applyChoice(next);
    setChoice(next);
  }, []);

  // Server render + tick đầu client: một khoảng trống, tránh hydration mismatch.
  if (!mounted) {
    return <div data-theme-toggle="" aria-hidden style={{ minHeight: 0 }} />;
  }

  const effective: 'light' | 'dark' = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  return (
    <div data-theme-toggle="" role="group" aria-label="Chế độ hiển thị">
      <button
        type="button"
        onClick={() => pick('light')}
        aria-pressed={choice === 'light'}
        data-active={choice === 'light' ? 'true' : 'false'}
      >
        Sáng
      </button>
      <button
        type="button"
        onClick={() => pick('dark')}
        aria-pressed={choice === 'dark'}
        data-active={choice === 'dark' ? 'true' : 'false'}
      >
        Tối
      </button>
      <button
        type="button"
        onClick={() => pick('system')}
        aria-pressed={choice === 'system'}
        data-active={choice === 'system' ? 'true' : 'false'}
      >
        Hệ thống
      </button>
      <span data-theme-effective={effective} aria-live="polite">
        {' '}
        (đang: {effective}
        {choice === 'system' ? ' theo hệ thống' : ''})
      </span>
    </div>
  );
}
