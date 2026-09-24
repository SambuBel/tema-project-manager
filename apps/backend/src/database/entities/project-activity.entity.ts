import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';
import { ProjectActivityAction, ProjectActivityEntityType } from '../enums';

@Entity('project_activities')
export class ProjectActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_project_activities_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_id' })
  actor!: UserEntity;

  @Column({
    name: 'action_type',
    type: 'enum',
    enum: ProjectActivityAction,
    enumName: 'project_activity_action_enum',
  })
  actionType!: ProjectActivityAction;

  @Column({
    name: 'entity_type',
    type: 'enum',
    enum: ProjectActivityEntityType,
    enumName: 'project_activity_entity_type_enum',
  })
  entityType!: ProjectActivityEntityType;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: any;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
