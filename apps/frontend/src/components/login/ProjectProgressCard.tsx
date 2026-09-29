import React from 'react';

export const ProjectProgressCard: React.FC = () => {
  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-5 text-white max-w-sm w-full shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-blue-200">
          Portal de Clientes
        </span>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          En curso
        </span>
      </div>
      
      <h4 className="text-lg font-bold mb-1">Hito: Relevamiento y Diseño</h4>
      <p className="text-xs text-blue-100 mb-4">Entrega estimada: 18 sep</p>

      <div className="space-y-2">
        <div className="flex justify-between text-xs font-medium">
          <span>Progreso del proyecto</span>
          <span className="font-bold">68%</span>
        </div>
        <div className="w-full bg-blue-950/50 rounded-full h-2 overflow-hidden">
          <div 
            className="bg-blue-400 h-2 rounded-full transition-all duration-500" 
            style={{ width: '68%' }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-blue-200 pt-1">
          <span>34 de 50 tareas completadas</span>
        </div>
      </div>
    </div>
  );
};