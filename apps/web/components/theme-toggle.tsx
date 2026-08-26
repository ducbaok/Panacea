'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/translate';

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
 * Cơ chế lưu trữ (ĐỔI 25/08/2026 — mặc định mới là SÁNG):
 *   • 'light'  → localStorage['theme']='light',  <html data-theme="light">
 *   • 'dark'   → localStorage['theme']='dark',   <html data-theme="dark">
 *   • 'system' → localStorage['theme']='system', KHÔNG có attribute, CSS bám
 *                @media (prefers-color-scheme: dark) ⇒ giao diện đổi theo ngay
 *                khi user đổi cài đặt OS trong lúc trang đang mở.
 *   • VẮNG KEY (máy mới, hoặc user xoá localStorage) → 'light'.
 *
 * ⚠️ Vì sao 'system' phải GHI TƯỜNG MINH chứ không xoá key như bản cũ: bản cũ
 * lấy "vắng key" làm nghĩa của Auto. Đổi mặc định vắng-key sang Sáng mà vẫn
 * xoá key khi chọn Auto thì nút Auto tự hỏng — F5 một cái là bật về Sáng.
 * Hai nghĩa phải tách ra: vắng key = "chưa chọn gì" = Sáng; 'system' = "đã
 * chọn Auto". Giá trị legacy 'light'/'dark' của máy cũ đọc y như trước.
 *
 * ⚠️ Script chống nháy trong `app/layout.tsx` PHẢI cùng một bảng ánh xạ này.
 * Lệch nhau ở bất kỳ nhánh nào = nháy màu một khung hình lúc tải trang.
 *
 * Bẫy hydration đã tránh: `mounted` guard ẩn nội dung ở lần render đầu để
 * server + client render CÙNG một DOM (một khoảng trống). Anti-flash script
 * trong app/layout.tsx đã đặt sẵn attribute trước paint đầu.
 */

type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

/**
 * i18n (23/08/2026): bảng chỉ giữ KEY, chữ do `t()` trong component dựng.
 * Trước đây là chuỗi Việt cứng ⇒ chip đứng yên tiếng Việt khi chọn English.
 */
const CHOICES: ReadonlyArray<{ value: ThemeChoice; labelKey: TranslationKey; titleKey: TranslationKey }> = [
  { value: 'light', labelKey: 'settings.themeLight', titleKey: 'settings.themeLightTitle' },
  { value: 'dark', labelKey: 'settings.themeDark', titleKey: 'settings.themeDarkTitle' },
  { value: 'system', labelKey: 'settings.themeAuto', titleKey: 'settings.themeAutoTitle' },
];

/** Mặc định khi CHƯA có lựa chọn nào (máy mới). Xem docblock đầu file. */
const DEFAULT_CHOICE: ThemeChoice = 'light';

function readStoredChoice(): ThemeChoice {
  if (typeof window === 'undefined') return DEFAULT_CHOICE;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

function applyChoice(choice: ThemeChoice) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice === 'system') {
    // Gỡ attribute để CSS rơi về @media (prefers-color-scheme), NHƯNG vẫn ghi
    // 'system' vào localStorage — xem cảnh báo ở docblock đầu file.
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function ThemeToggle() {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>(DEFAULT_CHOICE);

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
        aria-label={t('settings.themeGroupLabel')}
        aria-hidden
        style={{ visibility: 'hidden' }}
        className="inline-flex items-center gap-1 rounded-full p-1"
      >
        {CHOICES.map((c) => (
          <span key={c.value} className="px-3 py-1.5 text-xs">
            {t(c.labelKey)}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('settings.themeGroupLabel')}
      className="inline-flex items-center gap-1 rounded-full p-1"
      style={{ background: 'var(--color-surface-muted)' }}
    >
      {CHOICES.map((c) => {
        const active = choice === c.value;
        return (
          <button
            key={c.value}
            type="button"
            title={t(c.titleKey)}
            aria-pressed={active}
            onClick={() => pick(c.value)}
            className="px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={{
              background: active ? 'var(--color-surface)' : 'transparent',
              color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
            }}
          >
            {t(c.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
