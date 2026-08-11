import { ObjectType, Field, ID } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';
import { Pin } from '../../pins/entities/pin.entity';

/**
 * Board GraphQL entity — đại diện cho model Board trong database.
 * 
 * HƯỚNG DẪN CODE LẠI:
 * 1. Khai báo @ObjectType() cho Board.
 * 2. Các field cơ bản: id, name, description, isSecret, coverPinId, userId, createdAt, updatedAt.
 * 3. Các ResolveFields:
 *    - user (chủ sở hữu)
 *    - coverPin (nếu có coverPinId)
 *    - sections (sử dụng DataLoader để lấy các section của board này)
 *    - collaborators (sử dụng DataLoader)
 *    - pinCount (sử dụng DataLoader đếm số savedPin trong board)
 * 4. Không expose deletedAt.
 */
@ObjectType()
export class Board {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Boolean, { defaultValue: false })
  isSecret: boolean;

  @Field({ nullable: true })
  coverPinId?: string;

  @Field()
  userId: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // ─── Resolve Fields ───────────────────────────────────────────────

  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => Pin, { nullable: true })
  coverPin?: Pin;

  @Field(() => Number, { nullable: true })
  pinCount?: number;
}

import { createPaginatedType } from '../../common/pagination';

@ObjectType()
export class PaginatedBoards extends createPaginatedType(Board) {}

