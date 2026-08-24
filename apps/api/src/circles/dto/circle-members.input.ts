import { InputType, Field, ID } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { MAX_MEMBERS_PER_CIRCLE } from '../circles.constants';

/**
 * Thêm người vào một vòng đã có.
 *
 * Thêm THEO LÔ chứ không từng người: màn quản lý tick nhiều người rồi bấm một
 * lần, và trần 50 chỉ kiểm được đúng khi biết cả lô — thêm lẻ 50 lần thì lần
 * thứ 51 mới chặn, còn lô 30 người vào vòng đang có 40 phải chặn NGAY, không
 * phải nhận 10 người đầu rồi lỗi giữa chừng.
 */
@InputType()
export class CircleMembersInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  circleId: string;

  @Field(() => [ID])
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_MEMBERS_PER_CIRCLE)
  @IsString({ each: true })
  userIds: string[];
}
