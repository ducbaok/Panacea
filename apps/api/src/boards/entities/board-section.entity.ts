import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * BoardSection GraphQL entity.
 * 
 * HƯỚNG DẪN CODE LẠI:
 * 1. Các field cơ bản: id, name, sortOrder, boardId, createdAt.
 */
@ObjectType()
export class BoardSection {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => Int, { defaultValue: 0 })
  sortOrder: number;

  @Field()
  boardId: string;

  @Field()
  createdAt: Date;
}
