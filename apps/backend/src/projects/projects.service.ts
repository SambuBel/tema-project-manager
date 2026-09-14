import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository, DataSource } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { ProjectMemberEntity } from '../database/entities/project-member.entity';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectStatus } from '../database/enums';
import { AddProjectMemberDto, UpdateProjectMemberRoleDto } from '@tema/shared-types';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
    @InjectRepository(ProjectMemberEntity)
    private readonly memberRepo: Repository<ProjectMemberEntity>,
    private readonly dataSource: DataSource,
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

  create(dto: CreateProjectDto): Promise<ProjectEntity> {
    const project = this.repo.create({
      ...dto,
      description: dto.description ?? null,
      createdBy: dto.createdBy ?? dto.leaderId,
    });
    return this.repo.save(project);
  }

  async changeStatus(id: string, dto: UpdateProjectStatusDto): Promise<ProjectEntity> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.findOneBy(ProjectEntity, { id });
      if (!project) throw new NotFoundException(`Project ${id} no encontrado`);

      if (project.status === dto.status) {
        return project;
      }

      const history = manager.create(ProjectStatusHistoryEntity, {
        projectId: project.id,
        previousStatus: project.status,
        newStatus: dto.status,
        changedByUserId: dto.changedByUserId,
      });

      project.status = dto.status;
      
      await manager.save(history);
      return manager.save(project);
    });
  }

  async archive(id: string): Promise<ProjectEntity> {
    const project = await this.repo.findOneBy({ id });
    if (!project) throw new NotFoundException(`Project ${id} no encontrado`);
    
    if (project.archivedAt) return project;

    if (project.status !== ProjectStatus.FINISHED && project.status !== ProjectStatus.CANCELLED) {
      throw new BadRequestException('Solo se pueden archivar proyectos FINALIZADOS o CANCELADOS');
    }

    project.archivedAt = new Date();
    return this.repo.save(project);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw new NotFoundException(`Project ${id} no encontrado`);
  }

  async getMembers(projectId: string): Promise<ProjectMemberEntity[]> {
    await this.findOne(projectId); // Ensures project exists
    return this.memberRepo.find({
      where: { projectId, removedAt: IsNull() },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async addMember(projectId: string, dto: AddProjectMemberDto): Promise<ProjectMemberEntity> {
    await this.findOne(projectId);
    
    const existing = await this.memberRepo.findOne({
      where: { projectId, userId: dto.userId, removedAt: IsNull() }
    });
    
    if (existing) {
      throw new ConflictException(`El usuario ya es miembro activo de este proyecto`);
    }

    const member = this.memberRepo.create({
      projectId,
      userId: dto.userId,
      projectRole: dto.projectRole,
    });
    
    try {
      return await this.memberRepo.save(member);
    } catch (error: any) {
      if (error.code === '23503') {
        throw new NotFoundException(`El usuario con ID ${dto.userId} no existe`);
      }
      throw error;
    }
  }

  async updateMemberRole(projectId: string, memberId: string, dto: UpdateProjectMemberRoleDto): Promise<ProjectMemberEntity> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId, projectId, removedAt: IsNull() }
    });
    if (!member) {
      throw new NotFoundException(`Miembro ${memberId} no encontrado en este proyecto`);
    }

    member.projectRole = dto.projectRole;
    return this.memberRepo.save(member);
  }
}
