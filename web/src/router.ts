import { useCallback, useEffect, useState } from 'react';

export type RoutePath = '/' | '/formats' | '/convert' | '/login' | '/history' | '/account' | '/admin';

export const ROUTES: RoutePath[] = ['/', '/formats', '/convert', '/login', '/history', '/account', '/admin'];

export const PROTECTED_ROUTES: RoutePath[] = ['/history', '/account', '/admin'];

export function isProtectedRoute(path: string): path is RoutePath {
  return (PROTECTED_ROUTES as string[]).includes(path);
}

type Location = { path: string; search: string };

function parseHash(): Location {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { path: '/', search: '' };
  const index = raw.indexOf('?');
  const rawPath = index === -1 ? raw : raw.slice(0, index);
  const search = index === -1 ? '' : raw.slice(index + 1);
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return { path, search };
}

export function readPath(): string {
  return parseHash().path;
}

export type NavigateParams = Record<string, string | undefined | null>;

function buildHash(path: string, params?: NavigateParams): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function navigate(path: string, params?: NavigateParams): void {
  const target = buildHash(path, params);
  if (window.location.hash.replace(/^#/, '') === target) return;
  window.location.hash = target;
}

/** 安全地解析 `next` 参数：只允许跳回站内的已知页面。 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('?') || value.includes('#')) return null;
  return (ROUTES as string[]).includes(value) ? value : null;
}

export function useRoute(): {
  path: string;
  query: URLSearchParams;
  go: (path: string, params?: NavigateParams) => void;
} {
  const [location, setLocation] = useState<Location>(parseHash);

  useEffect(() => {
    const onChange = () => setLocation(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = useCallback((path: string, params?: NavigateParams) => {
    navigate(path, params);
    const hash = buildHash(path, params);
    const index = hash.indexOf('?');
    setLocation({ path, search: index === -1 ? '' : hash.slice(index + 1) });
  }, []);

  return { path: location.path, query: new URLSearchParams(location.search), go };
}
