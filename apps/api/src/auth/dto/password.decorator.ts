import { applyDecorators } from '@nestjs/common';
import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Ràng buộc mật khẩu DÙNG CHUNG cho cả ba DTO nhận mật khẩu:
 * `RegisterDto` · `LoginDto` · `ResetPasswordDto`.
 *
 * VÌ SAO GOM VỀ MỘT CHỖ (spec-man-A3-A4-A5.md §6.2):
 *   Trước đây ba DTO khai ràng buộc RIÊNG, và chúng đã lệch nhau:
 *     - Register: @MinLength(8) @MaxLength(72)
 *     - Login:    @MinLength(8)            (thiếu MaxLength)
 *     - Reset:    @IsNotEmpty()            (KHÔNG có Min/Max)
 *   Hệ quả của khe hở ở Reset: đặt lại mật khẩu thành "abc" → 204 thành công,
 *   nhưng lần đăng nhập sau `LoginDto` chặn ngay tại DTO ⇒ 400 VĨNH VIỄN. Người
 *   dùng vừa đổi mật khẩu xong thì tự khoá mình ra ngoài, không lời giải thích.
 *
 *   Chính SỰ LỆCH NHAU là nguồn của bug — nên cách sửa không phải vá riêng Reset
 *   mà là buộc cả ba đi qua đúng một decorator. Thêm một trường mật khẩu mới ở
 *   bất kỳ đâu về sau cũng dùng lại đây, không thể lệch lần nữa.
 *
 * @MaxLength(72): bcrypt CẮT IM LẶNG ở 72 byte — mật khẩu dài hơn 72 sẽ được
 * hash như thể bị cắt, tạo cảm giác an toàn giả. Chặn ở DTO cho minh bạch.
 */
export function IsPassword() {
  return applyDecorators(IsString(), MinLength(8), MaxLength(72));
}
