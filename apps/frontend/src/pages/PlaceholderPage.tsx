export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">{title}</h1>
      <p className="text-slate-500">Próximamente.</p>
    </>
  );
}
