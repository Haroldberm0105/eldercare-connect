// The clinic's caseload at a glance: one stacked bar split by priority. Each segment filters the list.
import React from 'react';
import { PRIORITY_LABEL } from '../format';

const ORDER = ['P1', 'P2', 'P3', 'P4'];

export default function TriageBar({ summary, active, onSelect }) {
  const total = ORDER.reduce((n, p) => n + (summary[p] || 0), 0);
  return (
    <div className="triage">
      <div className="triage-bar" aria-hidden="true">
        {total === 0 && <span className="triage-seg triage-empty" style={{ flexGrow: 1 }} />}
        {ORDER.filter((p) => summary[p]).map((p) => (
          <span key={p} className={`triage-seg pri-${p}`} style={{ flexGrow: summary[p] }} />
        ))}
      </div>
      <div className="triage-legend" role="group" aria-label="Filter by priority">
        <button type="button" className={`triage-key ${!active ? 'is-on' : ''}`} onClick={() => onSelect(null)}>
          <strong>{total}</strong> active
        </button>
        {ORDER.map((p) => (
          <button key={p} type="button" className={`triage-key ${active === p ? 'is-on' : ''}`} onClick={() => onSelect(active === p ? null : p)} aria-pressed={active === p}>
            <span className={`swatch pri-${p}`} aria-hidden="true" />
            <strong>{summary[p] || 0}</strong> {PRIORITY_LABEL[p].toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
