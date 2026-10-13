import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { hasAnyRole } from '../../lib/roles';
import { ChevronIcon, CloseIcon, MenuIcon, SparklesIcon } from './icons';
import { Sidebar } from './Sidebar';
import { ChatPanel } from '../assistant/ChatPanel';

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const { user } = useCurrentUser();
  const canUseAssistant = !!user && hasAnyRole(user.roles, ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR']);
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

  const [assistantOpen, setAssistantOpen] = useState(false);
  const openAssistant = () => setAssistantOpen(true);

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
        <Sidebar onNavigate={() => setDrawerOpen(false)} />
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
        <main className="mx-auto w-full max-w-6xl min-w-0 p-4 sm:p-8">
          <Outlet />
        </main>
      </div>

      {canUseAssistant && !assistantOpen && (
        <button
          type="button"
          onClick={openAssistant}
          aria-label="Abrir asistente de IA"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sidebar-card text-white shadow-lg transition-transform hover:scale-105 hover:bg-sidebar-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          <SparklesIcon width={26} height={26} />
        </button>
      )}

      <ChatPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}
