// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Pin GraphQL Entity                                                      ║
// ║  Đại diện cho một Pin trong schema GraphQL.                              ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo @ObjectType() class Pin với các field theo schema Prisma.       ║
// ║  2. Bao gồm:                                                            ║
// ║     - id, title, description, imageUrl, thumbnailUrl, mediumUrl,        ║
// ║       largeUrl, imageWidth, imageHeight, sourceUrl                       ║
// ║     - viewCount, clickCount                                             ║
// ║     - creatorId (internal), creator (resolved qua DataLoader)           ║
// ║     - createdAt, updatedAt                                               ║
// ║  3. Thêm computed fields (resolve bằng @ResolveField):                  ║
// ║     - savedCount, reactionCount, commentCount                           ║
// ║     - creator: User (qua DataLoader)                                    ║
// ║     - isSavedByViewer, viewerReaction — PHỤ THUỘC NGƯỜI ĐANG XEM:       ║
// ║       cùng một pin trả giá trị khác nhau cho hai token khác nhau, và    ║
// ║       false/null cho khách vãng lai.                                    ║
// ║  4. Tạo PaginatedPins extends createPaginatedType(Pin)                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { createPaginatedType } from '../../common/pagination';
import { User } from '../../users/entities/user.entity';
import { ReactionType } from '../../comments/entities/reaction-type.enum';
import { Tag } from './tag.entity';
import { Category } from './category.entity';

@ObjectType()
export class Pin {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  imageUrl: string;

  @Field({ nullable: true })
  thumbnailUrl?: string;

  @Field({ nullable: true })
  mediumUrl?: string;

  @Field({ nullable: true })
  largeUrl?: string;

  @Field(() => Int)
  imageWidth: number;

  @Field(() => Int)
  imageHeight: number;

  @Field({ nullable: true })
  sourceUrl?: string;

  @Field(() => Int)
  viewCount: number;

  @Field(() => Int)
  clickCount: number;

  /** ID của người tạo pin — dùng nội bộ để resolve creator qua DataLoader */
  @Field()
  creatorId: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // ─── Resolved Fields (xử lý trong PinsResolver) ──────────────────────────

  /** User object — resolved qua DataLoader, không query trực tiếp */
  @Field(() => User, { nullable: true })
  creator?: User;

  /** Số lần pin được save — resolved qua DataLoader */
  @Field(() => Int, { nullable: true })
  savedCount?: number;

  /** Tổng số reactions — resolved qua DataLoader */
  @Field(() => Int, { nullable: true })
  reactionCount?: number;

  /** Tổng số comments — resolved qua DataLoader */
  @Field(() => Int, { nullable: true })
  commentCount?: number;

  // ─── Taxonomy (Đợt 6) ─────────────────────────────────────────────────────
  //
  // Cả hai khai `[T!]!` (không nullable ở cả mảng lẫn phần tử): pin không có
  // tag nào thì trả `[]`, và `[]` là một câu trả lời ĐẦY ĐỦ chứ không phải
  // "không biết". Cho phép `null` ở đây sẽ tạo ra hai cách biểu diễn cùng một
  // sự thật, và client nào cũng phải xử lý cả hai.
  //
  // ⚠️ Hai field này KHÔNG phụ thuộc viewer — khác hẳn `isSavedByViewer` /
  // `viewerReaction` ngay bên dưới. Tag của `pin_1_id` giống nhau với mọi
  // token và với cả khách vãng lai, nên loader của chúng memo theo PIN, không
  // theo viewer.

  /** Nhãn tự do gắn với pin. Không có ⇒ `[]`. Resolved qua DataLoader. */
  @Field(() => [Tag])
  tags?: Tag[];

  /** Danh mục biên tập của pin. Không có ⇒ `[]`. Resolved qua DataLoader. */
  @Field(() => [Category])
  categories?: Category[];

  // ─── Phụ thuộc viewer (Đợt 3c) ────────────────────────────────────────────
  //
  // Hai field dưới đây KHÁC hẳn 4 field trên: chúng không phải thuộc tính của
  // pin mà là quan hệ giữa pin và NGƯỜI ĐANG GỌI. Cùng một `pin_5_id` trả
  // `true`/`HEART` cho bao và `false`/`null` cho mọi người khác. Vì vậy:
  //   - loader của chúng phải memo theo viewer (`perViewer`), không phải theo
  //     pin — xem dataloader.service.ts;
  //   - khách vãng lai phải trả false/null, và đó là giá trị HỢP LỆ chứ không
  //     phải lỗi, nên không phép kiểm nào bắt được nếu viewer bị mất giữa
  //     đường. Đợt 3a tồn tại chính vì lỗi đó đã xảy ra một lần.

  /** Viewer đã lưu pin này chưa? Khách vãng lai ⇒ `false`. */
  @Field(() => Boolean, { nullable: true })
  isSavedByViewer?: boolean;

  /**
   * Reaction của riêng viewer trên pin này, `null` nếu chưa thả.
   * Tối đa MỘT giá trị vì `Reaction` có `@@unique([userId, pinId])`.
   */
  @Field(() => ReactionType, { nullable: true })
  viewerReaction?: ReactionType;
}

// Paginated wrapper cho danh sách Pins
@ObjectType()
export class PaginatedPins extends createPaginatedType(Pin) {}
