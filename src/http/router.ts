import { AppError } from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type Route = {
  method: HttpMethod;
  regex: RegExp;
  keys: string[];
  handler: import('./types.ts').RouteHandler;
};

export class Router {
  private routes: Route[] = [];

  add(method: HttpMethod, path: string, handler: import('./types.ts').RouteHandler): this {
    const keys: string[] = [];
    const pattern = path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, regex: new RegExp(`^${pattern}/?$`), keys, handler });
    return this;
  }

  get(path: string, handler: import('./types.ts').RouteHandler) { return this.add('GET', path, handler); }
  post(path: string, handler: import('./types.ts').RouteHandler) { return this.add('POST', path, handler); }
  put(path: string, handler: import('./types.ts').RouteHandler) { return this.add('PUT', path, handler); }
  patch(path: string, handler: import('./types.ts').RouteHandler) { return this.add('PATCH', path, handler); }
  delete(path: string, handler: import('./types.ts').RouteHandler) { return this.add('DELETE', path, handler); }

  match(method: string, pathname: string): { handler: import('./types.ts').RouteHandler; params: Record<string, string> } | null {
    const normalized = method === 'HEAD' ? 'GET' : method;
    let pathMatched = false;
    for (const route of this.routes) {
      const match = route.regex.exec(pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== normalized) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? '');
      });
      return { handler: route.handler, params };
    }
    if (pathMatched) throw new AppError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
    return null;
  }
}
