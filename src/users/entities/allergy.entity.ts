import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('allergies')
export class Allergy {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 50, unique: true })
  name!: string;
}
