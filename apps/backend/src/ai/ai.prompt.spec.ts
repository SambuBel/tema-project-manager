import { buildSystemPrompt } from './ai.prompt';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ProjectEntity } from '../projects/project.entity';

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

  it('CU-05: pide la situación presupuestaria y omitirla sin mencionarla si no está disponible', () => {
    expect(prompt).toMatch(/get_project y a obtener_situacion_presupuestaria/);
    expect(prompt).toMatch(/incluidas las en revisión/);
    expect(prompt).toMatch(/topAssignees/);
    expect(prompt).toMatch(/available: false, no menciones presupuesto/);
    expect(prompt).not.toMatch(/ofrece \(por ejemplo presupuesto/);
  });

  it('CU-04: pide responder con el enlace de la tarea creada', () => {
    expect(prompt).toMatch(/enlace del campo url/);
  });

  it('sin proyecto abierto pide preguntar cuál es en vez de seguir llamando herramientas', () => {
    expect(prompt).toMatch(/list_projects una sola vez/);
    expect(prompt).toMatch(/No sigas llamando herramientas/);
    expect(prompt).toMatch(/slug/);
  });

  it('con proyecto abierto no manda a preguntar cuál es', () => {
    const project = { id: 'p1', slug: 'demo', name: 'Demo' } as unknown as ProjectEntity;
    const withProject = buildSystemPrompt({ user, project, today: new Date('2026-10-18T12:00:00Z') });

    expect(withProject).toMatch(/tiene abierto el proyecto "Demo"/);
    expect(withProject).not.toMatch(/list_projects una sola vez/);
  });
});
