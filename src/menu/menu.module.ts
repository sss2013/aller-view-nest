import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { Dish } from './entities/dish.entity';
import { DishAllergenCache } from './entities/dish-allergen-cache.entity';
import { DishCategoryVector } from './entities/dish-category-vector.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dish, DishAllergenCache, DishCategoryVector]),
    AuthModule,
  ],
  controllers: [MenuController],
  providers: [MenuService],
})
export class MenuModule {}
