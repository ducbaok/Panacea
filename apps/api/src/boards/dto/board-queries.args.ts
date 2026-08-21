import { ArgsType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination/cursor-pagination';

/**
 * Args cho `userBoards`, `boardPins` và `savedPins`.
 *
 * Lý do phải gộp vào một ArgsType (thay vì để `@Args('userId')` riêng cạnh
 * `@Args() CursorPaginationArgs`): xem `common/pagination/cursor-pagination.ts`.
 * Trộn hai kiểu args làm query luôn trả 400 dù build sạch.
 */
@ArgsType()
export class UserBoardsArgs extends CursorPaginationArgs {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  userId: string;
}

/** Args cho `savedPins` (REVIEW-1 #7) — cùng khuôn `UserBoardsArgs`. */
@ArgsType()
export class UserSavedPinsArgs extends CursorPaginationArgs {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ArgsType()
export class BoardPinsArgs extends CursorPaginationArgs {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  boardId: string;

  /** Lọc theo section cụ thể. Bỏ trống = mọi pin trong board. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  sectionId?: string;
}
