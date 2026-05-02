import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';
import { Allergy } from './allergy.entity';

@Entity('user_allergies')
export class UserAllergy {
  @PrimaryColumn()
  user_id!: number;

  @PrimaryColumn()
  allergy_id!: number;

  @ManyToOne(() => User, (user) => user.userAllergies)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Allergy)
  @JoinColumn({ name: 'allergy_id' })
  allergy!: Allergy;
}
