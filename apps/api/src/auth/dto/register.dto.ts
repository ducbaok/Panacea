import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { IsPassword } from './password.decorator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsPassword()
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;
}
