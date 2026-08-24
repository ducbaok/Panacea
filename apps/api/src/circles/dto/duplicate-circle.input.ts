import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  CIRCLE_NAME_MAX_LENGTH,
  CIRCLE_RANK_MAX,
  CIRCLE_RANK_MIN,
} from '../circles.constants';

/**
 * Nhân bản vòng (xahoi-tinh-nang.md §2) — "tạo vòng mới TỪ vòng có sẵn rồi sửa,
 * để không phải tick lại 20 người".
 *
 * Bản sao LUÔN là vòng đặt tên (`isAdHoc = false`, `memberHash = null`) kể cả
 * khi nguồn là vòng ad-hoc: nhân bản chính là cách biến một khán giả chọn tại
 * chỗ thành một vòng dùng lại được. `name` vì thế BẮT BUỘC — không tự đặt
 * "Copy of X" hộ người dùng, vì tên vòng là thứ họ sẽ nhìn để không đăng nhầm
 * khán giả (PLAN_XAHOI.md §9 "chống đăng nhầm").
 */
@InputType()
export class DuplicateCircleInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  sourceCircleId: string;

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
