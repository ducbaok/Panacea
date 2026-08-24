import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  CIRCLE_NAME_MAX_LENGTH,
  CIRCLE_RANK_MAX,
  CIRCLE_RANK_MIN,
} from '../circles.constants';

/**
 * "Lưu vòng tròn này" (xahoi-tinh-nang.md §2) — đặt tên cho một vòng ad-hoc để
 * nó thành vòng bình thường.
 *
 * KHÔNG tạo bản ghi mới: cùng một `Circle` được đặt tên tại chỗ. Đó là điều
 * kiện SỐNG CÒN của XH-QĐ-3 — mọi pin đã ghim vào vòng ad-hoc này giữ nguyên
 * `audienceCircleId`, nên khán giả của chúng không đổi. Tạo vòng mới rồi copy
 * thành viên sẽ để lại các pin cũ trỏ vào một vòng mồ côi.
 *
 * Tác dụng phụ có chủ đích: `memberHash` bị XOÁ. Vòng đã đặt tên là thứ người
 * dùng sẽ tự sửa thành viên, mà `memberHash` chỉ đúng khi tập thành viên đứng
 * yên — giữ lại là để dành một khoá sẽ lệch. Hệ quả: lần sau chọn đúng nhóm
 * người này ở màn đăng sẽ sinh một vòng ad-hoc MỚI, không nuốt mất vòng đã đặt
 * tên của người dùng.
 */
@InputType()
export class SaveAdHocCircleInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  circleId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(CIRCLE_NAME_MAX_LENGTH)
  name: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(CIRCLE_RANK_MIN)
  @Max(CIRCLE_RANK_MAX)
  rank?: number;
}
