import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Allergy } from './entities/allergy.entity';
import { Ingredient } from './entities/ingredient.entity';
import { UserAllergy } from './entities/user-allergy.entity';
import { UserPreferredIngredient } from './entities/user-preferred-ingredient.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Allergy, Ingredient, UserAllergy, UserPreferredIngredient]),
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
