import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { ApiHeader, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PurgeService } from './purge.service';

/**
 * ⚠️ MỌI FIELD PHẢI CÓ DECORATOR CỦA class-validator, KHÔNG CHỈ `@ApiProperty`.
 *
 * `tsconfig` đặt `target: ES2023` ⇒ `useDefineForClassFields` bật ⇒ field khai
 * mà không gán vẫn thành own property `undefined`. Global `ValidationPipe` bật
 * `whitelist + forbidNonWhitelisted`, nên DTO chỉ có `@ApiProperty()` sẽ có
 * whitelist RỖNG và **mọi** request bị trả 400 `"property x should not exist"`.
 * Đó chính xác là cách `PATCH /internal/pins/:id/processed` chết 100% từ ngày
 * viết mà không ai biết (`docs/debug_history.md` §2 Bug D).
 */
class PurgeDto {
  @ApiProperty({
    required: false,
    default: true,
    description: 'true (mặc định) = chỉ liệt kê. Phải gửi false tường minh mới xoá thật.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({ required: false, description: 'Trần số tài khoản xoá trong một lần chạy.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({
    required: false,
    description:
      'Ghi đè hạn ân hạn (ngày). BỊ BỎ QUA trên production — xem PurgeService. ' +
      'Tồn tại để bộ verify chạy được nhánh xoá thật mà không phải chờ 30 ngày.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  graceDays?: number;
}

/**
 * `POST /internal/purge-deleted` — cửa DUY NHẤT để chạy job purge theo yêu cầu.
 *
 * VÌ SAO CÓ ENDPOINT NÀY DÙ ĐÃ CÓ `@Cron` (quyết định 17/08/2026, xem
 * `LEARNING_NOTES.md` §30):
 *
 *  1. **Bằng chứng.** Luật số 1 của dự án là *"request thật là bằng chứng duy
 *     nhất"*. Một `@Cron` thuần không có bề mặt nào để bộ verify gọi vào —
 *     thứ mạnh nhất trình được sẽ là "gọi thẳng method trong service", tức
 *     đúng loại bằng chứng mà dự án đã ba lần trả giá vì tin.
 *  2. **Vận hành.** Cần chạy lại ngay sau sự cố, hoặc chạy dry-run để xem
 *     đêm nay job sẽ xoá gì, mà không phải chờ tới 03:00 hay sửa lịch.
 *
 * Nằm trong ô **Internal** của luật *"REST chỉ cho Auth, Uploads, Internal"*
 * (`AGENT_HANDOFF.md` §3.1) — không phải ngoại lệ.
 */
@ApiTags('Internal Maintenance')
@Controller('internal')
export class PurgeController {
  constructor(
    private readonly purgeService: PurgeService,
    private readonly configService: ConfigService,
  ) {}

  @Post('purge-deleted')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard-delete tài khoản đã xoá mềm quá 30 ngày (B-9)' })
  @ApiHeader({ name: 'x-internal-secret', description: 'INTERNAL_API_SECRET' })
  @ApiResponse({ status: 200, description: 'Báo cáo purge (dry-run hoặc đã xoá).' })
  @ApiResponse({ status: 403, description: 'Secret nội bộ không hợp lệ.' })
  async purge(@Body() dto: PurgeDto, @Headers('x-internal-secret') internalSecret: string) {
    const expectedSecret = this.configService.get<string>('internal.apiSecret')!;
    if (!this._timingSafeCompare(internalSecret || '', expectedSecret)) {
      throw new ForbiddenException('Invalid internal secret');
    }
    return this.purgeService.purgeDeletedAccounts({
      dryRun: dto.dryRun,
      limit: dto.limit,
      graceDays: dto.graceDays,
    });
  }

  /** Constant-time compare — chép đúng khuôn `PinsController._timingSafeCompare`. */
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
