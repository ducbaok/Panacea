import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * HƯỚNG DẪN CODE LẠI:
 * - pinId: bắt buộc.
 * - boardId: tuỳ chọn (có thể save vào Profile ko cần board).
 * - sectionId: tuỳ chọn.
 * - note: ghi chú thêm.
 */
@InputType()
export class SavePinInput {
  @Field(() => ID)
  @IsNotEmpty()
  pinId: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  boardId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  sectionId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
