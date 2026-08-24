import { InputType, Field, ID, Int } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CIRCLE_NAME_MAX_LENGTH,
  CIRCLE_RANK_MAX,
  CIRCLE_RANK_MIN,
  MAX_MEMBERS_PER_CIRCLE,
} from '../circles.constants';

/**
 * Tạo vòng ĐẶT TÊN (`isAdHoc = false`, `memberHash = null`).
 *
 * Vòng ad-hoc đi cửa khác (`createAdHocCircle`) vì nó không có tên và phải qua
 * bước tra `memberHash` để tái dùng — trộn hai đường vào một input sẽ đẻ ra một
 * mutation mà nửa số field vô nghĩa tuỳ nhánh.
 */
@InputType()
export class CreateCircleInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(CIRCLE_NAME_MAX_LENGTH)
  name: string;

  /** `null`/bỏ trống = vòng tự đặt tên; có số = level thân thiết. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(CIRCLE_RANK_MIN)
  @Max(CIRCLE_RANK_MAX)
  rank?: number;

  /**
   * Thành viên ban đầu — tuỳ chọn: màn `/settings` cho tạo vòng rỗng rồi thêm
   * người sau. `@ArrayMaxSize` chặn sớm ở tầng validation; trần THẬT (kể cả
   * khi cộng dồn qua nhiều lần `addCircleMembers`) do service giữ.
   */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MEMBERS_PER_CIRCLE)
  @IsString({ each: true })
  userIds?: string[];
}
