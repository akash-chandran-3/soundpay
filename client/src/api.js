// Small wrappers around fetch for our endpoints.
// On an error response they throw an Error with .status, the server's message,
// and .data (the whole JSON body, e.g. the UPI steps of a declined payment),
// so pages can show "Already paid", "Insufficient funds", etc.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
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

export function authorizePayment({ payload, pin, payerVpa }) {
  return request('/api/session/authorize', {
    method: 'POST',
    body: JSON.stringify({ payload, pin, payerVpa }),
  });
}

export function getSessionStatus(sessionId) {
  return request(`/api/session/${sessionId}/status`);
}

export function getDemoAccounts() {
  return request('/api/upi/demo-accounts');
}
