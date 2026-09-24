import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface ProjectActivityListProps {
  projectId: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', { 
    day: '2-digit', month: 'short', year: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  });
}

const FIELD_TRANSLATIONS: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  startDate: 'Fecha de inicio',
  estimatedEndDate: 'Fecha estimada de finalización',
  dueDate: 'Fecha de vencimiento',
  title: 'Título',
  status: 'Estado',
  priority: 'Prioridad',
  assignedToId: 'Responsable',
  rol: 'Rol',
};

const VALUE_TRANSLATIONS: Record<string, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'Pausado',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
  PENDING: 'Pendiente',
  COMPLETED: 'Completada',
  BLOCKED: 'Bloqueado',
  LEADER: 'Líder',
  COLLABORATOR: 'Colaborador',
  OBSERVER: 'Observador',
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
};

function translateField(key: string) {
  return FIELD_TRANSLATIONS[key] || key;
}

function translateValue(key: string, value: any) {
  if (value === null || value === undefined || value === '') return 'Sin definir';
  
  if (typeof value === 'string' && VALUE_TRANSLATIONS[value]) {
    return VALUE_TRANSLATIONS[value];
  }
  
  // Si es fecha (formato YYYY-MM-DD o similar)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    // Evita corrimientos de zona horaria usando substring y split
    const [y, m, d] = (value.split('T')[0] as string).split('-');
    return `${d}/${m}/${y}`;
  }

  return String(value);
}

function ActivityItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  
  const changes = item.metadata?.changes;
  const hasChanges = changes && Object.keys(changes).length > 0;
  
  let actionText = '';
  switch (item.actionType) {
    case 'PROJECT_CREATED': 
      actionText = 'creó el proyecto'; 
      break;
    case 'PROJECT_ARCHIVED': 
      actionText = 'archivó el proyecto'; 
      break;
    case 'MEMBER_ADDED': 
      actionText = `agregó a ${item.metadata?.name || 'un integrante'} al proyecto`; 
      break;
    case 'MEMBER_ROLE_CHANGED': 
      actionText = `cambió el rol de ${item.metadata?.name || 'un integrante'} de ${translateValue('rol', item.metadata?.previousRole)} a ${translateValue('rol', item.metadata?.newRole)}`; 
      break;
    case 'TASK_CREATED': 
      actionText = `creó la tarea "${item.metadata?.title || 'Sin título'}"`; 
      break;
    case 'TASK_DELETED': 
      actionText = `eliminó la tarea "${item.metadata?.title || ''}"`; 
      break;
    case 'STATUS_CHANGED': 
      actionText = `cambió el estado de ${translateValue('status', item.metadata?.previousStatus)} a ${translateValue('status', item.metadata?.newStatus)}`; 
      break;
    case 'PROJECT_UPDATED':
      if (hasChanges) {
        const keys = Object.keys(changes);
        if (keys.length === 1) {
          actionText = `cambió el campo ${translateField(keys[0] as string).toLowerCase()} del proyecto`;
        } else {
          actionText = `actualizó ${keys.length} campos del proyecto`;
        }
      } else {
        actionText = 'actualizó el proyecto';
      }
      break;
    case 'TASK_UPDATED':
      if (hasChanges) {
        const keys = Object.keys(changes);
        if (keys.length === 1) {
          actionText = `cambió el campo ${translateField(keys[0] as string).toLowerCase()} de la tarea "${item.metadata?.title || ''}"`;
        } else {
          actionText = `actualizó ${keys.length} campos de la tarea "${item.metadata?.title || ''}"`;
        }
      } else {
        actionText = `actualizó la tarea "${item.metadata?.title || ''}"`;
      }
      break;
    default: 
      actionText = `realizó una acción (${item.actionType})`;
  }

  return (
    <div className="flex gap-4 p-4 rounded-xl border border-[#DEE5EC] bg-white items-start">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EAF2F7] text-sm font-semibold text-[#245B78]">
        {item.actor?.avatar || '?'}
      </div>
      
      <div className="flex flex-col w-full">
        <p className="text-sm text-[#172B42]">
          <span className="font-semibold">{item.actor?.name || 'Usuario'}</span>{' '}
          {actionText}
        </p>
        
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-[#607185]">
            {formatDate(item.createdAt)}
          </span>
          {hasChanges && (
            <button 
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-medium text-[#245B78] hover:underline flex items-center transition-colors"
            >
              [{expanded ? 'Ocultar cambios' : 'Ver cambios'}]
            </button>
          )}
        </div>
        
        {expanded && hasChanges && (
          <div className="mt-3 flex flex-col gap-3 bg-[#F8FAFC] p-3 rounded-lg border border-[#DEE5EC] text-sm text-[#172B42]">
            {Object.entries(changes).map(([key, vals]: [string, any]) => (
              <div key={key} className="flex flex-col">
                <span className="font-semibold text-[#607185] text-[11px] uppercase tracking-wider mb-1">
                  {translateField(key)}
                </span>
                <div className="flex items-center gap-2 break-all text-sm">
                  <span className="line-through text-[#607185] opacity-80">{translateValue(key, vals.old)}</span>
                  <span className="text-[#607185] font-bold">→</span>
                  <span className="font-medium text-[#172B42]">{translateValue(key, vals.new)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectActivityList({ projectId }: ProjectActivityListProps) {
  const { data: activities, isLoading, isError } = useQuery({
    queryKey: ['project', projectId, 'activity'],
    queryFn: () => api.getProjectActivity(projectId),
  });

  if (isLoading) return <p className="text-[#607185] italic mt-4">Cargando actividad...</p>;
  if (isError) return <p className="text-red-600 mt-4">Error al cargar la actividad.</p>;
  if (!activities || activities.length === 0) {
    return <p className="text-[#607185] italic mt-4">No hay actividad registrada aún.</p>;
  }

  return (
    <div className="flex flex-col gap-4 mt-4">
      {activities.map((item) => (
        <ActivityItem key={item.id} item={item} />
      ))}
    </div>
  );
}
