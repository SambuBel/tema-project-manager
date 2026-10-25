import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CostCategory } from '@tema/shared-types';
import { CostCategoryEntity } from '../database/entities/cost-category.entity';
import { PermissionsService } from '../auth/permissions.service';
import { RequestUser } from '../auth/types/authenticated-request-user';

/**
 * Catálogo de rubros (solo lectura). Alta, edición y desactivación son CAT-01. Devuelve ÚNICAMENTE los activos, para
 * operaciones nuevas: un presupuesto histórico conserva (y muestra) sus rubros aunque hoy estén inactivos, eso lo resuelve
 * quien lee el presupuesto, no este catálogo.
 */
@Injectable()
export class CostCategoriesService {
  constructor(
    @InjectRepository(CostCategoryEntity) private readonly categories: Repository<CostCategoryEntity>,
    private readonly permissions: PermissionsService,
  ) {}

  async listActive(user: RequestUser): Promise<CostCategory[]> {
    if (!this.permissions.canViewCostCategories(user)) {
      throw new ForbiddenException('No tenés permisos para ver los rubros de costo.');
    }
    const rows = await this.categories.find({ where: { active: true }, order: { name: 'ASC', id: 'ASC' } });
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }
}
