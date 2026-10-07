import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectMemberRole>('COLLABORATOR');

  // GET /users ya existe (ver HU de roles/permisos) — antes este formulario
  // estaba bloqueado a mano porque esta dependencia todavía no estaba resuelta.
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.listUsers() });
  const members = useQuery({
    queryKey: ['project-members', project.id],
    queryFn: () => api.getProjectMembers(project.id),
  });

  // No ofrecer como candidatos a quien ya es miembro activo ni al líder
  // (el líder no se administra desde acá, ver Project.leaderId / "Cambiar líder").
  const existingMemberIds = new Set((members.data ?? []).map((m) => m.userId));
  const candidates = (users.data ?? []).filter(
    (u) => u.id !== project.leaderId && !existingMemberIds.has(u.id),
  );

  const inviteMutation = useMutation({
    mutationFn: () => api.addProjectMember(project.id, { userId: selectedUserId, projectRole: selectedRole }),
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

    inviteMutation.mutate({ email, projectRole: selectedRole });
  };
    if (!selectedUserId) return;
    inviteMutation.mutate();
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
        <span>Agregar miembro</span>
      </div>

      <div>
        <h1 className="text-3xl font-semibold text-[#172B42]">Agregar miembro</h1>
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
                <option value="COLLABORATOR">Colaborador</option>
                <option value="OBSERVER">Observador</option>
              <label htmlFor="invite-user" className="text-sm font-medium text-[#172B42]">Usuario *</label>
              {users.isLoading ? (
                <p className="text-sm text-[#607185]">Cargando usuarios…</p>
              ) : users.isError ? (
                <p className="text-sm text-red-600">No se pudo cargar la lista de usuarios.</p>
              ) : candidates.length === 0 ? (
                <p className="text-sm italic text-[#607185]">
                  No hay usuarios disponibles para agregar (ya son miembros, o no hay más usuarios activos).
                </p>
              ) : (
                <select
                  id="invite-user"
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-3 text-sm text-[#172B42]"
                >
                  <option value="">Elegí un usuario…</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="invite-role" className="text-sm font-medium text-[#172B42]">Rol *</label>
              <select
                id="invite-role"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as ProjectMemberRole)}
                className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-3 text-sm text-[#172B42]"
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
              <select
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
                {inviteMutation.error?.message || 'Error al enviar la invitación'}
              <div className="text-sm text-red-600 font-medium">
                No se pudo agregar al miembro: {errorMessage}
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
                disabled={!selectedUserId || inviteMutation.isPending}
                className="rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {inviteMutation.isPending ? 'Agregando...' : 'Agregar miembro'}
              </button>
            </div>
          </form>
        </div>

        {/* Panel lateral */}
        <div className="md:col-span-1">
          <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[#172B42] mb-3">Acceso con Google</h3>
            <p className="text-sm text-[#607185] leading-relaxed">
              Cualquier usuario que ya tenga cuenta en TEMA (ingresó alguna vez con Google) puede sumarse a un
              proyecto. No hay invitación por correo: el acceso se da agregándolo acá.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
