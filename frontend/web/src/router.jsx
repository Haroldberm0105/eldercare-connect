// Minimal client-side router (History API). Keeps the app free of extra routing dependencies.
import React, { useEffect, useState } from 'react';

const EVENT = 'app:navigate';

export function navigate(to, { replace = false } = {}) {
  if (window.location.pathname === to) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new Event(EVENT));
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/**
 * Matches a path against patterns like '/clinic/patients/:id'. Static patterns win over parameterised ones.
 * @returns {{ pattern:string, params:object } | null}
 */
export function matchRoute(patterns, path) {
  const clean = path.replace(/\/+$/, '') || '/';
  if (patterns.includes(clean)) return { pattern: clean, params: {} };
  for (const pattern of patterns) {
    const a = pattern.split('/');
    const b = clean.split('/');
    if (a.length !== b.length || !pattern.includes(':')) continue;
    const params = {};
    const ok = a.every((seg, i) => {
      if (seg.startsWith(':')) { params[seg.slice(1)] = decodeURIComponent(b[i]); return b[i] !== ''; }
      return seg === b[i];
    });
    if (ok) return { pattern, params };
  }
  return null;
}

export function Link({ to, className = '', activeClassName = 'is-active', exact = true, children, ...rest }) {
  const path = usePath();
  const active = exact ? path === to : path === to || path.startsWith(`${to}/`);
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={`${className} ${active ? activeClassName : ''}`.trim()} aria-current={active ? 'page' : undefined} {...rest}>
      {children}
    </a>
  );
}
