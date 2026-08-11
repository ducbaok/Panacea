// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  PinsController — REST endpoint cho Lambda callback                     ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. PATCH /internal/pins/:id/processed — chỉ Lambda gọi được.          ║
// ║  2. Validate bằng INTERNAL_API_SECRET trong header (dùng timingSafeEqual ║
// ║     để chống timing attack).                                             ║
// ║  3. Body: { thumbnailUrl, mediumUrl, largeUrl }                         ║
// ║  4. Gọi PinsService.markProcessed() để cập nhật DB.                    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import {
  Controller,
  Patch,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { IsNotEmpty, IsString } from 'class-validator';
import { PinsService } from './pins.service';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiProperty } from '@nestjs/swagger';

/**
 * ⚠️ BUG ĐÃ SỬA (04/08/2026) — endpoint này từng CHẾT HOÀN TOÀN mà build sạch.
 *
 * Nguyên nhân gốc, ba tầng cộng lại:
 *  1. `apps/api/tsconfig.json` đặt `target: ES2023` ⇒ `useDefineForClassFields`
 *     mặc định `true` ⇒ field khai mà không gán vẫn được tạo thành **own
 *     property với giá trị `undefined`** trên mọi instance. Bản biên dịch là
 *     `class ProcessedDto { thumbnailUrl; mediumUrl; largeUrl; }`.
 *  2. Class này trước đây chỉ có `@ApiProperty()` — decorator của Swagger,
 *     KHÔNG phải class-validator ⇒ whitelist rỗng.
 *  3. Global `ValidationPipe` bật `whitelist + forbidNonWhitelisted`.
 *
 * ⇒ Mọi request, kể cả body `{}`, đều bị trả 400 "property thumbnailUrl should
 * not exist". Không payload nào đi qua được, nên `_timingSafeCompare()` bên
 * dưới CHƯA TỪNG chạy một lần nào kể từ khi viết.
 *
 * Bộ verify che mất lỗi này một cách hoàn hảo: phép kiểm tra "không secret →
 * 4xx" nhận đúng 4xx nên xanh — chỉ là xanh vì sai lý do. Đây là lý do
 * `rest()` giờ có `match: /regex/`: chỉ so status code là không đủ.
 *
 * `RegisterTokenDto` (notifications/device-tokens.controller.ts) là đối chứng —
 * cùng kiểu "DTO khai trong controller" nhưng có decorator nên vẫn chạy đúng.
 */
class ProcessedDto {
  @ApiProperty({ description: 'URL of the resized thumbnail image' })
  @IsString()
  @IsNotEmpty()
  thumbnailUrl: string;

  @ApiProperty({ description: 'URL of the resized medium image' })
  @IsString()
  @IsNotEmpty()
  mediumUrl: string;

  @ApiProperty({ description: 'URL of the resized large image' })
  @IsString()
  @IsNotEmpty()
  largeUrl: string;
}

@ApiTags('Internal Pins')
@Controller('internal/pins')
export class PinsController {
  constructor(
    private readonly pinsService: PinsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * PATCH /internal/pins/:id/processed
   * Lambda gọi sau khi resize ảnh xong → cập nhật URLs đã xử lý.
   *
   * Security: kiểm tra x-internal-secret header khớp INTERNAL_API_SECRET.
   * Dùng timingSafeEqual để chống timing attack.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Lấy expectedSecret từ config ('internal.apiSecret').
   * 2. So sánh internalSecret với expectedSecret bằng _timingSafeCompare (constant-time).
   * 3. Nếu không khớp → ném ForbiddenException.
   * 4. Gọi pinsService.markProcessed(id, thumbnailUrl, mediumUrl, largeUrl).
   */
  @Patch(':id/processed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật URLs ảnh sau khi Lambda resize thành công (Internal Callback)' })
  @ApiHeader({ name: 'x-internal-secret', description: 'Secret key nội bộ của Lambda function' })
  @ApiResponse({ status: 200, description: 'Cập nhật ảnh thành công.' })
  @ApiResponse({ status: 403, description: 'Secret key nội bộ không hợp lệ.' })
  async markProcessed(
    @Param('id') id: string,
    @Body() dto: ProcessedDto,
    @Headers('x-internal-secret') internalSecret: string,
  ) {
    const expectedSecret = this.configService.get<string>('internal.apiSecret')!;

    // Dùng timingSafeEqual thay vì !== để chống timing attack
    if (!this._timingSafeCompare(internalSecret || '', expectedSecret)) {
      throw new ForbiddenException('Invalid internal secret');
    }

    return this.pinsService.markProcessed(
      id,
      dto.thumbnailUrl,
      dto.mediumUrl,
      dto.largeUrl,
    );
  }

  /**
   * So sánh 2 chuỗi bằng constant-time algorithm.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Encode cả 2 string thành Buffer (utf-8).
   * 2. Nếu length khác nhau → vẫn chạy timingSafeEqual trên dummy để giữ constant time, return false.
   * 3. Dùng crypto.timingSafeEqual(bufA, bufB).
   */
  private _timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');

    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufB, bufB);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }
}
