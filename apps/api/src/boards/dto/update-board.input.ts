import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, MaxLength, IsUUID } from 'class-validator';

/**
 * HƯỚNG DẪN CODE LẠI:
 * - id: bắt buộc (để biết đang update board nào).
 * - Các field khác optional.
 */
@InputType()
export class UpdateBoardInput {
  @Field(() => ID)
  @IsNotEmpty()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}
