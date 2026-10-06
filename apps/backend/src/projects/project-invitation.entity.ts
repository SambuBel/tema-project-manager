import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectEntity } from './project.entity';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectMemberRole } from '../database/enums';

@Entity('project_invitations')
export class ProjectInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  email!: string;

  @Column({
    name: 'project_role',
    type: 'enum',
    enum: ProjectMemberRole,
    enumName: 'project_member_role_enum',
  })
  projectRole!: ProjectMemberRole;

  @Column({ name: 'token', type: 'varchar', length: 255, unique: true })
  token!: string;

  @Column({ name: 'invited_by', type: 'uuid' })
  invitedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invited_by' })
  inviter!: UserEntity;

  @Column({ name: 'status', type: 'varchar', length: 50, default: 'PENDING' })
  status!: 'PENDING' | 'ACCEPTED' | 'REVOKED';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
