import { DEFAULT_LOCALE, type Locale } from './config';
import { vi } from './dictionaries/vi';
import { en } from './dictionaries/en';

/**
 * Bộ dịch thuần — KHÔNG phụ thuộc React, dùng chung cho server component
 * (`lib/i18n/server.ts`) và client component (`lib/i18n/provider.tsx`).
 *
 * Hai quy ước trong giá trị từ điển:
 *
 *   1. Chèn biến: `{name}` → thay bằng `vars.name`.
 *        t('pin.savedTo', { board: 'Bếp' })
 *      Biến thiếu thì GIỮ NGUYÊN `{name}` chứ không in "undefined" — lỗi hiện
 *      ra mắt thường thay vì trốn trong chuỗi.
 *
 *   2. Số ít / số nhiều: `"một dạng"` hoặc `"dạng số ít|dạng số nhiều"`.
 *      Chỉ tách khi `vars.count` là số. Tiếng Việt hầu như không đổi dạng nên
 *      vế trái = vế phải hoặc không có dấu `|`; tiếng Anh mới cần cả hai:
 *        vi: 'pin.count': '{count} pin'
 *        en: 'pin.count': '{count} pin|{count} pins'
 *      ⚠️ Đây CỐ Ý là luật số nhiều tối giản cho đúng vi+en. Thêm ngôn ngữ có
 *      few/many (ru, pl, ar) thì phải thay bằng Intl.PluralRules, đừng cơi nới
 *      dấu `|` thành 3 vế.
 */

export type TranslationKey = keyof typeof vi;

export type TranslationVars = Record<string, string | number>;

export type TFunction = (key: TranslationKey, vars?: TranslationVars) => string;

const DICTIONARIES: Record<Locale, Record<string, string>> = { vi, en };

function pickPlural(template: string, vars: TranslationVars | undefined): string {
  if (!template.includes('|')) return template;
  const count = vars?.count;
  if (typeof count !== 'number') return template;
  const [one, other] = template.split('|');
  return count === 1 ? one : (other ?? one);
}

function interpolate(template: string, vars: TranslationVars | undefined): string {
  if (!vars || !template.includes('{')) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  // Rơi về vi khi key mới chưa kịp có ở en — hiện chữ Việt vẫn hơn hiện key thô.
  const template = dict[key] ?? DICTIONARIES[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  return interpolate(pickPlural(template, vars), vars);
}

/** Đóng gói sẵn locale — trả về đúng hình dạng `t(key, vars)` mà màn dùng. */
export function createTranslator(locale: Locale): TFunction {
  return (key, vars) => translate(locale, key, vars);
}
