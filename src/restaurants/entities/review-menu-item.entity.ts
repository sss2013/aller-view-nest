import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Review } from './review.entity';

@Entity('review_menu_items')
export class ReviewMenuItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  review_id!: number;

  @Column({ type: 'varchar', length: 200 })
  menu_name!: string;

  @Column()
  is_safe!: boolean;

  @ManyToOne(() => Review, (review) => review.menuItems)
  @JoinColumn({ name: 'review_id' })
  review!: Review;
}
