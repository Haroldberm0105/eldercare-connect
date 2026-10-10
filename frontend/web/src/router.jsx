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

export function Link({ to, className = '', activeClassName = 'is-active', children, ...rest }) {
  const path = usePath();
  const active = path === to;
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
