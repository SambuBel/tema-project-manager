import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository, DataSource, EntityManager } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { UserEntity } from '../database/entities/user.entity';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectDtoImpl } from './update-project.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectStatus, ProjectActivityAction, ProjectActivityEntityType } from '../database/enums';
import { AddProjectMemberDto, UpdateProjectMemberRoleDto } from '@tema/shared-types';
import { UsersService } from '../users/users.service';
import { ProjectActivityService } from './project-activity.service';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
    @InjectRepository(ProjectMemberEntity)
    private readonly memberRepo: Repository<ProjectMemberEntity>,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
    private readonly activityService: ProjectActivityService,
  ) {}

  findAll(query: ListProjectsDto = {}): Promise<ProjectEntity[]> {
    return this.repo.find({
      where: {
        archivedAt: query.archived ? Not(IsNull()) : IsNull(),
        ...(query.status ? { status: query.status } : {}),
        ...(query.name ? { name: ILike(`%${query.name}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ProjectEntity> {
    const project = await this.repo.findOne({
      where: { id },
      relations: ['leader'],
    });
    if (!project) throw new NotFoundException(`Project ${id} no encontrado`);
    return project;
  }

  async checkIsMemberOrLeader(projectId: string, userId: string): Promise<boolean> {
    const project = await this.findOne(projectId);
    if (project.leaderId === userId) return true;
    
    const isMember = await this.memberRepo.count({
      where: { projectId, userId, removedAt: IsNull() }
    });
    return isMember > 0;
  }

  async create(dto: CreateProjectDto, user: UserEntity): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = manager.create(ProjectEntity, {
        ...dto,
        description: dto.description ?? null,
        leaderId: user.id,
        createdBy: user.id,
      });
      const savedProject = await manager.save(project);

      await this.activityService.logEvent({
        projectId: savedProject.id,
        actorId: user.id,
        actionType: ProjectActivityAction.PROJECT_CREATED,
        entityType: ProjectActivityEntityType.PROJECT,
        entityId: savedProject.id,
        metadata: { name: savedProject.name },
      }, manager);

      return savedProject;
    });
  }

  async update(id: string, dto: UpdateProjectDtoImpl, user: UserEntity): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOne(ProjectEntity, { where: { id } });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

      if (project.leaderId !== user.id) {
        throw new ForbiddenException('Solo el lider del proyecto puede eliminarlo');
      }

      if (project.leaderId !== user.id) {
        throw new ForbiddenException('Solo el líder del proyecto puede modificar el proyecto');
      }

      const changes: Record<string, { old: any, new: any }> = {};
      if (dto.name !== undefined && dto.name !== project.name) {
        changes.name = { old: project.name, new: dto.name };
        project.name = dto.name;
      }
      if (dto.description !== undefined && dto.description !== project.description) {
        changes.description = { old: project.description, new: dto.description };
        project.description = dto.description ?? null;
      }
      if (dto.estimatedEndDate !== undefined && dto.estimatedEndDate !== project.estimatedEndDate) {
        changes.estimatedEndDate = { old: project.estimatedEndDate, new: dto.estimatedEndDate };
        project.estimatedEndDate = dto.estimatedEndDate;
      }
      if (dto.startDate !== undefined && dto.startDate !== project.startDate) {
        changes.startDate = { old: project.startDate, new: dto.startDate };
        project.startDate = dto.startDate;
      }

      if (Object.keys(changes).length === 0) {
        return project; // No changes to log or save
      }

      const updatedProject = await manager.save(project);

      await this.activityService.logEvent({
        projectId: updatedProject.id,
        actorId: user.id,
        actionType: ProjectActivityAction.PROJECT_UPDATED,
        entityType: ProjectActivityEntityType.PROJECT,
        entityId: updatedProject.id,
        metadata: { changes },
      }, manager);

      return updatedProject;
    });
  }

  async changeStatus(id: string, dto: UpdateProjectStatusDto, user: UserEntity): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

      if (project.leaderId !== user.id) {
        throw new ForbiddenException('Solo el lider del proyecto puede eliminarlo');
      }

      if (project.status === dto.status) {
        return project;
      }

      const history = manager.create(ProjectStatusHistoryEntity, {
        projectId: project.id,
        previousStatus: project.status,
        newStatus: dto.status,
        changedByUserId: user.id,
      });

      project.status = dto.status;
      
      await manager.save(history);
      return manager.save(project);
    });
  }

  async archive(id: string, user: UserEntity): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);
      
      if (project.archivedAt) return project;

      if (project.status !== ProjectStatus.FINISHED && project.status !== ProjectStatus.CANCELLED) {
        throw new BadRequestException('Solo se pueden archivar proyectos FINALIZADOS o CANCELADOS');
      }

      project.archivedAt = new Date();
      const archivedProject = await manager.save(project);

      await this.activityService.logEvent({
        projectId: archivedProject.id,
        actorId: user.id,
        actionType: ProjectActivityAction.PROJECT_ARCHIVED,
        entityType: ProjectActivityEntityType.PROJECT,
        entityId: archivedProject.id,
      }, manager);

      return archivedProject;
    });
  }

  async remove(id: string, user: UserEntity): Promise<void> {
    // Para conservar el historial atómicamente, deberíamos ejecutar esto en transacción, 
    // pero si el DELETE del proyecto hace CASCADE, el historial se borra igual en BD relacional. 
    // Dejo la ejecución de ambos eventos. Se requiere decisión del equipo sobre Soft Delete vs CASCADE.
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOne(ProjectEntity, { where: { id } });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

      if (project.leaderId !== user.id) {
        throw new ForbiddenException('Solo el lider del proyecto puede eliminarlo');
      }

      await this.activityService.logEvent({
        projectId: project.id,
        actorId: user.id,
        actionType: ProjectActivityAction.PROJECT_DELETED,
        entityType: ProjectActivityEntityType.PROJECT,
        entityId: project.id,
        metadata: { name: project.name }
      }, manager);

      const result = await manager.softDelete(ProjectEntity, { id });
      if (!result.affected) throw new NotFoundException(`Project ${id} no encontrado`);
    });
  }

  async getMembers(projectId: string): Promise<ProjectMemberEntity[]> {
    await this.findOne(projectId); // Ensures project exists
    return this.memberRepo.find({
      where: { projectId, removedAt: IsNull() },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async addMember(projectId: string, dto: AddProjectMemberDto, user: UserEntity): Promise<ProjectMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);
      
      if (project.leaderId !== user.id) {
        throw new ForbiddenException('Solo el líder del proyecto puede agregar miembros');
      }
      
      const userExists = await this.usersService.findById(dto.userId);
      if (!userExists) {
        throw new NotFoundException(`El usuario con ID ${dto.userId} no existe`);
      }
      
      const existing = await manager.findOne(ProjectMemberEntity, {
        where: { projectId, userId: dto.userId, removedAt: IsNull() }
      });
      
      if (existing) {
        throw new ConflictException(`El usuario ya es miembro activo de este proyecto`);
      }

      const member = manager.create(ProjectMemberEntity, {
        projectId,
        userId: dto.userId,
        projectRole: dto.projectRole,
      });
      
      const savedMember = await manager.save(member);

      await this.activityService.logEvent({
        projectId,
        actorId: user.id,
        actionType: ProjectActivityAction.MEMBER_ADDED,
        entityType: ProjectActivityEntityType.MEMBER,
        entityId: savedMember.id,
        metadata: { userId: dto.userId, role: dto.projectRole, name: userExists.name },
      }, manager);

      return savedMember;
    });
  }

  async updateMemberRole(projectId: string, memberId: string, dto: UpdateProjectMemberRoleDto, user: UserEntity): Promise<ProjectMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id: projectId });
      if (!project) throw new NotFoundException(`Project ${projectId} no encontrado`);

      if (project.leaderId !== user.id) {
        throw new ForbiddenException('Solo el líder del proyecto puede modificar roles');
      }

      const member = await manager.findOne(ProjectMemberEntity, {
        where: { id: memberId, projectId, removedAt: IsNull() },
        relations: ['user']
      });
      if (!member) {
        throw new NotFoundException(`Miembro ${memberId} no encontrado en este proyecto`);
      }

      const previousRole = member.projectRole;
      member.projectRole = dto.projectRole;
      const savedMember = await manager.save(member);

      await this.activityService.logEvent({
        projectId,
        actorId: user.id,
        actionType: ProjectActivityAction.MEMBER_ROLE_CHANGED,
        entityType: ProjectActivityEntityType.MEMBER,
        entityId: savedMember.id,
        metadata: { previousRole, newRole: dto.projectRole, userId: savedMember.userId, name: member.user?.name },
      }, manager);

      return savedMember;
    });
  }
}






