import { ObjectType, Field, ID } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';
import { Message } from './message.entity';

@ObjectType()
export class ConversationMember {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  conversationId: string;

  @Field(() => String)
  userId: string;

  @Field(() => Date)
  joinedAt: Date;

  @Field(() => User, { nullable: true })
  user?: User;
}

@ObjectType()
export class Conversation {
  @Field(() => ID)
  id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [ConversationMember], { nullable: true })
  members?: ConversationMember[];

  @Field(() => [Message], { nullable: true })
  messages?: Message[];
}
