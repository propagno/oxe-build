'use strict';
function createRouter() {
  const routes = [];
  const parse = (pattern, path) => {
    const a = pattern.split('/');
    const b = path.split('/');
    if (a.length !== b.length) return null;
    const params = {};
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
      else if (a[i] !== b[i]) return null;
    }
    return params;
  };
  return {
    add(method, pattern, handler) { routes.push({ method, pattern, handler }); },
    match(method, url) {
      const path = url.split('?')[0];
      const allow = [];
      for (const r of routes) {
        const p = parse(r.pattern, path);
        if (!p) continue;
        if (r.method === method) return { handler: r.handler, params: p };
        allow.push(r.method);
      }
      return allow.length ? { status: 405, allow: [...new Set(allow)].sort() } : { status: 404 };
    },
  };
}
module.exports = { createRouter };
