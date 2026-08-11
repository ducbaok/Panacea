// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Toggle Comment Reaction Input DTO                                        ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. @InputType() chứa commentId và type (ReactionType).                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';
import { ReactionType } from '../entities/reaction-type.enum';

@InputType()
export class ToggleCommentReactionInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  commentId: string;

  @Field(() => ReactionType)
  @IsNotEmpty()
  type: ReactionType;
}
