import { Test, TestingModule } from '@nestjs/testing';
import { ProjectActivityService } from './project-activity.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectActivityEntity } from '../database/entities/project-activity.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectActivityAction, ProjectActivityEntityType } from '../database/enums';

describe('ProjectActivityService', () => {
  let service: ProjectActivityService;
  let mockActivityRepo: any;
  let mockStatusRepo: any;
  let mockManager: any;

  beforeEach(async () => {
    mockActivityRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      manager: {
        create: jest.fn(),
        save: jest.fn(),
      }
    };
    
    mockStatusRepo = {
      find: jest.fn(),
    };
    
    mockManager = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectActivityService,
        {
          provide: getRepositoryToken(ProjectActivityEntity),
          useValue: mockActivityRepo,
        },
        {
          provide: getRepositoryToken(ProjectStatusHistoryEntity),
          useValue: mockStatusRepo,
        },
      ],
    }).compile();

    service = module.get<ProjectActivityService>(ProjectActivityService);
  });

  describe('logEvent', () => {
    it('debería registrar un evento usando el manager provisto (transacción atómica)', async () => {
      const params = {
        projectId: 'p1',
        actorId: 'u1',
        actionType: ProjectActivityAction.PROJECT_CREATED,
        entityType: ProjectActivityEntityType.PROJECT,
      };

      mockManager.create.mockReturnValue({ ...params, id: 'event1' });
      mockManager.save.mockResolvedValue({ ...params, id: 'event1' });

      const result = await service.logEvent(params, mockManager);

      expect(mockManager.create).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalled();
      expect(result.id).toBe('event1');
    });

    it('debería registrar un evento usando el repositorio si no hay manager (fallback)', async () => {
      const params = {
        projectId: 'p1',
        actorId: 'u1',
        actionType: ProjectActivityAction.TASK_CREATED,
        entityType: ProjectActivityEntityType.TASK,
        metadata: { title: 'T1' }
      };

      mockActivityRepo.manager.create.mockReturnValue({ ...params, id: 'event2' });
      mockActivityRepo.manager.save.mockResolvedValue({ ...params, id: 'event2' });

      await service.logEvent(params);
      expect(mockActivityRepo.manager.create).toHaveBeenCalled();
      expect(mockActivityRepo.manager.save).toHaveBeenCalled();
    });
  });

  describe('getActivity (paginación y combinación)', () => {
    it('debería combinar eventos generales y de estado, paginando correctamente', async () => {
      const date1 = new Date('2026-09-02T10:00:00Z');
      const date2 = new Date('2026-09-01T10:00:00Z');
      const date3 = new Date('2026-09-03T10:00:00Z');

      const mockGeneral = [
        { id: 'g1', projectId: 'p1', actionType: 'PROJECT_UPDATED', entityType: 'PROJECT', createdAt: date2, actor: { id: 'u1', name: 'User' } },
        { id: 'g2', projectId: 'p1', actionType: 'TASK_CREATED', entityType: 'TASK', createdAt: date3, actor: { id: 'u1', name: 'User' } }
      ];

      const mockStatus = [
        { id: 's1', projectId: 'p1', previousStatus: 'PLANNED', newStatus: 'IN_PROGRESS', changedAt: date1, changedByUser: { id: 'u2', name: 'Other' } }
      ];

      mockActivityRepo.find.mockResolvedValue(mockGeneral);
      mockStatusRepo.find.mockResolvedValue(mockStatus);

      // fetch with limit 2, offset 0
      const result = await service.getActivity('p1', 2, 0);

      // Expect 2 items (limit 2)
      expect(result.length).toBe(2);

      // Descending order expected: date3 (g2), date1 (s1)
      expect(result[0].id).toBe('g2');
      expect(result[0].actionType).toBe('TASK_CREATED');
      
      expect(result[1].id).toBe('s1');
      expect(result[1].actionType).toBe('STATUS_CHANGED');

      // Check offset 1, limit 2
      const resultOffset = await service.getActivity('p1', 2, 1);
      // Expected to skip date3 (g2), return date1 (s1) and date2 (g1)
      // Note: Since mockRepo returns the same regardless of take in our simple mock, we simulate it here just checking the slicing logic:
      // The service slices the mocked return which is combined size 3.
      expect(resultOffset.length).toBe(2);
      expect(resultOffset[0].id).toBe('s1');
      expect(resultOffset[1].id).toBe('g1');
    });

    it('debería resolver empates por fecha determinísticamente (ID localCompare)', async () => {
      const sameDate = new Date('2026-09-01T10:00:00Z');
      const mockGeneral = [
        { id: 'z1', projectId: 'p1', actionType: 'PROJECT_UPDATED', entityType: 'PROJECT', createdAt: sameDate, actor: { id: 'u1', name: 'User' } },
      ];
      const mockStatus = [
        { id: 'a1', projectId: 'p1', previousStatus: 'PLANNED', newStatus: 'IN_PROGRESS', changedAt: sameDate, changedByUser: { id: 'u2', name: 'Other' } }
      ];

      mockActivityRepo.find.mockResolvedValue(mockGeneral);
      mockStatusRepo.find.mockResolvedValue(mockStatus);

      const result = await service.getActivity('p1', 10, 0);
      expect(result.length).toBe(2);
      // 'a1' localeCompare 'z1' -> a1 < z1 -> a1 should come first for descending or ascending? 
      // The sort says: return a.id.localeCompare(b.id); so 'a1' < 'z1' means -1, so a1 is before z1.
      expect(result[0].id).toBe('a1');
      expect(result[1].id).toBe('z1');
    });
  });
});
