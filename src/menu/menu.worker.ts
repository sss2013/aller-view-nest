import { Inject, Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Redis } from '@upstash/redis';
import { UPSTASH_REDIS } from '../upstash.module';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Dish } from './entities/dish.entity';
import { DishAllergenCache } from './entities/dish-allergen-cache.entity';
import { DishCategoryVector } from './entities/dish-category-vector.entity';
import { Allergy } from '../users/entities/allergy.entity';
import { AnalyzeMenuDto } from './dto/analyze-menu.dto';

interface JobMessage {
  job_id: string;
  dto: AnalyzeMenuDto;
}

@Injectable()
export class MenuWorker {
  private readonly logger = new Logger(MenuWorker.name);
  private readonly gemini: GoogleGenerativeAI;
  private readonly s3: S3Client;
  private readonly s3Bucket: string;
  private readonly pexelsApiKey: string;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(UPSTASH_REDIS) private readonly redis: Redis,
    @InjectRepository(Dish) private readonly dishRepo: Repository<Dish>,
    @InjectRepository(DishAllergenCache) private readonly allergenCacheRepo: Repository<DishAllergenCache>,
    @InjectRepository(DishCategoryVector) private readonly categoryVectorRepo: Repository<DishCategoryVector>,
    @InjectRepository(Allergy) private readonly allergyRepo: Repository<Allergy>,
    private readonly configService: ConfigService,
  ) {
    this.gemini = new GoogleGenerativeAI(this.configService.get<string>('GEMINI_API_KEY') ?? '');
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

  @RabbitSubscribe({
    exchange: 'menu',
    routingKey: 'analyze',
    queue: 'menu_analyze',
  })
  async handleAnalyze(msg: JobMessage) {
    const { job_id, dto } = msg;
    const jobStart = Date.now();
    this.logger.log(`Processing job ${job_id}`);

    try {
      // 1. L1/L2 조회 → 히트/미스 분류
      const t0 = Date.now();
      const dishDataMap = new Map<string, { dish_id: number; allergy_ids: number[] }>();
      type MissItem = { item_id: string; normalized_text: string; cacheKey: string };
      const missItems: MissItem[] = [];

      for (const item of dto.menu_items) {
        const cacheKey = `menu:dish:${item.normalized_text.replace(/\s+/g, '').toLowerCase()}`;
        const cached = await this.cache.get<{ dish_id: number; allergy_ids: number[] }>(cacheKey);
        if (cached) { dishDataMap.set(item.item_id, cached); continue; }

        const nameNoSpace = item.normalized_text.replace(/\s+/g, '');
        const existingDish = await this.dishRepo
          .createQueryBuilder('d')
          .where("REPLACE(d.korean_name, ' ', '') ILIKE :name", { name: nameNoSpace })
          .getOne();

        if (existingDish) {
          const allergenCache = await this.allergenCacheRepo.findOne({ where: { dish_id: existingDish.id } });
          const entry = { dish_id: existingDish.id, allergy_ids: allergenCache?.allergy_ids ?? [] };
          await this.cache.set(cacheKey, entry, 86400 * 1000);
          dishDataMap.set(item.item_id, entry);
          continue;
        }

        missItems.push({ item_id: item.item_id, normalized_text: item.normalized_text, cacheKey });
      }
      this.logger.log(`[TIMING] L1/L2 조회: ${Date.now() - t0}ms (miss ${missItems.length}/${dto.menu_items.length})`);

      // 2. 미스 항목 일괄 Gemini 호출 (1회)
      if (missItems.length > 0) {
        const { In: InAllergy } = await import('typeorm');

        const tGemini = Date.now();
        const analyses = await this.analyzeBatchWithGemini(missItems.map((m) => m.normalized_text));
        this.logger.log(`[TIMING] Gemini 배치 호출: ${Date.now() - tGemini}ms (${missItems.length}개)`);

        const tDb = Date.now();
        for (let i = 0; i < missItems.length; i++) {
          const { item_id, normalized_text, cacheKey } = missItems[i];
          const analysis = analyses[i];

          const allergyRecords = analysis.allergens.length > 0
            ? await this.allergyRepo.find({ where: { name: InAllergy(analysis.allergens) } })
            : [];
          const allergyIds = allergyRecords.map((a) => a.id);

          const newDish = await this.dishRepo.save({
            korean_name: normalized_text,
            calorie_min: analysis.calorie_min,
            calorie_max: analysis.calorie_max,
          });

          await this.allergenCacheRepo.save({ dish_id: newDish.id, allergy_ids: allergyIds });

          const ratioSum = analysis.meat_ratio + analysis.seafood_ratio + analysis.vegetable_ratio;
          const meat_ratio = ratioSum > 0 ? analysis.meat_ratio / ratioSum : 0;
          const seafood_ratio = ratioSum > 0 ? analysis.seafood_ratio / ratioSum : 0;
          const vegetable_ratio = Math.max(0, 1 - meat_ratio - seafood_ratio);
          await this.categoryVectorRepo.save({ dish_id: newDish.id, meat_ratio, seafood_ratio, vegetable_ratio });

          // fire-and-forget: 추론 결과와 무관하게 백그라운드에서 이미지 업로드
          const searchName = analysis.english_name || normalized_text;
          this.fetchAndUploadImage(searchName, newDish.id).catch((err) =>
            this.logger.warn(`이미지 업로드 실패 [dish ${newDish.id}]: ${err}`),
          );

          const entry = { dish_id: newDish.id, allergy_ids: allergyIds };
          await this.cache.set(cacheKey, entry, 86400 * 1000);
          dishDataMap.set(item_id, entry);
        }
        this.logger.log(`[TIMING] DB 저장: ${Date.now() - tDb}ms`);
      }

      // 2. 알레르기 이름 → ID 조회
      const { In } = await import('typeorm');
      const allergyRecords = await this.allergyRepo.find({
        where: { name: In(dto.user_allergies) },
      });
      const userAllergyIds = allergyRecords.map((a) => a.id);

      // 3. 결과 구성
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

      // 4. 추천 (safe 항목 카테고리 벡터 기반)
      const safeDishIds = menu_results
        .filter((r) => r.risk_level === 'safe')
        .map((r) => r.dish_id as number);

      const recommendations: { item_id: string; korean_name: string | null }[] = [];

      if (safeDishIds.length > 0) {
        const { In: InOp } = await import('typeorm');
        const vectors = await this.categoryVectorRepo.find({ where: { dish_id: InOp(safeDishIds) } });
        const dishes = await this.dishRepo.find({ where: { id: InOp(safeDishIds) } });
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

      // 5. job 완료 저장
      await this.redis.set(`menu:job:${job_id}`, { status: 'done', result: { menu_results, recommendations } }, { ex: 3600 });
      this.logger.log(`Job ${job_id} completed — 총 ${Date.now() - jobStart}ms`);
    } catch (err) {
      this.logger.error(`Job ${job_id} failed: ${err}`);
      await this.redis.set(`menu:job:${job_id}`, { status: 'failed', error: String(err) }, { ex: 3600 });
    }
  }

  private async analyzeBatchWithGemini(menuNames: string[]): Promise<Array<{
    english_name: string;
    allergens: string[];
    calorie_min: number | null;
    calorie_max: number | null;
    meat_ratio: number;
    seafood_ratio: number;
    vegetable_ratio: number;
  }>> {
    const defaultItem = { english_name: '', allergens: [], calorie_min: null, calorie_max: null, meat_ratio: 0, seafood_ratio: 0, vegetable_ratio: 0 };
    const defaults = menuNames.map(() => ({ ...defaultItem }));

    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-Lite', 'gemini-3-flash', 'gemini-3.1-flash-Lite'];
    const nameList = menuNames.map((n, i) => `${i + 1}. ${n}`).join('\n');
    const prompt = `아래 음식 목록을 분석해줘.

${nameList}

각 음식에 대해:
1. english_name: 음식의 영문명 (이미지 검색용, 간결하게)
2. 알레르겐: 반드시 아래 목록에서만 선택 (없으면 빈 배열)
   계란, 우유, 메밀, 땅콩, 대두, 밀, 고등어, 게, 새우, 돼지고기, 복숭아, 토마토, 아황산류, 호두, 닭고기, 쇠고기, 오징어, 굴, 전복, 홍합, 잣, 추출성분
3. 칼로리: 1인분 기준 최소/최대 추정 (kcal 정수)
4. 카테고리 비율: meat_ratio(육류), seafood_ratio(해산물), vegetable_ratio(채소/기타) — 합이 1.0

JSON 배열 형식으로만 응답 (순서 유지):
[
  { "name": "음식명", "english_name": "Pad Thai", "allergens": ["새우"], "calorie_min": 400, "calorie_max": 600, "meat_ratio": 0.30, "seafood_ratio": 0.20, "vegetable_ratio": 0.50 }
]`;

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
        return menuNames.map((_, i) => {
          const item = parsed[i];
          if (!item) return { ...defaultItem };
          return {
            english_name: typeof item.english_name === 'string' ? item.english_name : '',
            allergens: Array.isArray(item.allergens) ? item.allergens : [],
            calorie_min: typeof item.calorie_min === 'number' ? item.calorie_min : null,
            calorie_max: typeof item.calorie_max === 'number' ? item.calorie_max : null,
            meat_ratio: typeof item.meat_ratio === 'number' ? item.meat_ratio : 0,
            seafood_ratio: typeof item.seafood_ratio === 'number' ? item.seafood_ratio : 0,
            vegetable_ratio: typeof item.vegetable_ratio === 'number' ? item.vegetable_ratio : 0,
          };
        });
      } catch (err) {
        this.logger.warn(`Gemini(${modelName}) 실패, 다음 모델 시도: ${err}`);
      }
    }

    this.logger.error('모든 Gemini 모델 호출 실패, 기본값 반환');
    return defaults;
  }

  private async fetchAndUploadImage(dishName: string, dishId: number): Promise<void> {
    if (!this.pexelsApiKey || !this.s3Bucket) return;

    // 1. Pexels에서 이미지 URL 검색
    const searchRes = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: `${dishName} food`, per_page: 1 },
      headers: { Authorization: this.pexelsApiKey },
      timeout: 10000,
    });
    const imageUrl: string | undefined = searchRes.data?.photos?.[0]?.src?.large;
    if (!imageUrl) { this.logger.warn(`이미지 검색 결과 없음: ${dishName}`); return; }

    // 2. 이미지 다운로드
    const imageRes = await axios.get<Buffer>(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const contentType: string = imageRes.headers['content-type'] ?? 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    // 3. S3 업로드
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
