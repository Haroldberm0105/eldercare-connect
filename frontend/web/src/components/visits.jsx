import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import { Segmented } from './ui';
import { VISIT_TYPE_LABEL, VISIT_STATUS_LABEL, todayManila, visitWhen, relTime, dateTime } from '../format';

const TYPE_OPTIONS = [
  { value: 'home_visit', label: 'Home visit' },
  { value: 'clinic_visit', label: 'Clinic visit' },
  { value: 'teleconsult', label: 'Teleconsult' },
];

/** Accessible modal wrapper: focus moves inside, Escape closes, focus returns to the opener. */
export function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const first = ref.current && ref.current.querySelector('input, select, textarea, button');
    if (first) first.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus(); };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Schedule (or reschedule) a visit for a risk-queue case.
 * Prefills the destination and address from the patient's profile.
 */
export function ScheduleVisitDialog({ item, existing, onClose, onScheduled }) {
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    visitType: existing ? existing.visitType : 'home_visit',
    visitDate: existing ? existing.visitDate : todayManila(1),
    visitTime: existing ? existing.visitTime : '09:00',
    destination: existing ? existing.destination : "Patient's home",
    location: existing ? existing.location : '',
    contactPhone: existing ? existing.contactPhone || '' : '',
    notes: '',
  });
  const [errors, setErrors] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api(`/api/patients/${item.patient.id}`).then((p) => {
      setProfile(p);
      if (!existing) {
        setForm((f) => ({
          ...f,
          location: f.location || [p.addressLine, p.zipCode].filter(Boolean).join(', '),
          contactPhone: f.contactPhone || (p.emergencyContact && p.emergencyContact.phone) || '',
        }));
      }
    }).catch(() => {});
  }, [item.patient.id, existing]);

  function changeType(t) {
    setForm((f) => {
      const next = { ...f, visitType: t };
      if (t === 'home_visit') { next.destination = "Patient's home"; next.location = profile ? [profile.addressLine, profile.zipCode].filter(Boolean).join(', ') : f.location; }
      if (t === 'clinic_visit') { next.destination = (profile && profile.assignedClinic) || item.patient.assignedClinic || 'Rural Health Unit'; next.location = ''; }
      if (t === 'teleconsult') { next.destination = 'Phone / video call'; next.location = f.contactPhone || ''; }
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors(null);
    try {
      const body = { ...form, notes: form.notes.trim() || undefined, contactPhone: form.contactPhone.trim() || undefined };
      const r = await api(`/api/clinic/queue/${item.id}/visits`, { method: 'POST', body });
      toast({ tone: 'success', title: existing ? 'Visit rescheduled' : 'Visit scheduled', body: `${item.patient.name}: ${visitWhen(r.visit)}, ${r.visit.destination}` });
      onScheduled(r);
    } catch (err) {
      setErrors(err.details || [err.message]);
      setSaving(false);
    }
  }

  const locationLabel = form.visitType === 'teleconsult' ? 'Phone number or video link' : form.visitType === 'clinic_visit' ? 'Clinic address' : 'Home address and landmarks';
  return (
    <Dialog title={`${existing ? 'Reschedule' : 'Schedule'} visit: ${item.patient.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Segmented label="Type of visit" name="visitType" value={form.visitType} onChange={changeType} options={TYPE_OPTIONS} />
        <div className="form-grid">
          <label className="field"><span>Date</span><input type="date" required min={todayManila()} value={form.visitDate} onChange={(e) => set('visitDate')(e.target.value)} /></label>
          <label className="field"><span>Time (Manila)</span><input type="time" required value={form.visitTime} onChange={(e) => set('visitTime')(e.target.value)} /></label>
        </div>
        <label className="field"><span>Destination</span><input required maxLength={120} value={form.destination} onChange={(e) => set('destination')(e.target.value)} placeholder="Patient's home, RHU Tondo, …" /></label>
        <label className="field"><span>{locationLabel}</span><textarea rows="2" required maxLength={300} value={form.location} onChange={(e) => set('location')(e.target.value)} placeholder="Street, barangay, city, nearby landmark" /></label>
        <label className="field"><span>Contact number (optional)</span><input inputMode="tel" value={form.contactPhone} onChange={(e) => set('contactPhone')(e.target.value)} placeholder="09171234567" /></label>
        <label className="field"><span>Notes for the visit (optional)</span><textarea rows="2" maxLength={2000} value={form.notes} onChange={(e) => set('notes')(e.target.value)} placeholder="Bring BP monitor; check medicine supply" /></label>
        {errors && (
          <div className="note note-error" role="alert"><div><strong>Not scheduled. Please check:</strong><ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul></div></div>
        )}
        <p className="muted small">Home and clinic visits must start between 06:00 and 19:59. The caregiver and family see this visit in their apps.</p>
        <div className="btn-row dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : existing ? 'Reschedule visit' : 'Schedule visit'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** One visit, with outcome recording for clinic staff when it is still scheduled. */
export function VisitCard({ visit, canAct, onChanged, showPatient = false, onOpenPatient }) {
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function close(status, resolveCase = false) {
    setBusy(true);
    setError('');
    try {
      const r = await api(`/api/clinic/visits/${visit.id}`, { method: 'PATCH', body: { status, outcome: outcome.trim() || undefined, resolveCase } });
      toast({ tone: 'success', title: `Visit ${VISIT_STATUS_LABEL[status].toLowerCase()}`, body: resolveCase ? 'The case was resolved and moved to Case history.' : r.item ? `Case is now ${r.item.status.replace('_', ' ')}.` : undefined });
      onChanged && onChanged(r);
    } catch (e) {
      setError(e.details ? e.details.join('. ') : e.message);
      setBusy(false);
    }
  }

  const overdue = visit.status === 'scheduled' && new Date(visit.scheduledFor) < new Date();
  return (
    <article className={`visit-card visit-${visit.status} ${overdue ? 'is-overdue' : ''}`}>
      <div className="visit-head">
        <div>
          <strong>{VISIT_TYPE_LABEL[visit.visitType]}{showPatient ? ` · ` : ''}</strong>
          {showPatient && (onOpenPatient
            ? <button type="button" className="link-btn" onClick={() => onOpenPatient(visit.patient.id)}>{visit.patient.name}</button>
            : <span>{visit.patient.name}</span>)}
          <div className="visit-when">{visitWhen(visit)}{overdue ? <span className="pill status-overdue">Overdue</span> : null}</div>
        </div>
        <span className={`pill visit-pill-${visit.status}`}>{VISIT_STATUS_LABEL[visit.status]}</span>
      </div>
      <dl className="visit-facts">
        <div><dt>Destination</dt><dd>{visit.destination}</dd></div>
        <div><dt>Location</dt><dd>{visit.location}</dd></div>
        {visit.contactPhone && <div><dt>Contact</dt><dd>{visit.contactPhone}</dd></div>}
        {visit.notes && <div><dt>Notes</dt><dd>{visit.notes}</dd></div>}
        {visit.outcome && <div><dt>{visit.status === 'completed' ? 'Outcome' : 'Reason'}</dt><dd>{visit.outcome}</dd></div>}
        {visit.completedAt && <div><dt>Completed</dt><dd title={dateTime(visit.completedAt)}>{relTime(visit.completedAt)}</dd></div>}
      </dl>
      {canAct && visit.status === 'scheduled' && !closing && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClosing(true)}>Record visit outcome</button>
      )}
      {closing && (
        <div className="visit-close">
          <label className="field">
            <span>What happened?</span>
            <textarea rows="2" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="BP rechecked 132/84, medicines reviewed, caregiver coached" />
          </label>
          {error && <p className="note note-error small">{error}</p>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => close('completed', true)}>Completed, resolve case</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => close('completed', false)}>Completed, keep case open</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => close('no_show')}>No one home</button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => close('cancelled')}>Cancel visit</button>
          </div>
        </div>
      )}
    </article>
  );
}
