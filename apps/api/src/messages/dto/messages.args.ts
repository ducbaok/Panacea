import { ArgsType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination/cursor-pagination';

/**
 * Args cho query `messages`.
 *
 * ⚠️ `conversationId` khai là `String` (KHÔNG phải `ID`) để giữ đúng schema cũ.
 *
 * Lý do phải gộp args: xem `common/pagination/cursor-pagination.ts`.
 */
@ArgsType()
export class MessagesArgs extends CursorPaginationArgs {
  @Field()
  @IsString()
  @IsNotEmpty()
  conversationId: string;
}
