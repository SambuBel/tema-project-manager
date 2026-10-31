import type { Project } from '@tema/shared-types';
import { useState } from 'react';
import { api } from '../../lib/api';
import { BudgetSection } from './BudgetSection';
import { CostsSection } from './CostsSection';
import { ResourcesSection } from './ResourcesSection';
import ExportDropdown from '../ExportDropdown';

/**
 * Secciones de la pestaña Economía. Agregar Resumen es sumar una entrada acá; la sección activa viene de la URL
 * (`?view=economia&section=costos`). Sin `section` (o con una desconocida) se muestra Presupuesto.
 */
const SECTIONS = {
  presupuesto: { label: 'Presupuesto', Component: BudgetSection },
  costos: { label: 'Costos', Component: CostsSection },
  recursos: { label: 'Recursos', Component: ResourcesSection },
} as const;

export type EconomySection = keyof typeof SECTIONS;
const DEFAULT_SECTION: EconomySection = 'presupuesto';

interface EconomyTabProps {
  project: Project;
  section?: string | null;
  onSectionChange?: (section: EconomySection) => void;
}

export function EconomyTab({ project, section, onSectionChange }: EconomyTabProps) {
  const key: EconomySection = section && section in SECTIONS ? (section as EconomySection) : DEFAULT_SECTION;
  const { Component } = SECTIONS[key];
  const [isExporting, setIsExporting] = useState(false);

  const handleExportEconomic = async () => {
    setIsExporting(true);
    try {
      await api.exportEconomicReportCsv(project.id);
    } catch (err) {
      console.error('Error al exportar reporte económico:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportEconomicPdf = async () => {
    setIsExporting(true);
    try {
      await api.exportEconomicReportPdf(project.id);
    } catch (err) {
      console.error('Error al exportar reporte económico PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Secciones de Economía" className="flex flex-wrap gap-2">
        {(Object.keys(SECTIONS) as EconomySection[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={id === key ? 'page' : undefined}
            onClick={() => onSectionChange?.(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              id === key ? 'bg-[#EAF2F7] text-[#245B78] ring-1 ring-[#245B78]' : 'border border-[#DEE5EC] bg-white text-[#172B42] hover:bg-[#EAF2F7]'
            }`}
          >
            {SECTIONS[id].label}
          </button>
        ))}
      </nav>
        <div className="flex justify-end">
          <ExportDropdown
            disabled={isExporting}
            options={[
              { label: 'Exportar CSV', onClick: handleExportEconomic },
              { label: 'Exportar PDF', onClick: handleExportEconomicPdf },
            ]}
          />
        </div>
      <Component project={project} />
    </div>
  );
}
