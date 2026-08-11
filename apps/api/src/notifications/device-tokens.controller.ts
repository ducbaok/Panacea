import { Controller, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';
import { CurrentUserRest } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export class RegisterTokenDto {
  @ApiProperty({ description: 'FCM Device token' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'Platform (e.g. android, ios)', required: false, default: 'android' })
  @IsString()
  @IsOptional()
  platform?: string;
}

// ─── Controller ──────────────────────────────────────────────────────────────

/**
 * DeviceTokensController — REST endpoint quản lý device tokens cho Push Notifications.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Gom nhóm bằng @ApiTags('Device Tokens') và yêu cầu jwt auth bằng @ApiBearerAuth().
 * 2. POST /device-tokens: Đăng ký token mới cho user hiện tại.
 *    Dùng @CurrentUserRest() thay vì @Req() req: any — decorator có kiểu
 *    AuthUser nên compiler bắt được nếu đọc sai field. Trước đây route này
 *    đọc `req.user.id` (không tồn tại) → mọi lần đăng ký token đều gãy.
 * 3. DELETE /device-tokens/:token: Xóa token khỏi DB.
 * 4. Cấu hình các decorator @ApiOperation() và @ApiResponse() đầy đủ cho REST clients.
 */
@ApiTags('Device Tokens')
@ApiBearerAuth()
@Controller('device-tokens')
@UseGuards(AuthGuard('jwt'))
export class DeviceTokensController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Đăng ký Device Token để nhận Push Notifications
   * Register a Device Token for Push Notifications
   */
  @Post()
  @ApiOperation({ summary: 'Đăng ký device token cho push notifications FCM' })
  @ApiResponse({ status: 201, description: 'Đăng ký token thành công.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async registerToken(
    @CurrentUserRest() user: AuthUser,
    @Body() body: RegisterTokenDto,
  ) {
    // 1. Gọi service đăng ký token với userId của user hiện tại.
    // Call service to register token.
    await this.notificationsService.registerDeviceToken(
      user.userId,
      body.token,
      body.platform || 'android',
    );
    return { success: true };
  }

  /**
   * Xóa Device Token khi user logout hoặc từ chối thông báo
   * Delete a Device Token when user logs out or opts out
   */
  @Delete(':token')
  @ApiOperation({ summary: 'Xóa device token (khi logout hoặc từ chối nhận thông báo)' })
  @ApiResponse({ status: 200, description: 'Xóa token thành công.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async removeToken(@Param('token') token: string) {
    // 1. Gọi service xóa token
    // Call service to remove token.
    await this.notificationsService.removeDeviceToken(token);
    return { success: true };
  }
}
