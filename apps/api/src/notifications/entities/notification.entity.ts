import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { NotificationType } from '@antigravity/database';
import { User } from '../../users/entities/user.entity';
import { Pin } from '../../pins/entities/pin.entity';
// Import Comment when it's created, for now we will just use a generic Field
import { Comment } from '../../comments/entities/comment.entity';

registerEnumType(NotificationType, {
  name: 'NotificationType',
});

@ObjectType()
export class Notification {
  @Field(() => ID)
  id: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field(() => String)
  recipientId: string;

  @Field(() => String)
  actorId: string;

  @Field(() => String, { nullable: true })
  pinId?: string | null;

  @Field(() => String, { nullable: true })
  commentId?: string | null;

  @Field(() => Boolean)
  isRead: boolean;

  @Field(() => Date)
  createdAt: Date;

  // Relations
  @Field(() => User, { nullable: true })
  actor?: User;

  @Field(() => Pin, { nullable: true })
  pin?: Pin;

  @Field(() => Comment, { nullable: true })
  comment?: Comment;
}
