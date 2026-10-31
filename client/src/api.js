// Small wrappers around fetch for our three endpoints.
// On an error response they throw an Error with .status and the server's message,
// so pages can show "Already paid", "Expired", etc.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function createSession({ merchantId, routeId, amount }) {
  return request('/api/session/create', {
    method: 'POST',
    body: JSON.stringify({ merchantId, routeId, amount }),
  });
}

export function authorizePayment({ payload, pin }) {
  return request('/api/session/authorize', {
    method: 'POST',
    body: JSON.stringify({ payload, pin }),
  });
}

export function getSessionStatus(sessionId) {
  return request(`/api/session/${sessionId}/status`);
}
