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
  IsDate,
  IsIn,
  Min,
  MaxLength,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { MAX_TAGS_PER_PIN, MAX_CATEGORIES_PER_PIN } from '../tag-name.util';
import { Visibility } from '../entities/visibility.enum';
import { MAX_CIRCLE_MEMBERS } from '../../common/blocking';

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

  // ─── Ba URL biến thể (XH-9a, PLAN_XAHOI.md §8) ─────────────────────────────
  //
  // XH-QĐ-10 đảo quyết định "v1 không resize", nhưng resize làm ở CLIENT bằng
  // canvas chứ không phải Lambda: client tự upload đủ 3 bản rồi gửi URL về đây.
  // Ba field này vì vậy là ĐẦU VÀO của `createPin`, đồng thời vẫn là đầu ra của
  // `PATCH /internal/pins/:id/processed` (đường Lambda cũ) — hai đường ghi vào
  // cùng ba cột, và đó là lý do chúng nullable ở cả hai phía.
  //
  // ⚠️ HAI BẪY, cả hai đã ghi trước ở PLAN_XAHOI.md §8:
  //   · vẫn phải là URL TUYỆT ĐỐI và vẫn phải qua ĐÚNG whitelist domain của
  //     `imageUrl` — kiểm ở service, không ở đây (`@IsUrl` không biết whitelist
  //     của dự án, và thông điệp lỗi của nó không chỉ đúng field);
  //   · `imageWidth`/`imageHeight` ở trên vẫn là số đo ẢNH GỐC và vẫn BẮT BUỘC.
  //     Lưới masonry chừa chỗ theo tỉ lệ đó trước khi ảnh về; nhét số đo bản
  //     thu nhỏ vào sẽ làm cả lưới nhảy khi ảnh tải xong.

  /** Bản nhỏ nhất — lưới masonry tải cái này. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  /** Bản trung bình — modal chi tiết. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  mediumUrl?: string;

  /** Bản lớn — xem toàn màn hình. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  largeUrl?: string;

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

  // ─── Khán giả + hạn sống (XH-4a/XH-6) ──────────────────────────────────────
  //
  // Bốn field dưới đây là MỘT khối, không phải bốn tuỳ chọn rời rạc. Luật kết
  // hợp nằm ở `PinsService._resolveAudience` (một chỗ duy nhất, dùng chung với
  // `updatePin`) chứ không rải ra decorator, vì chúng là ràng buộc GIỮA các
  // field — thứ class-validator không diễn đạt được mà không bịa thêm một
  // decorator tự chế:
  //
  //     visibility != CIRCLE  ⇒ CẤM gửi audienceCircleId/audienceUserIds
  //     visibility == CIRCLE  ⇒ phải gửi ĐÚNG MỘT trong hai
  //
  // Gửi kèm mà bị BỎ QUA IM LẶNG là hình dạng lỗi tệ nhất ở đây: người dùng
  // tưởng đã giới hạn khán giả trong khi pin đang công khai. Vì vậy sai kết hợp
  // ⇒ 400, không phải "ưu tiên field này bỏ field kia".

  /**
   * Cấp khán giả. Không gửi ⇒ `PUBLIC` (XH-QĐ-18: v1 KHÔNG nhớ khán giả lần
   * trước — mỗi pin bắt đầu ở công khai, và mặc định đó phải nằm ở BE để một
   * client quên gửi field không tự tạo ra pin riêng tư ngoài ý muốn).
   */
  @Field(() => Visibility, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(Visibility))
  visibility?: Visibility;

  /**
   * Vòng tròn được ghim — CHỈ có nghĩa khi `visibility = CIRCLE` (XH-QĐ-2: một
   * pin ghim đúng một vòng). Vòng KHÔNG thuộc sở hữu người gọi ⇒ 404, cùng
   * chính sách với pin ngoài khán giả: 403 tự nó đã tiết lộ vòng đó có thật.
   */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  audienceCircleId?: string;

  /**
   * Khán giả chọn TẠI CHỖ (XH-QĐ-5) — thay cho `audienceCircleId` khi người
   * dùng tick người ngay trong màn đăng mà không đặt tên vòng.
   *
   * Server băm tập id này (`computeMemberHash`) rồi TÁI DÙNG vòng ad-hoc cũ
   * nếu đúng tập người đó đã từng dùng; chưa có thì tạo vòng `isAdHoc = true`.
   * Cùng một tập người gửi hai lần ⇒ MỘT vòng, không phải hai.
   */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CIRCLE_MEMBERS)
  @IsString({ each: true })
  audienceUserIds?: string[];

  /**
   * Hạn sống (XH-QĐ-6/7). `null`/không gửi = pin thường, sống mãi.
   *
   * Hết hạn ĐÁNH GIÁ LÚC ĐỌC, không cron: pin biến mất khỏi mọi luồng/tìm
   * kiếm/hồ sơ (kể cả của chính chủ) và chỉ còn thấy trong kho — xem
   * `archivedPins`. Không có cột `archivedAt` nào cả.
   *
   * Phải ở TƯƠNG LAI; quá khứ ⇒ 400 (một pin sinh ra đã chết là đơn hàng vô
   * nghĩa, và nếu nhận im lặng thì người dùng chỉ phát hiện khi pin không bao
   * giờ xuất hiện).
   */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  expiresAt?: Date;

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
