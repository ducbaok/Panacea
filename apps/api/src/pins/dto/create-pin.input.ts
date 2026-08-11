// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  CreatePinInput — DTO cho mutation createPin                             ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo @InputType() class với các field cần thiết.                     ║
// ║  2. Bắt buộc: imageUrl (S3 key), imageWidth, imageHeight.              ║
// ║  3. Tùy chọn: title, description, sourceUrl.                           ║
// ║  4. Dùng class-validator để validate.                                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { InputType, Field, Int, ID } from '@nestjs/graphql';
import {
  IsString,
  IsOptional,
  IsUrl,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { MAX_TAGS_PER_PIN, MAX_CATEGORIES_PER_PIN } from '../tag-name.util';

@InputType()
export class CreatePinInput {
  /**
   * S3 object key trả về từ Presigned URL.
   * Ví dụ: "raw/pins/userId123/uuid.jpg"
   */
  @Field()
  @IsString()
  imageUrl: string;

  /** Chiều rộng gốc của ảnh (pixel) — client đọc từ file trước khi upload */
  @Field(() => Int)
  @IsInt()
  @Min(1)
  imageWidth: number;

  /** Chiều cao gốc của ảnh (pixel) — client đọc từ file trước khi upload */
  @Field(() => Int)
  @IsInt()
  @Min(1)
  imageHeight: number;

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

  /** Link nguồn gốc của ảnh */
  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  // ─── Taxonomy (Đợt 6) ──────────────────────────────────────────────────────
  //
  // ⚠️ BẤT ĐỐI XỨNG CÓ LÝ DO — `tagNames` là TÊN, `categoryIds` là ID:
  //   · `Tag` do người dùng đẻ ra. Gửi tên chưa tồn tại ⇒ server tự tạo, nên
  //     bắt client phải biết id trước là bất khả thi.
  //   · `Category` là danh mục biên tập, 12 bản ghi cố định. Nhận tên sẽ mở
  //     đường cho client tạo category mới — đúng thứ thiết kế này cấm.
  // Đổi một trong hai cho "đối xứng đẹp" là phá bỏ khác biệt nghiệp vụ đó.

  /**
   * Tên tag tự do; server tự chuẩn hoá (lowercase, gộp khoảng trắng) và tự tạo
   * Tag chưa tồn tại. Trùng nhau sau chuẩn hoá ⇒ gộp làm một.
   *
   * `@ArrayMaxSize` đếm trên MẢNG GỐC client gửi, cố ý KHÔNG đếm sau khử trùng:
   * gửi 11 tag mà 3 cái trùng nhau vẫn là 11 tag phải xử lý, và trả 400 ngay ở
   * tầng validation rẻ hơn là chuẩn hoá xong mới từ chối.
   */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_PIN)
  @IsString({ each: true })
  tagNames?: string[];

  /**
   * Id của category có sẵn (đọc từ query `categories`). Id không tồn tại ⇒ 400
   * `Unknown categoryId`, KHÔNG phải 500 — xem `PinsService.createPin`.
   */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PIN)
  @IsString({ each: true })
  categoryIds?: string[];
}
