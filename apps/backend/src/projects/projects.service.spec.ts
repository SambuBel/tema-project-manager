import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { ProjectsService } from './projects.service';
import { ProjectEntity } from './project.entity';
import { ProjectStatus } from '../database/enums';
import { NotFoundException, BadRequestException } from '@nestjs/common';

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
