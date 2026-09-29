import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ListProjectsDto } from './list-projects.dto';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: ProjectsService;

  const mockProjectsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getMembers: jest.fn(),
    getActivity: jest.fn(),
    addMember: jest.fn(),
    updateMemberRole: jest.fn(),
    changeStatus: jest.fn(),
    archive: jest.fn(),
    create: jest.fn(),
    changeLeader: jest.fn(),
  };

  const mockUser = {
    id: 'user-id-1',
    email: 'test@temaconsulting.com',
    roles: ['ADMIN'],
  } as RequestUser;

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
      .overrideGuard(RolesGuard)
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
    it('should call projectsService.findAll with query parameters and the current user', async () => {
      const query = { status: 'En curso', search: 'Alpha' } as unknown as ListProjectsDto;
      const expectedResult = [{ id: '1', name: 'Project Alpha' }];
      mockProjectsService.findAll.mockResolvedValue(expectedResult);

      const result = await controller.findAll(query, mockUser);

      expect(service.findAll).toHaveBeenCalledWith(query, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('findOne', () => {
    it('should call projectsService.findOne with id and the current user', async () => {
      const id = 'project-id';
      const expectedResult = { id, name: 'Project Alpha' };
      mockProjectsService.findOne.mockResolvedValue(expectedResult);

      const result = await controller.findOne(id, mockUser);

      expect(service.findOne).toHaveBeenCalledWith(id, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getActivity', () => {
    it('should call projectsService.getActivity with id, limit, offset and the current user', async () => {
      const id = 'project-id';
      const expectedResult = [{ id: 'a1' }];
      mockProjectsService.getActivity.mockResolvedValue(expectedResult);

      const result = await controller.getActivity(id, 20, 0, mockUser);

      expect(service.getActivity).toHaveBeenCalledWith(id, 20, 0, mockUser);
      expect(result).toEqual(expectedResult);
    });

    it('rechaza limit fuera de rango antes de llegar al service', () => {
      expect(() => controller.getActivity('project-id', 0, 0, mockUser)).toThrow(BadRequestException);
      expect(() => controller.getActivity('project-id', 101, 0, mockUser)).toThrow(BadRequestException);
      expect(service.getActivity).not.toHaveBeenCalled();
    });

    it('rechaza offset negativo antes de llegar al service', () => {
      expect(() => controller.getActivity('project-id', 20, -1, mockUser)).toThrow(BadRequestException);
      expect(service.getActivity).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should call projectsService.create with dto and user', async () => {
      const dto = { name: 'New Project', description: 'Test desc', estimatedEndDate: new Date() };
      const expectedResult = { id: 'new-id', ...dto };
      mockProjectsService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(dto as unknown as CreateProjectDto, mockUser);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('changeStatus', () => {
    it('should call projectsService.changeStatus with id, dto, and user', async () => {
      const id = 'project-id';
      const dto = { status: 'En curso' } as unknown as UpdateProjectStatusDto;
      const expectedResult = { id, status: 'En curso' };
      mockProjectsService.changeStatus.mockResolvedValue(expectedResult);

      const result = await controller.changeStatus(id, dto, mockUser);

      expect(service.changeStatus).toHaveBeenCalledWith(id, dto, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('archive', () => {
    it('should call projectsService.archive with id and the current user', async () => {
      const id = 'project-id';
      mockProjectsService.archive.mockResolvedValue(undefined);

      await controller.archive(id, mockUser);

      expect(service.archive).toHaveBeenCalledWith(id, mockUser);
    });
  });

  describe('changeLeader', () => {
    it('should call projectsService.changeLeader with id, dto, and user', async () => {
      const id = 'project-id';
      const dto = { newLeaderId: 'new-leader-id' };
      const expectedResult = { id, leaderId: 'new-leader-id' };
      mockProjectsService.changeLeader.mockResolvedValue(expectedResult);

      const result = await controller.changeLeader(id, dto, mockUser);

      expect(service.changeLeader).toHaveBeenCalledWith(id, dto, mockUser);
      expect(result).toEqual(expectedResult);
    });
  });
});
