import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsDto } from './list-projects.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
  ) {}

  findAll(query: ListProjectsDto = {}): Promise<ProjectEntity[]> {
    return this.repo.find({
      where: {
        archivedAt: IsNull(),
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

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw new NotFoundException(`Project ${id} no encontrado`);
  }
}
