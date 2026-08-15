import { IsEmail, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { IsPassword } from './password.decorator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  // Trước đây chỉ @IsNotEmpty() ⇒ đặt được mật khẩu < 8 ký tự rồi tự khoá mình
  // ra ngoài (LoginDto đòi ≥ 8). Nay dùng chung ràng buộc với Register/Login.
  @IsPassword()
  password: string;
}

/**
 * Gửi lại email xác thực. KHÔNG có trường email (spec §6.3 chốt hướng a+c):
 * nhận diện người dùng bằng token cũ trong body HOẶC phiên đăng nhập (Bearer).
 * `token` optional vì đường (c) — đang đăng nhập — không cần token.
 */
export class ResendVerificationDto {
  @IsOptional()
  @IsString()
  token?: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
