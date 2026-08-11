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
};

/** Giới hạn kích thước dùng chung với `content-length-range` của Presigned POST. */
export const MIN_UPLOAD_BYTES = 1024;          // 1KB
export const MAX_UPLOAD_BYTES = 10_485_760;    // 10MB

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

    // createPresignedPost sinh ra URL + fields để client POST trực tiếp lên S3
    // Conditions:
    //   - content-length-range: 1KB → 10MB (bảo vệ khỏi upload file quá lớn)
    //   - Content-Type phải khớp chính xác (chống upload file giả mạo extension)
    const presigned: PresignedPost = await createPresignedPost(this.s3Client, {
      Bucket: this.bucketName,
      Key: key,
      Conditions: [
        ['content-length-range', MIN_UPLOAD_BYTES, MAX_UPLOAD_BYTES],  // 1KB – 10MB
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
