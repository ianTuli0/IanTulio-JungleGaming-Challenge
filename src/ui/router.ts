import { useSyncExternalStore } from 'react';

// Hash routes keep refresh/back working on any static host without rewrites.
export type Route = 'menu' | 'options' | 'play' | 'result' | 'log/ranking' | 'log/history';

const ROUTES: Route[] = ['menu', 'options', 'play', 'result', 'log/ranking', 'log/history'];

const read = (): Route => {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(hash) ? (hash as Route) : 'menu';
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export const useRoute = () => useSyncExternalStore(subscribe, read);

export function navigate(route: Route): void {
  window.location.hash = route === 'menu' ? '/' : `/${route}`;
}
