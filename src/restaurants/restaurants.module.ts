import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { Restaurant } from './entities/restaurant.entity';
import { Review } from './entities/review.entity';
import { ReviewMenuItem } from './entities/review-menu-item.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { UserAllergy } from '../users/entities/user-allergy.entity';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Restaurant, Review, ReviewMenuItem, User, UserAllergy]),
    AuthModule,
  ],
  providers: [RestaurantsService],
  controllers: [RestaurantsController],
})
export class RestaurantsModule {}
