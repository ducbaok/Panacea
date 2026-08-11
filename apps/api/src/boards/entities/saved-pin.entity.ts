import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Pin } from '../../pins/entities/pin.entity';

/**
 * SavedPin GraphQL entity.
 * 
 * HƯỚNG DẪN CODE LẠI:
 * 1. Các field: id, userId, pinId, boardId, sectionId, note, sortOrder, createdAt.
 * 2. ResolveField: pin (để hiển thị chi tiết Pin đã lưu).
 */
@ObjectType()
export class SavedPin {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  pinId: string;

  @Field({ nullable: true })
  boardId?: string;

  @Field({ nullable: true })
  sectionId?: string;

  @Field({ nullable: true })
  note?: string;

  @Field(() => Int, { defaultValue: 0 })
  sortOrder: number;

  @Field()
  createdAt: Date;

  // ─── Resolve Fields ───────────────────────────────────────────────

  @Field(() => Pin, { nullable: true })
  pin?: Pin;
}

import { createPaginatedType } from '../../common/pagination';

@ObjectType()
export class PaginatedSavedPins extends createPaginatedType(SavedPin) {}

