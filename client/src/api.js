// Thin fetch wrapper that adds the session token and surfaces API errors.
const BASE = import.meta.env.VITE_API_URL || `${import.meta.env.BASE_URL}api`;

export const getToken = () => localStorage.getItem('wf_token');
// A mentor can look at a direct report's data; the server checks the person really reports to them.
export const getViewAs = () => { try { return sessionStorage.getItem('wf_view_as') || ''; } catch { return ''; } };
export const setViewAs = (id) => { try { if (id) sessionStorage.setItem('wf_view_as', String(id)); else sessionStorage.removeItem('wf_view_as'); } catch { /* ignore */ } };
export const setToken = (t) => (t ? localStorage.setItem('wf_token', t) : localStorage.removeItem('wf_token'));

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(getViewAs() ? { 'X-View-As': getViewAs() } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 401 && !url.startsWith('/auth/login')) {
    setToken(null);
    window.location.href = import.meta.env.BASE_URL;
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Opens a server-rendered page (e.g. an invoice) that needs the token.
export const openWithToken = (u) => window.open(`${BASE}${u}${u.includes('?') ? '&' : '?'}token=${getToken()}${getViewAs() ? `&viewAs=${getViewAs()}` : ''}`, '_blank');
