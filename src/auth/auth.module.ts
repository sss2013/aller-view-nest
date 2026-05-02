import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseGuard } from './supabase.guard';
import { User } from '../users/entities/user.entity';
import { Allergy } from '../users/entities/allergy.entity';
import { Ingredient } from '../users/entities/ingredient.entity';
import { UserAllergy } from '../users/entities/user-allergy.entity';
import { UserPreferredIngredient } from '../users/entities/user-preferred-ingredient.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Allergy, Ingredient, UserAllergy, UserPreferredIngredient]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SupabaseGuard],
  exports: [SupabaseGuard, TypeOrmModule],
})
export class AuthModule {}
