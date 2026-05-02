import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { GetRestaurantDto } from './dto/get-restaurant.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { SupabaseGuard, AuthUser } from '../auth/supabase.guard';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) { }

  @Get('nearby-restaurants')
  async getNearbyRestaurants(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);

    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
      throw new HttpException(
        'Latitude and longitude are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      console.log(`Fetching nearby restaurants for lat: ${parsedLat}, lng: ${parsedLng}`);
      return await this.restaurantsService.searchNearbyRestaurants(parsedLat, parsedLng);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Google Restaurants API error:', (error as any).response?.data || err.message);
      throw new HttpException('Failed to fetch restaurants', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':placeId/reviews')
  async getReviews(
    @Param('placeId') placeId: string,
    @Query() dto: GetRestaurantDto,
  ) {
    return this.restaurantsService.getOrCreateRestaurant(placeId, dto);
  }

  @Post(':placeId/reviews')
  @UseGuards(SupabaseGuard)
  async createReview(
    @Param('placeId') placeId: string,
    @Body() dto: CreateReviewDto,
    @Req() req: any,
  ) {
    const user = req.user as AuthUser;
    try {
      return this.restaurantsService.createReview(placeId, user.localUser!.id, dto);
    } catch (error) {
      throw new HttpException(`Failed to create review : ${error}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
