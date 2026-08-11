// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Comment GraphQL Entity                                                   ║
// ║  Đại diện cho một Comment trên Pin.                                       ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. Tạo class Comment với @ObjectType.                                    ║
// ║  2. Khai báo các field: id, content, pinId, userId, parentId, createdAt.  ║
// ║  3. Thêm Resolved Fields (sử dụng DataLoader để fetch):                   ║
// ║     - user: User (người viết comment)                                     ║
// ║     - replyCount: Int (số lượng reply)                                    ║
// ║     - reactionCount: Int (số reaction)                                    ║
// ║     - isLikedByViewer: boolean (người dùng hiện tại đã like chưa)         ║
// ║  4. Tạo wrapper PaginatedComments để hỗ trợ cursor pagination.            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { createPaginatedType } from '../../common/pagination';
import { User } from '../../users/entities/user.entity';

@ObjectType()
export class Comment {
  @Field(() => ID)
  id: string;

  @Field()
  content: string;

  @Field()
  pinId: string;

  @Field()
  userId: string;

  @Field({ nullable: true })
  parentId?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // ─── Resolved Fields ───────────────────────────────────────────────────

  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => Int, { nullable: true })
  replyCount?: number;

  @Field(() => Int, { nullable: true })
  reactionCount?: number;

  @Field(() => Boolean, { nullable: true })
  isReactedByViewer?: boolean;
}

@ObjectType()
export class PaginatedComments extends createPaginatedType(Comment) {}
