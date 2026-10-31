import { useState, useRef, useEffect } from 'react';

interface ExportOption {
  label: string;
  onClick: () => void;
}

interface ExportDropdownProps {
  options: ExportOption[];
  disabled?: boolean;
  loadingLabel?: string;
}

export default function ExportDropdown({ options, disabled = false, loadingLabel = 'Exportando…' }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-sm font-medium text-[#245B78] hover:bg-[#EAF2F7] transition-colors disabled:opacity-50"
      >
        {disabled ? loadingLabel : 'Exportar…'}
        {!disabled && (
          <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && !disabled && (
        <div className="absolute right-0 z-50 mt-1 w-full min-w-[160px] rounded-lg border border-[#DEE5EC] bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => { opt.onClick(); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm text-[#172B42] hover:bg-[#EAF2F7] first:rounded-t-lg last:rounded-b-lg"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}