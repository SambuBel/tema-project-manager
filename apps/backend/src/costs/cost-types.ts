/** Proyecto leído bajo FOR SHARE al registrar un costo: período (YYYY-MM-DD, puede faltar) y su moneda única. */
export interface LockedProject {
  startDate: string | null;
  endDate: string | null;
  currency: string;
}

/** Rubro leído bajo FOR SHARE. */
export interface LockedCategory {
  id: string;
  name: string;
  active: boolean;
}

/** Presupuesto vigente (is_current = true) contra el que se valida el rubro. */
export interface CurrentBudget {
  id: string;
  version: number;
}

/** Qué confirmaciones explícitas de fecha se usaron al registrar el costo (RN-21 y BUG-10); van a la auditoría. */
export interface DateConfirmations {
  confirmedBeforeProjectStart: boolean;
  confirmedAfterProjectEnd: boolean;
}

/** Textos que cambian según se registre o se edite un costo; el resto de las reglas y errores es idéntico. */
export interface OperationTexts {
  /** Cierre del log de integridad (hay versiones de presupuesto pero ninguna vigente): qué no se hizo. */
  skippedAction: string;
  /** Mensaje del 409 cuando el proyecto nunca tuvo presupuesto. */
  noBudget: string;
  /** Mensaje del 400 cuando el rubro está inactivo. */
  inactiveCategory: string;
  /** Verbo con que se pide confirmar una fecha fuera del período del proyecto ("Confirmalo explícitamente para …"). */
  confirmTo: string;
}

/** Campos editables de un costo tal como quedarían (importes y fechas como texto, formas canónicas). */
export interface CostState {
  costDate: string;
  amount: string;
  currency: string;
  costCategoryId: string;
  description: string;
  taskId: string | null;
}

/** Estado actual del costo leído bajo FOR UPDATE (importes y fechas como texto). */
export interface CurrentCost {
  id: string;
  taskId: string | null;
  costCategoryId: string;
  categoryName: string;
  amount: string;
  currency: string;
  costDate: string;
  description: string;
  revision: number;
}
