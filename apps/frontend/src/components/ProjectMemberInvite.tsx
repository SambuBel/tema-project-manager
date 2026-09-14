import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, AddProjectMemberDto } from '@tema/shared-types';

interface ProjectMemberInviteProps {
  project: Project;
  onBack: () => void;
}

const ROLES_DISPONIBLES = [
  'Administrador',
  'Líder de proyecto',
  'Colaborador',
  'Observador'
];

export function ProjectMemberInvite({ project, onBack }: ProjectMemberInviteProps) {
  const qc = useQueryClient();
  const [selectedRole, setSelectedRole] = useState(ROLES_DISPONIBLES[2]);
  
  const inviteMutation = useMutation({
    mutationFn: (dto: AddProjectMemberDto) => api.addProjectMember(project.id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', project.id] });
      onBack();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Blocked by Auth/Users module: No users available to select
    alert('Esta acción está bloqueada: El módulo de Usuarios aún no está integrado, por lo que no es posible seleccionar a quién invitar.');
  };

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      {/* Breadcrumb / Volver */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">Mis proyectos</button>
        <span className="mx-2">/</span>
        <button onClick={onBack} className="hover:underline">{project.name}</button>
        <span className="mx-2">/</span>
        <span>Invitar miembro</span>
      </div>

      <div>
        <h1 className="text-3xl font-semibold text-[#172B42]">Invitar miembro</h1>
        <p className="mt-2 text-sm text-[#607185]">
          Sumá una persona al proyecto con el acceso adecuado.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Formulario */}
        <div className="md:col-span-2 flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-8 shadow-sm">
          <h3 className="text-lg font-semibold text-[#172B42] mb-6">Nueva invitación</h3>
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Usuario a invitar *</label>
              <select 
                disabled 
                className="rounded-lg border border-[#DEE5EC] bg-gray-50 px-4 py-3 text-sm text-[#607185] opacity-70"
              >
                <option>Pendiente de integración con Usuarios</option>
              </select>
              <span className="text-xs text-red-500 font-medium">
                Bloqueado: La gestión global de usuarios aún no está disponible (Dependencia de Auth).
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Rol *</label>
              <select 
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-3 text-sm text-[#172B42]"
              >
                {ROLES_DISPONIBLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Proyecto *</label>
              <select 
                disabled
                className="rounded-lg border border-[#DEE5EC] bg-gray-50 px-4 py-3 text-sm text-[#172B42] opacity-70"
              >
                <option>{project.name}</option>
              </select>
            </div>

            {inviteMutation.isError && (
              <div className="text-sm text-red-600 font-medium">
                Error al invitar: {inviteMutation.error.message}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-4">
              <button 
                type="button" 
                onClick={onBack}
                className="rounded-lg border border-[#DEE5EC] bg-white px-6 py-2.5 text-sm font-medium text-[#172B42]"
              >
                Cancelar
              </button>
              <button 
                type="submit"
                disabled={inviteMutation.isPending}
                className="rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:opacity-50"
              >
                {inviteMutation.isPending ? 'Enviando...' : 'Enviar invitación'}
              </button>
            </div>
          </form>
        </div>

        {/* Panel lateral */}
        <div className="md:col-span-1">
          <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[#172B42] mb-3">Acceso con Google</h3>
            <p className="text-sm text-[#607185] leading-relaxed">
              La persona invitada podrá ingresar con su cuenta de Google. En este prototipo, el envío se simula y no se manda ningún correo.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
