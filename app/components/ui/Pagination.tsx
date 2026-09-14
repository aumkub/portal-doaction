type Props = {
  page: number;
  totalPages: number;
  /** Optional extra search params to preserve in every href (e.g. "q=foo") */
  extra?: string;
};

function buildPages(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("…");
    result.push(sorted[i]);
  }
  return result;
}

export default function Pagination({ page, totalPages, extra }: Props) {
  if (totalPages <= 1) return null;

  const qs = (p: number) => `?page=${p}${extra ? `&${extra}` : ""}`;
  const pages = buildPages(page, totalPages);

  const linkBase = "inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-xs font-medium transition-colors";
  const activeStyle = `${linkBase} bg-violet-600 text-white`;
  const normalStyle = `${linkBase} text-slate-600 hover:bg-slate-100`;
  const disabledStyle = `${linkBase} text-slate-300 pointer-events-none`;

  return (
    <div className="flex items-center justify-center gap-1 py-3">
      <a href={page > 1 ? qs(page - 1) : undefined} className={page <= 1 ? disabledStyle : normalStyle}>
        ‹
      </a>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="inline-flex h-7 min-w-[28px] items-center justify-center text-xs text-slate-400">
            …
          </span>
        ) : (
          <a key={p} href={qs(p)} className={p === page ? activeStyle : normalStyle}>
            {p}
          </a>
        )
      )}
      <a href={page < totalPages ? qs(page + 1) : undefined} className={page >= totalPages ? disabledStyle : normalStyle}>
        ›
      </a>
    </div>
  );
}
