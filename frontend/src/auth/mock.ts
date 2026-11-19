import type { Transport } from './client';
// Explicit development transport; never installed globally or used by default.
export const mockTransport: Transport = async (input, init) => {
  if (input !== '/api/auth/login/') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  const { username: employeeId, password } = JSON.parse(String(init?.body || '{}'));
  const accounts = { 'P-100': ['pilot', 'SAMPLE-100'], 'P-200': ['pilot', 'SAMPLE-200'], 'M-001': ['management', 'all'], 'A-001': ['admin', 'all'] } as const;
  const account = accounts[employeeId as keyof typeof accounts];
  if (!account || password !== 'demo-only') return new Response('{}', { status: 401 });
  return new Response(JSON.stringify({ token: `mock-only-${employeeId}`, expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), user: { id: employeeId, role: account[0], fleet: account[1] } }), { status: 200 });
};
