import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Restaurant } from './entities/restaurant.entity';
import { Review } from './entities/review.entity';
import { ReviewMenuItem } from './entities/review-menu-item.entity';
import { GetRestaurantDto } from './dto/get-restaurant.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { UserAllergy } from '../users/entities/user-allergy.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class RestaurantsService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://places.googleapis.com/v1/places:searchNearby';
  private readonly textSearchUrl = 'https://places.googleapis.com/v1/places:searchText';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewMenuItem)
    private readonly reviewMenuItemRepo: Repository<ReviewMenuItem>,
    @InjectRepository(UserAllergy)
    private readonly userAllergyRepo: Repository<UserAllergy>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    const apiKey = this.configService.get<string>('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY is not defined in .env file.');
    }
    this.apiKey = apiKey;
  }

  async searchNearbyRestaurants(lat: number, lng: number, allergyIds: number[] = []) {
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

    // review_menu_items 기준 positive/negative 집계 (단일 쿼리)
    const restaurantIds = restaurants.map((r) => r.id);
    const reviewCounts: { restaurant_id: number; positive_count: string; negative_count: string }[] =
      await this.reviewMenuItemRepo
        .createQueryBuilder('rmi')
        .innerJoin('rmi.review', 'r')
        .select('r.restaurant_id', 'restaurant_id')
        .addSelect('COUNT(CASE WHEN rmi.is_safe = true THEN 1 END)', 'positive_count')
        .addSelect('COUNT(CASE WHEN rmi.is_safe = false THEN 1 END)', 'negative_count')
        .where('r.restaurant_id IN (:...ids)', { ids: restaurantIds })
        .groupBy('r.restaurant_id')
        .getRawMany();

    const countMap = new Map(
      reviewCounts.map((rc) => [Number(rc.restaurant_id), rc]),
    );

    // 알레르기 교집합 기반 safe_count 집계
    let safeCountMap = new Map<number, number>();
    if (allergyIds.length > 0) {
      const safeRows: { restaurant_id: number; safe_count: string }[] =
        await this.reviewMenuItemRepo
          .createQueryBuilder('rmi')
          .innerJoin('rmi.review', 'r')
          .innerJoin(UserAllergy, 'ua', 'ua.user_id = r.user_id')
          .select('r.restaurant_id', 'restaurant_id')
          .addSelect('COUNT(CASE WHEN rmi.is_safe = true THEN 1 END)', 'safe_count')
          .where('r.restaurant_id IN (:...ids)', { ids: restaurantIds })
          .andWhere('ua.allergy_id IN (:...allergyIds)', { allergyIds })
          .groupBy('r.restaurant_id')
          .getRawMany();

      safeCountMap = new Map(safeRows.map((row) => [Number(row.restaurant_id), parseInt(row.safe_count, 10)]));
    }

    const result = restaurants.map((restaurant) => {
      const counts = countMap.get(restaurant.id);
      const entry: Record<string, any> = {
        place_id: restaurant.place_id,
        name: restaurant.name,
        address: restaurant.address,
        business_type: restaurant.business_type,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        positive_count: counts ? parseInt(counts.positive_count, 10) : 0,
        negative_count: counts ? parseInt(counts.negative_count, 10) : 0,
      };
      if (allergyIds.length > 0) {
        entry.safe_count = safeCountMap.get(restaurant.id) ?? 0;
      }
      return entry;
    });

    if (allergyIds.length > 0) {
      result.sort((a, b) => b.safe_count - a.safe_count);
    }

    return result;
  }

  async searchByText(q: string, lat?: number, lng?: number, allergyIds: number[] = []) {
    const requestBody: Record<string, any> = {
      textQuery: q,
      languageCode: 'ko',
      maxResultCount: 20,
    };

    if (lat !== undefined && lng !== undefined) {
      requestBody.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 5000.0,
        },
      };
    }

    const { data } = await firstValueFrom(
      this.httpService.post(this.textSearchUrl, requestBody, {
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

    const restaurantIds = restaurants.map((r) => r.id);
    const reviewCounts: { restaurant_id: number; positive_count: string; negative_count: string }[] =
      await this.reviewMenuItemRepo
        .createQueryBuilder('rmi')
        .innerJoin('rmi.review', 'r')
        .select('r.restaurant_id', 'restaurant_id')
        .addSelect('COUNT(CASE WHEN rmi.is_safe = true THEN 1 END)', 'positive_count')
        .addSelect('COUNT(CASE WHEN rmi.is_safe = false THEN 1 END)', 'negative_count')
        .where('r.restaurant_id IN (:...ids)', { ids: restaurantIds })
        .groupBy('r.restaurant_id')
        .getRawMany();

    const countMap = new Map(reviewCounts.map((rc) => [Number(rc.restaurant_id), rc]));

    let safeCountMap = new Map<number, number>();
    if (allergyIds.length > 0) {
      const safeRows: { restaurant_id: number; safe_count: string }[] =
        await this.reviewMenuItemRepo
          .createQueryBuilder('rmi')
          .innerJoin('rmi.review', 'r')
          .innerJoin(UserAllergy, 'ua', 'ua.user_id = r.user_id')
          .select('r.restaurant_id', 'restaurant_id')
          .addSelect('COUNT(CASE WHEN rmi.is_safe = true THEN 1 END)', 'safe_count')
          .where('r.restaurant_id IN (:...ids)', { ids: restaurantIds })
          .andWhere('ua.allergy_id IN (:...allergyIds)', { allergyIds })
          .groupBy('r.restaurant_id')
          .getRawMany();

      safeCountMap = new Map(safeRows.map((row) => [Number(row.restaurant_id), parseInt(row.safe_count, 10)]));
    }

    const result = restaurants.map((restaurant) => {
      const counts = countMap.get(restaurant.id);
      const entry: Record<string, any> = {
        place_id: restaurant.place_id,
        name: restaurant.name,
        address: restaurant.address,
        business_type: restaurant.business_type,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        positive_count: counts ? parseInt(counts.positive_count, 10) : 0,
        negative_count: counts ? parseInt(counts.negative_count, 10) : 0,
      };
      if (allergyIds.length > 0) {
        entry.safe_count = safeCountMap.get(restaurant.id) ?? 0;
      }
      return entry;
    });

    if (allergyIds.length > 0) {
      result.sort((a, b) => b.safe_count - a.safe_count);
    }

    return result;
  }

  async getOrCreateRestaurant(placeId: string, dto: GetRestaurantDto) {
    let restaurant = await this.restaurantRepo.findOne({
      where: { place_id: placeId },
      relations: ['reviews', 'reviews.menuItems'],
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
    const userIds = [...new Set(reviews.map((r) => r.user_id))];

    const usernameMap = new Map<number, string>();

    if (userIds.length > 0) {
      const users = await this.userRepo.find({ where: { id: In(userIds) } });
      for (const u of users) {
        usernameMap.set(u.id, u.username);
      }
    }

    const { reviews: _, ...restaurantData } = restaurant as any;

    return {
      restaurant: restaurantData,
      reviews: reviews.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        username: usernameMap.get(r.user_id) ?? null,
        allergies: r.allergies,
        menu_items: r.menuItems ?? [],
        content: r.content,
        created_at: r.created_at,
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

    const userAllergies = await this.userAllergyRepo.find({
      where: { user_id: userId },
      relations: ['allergy'],
    });
    const allergySnapshot = userAllergies.map((ua) => ua.allergy.name);

    const review = await this.reviewRepo.save({
      user_id: userId,
      restaurant_id: restaurant.id,
      content: dto.content ?? null,
      allergies: allergySnapshot,
    });

    await this.reviewMenuItemRepo.save(
      dto.menu_items.map((m) => ({
        review_id: review.id,
        menu_name: m.menu_name,
        is_safe: m.is_safe,
      })),
    );

    return review;
  }
}
