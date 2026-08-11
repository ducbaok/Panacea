import { ArgsType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination/cursor-pagination';

/**
 * Args dùng chung cho `followers` và `following`.
 *
 * ⚠️ `userId` khai là `String` (KHÔNG phải `ID`) để giữ đúng schema cũ —
 * hai query này vốn dùng `@Args('userId') userId: string` không có `type`,
 * nên NestJS suy ra `String!`. Đổi sang `ID!` là breaking change với client.
 *
 * Lý do phải gộp args: xem `common/pagination/cursor-pagination.ts`.
 */
@ArgsType()
export class FollowListArgs extends CursorPaginationArgs {
  @Field()
  @IsString()
  @IsNotEmpty()
  userId: string;
}
