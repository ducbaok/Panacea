import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';

/**
 * HƯỚNG DẪN CODE LẠI:
 * - name: bắt buộc, tối đa 100 ký tự.
 * - description: tùy chọn, tối đa 500 ký tự.
 * - isSecret: tùy chọn, mặc định false.
 */
@InputType()
export class CreateBoardInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

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
