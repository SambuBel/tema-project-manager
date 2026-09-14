import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CreateProjectDto } from '@tema/shared-types';

export function ProjectForm() {
  const qc = useQueryClient();
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: '',
    estimatedEndDate: '',
  });

  const create = useMutation({
    mutationFn: (data: CreateProjectDto) => api.createProject(data),
    onSuccess: () => {
      setFormData({
        name: '',
        description: '',
        startDate: '',
        estimatedEndDate: '',
      });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    
    // FIXME: DEPENDENCY BLOCKER
    // El backend requiere 'leaderId' pero no existe módulo de Usuarios/Auth para obtener uno.
    // Se envía un string vacío temporalmente para satisfacer TypeScript, lo que resultará en un 400 Bad Request.
    const payload: CreateProjectDto = {
      name: formData.name.trim(),
      leaderId: '', 
    };
    
    if (formData.description.trim()) payload.description = formData.description.trim();
    if (formData.startDate.trim()) payload.startDate = formData.startDate;
    if (formData.estimatedEndDate.trim()) payload.estimatedEndDate = formData.estimatedEndDate;

    create.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-4 rounded border border-gray-200 p-4">
      <h2 className="text-lg font-semibold">Nuevo Proyecto</h2>
      
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">Nombre *</label>
        <input
          id="name"
          required
          className="rounded border border-gray-300 px-3 py-2"
          placeholder="Nombre del proyecto"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium">Descripción</label>
        <textarea
          id="description"
          className="rounded border border-gray-300 px-3 py-2"
          placeholder="Descripción del proyecto"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="startDate" className="text-sm font-medium">Fecha de Inicio</label>
          <input
            id="startDate"
            type="date"
            className="rounded border border-gray-300 px-3 py-2"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="estimatedEndDate" className="text-sm font-medium">Fecha Estimada de Fin</label>
          <input
            id="estimatedEndDate"
            type="date"
            className="rounded border border-gray-300 px-3 py-2"
            value={formData.estimatedEndDate}
            onChange={(e) => setFormData({ ...formData, estimatedEndDate: e.target.value })}
          />
        </div>
      </div>

      <div className="rounded bg-yellow-50 p-3 text-sm text-yellow-800">
        <strong>Bloqueo de desarrollo:</strong> La creación fallará porque aún no existe un módulo de Autenticación/Usuarios para asignar el Líder del proyecto.
      </div>

      {create.isError && (
        <p className="text-sm text-red-600">
          Error al crear el proyecto (Falta leaderId válido).
        </p>
      )}

      <button
        className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        disabled={create.isPending || !formData.name.trim()}
        type="submit"
      >
        {create.isPending ? 'Creando...' : 'Crear Proyecto'}
      </button>
    </form>
  );
}
