import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
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

interface LlmAnalysisItem {
  english_name: string;
  image_search_query: string;
  allergens: string[];
  calorie_min: number | null;
  calorie_max: number | null;
  meat_ratio: number;
  seafood_ratio: number;
  vegetable_ratio: number;
  spicy_ratio: number;
  salty_ratio: number;
  sweet_ratio: number;
}

function buildAnalyzePrompt(nameList: string): string {
  return `아래 음식 목록을 분석해줘.

${nameList}

각 음식에 대해:
1. english_name: 음식의 영문명 (간결하게)
2. image_search_query: Pexels 이미지 검색에 최적화된 영문 쿼리 (예: "Vietnamese fresh spring rolls goi cuon", "Japanese tonkotsu ramen bowl")
3. 알레르겐: 반드시 아래 목록에서만 선택 (없으면 빈 배열)
   계란, 우유, 메밀, 땅콩, 대두, 밀, 고등어, 게, 새우, 돼지고기, 복숭아, 토마토, 아황산류, 호두, 닭고기, 쇠고기, 오징어, 굴, 전복, 홍합, 잣, 추출성분
4. 칼로리: 1인분 기준 최소/최대 추정 (kcal 정수)
5. 카테고리 비율: meat_ratio(육류), seafood_ratio(해산물), vegetable_ratio(채소/기타) — 합이 1.0
6. 맛 프로파일(0.0~1.0): spicy_ratio(매운 정도), salty_ratio(짠 정도), sweet_ratio(단 정도) — 독립 수치, 합이 1일 필요 없음

JSON 배열 형식으로만 응답 (순서 유지):
[
  { "name": "음식명", "english_name": "Pad Thai", "image_search_query": "Thai pad thai stir fried noodles shrimp", "allergens": ["새우"], "calorie_min": 400, "calorie_max": 600, "meat_ratio": 0.30, "seafood_ratio": 0.20, "vegetable_ratio": 0.50, "spicy_ratio": 0.3, "salty_ratio": 0.5, "sweet_ratio": 0.1 }
]`;
}

function buildRecipePrompt(nameList: string): string {
  return `아래 음식 목록에 대해 한국어로 설명과 주요 재료를 알려줘.

${nameList}

각 음식에 대해:
1. description: 어떤 요리인지 짧은 설명 (1~2문장, 한국어)
2. ingredients: 주요 재료 목록 (한국어, 5~10개)

JSON 배열 형식으로만 응답 (순서 유지):
[{ "name": "음식명", "description": "...", "ingredients": ["재료1", "재료2"] }]`;
}

