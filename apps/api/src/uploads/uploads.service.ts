// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  UploadsService                                                          ║
// ║  Tạo S3 Presigned POST URL cho client upload trực tiếp.                 ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Inject ConfigService để lấy aws.* config.                           ║
// ║  2. Khởi tạo S3Client từ @aws-sdk/client-s3.                           ║
// ║  3. Implement generatePresignedUrl(userId, contentType, folder):        ║
// ║     a. Tạo key = `raw/{folder}/{userId}/{uuid}.{ext}`                   ║
// ║     b. Dùng createPresignedPost từ @aws-sdk/s3-presigned-post           ║
// ║     c. Điều kiện: content-length-range 1KB-10MB, Content-Type match     ║
// ║     d. Expires: 300 giây                                                ║
// ║     e. Trả về { url, fields, key }                                      ║
// ║  4. Implement generatePresignedGetUrl cho Lambda callback (optional)    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost, PresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'crypto';

/**
 * Mapping contentType → file extension.
 *
 * Đây cũng chính là WHITELIST MIME được dùng chung cho cả 2 nhánh upload
 * (S3 presigned và local disk) — xem `uploads.controller.ts`. Để một nguồn duy
 * nhất là có chủ đích: trước P0 #7, nhánh S3 siết rất chặt còn nhánh local
 * không kiểm tra gì, nên "chặt hay lỏng" phụ thuộc vào việc client gọi endpoint
 * nào. Một whitelist ⇒ không còn cửa sau.
 */
export const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  // XH-VIDEO (26/08/2026) — hai container vì MediaRecorder KHÔNG cho chọn:
  // Chrome/Firefox ghi ra `video/webm`, Safari ghi ra `video/mp4`. Phương án A
  // là không transcode, nên server phải nhận đúng thứ trình duyệt sinh ra.
  // Client gửi `file.type` có thể kèm codec (`video/webm;codecs=vp9`) —
  // `normalizeContentType` bên dưới cắt phần đó TRƯỚC khi tra bảng này.
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

/** Giới hạn kích thước dùng chung với `content-length-range` của Presigned POST. */
export const MIN_UPLOAD_BYTES = 1024;          // 1KB
export const MAX_UPLOAD_BYTES = 10_485_760;    // 10MB

/**
 * Trần riêng cho video (spec capture §video: bitrate ép 2,5–4 Mbps ⇒ 30s ≈
 * 10–15MB, trần 30MB cho cả nhánh presigned lẫn local).
 *
 * 🔴 KHÔNG nâng `MAX_UPLOAD_BYTES` lên 30MB cho tiện. Trần của ảnh là một hợp
 * đồng đang được phép verify và `apps/web/lib/upload.ts` bám theo; nới nó ra
 * nghĩa là một tấm ảnh 25MB lọt qua và nằm nguyên trong lưới masonry. Hai loại
 * media, hai trần — tra bằng `maxUploadBytesFor`.
 */
export const MAX_VIDEO_UPLOAD_BYTES = 31_457_280; // 30MB

/**
 * Cắt tham số codec khỏi content type: `video/webm;codecs="vp9,opus"` →
 * `video/webm`. MediaRecorder đặt `Blob.type` kèm codec, và multer chuyển
 * nguyên chuỗi đó vào `file.mimetype` — tra thẳng vào whitelist là trượt 100%.
 */
export function normalizeContentType(raw: string): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

/** Trần theo LOẠI media — video 30MB, còn lại 10MB. */
export function maxUploadBytesFor(contentType: string): number {
  return normalizeContentType(contentType).startsWith('video/')
    ? MAX_VIDEO_UPLOAD_BYTES
    : MAX_UPLOAD_BYTES;
}

export interface PresignedUrlResult {
  /** URL POST endpoint (S3) */
  url: string;
  /** Form fields cần kèm theo khi POST */
  fields: Record<string, string>;
  /** Object key trên S3 — client cần gửi lại key này khi createPin */
  key: string;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    // Khởi tạo S3Client với credentials từ env
    this.s3Client = new S3Client({
      region: this.configService.get<string>('aws.region')!,
      credentials: {
        accessKeyId: this.configService.get<string>('aws.accessKeyId')!,
        secretAccessKey: this.configService.get<string>('aws.secretAccessKey')!,
      },
    });
    this.bucketName = this.configService.get<string>('aws.s3BucketName')!;
  }

  /**
   * Tạo Presigned POST URL cho client upload trực tiếp lên S3.
   *
   * Flow:
   *  1. Client gọi API này → nhận { url, fields, key }
   *  2. Client POST multipart/form-data tới `url` kèm `fields` + file
   *  3. Client gọi createPin(key, imageWidth, imageHeight, ...)
   *
   * @param userId     ID của user đang upload
   * @param contentType MIME type (đã validate ở DTO)
   * @param folder     'pins' | 'avatars'
   */
  async generatePresignedUrl(
    userId: string,
    contentType: string,
    folder: string = 'pins',
  ): Promise<PresignedUrlResult> {
    const ext = CONTENT_TYPE_EXT[contentType] || 'jpg';
    const key = `raw/${folder}/${userId}/${randomUUID()}.${ext}`;
    // XH-VIDEO — trần theo LOẠI. `contentType` đã qua whitelist của DTO nên
    // chuỗi ở đây không còn tham số codec; vẫn gọi hàm chung để một chỗ duy
    // nhất quyết định trần cho cả hai nhánh upload.
    const maxBytes = maxUploadBytesFor(contentType);

    // createPresignedPost sinh ra URL + fields để client POST trực tiếp lên S3
    // Conditions:
    //   - content-length-range: 1KB → 10MB ảnh / 30MB video (chống file quá lớn)
    //   - Content-Type phải khớp chính xác (chống upload file giả mạo extension)
    const presigned: PresignedPost = await createPresignedPost(this.s3Client, {
      Bucket: this.bucketName,
      Key: key,
      Conditions: [
        ['content-length-range', MIN_UPLOAD_BYTES, maxBytes],
        ['eq', '$Content-Type', contentType],                          // exact match
      ],
      Fields: {
        'Content-Type': contentType,
      },
      Expires: 300, // 5 phút
    });

    this.logger.debug(`Presigned URL generated for key: ${key}`);

    return {
      url: presigned.url,
      fields: presigned.fields,
      key,
    };
  }
}
