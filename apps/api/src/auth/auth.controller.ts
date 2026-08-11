import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Header,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ExchangeDto } from './dto/exchange.dto';
import { ForgotPasswordDto, ResetPasswordDto, RefreshTokenDto, GoogleAuthDto, VerifyEmailDto } from './dto/auth.dto';
import { CurrentUserRest } from './decorators/current-user.decorator';
import type { AuthUser } from './strategies/jwt.strategy';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';

/**
 * AuthController — xử lý REST API endpoints cho Auth module.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Dùng decorator @ApiTags('Auth') cho class.
 * 2. Triển khai các POST endpoints: register, login, exchange, google, refresh, logout, forgot-password, reset-password.
 * 3. Triển khai các GET endpoints: verify-email, me.
 * 4. Sử dụng @ApiOperation() và @ApiResponse() để cấu hình chi tiết Swagger cho từng route.
 * 5. endpoints logout, me yêu cầu @UseGuards(AuthGuard('jwt')) và có @ApiBearerAuth().
 * 6. endpoint exchange yêu cầu @ApiHeader({ name: 'x-auth-secret' }).
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /auth/register */
  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
  @ApiResponse({ status: 201, description: 'Đăng ký thành công, trả về cặp token (access + refresh).' })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại trong hệ thống.' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** POST /auth/login */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng email và password' })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công.' })
  @ApiResponse({ status: 401, description: 'Thông tin đăng nhập không hợp lệ.' })
  @ApiResponse({ status: 403, description: 'Tài khoản tạm thời bị khóa do brute-force.' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * POST /auth/exchange
   * Auth.js (Web) gọi sau khi OAuth login thành công.
   * Header `x-auth-secret` phải khớp với AUTH_SECRET.
   */
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trao đổi token OAuth từ Next.js Web client' })
  @ApiHeader({ name: 'x-auth-secret', description: 'Secret key dùng để xác thực bắt tay Auth.js' })
  @ApiResponse({ status: 200, description: 'Trao đổi token thành công.' })
  @ApiResponse({ status: 403, description: 'Auth secret không hợp lệ.' })
  exchange(
    @Body() dto: ExchangeDto,
    @Headers('x-auth-secret') authSecret: string,
  ) {
    return this.authService.exchange(dto, authSecret);
  }

  /** POST /auth/google — Android Google OAuth */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập / Đăng ký bằng Google ID Token từ thiết bị Android' })
  @ApiResponse({ status: 200, description: 'Đăng nhập Google thành công.' })
  @ApiResponse({ status: 400, description: 'Token Google thiếu email.' })
  @ApiResponse({ status: 401, description: 'Token Google không hợp lệ.' })
  googleAuth(@Body() dto: GoogleAuthDto) {
    return this.authService.googleAuth(dto);
  }

  /** POST /auth/refresh */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy Access Token mới bằng Refresh Token' })
  @ApiResponse({ status: 200, description: 'Refresh thành công, trả về Access Token mới.' })
  @ApiResponse({ status: 401, description: 'Refresh Token không hợp lệ hoặc đã hết hạn.' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  /** POST /auth/logout */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất, vô hiệu hóa Refresh Token hiện tại' })
  @ApiResponse({ status: 204, description: 'Đăng xuất thành công.' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  /** POST /auth/forgot-password */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Yêu cầu gửi email khôi phục mật khẩu' })
  @ApiResponse({ status: 204, description: 'Yêu cầu được chấp nhận và xử lý.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  /** POST /auth/reset-password */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đặt lại mật khẩu mới bằng token' })
  @ApiResponse({ status: 204, description: 'Mật khẩu đã được thay đổi thành công.' })
  @ApiResponse({ status: 400, description: 'Token không hợp lệ hoặc đã hết hạn.' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /** GET /auth/verify-email?token=... — Trả về trang HTML để user click (tránh pre-fetch) */
  @Get('verify-email')
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Hiển thị trang xác thực email (tránh lỗi pre-fetch của trình duyệt/mail client)' })
  renderVerifyEmailPage(@Query('token') token: string) {
    return this.authService.renderVerifyEmailPage(token);
  }

  /** POST /auth/verify-email — Xử lý logic xác thực */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực tài khoản qua email (logic chính)' })
  @ApiResponse({ status: 200, description: 'Xác thực email thành công.' })
  @ApiResponse({ status: 400, description: 'Token hết hạn hoặc không hợp lệ.' })
  @ApiResponse({ status: 404, description: 'Token không tồn tại.' })
  verifyEmailPost(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  /** GET /auth/me — kiểm tra token hợp lệ */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy thông tin tài khoản hiện tại từ token JWT REST' })
  @ApiResponse({ status: 200, description: 'Trả về userId và email.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  me(@CurrentUserRest() user: AuthUser) {
    return { userId: user.userId, email: user.email };
  }
}
