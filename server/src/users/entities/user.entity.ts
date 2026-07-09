import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { Project } from '../../projects/entities/project.entity';

@Entity('users')
export class User {
  @PrimaryColumn()
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  // 'user' | 'admin'. Effective admin can also be granted by the ADMIN_EMAILS env
  // (computed in JwtStrategy), so the first admin needs no DB edit.
  @Column({ default: 'user' })
  role!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => Project, (p) => p.user)
  projects!: Project[];
}
