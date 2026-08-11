// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  UpdatePinInput — DTO cho mutation updatePin                             ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo @InputType() với id (bắt buộc) + các field tùy chọn.           ║
// ║  2. Owner-only: kiểm tra quyền sẽ nằm trong service.                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { InputType, Field, ID } from '@nestjs/graphql';
import {
  IsString,
  IsOptional,
  IsUrl,
  MaxLength,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { MAX_TAGS_PER_PIN, MAX_CATEGORIES_PER_PIN } from '../tag-name.util';

@InputType()
export class UpdatePinInput {
  @Field(() => ID)
  @IsString()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  // ─── Taxonomy (Đợt 6) ──────────────────────────────────────────────────────
  //
  // ⚠️ BA TRẠNG THÁI, KHÔNG PHẢI HAI. Đây là loại nhập nhằng gây bug THẦM LẶNG
  // nên nó được viết ra ở cả DTO lẫn service:
  //
  //     không gửi field  (undefined) ⇒ KHÔNG ĐỤNG tới tag/category hiện có
  //     gửi `[]`                     ⇒ XOÁ HẾT
  //     gửi `["a","b"]`              ⇒ THAY THẾ TOÀN BỘ bằng đúng danh sách này
  //
  // Không có trạng thái "thêm vào danh sách sẵn có". Client muốn thêm thì phải
  // đọc danh sách hiện tại rồi gửi lại bản đầy đủ — API thay thế toàn bộ là
  // quy ước duy nhất không có kết quả mơ hồ khi hai client sửa cùng lúc.
  //
  // Hệ quả kỹ thuật: KHÔNG được gán mặc định `= []` ở bất cứ đâu trên đường đi
  // của hai field này. Một dấu `= []` biến "không đụng" thành "xoá hết", và
  // triệu chứng là tag của người dùng biến mất mỗi lần họ sửa tiêu đề.
  //
  // `null` tường minh được xử lý NHƯ `undefined` (không đụng), xem
  // `normalizeTagNames`. Muốn xoá hết thì gửi `[]`.

  /** Thay thế TOÀN BỘ tag. `[]` = xoá hết. Không gửi = không đụng. */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_PIN)
  @IsString({ each: true })
  tagNames?: string[];

  /** Thay thế TOÀN BỘ category. `[]` = xoá hết. Không gửi = không đụng. */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PIN)
  @IsString({ each: true })
  categoryIds?: string[];
}
