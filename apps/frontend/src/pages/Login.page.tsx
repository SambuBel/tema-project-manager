import React from 'react';
import { GoogleLoginButton } from '../components/login/GoogleLoginButton';
import { ProjectProgressCard } from '../components/login/ProjectProgressCard';

export const LoginPage: React.FC = () => {
  return (
    <div className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2 bg-slate-50 font-sans">
      {/* Panel Izquierdo: Branding & Hero */}
      <div className="hidden md:flex flex-col justify-between bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-12 text-white relative overflow-hidden">
        {/* Luces de fondo decorativas */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Encabezado Marca */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-blue-500/30">
              T
            </div>
            <span className="font-bold text-xl tracking-tight">TEMA CONSULTING</span>
          </div>
          <span className="text-xs font-semibold px-3 py-1 bg-white/10 rounded-full border border-white/15 text-blue-200">
            GESTIÓN DE PROYECTOS + IA
          </span>
        </div>

        {/* Hero Central */}
        <div className="relative z-10 my-auto py-12 space-y-8">
          <div className="max-w-md space-y-4">
            <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight">
              Tu equipo alineado. <br />
              <span className="text-blue-400">Tu próximo paso, más claro.</span>
            </h1>
            <p className="text-slate-300 text-lg">
              Planificá, colaborá y anticipá riesgos desde un solo lugar.
            </p>
          </div>

          <ProjectProgressCard />
        </div>

        {/* Cierre */}
        <div className="relative z-10 text-xs text-slate-400">
          Un espacio para transformar ideas en resultados.
        </div>
      </div>

      {/* Panel Derecho: Formulario */}
      <div className="flex flex-col justify-between p-8 sm:p-12 md:p-16 bg-white">
        {/* Header en celulares */}
        <div className="md:hidden flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-lg">
            T
          </div>
          <span className="font-bold text-lg text-slate-900">TEMA CONSULTING</span>
        </div>

        <div className="my-auto max-w-md w-full mx-auto space-y-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
              Bienvenido a TEMA
            </h2>
            <p className="text-slate-600">
              Ingresá con tu cuenta de trabajo para continuar.
            </p>
          </div>

          <div className="space-y-4">
            <GoogleLoginButton />
            
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
              🔒 <span className="font-semibold text-slate-700">Acceso seguro:</span> Utilizá la cuenta de correo corporativo donde recibiste la invitación de tu equipo.
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900 space-y-1">
            <p className="font-semibold">¿Todavía no tenés acceso?</p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Solicitá una invitación al administrador de tu equipo para poder ingresar a la plataforma.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <span>TEMA Consulting © 2026</span>
          <div className="flex gap-4">
            <a href="#" className="hover:text-slate-600 transition-colors">Términos</a>
            <a href="#" className="hover:text-slate-600 transition-colors">Privacidad</a>
          </div>
        </div>
      </div>
    </div>
  );
};