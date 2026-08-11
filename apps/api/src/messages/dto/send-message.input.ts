import { InputType, Field, ID } from '@nestjs/graphql';
import { IsString, IsOptional } from 'class-validator';

@InputType()
export class SendMessageInput {
  @Field(() => ID)
  @IsString()
  conversationId: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  content?: string;

  @Field(() => ID, { nullable: true })
  @IsString()
  @IsOptional()
  attachedPinId?: string;
}
