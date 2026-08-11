import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * HƯỚNG DẪN CODE LẠI:
 * - boardId: board chứa section.
 * - name: tên section.
 */
@InputType()
export class CreateSectionInput {
  @Field(() => ID)
  @IsNotEmpty()
  boardId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;
}

@InputType()
export class UpdateSectionInput {
  @Field(() => ID)
  @IsNotEmpty()
  id: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;
}
