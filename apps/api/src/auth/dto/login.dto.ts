import { IsEmail } from 'class-validator';
import { IsPassword } from './password.decorator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsPassword()
  password: string;
}
