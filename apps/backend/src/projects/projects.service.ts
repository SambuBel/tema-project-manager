import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository, DataSource } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';
import { UpdateProjectStatusDto } from './update-project-status.dto';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectStatus } from '../database/enums';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
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
    const project = await this.repo.findOneBy({ id });
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

      // FIXME: DEPENDENCY BLOCKER
      // The `changedByUserId` is required by the entity/DB but there is no Auth module yet.
      // We are leaving the logic prepared, but this will fail in DB until it is resolved.
      // Do NOT invent users or hardcode UUIDs.
      const history = manager.create(ProjectStatusHistoryEntity, {
        projectId: project.id,
        previousStatus: project.status,
        newStatus: dto.status,
        changedByUserId: dto.changedByUserId, // This will be undefined for now and will fail DB FK if not provided correctly by controller/auth
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
}
