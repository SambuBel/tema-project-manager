export function SidebarHeader() {
  return (
    <div
      className="max-h-24 overflow-hidden px-5 pt-6 transition-[max-height,opacity] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:max-h-4 lg:group-data-[collapsed=true]/sb:opacity-0"
      aria-label="TEMA Consulting"
    >
      <p className="text-2xl font-bold leading-none tracking-tight text-white">TEMA</p>
      <p className="mt-1.5 text-[10px] font-medium tracking-[0.35em] text-sidebar-muted">CONSULTING</p>
    </div>
  );
}
