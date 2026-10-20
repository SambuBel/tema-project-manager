interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const getPageNumbers = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  };

  const baseBtn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors';

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className={`${baseBtn} border border-[#DEE5EC] text-[#607185] hover:bg-[#EAF2F7] disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        Anterior
      </button>

      {getPageNumbers().map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-sm text-[#607185]">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`${baseBtn} ${
              p === page
                ? 'bg-[#245B78] text-white'
                : 'border border-[#DEE5EC] text-[#607185] hover:bg-[#EAF2F7]'
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className={`${baseBtn} border border-[#DEE5EC] text-[#607185] hover:bg-[#EAF2F7] disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        Siguiente
      </button>
    </div>
  );
}