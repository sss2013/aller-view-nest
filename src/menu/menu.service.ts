import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'crypto';
import type { Redis } from '@upstash/redis';
import { UPSTASH_REDIS } from '../upstash.module';
import { Dish } from './entities/dish.entity';
import { DishAllergenCache } from './entities/dish-allergen-cache.entity';
import { DishCategoryVector } from './entities/dish-category-vector.entity';
import { Allergy } from '../users/entities/allergy.entity';
import { AnalyzeMenuDto } from './dto/analyze-menu.dto';
import { GetDishDetailsDto } from './dto/get-dish-details.dto';

interface DishCacheEntry {
  dish_id: number;
  allergy_ids: number[];
}

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Dish)
    private readonly dishRepo: Repository<Dish>,
    @InjectRepository(DishAllergenCache)
    private readonly allergenCacheRepo: Repository<DishAllergenCache>,
    @InjectRepository(DishCategoryVector)
    private readonly categoryVectorRepo: Repository<DishCategoryVector>,
    @InjectRepository(Allergy)
    private readonly allergyRepo: Repository<Allergy>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
    private readonly amqpConnection: AmqpConnection,
    @Inject(UPSTASH_REDIS)
    private readonly redis: Redis,
  ) { }

  async analyze(dto: AnalyzeMenuDto) {
    // 1. 알레르기 이름 → ID 조회
    const allergyRecords = await this.allergyRepo.find({
      where: { name: In(dto.user_allergies) },
    });
    const userAllergyIds = allergyRecords.map((a) => a.id);

    // 2. 각 메뉴 항목 L1(Redis) → L2(PostgreSQL) 순서로 조회
    let hasUnknown = false;
    const dishDataMap = new Map<string, DishCacheEntry | null>();

    await Promise.all(
      dto.menu_items.map(async (item) => {
        const cacheKey = `menu:dish:${item.normalized_text.replace(/\s+/g, '').toLowerCase()}`;

        // L1 체크
        const cached = await this.cache.get<DishCacheEntry>(cacheKey);
        if (cached) {
          dishDataMap.set(item.item_id, cached);
          return;
        }

        // L2 체크
        const nameNoSpace = item.normalized_text.replace(/\s+/g, '');
        const dish = await this.dishRepo
          .createQueryBuilder('d')
          .where("REPLACE(d.korean_name, ' ', '') ILIKE :name", { name: nameNoSpace })
          .getOne();

        if (!dish) {
          dishDataMap.set(item.item_id, null);
          hasUnknown = true;
          return;
        }

        const allergenCache = await this.allergenCacheRepo.findOne({ where: { dish_id: dish.id } });
        const entry: DishCacheEntry = { dish_id: dish.id, allergy_ids: allergenCache?.allergy_ids ?? [] };

        // L1에 저장 (TTL 24h)
        await this.cache.set(cacheKey, entry, 86400 * 1000);
        dishDataMap.set(item.item_id, entry);
      }),
    );

    // 3. 미스 항목 존재 → 전체 큐잉 후 job_id 반환
    if (hasUnknown) {
      const job_id = randomUUID();
      await this.redis.set(`menu:job:${job_id}`, { status: 'pending' }, { ex: 3600 });
      await this.amqpConnection.publish('menu', 'analyze', { job_id, dto });
      return { job_id };
    }

    // 4. 전체 히트 → 즉시 결과 반환
    return this.buildResult(dto, allergyRecords, userAllergyIds, dishDataMap);
  }

  async getJobResult(jobId: string) {
    const job = await this.redis.get<{ status: string; result?: any; error?: string }>(`menu:job:${jobId}`);
    if (!job) return { status: 'not_found' };
    return job;
  }

  async getDetails(dto: GetDishDetailsDto) {
    const dishes = await this.dishRepo.find({
      where: { id: In(dto.dish_ids) },
    });
    return dishes.map((d) => ({
      dish_id: d.id,
      korean_name: d.korean_name,
      calorie_min: d.calorie_min,
      calorie_max: d.calorie_max,
      image_url: d.image_url,
    }));
  }

  private buildResult(
    dto: AnalyzeMenuDto,
    allergyRecords: Allergy[],
    userAllergyIds: number[],
    dishDataMap: Map<string, DishCacheEntry | null>,
  ) {
    const dangerousIds = new Set<number>();
    const dangerousAllergenMap = new Map<number, string[]>();

    for (const [, data] of dishDataMap) {
      if (!data) continue;
      const overlap = data.allergy_ids.filter((id) => userAllergyIds.includes(id));
      if (overlap.length > 0) {
        dangerousIds.add(data.dish_id);
        const names = allergyRecords.filter((a) => overlap.includes(a.id)).map((a) => a.name);
        dangerousAllergenMap.set(data.dish_id, names);
      }
    }

    const menu_results = dto.menu_items.map((item) => {
      const data = dishDataMap.get(item.item_id);
      if (!data) {
        return { item_id: item.item_id, normalized_text: item.normalized_text, dish_id: null, risk_level: 'unknown', risk_causes: [] };
      }
      const isDanger = dangerousIds.has(data.dish_id);
      return {
        item_id: item.item_id,
        normalized_text: item.normalized_text,
        dish_id: data.dish_id,
        risk_level: isDanger ? 'danger' : 'safe',
        risk_causes: dangerousAllergenMap.get(data.dish_id) ?? [],
      };
    });

    // safe 항목 선호도 점수 계산
    const safeDishIds = menu_results.filter((r) => r.risk_level === 'safe').map((r) => r.dish_id as number);
    return this.computeRecommendations(dto, menu_results, safeDishIds);
  }

  private async computeRecommendations(
    dto: AnalyzeMenuDto,
    menu_results: any[],
    safeDishIds: number[],
  ) {
    const recommendations: { item_id: string; korean_name: string | null }[] = [];

    if (safeDishIds.length > 0) {
      const vectors = await this.categoryVectorRepo.find({ where: { dish_id: In(safeDishIds) } });
      const dishes = await this.dishRepo.find({ where: { id: In(safeDishIds) } });
      const dishMap = new Map(dishes.map((d) => [d.id, d]));
      const dishIdToItemId = new Map(
        menu_results.filter((r) => r.dish_id).map((r) => [r.dish_id as number, r.item_id]),
      );

      const { meat, seafood, vegetarian } = dto.user_preferences;
      const prefSum = meat + seafood + vegetarian || 1;

      const scored = vectors.map((vec) => ({
        item_id: dishIdToItemId.get(vec.dish_id) ?? '',
        korean_name: dishMap.get(vec.dish_id)?.korean_name ?? null,
        score: (meat * Number(vec.meat_ratio) + seafood * Number(vec.seafood_ratio) + vegetarian * Number(vec.vegetable_ratio)) / prefSum,
      }));
      scored.sort((a, b) => b.score - a.score);
      recommendations.push(...scored.slice(0, 3).map(({ item_id, korean_name }) => ({ item_id, korean_name })));
    }

    return { menu_results, recommendations };
  }
}
