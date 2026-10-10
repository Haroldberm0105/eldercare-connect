// Dependency-free SVG line chart for vital-sign trends, with a shaded "usual range" band.
import React from 'react';
import { shortDate, dateTime } from '../format';

const W = 640;
const H = 200;
const PAD = { top: 14, right: 16, bottom: 26, left: 40 };

export default function TrendChart({ points, series, band, unit, label }) {
  const rows = points.filter((p) => series.some((s) => typeof p[s.key] === 'number'));
  if (rows.length < 2) {
    return <p className="muted small chart-empty">A trend appears after two or more check-ins with this reading.</p>;
  }

  const values = rows.flatMap((p) => series.map((s) => p[s.key]).filter((v) => typeof v === 'number'));
  if (band) values.push(band[0], band[1]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || 10) * 0.12;
  lo = Math.floor(lo - pad);
  hi = Math.ceil(hi + pad);

  const t0 = new Date(rows[0].t).getTime();
  const t1 = new Date(rows[rows.length - 1].t).getTime();
  const x = (t) => PAD.left + ((new Date(t).getTime() - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {band && <rect x={PAD.left} width={W - PAD.left - PAD.right} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} className="chart-band" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">{t}</text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="chart-tick">{shortDate(rows[0].t)}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="chart-tick">{shortDate(rows[rows.length - 1].t)}</text>
        {series.map((s) => {
          const pts = rows.filter((p) => typeof p[s.key] === 'number');
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' ');
          return (
            <g key={s.key} className={`chart-series ${s.className || ''}`}>
              <path d={d} />
              {pts.map((p) => (
                <circle key={p.t + s.key} cx={x(p.t)} cy={y(p[s.key])} r={p.flag ? 5 : 3.5} className={p.flag ? 'is-flagged' : ''}>
                  <title>{`${s.label}: ${p[s.key]} ${unit} on ${dateTime(p.t)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="chart-legend">
        {series.map((s) => <span key={s.key} className={`legend ${s.className || ''}`}>{s.label}</span>)}
        {band && <span className="legend legend-band">Usual range {band[0]}–{band[1]} {unit}</span>}
      </figcaption>
    </figure>
  );
}
