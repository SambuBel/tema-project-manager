import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCommentDto } from './update-comment.dto';

async function check(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateCommentDto, payload);
  const errors = await validate(dto);
  return { dto, errors, fields: errors.map((e) => e.property) };
}

describe('UpdateCommentDto', () => {
  it('acepta un contenido válido', async () => {
    const { errors } = await check({ content: 'Comentario actualizado' });
    expect(errors).toHaveLength(0);
  });

  it('rechaza si falta el campo content', async () => {
    const { errors, fields } = await check({});
    expect(errors.length).toBeGreaterThan(0);
    expect(fields).toContain('content');
  });

  it('rechaza si content no es string', async () => {
    const { errors, fields } = await check({ content: 12345 });
    expect(errors.length).toBeGreaterThan(0);
    expect(fields).toContain('content');
  });

  it('rechaza si content está vacío', async () => {
    const { errors, fields } = await check({ content: '' });
    expect(errors.length).toBeGreaterThan(0);
    expect(fields).toContain('content');
  });

  it('rechaza si content contiene exclusivamente espacios en blanco', async () => {
    const { errors, fields } = await check({ content: '   ' });
    expect(errors.length).toBeGreaterThan(0);
    expect(fields).toContain('content');
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError?.constraints?.matches).toBe('El comentario no puede estar compuesto solo por espacios');
  });

  it('acepta menciones válidas con formato UUID y datos requeridos', async () => {
    const { errors } = await check({
      content: 'Hola @Ana Gómez',
      mentions: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          name: 'Ana Gómez',
          startIndex: 5,
          endIndex: 15,
        },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  it('rechaza mención con userId no UUID o índices negativos', async () => {
    const { errors } = await check({
      content: 'Hola @Ana',
      mentions: [
        {
          userId: 'invalido',
          name: '',
          startIndex: -1,
          endIndex: 'cinco',
        },
      ],
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
