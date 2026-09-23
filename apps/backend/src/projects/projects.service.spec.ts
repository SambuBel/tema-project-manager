import { ProjectActivityService } from './project-activity.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectStatus } from '../database/enums';
import { NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../users/users.service';

describe('ProjectsService - archive', () => {
  let service: ProjectsService;
  let mockRepo: any;
  let mockDataSource: any;

  beforeEach(async () => {
    (globalThis as any).mockRepo = mockRepo = {
      findOneBy: jest.fn(), findById: jest.fn(),
      save: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería archivar un proyecto FINALIZADO con éxito', async () => {
    const project = { id: '1', status: ProjectStatus.FINISHED, archivedAt: null };
    mockRepo.findOneBy.mockResolvedValue(project);
    mockRepo.save.mockImplementation((p: any) => Promise.resolve(p));

    const result = await service.archive('1', { id: 'leader1' } as unknown as UserEntity);
    expect(result.archivedAt).not.toBeNull();
    expect(mockRepo.save).toHaveBeenCalledWith(result);
  });

  it('debería archivar un proyecto CANCELADO con éxito', async () => {
    const project = { id: '1', status: ProjectStatus.CANCELLED, archivedAt: null };
    mockRepo.findOneBy.mockResolvedValue(project);
    mockRepo.save.mockImplementation((p: any) => Promise.resolve(p));

    const result = await service.archive('1', { id: 'leader1' } as unknown as UserEntity);
    expect(result.archivedAt).not.toBeNull();
    expect(mockRepo.save).toHaveBeenCalledWith(result);
  });

  it('debería arrojar NotFoundException si el proyecto no existe', async () => {
    mockRepo.findOneBy.mockResolvedValue(null);
    await expect(service.archive('1', { id: 'leader1' } as unknown as UserEntity)).rejects.toThrow(NotFoundException);
  });

  it.each([ProjectStatus.PLANNED, ProjectStatus.IN_PROGRESS, ProjectStatus.PAUSED])(
    'debería arrojar BadRequestException si el proyecto está en estado %s',
    async (status) => {
      const project = { id: '1', status, archivedAt: null };
      mockRepo.findOneBy.mockResolvedValue(project);

      await expect(service.archive('1', { id: 'leader1' } as unknown as UserEntity)).rejects.toThrow(BadRequestException);
    },
  );

  it('debería devolver el proyecto sin cambios si ya está archivado', async () => {
    const date = new Date();
    const project = { id: '1', status: ProjectStatus.FINISHED, archivedAt: date };
    mockRepo.findOneBy.mockResolvedValue(project);

    const result = await service.archive('1', { id: 'leader1' } as unknown as UserEntity);
    expect(result.archivedAt).toEqual(date);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});

describe('ProjectsService - findAll (archived filters)', () => {
  let service: ProjectsService;
  let mockRepo: any;

  beforeEach(async () => {
    (globalThis as any).mockRepo = mockRepo = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería excluir proyectos archivados por defecto', async () => {
    mockRepo.find.mockResolvedValue([]);
    await service.findAll({});

    expect(mockRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: IsNull(),
        }),
      }),
    );
  });

  it('debería incluir solo proyectos archivados cuando archived es true', async () => {
    mockRepo.find.mockResolvedValue([]);
    await service.findAll({ archived: true });

    expect(mockRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: Not(IsNull()),
        }),
      }),
    );
  });
});

describe('ProjectsService - findOne', () => {
  let service: ProjectsService;
  let mockRepo: any;

  beforeEach(async () => {
    (globalThis as any).mockRepo = mockRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería devolver el proyecto con sus relaciones si existe', async () => {
    const project = { id: '1', name: 'Test' };
    mockRepo.findOne.mockResolvedValue(project);

    const result = await service.findOne('1');

    expect(result).toEqual(project);
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: ['leader'],
    });
  });

  it('debería arrojar NotFoundException si no existe', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
  });
});

