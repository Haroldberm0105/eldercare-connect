import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { PageHeader, Empty, ErrorNote, Loading } from '../components/ui';
import { VisitCard } from '../components/visits';

const TABS = [
  ['upcoming', 'Upcoming', 'Scheduled visits, soonest first. Overdue visits stay here until you record the outcome.'],
  ['recent', 'Recent', 'Visits marked completed in the last 30 days. Completing a visit is what adds it here.'],
  ['all', 'All', 'Every visit, including cancelled and no-show visits.'],
];

export default function ClinicVisits({ user }) {
  const [view, setView] = useState('upcoming');
  const [visits, setVisits] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api(`/api/clinic/visits?view=${view}&limit=100`)
    .then((r) => { setVisits(r.visits); setError(''); })
    .catch((e) => setError(e.message)), [view]);
  useEffect(() => { setVisits(null); load(); }, [load]);

  const tab = TABS.find((t) => t[0] === view);
  return (
    <>
      <PageHeader title="Visits" subtitle={tab[2]}>
        <div className="tabs" role="group" aria-label="Which visits">
          {TABS.map(([key, label]) => <button key={key} type="button" className={`tab ${view === key ? 'is-on' : ''}`} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
        </div>
      </PageHeader>
      <ErrorNote error={error} onRetry={load} />
      {!visits && !error && <Loading label="Loading visits" />}
      {visits && visits.length === 0 && (
        <Empty title={view === 'upcoming' ? 'No visits scheduled' : 'No visits here yet'}>
          {view === 'upcoming' ? 'Schedule a visit from a case in the risk queue.' : 'Visits appear here once their outcome is recorded.'}
        </Empty>
      )}
      <div className="visit-grid">
        {(visits || []).map((v) => (
          <VisitCard key={v.id} visit={v} canAct={user.role === 'clinic_staff'} showPatient onChanged={load}
            onOpenPatient={(id) => navigate(`/clinic/patients/${encodeURIComponent(id)}`)} />
        ))}
      </div>
    </>
  );
}
