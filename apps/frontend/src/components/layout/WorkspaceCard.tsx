export function WorkspaceCard() {
  return (
    <div className="mx-4 mt-5 max-h-24 overflow-hidden whitespace-nowrap rounded-lg bg-sidebar-card px-3.5 py-3 transition-[max-height,opacity,margin,padding] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:mt-0 lg:group-data-[collapsed=true]/sb:max-h-0 lg:group-data-[collapsed=true]/sb:py-0 lg:group-data-[collapsed=true]/sb:opacity-0">
      <p className="text-sm font-semibold text-white">TEMA Workspace</p>
      <p className="text-xs text-sidebar-muted">Gestión de proyectos</p>
    </div>
  );
}
