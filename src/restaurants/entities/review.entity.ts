import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Restaurant } from './restaurant.entity';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  user_id!: number;

  @Column()
  restaurant_id!: number;

  @Column()
  positive!: boolean;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => Restaurant, (restaurant) => restaurant.reviews)
  @JoinColumn({ name: 'restaurant_id' })
  restaurant!: Restaurant;
}
