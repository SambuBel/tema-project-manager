import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/** Mismo camino que el ValidationPipe({ transform: true }): plain -> instancia -> validar. */
async function check(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateTaskDto, payload);
  const errors = await validate(dto);
  return { dto, errors, fields: errors.map((e) => e.property) };
}

describe('CreateTaskDto', () => {
  describe('casos válidos', () => {
    it('acepta solo lo obligatorio (projectId + title)', async () => {
      const { errors } = await check({ projectId: PROJECT_ID, title: 'Preparar informe' });
      expect(errors).toHaveLength(0);
    });

    it('acepta todos los campos', async () => {
      const { errors } = await check({
        projectId: PROJECT_ID,
        title: 'Preparar informe',
        description: 'Informe mensual',
        status: 'IN_REVIEW',
        priority: 'CRITICAL',
        assignedToId: USER_ID,
        startDate: '2026-09-21',
        dueDate: '2026-09-30',
      });
      expect(errors).toHaveLength(0);
    });

    it.each(['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'BLOCKED'])('acepta el estado %s', async (status) => {
      const { errors } = await check({ projectId: PROJECT_ID, title: 'x', status });
      expect(errors).toHaveLength(0);
    });

    it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('acepta la prioridad %s', async (priority) => {
      const { errors } = await check({ projectId: PROJECT_ID, title: 'x', priority });
      expect(errors).toHaveLength(0);
    });

    it('acepta un título de exactamente 200 caracteres', async () => {
      const { errors } = await check({ projectId: PROJECT_ID, title: 'a'.repeat(200) });
      expect(errors).toHaveLength(0);
    });

    it('acepta vencimiento igual al inicio', async () => {
      const { errors } = await check({
        projectId: PROJECT_ID,
        title: 'x',
        startDate: '2026-09-21',
        dueDate: '2026-09-21',
      });
      expect(errors).toHaveLength(0);
    });

    it('acepta solo vencimiento, sin inicio', async () => {
      const { errors } = await check({ projectId: PROJECT_ID, title: 'x', dueDate: '2026-09-30' });
      expect(errors).toHaveLength(0);
    });

    it('recorta los espacios del título', async () => {
      const { dto, errors } = await check({ projectId: PROJECT_ID, title: '  Preparar informe  ' });
      expect(errors).toHaveLength(0);
      expect(dto.title).toBe('Preparar informe');
    });
  });

  describe('casos inválidos', () => {
    it('rechaza si falta projectId', async () => {
      const { fields } = await check({ title: 'x' });
      expect(fields).toContain('projectId');
    });

    it('rechaza un projectId que no es UUID', async () => {
      const { fields } = await check({ projectId: 'no-soy-uuid', title: 'x' });
      expect(fields).toContain('projectId');
    });

    it('rechaza si falta el título', async () => {
      const { fields } = await check({ projectId: PROJECT_ID });
      expect(fields).toContain('title');
    });

    it('rechaza un título vacío', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: '' });
      expect(fields).toContain('title');
    });

    it('rechaza un título de solo espacios', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: '     ' });
      expect(fields).toContain('title');
    });

    it('rechaza un título de 201 caracteres', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 'a'.repeat(201) });
      expect(fields).toContain('title');
    });

    it('rechaza un título que no es texto', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 123 });
      expect(fields).toContain('title');
    });

    it('rechaza un estado inexistente', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 'x', status: 'HECHO' });
      expect(fields).toContain('status');
    });

    it('rechaza una prioridad inexistente', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 'x', priority: 'URGENTE' });
      expect(fields).toContain('priority');
    });

    it('rechaza un responsable que no es UUID', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 'x', assignedToId: '123' });
      expect(fields).toContain('assignedToId');
    });

    it('rechaza una fecha de inicio inválida', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 'x', startDate: 'mañana' });
      expect(fields).toContain('startDate');
    });

    it('rechaza una fecha de vencimiento inválida', async () => {
      const { fields } = await check({ projectId: PROJECT_ID, title: 'x', dueDate: '2026-02-31' });
      expect(fields).toContain('dueDate');
    });

    it('rechaza vencimiento anterior al inicio', async () => {
      const { errors, fields } = await check({
        projectId: PROJECT_ID,
        title: 'x',
        startDate: '2026-09-30',
        dueDate: '2026-09-21',
      });
      expect(fields).toEqual(['dueDate']);
      expect(Object.values(errors[0]?.constraints ?? {})).toContain(
        'La fecha de vencimiento no puede ser anterior a la de inicio',
      );
    });
  });
});
