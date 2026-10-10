import React from 'react';
import { PRIORITY_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '../format';

export function SeverityBadge({ value }) {
  const v = value || 'none';
  return <span className={`badge sev-${v}`}>{SEVERITY_LABEL[v] || v}</span>;
}

export function PriorityTag({ value, long = false }) {
  return (
    <span className={`badge pri-${value}`} title={PRIORITY_LABEL[value]}>
      {value}{long ? ` ${PRIORITY_LABEL[value]}` : ''}
    </span>
  );
}

export function StatusPill({ value }) {
  return <span className={`pill status-${value}`}>{STATUS_LABEL[value] || value}</span>;
}

export function StatusDot({ state }) {
  return <span className={`dot dot-${state}`} aria-hidden="true" />;
}

export function Chip({ children, tone = '' }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="note note-error" role="alert">
      <span>{error}</span>
      {onRetry && <button type="button" className="btn btn-quiet btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Single-choice button group (accessible radio group). */
export function Segmented({ label, value, options, onChange, name }) {
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div className="segmented-options">
        {options.map((o) => (
          <label key={o.value} className={`seg ${value === o.value ? 'is-on' : ''} ${o.tone ? `seg-${o.tone}` : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
