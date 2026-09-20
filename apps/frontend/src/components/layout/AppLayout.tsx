import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ChevronIcon, CloseIcon, MenuIcon } from './icons';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem('sidebar-collapsed', String(!prev));
      } catch {
        /* sin storage: solo no se recuerda */
      }
      return !prev;
    });
  };

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Punto de extension: aca se abrira el panel de chat del asistente.
  const openAssistant = () => {};

  return (
    <div className="min-h-screen bg-slate-50">
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        id="app-sidebar"
        data-collapsed={collapsed}
        className={`group/sb fixed inset-y-0 left-0 z-40 w-sidebar transition-[transform,width] duration-300 ease-in-out lg:translate-x-0 ${
          collapsed ? 'lg:w-sidebar-collapsed' : ''
        } ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Sidebar onNavigate={() => setDrawerOpen(false)} onOpenAssistant={openAssistant} />
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Cerrar navegación"
          className="absolute right-2 top-2 rounded-md p-1.5 text-sidebar-muted hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 lg:hidden"
        >
          <CloseIcon />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
          aria-expanded={!collapsed}
          className="absolute -right-3 top-7 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-card text-white hover:bg-sidebar-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 lg:flex"
        >
          <span className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}>
            <ChevronIcon />
          </span>
        </button>
      </aside>

      <div className={`min-w-0 transition-[padding] duration-300 ease-in-out ${collapsed ? 'lg:pl-sidebar-collapsed' : 'lg:pl-sidebar'}`}>
        <header className="flex h-14 items-center border-b border-slate-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir navegación"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            className="rounded-md p-1.5 text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <MenuIcon />
          </button>
          <span className="ml-3 text-sm font-semibold text-slate-800">TEMA Project Manager</span>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
