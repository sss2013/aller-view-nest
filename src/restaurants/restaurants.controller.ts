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
    @Query('allergy_ids') allergyIds?: string,
  ) {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);

    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
      throw new HttpException(
        'Latitude and longitude are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const parsedAllergyIds = allergyIds
      ? allergyIds.split(',').map(Number).filter((n) => !Number.isNaN(n))
      : [];

    try {
      console.log(`Fetching nearby restaurants for lat: ${parsedLat}, lng: ${parsedLng}`);
      return await this.restaurantsService.searchNearbyRestaurants(parsedLat, parsedLng, parsedAllergyIds);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Google Restaurants API error:', (error as any).response?.data || err.message);
      throw new HttpException('Failed to fetch restaurants', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('search')
  async searchRestaurants(
    @Query('q') q: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('allergy_ids') allergyIds?: string,
  ) {
    if (!q || !q.trim()) {
      throw new HttpException('q is required', HttpStatus.BAD_REQUEST);
    }

    const parsedLat = lat ? parseFloat(lat) : undefined;
    const parsedLng = lng ? parseFloat(lng) : undefined;
    const parsedAllergyIds = allergyIds
      ? allergyIds.split(',').map(Number).filter((n) => !Number.isNaN(n))
      : [];

    try {
      return await this.restaurantsService.searchByText(q.trim(), parsedLat, parsedLng, parsedAllergyIds);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Restaurant search error:', err.message);
      throw new HttpException('Failed to search restaurants', HttpStatus.INTERNAL_SERVER_ERROR);
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
