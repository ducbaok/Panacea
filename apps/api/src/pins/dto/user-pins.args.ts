import { ArgsType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination/cursor-pagination';

/**
 * Args cho query `userPins`.
 *
 * Gộp `userId` vào cùng ArgsType với `first`/`after` là BẮT BUỘC, không phải
 * lựa chọn thẩm mỹ: trộn `@Args('userId')` với `@Args() CursorPaginationArgs`
 * làm query chết hẳn (400 "property userId should not exist").
 * Giải thích đầy đủ ở `common/pagination/cursor-pagination.ts`.
 */
@ArgsType()
export class UserPinsArgs extends CursorPaginationArgs {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  userId: string;
}
