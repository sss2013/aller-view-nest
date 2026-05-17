import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

class MenuItemDto {
  @IsString()
  menu_name!: string;

  @IsBoolean()
  is_safe!: boolean;
}

export class CreateReviewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemDto)
  menu_items!: MenuItemDto[];

  @IsOptional()
  @IsString()
  content?: string;
}
