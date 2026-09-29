import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskEntity } from '../tasks/task.entity';
import { ProjectMemberRole, RoleName } from '../database/enums';
import { RequestUser } from './types/authenticated-request-user';

/**
 * Autorización CONTEXTUAL (capa C de la arquitectura acordada): responde preguntas
 * de negocio ("¿puede este usuario administrar ESTE proyecto?") que necesitan mirar
 * el recurso concreto, algo que RolesGuard (capa B, puramente RBAC global) no puede
 * resolver. Los controllers/services llaman a estos métodos explícitamente y lanzan
 * ForbiddenException si dan false — no es un guard con reflection genérico a
 * propósito: la mayoría de estos checks necesitan una entidad que el service ya fue
 * a buscar, y un guard separado la volvería a consultar.
 *
 * Reglas de PROJECT_LEADER, en toda esta clase:
 *   - "es líder de este proyecto" = project.leaderId === user.id, SIEMPRE.
 *   - RoleName.PROJECT_LEADER (rol GLOBAL) nunca por sí solo habilita administrar
 *     un proyecto concreto: solo dice que el usuario PUEDE desempeñarse como líder
 *     (habilita crear proyectos, y es requisito para que se lo pueda nombrar líder
 *     de uno vía changeLeader). Ver auth/auth.service.ts y projects/projects.service.ts.
 */
