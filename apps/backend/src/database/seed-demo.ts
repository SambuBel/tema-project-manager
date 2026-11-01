import 'reflect-metadata';
import dataSource from './data-source';
import { hashPassword } from '../auth/password';
import { slugify } from '../projects/utils/slug.util';
import { RoleEntity } from './entities/role.entity';
import { UserEntity } from './entities/user.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { CostCategoryEntity } from './entities/cost-category.entity';
import { ProjectMemberEntity } from './entities/project-member.entity';
import { BudgetEntity } from './entities/budget.entity';
import { BudgetItemEntity } from './entities/budget-item.entity';
import { CostEntity } from './entities/cost.entity';
import { ProjectEntity } from '../projects/project.entity';
import { MilestoneEntity } from '../milestones/milestone.entity';
import { TaskEntity } from '../tasks/task.entity';
import { SubtaskEntity } from '../subtasks/subtask.entity';
import { ProjectMemberRole, ProjectStatus, RoleName, TaskPriority, TaskStatus } from './enums';

/**
 * Datos de DEMOSTRACION para probar la app (Vercel + Railway): usuarios, proyectos con hitos, tareas,
 * subtareas, presupuesto y costos. Idempotente: un usuario o proyecto que ya existe (por email / slug)
 * se saltea entero, asi que puede correrse varias veces sin duplicar.
 *
 * NO corre solo: exige DEMO_PASSWORD (la contraseña de todos los usuarios demo) para no publicar una
 * clave fija en un despliegue publico. Los emails terminan en @demo.tema.test.
 *
 * Uso:
 *   DEMO_PASSWORD='ClaveSegura123' pnpm --filter @tema/backend seed:demo
 *
 * Requiere la base ya migrada. Roles y rubros de costo los asegura este mismo script.
 */

