// Browser-side transport for the isolated evaluation RPCs. The publishable
// key is supplied at runtime; no service/secret key belongs in this module.
const AUTH_SLOT = 'dublin_evaluation_auth_v1';
const SESSION_SLOT = 'dublin_evaluation_active_v1';
const RPC_NAMES = new Set([
  'start_evaluation_demo', 'advance_evaluation_demo', 'read_evaluation_demo',
  'review_evaluation_alert', 'assign_evaluation_unit',
]);

export class EvaluationApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'EvaluationApiError';
    this.status = status;
  }
}

export function validateRuntimeConfig(config) {
  if (!config || config.contractVersion !== '1.0.0' || config.enabled !== true) {
    throw new EvaluationApiError('Persisted evaluation is not configured');
  }
  const url = new URL(config.apiOrigin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !((url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) ||
        url.protocol === 'https:')) {
    throw new EvaluationApiError('Invalid evaluation API origin');
  }
  if (typeof config.publishableKey !== 'string' || !config.publishableKey.trim() ||
      /\s/.test(config.publishableKey) || config.publishableKey.startsWith('sb_secret_')) {
    throw new EvaluationApiError('A publishable evaluation key is required');
  }
  return { origin: url.origin, publishableKey: config.publishableKey };
}

export function createEvaluationClient(config, { fetchImpl = fetch, storage = sessionStorage,
                                               now = () => Date.now() } = {}) {
  const { origin, publishableKey } = validateRuntimeConfig(config);
  const slot = (name) => `${name}:${origin}`;
  let identity = null;

  async function request(path, body, accessToken = null) {
    let response;
    try {
      response = await fetchImpl(origin + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new EvaluationApiError('Evaluation API unavailable');
    }
    if (!response.ok) throw new EvaluationApiError(`Evaluation API HTTP ${response.status}`, response.status);
    try { return await response.json(); }
    catch { throw new EvaluationApiError('Invalid evaluation API response'); }
  }

  function saveIdentity(value) {
    if (!value?.access_token || !value?.refresh_token || !Number.isFinite(value.expires_in)) {
      throw new EvaluationApiError('Invalid anonymous Auth response');
    }
    identity = {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: now() + value.expires_in * 1000,
      anonymous: true,
    };
    storage.setItem(slot(AUTH_SLOT), JSON.stringify(identity));
    return identity;
  }

  async function ensureIdentity() {
    if (!identity) {
      try { identity = JSON.parse(storage.getItem(slot(AUTH_SLOT)) || 'null'); }
      catch { identity = null; }
    }
    if (identity?.anonymous && identity.accessToken && identity.refreshToken &&
        identity.expiresAt > now() + 60_000) return identity;
    if (identity?.anonymous && identity.refreshToken) {
      const refreshed = await request('/auth/v1/token?grant_type=refresh_token',
        { refresh_token: identity.refreshToken });
      return saveIdentity(refreshed);
    }
    const created = await request('/auth/v1/signup', {});
    if (created?.user?.is_anonymous !== true) {
      throw new EvaluationApiError('Auth did not issue an anonymous identity');
    }
    return saveIdentity(created);
  }

  async function rpc(name, params) {
    if (!RPC_NAMES.has(name)) throw new EvaluationApiError('Unknown evaluation RPC');
    const auth = await ensureIdentity();
    return request(`/rest/v1/rpc/${name}`, params, auth.accessToken);
  }

  function activeSession() {
    try {
      const value = JSON.parse(storage.getItem(slot(SESSION_SLOT)) || 'null');
      return value && typeof value.scenarioId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(value.sessionId) ? value : null;
    } catch { return null; }
  }

  return {
    async start(scenarioId, seed) {
      const sessionId = await rpc('start_evaluation_demo',
        { p_scenario_id: scenarioId, p_seed: seed });
      if (typeof sessionId !== 'string') throw new EvaluationApiError('Invalid new session ID');
      storage.setItem(slot(SESSION_SLOT), JSON.stringify({ scenarioId, sessionId }));
      return { scenarioId, sessionId };
    },
    activeSession,
    clearActiveSession() { storage.removeItem(slot(SESSION_SLOT)); },
    read(sessionId) { return rpc('read_evaluation_demo', { p_session_id: sessionId }); },
    advance(sessionId, minute) {
      return rpc('advance_evaluation_demo', { p_session_id: sessionId, p_minute: minute });
    },
    review(alertId, decision, responseCode, justification) {
      return rpc('review_evaluation_alert', {
        p_alert_id: alertId, p_decision: decision,
        p_response_code: responseCode, p_justification: justification,
      });
    },
    assign(sessionId, unitId) {
      return rpc('assign_evaluation_unit', { p_session_id: sessionId, p_unit_id: unitId });
    },
  };
}
