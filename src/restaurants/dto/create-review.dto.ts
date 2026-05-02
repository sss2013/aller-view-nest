import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateReviewDto {
  @IsBoolean()
  positive!: boolean;

  @IsOptional()
  @IsString()
  content?: string;
}
