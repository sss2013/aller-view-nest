import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Dish } from './entities/dish.entity';
import { DishAllergenCache } from './entities/dish-allergen-cache.entity';
import { DishCategoryVector } from './entities/dish-category-vector.entity';
import { Allergy } from '../users/entities/allergy.entity';
import { AnalyzeMenuDto } from './dto/analyze-menu.dto';
import { GetDishDetailsDto } from './dto/get-dish-details.dto';

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
  ) {}

  async analyze(dto: AnalyzeMenuDto) {
    // 1. 알레르기 이름 → ID 조회
    const allergyRecords = await this.allergyRepo.find({
      where: { name: In(dto.user_allergies) },
    });
    const userAllergyIds = allergyRecords.map((a) => a.id);

    // 2. 메뉴명 → dishes 매칭 (ILIKE)
    const matchResults = await Promise.all(
      dto.menu_items.map(async (item) => {
        const dish = await this.dishRepo
          .createQueryBuilder('d')
          .where('d.korean_name ILIKE :name', { name: item.normalized_text })
          .getOne();
        return { item, dish };
      }),
    );

    const matchedDishIds = matchResults
      .filter((r) => r.dish !== null)
      .map((r) => r.dish!.id);

    // 3. 알레르겐 교집합 조회 (위험 dish_id 목록)
    const dangerousIds = new Set<number>();
    const dangerousAllergenMap = new Map<number, string[]>();

    if (matchedDishIds.length > 0 && userAllergyIds.length > 0) {
      const dangerRows = await this.allergenCacheRepo
        .createQueryBuilder('dac')
        .where('dac.dish_id IN (:...ids)', { ids: matchedDishIds })
        .andWhere('dac.allergy_ids && ARRAY[:...userAllergyIds]::integer[]', { userAllergyIds })
        .getMany();

      for (const row of dangerRows) {
        dangerousIds.add(row.dish_id);
        const matched = allergyRecords
          .filter((a) => row.allergy_ids.includes(a.id))
          .map((a) => a.name);
        dangerousAllergenMap.set(row.dish_id, matched);
      }
    }

    // 4. menu_results 구성
    const menu_results = matchResults.map(({ item, dish }) => {
      if (!dish) {
        return { item_id: item.item_id, normalized_text: item.normalized_text, dish_id: null, risk_level: 'unknown', risk_causes: [] };
      }
      const isDanger = dangerousIds.has(dish.id);
      return {
        item_id: item.item_id,
        normalized_text: item.normalized_text,
        dish_id: dish.id,
        risk_level: isDanger ? 'danger' : 'safe',
        risk_causes: dangerousAllergenMap.get(dish.id) ?? [],
      };
    });

    // 5. safe 요리에 대해 선호도 점수 계산
    const safeDishIds = matchResults
      .filter(({ dish }) => dish && !dangerousIds.has(dish.id))
      .map(({ dish }) => dish!.id);

    const recommendations: { dish_id: number; korean_name: string | null; score: number }[] = [];

    if (safeDishIds.length > 0) {
      const vectors = await this.categoryVectorRepo.find({
        where: { dish_id: In(safeDishIds) },
      });
      const dishMap = new Map(matchResults.filter((r) => r.dish).map((r) => [r.dish!.id, r.dish!]));

      const { meat, seafood, vegetarian } = dto.user_preferences;
      const prefSum = meat + seafood + vegetarian || 1;

      for (const vec of vectors) {
        const score =
          (meat * Number(vec.meat_ratio) +
            seafood * Number(vec.seafood_ratio) +
            vegetarian * Number(vec.vegetable_ratio)) /
          prefSum;
        recommendations.push({
          dish_id: vec.dish_id,
          korean_name: dishMap.get(vec.dish_id)?.korean_name ?? null,
          score: Math.round(score * 100) / 100,
        });
      }
      recommendations.sort((a, b) => b.score - a.score);
    }

    return { menu_results, recommendations: recommendations.slice(0, 3) };
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
}
