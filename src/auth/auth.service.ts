import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Allergy } from '../users/entities/allergy.entity';
import { Ingredient } from '../users/entities/ingredient.entity';
import { UserAllergy } from '../users/entities/user-allergy.entity';
import { UserPreferredIngredient } from '../users/entities/user-preferred-ingredient.entity';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { SocialCompleteDto } from './dto/social-complete.dto';

@Injectable()
export class AuthService {
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Allergy) private readonly allergyRepo: Repository<Allergy>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
    @InjectRepository(UserAllergy) private readonly userAllergyRepo: Repository<UserAllergy>,
    @InjectRepository(UserPreferredIngredient)
    private readonly userPrefIngredientRepo: Repository<UserPreferredIngredient>,
  ) {
    this.supabase = createClient(
      configService.getOrThrow('SUPABASE_URL'),
      configService.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  async signup(dto: SignupDto) {
    // 1. Supabase에 유저 생성 (이메일 확인 생략)
    const { data: authData, error: authError } =
      await this.supabase.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

    if (authError) {
      if (authError.message.includes('already')) {
        throw new ConflictException('이미 사용 중인 이메일입니다.');
      }
      throw new BadRequestException(authError.message);
    }

    const supabaseUser = authData.user;

    console.log('Supabase user created:', supabaseUser);

    // 2. 로컬 DB에 프로필 저장
    const user = await this.userRepo.save({
      supabase_uid: supabaseUser.id,
      username: dto.nickname,
      email: dto.email,
    });

    // 3. 알레르기/식재료 저장
    await this.saveUserProfile(user.id, dto.allergies, dto.preferred_ingredients);

    return { message: '회원가입이 완료되었습니다.' };
  }

  async login(dto: LoginDto) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    console.log('User logged in:', data.user);
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }

  async refresh(refreshToken: string) {
    const { data, error } = await this.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('유효하지 않은 refresh token입니다.');
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }

  async socialComplete(supabaseUid: string, email: string, dto: SocialCompleteDto) {
    // 이미 프로필이 있으면 그대로 반환
    let user = await this.userRepo.findOne({ where: { supabase_uid: supabaseUid } });

    if (!user) {
      user = await this.userRepo.save({
        supabase_uid: supabaseUid,
        username: dto.nickname,
        email,
      });
      await this.saveUserProfile(user.id, dto.allergies, dto.preferred_ingredients);
    }

    return user;
  }

  private async saveUserProfile(
    userId: number,
    allergyNames: string[],
    ingredientNames: string[],
  ) {
    // findOrCreate allergies
    const allergies = await Promise.all(
      allergyNames.map((name) => this.findOrCreate(this.allergyRepo, name)),
    );

    // findOrCreate ingredients
    const ingredients = await Promise.all(
      ingredientNames.map((name) => this.findOrCreate(this.ingredientRepo, name)),
    );

    // user_allergies 저장
    await Promise.all(
      allergies.map((allergy) =>
        this.userAllergyRepo.save({ user_id: userId, allergy_id: allergy.id }),
      ),
    );

    // user_preferred_ingredients 저장
    await Promise.all(
      ingredients.map((ingredient) =>
        this.userPrefIngredientRepo.save({ user_id: userId, ingredient_id: ingredient.id }),
      ),
    );
  }

  private async findOrCreate(
    repo: Repository<{ id: number; name: string }>,
    name: string,
  ): Promise<{ id: number; name: string }> {
    const existing = await repo.findOne({ where: { name } });
    if (existing) return existing;
    return repo.save({ name });
  }
}
