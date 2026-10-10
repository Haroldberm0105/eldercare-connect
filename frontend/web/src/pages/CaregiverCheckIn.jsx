import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import { PageHeader, Segmented, SeverityBadge, Empty, Loading, Chip } from '../components/ui';
import { bp, conditionLabel, relTime, dateTime, age, friendlyError } from '../format';

const EMPTY = { systolic: '', diastolic: '', heartRate: '', temperatureC: '', spo2: '', bloodGlucose: '', missed: '', notes: '' };

const MOBILITY = [
  { value: 'normal', label: 'Walks alone' },
  { value: 'assisted', label: 'Needs help' },
  { value: 'wheelchair', label: 'Wheelchair' },
  { value: 'bedridden', label: 'In bed' },
  { value: 'fall_reported', label: 'Had a fall', tone: 'danger' },
];
const MOOD = [
  { value: 'good', label: 'Good' },
  { value: 'neutral', label: 'Okay' },
  { value: 'low', label: 'Low' },
  { value: 'confused', label: 'Confused', tone: 'danger' },
  { value: 'agitated', label: 'Agitated' },
];

function VitalInput({ label, unit, value, onChange, step, usual, inputMode = 'numeric' }) {
  return (
    <label className="vital-input">
      <span className="vital-label">{label}</span>
      <span className="vital-field">
        <input type="number" inputMode={inputMode} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="unit">{unit}</span>
      </span>
      {usual && <span className="hint">Usual: {usual}</span>}
    </label>
  );
}

