import { IsArray, IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  nickname: string;

  @IsArray()
  @IsString({ each: true })
  allergies: string[];

  @IsArray()
  @IsString({ each: true })
  preferred_ingredients: string[];
}
