// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Search Resolver                                                          ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. Định nghĩa Query `search(query, type, first, after)`.                 ║
// ║  2. Dùng GqlOptionalAuthGuard vì search là public nhưng nếu có user       ║
// ║     thì cần filter block list.                                            ║
// ║  3. Tuỳ thuộc vào SearchType (PIN, USER, BOARD), gọi hàm service          ║
// ║     tương ứng và trả về SearchResponse.                                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchResponse } from './dto/search.response';
import { SearchType } from './dto/search-type.enum';
import { GqlOptionalAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';

@Resolver()
export class SearchResolver {
  constructor(private readonly searchService: SearchService) {}

  @Query(() => SearchResponse)
  @UseGuards(GqlOptionalAuthGuard)
  async search(
    @Args('query') query: string,
    @Args('type', { type: () => SearchType }) type: SearchType,
    @Args('first', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('after', { nullable: true }) cursor?: string,
    @CurrentUser() user?: AuthUser | null,
  ): Promise<SearchResponse> {
    // Search dùng GqlOptionalAuthGuard → user có thể null (khách vãng lai).
    // Có user thì lọc bỏ những người đã block / bị block.
    const userId = user?.userId;

    if (type === SearchType.PIN) {
      const pins = await this.searchService.searchPins(userId, query, limit, cursor);
      return { pins: pins as any };
    }

    if (type === SearchType.USER) {
      const users = await this.searchService.searchUsers(userId, query, limit, cursor);
      return { users: users as any };
    }

    if (type === SearchType.BOARD) {
      const boards = await this.searchService.searchBoards(userId, query, limit, cursor);
      return { boards: boards as any };
    }

    return {};
  }
}
