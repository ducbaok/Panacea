// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Comment Reaction Entity                                                  ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. @ObjectType() với các field: id, type, userId, commentId, createdAt.  ║
// ║  2. Type dùng Enum ReactionType (cần registerEnumType).                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID } from '@nestjs/graphql';
import { ReactionType } from './reaction-type.enum';

@ObjectType()
export class CommentReaction {
  @Field(() => ID)
  id: string;

  @Field(() => ReactionType)
  type: ReactionType;

  @Field()
  userId: string;

  @Field()
  commentId: string;

  @Field()
  createdAt: Date;
}
