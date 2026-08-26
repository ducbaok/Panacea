/**
 * i18n — hằng số dùng chung cho CẢ server lẫn client.
 *
 * File này KHÔNG được import `next/headers` hay `react`: nó bị kéo vào cả
 * `app/layout.tsx` (server), `provider.tsx` (client) và script chống nháy
 * (chuỗi inline). Thêm import server-only vào đây là vỡ bundle client.
 *
 * QĐ (23/08/2026): locale lưu THEO MÁY, không theo tài khoản — cookie
 * `locale` (để server component đọc được khi SSR) + localStorage (để đọc
 * đồng bộ trong script chống nháy trước paint). Cookie là nguồn sự thật khi
 * render; localStorage chỉ là bản sao để chữa lệch khi cookie bị chặn.
 * Khách chưa đăng nhập vẫn đổi được ngôn ngữ — không đụng Prisma, không
 * đụng GraphQL.
 */

export const LOCALES = ['vi', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Ngôn ngữ mặc định = English (đổi từ 'vi' ngày 25/08/2026).
 *
 * Áp cho KHÁCH MỚI: máy chưa có cookie/localStorage `locale`. Máy đã từng đổi
 * ngôn ngữ vẫn giữ lựa chọn cũ — cookie `locale=vi` thắng mặc định, đó là đúng
 * thiết kế, không phải "chưa đổi được". Muốn thấy mặc định mới thì xoá cookie
 * + localStorage `locale` (hoặc mở cửa sổ ẩn danh).
 *
 * KHÔNG dò Accept-Language: server chỉ đọc cookie (lib/i18n/server.ts), nên
 * hằng số này là thứ duy nhất quyết định ngôn ngữ của lượt truy cập đầu tiên.
 */
export const DEFAULT_LOCALE: Locale = 'en';

/** Tên cookie + key localStorage. Giữ TRÙNG tên để script chống nháy đọc 1 chỗ. */
export const LOCALE_STORAGE_KEY = 'locale';

/** 1 năm. Cookie không httpOnly — client phải ghi được bằng document.cookie. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Bất kỳ giá trị lạ nào → DEFAULT_LOCALE. Không bao giờ throw. */
export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Nhãn hiện trên nút đổi ngôn ngữ — luôn viết bằng CHÍNH ngôn ngữ đó. */
export const LOCALE_LABEL: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
};
