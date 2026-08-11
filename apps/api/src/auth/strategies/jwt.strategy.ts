import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  HAI KIỂU DỮ LIỆU — ĐỪNG GỘP LÀM MỘT                                      ║
 * ║                                                                           ║
 * ║  Trước đây cả hai khái niệm dưới đây dùng chung một interface tên là     ║
 * ║  `JwtPayload`. Chính sự nhập nhằng đó đã sinh ra bug: người viết resolver ║
 * ║  không biết `request.user` có field gì nên đoán bừa `.id` / `.userId`,   ║
 * ║  trong khi thực tế chỉ có `.sub`. Xem LEARNING_NOTES.md mục 7.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * `JwtClaims` — payload THÔ nằm bên trong access token.
 *
 * Đây là thứ `AuthService._signAccessToken()` ký vào token:
 *   jwtService.sign({ sub: userId, email })
 *
 * `sub` (subject) là tên chuẩn theo RFC 7519 cho "chủ thể của token".
 * Kiểu này CHỈ xuất hiện ở ranh giới giải mã token — không dùng ở nơi nào khác.
 */
export interface JwtClaims {
  sub: string; // userId — tên theo chuẩn JWT
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * `AuthUser` — danh tính đã xác thực, chính là thứ được gắn vào `request.user`.
 *
 * Đây là kiểu mà MỌI resolver / controller nhìn thấy qua `@CurrentUser()`.
 * Dùng `userId` thay vì `sub` vì:
 *   1. Trong ngôn ngữ nghiệp vụ của app, khái niệm này là "id của user",
 *      không phải "subject của token". Tên biến nên nói đúng tầng nó đang ở.
 *   2. `sub` là chi tiết cài đặt của JWT — nếu mai này đổi sang session hay
 *      OAuth introspection, `AuthUser` vẫn giữ nguyên, chỉ `validate()` đổi.
 *   3. `REST GET /auth/me` vốn đã trả về field tên `userId` — nay đã nhất quán.
 */
export interface AuthUser {
  userId: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    // TODO:
    // Gọi super() với cấu hình:
    // - jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
    // - ignoreExpiration: false
    // - secretOrKey: lấy jwt.secret từ configService
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }

  /**
   * Passport gọi hàm này sau khi verify chữ ký token thành công.
   * Giá trị trả về được Passport gán thẳng vào `request.user`.
   *
   * ĐÂY LÀ RANH GIỚI DUY NHẤT giữa `JwtClaims` và `AuthUser`:
   * `sub` được dịch sang `userId` đúng một lần, tại đây.
   * Từ điểm này trở đi, không nơi nào trong app còn thấy `sub` nữa.
   */
  validate(payload: JwtClaims): AuthUser {
    return { userId: payload.sub, email: payload.email };
  }
}
