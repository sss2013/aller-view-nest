import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class MenuItemDto {
  @IsString()
  item_id!: string;

  @IsString()
  normalized_text!: string;
}

class UserPreferencesDto {
  @IsNumber() spicy!: number;
  @IsNumber() salty!: number;
  @IsNumber() sweet!: number;
  @IsNumber() meat!: number;
  @IsNumber() seafood!: number;
  @IsNumber() vegetarian!: number;
}

export class AnalyzeMenuDto {
  @IsArray()
  @IsString({ each: true })
  user_allergies!: string[];

  @ValidateNested()
  @Type(() => UserPreferencesDto)
  user_preferences!: UserPreferencesDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemDto)
  menu_items!: MenuItemDto[];

  @IsOptional()
  @IsString()
  departure_language?: string;
}
