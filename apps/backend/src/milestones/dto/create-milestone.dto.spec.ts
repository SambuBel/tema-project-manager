import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMilestoneDto } from './create-milestone.dto';

describe('CreateMilestoneDto', () => {
  it('es válido con nombre y fecha objetivo YYYY-MM-DD correctos', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: 'Fase 1: Relevamiento',
      dueDate: '2026-11-15',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('es válido con descripción opcional', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: 'Entrega MVP',
      dueDate: '2026-12-01',
      description: 'Entrega del producto mínimo viable',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('recorta espacios en el nombre automáticamente', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: '   Diseño de Arquitectura   ',
      dueDate: '2026-11-20',
    });
    expect(dto.name).toBe('Diseño de Arquitectura');
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('falla si el nombre está vacío o son solo espacios', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: '   ',
      dueDate: '2026-11-20',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('normaliza espacios repetidos intermedios automáticamente (M-02)', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: 'Entrega   Fase   1',
      dueDate: '2026-11-20',
    });
    expect(dto.name).toBe('Entrega Fase 1');
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('admite exactamente 200 caracteres en el nombre (límite I-02)', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: 'A'.repeat(200),
      dueDate: '2026-11-20',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('falla si el nombre supera los 200 caracteres', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      name: 'A'.repeat(201),
      dueDate: '2026-11-20',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('falla si la fecha objetivo no tiene formato YYYY-MM-DD', async () => {
    const invalidDates = ['15-11-2026', '2026/11/15', 'ayer', '2026-13-45', ''];
    for (const d of invalidDates) {
      const dto = plainToInstance(CreateMilestoneDto, {
        name: 'Hito Test',
        dueDate: d,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'dueDate')).toBe(true);
    }
  });
});
