// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  InviteCircleResult — kết quả của `inviteCircleToBoard` (XH-QĐ-17/QĐ-25)  ║
// ║                                                                          ║
// ║  Vì sao KHÔNG trả `[BoardCollaborator]` trần như `inviteCollaborator`:   ║
// ║  mời nguyên vòng là một thao tác MỘT-NHIỀU có phần bị BỎ QUA — người đã  ║
// ║  ở trong board thì giữ nguyên vai trò cũ, tài khoản đã xoá thì không     ║
// ║  vào. Mảng trả về chỉ chứa người MỚI, nên nếu chỉ có mảng đó thì FE      ║
// ║  không phân biệt được "vòng 5 người, 3 đã có mặt" với "vòng 2 người" —   ║
// ║  hai tình huống cần hai câu thông báo khác nhau (QĐ-25). Ba con số dưới  ║
// ║  đây là thứ duy nhất dựng lại được câu "x/y đã có mặt".                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { BoardCollaborator } from './board-collaborator.entity';

@ObjectType()
export class InviteCircleResult {
  @Field(() => ID)
  boardId: string;

  @Field(() => ID)
  circleId: string;

  /**
   * `y` của "x/y" — số thành viên CÒN SỐNG của vòng (đã lọc tài khoản xoá mềm).
   * Cố ý KHÔNG dùng `Circle.memberCount`: hai con số có thể lệch nhau đúng bằng
   * số tài khoản đã xoá, và FE cần con số mà thao tác này THẬT SỰ xét tới.
   */
  @Field(() => Int)
  memberCount: number;

  /** Số dòng `BoardCollaborator` vừa được tạo. */
  @Field(() => Int)
  addedCount: number;

  /** `x` của "x/y" — đã là cộng tác viên từ trước, vai trò cũ GIỮ NGUYÊN. */
  @Field(() => Int)
  alreadyCount: number;

  /** Chỉ những người MỚI thêm — đủ để FE chèn vào danh sách mà không refetch. */
  @Field(() => [BoardCollaborator])
  added: BoardCollaborator[];
}
