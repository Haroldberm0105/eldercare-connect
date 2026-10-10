import React from 'react';
import { Link } from '../router';
import { ROLE_LABEL, initials } from '../format';

const NAV = {
  caregiver: [{ to: '/caregiver', label: 'Daily check-in' }],
  family_member: [{ to: '/family', label: 'My family member' }],
  clinic_staff: [{ to: '/clinic', label: 'Risk queue' }],
  system_admin: [{ to: '/clinic', label: 'Risk queue' }, { to: '/admin', label: 'System status' }],
};

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <path d="M16 28s-11-6.6-11-15A6 6 0 0 1 16 9.6 6 6 0 0 1 27 13c0 8.4-11 15-11 15z" fill="currentColor" opacity=".16" />
      <path d="M4 17h6l2.5-5 4 10 3-7 1.5 2H28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Shell({ user, onSignOut, children }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>ElderCare Connect</span>
        </div>
        <nav aria-label="Main">
          {(NAV[user.role] || []).map((item) => (
            <Link key={item.to} to={item.to} className="nav-link">{item.label}</Link>
          ))}
        </nav>
        <div className="account">
          <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          <div className="account-text">
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role]}</span>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      <main className="content" id="main">{children}</main>
    </div>
  );
}
