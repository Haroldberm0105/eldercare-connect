import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import { navigate } from '../router';
import { PageHeader, Segmented } from '../components/ui';

const CONDITIONS = [
  ['hypertension', 'Hypertension'], ['cardiovascular', 'Heart disease'], ['diabetes', 'Diabetes'], ['copd', 'COPD / asthma'],
  ['kidney_disease', 'Kidney disease'], ['stroke', 'Stroke history'], ['dementia', 'Dementia'], ['osteoarthritis', 'Arthritis'],
];
const EMPTY_MED = { name: '', dosage: '', frequency: 'Once daily', times: '08:00' };
const num = (v) => (v === '' ? undefined : Number(v));

export default function AddPatient() {
  const toast = useToast();
  const [f, setF] = useState({
    fullName: '', birthDate: '', sex: 'F', addressLine: '', zipCode: '', assignedClinic: '', mobility: 'no',
    systolic: '', diastolic: '', heartRate: '', spo2: '', ecName: '', ecRelation: '', ecPhone: '', notes: '',
  });
  const [conditions, setConditions] = useState([]);
  const [meds, setMeds] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [family, setFamily] = useState([]);
  const [caregiverId, setCaregiverId] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [errors, setErrors] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api('/api/directory/users?role=caregiver,family_member').then((r) => {
      setCaregivers(r.users.filter((u) => u.role === 'caregiver'));
      setFamily(r.users.filter((u) => u.role === 'family_member'));
    }).catch(() => {});
  }, []);

  const toggle = (c) => setConditions((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  const setMed = (i, k, v) => setMeds((list) => list.map((m, idx) => (idx === i ? { ...m, [k]: v } : m)));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors(null);
    const body = {
      fullName: f.fullName, birthDate: f.birthDate, sex: f.sex, addressLine: f.addressLine, zipCode: f.zipCode,
      assignedClinic: f.assignedClinic || undefined, conditions, mobilityRestricted: f.mobility === 'yes',
      baseline: { systolic: num(f.systolic), diastolic: num(f.diastolic), heartRate: num(f.heartRate), spo2: num(f.spo2) },
      emergencyContact: f.ecName || f.ecPhone ? { name: f.ecName, relation: f.ecRelation, phone: f.ecPhone } : undefined,
      notes: f.notes || undefined,
      medications: meds.filter((m) => m.name.trim()).map((m) => ({ ...m, times: m.times.split(',').map((t) => t.trim()).filter(Boolean) })),
    };
    try {
      const r = await api('/api/patients', { method: 'POST', body });
      const pid = r.patient.id;
      const linked = [];
      for (const uid of [caregiverId, familyId].filter(Boolean)) {
        try {
          await api(`/api/directory/users/${uid}/patients`, { method: 'PUT', body: { add: [pid] } });
          linked.push(uid);
        } catch { /* reported below */ }
      }
      // The emergency contact receives SMS alerts too.
      if (f.ecPhone) {
        await api('/api/alerts/subscribers', { method: 'POST', body: { patientId: pid, name: f.ecName || 'Emergency contact', relation: 'family', phone: f.ecPhone } }).catch(() => {});
      }
      toast({ tone: 'success', title: `${r.patient.fullName} added as ${pid}`, body: linked.length ? 'Linked accounts must sign in again to see the new patient.' : undefined });
      navigate(`/clinic/patients/${pid}`);
    } catch (err) {
      if (err.status === 409) setErrors([`${err.message}. Open their profile instead.`]);
      else setErrors(err.details || [err.message]);
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <>
      <PageHeader title="Add patient" subtitle="Register an elderly patient so their caregiver can start daily check-ins." />
      {errors && <div className="note note-error" role="alert"><div><strong>Not saved. Please check:</strong><ul>{errors.map((m) => <li key={m}>{m}</li>)}</ul></div></div>}
      <form className="add-patient" onSubmit={submit} noValidate>
        <section className="panel">
          <h2 className="panel-title">Personal details</h2>
          <div className="form-grid">
            <label className="field"><span>Full name</span><input value={f.fullName} onChange={set('fullName')} required autoComplete="off" /></label>
            <label className="field"><span>Birth date</span><input type="date" value={f.birthDate} onChange={set('birthDate')} required /></label>
          </div>
          <Segmented label="Sex" name="sex" value={f.sex} onChange={(v) => setF({ ...f, sex: v })} options={[{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'X', label: 'Other' }]} />
          <label className="field"><span>Home address</span><input value={f.addressLine} onChange={set('addressLine')} placeholder="House no., street, barangay, city" required /></label>
          <div className="form-grid">
            <label className="field"><span>ZIP code (used for weather alerts)</span><input value={f.zipCode} onChange={set('zipCode')} inputMode="numeric" placeholder="1012" required /></label>
            <label className="field"><span>Health center</span><input value={f.assignedClinic} onChange={set('assignedClinic')} placeholder="RHU-MNL-01" /></label>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Health</h2>
          <fieldset className="checks">
            <legend>Conditions</legend>
            {CONDITIONS.map(([value, label]) => (
              <label key={value} className={`check ${conditions.includes(value) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={conditions.includes(value)} onChange={() => toggle(value)} /> {label}
              </label>
            ))}
          </fieldset>
          <Segmented label="Needs help to move or evacuate?" name="mobility" value={f.mobility} onChange={(v) => setF({ ...f, mobility: v })} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes, limited mobility' }]} />
          <p className="field-label">Usual readings (optional, used to spot changes)</p>
          <div className="form-grid four">
            <label className="field"><span>Systolic</span><input type="number" value={f.systolic} onChange={set('systolic')} placeholder="130" /></label>
            <label className="field"><span>Diastolic</span><input type="number" value={f.diastolic} onChange={set('diastolic')} placeholder="80" /></label>
            <label className="field"><span>Heart rate</span><input type="number" value={f.heartRate} onChange={set('heartRate')} placeholder="75" /></label>
            <label className="field"><span>SpO₂ %</span><input type="number" value={f.spo2} onChange={set('spo2')} placeholder="97" /></label>
          </div>
          <p className="field-label">Prescribed medicines</p>
          {meds.map((m, i) => (
            <div className="form-grid four med-row" key={i}>
              <label className="field"><span>Medicine</span><input value={m.name} onChange={(e) => setMed(i, 'name', e.target.value)} /></label>
              <label className="field"><span>Dose</span><input value={m.dosage} onChange={(e) => setMed(i, 'dosage', e.target.value)} placeholder="5 mg" /></label>
              <label className="field"><span>How often</span><input value={m.frequency} onChange={(e) => setMed(i, 'frequency', e.target.value)} /></label>
              <label className="field"><span>Times</span><input value={m.times} onChange={(e) => setMed(i, 'times', e.target.value)} placeholder="08:00, 20:00" /></label>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMeds([...meds, { ...EMPTY_MED }])}>Add a medicine</button>
        </section>

        <section className="panel">
          <h2 className="panel-title">Care team</h2>
          <div className="form-grid">
            <label className="field"><span>Caregiver account</span>
              <select value={caregiverId} onChange={(e) => setCaregiverId(e.target.value)}>
                <option value="">Link later</option>
                {caregivers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Family account</span>
              <select value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
                <option value="">Link later</option>
                {family.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>
          <p className="field-label">Emergency contact (also receives SMS alerts)</p>
          <div className="form-grid three">
            <label className="field"><span>Name</span><input value={f.ecName} onChange={set('ecName')} /></label>
            <label className="field"><span>Relation</span><input value={f.ecRelation} onChange={set('ecRelation')} placeholder="daughter" /></label>
            <label className="field"><span>Mobile number</span><input value={f.ecPhone} onChange={set('ecPhone')} inputMode="tel" placeholder="09171234567" /></label>
          </div>
          <label className="field"><span>Notes (optional)</span><textarea rows="2" value={f.notes} onChange={set('notes')} /></label>
        </section>

        <div className="btn-row form-actions">
          <button className="btn btn-primary btn-lg" disabled={saving}>{saving ? 'Saving…' : 'Add patient'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => navigate('/clinic')}>Cancel</button>
        </div>
      </form>
    </>
  );
}