export default function CaregiverCheckIn({ user }) {
  const toast = useToast();
  const [patients, setPatients] = useState(null);
  const [patientId, setPatientId] = useState(user.patients[0] || '');
  const [form, setForm] = useState(EMPTY);
  const [medsTaken, setMedsTaken] = useState('yes');
  const [mobility, setMobility] = useState('normal');
  const [mood, setMood] = useState('good');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all(user.patients.map((id) => api(`/api/patients/${id}`).catch(() => ({ id, fullName: id, conditions: [] }))))
      .then(setPatients);
  }, [user.patients]);

  const loadHistory = useCallback(() => {
    if (!patientId) return;
    api(`/api/patients/${patientId}/history?days=7&limit=8`).then((h) => setHistory(h.checkins)).catch(() => setHistory([]));
  }, [patientId]);
  useEffect(() => { setHistory(null); loadHistory(); }, [loadHistory]);

  const patient = patients && patients.find((p) => p.id === patientId);
  const base = (patient && patient.baseline) || {};
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => (v === '' ? undefined : Number(v));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const vitals = {
        systolic: num(form.systolic), diastolic: num(form.diastolic), heartRate: num(form.heartRate),
        temperatureC: num(form.temperatureC), spo2: num(form.spo2), bloodGlucose: num(form.bloodGlucose),
      };
      const r = await api('/api/checkins', {
        method: 'POST',
        body: {
          patientId,
          idempotencyKey: `web-${crypto.randomUUID()}`,
          vitals,
          medication: {
            taken: medsTaken === 'yes',
            missed: medsTaken === 'no' && form.missed ? form.missed.split(',').map((s) => s.trim()).filter(Boolean) : [],
          },
          mobilityStatus: mobility,
          mood,
          notes: form.notes.trim() || undefined,
        },
      });
      setResult(r.checkin);
      setForm(EMPTY);
      setMedsTaken('yes');
      setMobility('normal');
      setMood('good');
      loadHistory();
      toast(r.checkin.severity === 'none'
        ? { tone: 'success', title: 'Check-in saved', body: 'All readings look normal.' }
        : { tone: 'warning', title: 'Check-in saved and flagged', body: 'Family and the health center were notified.' });
    } catch (err) {
      setError((err.details ? err.details : [err.message]).map(friendlyError));
    } finally {
      setBusy(false);
    }
  }

  if (!user.patients.length) {
    return <Empty title="No patients assigned yet">Ask your health center to link you to the person you care for.</Empty>;
  }

  return (
    <>
      <PageHeader title="Daily check-in" subtitle="Record today's readings. Leave out anything you didn't measure." />

      {patients && patients.length > 1 && (
        <div className="patient-switch" role="radiogroup" aria-label="Patient">
          {patients.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === patientId} className={`patient-card ${p.id === patientId ? 'is-on' : ''}`} onClick={() => { setPatientId(p.id); setResult(null); setError(null); }}>
              <strong>{p.fullName}</strong>
              <span>{[age(p.birthDate) && `${age(p.birthDate)} years`, ...(p.conditions || []).map(conditionLabel)].filter(Boolean).join(', ')}</span>
            </button>
          ))}
        </div>
      )}

      <div className="layout-split">
        <form className="panel checkin-form" onSubmit={submit} noValidate>
          <h2 className="panel-title">{patient ? patient.fullName : 'Loading patient…'}</h2>

          <div className="vitals-grid">
            <div className="vital-input vital-bp">
              <span className="vital-label">Blood pressure</span>
              <span className="vital-field bp-field">
                <input type="number" inputMode="numeric" aria-label="Systolic (top number)" placeholder="120" value={form.systolic} onChange={(e) => set('systolic')(e.target.value)} />
                <span className="slash" aria-hidden="true">/</span>
                <input type="number" inputMode="numeric" aria-label="Diastolic (bottom number)" placeholder="80" value={form.diastolic} onChange={(e) => set('diastolic')(e.target.value)} />
                <span className="unit">mmHg</span>
              </span>
              {base.systolic && <span className="hint">Usual: {base.systolic}/{base.diastolic}</span>}
            </div>
            <VitalInput label="Heart rate" unit="bpm" value={form.heartRate} onChange={set('heartRate')} usual={base.heartRate} />
            <VitalInput label="Temperature" unit="°C" step="0.1" inputMode="decimal" value={form.temperatureC} onChange={set('temperatureC')} usual={base.temperatureC} />
            <VitalInput label="Oxygen (SpO₂)" unit="%" value={form.spo2} onChange={set('spo2')} usual={base.spo2} />
            <VitalInput label="Blood sugar" unit="mg/dL" value={form.bloodGlucose} onChange={set('bloodGlucose')} />
          </div>

          <Segmented label="Medicines today" name="meds" value={medsTaken} onChange={setMedsTaken}
            options={[{ value: 'yes', label: 'All taken' }, { value: 'no', label: 'Some missed', tone: 'danger' }]} />
          {medsTaken === 'no' && (
            <label className="field">
              <span>Which medicines were missed?</span>
              <input value={form.missed} onChange={(e) => set('missed')(e.target.value)} placeholder="e.g. Losartan, Amlodipine" />
            </label>
          )}
          <Segmented label="Moving around" name="mobility" value={mobility} onChange={setMobility} options={MOBILITY} />
          <Segmented label="Mood" name="mood" value={mood} onChange={setMood} options={MOOD} />
          <label className="field">
            <span>Notes for the nurse (optional)</span>
            <textarea rows="3" maxLength={2000} value={form.notes} onChange={(e) => set('notes')(e.target.value)} placeholder="Appetite, sleep, complaints…" />
          </label>

          {error && (
            <div className="note note-error" role="alert">
              <strong>Not saved. Please check:</strong>
              <ul>{error.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}

          {result && (
            <div className={`result result-${result.severity}`} role="status">
              <div className="result-head">
                <SeverityBadge value={result.severity} />
                <strong>{result.severity === 'none' ? 'Saved. All readings look normal.' : 'Saved. Some readings need attention.'}</strong>
              </div>
              {result.anomalies.length > 0 && (
                <>
                  <ul>{result.anomalies.map((a) => <li key={a.code}>{a.message}{a.value !== undefined ? ` (${a.value})` : ''}</li>)}</ul>
                  <p className="small">The family and the health center were notified automatically.</p>
                </>
              )}
            </div>
          )}

          <button className="btn btn-primary btn-lg" disabled={busy || !patientId}>{busy ? 'Saving…' : 'Save check-in'}</button>
        </form>

        <section className="panel">
          <h2 className="panel-title">This week</h2>
          {!history && <Loading />}
          {history && history.length === 0 && <Empty title="No check-ins this week">Today's check-in will appear here.</Empty>}
          {history && history.length > 0 && (
            <ul className="history-list">
              {history.map((c) => (
                <li key={c.id}>
                  <div className="history-main">
                    <span className="history-bp">{bp(c.vitals)}</span>
                    <span className="muted small">
                      {[c.vitals.heartRate && `${c.vitals.heartRate} bpm`, c.vitals.temperatureC && `${c.vitals.temperatureC} °C`, c.vitals.spo2 && `${c.vitals.spo2}%`].filter(Boolean).join(', ') || 'No vitals recorded'}
                    </span>
                  </div>
                  <div className="history-meta">
                    <SeverityBadge value={c.severity} />
                    <time className="muted small" dateTime={c.recordedAt} title={dateTime(c.recordedAt)}>{relTime(c.recordedAt)}</time>
                  </div>
                  {c.medication.taken === false && <Chip tone="chip-warn">Medicine missed</Chip>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
