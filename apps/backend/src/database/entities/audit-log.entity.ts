import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './user.entity';
import { AuditEntityType, AuditOrigin } from '../enums';

/**
 * Historial general de cambios sobre TASK/PROJECT/BUDGET/COST/RESOURCE_PROFILE.
 * Sin FK polimorfica sobre entity_id a proposito: entity_id puede apuntar a distintas
 * tablas segun entity_type, algo que Postgres no puede expresar con una FK simple.
 * La integridad de ese puntero queda a cargo del backend.
 *
 * `action` es texto libre (varchar(50)), sin enum: convención "<ENTIDAD>_<VERBO>" (ej. BUDGET_CREATED), como
 * ProjectActivityAction (TASK_CREATED...).
 *
 * RN-25 / DATOS ECONÓMICOS: las filas de tipo BUDGET, COST y RESOURCE_PROFILE (tarifas por hora) llevan importes en old_values/new_values. NINGÚN endpoint
 * ni pantalla puede leerlas sin exigir `PermissionsService.canViewEconomicData` sobre el proyecto: COLLABORATOR y
 * OBSERVER no pueden recibir información económica por ninguna vía. Por eso estos eventos se registran acá y NO en
 * `project_activities`, cuyo feed ven todos los miembros del proyecto.
 */
@Entity('audit_logs')
@Index('ix_audit_logs_entity', ['entityType', 'entityId'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'entity_type', type: 'enum', enum: AuditEntityType, enumName: 'audit_entity_type_enum' })
  entityType!: AuditEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ name: 'action', type: 'varchar', length: 50 })
  action!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity | null;

  @Column({ name: 'origin', type: 'enum', enum: AuditOrigin, enumName: 'audit_origin_enum', default: AuditOrigin.SYSTEM })
  origin!: AuditOrigin;

  @Column({ name: 'old_values', type: 'jsonb', nullable: true })
  oldValues!: Record<string, unknown> | null;

  @Column({ name: 'new_values', type: 'jsonb', nullable: true })
  newValues!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
