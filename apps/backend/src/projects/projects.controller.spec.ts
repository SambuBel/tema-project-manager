import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { UserEntity } from '../database/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: ProjectsService;

  const mockProjectsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getMembers: jest.fn(),
    addMember: jest.fn(),
    updateMemberRole: jest.fn(),
    changeStatus: jest.fn(),
    archive: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
  };

  const mockUser = {
    id: 'user-id-1',
    email: 'test@temaconsulting.com',
  } as UserEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        {
          provide: ProjectsService,
          useValue: mockProjectsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ProjectsController>(ProjectsController);
    service = module.get<ProjectsService>(ProjectsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should call projectsService.findAll with query parameters', async () => {
      const query = { status: 'En curso', search: 'Alpha' } as any;
      const expectedResult = [{ id: '1', name: 'Project Alpha' }];
      mockProjectsService.findAll.mockResolvedValue(expectedResult);

      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('findOne', () => {
    it('should call projectsService.findOne with id', async () => {
      const id = 'project-id';
      const expectedResult = { id, name: 'Project Alpha' };
      mockProjectsService.findOne.mockResolvedValue(expectedResult);

      const result = await controller.findOne(id);

      expect(service.findOne).toHaveBeenCalledWith(id);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('create', () => {
    it('should call projectsService.create with dto and user', async () => {
      const dto = { name: 'New Project', description: 'Test desc', estimatedEndDate: new Date() };
      const expectedResult = { id: 'new-id', ...dto };
      mockProjectsService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(dto as any, mockUser);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('changeStatus', () => {
    it('should call projectsService.changeStatus with id, dto, and user', async () => {
      const id = 'project-id';
      const dto = { status: 'En curso' } as any;
      const expectedResult = { id, status: 'En curso' };
      mockProjectsService.changeStatus.mockResolvedValue(expectedResult);

      const result = await controller.changeStatus(id, dto, mockUser);

      expect(service.changeStatus).toHaveBeenCalledWith(id, dto, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('archive', () => {
    it('should call projectsService.archive with id', async () => {
      const id = 'project-id';
      mockProjectsService.archive.mockResolvedValue(undefined);

      await controller.archive(id);

      expect(service.archive).toHaveBeenCalledWith(id);
    });
  });

  describe('remove', () => {
    it('should call projectsService.remove with id', async () => {
      const id = 'project-id';
      mockProjectsService.remove.mockResolvedValue(undefined);

      await controller.remove(id);

      expect(service.remove).toHaveBeenCalledWith(id);
    });
  });
});
