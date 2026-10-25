import { formatMRU } from "@/lib/money";

/**
 * Colonnes des ventes par période (série unique, couleur de marque validée).
 * Barres fines à extrémité arrondie, base carrée, écart de 2 px, grille discrète.
 * Survol : infobulle native sur une zone de survol plus large que la barre.
 * Le tableau sous le graphique en est la vue accessible.
 */
export function PeriodChart({ rows, label }: { rows: { period: string; value: number; sub?: string }[]; label: string }) {
  const W = 760, H = 220, padL = 64, padB = 28, padT = 12;
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const nice = niceMax(max);
  const slot = plotW / Math.max(rows.length, 1);
  const barW = Math.max(Math.min(24, slot - 2), 1);
  const ticks = [0, 0.5, 1].map((f) => Math.round(nice * f));
  const every = Math.ceil(rows.length / 8);
  const y = (v: number) => padT + plotH - (v / nice) * plotH;

  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full min-w-[480px]">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{formatMRU(t).replace(" MRU", "")}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const top = y(r.value);
          const h = padT + plotH - top;
          const rad = Math.min(4, barW / 2, h);
          return (
            <g key={r.period}>
              <title>{`${r.period} — ${formatMRU(r.value)}${r.sub ? ` · ${r.sub}` : ""}`}</title>
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path fill="#026fb3"
                  d={`M${x},${padT + plotH} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + barW - rad} Q${x + barW},${top} ${x + barW},${top + rad} V${padT + plotH} Z`} />
              )}
              {i % every === 0 && (
                <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">{r.period.slice(5).split("-").reverse().join("/")}</text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      <figcaption className="mt-1 text-xs text-slate-500">{label} (MRU). Survolez une colonne pour le détail ; le tableau ci-dessous reprend toutes les valeurs.</figcaption>
    </figure>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
