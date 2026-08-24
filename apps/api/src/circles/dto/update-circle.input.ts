import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  CIRCLE_NAME_MAX_LENGTH,
  CIRCLE_RANK_MAX,
  CIRCLE_RANK_MIN,
} from '../circles.constants';

/**
 * Sửa tên/rank của một vòng ĐÃ ĐẶT TÊN. Thành viên đi cửa riêng
 * (`addCircleMembers`/`removeCircleMember`).
 *
 * ⚠️ `rank` phân biệt BA trạng thái, và sự phân biệt đó là hợp đồng API:
 *   · không gửi field  ⇒ `undefined` ⇒ GIỮ NGUYÊN rank cũ
 *   · gửi `rank: null` ⇒ XOÁ rank (vòng quay về dạng "tự đặt tên")
 *   · gửi số           ⇒ đặt rank mới
 * `@IsOptional()` bỏ qua cả `null` lẫn `undefined`, nên hai trạng thái đầu vẫn
 * tới được service và được tách ở đó bằng `!== undefined`.
 */
@InputType()
export class UpdateCircleInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CIRCLE_NAME_MAX_LENGTH)
  name?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(CIRCLE_RANK_MIN)
  @Max(CIRCLE_RANK_MAX)
  rank?: number | null;
}
