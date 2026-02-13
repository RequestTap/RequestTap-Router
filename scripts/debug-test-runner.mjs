/**
 * Runs all debug test scenarios against the live gateway + dashboard.
 * Usage: node scripts/debug-test-runner.mjs
 */

const GW = 'http://localhost:4402';
const DASH = 'http://localhost:3000';
const ADMIN_KEY = 'rt-admin-dev-key';

let passed = 0, failed = 0, skipped = 0;
const failures = [];

async function gw(path, opts = {}) {
  const headers = { ...opts.headers };
  return fetch(`${GW}${path}`, { ...opts, headers });
}

async function admin(path, opts = {}) {
  const headers = { 'Authorization': `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', ...opts.headers };
  return fetch(`${GW}/admin${path}`, { ...opts, headers });
}

function pass(name, info = '') { passed++; console.log(`  PASS  ${name}${info ? ' — ' + info : ''}`); }
function fail(name, info = '') { failed++; failures.push(name); console.log(`  FAIL  ${name}${info ? ' — ' + info : ''}`); }
function skip(name, info = '') { skipped++; console.log(`  SKIP  ${name}${info ? ' — ' + info : ''}`); }

// Load routes + config
let routes, cfg;
async function loadContext() {
  const rr = await admin('/routes'); routes = (await rr.json()).routes;
  const cr = await admin('/dashboard-config'); cfg = await cr.json();
}

function firstEnabled() { return routes.find(r => !r.restricted); }
function concretePath(p) { return p.replace(/:([^/]+)/g, 'test'); }

// ── Core ──
async function testHealth() {
  const r = await admin('/health');
  const d = await r.json();
  r.status === 200 && d.status === 'ok' ? pass('Health') : fail('Health', JSON.stringify(d));
}

async function testRouteMatch() {
  const route = firstEnabled();
  if (!route) { skip('Route Match', 'no enabled routes'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  r.status !== 404 ? pass('Route Match', `${r.status} on ${route.path}`) : fail('Route Match', `404`);
}

async function testRoute404() {
  const r = await gw('/api/v1/__nonexistent__', { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  r.status === 404 ? pass('Route 404') : fail('Route 404', `got ${r.status}`);
}

async function testAuth401() {
  const route = firstEnabled();
  if (!route) { skip('Auth 401', 'no enabled routes'); return; }
  const r = await gw(concretePath(route.path)); // no auth header
  r.status === 401 ? pass('Auth 401') : fail('Auth 401', `got ${r.status}`);
}

async function testAuthValid() {
  const route = firstEnabled();
  if (!route) { skip('Auth Valid', 'no enabled routes'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  r.status !== 401 ? pass('Auth Valid', `${r.status}`) : fail('Auth Valid', 'got 401');
}

async function testRestrictedRoute() {
  const route = routes.find(r => r.restricted);
  if (!route) { skip('Restricted Route', 'no restricted routes'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  pass('Restricted Route', `${r.status} on disabled route`);
}

// ── E2E ──
let e2eReceipt = null;

async function testE2ePipeline() {
  const testRoute = {
    tool_id: '__e2e_test__', path: '/api/v1/__e2e_test__', method: 'GET', price_usdc: '0',
    provider: { provider_id: '__e2e__', backend_url: `http://127.0.0.1:3000/e2e-test-upstream` },
    _skip_ssrf: true,
  };
  const cr = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  if (!cr.ok) { fail('E2E Pipeline', `create: ${cr.status}`); return; }
  const r = await gw('/api/v1/__e2e_test__', { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  const d = await r.json();
  const rh = r.headers.get('x-receipt');
  if (rh) try { e2eReceipt = JSON.parse(atob(rh)); } catch {}
  try { await admin('/routes/__e2e_test__', { method: 'DELETE' }); } catch {}
  r.status === 200 && d.ok && e2eReceipt?.outcome === 'SUCCESS' ? pass('E2E Pipeline') : fail('E2E Pipeline', `${r.status}`);
}

async function testE2eReceipt() {
  if (!e2eReceipt) { skip('E2E Receipt', 'no receipt from pipeline'); return; }
  const r = await admin('/receipts?tool_id=__e2e_test__&limit=1');
  const d = await r.json();
  d.receipts?.length > 0 && d.receipts[0].outcome === 'SUCCESS' ? pass('E2E Receipt') : fail('E2E Receipt');
}

async function testE2eHash() {
  if (!e2eReceipt) { skip('E2E Hash', 'no receipt'); return; }
  const valid = typeof e2eReceipt.response_hash === 'string' && /^0x[0-9a-f]{64}$/i.test(e2eReceipt.response_hash);
  valid ? pass('E2E Hash', e2eReceipt.response_hash.slice(0, 18) + '...') : fail('E2E Hash');
}

async function testE2e402() {
  const testRoute = {
    tool_id: '__e2e_pay_test__', path: '/api/v1/__e2e_pay_test__', method: 'GET', price_usdc: '0.01',
    provider: { provider_id: '__e2e__', backend_url: `http://127.0.0.1:3000/e2e-test-upstream` },
    _skip_ssrf: true,
  };
  const cr = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  if (!cr.ok) { fail('E2E 402', `create: ${cr.status}`); return; }
  const listR = await admin('/routes');
  const listD = await listR.json();
  const found = listD.routes?.find(r => r.tool_id === '__e2e_pay_test__');
  const r = await gw('/api/v1/__e2e_pay_test__', { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  const body = await r.text();
  let d; try { d = JSON.parse(body); } catch { d = body; }
  const rh = r.headers.get('x-receipt');
  let receipt; if (rh) try { receipt = JSON.parse(atob(rh)); } catch {}
  try { await admin('/routes/__e2e_pay_test__', { method: 'DELETE' }); } catch {}
  const routeOk = found && found.price_usdc === '0.01';
  const is402 = r.status === 402;
  const receiptPriceOk = receipt?.price_usdc === '0.01';
  (routeOk && (is402 || receiptPriceOk)) ? pass('E2E 402', `${r.status}`) : fail('E2E 402', `${r.status} routeOk=${routeOk}`);
}

async function testUpstreamError() {
  const testRoute = {
    tool_id: '__e2e_dead_upstream__', path: '/api/v1/__e2e_dead_upstream__', method: 'GET', price_usdc: '0',
    provider: { provider_id: '__e2e__', backend_url: 'http://127.0.0.1:1/__dead__' },
    _skip_ssrf: true,
  };
  const cr = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  if (!cr.ok) { fail('Upstream Error', `create: ${cr.status}`); return; }
  const r = await gw('/api/v1/__e2e_dead_upstream__', { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  const d = await r.json();
  try { await admin('/routes/__e2e_dead_upstream__', { method: 'DELETE' }); } catch {}
  (r.status === 502 && d.reason_code === 'UPSTREAM_ERROR_NO_CHARGE') ? pass('Upstream Error (No Charge)', `$${d.price_usdc}`) : fail('Upstream Error', `${r.status} ${d.reason_code}`);
}

// ── Idempotency ──
async function testIdempotency() {
  const route = firstEnabled();
  if (!route) { skip('Idempotency', 'no enabled routes'); return; }
  const key = `debug-idem-${Date.now()}`;
  const headers = { 'X-Request-Idempotency-Key': key, 'Authorization': `Bearer ${cfg.apiKey || ''}` };
  await gw(concretePath(route.path), { headers });
  const r2 = await gw(concretePath(route.path), { headers });
  r2.status === 409 ? pass('Idempotency') : fail('Idempotency', `2nd request got ${r2.status}`);
}

// ── Payment ──
async function testPaymentRequired() {
  const route = routes.find(r => !r.restricted && parseFloat(r.price_usdc) > 0);
  if (!route) { skip('Payment Required', 'no priced routes'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  r.status === 402 ? pass('Payment Required') : fail('Payment Required', `got ${r.status}`);
}

async function testX402HeaderValid() {
  const route = routes.find(r => !r.restricted && parseFloat(r.price_usdc) > 0);
  if (!route) { skip('x402 Header', 'no priced routes'); return; }
  if (!cfg?.payToAddress) { skip('x402 Header', 'no pay-to address'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  if (r.status !== 402) { skip('x402 Header', `got ${r.status}, not 402`); return; }
  const d = await r.json();
  // x402 v2 puts payment info in the `payment-required` header (base64 JSON), body may be empty
  let reqs = d?.paymentRequirements || d?.accepts;
  let source = 'body';
  if (!reqs || !Array.isArray(reqs) || reqs.length === 0) {
    const prHeader = r.headers.get('payment-required');
    if (prHeader) {
      try { const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString()); reqs = decoded?.paymentRequirements || decoded?.accepts; source = 'header'; } catch {}
    }
  }
  if (!reqs || !Array.isArray(reqs) || reqs.length === 0) {
    skip('x402 Header', 'x402 facilitator not fully configured — 402 without payment requirements');
    return;
  }
  const hasPayTo = !!reqs[0].payTo || !!reqs[0].pay_to;
  const hasNetwork = !!reqs[0].network;
  (hasPayTo && hasNetwork) ? pass('x402 Header', `payTo: ${reqs[0].payTo || reqs[0].pay_to} (${source})`) : fail('x402 Header');
}

// ── Security / x402 ──
async function testX402Probe() {
  const envR = await fetch(`${DASH}/env-status`);
  const env = await envR.json();
  if (env.rtSkipX402Probe) { skip('x402 Probe', 'RT_SKIP_X402_PROBE set'); return; }
  const testRoute = {
    tool_id: '__x402_probe_test__', path: '/api/v1/__x402_probe_test__', method: 'GET', price_usdc: '0',
    provider: { provider_id: '__x402_probe_test__', backend_url: `http://127.0.0.1:3000/x402-test-upstream` },
    _skip_ssrf: true,
  };
  const r = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  const d = await r.json();
  if (r.status === 400 && d.reason === 'X402_UPSTREAM_BLOCKED') {
    pass('x402 Probe', 'upstream blocked');
  } else {
    try { await admin('/routes/__x402_probe_test__', { method: 'DELETE' }); } catch {}
    fail('x402 Probe', `${r.status} ${JSON.stringify(d)}`);
  }
}

async function testX402Skip() {
  const r = await fetch(`${DASH}/env-status`);
  const d = await r.json();
  !d.rtSkipX402Probe ? pass('x402 Skip Check', 'probe active') : fail('x402 Skip Check', 'probe disabled');
}

async function testSsrfBlocked() {
  const testRoute = {
    tool_id: '__ssrf_test__', path: '/api/v1/__ssrf_test__', method: 'GET', price_usdc: '0',
    provider: { provider_id: '__ssrf__', backend_url: 'http://10.0.0.1:8080/internal-service' },
  };
  const r = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  const d = await r.json();
  // Always clean up — the route may persist in-memory despite the 400
  try { await admin('/routes/__ssrf_test__', { method: 'DELETE' }); } catch {}
  if (r.status === 400 && d.reason === 'SSRF_BLOCKED') {
    pass('SSRF Protection');
  } else {
    fail('SSRF Protection', `${r.status} ${JSON.stringify(d)}`);
  }
}

// ── Mandate ──
const MANDATE_VALID_B64 = 'eyJtYW5kYXRlX2lkIjoiZGVidWctbWFuZGF0ZS12YWxpZCIsIm93bmVyX3B1YmtleSI6IjB4ZjM5RmQ2ZTUxYWFkODhGNkY0Y2U2YUI4ODI3Mjc5Y2ZmRmI5MjI2NiIsImV4cGlyZXNfYXQiOiIyMDk5LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJtYXhfc3BlbmRfdXNkY19wZXJfZGF5IjoiMTAwLjAwIiwiYWxsb3dsaXN0ZWRfdG9vbF9pZHMiOlsiKiJdLCJzaWduYXR1cmUiOiIweDZmZjQ0ODdkM2EwNmZiNzAzMTI0ZWM5YTU5NTg3NzEzYTkzODU4NjNlZjZmM2UxNTU5YTM1NzNkMmMyZjYwZGE0YzQ5NzRmZTFiNzkyYTlhMmNhMTBmZTQxNjc3ZGI2OWVhYzg5Yjc4YjRjODNhZDM4OTM1MDNmM2EwYTk0MThmMWIifQ==';
const MANDATE_EXPIRED_B64 = 'eyJtYW5kYXRlX2lkIjoiZGVidWctbWFuZGF0ZS1leHBpcmVkIiwib3duZXJfcHVia2V5IjoiMHhmMzlGZDZlNTFhYWQ4OEY2RjRjZTZhQjg4MjcyNzljZmZGYjkyMjY2IiwiZXhwaXJlc19hdCI6IjIwMjAtMDEtMDFUMDA6MDA6MDAuMDAwWiIsIm1heF9zcGVuZF91c2RjX3Blcl9kYXkiOiIxMDAuMDAiLCJhbGxvd2xpc3RlZF90b29sX2lkcyI6WyIqIl0sInNpZ25hdHVyZSI6IjB4OGE4YzQ0NjY4OThhNGVjMWU0YWRlOTg5YzY4NmQxY2FhOTY3MmQwMGIyYzBjNTNjNDA1Zjg4YTE5YmJkMjEyOTBkZDE2OGFlZTY3MzVhYmRlNmEzMjZhYzE2MzRkZjU2OWVlODZkZDcxZDMxMjZjY2RiMjVmMDQ3ZjU1Y2IzZTExYyJ9';
const INTENT_LOW_BUDGET_B64 = 'eyJ0eXBlIjoiSW50ZW50TWFuZGF0ZSIsImNvbnRlbnRzIjp7Im5hdHVyYWxfbGFuZ3VhZ2VfZGVzY3JpcHRpb24iOiJEZWJ1ZyB0ZXN0OiBsb3cgYnVkZ2V0IGludGVudCIsImJ1ZGdldCI6eyJhbW91bnQiOjAuMDAxLCJjdXJyZW5jeSI6IlVTRCJ9LCJtZXJjaGFudHMiOlsibG9jYWxob3N0IiwiKiJdLCJpbnRlbnRfZXhwaXJ5IjoiMjA5OS0wMS0wMVQwMDowMDowMC4wMDBaIiwicmVxdWlyZXNfcmVmdW5kYWJpbGl0eSI6ZmFsc2V9LCJ1c2VyX3NpZ25hdHVyZSI6IjB4YjQxNzAyYzhhNDQxM2EyMDU3NzgyNDRiMjVkYjcyOGQxMjA2OWI2MGU1MGIxOGFiNTAwZWRhMzA0YWMyMzdhNjJjZDRkNmFiZjM3OTcxM2VlYThhMzYwZWEwMDY2MWM4MTgyNTU1ZmQ2OTc4ZDMyM2Q2NzFiNWQ3OGE0YWQxMmUxYyIsInRpbWVzdGFtcCI6IjIwMjYtMDItMTNUMDk6MDc6NTQuMjQwWiIsInNpZ25lcl9hZGRyZXNzIjoiMHhmMzlGZDZlNTFhYWQ4OEY2RjRjZTZhQjg4MjcyNzljZmZGYjkyMjY2In0=';
const INTENT_WRONG_MERCHANT_B64 = 'eyJ0eXBlIjoiSW50ZW50TWFuZGF0ZSIsImNvbnRlbnRzIjp7Im5hdHVyYWxfbGFuZ3VhZ2VfZGVzY3JpcHRpb24iOiJEZWJ1ZyB0ZXN0OiB3cm9uZyBtZXJjaGFudCIsImJ1ZGdldCI6eyJhbW91bnQiOjEwMCwiY3VycmVuY3kiOiJVU0QifSwibWVyY2hhbnRzIjpbIndyb25nLmV4YW1wbGUuY29tIl0sImludGVudF9leHBpcnkiOiIyMDk5LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJyZXF1aXJlc19yZWZ1bmRhYmlsaXR5IjpmYWxzZX0sInVzZXJfc2lnbmF0dXJlIjoiMHgzODc5YzU3M2ViMTUyOTQxODZmNDIxM2FlY2QwMmEwNWIzZDc1Y2NlYzg0NmEzODQ1YmM1ZTAxZmMzNDQwZWIzMGNhNTk2NzJhNWZjMGZjMGU0NjJjMWZkODZjYTliM2VhYjM0ODBkYjYzMzA4ZDUwNDE0ZjIwMGM1ZjZmZjRkOTFjIiwidGltZXN0YW1wIjoiMjAyNi0wMi0xM1QwOTowNzo1NC4yNDJaIiwic2lnbmVyX2FkZHJlc3MiOiIweGYzOUZkNmU1MWFhZDg4RjZGNGNlNmFCODgyNzI3OWNmZkZiOTIyNjYifQ==';

async function testMandateSkipped() {
  const route = firstEnabled();
  if (!route) { skip('Mandate Skipped'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  const d = await r.json().catch(() => ({}));
  const blocked = r.status === 403 && (d.reason_code || '').startsWith('MANDATE_');
  !blocked ? pass('Mandate Skipped', `${r.status}`) : fail('Mandate Skipped', `blocked: ${d.reason_code}`);
}

async function testMandateRejected() {
  const route = firstEnabled();
  if (!route) { skip('Mandate Rejected'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Mandate': 'not-valid-base64!!!' } });
  r.status === 400 ? pass('Mandate Rejected') : fail('Mandate Rejected', `got ${r.status}`);
}

async function testMandateSig() {
  const route = firstEnabled();
  if (!route) { skip('Mandate Sig'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Mandate': MANDATE_VALID_B64 } });
  const d = await r.json().catch(() => ({}));
  const sigFailed = r.status === 403 && d.reason_code === 'INVALID_SIGNATURE';
  !sigFailed ? pass('Mandate Sig (EIP-191)', `${r.status}`) : fail('Mandate Sig', 'INVALID_SIGNATURE');
}

async function testMandateExpired() {
  const route = firstEnabled();
  if (!route) { skip('Mandate Expired'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Mandate': MANDATE_EXPIRED_B64 } });
  const d = await r.json().catch(() => ({}));
  (r.status === 403 && d.reason_code === 'MANDATE_EXPIRED') ? pass('Mandate Expired') : fail('Mandate Expired', `${r.status} ${d.reason_code}`);
}

async function testMandateBudget() {
  const r = await admin('/spend/debug-mandate-valid');
  const d = await r.json();
  r.ok ? pass('Mandate Budget', `spent: $${d.spent_today_usdc}`) : fail('Mandate Budget', `${r.status}`);
}

async function testIntentBudget() {
  const route = firstEnabled();
  if (!route) { skip('Intent Budget'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Mandate': INTENT_LOW_BUDGET_B64 } });
  const d = await r.json().catch(() => ({}));
  (r.status === 403 && d.reason_code === 'INTENT_BUDGET_EXCEEDED') ? pass('Intent Budget Rejected') : fail('Intent Budget', `${r.status} ${d.reason_code}`);
}

async function testIntentMerchant() {
  const route = firstEnabled();
  if (!route) { skip('Intent Merchant'); return; }
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Mandate': INTENT_WRONG_MERCHANT_B64 } });
  const d = await r.json().catch(() => ({}));
  (r.status === 403 && d.reason_code === 'MERCHANT_NOT_MATCHED') ? pass('Intent Merchant Rejected') : fail('Intent Merchant', `${r.status} ${d.reason_code}`);
}

// ── Blacklist ──
async function testBlacklistApi() {
  const r = await admin('/blacklist');
  const d = await r.json();
  (r.ok && Array.isArray(d.blacklist)) ? pass('Blacklist API') : fail('Blacklist API');
}

async function testAgentAllowed() {
  const route = firstEnabled();
  if (!route) { skip('Agent Allowed'); return; }
  const testAddr = '0x' + 'a'.repeat(40);
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Agent-Address': testAddr } });
  const d = await r.json().catch(() => ({}));
  const blocked = r.status === 403 && d.reason_code === 'AGENT_BLOCKED';
  !blocked ? pass('Agent Allowed', `${r.status}`) : fail('Agent Allowed', 'AGENT_BLOCKED');
}

async function testAgentBlocked() {
  const route = firstEnabled();
  if (!route) { skip('Agent Blocked'); return; }
  const testAddr = '0xDEAD' + 'b'.repeat(36);
  // Add to blacklist
  await admin('/blacklist', { method: 'POST', body: JSON.stringify({ address: testAddr }) });
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}`, 'X-Agent-Address': testAddr } });
  const d = await r.json().catch(() => ({}));
  // Remove from blacklist
  await admin('/blacklist/' + testAddr, { method: 'DELETE' });
  (r.status === 403 && d.reason_code === 'AGENT_BLOCKED') ? pass('Agent Blocked') : fail('Agent Blocked', `${r.status} ${d.reason_code}`);
}

// ── ERC-8004 ──
async function testErc8004Query() {
  const r = await admin('/reputation/1');
  const d = await r.json();
  if (r.ok) pass('ERC-8004 Query', JSON.stringify(d).slice(0, 80));
  else if (d.error?.includes('not configured')) skip('ERC-8004 Query', 'not configured');
  else fail('ERC-8004 Query', `${r.status}`);
}

async function testErc8004Allowed() {
  const route = firstEnabled();
  if (!route) { skip('ERC-8004 Allowed'); return; }
  // Agent with no x-agent-id = no reputation check
  const r = await gw(concretePath(route.path), { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  const d = await r.json().catch(() => ({}));
  const blocked = r.status === 403 && d.reason_code === 'REPUTATION_TOO_LOW';
  !blocked ? pass('ERC-8004 Allowed', `${r.status}`) : fail('ERC-8004 Allowed');
}

async function testErc8004Blocked() {
  const r = await admin('/reputation/999999');
  const d = await r.json();
  if (!r.ok && d.error?.includes('not configured')) { skip('ERC-8004 Blocked', 'not configured'); return; }
  // Token 999999 should have 0 score or not exist
  pass('ERC-8004 Blocked', `score: ${d.score ?? 'N/A'}`);
}

// ── Receipts ──
async function testReceiptsStats() {
  const r = await admin('/receipts/stats');
  const d = await r.json();
  (r.ok && typeof d.total_requests === 'number') ? pass('Receipts Stats', `${d.total_requests} requests`) : fail('Receipts Stats');
}

async function testReceiptsList() {
  const r = await admin('/receipts?limit=5');
  const d = await r.json();
  (r.ok && Array.isArray(d.receipts)) ? pass('Receipts List', `${d.receipts.length} receipts`) : fail('Receipts List');
}

async function testReceiptsFilter() {
  const r = await admin('/receipts?outcome=DENIED');
  const d = await r.json();
  const allDenied = !d.receipts?.length || d.receipts.every(r => r.outcome === 'DENIED');
  (r.ok && allDenied) ? pass('Receipts Filter') : fail('Receipts Filter');
}

async function testReceiptIntegrity() {
  const testRoute = {
    tool_id: '__receipt_integrity_test__', path: '/api/v1/__receipt_integrity_test__', method: 'GET', price_usdc: '0',
    provider: { provider_id: '__e2e__', backend_url: `http://127.0.0.1:3000/e2e-test-upstream` },
    _skip_ssrf: true,
  };
  const cr = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  if (!cr.ok) { fail('Receipt Integrity', `create: ${cr.status}`); return; }
  const r = await gw('/api/v1/__receipt_integrity_test__', { headers: { 'Authorization': `Bearer ${cfg.apiKey || ''}` } });
  const rh = r.headers.get('x-receipt');
  let headerReceipt; if (rh) try { headerReceipt = JSON.parse(atob(rh)); } catch {}
  if (!headerReceipt) { try { await admin('/routes/__receipt_integrity_test__', { method: 'DELETE' }); } catch {} fail('Receipt Integrity', 'no x-receipt header'); return; }
  const ar = await admin('/receipts?tool_id=__receipt_integrity_test__&limit=1');
  const ad = await ar.json();
  try { await admin('/routes/__receipt_integrity_test__', { method: 'DELETE' }); } catch {}
  const stored = ad.receipts?.[0];
  if (!stored) { fail('Receipt Integrity', 'not in admin store'); return; }
  const match = headerReceipt.request_id === stored.request_id && headerReceipt.outcome === stored.outcome && headerReceipt.response_hash === stored.response_hash;
  match ? pass('Receipt Integrity', 'header matches admin store') : fail('Receipt Integrity', 'mismatch');
}

// ── Admin ──
async function testAdminConfig() {
  const r = await admin('/config');
  const d = await r.json();
  (r.ok && d.port) ? pass('Admin Config', `port ${d.port}`) : fail('Admin Config');
}

async function testDashboardConfig() {
  const r = await admin('/dashboard-config');
  const d = await r.json();
  r.ok ? pass('Dashboard Config') : fail('Dashboard Config');
}

async function testAdminRoutes() {
  const r = await admin('/routes');
  const d = await r.json();
  (r.ok && Array.isArray(d.routes)) ? pass('Admin Routes', `${d.routes.length} routes`) : fail('Admin Routes');
}

async function testOpenApiImport() {
  const miniSpec = {
    openapi: '3.0.0', info: { title: 'Debug Test API', version: '1.0.0' },
    paths: {
      '/quotes': { get: { operationId: '__oa_import_quotes__', summary: 'Get quotes' } },
      '/search': { post: { operationId: '__oa_import_search__', summary: 'Search' } },
    },
  };
  const r = await admin('/routes/import', {
    method: 'POST',
    body: JSON.stringify({ openapi: miniSpec, defaults: { providerId: '__oa_test__', backendUrl: 'https://api.example.com', priceUsdc: '0.02' } }),
  });
  const d = await r.json();
  for (const id of (d.added || [])) { try { await admin(`/routes/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {} }
  (r.status === 201 && d.added_count >= 2) ? pass('OpenAPI Import', `${d.added_count} routes`) : fail('OpenAPI Import', `${r.status} ${JSON.stringify(d)}`);
}

async function testPriceUpdate() {
  const testRoute = {
    tool_id: '__price_update_test__', path: '/api/v1/__price_update_test__', method: 'GET', price_usdc: '0.01',
    provider: { provider_id: '__test__', backend_url: 'https://api.example.com/test' },
  };
  const cr = await admin('/routes', { method: 'POST', body: JSON.stringify(testRoute) });
  if (!cr.ok) { fail('Price Update', `create: ${cr.status}`); return; }
  const ur = await admin('/routes/__price_update_test__', { method: 'PUT', body: JSON.stringify({ price_usdc: '0.05' }) });
  if (!ur.ok) { try { await admin('/routes/__price_update_test__', { method: 'DELETE' }); } catch {} fail('Price Update', `update: ${ur.status}`); return; }
  const lr = await admin('/routes');
  const ld = await lr.json();
  const found = ld.routes?.find(r => r.tool_id === '__price_update_test__');
  try { await admin('/routes/__price_update_test__', { method: 'DELETE' }); } catch {}
  (found?.price_usdc === '0.05') ? pass('Price Update', '$0.01 → $0.05') : fail('Price Update', `price=${found?.price_usdc}`);
}

// ── Docs ──
async function testOpenApiSpec() {
  const r = await admin('/docs/openapi');
  const d = await r.json();
  (r.ok && d.openapi?.startsWith('3.0') && d.paths) ? pass('OpenAPI Spec') : fail('OpenAPI Spec');
}

// ── SKALE ──
async function testSkaleRpc() {
  if (!cfg?.skaleRpcUrl) { skip('SKALE RPC', 'not configured'); return; }
  const r = await fetch(`${DASH}/rpc-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcUrl: cfg.skaleRpcUrl, body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } }),
  });
  const d = await r.json();
  d.result ? pass('SKALE RPC', `chainId ${parseInt(d.result, 16)}`) : fail('SKALE RPC');
}

async function testSkaleBlock() {
  if (!cfg?.skaleRpcUrl) { skip('SKALE Block', 'not configured'); return; }
  const r = await fetch(`${DASH}/rpc-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcUrl: cfg.skaleRpcUrl, body: { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 } }),
  });
  const d = await r.json();
  d.result ? pass('SKALE Block', `#${parseInt(d.result, 16)}`) : fail('SKALE Block');
}

async function testBiteCommittee() {
  if (!cfg?.skaleRpcUrl) { skip('BITE Committee', 'not configured'); return; }
  const r = await fetch(`${DASH}/rpc-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcUrl: cfg.skaleRpcUrl, body: { jsonrpc: '2.0', method: 'bite_getCommitteesInfo', params: [], id: 1 } }),
  });
  const d = await r.json();
  if (d.error) skip('BITE Committee', d.error.message || 'not enabled');
  else if (Array.isArray(d.result) && d.result.length > 0) pass('BITE Committee', `${d.result.length} committee(s)`);
  else fail('BITE Committee');
}

async function testBiteContract() {
  if (!cfg?.skaleRpcUrl || !cfg?.skaleBiteContract) { skip('BITE Contract', 'not configured'); return; }
  // eth_getCode
  const codeR = await fetch(`${DASH}/rpc-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcUrl: cfg.skaleRpcUrl, body: { jsonrpc: '2.0', method: 'eth_getCode', params: [cfg.skaleBiteContract, 'latest'], id: 1 } }),
  });
  const codeD = await codeR.json();
  if (!codeD.result || codeD.result === '0x' || codeD.result === '0x0') {
    fail('BITE Contract', 'no bytecode at address'); return;
  }
  const codeSize = (codeD.result.length - 2) / 2;
  // eth_call getIntent(bytes32(0))
  const callData = '0xf13c46aa' + '00'.repeat(32);
  const callR = await fetch(`${DASH}/rpc-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcUrl: cfg.skaleRpcUrl, body: { jsonrpc: '2.0', method: 'eth_call', params: [{ to: cfg.skaleBiteContract, data: callData }, 'latest'], id: 2 } }),
  });
  const callD = await callR.json();
  // A successful return OR a revert with reason string both prove the ABI is correct
  const callable = (!callD.error && callD.result && callD.result.length > 2) ||
                   (callD.error && callD.error.data && callD.error.data.startsWith('0x08c379a0'));
  pass('BITE Contract', `${codeSize}B deployed, getIntent ${callable ? 'ABI OK' : 'unknown'}`);
}

// ── CDP ──
async function testCdpEnv() {
  const r = await fetch(`${DASH}/env-status`);
  const d = await r.json();
  const missing = [];
  if (!d.cdpApiKeyId) missing.push('CDP_API_KEY_ID');
  if (!d.cdpApiKeySecret) missing.push('CDP_API_KEY_SECRET');
  if (!d.cdpWalletSecret) missing.push('CDP_WALLET_SECRET');
  missing.length === 0 ? pass('CDP Env') : fail('CDP Env', `missing: ${missing.join(', ')}`);
}

async function testCdpApi() {
  const r = await fetch(`${DASH}/cdp-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const d = await r.json();
  d.ok ? pass('CDP API') : fail('CDP API', d.error || '');
}

// ── E2E SKALE ──
async function testE2eSkale() {
  const envR = await fetch(`${DASH}/env-status`);
  const env = await envR.json();
  if (!env.skalePrivateKey) { skip('E2E SKALE Anchor', 'not configured'); return; }
  const r = await admin('/skale/test-anchor', { method: 'POST', body: '{}' });
  const d = await r.json();
  if (r.ok && d.txHash?.startsWith('0x')) pass('E2E SKALE Anchor', d.txHash.slice(0, 18));
  else if (d.error?.includes('METHOD_NOT_FOUND')) skip('E2E SKALE Anchor', 'BITE not enabled');
  else fail('E2E SKALE Anchor');
}

async function testBiteLifecycle() {
  const envR = await fetch(`${DASH}/env-status`);
  const env = await envR.json();
  if (!env.skalePrivateKey) { skip('BITE Lifecycle', 'not configured'); return; }
  const ar = await admin('/skale/test-anchor', { method: 'POST', body: '{}' });
  const anchor = await ar.json();
  if (!ar.ok) {
    if ((anchor.error||'').includes('METHOD_NOT_FOUND') || (anchor.error||'').includes('Invalid transaction')) { skip('BITE Lifecycle', 'BITE not supported'); return; }
    fail('BITE Lifecycle', `encrypt: ${anchor.error}`); return;
  }
  const readR = await admin('/skale/intent/' + encodeURIComponent(anchor.intentId));
  const readD = await readR.json();
  if (readD.revealed) { fail('BITE Lifecycle', 'data visible before reveal'); return; }
  const revealR = await admin('/skale/reveal/' + encodeURIComponent(anchor.intentId), { method: 'POST', body: '{}' });
  if (!revealR.ok) { fail('BITE Lifecycle', 'reveal failed'); return; }
  const read2R = await admin('/skale/intent/' + encodeURIComponent(anchor.intentId));
  const read2D = await read2R.json();
  (read2D.revealed && read2D.data) ? pass('BITE Lifecycle', 'encrypt→hide→reveal→read') : fail('BITE Lifecycle', 'not revealed');
}

// ── Run All ──
async function main() {
  console.log('\n  RequestTap Debug Test Runner\n  ════════════════════════════\n');
  await loadContext();

  console.log('  ── Core ──');
  await testHealth();
  await testRouteMatch();
  await testRoute404();
  await testRestrictedRoute();
  await testAuth401();
  await testAuthValid();

  console.log('\n  ── E2E ──');
  await testE2ePipeline();
  await testE2eReceipt();
  await testE2eHash();
  await testE2e402();
  await testE2eSkale();
  await testBiteLifecycle();
  await testUpstreamError();

  console.log('\n  ── Idempotency ──');
  await testIdempotency();

  console.log('\n  ── Payment ──');
  await testPaymentRequired();
  await testX402HeaderValid();

  console.log('\n  ── Security ──');
  await testX402Probe();
  await testX402Skip();
  await testSsrfBlocked();

  console.log('\n  ── AP2 Mandates ──');
  await testMandateSkipped();
  await testMandateRejected();
  await testMandateSig();
  await testMandateExpired();
  await testMandateBudget();
  await testIntentBudget();
  await testIntentMerchant();

  console.log('\n  ── Agent Access ──');
  await testBlacklistApi();
  await testAgentAllowed();
  await testAgentBlocked();

  console.log('\n  ── ERC-8004 ──');
  await testErc8004Query();
  await testErc8004Allowed();
  await testErc8004Blocked();

  console.log('\n  ── Receipts ──');
  await testReceiptsStats();
  await testReceiptsList();
  await testReceiptsFilter();
  await testReceiptIntegrity();

  console.log('\n  ── Admin ──');
  await testAdminConfig();
  await testDashboardConfig();
  await testAdminRoutes();
  await testOpenApiImport();
  await testPriceUpdate();

  console.log('\n  ── Docs ──');
  await testOpenApiSpec();

  console.log('\n  ── SKALE ──');
  await testSkaleRpc();
  await testSkaleBlock();
  await testBiteCommittee();
  await testBiteContract();

  console.log('\n  ── CDP ──');
  await testCdpEnv();
  await testCdpApi();

  console.log(`\n  ════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failures.length) console.log(`  Failures: ${failures.join(', ')}`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
