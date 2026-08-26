// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  PresignedUrlDto                                                         ║
// ║  DTO cho request tạo Presigned URL upload ảnh lên S3.                    ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo class PresignedUrlDto dùng class-validator decorators.          ║
// ║  2. Cần 2 trường:                                                       ║
// ║     - contentType: phải là một trong 'image/jpeg','image/png',          ║
// ║       'image/gif','image/webp'                                          ║
// ║     - folder: tùy chọn, dùng phân loại file (mặc định 'pins')          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { IsString, IsIn, IsOptional } from 'class-validator';

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // XH-VIDEO (26/08/2026) — phải khớp `CONTENT_TYPE_EXT` ở `uploads.service.ts`.
  // Danh sách này là bản SAO có chủ đích (class-validator cần literal tuple để
  // suy kiểu), nên thêm MIME mới là phải sửa CẢ HAI chỗ. Trần dung lượng thì
  // KHÔNG sao chép: `maxUploadBytesFor` là nguồn duy nhất.
  'video/webm',
  'video/mp4',
] as const;

export class PresignedUrlDto {
  @IsString()
  @IsIn(ALLOWED_CONTENT_TYPES, {
    message: `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
  })
  contentType: string;

  /** Thư mục phân loại: 'pins' | 'avatars'. Mặc định 'pins'. */
  @IsString()
  @IsOptional()
  @IsIn(['pins', 'avatars'])
  folder?: string = 'pins';
}
