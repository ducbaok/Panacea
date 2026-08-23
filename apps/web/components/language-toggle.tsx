'use client';

import { LOCALES, LOCALE_LABEL, type Locale } from '@/lib/i18n/config';
import { useLocale, useSetLocale, useT } from '@/lib/i18n/provider';

/**
 * LanguageToggle — nút đổi ngôn ngữ (23/08/2026).
 *
 * Dáng chip GIỐNG HỆT `ThemeToggle`: đây là hai lựa chọn cùng loại ("app hiện
 * ra sao"), nằm cạnh nhau trong màn Cài đặt, nên cố ý dùng chung một hình
 * dạng thay vì bịa một kiểu điều khiển thứ hai. Số đo bám mockup Panacea
 * §3.2: padding 6px 12px, bo 999px, 12px/600, chip đang chọn có nền surface +
 * shadow-card.
 *
 * ⚠️ Nhãn KHÔNG dịch: "Tiếng Việt" luôn viết bằng tiếng Việt và "English"
 * luôn viết bằng tiếng Anh (LOCALE_LABEL). Người đang kẹt ở thứ tiếng mình
 * không đọc được phải nhận ra tên ngôn ngữ của mình để bấm về — dịch nhãn là
 * đúng ngữ pháp nhưng hỏng công dụng.
 *
 * KHÔNG cần `mounted` guard như ThemeToggle: locale đến từ cookie đọc ở SERVER
 * (app/layout.tsx), nên HTML server và lần render đầu ở client đã trùng nhau.
 */
export function LanguageToggle() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <div
      role="group"
      aria-label={t('settings.languageGroupLabel')}
      className="inline-flex items-center gap-1 rounded-full p-1"
      style={{ background: 'var(--color-surface-muted)' }}
    >
      {LOCALES.map((value: Locale) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={active}
            onClick={() => setLocale(value)}
            className="px-3 py-1.5 text-xs font-semibold rounded-full transition-colors"
            style={{
              background: active ? 'var(--color-surface)' : 'transparent',
              color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
            }}
          >
            {LOCALE_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}
