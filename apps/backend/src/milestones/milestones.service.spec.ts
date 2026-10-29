import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { MilestoneEntity } from './milestone.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { RoleName, TaskPriority, TaskStatus } from '../database/enums';
import { RequestUser } from '../auth/types/authenticated-request-user';

describe('MilestonesService (KAN-243..KAN-245)', () => {
  let service: MilestonesService;
  let milestoneRepo: any;
  let projectRepo: any;
  let taskRepo: any;
  let permissions: any;
  let transactionManagerMock: any;

  const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
  const MILESTONE_ID = '33333333-3333-4333-8333-333333333333';
  const OTHER_MILESTONE_ID = '55555555-5555-4555-8555-555555555555';
  const TASK_ID = '66666666-6666-4666-8666-666666666666';
  const USER_ID = '44444444-4444-4444-8444-444444444444';

  const mockUser = {
    id: USER_ID,
    email: 'leader@example.com',
    name: 'Project Leader',
    roles: [RoleName.PROJECT_LEADER],
  } as RequestUser;

  const mockProject: ProjectEntity = {
    id: PROJECT_ID,
    name: 'Proyecto Principal',
    slug: 'proyecto-principal',
    description: 'Descripción',
    startDate: '2026-01-01',
    estimatedEndDate: '2026-12-31',
    status: 'IN_PROGRESS' as any,
    leaderId: USER_ID,
    leader: {} as any,
    createdBy: USER_ID,
    creator: {} as any,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    archivedAt: null,
    deletedAt: null,
  };

  beforeEach(() => {
    taskRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn(),
    };

    transactionManagerMock = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      getRepository: jest.fn((entity) => (entity === TaskEntity ? taskRepo : milestoneRepo)),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      }),
    };

    milestoneRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ id: MILESTONE_ID, ...dto, createdAt: new Date(), updatedAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id || MILESTONE_ID })),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(async (cb) => cb(transactionManagerMock)),
      },
    };

    projectRepo = {
      findOneBy: jest.fn((where) => (where.id === PROJECT_ID ? Promise.resolve(mockProject) : Promise.resolve(null))),
    };

    permissions = {
      canManageMilestones: jest.fn().mockReturnValue(true),
      canViewProject: jest.fn().mockResolvedValue(true),
    };

    service = new MilestonesService(milestoneRepo, projectRepo, taskRepo, permissions);
  });

  describe('Creación de Milestone (create - KAN-243)', () => {
    it('1. Crea un Milestone correctamente asignando createdBy y datos válidos', async () => {
      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.create(
        PROJECT_ID,
        {
          name: '   Fase 1: Relevamiento   ',
          dueDate: '2026-11-30',
          description: 'Objetivo de la primera fase',
        },
        mockUser,
      );

      expect(projectRepo.findOneBy).toHaveBeenCalledWith({ id: PROJECT_ID });
      expect(permissions.canManageMilestones).toHaveBeenCalledWith(mockUser, mockProject);
      expect(milestoneRepo.create).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        name: 'Fase 1: Relevamiento',
        description: 'Objetivo de la primera fase',
        dueDate: '2026-11-30',
        createdBy: mockUser.id,
      });
      expect(result.name).toBe('Fase 1: Relevamiento');
      expect(result.progress).toBe(0);
      expect(result.taskCount).toBe(0);
      expect(result.completedTaskCount).toBe(0);
    });

    it('2. Falla con 404 si el proyecto no existe', async () => {
      projectRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create(
          '00000000-0000-0000-0000-000000000000',
          { name: 'Hito', dueDate: '2026-11-30' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('3. Falla con 403 si el usuario no tiene permiso canManageMilestones', async () => {
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(
        service.create(
          PROJECT_ID,
          { name: 'Hito No Autorizado', dueDate: '2026-11-30' },
          mockUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4. Falla con 409 ConflictException si ya existe un hito activo con el mismo nombre en el mismo proyecto (case-insensitive)', async () => {
      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-id', name: 'fase 1: relevamiento' }),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      await expect(
        service.create(
          PROJECT_ID,
          { name: 'FASE 1: RELEVAMIENTO', dueDate: '2026-11-30' },
          mockUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('5. Maneja carreras de concurrencia capturando el error 23505 del índice único de PostgreSQL', async () => {
      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      milestoneRepo.save.mockRejectedValue({
        code: '23505',
        constraint: 'uq_milestones_project_name_active',
      });

      await expect(
        service.create(
          PROJECT_ID,
          { name: 'Entrega Final', dueDate: '2026-12-15' },
          mockUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('6. Permite el mismo nombre de Milestone en proyectos diferentes', async () => {
      const mockProjectB = { ...mockProject, id: OTHER_PROJECT_ID };
      projectRepo.findOneBy.mockResolvedValue(mockProjectB);

      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.create(
        OTHER_PROJECT_ID,
        { name: 'Fase 1: Relevamiento', dueDate: '2026-11-30' },
        mockUser,
      );

      expect(result.projectId).toBe(OTHER_PROJECT_ID);
      expect(result.name).toBe('Fase 1: Relevamiento');
    });
  });

  describe('Consulta y Listado (findAllByProject - KAN-243)', () => {
    it('7. Retorna lista vacía si el proyecto no tiene hitos', async () => {
      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.findAllByProject(PROJECT_ID, {}, mockUser);
      expect(result).toEqual([]);
      expect(taskRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('8. Falla con 403 si el usuario no tiene permiso canViewProject', async () => {
      permissions.canViewProject.mockResolvedValue(false);

      await expect(service.findAllByProject(PROJECT_ID, {}, mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('9. Calcula correctamente progreso, contadores agregados sin N+1 y excluye tareas archivadas', async () => {
      const milestone1: Partial<MilestoneEntity> = {
        id: 'm1',
        projectId: PROJECT_ID,
        name: 'Hito 1',
        dueDate: '2026-11-01',
        completedAt: null,
        completedById: null,
        createdBy: USER_ID,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };

      const milestone2: Partial<MilestoneEntity> = {
        id: 'm2',
        projectId: PROJECT_ID,
        name: 'Hito 2',
        dueDate: '2026-12-01',
        completedAt: new Date('2026-11-20'),
        completedById: USER_ID,
        createdBy: USER_ID,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      };

      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([milestone1, milestone2]),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      const taskQbMock: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { milestoneId: 'm1', taskCount: '4', completedTaskCount: '3' },
          { milestoneId: 'm2', taskCount: '2', completedTaskCount: '2' },
        ]),
      };
      taskRepo.createQueryBuilder.mockReturnValue(taskQbMock);

      const list = await service.findAllByProject(PROJECT_ID, {}, mockUser);

      expect(list.length).toBe(2);
      expect(list[0]).toMatchObject({
        id: 'm1',
        taskCount: 4,
        completedTaskCount: 3,
        progress: 75,
      });
      expect(list[1]).toMatchObject({
        id: 'm2',
        taskCount: 2,
        completedTaskCount: 2,
        progress: 100,
        status: 'COMPLETED',
      });

      expect(taskRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('10. Filtra próximos hitos cuando upcoming=true excluyendo completados y pasados', async () => {
      const qbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      await service.findAllByProject(PROJECT_ID, { upcoming: true, limit: 3 }, mockUser);

      expect(qbMock.andWhere).toHaveBeenCalledWith('milestone.completedAt IS NULL');
      expect(qbMock.andWhere).toHaveBeenCalledWith('milestone.dueDate >= :today', expect.any(Object));
      expect(qbMock.take).toHaveBeenCalledWith(3);
    });
  });

  describe('Consulta de Detalle (findOne - KAN-243)', () => {
    it('11. Retorna el detalle con tareas asociadas activas ordenadas', async () => {
      const milestone: Partial<MilestoneEntity> = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        name: 'Hito Detalle',
        description: 'Descripción completa',
        dueDate: '2026-11-15',
        completedAt: null,
        completedById: null,
        createdBy: USER_ID,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        project: mockProject,
        creator: { id: USER_ID, name: 'Líder' } as any,
        completedBy: null,
      };
      milestoneRepo.findOne.mockResolvedValue(milestone);

      const task1: Partial<TaskEntity> = {
        id: 't1',
        title: 'Tarea 1',
        slug: 'tarea-1',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        startDate: '2026-10-01',
        dueDate: '2026-10-15',
        parentTaskId: null,
        assignedTo: { id: 'u1', name: 'Dev 1', email: 'dev1@example.com' } as any,
      };

      const task2: Partial<TaskEntity> = {
        id: 't2',
        title: 'Tarea 2',
        slug: 'tarea-2',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.MEDIUM,
        startDate: '2026-10-10',
        dueDate: '2026-10-25',
        parentTaskId: null,
        assignedTo: null,
      };

      const taskQbMock: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([task1, task2]),
      };
      taskRepo.createQueryBuilder.mockReturnValue(taskQbMock);

      const detail = await service.findOne(MILESTONE_ID, mockUser);

      expect(detail.id).toBe(MILESTONE_ID);
      expect(detail.taskCount).toBe(2);
      expect(detail.completedTaskCount).toBe(1);
      expect(detail.progress).toBe(50);
      expect(detail.tasks.length).toBe(2);
      expect(detail.tasks[1]!.parentTaskId).toBeNull();
    });

    it('12. Falla con 404 si el Milestone no existe o está eliminado lógicamente', async () => {
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(MILESTONE_ID, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('13. Falla con 403 si el usuario no tiene acceso al proyecto del Milestone', async () => {
      const milestone: Partial<MilestoneEntity> = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        project: mockProject,
      };
      milestoneRepo.findOne.mockResolvedValue(milestone);
      permissions.canViewProject.mockResolvedValue(false);

      await expect(service.findOne(MILESTONE_ID, mockUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Edición de Milestone (update - KAN-244)', () => {
    let existingMilestone: MilestoneEntity;

    beforeEach(() => {
      existingMilestone = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        name: 'Hito Inicial',
        description: 'Descripción original',
        dueDate: '2026-11-20',
        completedAt: null,
        completedById: null,
        completedBy: null,
        createdBy: USER_ID,
        creator: { id: USER_ID, name: 'Líder' } as any,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
        project: mockProject,
      };
      milestoneRepo.findOne.mockResolvedValue(existingMilestone);
    });

    it('14. Edita exitosamente nombre, descripción y dueDate', async () => {
      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.update(
        MILESTONE_ID,
        {
          name: 'Hito Actualizado',
          description: 'Nueva descripción',
          dueDate: '2026-12-15',
        },
        mockUser,
      );

      expect(existingMilestone.name).toBe('Hito Actualizado');
      expect(existingMilestone.description).toBe('Nueva descripción');
      expect(existingMilestone.dueDate).toBe('2026-12-15');
      expect(milestoneRepo.save).toHaveBeenCalledWith(existingMilestone);
      expect(result.name).toBe('Hito Actualizado');
    });

    it('15. Permite actualización parcial (solo dueDate)', async () => {
      const result = await service.update(
        MILESTONE_ID,
        { dueDate: '2026-12-25' },
        mockUser,
      );

      expect(existingMilestone.name).toBe('Hito Inicial');
      expect(existingMilestone.dueDate).toBe('2026-12-25');
      expect(milestoneRepo.save).toHaveBeenCalledWith(existingMilestone);
      expect(result.dueDate).toBe('2026-12-25');
    });

    it('16. Falla con 404 si el Milestone no existe o está eliminado', async () => {
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update(MILESTONE_ID, { name: 'Otro' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('17. Falla con 403 si el usuario no tiene permisos canManageMilestones', async () => {
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(
        service.update(MILESTONE_ID, { name: 'Otro' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('18. Falla con 409 si el nuevo nombre colisiona con otro hito activo del proyecto (case-insensitive)', async () => {
      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'other-milestone', name: 'hito existente' }),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      await expect(
        service.update(MILESTONE_ID, { name: 'HITO EXISTENTE' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });

    it('19. Permite conservar el mismo nombre sin disparar conflicto', async () => {
      const result = await service.update(
        MILESTONE_ID,
        { name: 'Hito Inicial', description: 'Cambio solo descripción' },
        mockUser,
      );

      expect(result.name).toBe('Hito Inicial');
      expect(existingMilestone.description).toBe('Cambio solo descripción');
      expect(milestoneRepo.save).toHaveBeenCalled();
    });

    it('20. Maneja carreras de concurrencia en edición capturando error 23505', async () => {
      const qbMock: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      milestoneRepo.createQueryBuilder.mockReturnValue(qbMock);

      milestoneRepo.save.mockRejectedValue({
        code: '23505',
        constraint: 'uq_milestones_project_name_active',
      });

      await expect(
        service.update(MILESTONE_ID, { name: 'Nombre Concurrente' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Eliminación Lógica (remove - KAN-244)', () => {
    let existingMilestone: MilestoneEntity;

    beforeEach(() => {
      existingMilestone = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        name: 'Hito a Eliminar',
        description: null,
        dueDate: '2026-11-20',
        completedAt: null,
        completedById: null,
        completedBy: null,
        createdBy: USER_ID,
        creator: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        project: mockProject,
      };
      milestoneRepo.findOne.mockResolvedValue(existingMilestone);
    });

    it('21. Desasocia tareas (milestoneId = null) y ejecuta softDelete en una transacción', async () => {
      await service.remove(MILESTONE_ID, mockUser);

      expect(milestoneRepo.manager.transaction).toHaveBeenCalled();
      const qb = transactionManagerMock.createQueryBuilder();
      expect(qb.update).toHaveBeenCalledWith(TaskEntity);
      expect(qb.set).toHaveBeenCalledWith({ milestoneId: null });
      expect(qb.where).toHaveBeenCalledWith('milestoneId = :id', { id: MILESTONE_ID });
      expect(transactionManagerMock.softDelete).toHaveBeenCalledWith(MilestoneEntity, MILESTONE_ID);
    });

    it('22. Falla con 404 si el hito no existe o ya está eliminado', async () => {
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(MILESTONE_ID, mockUser)).rejects.toThrow(NotFoundException);
      expect(milestoneRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('23. Falla con 403 si el usuario no tiene permiso canManageMilestones', async () => {
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(service.remove(MILESTONE_ID, mockUser)).rejects.toThrow(ForbiddenException);
      expect(milestoneRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('24. Si falla la baja o desasociación, la transacción propaga el error (rollback)', async () => {
      milestoneRepo.manager.transaction.mockRejectedValue(new Error('DB transaction error'));

      await expect(service.remove(MILESTONE_ID, mockUser)).rejects.toThrow('DB transaction error');
    });
  });

  describe('Finalización Manual y Reapertura (complete & reopen - KAN-244 Fase 4)', () => {
    let activeMilestone: MilestoneEntity;

    beforeEach(() => {
      activeMilestone = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        name: 'Hito en Curso',
        description: null,
        dueDate: '2026-11-20',
        completedAt: null,
        completedById: null,
        completedBy: null,
        createdBy: USER_ID,
        creator: { id: USER_ID, name: 'Líder' } as any,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
        project: mockProject,
      };
      milestoneRepo.findOne.mockResolvedValue(activeMilestone);
    });

    it('25. complete: marca completedAt, completedById y retorna status COMPLETED', async () => {
      const result = await service.complete(MILESTONE_ID, mockUser);

      expect(activeMilestone.completedAt).toBeInstanceOf(Date);
      expect(activeMilestone.completedById).toBe(mockUser.id);
      expect(milestoneRepo.save).toHaveBeenCalledWith(activeMilestone);
      expect(result.status).toBe('COMPLETED');
    });

    it('26. complete: es idempotente si ya estaba completado (no sobreescribe timestamp)', async () => {
      const originalDate = new Date('2026-10-15T10:00:00.000Z');
      activeMilestone.completedAt = originalDate;
      activeMilestone.completedById = 'other-user';

      const result = await service.complete(MILESTONE_ID, mockUser);

      expect(activeMilestone.completedAt).toBe(originalDate);
      expect(activeMilestone.completedById).toBe('other-user');
      expect(milestoneRepo.save).not.toHaveBeenCalled();
      expect(result.status).toBe('COMPLETED');
    });

    it('27. reopen: limpia completedAt y completedById y retorna status PENDING / OVERDUE', async () => {
      activeMilestone.completedAt = new Date('2026-10-15');
      activeMilestone.completedById = USER_ID;
      activeMilestone.dueDate = '2099-12-31';

      const result = await service.reopen(MILESTONE_ID, mockUser);

      expect(activeMilestone.completedAt).toBeNull();
      expect(activeMilestone.completedById).toBeNull();
      expect(milestoneRepo.save).toHaveBeenCalledWith(activeMilestone);
      expect(result.status).toBe('PENDING');
    });

    it('28. reopen: es idempotente si ya estaba abierto', async () => {
      activeMilestone.completedAt = null;
      activeMilestone.completedById = null;

      const result = await service.reopen(MILESTONE_ID, mockUser);

      expect(activeMilestone.completedAt).toBeNull();
      expect(milestoneRepo.save).not.toHaveBeenCalled();
      expect(result.completedAt).toBeNull();
    });

    it('29. complete / reopen fallan con 404 si el hito no existe o está eliminado', async () => {
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(service.complete(MILESTONE_ID, mockUser)).rejects.toThrow(NotFoundException);
      await expect(service.reopen(MILESTONE_ID, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('30. complete / reopen fallan con 403 si el usuario no tiene permisos', async () => {
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(service.complete(MILESTONE_ID, mockUser)).rejects.toThrow(ForbiddenException);
      await expect(service.reopen(MILESTONE_ID, mockUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Asociación y Desasociación de Tareas (associateTask & disassociateTask - KAN-245)', () => {
    let activeMilestone: MilestoneEntity;
    let targetTask: TaskEntity;

    beforeEach(() => {
      activeMilestone = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        name: 'Hito Sprint 1',
        description: null,
        dueDate: '2026-11-20',
        completedAt: null,
        completedById: null,
        completedBy: null,
        createdBy: USER_ID,
        creator: { id: USER_ID, name: 'Líder' } as any,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
        project: mockProject,
      };

      targetTask = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        title: 'Desarrollar autenticación',
        slug: 'desarrollar-autenticacion',
        description: null,
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        startDate: '2026-10-01',
        dueDate: '2026-10-20',
        parentTaskId: null,
        parentTask: null,
        milestoneId: null,
        milestone: null,
        archivedAt: null,
        createdBy: USER_ID,
        assignedToId: USER_ID,
        assignedTo: { id: USER_ID, name: 'Dev' } as any,
        creator: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        project: mockProject,
      };

      transactionManagerMock.findOne.mockImplementation((entity: any, options: any) => {
        if (entity === MilestoneEntity) {
          const id = options?.where?.id;
          if (id === MILESTONE_ID) return Promise.resolve(activeMilestone);
          if (id === OTHER_MILESTONE_ID) {
            return Promise.resolve({
              id: OTHER_MILESTONE_ID,
              name: 'Hito Alternativo',
              projectId: PROJECT_ID,
              deletedAt: null,
            });
          }
          return Promise.resolve(null);
        }
        if (entity === TaskEntity) {
          const id = options?.where?.id;
          if (id === TASK_ID) return Promise.resolve(targetTask);
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
    });

    it('31. Asociación exitosa: vincula la tarea y actualiza métricas del hito', async () => {
      const result = await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);

      expect(milestoneRepo.manager.transaction).toHaveBeenCalled();
      expect(transactionManagerMock.update).toHaveBeenCalledWith(
        TaskEntity,
        TASK_ID,
        { milestoneId: MILESTONE_ID },
      );
      expect(result.id).toBe(MILESTONE_ID);
    });

    it('32. Repetición de asociación: es idempotente si la tarea ya pertenece a este hito', async () => {
      targetTask.milestoneId = MILESTONE_ID;

      const result = await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
      expect(result.id).toBe(MILESTONE_ID);
    });

    it('33. Falla con 409 ConflictException si la tarea pertenece a otro hito activo (sin reasignación silenciosa)', async () => {
      targetTask.milestoneId = OTHER_MILESTONE_ID;

      await expect(
        service.associateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow(ConflictException);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('34. Falla con 400 BadRequestException si la tarea pertenece a otro proyecto', async () => {
      targetTask.projectId = OTHER_PROJECT_ID;

      await expect(
        service.associateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow(BadRequestException);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('35. Falla con 400 BadRequestException si la tarea está archivada', async () => {
      targetTask.archivedAt = new Date('2026-10-10');

      await expect(
        service.associateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow(BadRequestException);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('36. Falla con 404 si el Milestone no existe o está eliminado lógicamente', async () => {
      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === MilestoneEntity ? Promise.resolve(null) : Promise.resolve(targetTask),
      );

      await expect(
        service.associateTask('00000000-0000-0000-0000-000000000000', TASK_ID, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('37. Falla con 404 si la tarea no existe', async () => {
      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === TaskEntity ? Promise.resolve(null) : Promise.resolve(activeMilestone),
      );

      await expect(
        service.associateTask(MILESTONE_ID, '00000000-0000-0000-0000-000000000000', mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('38. Falla con 403 si el usuario no tiene permisos canManageMilestones al asociar', async () => {
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(
        service.associateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('39. Asocia una subtarea de forma independiente de su tarea principal', async () => {
      targetTask.parentTaskId = 'parent-task-uuid';
      await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);
      expect(transactionManagerMock.update).toHaveBeenCalledWith(TaskEntity, TASK_ID, { milestoneId: MILESTONE_ID });
      expect(transactionManagerMock.update).not.toHaveBeenCalledWith(TaskEntity, 'parent-task-uuid', expect.anything());
    });


    it('mantiene la idempotencia al vincular y desvincular una subtarea', async () => {
      targetTask.parentTaskId = 'parent-task-uuid';
      targetTask.milestoneId = MILESTONE_ID;
      await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);
      expect(transactionManagerMock.update).not.toHaveBeenCalled();
      await service.disassociateTask(MILESTONE_ID, TASK_ID, mockUser);
      expect(transactionManagerMock.update).toHaveBeenCalledWith(TaskEntity, TASK_ID, { milestoneId: null });
      targetTask.milestoneId = null;
      transactionManagerMock.update.mockClear();
      await service.disassociateTask(MILESTONE_ID, TASK_ID, mockUser);
      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it.each(['project', 'archived', 'conflict', 'permission'])('valida las subtareas: %s', async (rule) => {
      targetTask.parentTaskId = 'parent-task-uuid';
      if (rule === 'project') targetTask.projectId = OTHER_PROJECT_ID;
      if (rule === 'archived') targetTask.archivedAt = new Date();
      if (rule === 'conflict') targetTask.milestoneId = OTHER_MILESTONE_ID;
      if (rule === 'permission') permissions.canManageMilestones.mockReturnValue(false);
      await expect(service.associateTask(MILESTONE_ID, TASK_ID, mockUser)).rejects.toThrow(
        rule === 'conflict' ? ConflictException : rule === 'permission' ? ForbiddenException : BadRequestException,
      );
      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('40. Desasociación exitosa: establece milestoneId = null en la tarea y recalcula métricas', async () => {
      targetTask.milestoneId = MILESTONE_ID;

      const result = await service.disassociateTask(MILESTONE_ID, TASK_ID, mockUser);

      expect(milestoneRepo.manager.transaction).toHaveBeenCalled();
      expect(transactionManagerMock.update).toHaveBeenCalledWith(
        TaskEntity,
        TASK_ID,
        { milestoneId: null },
      );
      expect(result.id).toBe(MILESTONE_ID);
    });

    it('41. Repetición de desasociación: es idempotente si la tarea ya no tiene hito', async () => {
      targetTask.milestoneId = null;

      const result = await service.disassociateTask(MILESTONE_ID, TASK_ID, mockUser);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
      expect(result.id).toBe(MILESTONE_ID);
    });

    it('42. Falla con 400 BadRequestException si se intenta desasociar una tarea vinculada a otro hito', async () => {
      targetTask.milestoneId = OTHER_MILESTONE_ID;

      await expect(
        service.disassociateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow(BadRequestException);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('43. Falla con 404 si el Milestone no existe o está eliminado lógicamente al desasociar', async () => {
      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === MilestoneEntity ? Promise.resolve(null) : Promise.resolve(targetTask),
      );

      await expect(
        service.disassociateTask('00000000-0000-0000-0000-000000000000', TASK_ID, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('44. Falla con 404 si la tarea no existe al desasociar', async () => {
      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === TaskEntity ? Promise.resolve(null) : Promise.resolve(activeMilestone),
      );

      await expect(
        service.disassociateTask(MILESTONE_ID, '00000000-0000-0000-0000-000000000000', mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('45. Falla con 403 si el usuario no tiene permisos canManageMilestones al desasociar', async () => {
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(
        service.disassociateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow(ForbiddenException);

      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('46. Preserva el resto de los campos de la tarea (título, fechas, estado) sin alterarlos', async () => {
      const originalTitle = targetTask.title;
      const originalStatus = targetTask.status;
      const originalDueDate = targetTask.dueDate;
      const originalAssignedToId = targetTask.assignedToId;

      await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);

      expect(targetTask.title).toBe(originalTitle);
      expect(targetTask.status).toBe(originalStatus);
      expect(targetTask.dueDate).toBe(originalDueDate);
      expect(targetTask.assignedToId).toBe(originalAssignedToId);
      // Solo milestoneId fue enviado al update
      expect(transactionManagerMock.update).toHaveBeenCalledWith(
        TaskEntity,
        TASK_ID,
        { milestoneId: MILESTONE_ID },
      );
    });

    it('47. Ejecuta rollback si ocurre una falla durante la asociación dentro de la transacción', async () => {
      transactionManagerMock.update.mockRejectedValue(new Error('Falla en la base de datos'));

      await expect(
        service.associateTask(MILESTONE_ID, TASK_ID, mockUser),
      ).rejects.toThrow('Falla en la base de datos');
    });
  });

  // =========================================================================
  // KAN-248, KAN-250 y Auto-completado: Subtareas, Finalización Conjunta y Sincronización
  // =========================================================================
  describe('completeWithTasks y sincronización automática (KAN-248 / KAN-250)', () => {
    let activeMilestone: MilestoneEntity;

    beforeEach(() => {
      activeMilestone = {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        project: mockProject,
        name: 'Hito Cierre Conjunto',
        description: 'Descripción',
        dueDate: '2026-12-01',
        completedAt: null,
        completedById: null,
        completedBy: null,
        createdBy: USER_ID,
        creator: { id: USER_ID, name: 'Leader', email: 'leader@example.com' } as any,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
      };
      transactionManagerMock.save = jest.fn().mockImplementation((_entity, item) => Promise.resolve(item));
      permissions.canEditTask = jest.fn().mockResolvedValue(true);
    });

    it('48. Completa primero las subtareas pendientes de las tareas del hito y luego las tareas principales en una única transacción', async () => {
      const parentTask = {
        id: 'parent-1',
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        parentTaskId: null,
        title: 'Tarea Principal',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        archivedAt: null,
      } as TaskEntity;

      const childTask = {
        id: 'sub-1',
        projectId: PROJECT_ID,
        milestoneId: null,
        parentTaskId: 'parent-1',
        title: 'Subtarea Pendiente',
        status: TaskStatus.PENDING,
        priority: TaskPriority.MEDIUM,
        archivedAt: null,
      } as TaskEntity;

      transactionManagerMock.findOne.mockResolvedValue(activeMilestone);

      let queryCall = 0;
      taskRepo.createQueryBuilder.mockImplementation(() => {
        queryCall++;
        return {
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          setParameter: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(queryCall === 1 ? [parentTask] : [childTask]),
          getRawMany: jest.fn().mockResolvedValue([
            { milestoneId: MILESTONE_ID, taskCount: '1', completedTaskCount: '1' },
          ]),
        };
      });

      const result = await service.completeWithTasks(MILESTONE_ID, mockUser);

      expect(transactionManagerMock.update).toHaveBeenCalledTimes(2);
      // Primera actualización: subtarea; segunda actualización: tarea principal
      expect(transactionManagerMock.update.mock.calls[0]).toEqual([
        TaskEntity,
        'sub-1',
        { status: TaskStatus.COMPLETED },
      ]);
      expect(transactionManagerMock.update.mock.calls[1]).toEqual([
        TaskEntity,
        'parent-1',
        { status: TaskStatus.COMPLETED },
      ]);
      expect(result.status).toBe('COMPLETED');
      expect(result.progress).toBe(100);
      expect(result.completedTaskCount).toBe(1);
    });


    it.each([false, true])('finalización conjunta contempla subtareas explícitas sin repetirlas (padre vinculado: %s)', async (withParent) => {
      const parent = { id: 'parent', parentTaskId: null, status: TaskStatus.IN_PROGRESS } as TaskEntity;
      const child = { id: 'child', parentTaskId: 'parent', milestoneId: MILESTONE_ID, status: TaskStatus.PENDING } as TaskEntity;
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValueOnce(withParent ? [parent, child] : [child]).mockResolvedValueOnce([child]);
      qb.getRawMany.mockResolvedValue([{ milestoneId: MILESTONE_ID, taskCount: '1', completedTaskCount: '1' }]);
      transactionManagerMock.findOne.mockResolvedValue(activeMilestone);
      const result = await service.completeWithTasks(MILESTONE_ID, mockUser);
      expect(transactionManagerMock.update.mock.calls.filter((call: unknown[]) => call[1] === 'child')).toHaveLength(1);
      expect(transactionManagerMock.update.mock.calls.filter((call: unknown[]) => call[1] === 'parent')).toHaveLength(withParent ? 1 : 0);
      expect(result.progress).toBe(100);
    });

    it('49. Rechaza con 403 ForbiddenException sin cambios parciales si el usuario no tiene permiso para completar una subtarea afectada', async () => {
      const parentTask = {
        id: 'parent-1',
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        parentTaskId: null,
        title: 'Tarea Principal',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        archivedAt: null,
      } as TaskEntity;

      const childTask = {
        id: 'sub-restringida',
        projectId: PROJECT_ID,
        milestoneId: null,
        parentTaskId: 'parent-1',
        title: 'Subtarea sin permiso',
        status: TaskStatus.PENDING,
        priority: TaskPriority.LOW,
        archivedAt: null,
      } as TaskEntity;

      transactionManagerMock.findOne.mockResolvedValue(activeMilestone);
      permissions.canEditTask = jest.fn().mockImplementation((_u: any, t: TaskEntity) =>
        Promise.resolve(t.id !== 'sub-restringida'),
      );

      let queryCall = 0;
      taskRepo.createQueryBuilder.mockImplementation(() => {
        queryCall++;
        return {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(queryCall === 1 ? [parentTask] : [childTask]),
        };
      });

      await expect(service.completeWithTasks(MILESTONE_ID, mockUser)).rejects.toThrow(ForbiddenException);
      expect(transactionManagerMock.update).not.toHaveBeenCalled();
      expect(transactionManagerMock.save).not.toHaveBeenCalled();
    });

    it('50. Rechaza con 403 ForbiddenException si el usuario no tiene canManageMilestones', async () => {
      transactionManagerMock.findOne.mockResolvedValue(activeMilestone);
      permissions.canManageMilestones.mockReturnValue(false);

      await expect(service.completeWithTasks(MILESTONE_ID, mockUser)).rejects.toThrow(ForbiddenException);
      expect(transactionManagerMock.update).not.toHaveBeenCalled();
    });

    it('51. Rechaza con 404 NotFoundException si el hito no existe', async () => {
      transactionManagerMock.findOne.mockResolvedValue(null);

      await expect(service.completeWithTasks(MILESTONE_ID, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('52. findOne incluye subtaskCount y completedSubtaskCount y devuelve las subtareas vinculadas sin duplicar el progreso (KAN-248)', async () => {
      milestoneRepo.findOne.mockResolvedValue(activeMilestone);

      taskRepo.createQueryBuilder.mockImplementation(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'parent-1',
            title: 'Tarea Padre',
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.HIGH,
            parentTaskId: null,
            createdBy: USER_ID,
            assignedToId: USER_ID,
          },
          {
            id: 'legacy-subtask-1',
            title: 'Subtarea histórica heredada',
            status: TaskStatus.COMPLETED,
            priority: TaskPriority.LOW,
            parentTaskId: 'parent-1',
            createdBy: USER_ID,
            assignedToId: USER_ID,
          },
        ]),
        getRawMany: jest.fn().mockResolvedValue([
          { parentTaskId: 'parent-1', subtaskCount: '3', completedSubtaskCount: '2' },
        ]),
      }));

      const detail = await service.findOne(MILESTONE_ID, mockUser);
      expect(detail.tasks).toHaveLength(2);
      expect(detail.taskCount).toBe(1);
      expect(detail.completedTaskCount).toBe(0);
      expect(detail.tasks[0]?.id).toBe('parent-1');
      expect(detail.tasks[0]?.subtaskCount).toBe(3);
      expect(detail.tasks[0]?.completedSubtaskCount).toBe(2);
      expect(detail.tasks[0]?.createdBy).toBe(USER_ID);
    });

    it('53. Marca automáticamente el hito como alcanzado (completedAt != null, completedById == null) cuando todas sus tareas principales alcanzan 100%', async () => {
      const completedRootTask = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        milestoneId: null,
        parentTaskId: null,
        title: 'Tarea ya completada',
        status: TaskStatus.COMPLETED,
        archivedAt: null,
      } as TaskEntity;

      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === MilestoneEntity ? Promise.resolve(activeMilestone) : Promise.resolve(completedRootTask),
      );

      taskRepo.createQueryBuilder.mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { milestoneId: MILESTONE_ID, taskCount: '1', completedTaskCount: '1' },
        ]),
      }));

      const summary = await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);

      expect(summary.status).toBe('COMPLETED');
      expect(summary.progress).toBe(100);
      expect(summary.completedAt).toBeTruthy();
      expect(summary.completedById).toBeNull();
    });

    it('54. Si se vincula una nueva tarea pendiente a un hito completado automáticamente, el hito vuelve a Pendiente; si fue completado manualmente, se preserva', async () => {
      const pendingRootTask = {
        id: TASK_ID,
        projectId: PROJECT_ID,
        milestoneId: null,
        parentTaskId: null,
        title: 'Nueva tarea pendiente',
        status: TaskStatus.PENDING,
        archivedAt: null,
      } as TaskEntity;

      // Caso A: Hito completado automáticamente (completedById === null)
      const autoCompletedMilestone: MilestoneEntity = {
        ...activeMilestone,
        completedAt: new Date('2026-10-20T12:00:00Z'),
        completedById: null,
      };

      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === MilestoneEntity ? Promise.resolve(autoCompletedMilestone) : Promise.resolve(pendingRootTask),
      );

      taskRepo.createQueryBuilder.mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { milestoneId: MILESTONE_ID, taskCount: '2', completedTaskCount: '1' },
        ]),
      }));

      const summaryAfterAuto = await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);
      expect(summaryAfterAuto.status).toBe('PENDING');
      expect(summaryAfterAuto.completedAt).toBeNull();
      expect(summaryAfterAuto.progress).toBe(50);

      // Caso B: Hito confirmado manualmente (completedById !== null)
      const manuallyCompletedMilestone: MilestoneEntity = {
        ...activeMilestone,
        completedAt: new Date('2026-10-20T12:00:00Z'),
        completedById: USER_ID,
      };

      transactionManagerMock.findOne.mockImplementation((entity: any) =>
        entity === MilestoneEntity ? Promise.resolve(manuallyCompletedMilestone) : Promise.resolve(pendingRootTask),
      );

      const summaryAfterManual = await service.associateTask(MILESTONE_ID, TASK_ID, mockUser);
      expect(summaryAfterManual.status).toBe('COMPLETED');
      expect(summaryAfterManual.completedAt).toBeTruthy();
      expect(summaryAfterManual.completedById).toBe(USER_ID);
    });
  });
});