@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(ProjectMemberEntity)
    private readonly projectMembersRepo: Repository<ProjectMemberEntity>,
  ) {}

  /** RBAC global "de mano", para usar dentro de una policy sin pasar por el guard. */
  hasAnyGlobalRole(user: RequestUser, roles: RoleName[]): boolean {
    return roles.some((role) => user.roles.includes(role));
  }

  /** Único criterio válido de liderazgo: nunca ProjectMember.projectRole. */
  isProjectLeader(user: RequestUser, project: ProjectEntity): boolean {
    return project.leaderId === user.id;
  }

  /**
   * La fila de project_members del usuario en ese proyecto, o null si no participa
   * (o participó y fue dado de baja: removedAt). Devuelve la entidad completa —no un
   * boolean— porque quien la use necesita distinguir COLLABORATOR de OBSERVER (ver
   * punto 0 de la HU: un COLLABORATOR global con projectRole=OBSERVER en ESTE
   * proyecto es solo lectura acá, aunque pueda escribir en otros). Se usará para las
   * policies de escritura de Tasks en el próximo paso; canViewProject de abajo solo
   * necesita saber si existe.
   */
  getProjectMembership(userId: string, projectId: string): Promise<ProjectMemberEntity | null> {
    return this.projectMembersRepo.findOne({
      where: { userId, projectId, removedAt: IsNull() },
    });
  }

  /**
   * ADMIN/PROGRAM_MANAGER: cualquier proyecto. Líder (leaderId): el propio. Resto:
   * solo si tiene una fila de membership (COLLABORATOR u OBSERVER, ambos pueden ver).
   */
  async canViewProject(user: RequestUser, project: ProjectEntity): Promise<boolean> {
    if (this.hasAnyGlobalRole(user, [RoleName.ADMIN, RoleName.PROGRAM_MANAGER])) return true;
    if (this.isProjectLeader(user, project)) return true;

    const membership = await this.getProjectMembership(user.id, project.id);
    return membership !== null;
  }

  /**
   * Patrón que se repite en gran parte de las policies de esta clase (proyecto y
   * tarea): ADMIN/PROGRAM_MANAGER siempre, o ser el líder de ESE proyecto puntual.
   * PROJECT_LEADER (rol global) nunca alcanza por sí solo. Privado: cada policy
   * pública mantiene su propio nombre de negocio (canManageProject, canDeleteTask,
   * etc.), esto es solo para no repetir la misma línea en cada una.
   */
  private isAdminPmOrLeader(user: RequestUser, project: ProjectEntity): boolean {
    return this.hasAnyGlobalRole(user, [RoleName.ADMIN, RoleName.PROGRAM_MANAGER]) || this.isProjectLeader(user, project);
  }

  /**
   * ADMIN/PROGRAM_MANAGER: cualquier proyecto. PROJECT_LEADER (rol global) NO
   * alcanza por sí solo: solo el leaderId de ESTE proyecto. Collaborator/Observer:
   * nunca, sin importar su membership.
   */
  canManageProject(user: RequestUser, project: ProjectEntity): boolean {
    return this.isAdminPmOrLeader(user, project);
  }

  /** Misma regla que canManageProject: administrar el equipo es administrar el proyecto. */
  canManageProjectTeam(user: RequestUser, project: ProjectEntity): boolean {
    return this.canManageProject(user, project);
  }

  // ---------------------------------------------------------------------------
  // Económicos: preparados para cuando existan endpoints de Budget/Cost (no en
  // esta HU). Tres policies separadas a propósito, nunca una sola bandera
  // "económico=true/false" — ver punto 1 de la definición de esta HU:
  //   - PROJECT_LEADER puede ver/gestionar costos SOLO en lo que lidera, pero
  //     nunca puede definir presupuesto (eso es exclusivo de ADMIN/PM).
  // ---------------------------------------------------------------------------

  /** Solo ADMIN/PROGRAM_MANAGER, sin excepción — ni el líder del proyecto define presupuesto. */
  canDefineBudget(user: RequestUser): boolean {
    return this.hasAnyGlobalRole(user, [RoleName.ADMIN, RoleName.PROGRAM_MANAGER]);
  }

  /** ADMIN/PROGRAM_MANAGER en cualquier proyecto; PROJECT_LEADER solo en el que lidera. */
  canManageCosts(user: RequestUser, project: ProjectEntity): boolean {
    return this.isAdminPmOrLeader(user, project);
  }

  /** Misma regla que canManageCosts: quien gestiona costos puede verlos. Collaborator/Observer nunca. */
  canViewEconomicData(user: RequestUser, project: ProjectEntity): boolean {
    return this.canManageCosts(user, project);
  }

  // ---------------------------------------------------------------------------
  // Tasks (paso 4). Todas reciben el `project` ya cargado por el caller (el
  // service de turno ya tuvo que ir a buscarlo para el 404), nunca lo vuelven a
  // consultar acá — solo getProjectMembership hace query, y una sola vez por policy.
  // ---------------------------------------------------------------------------

  /** Ver una tarea es ver su proyecto: mismo criterio, sin reglas adicionales por tarea. */
  canViewTask(user: RequestUser, project: ProjectEntity): Promise<boolean> {
    return this.canViewProject(user, project);
  }

  /**
   * ADMIN/PROGRAM_MANAGER/líder: siempre. Para el resto, el ROL LOCAL del
   * proyecto manda, nunca el rol global: solo projectRole === COLLABORATOR crea
   * tareas. Un COLLABORATOR global con projectRole OBSERVER en ESTE proyecto no
   * puede (ver punto 0 de la HU de Projects — el bug que motivó todo esto).
   */
  async canCreateTask(user: RequestUser, project: ProjectEntity): Promise<boolean> {
    if (this.isAdminPmOrLeader(user, project)) return true;

    const membership = await this.getProjectMembership(user.id, project.id);
    return membership?.projectRole === ProjectMemberRole.COLLABORATOR;
  }

  /**
   * ADMIN/PROGRAM_MANAGER/líder: cualquier tarea del proyecto. COLLABORATOR (con
   * projectRole COLLABORATOR en ESTE proyecto): solo si la creó o está asignada a
   * él/ella — task.createdBy/assignedToId son los únicos campos del modelo que
   * representan "propia"/"asignada", no se inventa ningún campo nuevo. OBSERVER:
   * nunca, sin importar ownership.
   */
  async canEditTask(user: RequestUser, task: TaskEntity, project: ProjectEntity): Promise<boolean> {
    if (this.isAdminPmOrLeader(user, project)) return true;

    const membership = await this.getProjectMembership(user.id, project.id);
    if (membership?.projectRole !== ProjectMemberRole.COLLABORATOR) return false;

    return task.createdBy === user.id || task.assignedToId === user.id;
  }

  /**
   * Eliminar tarea (RN-07: baja lógica, nunca borrado físico — ver
   * TasksService.archive). Nunca depende de ownership ni de projectRole local:
   * ni siquiera el COLLABORATOR dueño/asignado de la tarea puede borrarla/archivarla.
   * Sin membership de por medio: no hace falta query extra.
   */
  canDeleteTask(user: RequestUser, project: ProjectEntity): boolean {
    return this.isAdminPmOrLeader(user, project);
  }

  /**
   * Fechas, dependencias y planificación en general: misma regla que
   * canDeleteTask (ADMIN/PROGRAM_MANAGER/líder únicamente), pero como policy
   * separada porque conceptualmente es una decisión de negocio distinta — hoy dan
   * el mismo resultado, el día que dejen de coincidir no hay que tocar ambos call
   * sites, solo esta policy.
   */
  canManageTaskPlanning(user: RequestUser, project: ProjectEntity): boolean {
    return this.isAdminPmOrLeader(user, project);
  }
}
