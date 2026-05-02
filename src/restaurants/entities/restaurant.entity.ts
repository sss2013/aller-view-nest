import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Review } from './review.entity';

@Entity('restaurants')
export class Restaurant {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  place_id!: string;

  @Column('text')
  name!: string;

  @Column('text')
  address!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  business_type!: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude!: number | null;

  @OneToMany(() => Review, (review) => review.restaurant)
  reviews!: Review[];
}
