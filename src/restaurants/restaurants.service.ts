import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Restaurant } from './entities/restaurant.entity';
import { Review } from './entities/review.entity';
import { GetRestaurantDto } from './dto/get-restaurant.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { UserAllergy } from '../users/entities/user-allergy.entity';

@Injectable()
export class RestaurantsService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://places.googleapis.com/v1/places:searchNearby';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(UserAllergy)
    private readonly userAllergyRepo: Repository<UserAllergy>,
  ) {
    const apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY is not defined in .env file.');
    }
    this.apiKey = apiKey;
  }

  async searchNearbyRestaurants(lat: number, lng: number) {
    const requestBody = {
      includedPrimaryTypes: ['restaurant'],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 1000.0,
        },
      },
      languageCode: 'ko',
    };

    const { data } = await firstValueFrom(
      this.httpService.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.id,places.formattedAddress,places.location,places.primaryTypeDisplayName',
        },
      }),
    );

    const places: any[] = data.places ?? [];
    if (places.length === 0) return [];

    // DB upsert: 없으면 INSERT, 있으면 조회
    const restaurants = await Promise.all(
      places.map((place) =>
        this.restaurantRepo
          .findOne({ where: { place_id: place.id } })
          .then((existing) => {
            if (existing) return existing;
            return this.restaurantRepo.save({
              place_id: place.id,
              name: place.displayName?.text ?? '',
              address: place.formattedAddress ?? '',
              business_type: place.primaryTypeDisplayName?.text ?? null,
              latitude: place.location?.latitude ?? null,
              longitude: place.location?.longitude ?? null,
            });
          }),
      ),
    );

    // 리뷰 카운트 단일 쿼리
    const restaurantIds = restaurants.map((r) => r.id);
    const reviewCounts: { restaurant_id: number; positive_count: string; negative_count: string }[] =
      await this.reviewRepo
        .createQueryBuilder('r')
        .select('r.restaurant_id', 'restaurant_id')
        .addSelect('COUNT(CASE WHEN r.positive = true THEN 1 END)', 'positive_count')
        .addSelect('COUNT(CASE WHEN r.positive = false THEN 1 END)', 'negative_count')
        .where('r.restaurant_id IN (:...ids)', { ids: restaurantIds })
        .groupBy('r.restaurant_id')
        .getRawMany();

    const countMap = new Map(
      reviewCounts.map((rc) => [rc.restaurant_id, rc]),
    );

    return restaurants.map((restaurant) => {
      const counts = countMap.get(restaurant.id);
      return {
        place_id: restaurant.place_id,
        name: restaurant.name,
        address: restaurant.address,
        business_type: restaurant.business_type,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        positive_count: counts ? parseInt(counts.positive_count, 10) : 0,
        negative_count: counts ? parseInt(counts.negative_count, 10) : 0,
      };
    });
  }

  async getOrCreateRestaurant(
    placeId: string,
    dto: GetRestaurantDto,
  ) {
    let restaurant = await this.restaurantRepo.findOne({
      where: { place_id: placeId },
      relations: ['reviews'],
    });

    if (!restaurant) {
      restaurant = await this.restaurantRepo.save({
        place_id: placeId,
        name: dto.name,
        address: dto.address,
        business_type: dto.business_type ?? null,
      });
      restaurant.reviews = [];
    }

    const reviews = restaurant.reviews;

    // 리뷰 작성자들의 알레르기 일괄 조회
    const userIds = [...new Set(reviews.map((r) => r.user_id))];
    const allergyMap = new Map<number, string[]>();

    if (userIds.length > 0) {
      const userAllergies = await this.userAllergyRepo.find({
        where: { user_id: In(userIds) },
        relations: ['allergy'],
      });
      for (const ua of userAllergies) {
        const list = allergyMap.get(ua.user_id) ?? [];
        list.push(ua.allergy.name);
        allergyMap.set(ua.user_id, list);
      }
    }

    return {
      restaurant,
      reviews: reviews.map((r) => ({
        ...r,
        allergies: allergyMap.get(r.user_id) ?? [],
      })),
    };
  }

  async createReview(placeId: string, userId: number, dto: CreateReviewDto): Promise<Review> {
    const restaurant = await this.restaurantRepo.findOne({
      where: { place_id: placeId },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with placeId "${placeId}" not found. Call GET first.`);
    }

    return this.reviewRepo.save({
      user_id: userId,
      restaurant_id: restaurant.id,
      positive: dto.positive,
      content: dto.content ?? null,
    });
  }
}
