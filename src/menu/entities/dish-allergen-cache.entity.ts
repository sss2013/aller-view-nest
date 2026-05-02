import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('dish_allergen_cache')
export class DishAllergenCache {
  @PrimaryColumn()
  dish_id!: number;

  @Column({ type: 'integer', array: true })
  allergy_ids!: number[];
}
