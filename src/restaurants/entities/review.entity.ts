import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Restaurant } from './restaurant.entity';
import { ReviewMenuItem } from './review-menu-item.entity';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  user_id!: number;

  @Column()
  restaurant_id!: number;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  allergies!: string[];

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => Restaurant, (restaurant) => restaurant.reviews)
  @JoinColumn({ name: 'restaurant_id' })
  restaurant!: Restaurant;

  @OneToMany(() => ReviewMenuItem, (item) => item.review)
  menuItems!: ReviewMenuItem[];
}
