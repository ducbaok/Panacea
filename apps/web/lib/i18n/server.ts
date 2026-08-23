import { cookies } from 'next/headers';
import { LOCALE_STORAGE_KEY, normalizeLocale, type Locale } from './config';
import { createTranslator, type TFunction } from './translate';

/**
 * Cầu nối locale cho SERVER component / generateMetadata.
 *
 * ⚠️ File này import `next/headers` ⇒ TUYỆT ĐỐI không import từ client
 * component. Client dùng `lib/i18n/provider` (useT / useLocale).
 *
 * ⚠️ `cookies()` là Request-time API: gọi trong `app/layout.tsx` đẩy toàn bộ
 * route sang dynamic rendering. Đây là cái giá đã cân nhắc và chấp nhận —
 * app vốn đã dynamic (pin/[id] fetch thẳng mỗi request, mọi màn nạp dữ liệu
 * client qua Apollo, proxy.ts chặn theo phiên) nên không mất trang tĩnh nào.
 * Đổi lại: HTML server dựng ĐÚNG ngôn ngữ ngay từ byte đầu.
 */

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_STORAGE_KEY)?.value);
}

export async function getT(): Promise<TFunction> {
  return createTranslator(await getLocale());
}
