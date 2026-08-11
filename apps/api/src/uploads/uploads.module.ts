// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  UploadsModule                                                           ║
// ║  Cung cấp Presigned URL cho client upload ảnh trực tiếp lên S3.          ║
// ║  KHÔNG chấp nhận multipart/form-data — luôn dùng Presigned URL.          ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo UploadsModule import UploadsService, register UploadsController. ║
// ║  2. Module này không cần import thêm module nào ngoài ConfigModule      ║
// ║     (đã global).                                                         ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';


@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule { }
