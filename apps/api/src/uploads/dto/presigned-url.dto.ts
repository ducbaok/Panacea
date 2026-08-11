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
