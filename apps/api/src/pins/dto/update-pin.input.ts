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
  IsDate,
  IsIn,
  MaxLength,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { MAX_TAGS_PER_PIN, MAX_CATEGORIES_PER_PIN } from '../tag-name.util';
import { Visibility } from '../entities/visibility.enum';
import { MAX_CIRCLE_MEMBERS } from '../../common/blocking';

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

  // ─── Đổi khán giả (XH-4a) ──────────────────────────────────────────────────
  //
  // CÙNG luật kết hợp với `CreatePinInput` (một hàm `_resolveAudience` cho cả
  // hai), nhưng KHÁC ở mặc định — và khác biệt đó là điểm dễ làm sai nhất:
  //
  //     createPin: không gửi `visibility` ⇒ PUBLIC (mặc định của pin mới)
  //     updatePin: không gửi `visibility` ⇒ GIỮ NGUYÊN cấp đang có
  //
  // Để `updatePin` mặc định về PUBLIC sẽ biến MỌI lần sửa tiêu đề của một pin
  // riêng tư thành một cú công khai im lặng — cùng họ với bug "sửa tiêu đề mất
  // sạch tag" mà quy ước ba trạng thái bên dưới sinh ra để chặn.
  //
  // ⚠️ `expiresAt` ở đây chỉ ĐẶT/ĐỔI hạn, KHÔNG gỡ được hạn. Gỡ hạn (đăng lại
  // từ kho) là mutation riêng `republishPin` — xem `PinsService.republishPin`.
  // Lý do: `null` tường minh và `undefined` không phân biệt được sau khi qua
  // `@IsOptional()`, nên "xoá hạn" mà đi chung đường này sẽ là một trạng thái
  // không diễn đạt nổi. Một mutation riêng cũng đúng với hộp xác nhận mà bản
  // vẽ yêu cầu (QĐ-24) và cho FE một chỗ duy nhất để gắn nó.

  /** Cấp khán giả mới. Không gửi = GIỮ NGUYÊN (không phải PUBLIC). */
  @Field(() => Visibility, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(Visibility))
  visibility?: Visibility;

  /** Vòng ghim mới — chỉ gửi kèm `visibility: CIRCLE`. Vòng người khác ⇒ 404. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  audienceCircleId?: string;

  /** Khán giả chọn tại chỗ — chỉ gửi kèm `visibility: CIRCLE`, thay cho id vòng. */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CIRCLE_MEMBERS)
  @IsString({ each: true })
  audienceUserIds?: string[];

  /** Đặt/đổi hạn sống. Phải ở tương lai. Gỡ hạn ⇒ dùng `republishPin`. */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  expiresAt?: Date;

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
