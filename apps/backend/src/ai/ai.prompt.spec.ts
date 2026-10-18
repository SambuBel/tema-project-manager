import { buildSystemPrompt } from './ai.prompt';
import { RequestUser } from '../auth/types/authenticated-request-user';

const user = { id: 'u1', name: 'Gabi', roles: [] } as unknown as RequestUser;

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt({ user, project: null, today: new Date('2026-10-18T12:00:00Z') });

  it('prohibe inventar datos', () => {
    expect(prompt).toMatch(/Nunca inventes/);
  });

  it('pide decir que no se encontro nada cuando una lista viene vacia', () => {
    expect(prompt).toMatch(/empty: true/);
    expect(prompt).toMatch(/no encontré/);
  });

  it('pide decir que no puede responder lo que ninguna herramienta ofrece', () => {
    expect(prompt).toMatch(/ninguna herramienta ofrece/);
  });
});
