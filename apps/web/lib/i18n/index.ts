/**
 * Điểm import cho CLIENT component.
 *
 * Server component import từ '@/lib/i18n/server' (file đó kéo `next/headers`,
 * không được lẫn vào bundle client).
 */
export { LOCALES, LOCALE_LABEL, DEFAULT_LOCALE, isLocale, normalizeLocale } from './config';
export type { Locale } from './config';
export { LocaleProvider, useT, useLocale, useSetLocale } from './provider';
export { createTranslator, translate } from './translate';
export type { TFunction, TranslationKey, TranslationVars } from './translate';
