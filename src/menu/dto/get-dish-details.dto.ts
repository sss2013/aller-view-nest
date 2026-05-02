import { IsArray, IsInt } from 'class-validator';

export class GetDishDetailsDto {
  @IsArray()
  @IsInt({ each: true })
  dish_ids!: number[];
}
