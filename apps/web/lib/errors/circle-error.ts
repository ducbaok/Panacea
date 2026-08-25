import type { TranslationKey } from '@/lib/i18n/translate';

/**
 * F1 (XH-8) — bảng ánh xạ chuỗi lỗi của module `circles` (luồng B) sang chữ
 * hiện ra mắt. Cùng khuôn và cùng lý do với `board-error.ts`: backend CỐ Ý giữ
 * tiếng Anh (QĐ-8), frontend dịch ở đúng một chỗ.
 *
 * Khoá lấy NGUYÊN VĂN từ `apps/api/src/circles/circles.service.ts` — khớp bằng
 * `includes` vì thông điệp GraphQL có thể bị bọc/join thêm.
 *
 * ⚠️ Hai chuỗi trần được backend nội suy từ hằng số (`up to ${MAX} circles`),
 * nên khoá ở đây chỉ giữ phần KHÔNG chứa con số — đổi trần ở backend thì ánh
 * xạ vẫn sống. Chữ tiếng Việt vẫn ghi 20/50 vì đó là số đã chốt (XH-QĐ-13);
 * đổi trần thì phải sửa cả chuỗi, và đó là việc có chủ ý chứ không im lặng.
 *
 * ⚠️ `Unknown userId: <ids>` mang id thật ở đuôi ⇒ chỉ khớp phần đầu, và tuyệt
 * đối KHÔNG hiện nguyên văn ra mắt người dùng.
 */
const CIRCLE_ERROR_KEYS: ReadonlyArray<readonly [string, TranslationKey]> = [
  ['circles (ad-hoc audiences included)', 'errors.circle.maxCircles'],
  ['A circle can hold up to', 'errors.circle.maxMembers'],
  ['do not add yourself', 'errors.circle.cannotAddSelf'],
  ['Unknown userId', 'errors.circle.userNotFound'],
  ['Cannot add a blocked user to a circle', 'errors.circle.blocked'],
  ['This is an ad-hoc audience', 'errors.circle.notAdHoc'],
  ['This circle is already saved', 'errors.circle.notAdHoc'],
];

/** Key từ điển nếu message chứa một khoá đã biết; null nếu không khớp. */
export function circleErrorKey(rawMessage: string | null | undefined): TranslationKey | null {
  if (!rawMessage) return null;
  for (const [en, key] of CIRCLE_ERROR_KEYS) {
    if (rawMessage.includes(en)) return key;
  }
  return null;
}

/** Rút message thô ra khỏi mọi hình dạng lỗi Apollo v4 (xem `map-error.ts`). */
export function rawErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return typeof error === 'string' ? error : '';
  const errs = (error as { errors?: unknown }).errors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((e) => String((e as { message?: unknown })?.message ?? '')).join('\n');
  }
  return String((error as { message?: unknown }).message ?? '');
}
