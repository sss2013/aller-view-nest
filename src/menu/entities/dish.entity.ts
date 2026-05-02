import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dishes')
export class Dish {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', nullable: true })
  english_name!: string | null;

  @Column({ type: 'varchar', nullable: true })
  korean_name!: string | null;

  @Column({ type: 'text', nullable: true })
  image_url!: string | null;

  @Column({ type: 'int', nullable: true })
  calorie_min!: number | null;

  @Column({ type: 'int', nullable: true })
  calorie_max!: number | null;
}
