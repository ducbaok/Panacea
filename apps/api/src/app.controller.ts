import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * AppController — REST endpoint cho kiểm tra sức khỏe hệ thống (health check).
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Sử dụng decorator @ApiTags('App') để gom nhóm endpoint trong Swagger.
 * 2. @Get() getHello() dùng để test cơ bản.
 * 3. Thêm @ApiOperation({ summary: '...' }) và @ApiResponse({ status: 200, type: String }) để Swagger hiển thị tốt.
 */
@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Say Hello (Health Check)' })
  @ApiResponse({ status: 200, description: 'Return Hello World message', type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}
