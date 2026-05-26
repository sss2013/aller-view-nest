import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('dish_category_vectors')
export class DishCategoryVector {
  @PrimaryColumn()
  dish_id!: number;

  @Column({ type: 'numeric', default: 0 })
  meat_ratio!: number;

  @Column({ type: 'numeric', default: 0 })
  seafood_ratio!: number;

  @Column({ type: 'numeric', default: 0 })
  vegetable_ratio!: number;

  @Column({ type: 'numeric', default: 0 })
  spicy_ratio!: number;

  @Column({ type: 'numeric', default: 0 })
  salty_ratio!: number;

  @Column({ type: 'numeric', default: 0 })
  sweet_ratio!: number;
}
