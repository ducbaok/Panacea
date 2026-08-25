import { ArgsType, Field, ID } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString } from 'class-validator';

import { CursorPaginationArgs } from '../../common/pagination';
import { FeedSource } from '../entities/home-feed.entity';

/**
 * Args của `homeFeed` — cursor pagination + tham số ÉP NGUỒN tuỳ chọn (QĐ-1 / §6b.1).
 *
 * `source` bỏ trống ⇒ backend tự chọn nhánh theo `followingCount` (hành vi cũ,
 * có fallback sang explore). Client ép `source` ⇒ backend TÔN TRỌNG tuyệt đối,
 * KHÔNG fallback:
 *   - ép FOLLOWING khi chưa follow ai ⇒ trả RỖNG kèm `source=FOLLOWING` để card
 *     rỗng ở B1 hiện đúng (chip nguồn phải trung thực, không tự nhảy về explore);
 *   - ép EXPLORE ⇒ luôn trả explore feed.
 *
 * Gộp vào MỘT @ArgsType kế thừa `CursorPaginationArgs`: trộn `@Args('source')`
 * với `@Args()` không tên làm query trả 400 im lặng (xem cursor-pagination.ts).
 *
 * XH-QĐ-17 / luồng D — nguồn THỨ BA `CIRCLE` đi kèm `circleId`. Hai field này
 * BUỘC PHẢI ĐI CÙNG NHAU và luật đó cưỡng chế ở SERVICE, không ở đây: quan hệ
 * giữa hai field không phải thứ `class-validator` diễn đạt được mà không kéo
 * theo một decorator tuỳ biến, và thông điệp lỗi của nó phải nói được cả hai
 * chiều sai (thiếu `circleId` ⇄ thừa `circleId`).
 */
@ArgsType()
export class HomeFeedArgs extends CursorPaginationArgs {
  @Field(() => FeedSource, { nullable: true })
  @IsOptional()
  @IsEnum(FeedSource)
  source?: FeedSource;

  /** Vòng cần xem — CHỈ có nghĩa khi `source = CIRCLE`. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  circleId?: string;
}
