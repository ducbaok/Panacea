import type { UploadErrorKind } from '@/lib/upload';

/**
 * 5 chuỗi lỗi upload ảnh đã DUYỆT 16/08/2026 (Q1 của FE-7).
 *
 * Vì sao ở đây chứ không trong `lib/upload.ts`: tầng đó là hạ tầng REST, cố ý
 * không chứa văn bản UI (xem ghi chú đầu file đó). Vì sao không để cục bộ trong
 * màn: FE-10 thêm luồng upload THỨ HAI (đổi ảnh đại diện ở C1a + C2) — bảng nằm
 * trong `create-pin-view.tsx` thì luồng mới phải chép lại, và hai bản chép sẽ
 * trôi khỏi nhau. Một bảng, một chỗ (cùng nguyên tắc với board-error-vi.ts).
 *
 * 4 kind cuối cố ý CHUNG một câu: người dùng không phân biệt được
 * no-file/unauthorized/network/unknown, và cả bốn đều xử lý giống nhau (thử lại).
 */
export const UPLOAD_ERROR_TEXT: Record<UploadErrorKind, string> = {
  'too-large': 'Ảnh vượt quá 10MB — chọn ảnh nhỏ hơn.',
  'unsupported-type': 'Định dạng không được hỗ trợ — chỉ nhận JPG, PNG, WEBP, GIF.',
  'too-small': 'Ảnh quá nhỏ (tối thiểu 1KB).',
  'no-file': 'Không tải được ảnh lên — kiểm tra kết nối rồi thử lại.',
  unauthorized: 'Không tải được ảnh lên — kiểm tra kết nối rồi thử lại.',
  network: 'Không tải được ảnh lên — kiểm tra kết nối rồi thử lại.',
  unknown: 'Không tải được ảnh lên — kiểm tra kết nối rồi thử lại.',
};

/** Chuỗi tiếng Việt cho một kind; `null`/lạ → câu chung "thử lại". */
export function uploadErrorText(kind: UploadErrorKind | null | undefined): string {
  if (!kind) return UPLOAD_ERROR_TEXT.unknown;
  return UPLOAD_ERROR_TEXT[kind] ?? UPLOAD_ERROR_TEXT.unknown;
}
