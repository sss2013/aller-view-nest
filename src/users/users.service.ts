import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Allergy } from './entities/allergy.entity';
import { Ingredient } from './entities/ingredient.entity';
import { UserAllergy } from './entities/user-allergy.entity';
import { UserPreferredIngredient } from './entities/user-preferred-ingredient.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Allergy) private readonly allergyRepo: Repository<Allergy>,
    @InjectRepository(Ingredient) private readonly ingredientRepo: Repository<Ingredient>,
    @InjectRepository(UserAllergy) private readonly userAllergyRepo: Repository<UserAllergy>,
    @InjectRepository(UserPreferredIngredient)
    private readonly userPrefIngredientRepo: Repository<UserPreferredIngredient>,
  ) {}

  async getProfile(supabaseUid: string) {
    const user = await this.userRepo.findOne({
      where: { supabase_uid: supabaseUid },
      relations: [
        'userAllergies',
        'userAllergies.allergy',
        'userPreferredIngredients',
        'userPreferredIngredients.ingredient',
      ],
    });

    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    return {
      id: user.id,
      email: user.email,
      nickname: user.username,
      allergies: user.userAllergies.map((ua) => ua.allergy.name),
      preferred_ingredients: user.userPreferredIngredients.map((upi) => upi.ingredient.name),
      avatar_url: user.avatar_url ?? null,
      created_at: user.created_at,
    };
  }

  async updateProfile(supabaseUid: string, dto: UpdateProfileDto) {
    const user = await this.userRepo.findOne({ where: { supabase_uid: supabaseUid } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    if (dto.nickname !== undefined) user.username = dto.nickname;
    if (dto.avatar_url !== undefined) user.avatar_url = dto.avatar_url;
    if (dto.nickname !== undefined || dto.avatar_url !== undefined) {
      await this.userRepo.save(user);
    }

    if (dto.allergies !== undefined) {
      await this.userAllergyRepo.delete({ user_id: user.id });
      const allergies = await Promise.all(
        dto.allergies.map((name) => this.findOrCreate(this.allergyRepo, name)),
      );
      await Promise.all(
        allergies.map((a) => this.userAllergyRepo.save({ user_id: user.id, allergy_id: a.id })),
      );
    }

    if (dto.preferred_ingredients !== undefined) {
      await this.userPrefIngredientRepo.delete({ user_id: user.id });
      const ingredients = await Promise.all(
        dto.preferred_ingredients.map((name) => this.findOrCreate(this.ingredientRepo, name)),
      );
      await Promise.all(
        ingredients.map((i) =>
          this.userPrefIngredientRepo.save({ user_id: user.id, ingredient_id: i.id }),
        ),
      );
    }

    return this.getProfile(supabaseUid);
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
