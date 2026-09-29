import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from './task.entity';
import { ProjectEntity } from '../projects/project.entity';
import { TaskPriority, TaskStatus } from '../database/enums';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

/**
 * Toda decisión de AUTORIZACIÓN (quién puede ver/crear/editar/borrar) vive en
 * PermissionsService — este service ya no tiene su propia lógica de "es líder o
 * miembro" (existía como assertProjectMember/isProjectMember, duplicando lo que
 * ya resolvía PermissionsService para Projects; eliminada en el paso 4). Lo único
 * que queda acá es RN-03 (el responsable asignado debe pertenecer al proyecto),
 * que no es una decisión sobre QUIEN PIDE la acción sino una validación del DATO
 * enviado — por eso es un helper técnico propio, no una policy.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly repo: Repository<TaskEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    private readonly usersService: UsersService,
    private readonly permissions: PermissionsService,
  ) {}

  private async findProjectOrThrow(projectId: string): Promise<ProjectEntity> {
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} no encontrado`);
    }
    return project;
  }

  /** Sin chequeo de autorización: uso interno para operaciones que ya validan permisos por su cuenta. */
  private async findTaskOrThrow(id: string): Promise<TaskEntity> {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['project', 'assignedTo'],
    });
    if (!task) {
      throw new NotFoundException(`Task ${id} no encontrada`);
    }
    return task;
  }

  /**
   * RN-03: el responsable de una tarea tiene que existir (404 si no, evita un 500
   * por FK) y pertenecer al proyecto — líder o con una fila activa en
   * project_members (cualquier projectRole: un OBSERVER puede figurar como
   * responsable histórico aunque hoy no pueda editar la tarea él mismo; eso no lo
   * dice ninguna regla, así que no lo restrinjo). Reutiliza
   * PermissionsService.getProjectMembership en vez de consultar project_members
   * de nuevo acá.
   */
  private async assertAssigneeIsProjectMember(project: ProjectEntity, assigneeId: string): Promise<void> {
    const assignee = await this.usersService.findById(assigneeId);
    if (!assignee) {
      throw new NotFoundException(`El usuario responsable ${assigneeId} no existe`);
    }

    const isLeader = project.leaderId === assigneeId;
    const membership = isLeader ? null : await this.permissions.getProjectMembership(assigneeId, project.id);

    if (!isLeader && !membership) {
      throw new BadRequestException('El responsable debe ser miembro del proyecto');
    }
  }

  async create(dto: CreateTaskDto, user: RequestUser): Promise<TaskEntity> {
    const project = await this.findProjectOrThrow(dto.projectId);

    const allowed = await this.permissions.canCreateTask(user, project);
    if (!allowed) {
      throw new ForbiddenException('No podés crear tareas en este proyecto.');
    }

    if (dto.assignedToId) {
      await this.assertAssigneeIsProjectMember(project, dto.assignedToId);
    }

    const task = new TaskEntity();
    task.projectId = dto.projectId;
    task.title = dto.title;
    task.description = dto.description ?? null;
    task.status = dto.status ?? TaskStatus.PENDING;
    task.priority = dto.priority ?? TaskPriority.MEDIUM;
    task.assignedToId = dto.assignedToId ?? null;
    task.startDate = dto.startDate ?? null;
    task.dueDate = dto.dueDate ?? null;
    task.createdBy = user.id;

    return this.repo.save(task);
  }

  async findAllByProject(projectId: string, user: RequestUser): Promise<TaskEntity[]> {
    const project = await this.findProjectOrThrow(projectId);

    const allowed = await this.permissions.canViewTask(user, project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a este proyecto.');
    }

    return this.repo.find({
      where: { projectId },
      relations: ['assignedTo', 'project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: RequestUser): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = await this.permissions.canViewTask(user, task.project);
    if (!allowed) {
      throw new ForbiddenException('No tenés acceso a esta tarea.');
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto, user: RequestUser): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = await this.permissions.canEditTask(user, task, task.project);
    if (!allowed) {
      throw new ForbiddenException('No podés editar esta tarea.');
    }

    if (dto.assignedToId) {
      await this.assertAssigneeIsProjectMember(task.project, dto.assignedToId);
    }

    Object.assign(task, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId ?? null } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate ?? null } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ?? null } : {}),
    });

    return this.repo.save(task);
  }

  /**
   * "Eliminar tarea" de la matriz funcional: RN-07 exige baja lógica para
   * registros con historial (Comments/TaskDependencies referencian tasks), así
   * que esto es archivar (archivedAt), nunca un DELETE físico. Usa
   * canDeleteTask, la misma policy que tendría un DELETE real: COLLABORATOR y
   * OBSERVER nunca, ni siquiera sobre tareas propias/asignadas — a diferencia de
   * canEditTask, acá el ownership no habilita nada.
   *
   * Idempotente: archivar una tarea ya archivada no vuelve a guardar.
   */
  async archive(id: string, user: RequestUser): Promise<TaskEntity> {
    const task = await this.findTaskOrThrow(id);

    const allowed = this.permissions.canDeleteTask(user, task.project);
    if (!allowed) {
      throw new ForbiddenException('No podés eliminar esta tarea.');
    }

    if (task.archivedAt) {
      return task;
    }

    task.archivedAt = new Date();
    return this.repo.save(task);
  }
}
