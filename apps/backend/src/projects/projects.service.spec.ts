import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectStatus } from '../database/enums';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

describe('ProjectsService - archive', () => {
  let service: ProjectsService;
  let mockRepo: any;
  let mockDataSource: any;

  beforeEach(async () => {
    mockRepo = {
      findOneBy: jest.fn(),
      save: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('debería archivar un proyecto FINALIZADO con éxito', async () => {
    const project = { id: '1', status: ProjectStatus.FINISHED, archivedAt: null };
    mockRepo.findOneBy.mockResolvedValue(project);
    mockRepo.save.mockImplementation((p: any) => Promise.resolve(p));

    const result = await service.archive('1');
    expect(result.archivedAt).not.toBeNull();
    expect(mockRepo.save).toHaveBeenCalledWith(result);
  });

  it('debería archivar un proyecto CANCELADO con éxito', async () => {
    const project = { id: '1', status: ProjectStatus.CANCELLED, archivedAt: null };
    mockRepo.findOneBy.mockResolvedValue(project);
    mockRepo.save.mockImplementation((p: any) => Promise.resolve(p));

    const result = await service.archive('1');
    expect(result.archivedAt).not.toBeNull();
    expect(mockRepo.save).toHaveBeenCalledWith(result);
  });

  it('debería arrojar NotFoundException si el proyecto no existe', async () => {
    mockRepo.findOneBy.mockResolvedValue(null);
    await expect(service.archive('1')).rejects.toThrow(NotFoundException);
  });

  it.each([ProjectStatus.PLANNED, ProjectStatus.IN_PROGRESS, ProjectStatus.PAUSED])(
    'debería arrojar BadRequestException si el proyecto está en estado %s',
    async (status) => {
      const project = { id: '1', status, archivedAt: null };
      mockRepo.findOneBy.mockResolvedValue(project);

      await expect(service.archive('1')).rejects.toThrow(BadRequestException);
    },
  );

  it('debería devolver el proyecto sin cambios si ya está archivado', async () => {
    const date = new Date();
    const project = { id: '1', status: ProjectStatus.FINISHED, archivedAt: date };
    mockRepo.findOneBy.mockResolvedValue(project);

    const result = await service.archive('1');
    expect(result.archivedAt).toEqual(date);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});

describe('ProjectsService - findAll (archived filters)', () => {
  let service: ProjectsService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
          provide: DataSource,
          useValue: {},
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
    mockRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
          provide: DataSource,
          useValue: {},
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

  beforeEach(async () => {
    mockProjectRepo = {
      findOne: jest.fn(),
    };
    mockMemberRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
          provide: DataSource,
          useValue: {},
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
    mockProjectRepo.findOne.mockResolvedValue({ id: '1' });
    mockMemberRepo.findOne.mockResolvedValue(null);
    mockMemberRepo.create.mockReturnValue({ userId: 'u1' });
    mockMemberRepo.save.mockResolvedValue({ id: 'm1', userId: 'u1' });

    const result = await service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' });
    expect(result.id).toBe('m1');
    expect(mockMemberRepo.save).toHaveBeenCalled();
  });

  it('debería arrojar ConflictException si el miembro ya existe', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1' });
    mockMemberRepo.findOne.mockResolvedValue({ id: 'm1' });

    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' })).rejects.toThrow(ConflictException);
  });

  it('debería arrojar NotFoundException si el usuario no existe (FK error)', async () => {
    mockProjectRepo.findOne.mockResolvedValue({ id: '1' });
    mockMemberRepo.findOne.mockResolvedValue(null);
    mockMemberRepo.save.mockRejectedValue({ code: '23503' });

    await expect(service.addMember('1', { userId: 'u1', projectRole: 'Colaborador' })).rejects.toThrow(NotFoundException);
  });
});
