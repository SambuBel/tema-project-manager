import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';
import { ResourceProfileEntity } from './resource-profile.entity';
import { ProjectMemberRole } from '../enums';

/**
 * Rol dentro de un proyecto (project_role: COLLABORATOR u OBSERVER), que es distinto
 * del rol GLOBAL en user_roles (ej: RoleName.COLLABORATOR). A proposito NO admite
 * PROJECT_LEADER: el lider de un proyecto es siempre project.leaderId (ver
 * ProjectEntity), nunca una fila acá — evita una segunda fuente de verdad del líder.
 * Un usuario puede tener RoleName.PROJECT_LEADER globalmente y aun asi figurar acá
 * como COLLABORATOR/OBSERVER de un proyecto puntual que no lidera.
 */
@Entity('project_members')
@Index('ux_project_members_project_user', ['projectId', 'userId'], { unique: true })
export class ProjectMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_project_members_project_id')
  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({
    name: 'project_role',
    type: 'enum',
    enum: ProjectMemberRole,
    enumName: 'project_member_role_enum',
  })
  projectRole!: ProjectMemberRole;

  @Column({ name: 'resource_profile_id', type: 'uuid', nullable: true })
  resourceProfileId!: string | null;

  @ManyToOne(() => ResourceProfileEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'resource_profile_id' })
  resourceProfile!: ResourceProfileEntity | null;

  @Column({ name: 'estimated_hours', type: 'numeric', precision: 8, scale: 2, nullable: true })
  estimatedHours!: string | null;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt!: Date;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;
}