describe('ProjectsService - Members', () => {
  let service: ProjectsService;
  let mockProjectRepo: any;
  let mockMemberRepo: any;
  let mockUsersService: any;

  beforeEach(async () => {
    (globalThis as any).mockProjectRepo = mockProjectRepo = {
      findOne: jest.fn(),
    };
    (globalThis as any).mockMemberRepo = mockMemberRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    mockUsersService = {
      findOneBy: jest.fn(), findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: mockMemberRepo,
        },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería listar miembros del proyecto', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1' });
    mockMemberRepo.find.mockResolvedValue([{ id: 'm1' }]);

    const result = await service.getMembers('1');
    expect(result).toEqual([{ id: 'm1' }]);
    expect(mockMemberRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: '1', removedAt: IsNull() } })
    );
  });

  it('debería agregar un miembro válido', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    mockUsersService.findById.mockResolvedValue({ id: 'u1' });
    mockMemberRepo.findOne.mockResolvedValue(null);
    mockMemberRepo.create.mockReturnValue({ userId: 'u1' });
    mockMemberRepo.save.mockResolvedValue({ id: 'm1', userId: 'u1' });

    const result = await service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' }, { id: 'leader1' } as any);
    expect(result.id).toBe('m1');
    expect(mockMemberRepo.save).toHaveBeenCalled();
  });

  it('debería arrojar ConflictException si el miembro ya existe', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    mockUsersService.findById.mockResolvedValue({ id: 'u1' });
    mockMemberRepo.findOne.mockResolvedValue({ id: 'm1' });

    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' }, { id: 'leader1' } as any)).rejects.toThrow(ConflictException);
  });

  it('debería arrojar NotFoundException si el usuario no existe', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    mockUsersService.findById.mockResolvedValue(null);

    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' }, { id: 'leader1' } as any)).rejects.toThrow(NotFoundException);
  });
});

describe('ProjectsService - findAll (archived filters)', () => {
  let service: ProjectsService;
  let mockRepo: any;

  beforeEach(async () => {
    (globalThis as any).mockRepo = mockRepo = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería excluir proyectos archivados por defecto', async () => {
    mockRepo.find.mockResolvedValue([]);
    await service.findAll({});

    expect(mockRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: IsNull(),
        }),
      }),
    );
  });

  it('debería incluir solo proyectos archivados cuando archived es true', async () => {
    mockRepo.find.mockResolvedValue([]);
    await service.findAll({ archived: true });

    expect(mockRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: Not(IsNull()),
        }),
      }),
    );
  });
});

describe('ProjectsService - findOne', () => {
  let service: ProjectsService;
  let mockRepo: any;

  beforeEach(async () => {
    (globalThis as any).mockRepo = mockRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería devolver el proyecto con sus relaciones si existe', async () => {
    const project = { id: '1', name: 'Test' };
    mockRepo.findOne.mockResolvedValue(project);

    const result = await service.findOne('1');

    expect(result).toEqual(project);
    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: ['leader'],
    });
  });

  it('debería arrojar NotFoundException si no existe', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
  });
});

describe('ProjectsService - Members', () => {
  let service: ProjectsService;
  let mockProjectRepo: any;
  let mockMemberRepo: any;
  let mockUsersService: any;

  beforeEach(async () => {
    (globalThis as any).mockProjectRepo = mockProjectRepo = {
      findOne: jest.fn(),
    };
    (globalThis as any).mockMemberRepo = mockMemberRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    mockUsersService = {
      findOneBy: jest.fn(), findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: mockProjectRepo,
        },
        {
          provide: getRepositoryToken(ProjectMemberEntity),
          useValue: mockMemberRepo,
        },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería listar miembros del proyecto', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1' });
    mockMemberRepo.find.mockResolvedValue([{ id: 'm1' }]);

    const result = await service.getMembers('1');
    expect(result).toEqual([{ id: 'm1' }]);
    expect(mockMemberRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: '1', removedAt: IsNull() } })
    );
  });

  it('debería agregar un miembro válido', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    mockUsersService.findById.mockResolvedValue({ id: 'u1' });
    mockMemberRepo.findOne.mockResolvedValue(null);
    mockMemberRepo.create.mockReturnValue({ userId: 'u1' });
    mockMemberRepo.save.mockResolvedValue({ id: 'm1', userId: 'u1' });

    const result = await service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' }, { id: 'leader1' } as any);
    expect(result.id).toBe('m1');
    expect(mockMemberRepo.save).toHaveBeenCalled();
  });

  it('debería arrojar ConflictException si el miembro ya existe', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    mockUsersService.findById.mockResolvedValue({ id: 'u1' });
    mockMemberRepo.findOne.mockResolvedValue({ id: 'm1' });

    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' }, { id: 'leader1' } as any)).rejects.toThrow(ConflictException);
  });

  it('debería arrojar NotFoundException si el usuario no existe', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    mockUsersService.findById.mockResolvedValue(null);

    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' }, { id: 'leader1' } as any)).rejects.toThrow(NotFoundException);
  });

  it('debería arrojar ForbiddenException al agregar miembro si no es lider', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Role' }, { id: 'other' } as any)).rejects.toThrow(ForbiddenException);
  });

  it('debería arrojar ForbiddenException al cambiar rol si no es lider', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1', leaderId: 'leader1' });
    await expect(service.updateMemberRole('1', 'm1', { projectRole: 'Role' }, { id: 'other' } as any)).rejects.toThrow(ForbiddenException);
  });
});

