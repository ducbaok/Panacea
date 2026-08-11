// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Create Comment Input DTO                                                 ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. @InputType() định nghĩa input cho mutation createComment.             ║
// ║  2. Yêu cầu: pinId (string), content (string), parentId (optional).       ║
// ║  3. Validate: content không được rỗng (Length min/max).                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength, IsOptional } from 'class-validator';

@InputType()
export class CreateCommentInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  pinId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string;
}
