import { ObjectType, Field, ID } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';
import { Conversation } from './conversation.entity';
import { Pin } from '../../pins/entities/pin.entity';

@ObjectType()
export class Message {
  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true })
  content?: string | null;

  @Field(() => String, { nullable: true })
  attachedPinId?: string | null;

  @Field(() => String)
  conversationId: string;

  @Field(() => String)
  senderId: string;

  @Field(() => Date, { nullable: true })
  readAt?: Date | null;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Conversation, { nullable: true })
  conversation?: Conversation;

  @Field(() => User, { nullable: true })
  sender?: User;

  @Field(() => Pin, { nullable: true })
  attachedPin?: Pin;
}
