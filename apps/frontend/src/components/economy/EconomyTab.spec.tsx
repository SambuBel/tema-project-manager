// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project } from '@tema/shared-types';
import { EconomyTab } from './EconomyTab';

vi.mock('./BudgetSection', () => ({ BudgetSection: () => <div data-testid="budget-section">Presupuesto</div> }));
vi.mock('./CostsSection', () => ({ CostsSection: () => <div data-testid="costs-section">Costos</div> }));
vi.mock('./ResourcesSection', () => ({ ResourcesSection: () => <div data-testid="resources-section">Recursos</div> }));

const project = { id: 'p1' } as unknown as Project;
afterEach(cleanup);

describe('EconomyTab - navegación secundaria', () => {
  it('sin section: Presupuesto por defecto (compatible con ?view=economia)', () => {
    render(<EconomyTab project={project} />);
    expect(screen.getByTestId('budget-section')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Presupuesto' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Costos' }).getAttribute('aria-current')).toBeNull();
  });

  it('section=costos muestra Costos', () => {
    render(<EconomyTab project={project} section="costos" />);
    expect(screen.getByTestId('costs-section')).toBeTruthy();
    expect(screen.queryByTestId('budget-section')).toBeNull();
    expect(screen.getByRole('button', { name: 'Costos' }).getAttribute('aria-current')).toBe('page');
  });

  it('section=recursos muestra Recursos', () => {
    render(<EconomyTab project={project} section="recursos" />);
    expect(screen.getByTestId('resources-section')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recursos' }).getAttribute('aria-current')).toBe('page');
  });

  it('section desconocida (o de una fase futura): vuelve a Presupuesto', () => {
    render(<EconomyTab project={project} section="resumen" />);
    expect(screen.getByTestId('budget-section')).toBeTruthy();
  });

  it('Presupuesto, Costos y Recursos: todavía no hay Resumen económico', () => {
    render(<EconomyTab project={project} />);
    expect(within(screen.getByRole('navigation', { name: 'Secciones de Economía' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Presupuesto', 'Costos', 'Recursos']);
  });

  it('al elegir una sección avisa cuál (la URL la decide el padre)', () => {
    const onSectionChange = vi.fn();
    render(<EconomyTab project={project} onSectionChange={onSectionChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Costos' }));
    expect(onSectionChange).toHaveBeenCalledWith('costos');
  });
});
