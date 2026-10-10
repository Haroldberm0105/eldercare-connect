import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { currentUser, logout, onSessionEnd } from './api';
import { navigate, usePath } from './router';
import { ToastProvider } from './toast';
import Shell from './components/Shell';
import Login from './pages/Login';
import CaregiverCheckIn from './pages/CaregiverCheckIn';
import FamilyDashboard from './pages/FamilyDashboard';
import ClinicQueue from './pages/ClinicQueue';
import AdminView from './pages/AdminView';
import './styles.css';

const HOME = { caregiver: '/caregiver', family_member: '/family', clinic_staff: '/clinic', system_admin: '/admin' };
const ROUTES = {
  '/caregiver': { roles: ['caregiver'], page: CaregiverCheckIn, title: 'Daily check-in' },
  '/family': { roles: ['family_member'], page: FamilyDashboard, title: 'Family dashboard' },
  '/clinic': { roles: ['clinic_staff', 'system_admin'], page: ClinicQueue, title: 'Risk queue' },
  '/admin': { roles: ['system_admin'], page: AdminView, title: 'System status' },
};

function App() {
  const [user, setUser] = useState(currentUser());
  const path = usePath();

  useEffect(() => onSessionEnd(() => setUser(null)), []);

  const route = ROUTES[path];
  const allowed = user && route && route.roles.includes(user.role);

  // Redirects: signed out -> /login, signed in on /login or a page for another role -> role home.
  useEffect(() => {
    if (!user && path !== '/login') navigate('/login', { replace: true });
    else if (user && !allowed) navigate(HOME[user.role] || '/login', { replace: true });
  }, [user, path, allowed]);

  useEffect(() => {
    document.title = route && allowed ? `${route.title} – ElderCare Connect` : 'ElderCare Connect';
  }, [route, allowed]);

  if (!user) {
    return <Login onLogin={(u) => { setUser(u); navigate(HOME[u.role], { replace: true }); }} />;
  }
  if (!allowed) return null;

  const Page = route.page;
  // Keyed by user so notifications from one account never carry over to the next sign-in.
  return (
    <ToastProvider key={user.id}>
      <Shell user={user} onSignOut={() => { logout(); }}>
        <Page user={user} />
      </Shell>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
