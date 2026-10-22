import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMilestoneDto } from './update-milestone.dto';

describe('UpdateMilestoneDto (KAN-244)', () => {
  it('permite un objeto vacío (actualización parcial sin cambios)', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('permite actualizar solo el nombre con valor válido', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, { name: 'Nuevo Nombre de Hito' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.name).toBe('Nuevo Nombre de Hito');
  });

  it('permite actualizar solo la fecha con formato YYYY-MM-DD válido', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, { dueDate: '2026-12-31' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('permite actualizar solo la descripción', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, { description: 'Nueva descripción detallada' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('falla si el nombre enviado es una cadena vacía o solo espacios', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, { name: '   ' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('normaliza espacios repetidos intermedios automáticamente (M-02)', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, {
      name: 'Hito   Modificado   V2',
    });
    expect(dto.name).toBe('Hito Modificado V2');
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('admite exactamente 200 caracteres en el nombre (límite I-02)', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, {
      name: 'B'.repeat(200),
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('falla si el nombre supera los 200 caracteres', async () => {
    const dto = plainToInstance(UpdateMilestoneDto, { name: 'M'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('falla si la fecha objetivo tiene formato inválido', async () => {
    const invalidDates = ['31-12-2026', '2026/12/31', 'fecha-invalida', '2026-13-45', ''];
    for (const d of invalidDates) {
      const dto = plainToInstance(UpdateMilestoneDto, { dueDate: d });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'dueDate')).toBe(true);
    }
  });
});
