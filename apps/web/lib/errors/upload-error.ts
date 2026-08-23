import type { UploadErrorKind } from '@/lib/upload';
import type { TranslationKey } from '@/lib/i18n/translate';

/**
 * 5 chuỗi lỗi upload ảnh đã DUYỆT 16/08/2026 (Q1 của FE-7) — nay giữ dạng KEY
 * từ điển, chữ thật nằm ở `lib/i18n/dictionaries/{vi,en}/errors.ts`.
 *
 * Vì sao ở đây chứ không trong `lib/upload.ts`: tầng đó là hạ tầng REST, cố ý
 * không chứa văn bản UI (xem ghi chú đầu file đó). Vì sao không để cục bộ trong
 * màn: có HAI luồng upload (tạo pin ở B4/B5 + đổi ảnh đại diện ở C1a/C2) —
 * bảng nằm trong `create-pin-view.tsx` thì luồng kia phải chép lại, và hai bản
 * chép sẽ trôi khỏi nhau. Một bảng, một chỗ (cùng nguyên tắc với board-error.ts).
 *
 * 4 kind cuối cố ý CHUNG một câu: người dùng không phân biệt được
 * no-file/unauthorized/network/unknown, và cả bốn đều xử lý giống nhau (thử lại).
 */
export const UPLOAD_ERROR_KEY: Record<UploadErrorKind, TranslationKey> = {
  'too-large': 'errors.upload.tooLarge',
  'unsupported-type': 'errors.upload.unsupportedType',
  'too-small': 'errors.upload.tooSmall',
  'no-file': 'errors.upload.generic',
  unauthorized: 'errors.upload.generic',
  network: 'errors.upload.generic',
  unknown: 'errors.upload.generic',
};

/** Key từ điển cho một kind; `null`/lạ → câu chung "thử lại". */
export function uploadErrorKey(kind: UploadErrorKind | null | undefined): TranslationKey {
  if (!kind) return UPLOAD_ERROR_KEY.unknown;
  return UPLOAD_ERROR_KEY[kind] ?? UPLOAD_ERROR_KEY.unknown;
}
