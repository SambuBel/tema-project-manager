import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import type { Project, InviteProjectMemberDto, ProjectMemberRole } from '@tema/shared-types';

interface ProjectMemberInviteProps {
  project: Project;
  onBack: () => void;
}

const ROLE_OPTIONS: { value: ProjectMemberRole; label: string }[] = [
  { value: 'COLLABORATOR', label: 'Colaborador' },
  { value: 'OBSERVER', label: 'Observador' },
];

export function ProjectMemberInvite({ project, onBack }: ProjectMemberInviteProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectMemberRole>('COLLABORATOR');
  const [validationError, setValidationError] = useState<string | null>(null);

  const inviteMutation = useMutation({
    mutationFn: (dto: InviteProjectMemberDto) => api.inviteProjectMember(project.id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-invitations', project.id] });
      onBack();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!email.toLowerCase().endsWith('@gmail.com')) {
      setValidationError('Por cuestiones de seguridad, solo se permiten invitaciones a correos con dominio @gmail.com');
      return;
    }

    inviteMutation.mutate({ email, name, projectRole: selectedRole });
  };

  const errorMessage =
    inviteMutation.error instanceof ApiRequestError
      ? inviteMutation.error.details[0] ?? inviteMutation.error.message
      : inviteMutation.error?.message;

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
          <h3 className="text-lg font-semibold text-[#172B42] mb-6">Nuevo miembro</h3>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Nombre *</label>
              <input 
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-[#DEE5EC] px-4 py-3 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Correo electrónico *</label>
              <input 
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-[#DEE5EC] px-4 py-3 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Rol *</label>
              <select 
                required
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as ProjectMemberRole)}
                className="rounded-lg border border-[#DEE5EC] px-4 py-3 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78] bg-white"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-[#607185]">Este rol aplica únicamente a este proyecto.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[#172B42]">Proyecto *</label>
              <input 
                type="text"
                disabled
                value={project.name}
                className="rounded-lg border border-[#DEE5EC] bg-gray-50 px-4 py-3 text-sm text-[#172B42] opacity-70"
              />
            </div>

            {validationError && (
              <div className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-lg border border-red-100">
                {validationError}
              </div>
            )}

            {inviteMutation.isError && (
              <div className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-lg border border-red-100">
                No se pudo invitar al miembro: {errorMessage}
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
                className="rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {inviteMutation.isPending ? 'Invitando...' : 'Invitar miembro'}
              </button>
            </div>
          </form>
        </div>

        {/* Panel lateral */}
        <div className="md:col-span-1">
          <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[#172B42] mb-3">Invitaciones seguras</h3>
            <p className="text-sm text-[#607185] leading-relaxed">
              El usuario recibirá una invitación por correo electrónico con un enlace único para aceptar unirse al proyecto.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
