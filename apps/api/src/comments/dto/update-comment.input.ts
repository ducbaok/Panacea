// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Update Comment Input DTO                                                 ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. @InputType() để update nội dung comment.                              ║
// ║  2. Yêu cầu: id (commentId), content (nội dung mới).                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class UpdateCommentInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  id: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string;
}
