// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  UpdateProfileInput — GraphQL Input Type                                 ║
// ║                                                                            ║
// ║  HƯỚNG DẪN CODE LẠI:                                                       ║
// ║  1. Tạo class UpdateProfileInput có decorator @InputType().                ║
// ║  2. Định nghĩa các field tùy chọn: name, username, bio, website,           ║
// ║     avatarUrl, locale (tất cả đều có decorator @Field({ nullable: true })    ║
// ║     và @IsOptional() @IsString()).                                         ║
// ║  3. Định nghĩa regex validation cho field `username`:                      ║
// ║     - Sử dụng decorator @Matches(/^[a-z0-9_]{3,20}$/, { message: ... }).  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, Matches } from 'class-validator';

@InputType()
export class UpdateProfileInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{3,20}$/, {
    message: 'Username must be 3-20 characters long and contain only lowercase letters, numbers, and underscores',
  })
  username?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bio?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  website?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  locale?: string;
}
