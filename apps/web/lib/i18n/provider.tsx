'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  type Locale,
} from './config';
import { createTranslator, type TFunction } from './translate';

/**
 * LocaleProvider — nguồn ngôn ngữ duy nhất cho mọi client component.
 *
 * `initialLocale` do `app/layout.tsx` đọc từ cookie ở SERVER rồi truyền xuống.
 * Nhờ vậy HTML server dựng ĐÃ đúng ngôn ngữ ⇒ không nháy chữ, không lệch
 * hydration. Đừng đổi sang đọc localStorage ở lần render đầu — đó chính là
 * cái bẫy mà ThemeToggle phải dùng `mounted` guard để né.
 *
 * Đổi ngôn ngữ làm 4 việc, thiếu việc nào cũng lộ:
 *   1. cookie   — để lần tải trang sau server dựng đúng ngay từ HTML đầu.
 *   2. localStorage — bản sao chữa cháy khi cookie bị chặn (mục 3 useEffect).
 *   3. <html lang> — đọc màn hình, dịch tự động và SEO đều bám thuộc tính này.
 *   4. router.refresh() — BẮT BUỘC: chữ trong server component (metadata,
 *      trang 404, các page dựng ở server) chỉ đổi khi server render lại.
 *      Thiếu bước này, nửa app đổi tiếng, nửa kia đứng yên.
 */

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TFunction;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function writeCookie(locale: Locale) {
  try {
    document.cookie = `${LOCALE_STORAGE_KEY}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookie bị chặn — localStorage ở dưới vẫn giữ được lựa chọn */
  }
}

function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return raw === 'vi' || raw === 'en' ? raw : null;
  } catch {
    return null;
  }
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();

  /**
   * `picked` chỉ giữ lựa chọn VỪA bấm trong phiên render này; nguồn chính vẫn
   * là `initialLocale` do server đọc cookie. Viết kiểu `picked ?? server` thay
   * vì `useState(initialLocale)` là có chủ ý: sau `router.refresh()` server
   * gửi xuống prop mới, và `useState` KHÔNG nhận prop mới ở lần render sau —
   * nhánh chữa lệch bên dưới sẽ không bao giờ có hiệu lực nếu dùng useState.
   */
  const [picked, setPicked] = useState<Locale | null>(null);
  const locale = picked ?? normalizeLocale(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      const value = normalizeLocale(next);
      writeCookie(value);
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
      } catch {
        /* quota / storage tắt */
      }
      document.documentElement.lang = value;
      setPicked(value);
      router.refresh();
    },
    [router],
  );

  // Chữa lệch cookie ⇄ localStorage: cookie có thể bị trình duyệt xoá (chế độ
  // riêng tư, dọn dẹp) trong khi localStorage còn. Khi lệch, localStorage
  // thắng — ghi lại cookie rồi `router.refresh()` để server dựng lại đúng
  // ngôn ngữ. CỐ Ý không setState ở đây: prop `initialLocale` từ lần render
  // server mới đã đủ để `locale` đổi theo (xem chú thích `picked` ở trên).
  useEffect(() => {
    const stored = readStoredLocale();
    if (!stored) {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        /* bỏ qua */
      }
      return;
    }
    if (stored !== locale) {
      writeCookie(stored);
      document.documentElement.lang = stored;
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: createTranslator(locale) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx) return ctx;
  // Không throw: một vài component (toast, confirm) có thể được dựng trong
  // test hoặc storybook ngoài cây provider. Rơi về tiếng Việt còn hơn crash.
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: createTranslator(DEFAULT_LOCALE),
  };
}

/** Hook chính của màn: `const t = useT();` rồi `t('nav.home')`. */
export function useT(): TFunction {
  return useLocaleContext().t;
}

/** Cần biết locale hiện tại (định dạng số/ngày, nút đổi ngôn ngữ). */
export function useLocale(): Locale {
  return useLocaleContext().locale;
}

/** Chỉ nút đổi ngôn ngữ dùng tới. */
export function useSetLocale(): (next: Locale) => void {
  return useLocaleContext().setLocale;
}