const DEMO_DOMAIN = 'demo.tema.test';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha YYYY-MM-DD desplazada `days` desde hoy, para que la demo siempre se vea "actual". */
function day(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Importes en centavos (BigInt) -> "1234.50". Nunca float (RNF-19). */
function money(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${cents < 0n ? '-' : ''}${whole}.${frac}`;
}

interface DemoUser {
  key: string;
  name: string;
  role: RoleName;
}

const USERS: DemoUser[] = [
  { key: 'admin', name: 'Ana Admin', role: RoleName.ADMIN },
  { key: 'pm', name: 'Pablo Program Manager', role: RoleName.PROGRAM_MANAGER },
  { key: 'lider1', name: 'Lucía Líder', role: RoleName.PROJECT_LEADER },
  { key: 'lider2', name: 'Leandro Líder', role: RoleName.PROJECT_LEADER },
  { key: 'colab1', name: 'Carla Colaboradora', role: RoleName.COLLABORATOR },
  { key: 'colab2', name: 'Camilo Colaborador', role: RoleName.COLLABORATOR },
  { key: 'observador', name: 'Olga Observadora', role: RoleName.OBSERVER },
];

const email = (key: string): string => `${key}@${DEMO_DOMAIN}`;

interface DemoSubtask {
  title: string;
  by?: string;
  done?: boolean;
}
interface DemoTask {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  by?: string;
  start: number;
  due: number;
  milestone?: string;
  subtasks?: DemoSubtask[];
}
interface DemoProject {
  name: string;
  description: string;
  status: ProjectStatus;
  currency: string;
  leader: string;
  collaborators: string[];
  observers: string[];
  start: number;
  end: number;
  milestones: { name: string; due: number; done?: boolean }[];
  tasks: DemoTask[];
  /** rubro -> importe en centavos. El total del presupuesto es la suma. Sin presupuesto si falta. */
  budget?: Record<string, bigint>;
  costs?: { category: string; cents: bigint; offset: number; description: string }[];
}

const PROJECTS: DemoProject[] = [
  {
    name: 'Plataforma de Onboarding',
    description: 'Portal para dar de alta y acompañar a nuevos clientes durante sus primeras semanas.',
    status: ProjectStatus.IN_PROGRESS,
    currency: 'ARS',
    leader: 'lider1',
    collaborators: ['colab1', 'colab2'],
    observers: ['observador'],
    start: -60,
    end: 60,
    milestones: [
      { name: 'Diseño aprobado', due: -30, done: true },
      { name: 'Beta interna', due: 20 },
      { name: 'Lanzamiento', due: 55 },
    ],
    tasks: [
      {
        title: 'Relevamiento de requisitos',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        by: 'colab1',
        start: -58,
        due: -40,
        milestone: 'Diseño aprobado',
        subtasks: [
          { title: 'Entrevistas con el área comercial', by: 'colab1', done: true },
          { title: 'Documento de alcance', by: 'colab1', done: true },
        ],
      },
      {
        title: 'Diseño de pantallas',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.MEDIUM,
        by: 'colab2',
        start: -40,
        due: -30,
        milestone: 'Diseño aprobado',
        subtasks: [
          { title: 'Wireframes', by: 'colab2', done: true },
          { title: 'Prototipo navegable', by: 'colab2', done: true },
        ],
      },
      {
        title: 'API de registro de clientes',
        description: 'Endpoints de alta, validación de datos y envío de email de bienvenida.',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.CRITICAL,
        by: 'colab1',
        start: -20,
        due: 10,
        milestone: 'Beta interna',
        subtasks: [
          { title: 'Modelo de datos', by: 'colab1', done: true },
          { title: 'Endpoint POST /clientes', by: 'colab1', done: true },
          { title: 'Validaciones y errores', by: 'colab1' },
          { title: 'Email de bienvenida', by: 'colab2' },
        ],
      },
      {
        title: 'Pantalla de seguimiento',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.MEDIUM,
        by: 'colab2',
        start: -10,
        due: 5,
        milestone: 'Beta interna',
        subtasks: [
          { title: 'Maquetado', by: 'colab2', done: true },
          { title: 'Conexión con la API', by: 'colab2' },
        ],
      },
      {
        title: 'Pruebas de aceptación',
        status: TaskStatus.PENDING,
        priority: TaskPriority.HIGH,
        by: 'lider1',
        start: 15,
        due: 40,
        milestone: 'Lanzamiento',
        subtasks: [{ title: 'Plan de pruebas' }, { title: 'Ejecución con usuarios piloto' }],
      },
      {
        title: 'Integración con el CRM',
        description: 'Bloqueada hasta que el proveedor entregue las credenciales del ambiente de pruebas.',
        status: TaskStatus.BLOCKED,
        priority: TaskPriority.HIGH,
        by: 'colab1',
        start: 5,
        due: 30,
      },
    ],
    budget: {
      'Recursos humanos': 450000000n,
      'Licencias y software': 60000000n,
      'Servicios de terceros': 90000000n,
      Otros: 20000000n,
    },
    costs: [
      { category: 'Recursos humanos', cents: 120000000n, offset: -45, description: 'Horas del equipo - primer mes' },
      { category: 'Recursos humanos', cents: 135000000n, offset: -15, description: 'Horas del equipo - segundo mes' },
      { category: 'Licencias y software', cents: 18500000n, offset: -50, description: 'Licencias de diseño y repositorio' },
      { category: 'Servicios de terceros', cents: 32000000n, offset: -25, description: 'Consultoría de UX externa' },
    ],
  },
  {
    name: 'Migración a la nube',
    description: 'Traslado de los servicios internos a infraestructura en la nube con monitoreo y respaldo.',
    status: ProjectStatus.IN_PROGRESS,
    currency: 'USD',
    leader: 'lider2',
    collaborators: ['colab1'],
    observers: ['observador'],
    start: -30,
    end: 90,
    milestones: [
      { name: 'Inventario de servicios', due: -10, done: true },
      { name: 'Migración de producción', due: 70 },
    ],
    tasks: [
      {
        title: 'Inventario de servicios',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.MEDIUM,
        by: 'colab1',
        start: -28,
        due: -10,
        milestone: 'Inventario de servicios',
        subtasks: [
          { title: 'Listar servidores', by: 'colab1', done: true },
          { title: 'Clasificar por criticidad', by: 'colab1', done: true },
        ],
      },
      {
        title: 'Infraestructura como código',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        by: 'lider2',
        start: -8,
        due: 25,
        milestone: 'Migración de producción',
        subtasks: [
          { title: 'Red y subredes', by: 'lider2', done: true },
          { title: 'Base de datos administrada', by: 'lider2' },
          { title: 'Balanceador', by: 'colab1' },
        ],
      },
      {
        title: 'Plan de respaldo y recuperación',
        status: TaskStatus.PENDING,
        priority: TaskPriority.CRITICAL,
        by: 'colab1',
        start: 10,
        due: 45,
        milestone: 'Migración de producción',
        subtasks: [{ title: 'Definir RPO y RTO' }, { title: 'Prueba de restauración' }],
      },
    ],
    budget: {
      'Recursos humanos': 3800000n,
      'Licencias y software': 650000n,
      'Servicios de terceros': 1200000n,
      'Viáticos y traslados': 150000n,
    },
    costs: [
      { category: 'Recursos humanos', cents: 1100000n, offset: -20, description: 'Horas del equipo de infraestructura' },
      { category: 'Servicios de terceros', cents: 480000n, offset: -12, description: 'Créditos de la plataforma cloud' },
    ],
  },
  {
    name: 'Sitio institucional 2.0',
    description: 'Rediseño del sitio público de la organización. Proyecto ya finalizado.',
    status: ProjectStatus.FINISHED,
    currency: 'ARS',
    leader: 'lider1',
    collaborators: ['colab2'],
    observers: [],
    start: -150,
    end: -30,
    milestones: [{ name: 'Publicación', due: -35, done: true }],
    tasks: [
      {
        title: 'Rediseño visual',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.MEDIUM,
        by: 'colab2',
        start: -148,
        due: -90,
        milestone: 'Publicación',
        subtasks: [{ title: 'Paleta y tipografía', by: 'colab2', done: true }],
      },
      {
        title: 'Publicación en producción',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        by: 'lider1',
        start: -50,
        due: -35,
        milestone: 'Publicación',
      },
    ],
    budget: {
      'Recursos humanos': 180000000n,
      'Servicios de terceros': 40000000n,
    },
    costs: [
      { category: 'Recursos humanos', cents: 175000000n, offset: -90, description: 'Horas del equipo' },
      { category: 'Servicios de terceros', cents: 41500000n, offset: -70, description: 'Redacción y fotografía' },
    ],
  },
  {
    name: 'App de reportes móviles',
    description: 'Idea planificada, todavía sin presupuesto aprobado ni equipo asignado.',
    status: ProjectStatus.PLANNED,
    currency: 'ARS',
    leader: 'lider2',
    collaborators: [],
    observers: [],
    start: 30,
    end: 150,
    milestones: [],
    tasks: [
      {
        title: 'Definir alcance del MVP',
        status: TaskStatus.PENDING,
        priority: TaskPriority.LOW,
        start: 30,
        due: 45,
      },
    ],
  },
];

async function seedDemo(): Promise<void> {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      'Definí DEMO_PASSWORD (mínimo 8 caracteres): es la contraseña de todos los usuarios demo. ' +
        "Ej: DEMO_PASSWORD='ClaveSegura123' pnpm --filter @tema/backend seed:demo",
    );
  }

  await dataSource.initialize();
  const passwordHash = await hashPassword(password);

  await dataSource.transaction(async (manager) => {
    // Catalogos: los asegura el propio script para que no dependa de haber corrido `seed` antes.
    await manager
      .createQueryBuilder()
      .insert()
      .into(RoleEntity)
      .values(Object.values(RoleName).map((name) => ({ name })))
      .orIgnore()
      .execute();
    await manager
      .createQueryBuilder()
      .insert()
      .into(CostCategoryEntity)
      .values(
        ['Recursos humanos', 'Licencias y software', 'Servicios de terceros', 'Viáticos y traslados', 'Otros'].map(
          (name) => ({ name }),
        ),
      )
      .orIgnore()
      .execute();

    const roles = new Map((await manager.find(RoleEntity)).map((r) => [r.name, r.id]));
    const categories = new Map((await manager.find(CostCategoryEntity)).map((c) => [c.name, c.id]));

    // ---- Usuarios ----
    const userIds = new Map<string, string>();
    let usersCreated = 0;
    for (const u of USERS) {
      const existing = await manager.findOne(UserEntity, { where: { email: email(u.key) }, withDeleted: true });
      if (existing) {
        userIds.set(u.key, existing.id);
        continue;
      }
      const saved = await manager.save(
        manager.create(UserEntity, { email: email(u.key), name: u.name, active: true, passwordHash }),
      );
      await manager.save(manager.create(UserRoleEntity, { userId: saved.id, roleId: roles.get(u.role)! }));
      userIds.set(u.key, saved.id);
      usersCreated++;
    }
    const uid = (key: string): string => {
      const id = userIds.get(key);
      if (!id) throw new Error(`Usuario demo desconocido: ${key}`);
      return id;
    };

    // ---- Proyectos ----
    let projectsCreated = 0;
    for (const p of PROJECTS) {
      const slug = slugify(p.name);
      if (await manager.findOne(ProjectEntity, { where: { slug }, withDeleted: true })) continue;

      const project = await manager.save(
        manager.create(ProjectEntity, {
          slug,
          name: p.name,
          description: p.description,
          status: p.status,
          startDate: day(p.start),
          estimatedEndDate: day(p.end),
          leaderId: uid(p.leader),
          createdBy: uid('pm'),
          economicCurrency: p.currency,
        }),
      );
      projectsCreated++;

      for (const key of p.collaborators) {
        await manager.save(
          manager.create(ProjectMemberEntity, {
            projectId: project.id,
            userId: uid(key),
            projectRole: ProjectMemberRole.COLLABORATOR,
          }),
        );
      }
      for (const key of p.observers) {
        await manager.save(
          manager.create(ProjectMemberEntity, {
            projectId: project.id,
            userId: uid(key),
            projectRole: ProjectMemberRole.OBSERVER,
          }),
        );
      }

      const milestoneIds = new Map<string, string>();
      for (const m of p.milestones) {
        const ms = await manager.save(
          manager.create(MilestoneEntity, {
            projectId: project.id,
            name: m.name,
            dueDate: day(m.due),
            createdBy: uid(p.leader),
            completedAt: m.done ? new Date(Date.now() + m.due * DAY_MS) : null,
            completedById: m.done ? uid(p.leader) : null,
          }),
        );
        milestoneIds.set(m.name, ms.id);
      }

      const usedSlugs = new Set<string>();
      for (const t of p.tasks) {
        let taskSlug = slugify(t.title, 'tarea');
        for (let n = 2; usedSlugs.has(taskSlug); n++) taskSlug = `${slugify(t.title, 'tarea')}-${n}`;
        usedSlugs.add(taskSlug);

        const task = await manager.save(
          manager.create(TaskEntity, {
            projectId: project.id,
            title: t.title,
            slug: taskSlug,
            description: t.description ?? null,
            status: t.status,
            priority: t.priority,
            assignedToId: t.by ? uid(t.by) : null,
            startDate: day(t.start),
            dueDate: day(t.due),
            milestoneId: t.milestone ? (milestoneIds.get(t.milestone) ?? null) : null,
            createdBy: uid(p.leader),
          }),
        );
        for (const s of t.subtasks ?? []) {
          await manager.save(
            manager.create(SubtaskEntity, {
              taskId: task.id,
              title: s.title,
              assignedToId: s.by ? uid(s.by) : null,
              completed: s.done ?? false,
            }),
          );
        }
      }

      if (p.budget) {
        const entries = Object.entries(p.budget);
        const total = entries.reduce((acc, [, cents]) => acc + cents, 0n);
        const budget = await manager.save(
          manager.create(BudgetEntity, {
            projectId: project.id,
            totalAmount: money(total),
            currency: p.currency,
            version: 1,
            approvalDate: day(p.start + 2),
            createdBy: uid('pm'),
            isCurrent: true,
          }),
        );
        for (const [category, cents] of entries) {
          await manager.save(
            manager.create(BudgetItemEntity, {
              budgetId: budget.id,
              costCategoryId: categories.get(category)!,
              amount: money(cents),
            }),
          );
        }
      }

      for (const c of p.costs ?? []) {
        await manager.save(
          manager.create(CostEntity, {
            projectId: project.id,
            costCategoryId: categories.get(c.category)!,
            amount: money(c.cents),
            currency: p.currency,
            costDate: day(c.offset),
            description: c.description,
            createdBy: uid(p.leader),
          }),
        );
      }
    }

    console.log(
      `Seed demo OK: ${usersCreated} usuarios nuevos, ${projectsCreated} proyectos nuevos ` +
        `(los que ya existían se omitieron).`,
    );
  });

  await dataSource.destroy();
}

seedDemo().catch(async (err) => {
  console.error('seed:demo fallido:', err.message ?? err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
