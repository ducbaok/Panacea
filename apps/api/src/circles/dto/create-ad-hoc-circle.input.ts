import { InputType, Field, ID } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { MAX_MEMBERS_PER_CIRCLE } from '../circles.constants';

/**
 * Khán giả chọn TẠI CHỖ lúc đăng (XH-QĐ-5) — không tên, ẩn khỏi màn quản lý.
 *
 * Không có `name`/`rank` là chủ đích: đây là "nhóm người này, lần này". Muốn
 * giữ lại thì gọi `saveAdHocCircle` để đặt tên.
 *
 * Cùng một tập `userIds` gọi hai lần ⇒ TRẢ VỀ CÙNG MỘT VÒNG, không tạo bản thứ
 * hai (`Circle.memberHash` + `@@unique([ownerId, memberHash])`). Đó là lý do
 * `computeMemberHash` tồn tại — xem `common/blocking/member-hash.util.ts`.
 */
@InputType()
export class CreateAdHocCircleInput {
  @Field(() => [ID])
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_MEMBERS_PER_CIRCLE)
  @IsString({ each: true })
  userIds: string[];
}
