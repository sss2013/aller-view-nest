import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetRestaurantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsString()
  business_type?: string;
}
