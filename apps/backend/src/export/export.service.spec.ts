import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExportService, escapeCsvCell } from './export.service';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { CostEntity } from '../database/entities/cost.entity';
import { PermissionsService } from '../auth/permissions.service';
import { ProjectsService } from '../projects/projects.service';
import { GanttService } from '../gantt/gantt.service';
import { RoleName } from '../database/enums';

describe('ExportService - CSV Formula Injection Mitigation (BUG-09 / TC-017 / TC-072)', () => {
  describe('escapeCsvCell helper', () => {
    it('escapes cells starting with = by prepending a single quote', () => {
      expect(escapeCsvCell('=1+1 QA-Claude formula')).toBe("'=1+1 QA-Claude formula");
      expect(escapeCsvCell('=cmd|\'/C calc\'!A0')).toBe("'=cmd|'/C calc'!A0");
      expect(escapeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    });

    it('escapes cells starting with + when not a pure number', () => {
      expect(escapeCsvCell('+1+1')).toBe("'+1+1");
      expect(escapeCsvCell('+A1')).toBe("'+A1");
    });

    it('escapes cells starting with - when not a pure number', () => {
      expect(escapeCsvCell('-2+5')).toBe("'-2+5");
      expect(escapeCsvCell('-A1')).toBe("'-A1");
      expect(escapeCsvCell('- Revisar diseño')).toBe("'- Revisar diseño");
    });

    it('escapes cells starting with @', () => {
      expect(escapeCsvCell('@mention')).toBe("'@mention");
      expect(escapeCsvCell('@SUM(1;2)')).toBe("'@SUM(1;2)");
      expect(escapeCsvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
    });

    it('escapes cells starting with whitespace followed by a formula character', () => {
      expect(escapeCsvCell('   =1+1')).toBe("'   =1+1");
    });

    it('preserves valid positive and negative numbers without formula escaping', () => {
      expect(escapeCsvCell('100')).toBe('100');
      expect(escapeCsvCell('-150.00')).toBe('-150.00');
      expect(escapeCsvCell('+50')).toBe('+50');
      expect(escapeCsvCell('0')).toBe('0');
    });

    it('correctly quotes escaped formula cells that contain commas or double quotes', () => {
      expect(escapeCsvCell('=1+1, test')).toBe('"\'=1+1, test"');
      expect(escapeCsvCell('=1+1 "quoted"')).toBe('"\'=1+1 ""quoted"""');
    });

    it('handles regular text, empty, null and undefined values safely', () => {
      expect(escapeCsvCell('Tarea normal')).toBe('Tarea normal');
      expect(escapeCsvCell('Texto, con coma')).toBe('"Texto, con coma"');
      expect(escapeCsvCell('')).toBe('');
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
    });
  });

  describe('exportTasksCsv integration', () => {
    let service: ExportService;
    let mockTaskRepo: any;
    let mockProjectRepo: any;
    let mockPermissions: any;

    beforeEach(async () => {
      mockProjectRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'proj-1',
          name: 'Proyecto Test',
          slug: 'proyecto-test',
        }),
        manager: {
          findOne: jest.fn().mockResolvedValue(null),
        },
      };

      mockPermissions = {
        hasAnyGlobalRole: jest.fn().mockReturnValue(true),
        isProjectLeader: jest.fn().mockReturnValue(false),
        getProjectMembership: jest.fn(),
      };

      const qbMock = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'task-1',
            title: '=1+1 QA-Claude formula',
            description: '@inyeccion en descripcion',
            status: 'PENDING',
            priority: 'HIGH',
            assignedTo: { name: 'Juan Pérez' },
            startDate: '2026-03-01',
            dueDate: '2026-03-10',
            createdAt: new Date('2026-03-01T10:00:00Z'),
          },
        ]),
      };

      mockTaskRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(qbMock),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ExportService,
          { provide: getRepositoryToken(TaskEntity), useValue: mockTaskRepo },
          { provide: getRepositoryToken(ProjectEntity), useValue: mockProjectRepo },
          { provide: getRepositoryToken(ProjectStatusHistoryEntity), useValue: {} },
          { provide: getRepositoryToken(BudgetEntity), useValue: {} },
          { provide: getRepositoryToken(BudgetItemEntity), useValue: {} },
          { provide: getRepositoryToken(CostEntity), useValue: {} },
          { provide: PermissionsService, useValue: mockPermissions },
          { provide: ProjectsService, useValue: {} },
          { provide: GanttService, useValue: {} },
        ],
      }).compile();

      service = module.get<ExportService>(ExportService);
    });

    it('escapes formula injection in task title and description when exporting CSV (TC-017 / TC-072)', async () => {
      const csv = await service.exportTasksCsv(
        'proj-1',
        {},
        { id: 'user-1', name: 'Admin User', email: 'admin@tema.com', globalRoles: [RoleName.ADMIN] } as any,
      );

      // El título debe tener el prefijo '
      expect(csv).toContain("'=1+1 QA-Claude formula");
      // La descripción debe tener el prefijo '
      expect(csv).toContain("'@inyeccion en descripcion");
    });
  });
});