describe('ProjectsService - create', () => {
  let service: ProjectsService;
  let mockRepo: any;

  beforeEach(async () => {
    (globalThis as any).mockRepo = mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
{ provide: ProjectActivityService, useValue: { logEvent: jest.fn() } },
        ProjectsService,
        { provide: getRepositoryToken(ProjectEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ProjectMemberEntity), useValue: {} },
        { provide: UsersService, useValue: {} },
        { 
  provide: DataSource, 
  useValue: { 
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        create: (entity: any, dto: any) => {
          if (dto?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.create) { (globalThis as any).mockMemberRepo.create(dto); return dto; } if ((globalThis as any).mockProjectRepo?.create) { (globalThis as any).mockProjectRepo.create(dto); return dto; }
          if ((globalThis as any).mockRepo?.create) { (globalThis as any).mockRepo.create(dto); return dto; }
          return dto;
        },
        save: async (p: any) => {
          if (p?.projectRole !== undefined && (globalThis as any).mockMemberRepo?.save) return (globalThis as any).mockMemberRepo.save(p); if ((globalThis as any).mockProjectRepo?.save) return (globalThis as any).mockProjectRepo.save(p);
          if ((globalThis as any).mockRepo?.save) return (globalThis as any).mockRepo.save(p);
          return p;
        },
        findOne: async (entity: any, opts: any) => {
          if (entity.name === 'ProjectMemberEntity' && (globalThis as any).mockMemberRepo?.findOne) return (globalThis as any).mockMemberRepo.findOne(opts); if ((globalThis as any).mockProjectRepo?.findOne) return (globalThis as any).mockProjectRepo.findOne(opts);
          if ((globalThis as any).mockRepo?.findOne) return (globalThis as any).mockRepo.findOne(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        findOneBy: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.findOneBy) return (globalThis as any).mockProjectRepo.findOneBy(opts);
          if ((globalThis as any).mockRepo?.findOneBy) return (globalThis as any).mockRepo.findOneBy(opts);
          if (entity.name === 'ProjectMemberEntity') return null; return { id: '1', leaderId: 'leader1', name: 'Test' };
        },
        delete: async (entity: any, opts: any) => {
          if ((globalThis as any).mockProjectRepo?.delete) return (globalThis as any).mockProjectRepo.delete(opts);
          if ((globalThis as any).mockRepo?.delete) return (globalThis as any).mockRepo.delete(opts);
          return { affected: 1 };
        }
      };
      return cb(mockManager);
    }) 
  } 
},
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería asignar leaderId y createdBy usando el usuario autenticado', async () => {
    mockRepo.create.mockImplementation((dto: any) => dto);
    mockRepo.save.mockImplementation((p: any) => Promise.resolve(p));

    const result = await service.create({ name: 'Test' }, { id: 'leader1' } as any);

    expect(result.leaderId).toBe('leader1');
    expect(result.createdBy).toBe('leader1');
    (jest.fn())(expect.objectContaining({
      name: 'Test',
      leaderId: 'leader1',
      createdBy: 'leader1'
    }));
  });
});

