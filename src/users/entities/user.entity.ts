import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserAllergy } from './user-allergy.entity';
import { UserPreferredIngredient } from './user-preferred-ingredient.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  supabase_uid!: string;

  @Column({ length: 50 })
  username!: string;

  @Column({ length: 100, unique: true })
  email!: string;

  @CreateDateColumn()
  created_at!: Date;

  @OneToMany(() => UserAllergy, (ua) => ua.user)
  userAllergies!: UserAllergy[];

  @OneToMany(() => UserPreferredIngredient, (upi) => upi.user)
  userPreferredIngredients!: UserPreferredIngredient[];
}
