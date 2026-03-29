import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
import { PlacesService } from './places.service';


@Controller('places')
export class PlacesController {
    constructor(private readonly placesService: PlacesService) { }

    @Get('nearby-restaurants')
    async getNearbyRestaurants(
        @Query('lat') lat: number,
        @Query('lng') lng: number,
    ) {
        if (!lat || !lng) {
            throw new HttpException('Latitude and longitude are required', HttpStatus.BAD_REQUEST);
        }

        try {
            return await this.placesService.searchNearbyRestaurants(+lat, +lng);
        } catch (error) {
            // Google API 에러를 로깅하고 클라이언트에게는 일반적인 에러 메시지 전달
            console.error('Google Places API error:', error.response?.data);
            throw new HttpException('Failed to fetch places', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}