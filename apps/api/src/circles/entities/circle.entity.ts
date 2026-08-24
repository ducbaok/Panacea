import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';

/**
 * Circle GraphQL entity — vòng tròn bạn bè (XH-3, PLAN_XAHOI.md §2).
 *
 * ⚠️ `memberHash` CỐ Ý KHÔNG CÓ MẶT. Nó là khoá nội bộ để tái dùng vòng ad-hoc;
 * lộ ra ngoài thì bất kỳ ai cầm hash cũng đối chiếu được "hai người này có
 * cùng một nhóm bạn thân không" mà không cần biết nhóm đó gồm ai. Không có
 * màn hình nào cần nó.
 *
 * ⚠️ `members`/`memberCount` là FIELD THƯỜNG, KHÔNG phải `@ResolveField` qua
 * DataLoader — và đó là lựa chọn có chủ đích, không phải thiếu sót:
 *   · Trần cứng 20 vòng/người × 50 thành viên/vòng (XH-QĐ-13) ⇒ tập dữ liệu
 *     lớn nhất có thể của một response là 1000 dòng, nạp một phát bằng `include`
 *     là ĐÚNG MỘT query cho cả danh sách. Không có N+1 để mà chống.
 *   · `DataloaderService` là `Scope.REQUEST`. Inject nó vào một service
 *     singleton sẽ kéo cả nhánh phụ thuộc sang request-scope — bẫy vòng đời đã
 *     ghi trong repo này. Không cần loader thì không có gì để bẫy.
 */
@ObjectType()
export class Circle {
  @Field(() => ID)
  id: string;

  @Field()
  ownerId: string;

  @Field()
  name: string;

  /**
   * "Mức độ thân thiết" — `null` = vòng tự đặt tên, có số = level.
   * MỘT cơ chế, hai cách trình bày (circles.constants.ts).
   */
  @Field(() => Int, { nullable: true })
  rank?: number | null;

  /**
   * `true` = khán giả chọn tại chỗ lúc đăng (XH-QĐ-5). Vòng này **ẩn khỏi màn
   * quản lý** (`myCircles` mặc định không trả về) cho tới khi người dùng bấm
   * "Lưu vòng tròn này" — xem mutation `saveAdHocCircle`.
   */
  @Field(() => Boolean)
  isAdHoc: boolean;

  @Field(() => Int)
  memberCount: number;

  @Field(() => [User])
  members: User[];

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
