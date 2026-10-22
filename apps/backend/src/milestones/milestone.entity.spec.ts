import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { MilestoneEntity } from './milestone.entity';
import { TaskEntity } from '../tasks/task.entity';

/**
 * Pruebas unitarias de metadata para MilestoneEntity y TaskEntity (asociación).
 * Valida la definición del modelo TypeORM sin necesidad de conectarse a la base de datos:
 * - Nombres de tablas y columnas
 * - Tipos de datos y nulabilidad
 * - Claves primarias, foráneas y acciones referenciales (ON DELETE)
 * - Índices y restricciones CHECK
 * - Soporte para baja lógica (@DeleteDateColumn) y finalización manual
 */
describe('MilestoneEntity - metadata y relaciones', () => {
  const ds = new DataSource({
    type: 'postgres',
    entities: [__dirname + '/../../**/*.entity.ts'],
  });

  let milestoneMeta: ReturnType<DataSource['getMetadata']>;
  let taskMeta: ReturnType<DataSource['getMetadata']>;

  beforeAll(async () => {
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    milestoneMeta = ds.getMetadata(MilestoneEntity);
    taskMeta = ds.getMetadata(TaskEntity);
  });

  const milestoneCol = (name: string) => milestoneMeta.columns.find((c) => c.databaseName === name)!;
  const taskCol = (name: string) => taskMeta.columns.find((c) => c.databaseName === name)!;

  describe('MilestoneEntity schema', () => {
    it('mapea la tabla milestones', () => {
      expect(milestoneMeta.tableName).toBe('milestones');
    });

    it('tiene clave primaria UUID generada automáticamente', () => {
      const id = milestoneCol('id');
      expect(id.isPrimary).toBe(true);
      expect(id.type).toBe('uuid');
    });

    it('project_id es UUID NOT NULL', () => {
      const col = milestoneCol('project_id');
      expect(col.type).toBe('uuid');
      expect(col.isNullable).toBe(false);
    });

    it('name es varchar(200) NOT NULL', () => {
      const col = milestoneCol('name');
      expect(col.type).toBe('varchar');
      expect(col.length).toBe('200');
      expect(col.isNullable).toBe(false);
    });

    it('description es text nullable', () => {
      const col = milestoneCol('description');
      expect(col.type).toBe('text');
      expect(col.isNullable).toBe(true);
    });

    it('due_date es date NOT NULL (fecha objetivo)', () => {
      const col = milestoneCol('due_date');
      expect(col.type).toBe('date');
      expect(col.isNullable).toBe(false);
    });

    it('completed_at y completed_by soportan finalización manual (D4)', () => {
      const completedAt = milestoneCol('completed_at');
      expect(completedAt.type).toBe('timestamptz');
      expect(completedAt.isNullable).toBe(true);

      const completedBy = milestoneCol('completed_by');
      expect(completedBy.type).toBe('uuid');
      expect(completedBy.isNullable).toBe(true);
    });

    it('created_by es UUID NOT NULL', () => {
      const col = milestoneCol('created_by');
      expect(col.type).toBe('uuid');
      expect(col.isNullable).toBe(false);
    });

    it('created_at y updated_at son timestamptz NOT NULL', () => {
      const createdAt = milestoneCol('created_at');
      expect(createdAt.type).toBe('timestamptz');
      expect(createdAt.isNullable).toBe(false);

      const updatedAt = milestoneCol('updated_at');
      expect(updatedAt.type).toBe('timestamptz');
      expect(updatedAt.isNullable).toBe(false);
    });

    it('deleted_at implementa baja lógica (D10) con DeleteDateColumn', () => {
      const deletedAt = milestoneCol('deleted_at');
      expect(deletedAt.type).toBe('timestamptz');
      expect(deletedAt.isNullable).toBe(true);
      expect(milestoneMeta.deleteDateColumn).toBeDefined();
      expect(milestoneMeta.deleteDateColumn?.databaseName).toBe('deleted_at');
    });

    it('no persiste columnas calculadas redundantes de progreso (D4)', () => {
      const names = milestoneMeta.columns.map((c) => c.databaseName);
      expect(names).not.toContain('progress');
      expect(names).not.toContain('percentage');
      expect(names).not.toContain('status');
    });

    it('contiene las 11 columnas canónicas esperadas', () => {
      const names = milestoneMeta.columns.map((c) => c.databaseName).sort();
      expect(names).toEqual([
        'completed_at',
        'completed_by',
        'created_at',
        'created_by',
        'deleted_at',
        'description',
        'due_date',
        'id',
        'name',
        'project_id',
        'updated_at',
      ]);
    });

    it('define la restricción CHECK ck_milestones_name_not_empty', () => {
      const check = milestoneMeta.checks.find((c) => c.name === 'ck_milestones_name_not_empty');
      expect(check).toBeDefined();
      expect(check?.expression).toContain('btrim');
    });

    it('define las claves foráneas con las acciones ON DELETE requeridas', () => {
      const fks = Object.fromEntries(
        milestoneMeta.foreignKeys.map((fk) => [fk.name, [fk.columnNames.join(','), fk.onDelete]]),
      );
      expect(fks).toEqual({
        fk_milestones_project: ['project_id', 'CASCADE'],
        fk_milestones_created_by: ['created_by', 'RESTRICT'],
        fk_milestones_completed_by: ['completed_by', 'SET NULL'],
      });
    });

    it('define los índices esperados incluyendo el índice único parcial (D5 + D10)', () => {
      const ixProjectId = milestoneMeta.indices.find((i) => i.name === 'ix_milestones_project_id');
      expect(ixProjectId).toBeDefined();
      expect(ixProjectId?.columns.map((c) => c.databaseName)).toEqual(['project_id']);

      const ixProjectDueDate = milestoneMeta.indices.find((i) => i.name === 'ix_milestones_project_due_date');
      expect(ixProjectDueDate).toBeDefined();
      expect(ixProjectDueDate?.columns.map((c) => c.databaseName)).toEqual(['project_id', 'due_date']);

      const uqNameActive = milestoneMeta.indices.find((i) => i.name === 'uq_milestones_project_name_active');
      expect(uqNameActive).toBeDefined();
      expect(uqNameActive?.isUnique).toBe(true);
      expect(uqNameActive?.columns.map((c) => c.databaseName)).toEqual(['project_id', 'name']);
      expect(uqNameActive?.where).toBe('"deleted_at" IS NULL');
    });

    it('define la relación 1:N hacia TaskEntity', () => {
      const relation = milestoneMeta.relations.find((r) => r.propertyName === 'tasks');
      expect(relation).toBeDefined();
      expect(relation?.isOneToMany).toBe(true);
      expect(relation?.inverseEntityMetadata.target).toBe(TaskEntity);
    });
  });

  describe('TaskEntity asociación opcional con Milestone', () => {
    it('incorpora la columna milestone_id como UUID nullable', () => {
      const col = taskCol('milestone_id');
      expect(col).toBeDefined();
      expect(col.type).toBe('uuid');
      expect(col.isNullable).toBe(true);
    });

    it('define el índice ix_tasks_milestone_id', () => {
      const index = taskMeta.indices.find((i) => i.name === 'ix_tasks_milestone_id');
      expect(index).toBeDefined();
      expect(index?.columns.map((c) => c.databaseName)).toEqual(['milestone_id']);
    });

    it('define la relación ManyToOne hacia MilestoneEntity con ON DELETE SET NULL', () => {
      const relation = taskMeta.relations.find((r) => r.propertyName === 'milestone');
      expect(relation).toBeDefined();
      expect(relation?.isManyToOne).toBe(true);
      expect(relation?.inverseEntityMetadata.target).toBe(MilestoneEntity);

      const fk = taskMeta.foreignKeys.find((f) => f.name === 'fk_tasks_milestone');
      expect(fk).toBeDefined();
      expect(fk?.columnNames).toEqual(['milestone_id']);
      expect(fk?.onDelete).toBe('SET NULL');
    });
  });
});
