import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TaskEntity } from './task.entity';
import { UserEntity } from './user.entity';
import { DependencyType } from '../enums';

/**
 * Dependencias del Gantt entre tareas.
 * Reglas NO garantizables por SQL simple (validar en backend):
 *  - que predecessor y successor pertenezcan al mismo proyecto;
 *  - ausencia de ciclos en el grafo de dependencias.
 * Si garantizadas por constraint: predecessor != successor (CHECK) y no repetir
 * la misma dependencia exacta (UNIQUE).
 */
@Entity('task_dependencies')
@Index('ux_task_dependencies_unique', ['predecessorTaskId', 'successorTaskId', 'dependencyType'], {
  unique: true,
})
export class TaskDependencyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'predecessor_task_id', type: 'uuid' })
  predecessorTaskId!: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'predecessor_task_id' })
  predecessorTask!: TaskEntity;

  @Column({ name: 'successor_task_id', type: 'uuid' })
  successorTaskId!: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'successor_task_id' })
  successorTask!: TaskEntity;

  @Column({
    name: 'dependency_type',
    type: 'enum',
    enum: DependencyType,
    enumName: 'dependency_type_enum',
    default: DependencyType.FINISH_START,
  })
  dependencyType!: DependencyType;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
