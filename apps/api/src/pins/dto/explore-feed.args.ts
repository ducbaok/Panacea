import { ArgsType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination/cursor-pagination';

/**
 * Args cho query `exploreFeed`.
 *
 * Gộp `categorySlug` / `tagName` vào cùng ArgsType với `first`/`after` là BẮT
 * BUỘC, không phải lựa chọn thẩm mỹ: trộn `@Args('categorySlug')` với `@Args()
 * CursorPaginationArgs` làm query chết hẳn (400 "property categorySlug should
 * not exist"). Giải thích đầy đủ ở `common/pagination/cursor-pagination.ts`;
 * đây là chỗ đã hạ 6 query trong Đợt 3d.
 *
 * ⚠️ `?` của TypeScript ≠ `@IsOptional()` của class-validator. Thiếu
 * `@IsOptional()` là field bắt buộc lúc chạy dù trong SDL nó `nullable: true`
 * — dự án đã dính đúng bẫy này ở `ExchangeDto` (04/08/2026).
 *
 * Lọc theo `Category.slug` và `Tag.name` chứ KHÔNG theo id cuid: hai khoá này
 * là `@unique`, ổn định qua re-seed, và có thể đặt được trên URL của web.
 */
@ArgsType()
export class ExploreFeedArgs extends CursorPaginationArgs {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categorySlug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  tagName?: string;
}
