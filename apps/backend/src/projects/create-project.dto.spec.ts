import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

const check = async (payload: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateProjectDto, payload))).map((e) => e.property);

const validProject = {
  name: 'Proyecto de prueba',
  description: 'Centralizar solicitudes y seguimiento',
  startDate: '2026-10-01',
  estimatedEndDate: '2026-10-31',
};

describe('CreateProjectDto - Validaciones obligatorias (BUG-08 / TC-013 / TC-014)', () => {
  it('acepta un proyecto válido completo', async () => {
    expect(await check(validProject)).toHaveLength(0);
  });

  describe('name (Nombre del proyecto)', () => {
    it('hace trim del nombre', () => {
      const dto = plainToInstance(CreateProjectDto, { ...validProject, name: '  Proyecto con espacios  ' });
      expect(dto.name).toBe('Proyecto con espacios');
    });

    it('rechaza nombre compuesto solo por espacios en blanco (TC-013)', async () => {
      const errors = await check({ ...validProject, name: '   ' });
      expect(errors).toContain('name');
    });

    it('rechaza nombre vacío o ausente', async () => {
      expect(await check({ ...validProject, name: '' })).toContain('name');
      const withoutName: Record<string, unknown> = { ...validProject };
      delete withoutName.name;
      expect(await check(withoutName)).toContain('name');
    });
  });

  describe('description (Objetivo del proyecto)', () => {
    it('hace trim del objetivo', () => {
      const dto = plainToInstance(CreateProjectDto, { ...validProject, description: '  Objetivo con espacios  ' });
      expect(dto.description).toBe('Objetivo con espacios');
    });

    it('rechaza alta sin objetivo o con objetivo vacío (TC-014)', async () => {
      expect(await check({ ...validProject, description: '' })).toContain('description');
      expect(await check({ ...validProject, description: '   ' })).toContain('description');
      const withoutDesc: Record<string, unknown> = { ...validProject };
      delete withoutDesc.description;
      expect(await check(withoutDesc)).toContain('description');
    });
  });

  describe('startDate y estimatedEndDate (Fechas de inicio y entrega)', () => {
    it('acepta entrega igual o posterior al inicio', async () => {
      expect(await check({ ...validProject, startDate: '2026-10-01', estimatedEndDate: '2026-10-01' })).toHaveLength(0);
      expect(await check({ ...validProject, startDate: '2026-10-01', estimatedEndDate: '2026-10-31' })).toHaveLength(0);
    });

    it('rechaza entrega anterior al inicio', async () => {
      const errors = await check({ ...validProject, startDate: '2026-10-31', estimatedEndDate: '2026-10-01' });
      expect(errors).toContain('estimatedEndDate');
    });

    it('rechaza alta sin fechas (TC-014)', async () => {
      const withoutDates: Record<string, unknown> = { ...validProject };
      delete withoutDates.startDate;
      delete withoutDates.estimatedEndDate;
      const errors = await check(withoutDates);
      expect(errors).toContain('startDate');
      expect(errors).toContain('estimatedEndDate');
    });

    it('rechaza si falta solo startDate o solo estimatedEndDate', async () => {
      const withoutStart: Record<string, unknown> = { ...validProject };
      delete withoutStart.startDate;
      expect(await check(withoutStart)).toContain('startDate');

      const withoutEnd: Record<string, unknown> = { ...validProject };
      delete withoutEnd.estimatedEndDate;
      expect(await check(withoutEnd)).toContain('estimatedEndDate');
    });
  });

  describe('leaderId', () => {
    it('es opcional', async () => {
      expect(await check(validProject)).toHaveLength(0);
    });

    it('acepta un UUID válido', async () => {
      expect(await check({ ...validProject, leaderId: '11111111-1111-4111-8111-111111111111' })).toHaveLength(0);
    });

    it.each(['no-uuid', '123', '', 42])('rechaza %p', async (leaderId) => {
      expect(await check({ ...validProject, leaderId })).toContain('leaderId');
    });
  });
});
