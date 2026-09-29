import { Injectable } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ProjectActivityEntity } from '../database/entities/project-activity.entity';
import { ProjectStatusHistoryEntity } from '../database/entities/project-status-history.entity';
import { ProjectActivityAction, ProjectActivityEntityType } from '../database/enums';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectEntity } from './project.entity';

export interface CreateActivityParams {
  projectId: string;
  actorId: string;
  actionType: ProjectActivityAction;
  entityType: ProjectActivityEntityType;
  entityId?: string | null;
  metadata?: any;
}

@Injectable()
export class ProjectActivityService {
  constructor(
    @InjectRepository(ProjectActivityEntity)
    private readonly repo: Repository<ProjectActivityEntity>,
    @InjectRepository(ProjectStatusHistoryEntity)
    private readonly statusRepo: Repository<ProjectStatusHistoryEntity>,
  ) {}

  /**
   * Registra un evento. Si recibe un manager (transacción), lo usa para guardar atómicamente.
   */
  async logEvent(params: CreateActivityParams, manager?: EntityManager): Promise<ProjectActivityEntity> {
    const m = manager ?? this.repo.manager;
    const activity = m.create(ProjectActivityEntity, {
      ...params,
      entityId: params.entityId ?? null,
      metadata: params.metadata ?? null,
    });
    return m.save(activity);
  }

  /**
   * Obtiene la actividad unificada (estados + eventos generales).
   */
  async getActivity(projectId: string, limit = 50, offset = 0): Promise<any[]> {
    const take = limit + offset; // Obtenemos un bloque lo suficientemente grande de ambas fuentes
    
    // Buscar eventos generales
    const activities = await this.repo.find({
      where: { projectId },
      relations: ['actor'],
      order: { createdAt: 'DESC' },
      take,
    });

    // Buscar eventos de estado
    const statusChanges = await this.statusRepo.find({
      where: { projectId },
      relations: ['changedByUser'],
      order: { changedAt: 'DESC' },
      take,
    });

    // Mapear al mismo formato visual/JSON
    const mappedActivities = activities.map(a => ({
      id: a.id,
      type: 'GENERAL',
      actionType: a.actionType,
      entityType: a.entityType,
      entityId: a.entityId,
      metadata: a.metadata,
      actor: { id: a.actor.id, name: a.actor.name, avatar: a.actor.name.substring(0,2).toUpperCase() },
      createdAt: a.createdAt,
    }));

    const mappedStatus = statusChanges.map(s => ({
      id: s.id,
      type: 'STATUS_CHANGE',
      actionType: 'STATUS_CHANGED',
      entityType: 'PROJECT',
      entityId: s.projectId,
      metadata: { previousStatus: s.previousStatus, newStatus: s.newStatus },
      actor: { id: s.changedByUser.id, name: s.changedByUser.name, avatar: s.changedByUser.name.substring(0,2).toUpperCase() },
      createdAt: s.changedAt,
    }));

    // Combinar, ordenar cronológicamente y tomar la paginación final
    const combined = [...mappedActivities, ...mappedStatus];
    
    // Sort descending by date, then deterministic tie break by ID
    combined.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    return combined.slice(offset, offset + limit);
  }
}
