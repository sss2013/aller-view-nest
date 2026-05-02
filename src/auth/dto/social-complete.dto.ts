import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class SocialCompleteDto {
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
