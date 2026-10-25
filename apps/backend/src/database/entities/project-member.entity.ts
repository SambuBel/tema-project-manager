import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';
import { ProjectMemberRole } from '../enums';

/**
 * Rol dentro de un proyecto (project_role: COLLABORATOR u OBSERVER), que es distinto
 * del rol GLOBAL en user_roles (ej: RoleName.COLLABORATOR). A proposito NO admite
 * PROJECT_LEADER: el lider de un proyecto es siempre project.leaderId (ver
 * ProjectEntity), nunca una fila acá — evita una segunda fuente de verdad del líder.
 * Un usuario puede tener RoleName.PROJECT_LEADER globalmente y aun asi figurar acá
 * como COLLABORATOR/OBSERVER de un proyecto puntual que no lidera.
 *
 * SOLO DATOS ORGANIZATIVOS (RN-25): el perfil de recurso, las horas estimadas, la tarifa y el costo viven en
 * `project_member_allocations` (versionadas e inmutables). Esta entidad no tiene ninguna columna económica, de modo que
 * ninguna consulta de equipo (GET /projects/:id/members, que ve todo el equipo) puede filtrar información económica.
 *
 * Re-alta (PENDIENTE de TEMA): reactivar a un miembro dado de baja reutiliza esta fila, así que conserva su asignación
 * económica vigente anterior (sin refrescar tarifa). Si TEMA decide que una re-alta es una asignación nueva, se implementa aparte.
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
  @JoinColumn({ name: 'project_id', foreignKeyConstraintName: 'fk_pm_project' })
  project!: ProjectEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_pm_user' })
  user!: UserEntity;

  @Column({
    name: 'project_role',
    type: 'enum',
    enum: ProjectMemberRole,
    enumName: 'project_member_role_enum',
  })
  projectRole!: ProjectMemberRole;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt!: Date;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;
}
