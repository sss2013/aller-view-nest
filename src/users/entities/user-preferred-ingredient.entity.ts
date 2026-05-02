import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';
import { Ingredient } from './ingredient.entity';

@Entity('user_preferred_ingredients')
export class UserPreferredIngredient {
  @PrimaryColumn()
  user_id!: number;

  @PrimaryColumn()
  ingredient_id!: number;

  @ManyToOne(() => User, (user) => user.userPreferredIngredients)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Ingredient)
  @JoinColumn({ name: 'ingredient_id' })
  ingredient!: Ingredient;
}
