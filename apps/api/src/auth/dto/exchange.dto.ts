import { IsEmail, IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * Auth.js gọi endpoint này sau khi user login thành công trên Web.
 *
 * ⚠️ BUG ĐÃ SỬA (04/08/2026): `name?` và `avatarUrl?` mang `@IsString()` mà
 * THIẾU `@IsOptional()` ⇒ chúng **bắt buộc lúc chạy** dù có dấu `?` của
 * TypeScript. Lý do: `target: ES2023` ⇒ `useDefineForClassFields` ⇒ field khai
 * mà không gán vẫn thành own property `undefined`, và `@IsString()` chạy trên
 * `undefined` thì trượt.
 *
 * Hệ quả thật: một user OAuth không có avatar sẽ bị 400 ngay ở cửa. Bằng chứng
 * đây là bug chứ không phải chủ đích nằm ở `auth.service.ts:252` —
 * `dto.name ?? dto.email` đã xử lý sẵn trường hợp thiếu `name`.
 *
 * Hệ quả phụ: request chết ở `ValidationPipe` TRƯỚC khi tới lớp kiểm tra secret
 * (`auth.service.ts:239`), nên phép kiểm tra "secret sai → 4xx" của bộ verify
 * xanh vì sai lý do suốt nhiều tháng.
 *
 * `?` của TypeScript và `@IsOptional()` của class-validator là HAI hệ thống
 * khác nhau — `tsc` không bao giờ cảnh báo khi chúng lệch nhau.
 */
export class ExchangeDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  provider: string;

  @IsString()
  @IsNotEmpty()
  providerAccountId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