function parseLlmItem(item: any, defaultItem: LlmAnalysisItem): LlmAnalysisItem {
  if (!item) return { ...defaultItem };
  return {
    english_name: typeof item.english_name === 'string' ? item.english_name : '',
    image_search_query: typeof item.image_search_query === 'string' ? item.image_search_query : '',
    allergens: Array.isArray(item.allergens) ? item.allergens : [],
    calorie_min: typeof item.calorie_min === 'number' ? item.calorie_min : null,
    calorie_max: typeof item.calorie_max === 'number' ? item.calorie_max : null,
    meat_ratio: typeof item.meat_ratio === 'number' ? item.meat_ratio : 0,
    seafood_ratio: typeof item.seafood_ratio === 'number' ? item.seafood_ratio : 0,
    vegetable_ratio: typeof item.vegetable_ratio === 'number' ? item.vegetable_ratio : 0,
    spicy_ratio: typeof item.spicy_ratio === 'number' ? item.spicy_ratio : 0,
    salty_ratio: typeof item.salty_ratio === 'number' ? item.salty_ratio : 0,
    sweet_ratio: typeof item.sweet_ratio === 'number' ? item.sweet_ratio : 0,
  };
}

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);
  private readonly gemini: GoogleGenerativeAI;
  private readonly groq: Groq;
  private readonly s3: S3Client;
  private readonly s3Bucket: string;
  private readonly pexelsApiKey: string;

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
    private readonly configService: ConfigService,
  ) {
    this.gemini = new GoogleGenerativeAI(this.configService.get<string>('GEMINI_API_KEY') ?? '');
    this.groq = new Groq({ apiKey: this.configService.get<string>('GROQ_API_KEY') ?? '' });
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-2'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
      },
    });
    this.s3Bucket = this.configService.get<string>('AWS_S3_BUCKET') ?? '';
    this.pexelsApiKey = this.configService.get<string>('PEXELS_API_KEY') ?? '';
  }

  async analyze(dto: AnalyzeMenuDto) {
    const jobStart = Date.now();

    // 1. L1/L2 조회 → 히트/미스 분류
    const t0 = Date.now();
    const dishDataMap = new Map<string, DishCacheEntry>();
    type MissItem = { item_id: string; normalized_text: string; cacheKey: string };
    const missItems: MissItem[] = [];

    for (const item of dto.menu_items) {
      const cacheKey = `menu:dish:${item.normalized_text.replace(/\s+/g, '').toLowerCase()}`;
      const cached = await this.cache.get<DishCacheEntry>(cacheKey);
      if (cached) { dishDataMap.set(item.item_id, cached); continue; }

      const nameNoSpace = item.normalized_text.replace(/\s+/g, '');
      const existingDish = await this.dishRepo
        .createQueryBuilder('d')
        .where("REPLACE(d.korean_name, ' ', '') ILIKE :name", { name: nameNoSpace })
        .getOne();

      if (existingDish) {
        const allergenCache = await this.allergenCacheRepo.findOne({ where: { dish_id: existingDish.id } });
        const entry: DishCacheEntry = { dish_id: existingDish.id, allergy_ids: allergenCache?.allergy_ids ?? [] };
        await this.cache.set(cacheKey, entry, 86400 * 1000);
        dishDataMap.set(item.item_id, entry);
        continue;
      }

      missItems.push({ item_id: item.item_id, normalized_text: item.normalized_text, cacheKey });
    }
    this.logger.log(`[TIMING] L1/L2 조회: ${Date.now() - t0}ms (miss ${missItems.length}/${dto.menu_items.length})`);

    // 2. 미스 항목 일괄 Gemini 호출
    if (missItems.length > 0) {
      const tLlm = Date.now();
      const analyses = await this.analyzeBatch(missItems.map((m) => m.normalized_text));
      this.logger.log(`[TIMING] LLM 배치 호출: ${Date.now() - tLlm}ms (${missItems.length}개)`);

      const tDb = Date.now();
      const imageUploadQueue: { query: string; dishId: number }[] = [];
      const recipeQueue: { dishId: number; name: string }[] = [];

      await Promise.all(
        missItems.map(async ({ item_id, normalized_text, cacheKey }, i) => {
          const analysis = analyses[i];

          const allergyRecordsForDish = analysis.allergens.length > 0
            ? await this.allergyRepo.find({ where: { name: In(analysis.allergens) } })
            : [];
          const allergyIds = allergyRecordsForDish.map((a) => a.id);

          const newDish = await this.dishRepo.save({
            korean_name: normalized_text,
            calorie_min: analysis.calorie_min,
            calorie_max: analysis.calorie_max,
          });

          const ratioSum = analysis.meat_ratio + analysis.seafood_ratio + analysis.vegetable_ratio;
          const meat_ratio = ratioSum > 0 ? analysis.meat_ratio / ratioSum : 0;
          const seafood_ratio = ratioSum > 0 ? analysis.seafood_ratio / ratioSum : 0;
          const vegetable_ratio = Math.max(0, 1 - meat_ratio - seafood_ratio);

          await Promise.all([
            this.allergenCacheRepo.save({ dish_id: newDish.id, allergy_ids: allergyIds }),
            this.categoryVectorRepo.save({
              dish_id: newDish.id,
              meat_ratio,
              seafood_ratio,
              vegetable_ratio,
              spicy_ratio: Math.min(1, Math.max(0, analysis.spicy_ratio)),
              salty_ratio: Math.min(1, Math.max(0, analysis.salty_ratio)),
              sweet_ratio: Math.min(1, Math.max(0, analysis.sweet_ratio)),
            }),
          ]);

          const imageQuery = analysis.image_search_query || analysis.english_name || normalized_text;
          imageUploadQueue.push({ query: imageQuery, dishId: newDish.id });
          recipeQueue.push({ dishId: newDish.id, name: normalized_text });

          const entry: DishCacheEntry = { dish_id: newDish.id, allergy_ids: allergyIds };
          await this.cache.set(cacheKey, entry, 86400 * 1000);
          dishDataMap.set(item_id, entry);
        }),
      );
      this.logger.log(`[TIMING] DB 저장: ${Date.now() - tDb}ms`);

      // 이미지 업로드는 순차 실행 (CDN 쓰로틀링 방지)
      (async () => {
        for (const { query, dishId } of imageUploadQueue) {
          await this.fetchAndUploadImage(query, dishId).catch((err) =>
            this.logger.warn(`이미지 업로드 실패 [dish ${dishId}]: ${err}`),
          );
        }
      })();

      // 레시피/설명은 별도 LLM 호출로 fire-and-forget
      (async () => {
        await this.fetchAndSaveRecipe(recipeQueue).catch((err) =>
          this.logger.warn(`레시피 저장 실패: ${err}`),
        );
      })();
    }

    // 3. 알레르기 이름 → ID 조회
    const allergyRecords = await this.allergyRepo.find({
      where: { name: In(dto.user_allergies) },
    });
    const userAllergyIds = allergyRecords.map((a) => a.id);

    // 4. 결과 구성
    const result = await this.buildResult(dto, allergyRecords, userAllergyIds, dishDataMap);
    this.logger.log(`[TIMING] analyze 완료 — 총 ${Date.now() - jobStart}ms`);
    return result;
  }

  async deleteDishesByNames(names: string[]) {
    const dishes = await this.dishRepo
      .createQueryBuilder('d')
      .where('d.korean_name IN (:...names)', { names })
      .getMany();

    if (dishes.length === 0) return { deleted: 0, names: [] };

    const ids = dishes.map((d) => d.id);

    await Promise.all([
      this.allergenCacheRepo.delete(ids),
      this.categoryVectorRepo.delete(ids),
    ]);
    await this.dishRepo.delete(ids);

    // L1 캐시에서도 제거
    await Promise.all(
      dishes.map((d) =>
        this.cache.del(`menu:dish:${(d.korean_name ?? '').replace(/\s+/g, '').toLowerCase()}`),
      ),
    );

    this.logger.log(`테스트 삭제: ${dishes.map((d) => d.korean_name).join(', ')}`);
    return { deleted: dishes.length, names: dishes.map((d) => d.korean_name) };
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
      description: d.description ?? null,
      ingredients: d.ingredients ?? [],
    }));
  }

  private async buildResult(
    dto: AnalyzeMenuDto,
    allergyRecords: Allergy[],
    userAllergyIds: number[],
    dishDataMap: Map<string, DishCacheEntry>,
  ) {
    const dangerousIds = new Set<number>();
    const dangerousAllergenMap = new Map<number, string[]>();

    for (const [, data] of dishDataMap) {
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

    return this.computeRecommendations(dto, menu_results);
  }

  private async computeRecommendations(dto: AnalyzeMenuDto, menu_results: any[]) {
    const safeDishIds = menu_results
      .filter((r) => r.risk_level === 'safe')
      .map((r) => r.dish_id as number);

    if (safeDishIds.length === 0) {
      return { menu_results, recommendations: { category: [], taste: [] } };
    }

    const vectors = await this.categoryVectorRepo.find({ where: { dish_id: In(safeDishIds) } });
    const dishes = await this.dishRepo.find({ where: { id: In(safeDishIds) } });
    const dishMap = new Map(dishes.map((d) => [d.id, d]));
    const dishIdToItemId = new Map(
      menu_results.filter((r) => r.dish_id).map((r) => [r.dish_id as number, r.item_id]),
    );

    const { meat, seafood, vegetarian, spicy, salty, sweet } = dto.user_preferences;
    const catSum = (meat + seafood + vegetarian) || 1;
    const tasteSum = (spicy + salty + sweet) || 1;

    const base = vectors.map((vec) => ({
      item_id: dishIdToItemId.get(vec.dish_id) ?? '',
      korean_name: dishMap.get(vec.dish_id)?.korean_name ?? null,
      catScore: (meat * Number(vec.meat_ratio) + seafood * Number(vec.seafood_ratio) + vegetarian * Number(vec.vegetable_ratio)) / catSum,
      tasteScore: (spicy * Number(vec.spicy_ratio) + salty * Number(vec.salty_ratio) + sweet * Number(vec.sweet_ratio)) / tasteSum,
    }));

    const category = [...base].sort((a, b) => b.catScore - a.catScore).slice(0, 3).map(({ item_id, korean_name }) => ({ item_id, korean_name }));
    const taste = [...base].sort((a, b) => b.tasteScore - a.tasteScore).slice(0, 3).map(({ item_id, korean_name }) => ({ item_id, korean_name }));

    return { menu_results, recommendations: { category, taste } };
  }

  private async analyzeBatch(menuNames: string[]) {
    try {
      return await this.analyzeBatchWithGroq(menuNames);
    } catch (err) {
      this.logger.warn(`Groq 실패, Gemini 폴백: ${err}`);
      return this.analyzeBatchWithGemini(menuNames);
    }
  }

  private async analyzeBatchWithGroq(menuNames: string[]) {
    const defaultItem = { english_name: '', image_search_query: '', allergens: [], calorie_min: null, calorie_max: null, meat_ratio: 0, seafood_ratio: 0, vegetable_ratio: 0, spicy_ratio: 0, salty_ratio: 0, sweet_ratio: 0 };
    const nameList = menuNames.map((n, i) => `${i + 1}. ${n}`).join('\n');
    const prompt = buildAnalyzePrompt(nameList);

    const tGroq = Date.now();
    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });
    this.logger.log(`[TIMING] Groq(llama-3.3-70b-versatile) 응답: ${Date.now() - tGroq}ms`);

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    this.logger.debug(`Groq batch response: ${text}`);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`Groq JSON 파싱 실패: ${text}`);

    const parsed: any[] = JSON.parse(jsonMatch[0]);
    parsed.forEach((item, i) => {
      this.logger.debug(`[번역] ${menuNames[i]} → ${item?.english_name ?? '(없음)'} | 검색쿼리: ${item?.image_search_query ?? '(없음)'}`);
    });

    return menuNames.map((_, i) => parseLlmItem(parsed[i], defaultItem));
  }

  private async analyzeBatchWithGemini(menuNames: string[]) {
    const defaultItem = { english_name: '', image_search_query: '', allergens: [], calorie_min: null, calorie_max: null, meat_ratio: 0, seafood_ratio: 0, vegetable_ratio: 0, spicy_ratio: 0, salty_ratio: 0, sweet_ratio: 0 };
    const defaults = menuNames.map(() => ({ ...defaultItem }));

    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-Lite', 'gemini-3-flash', 'gemini-3.1-flash-Lite'];
    const nameList = menuNames.map((n, i) => `${i + 1}. ${n}`).join('\n');
    const prompt = buildAnalyzePrompt(nameList);

    for (const modelName of MODELS) {
      try {
        const model = this.gemini.getGenerativeModel({
          model: modelName,
          generationConfig: { thinkingConfig: { thinkingBudget: 1024 } } as any,
        });
        const tModel = Date.now();
        const result = await model.generateContent(prompt);
        this.logger.log(`[TIMING] Gemini(${modelName}) 응답: ${Date.now() - tModel}ms`);
        const text = result.response.text().trim();
        this.logger.debug(`Gemini(${modelName}) batch response: ${text}`);
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          this.logger.warn(`Gemini(${modelName}) JSON 파싱 실패: ${text}`);
          continue;
        }
        const parsed: any[] = JSON.parse(jsonMatch[0]);
        parsed.forEach((item, i) => {
          this.logger.debug(`[번역] ${menuNames[i]} → ${item?.english_name ?? '(없음)'} | 검색쿼리: ${item?.image_search_query ?? '(없음)'}`);
        });
        return menuNames.map((_, i) => parseLlmItem(parsed[i], defaultItem));
      } catch (err) {
        this.logger.warn(`Gemini(${modelName}) 실패, 다음 모델 시도: ${err}`);
      }
    }

    this.logger.error('모든 Gemini 모델 호출 실패, 기본값 반환');
    return defaults;
  }

  private async fetchAndSaveRecipe(items: { dishId: number; name: string }[]): Promise<void> {
    if (items.length === 0) return;

    const nameList = items.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
    const prompt = buildRecipePrompt(nameList);

    let parsed: any[] = [];
    try {
      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });
      const text = completion.choices[0]?.message?.content?.trim() ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error(`Groq recipe JSON 파싱 실패: ${text}`);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      this.logger.warn(`Groq recipe 실패, Gemini 폴백: ${err}`);
      const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-Lite'];
      for (const modelName of MODELS) {
        try {
          const model = this.gemini.getGenerativeModel({
            model: modelName,
            generationConfig: { thinkingConfig: { thinkingBudget: 512 } } as any,
          });
          const result = await model.generateContent(prompt);
          const text = result.response.text().trim();
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (!jsonMatch) continue;
          parsed = JSON.parse(jsonMatch[0]);
          break;
        } catch (e) {
          this.logger.warn(`Gemini(${modelName}) recipe 실패: ${e}`);
        }
      }
    }

    if (parsed.length === 0) { this.logger.warn('레시피 LLM 응답 없음'); return; }

    await Promise.all(
      items.map(async ({ dishId }, i) => {
        const item = parsed[i];
        if (!item) return;
        const description = typeof item.description === 'string' ? item.description : null;
        const ingredients = Array.isArray(item.ingredients) ? item.ingredients.map(String) : [];
        await this.dishRepo.update(dishId, { description, ingredients });
        this.logger.log(`레시피 저장 완료 [dish ${dishId}]`);
      }),
    );
  }

  private async fetchAndUploadImage(dishName: string, dishId: number): Promise<void> {
    if (!this.pexelsApiKey || !this.s3Bucket) return;

    const searchQuery = dishName;
    this.logger.debug(`[이미지 검색] query: "${searchQuery}"`);

    const searchRes = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: searchQuery, per_page: 1 },
      headers: { Authorization: this.pexelsApiKey },
      timeout: 10000,
    });
    const imageUrl: string | undefined = searchRes.data?.photos?.[0]?.src?.medium;
    if (!imageUrl) { this.logger.warn(`이미지 검색 결과 없음: ${dishName}`); return; }

    this.logger.debug(`[이미지 선택] dish ${dishId}: ${imageUrl}`);

    const imageRes = await axios.get<Buffer>(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const contentType: string = imageRes.headers['content-type'] ?? 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    const key = `dishes/${dishId}.${ext}`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.s3Bucket,
      Key: key,
      Body: Buffer.from(imageRes.data),
      ContentType: contentType,
    }));

    const region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    const s3Url = `https://${this.s3Bucket}.s3.${region}.amazonaws.com/${key}`;
    await this.dishRepo.update(dishId, { image_url: s3Url });
    this.logger.log(`이미지 저장 완료 [dish ${dishId}]: ${s3Url}`);
  }
}
