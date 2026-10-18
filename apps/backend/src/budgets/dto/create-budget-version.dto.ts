import { IsInt, Min } from 'class-validator';
import type { CreateBudgetVersionDto as ICreateBudgetVersionDto } from '@tema/shared-types';
import { CreateBudgetDto } from './create-budget.dto';

/**
 * Nueva versión del presupuesto: mismos campos y reglas que el alta inicial (heredados) más `expectedVersion`, la versión
 * vigente que el usuario tenía en pantalla. OBLIGATORIO: sin él no habría forma de detectar que alguien más modificó el
 * presupuesto entre medio (RNF-20).
 */
export class CreateBudgetVersionDto extends CreateBudgetDto implements ICreateBudgetVersionDto {
  @IsInt({ message: 'expectedVersion debe ser un número entero' })
  @Min(1, { message: 'expectedVersion debe ser 1 o mayor' })
  expectedVersion!: number;
}
