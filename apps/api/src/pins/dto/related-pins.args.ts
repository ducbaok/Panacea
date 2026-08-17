import { ArgsType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination/cursor-pagination';

/**
 * Args cho query `relatedPins` (B-11).
 *
 * Gộp `pinId` vào cùng ArgsType với `first`/`after` là BẮT BUỘC: trộn
 * `@Args('pinId')` với `@Args() CursorPaginationArgs` làm query **chết hẳn**
 * (400 `"property pinId should not exist"` từ `forbidNonWhitelisted`) dù build
 * sạch và SDL sinh ra đúng. Bug này từng giết 6 query — xem
 * `common/pagination/cursor-pagination.ts` và `LEARNING_NOTES.md` §12.
 *
 * `pinId` là `ID!` bắt buộc, KHÔNG `@IsOptional()`: "pin liên quan" mà không có
 * pin gốc thì không có nghĩa gì.
 */
@ArgsType()
export class RelatedPinsArgs extends CursorPaginationArgs {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  pinId: string;
}
