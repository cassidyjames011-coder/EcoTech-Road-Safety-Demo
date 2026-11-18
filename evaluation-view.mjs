// Presentation mapping for the existing four reviewed response cards.
const RESPONSE_CAPABILITY = Object.freeze({
  'RESP-01A': 'gosafe', 'RESP-01B': 'engineering', 'RESP-01C': 'gather_evidence',
  'RESP-02A': 'engineering', 'RESP-02B': 'engineering', 'RESP-02C': 'roads_policing',
  'RESP-03A': 'engineering', 'RESP-03B': 'engineering', 'RESP-03C': 'gather_evidence',
  'RESP-04A': 'engineering', 'RESP-04B': 'engineering', 'RESP-04C': 'patrol',
});
const DECISION_CODE = Object.freeze({
  Accepted: 'accept', Modified: 'modify', Rejected: 'reject', Deferred: 'defer',
});

export function reviewPayload(decision, responseId, reason, note = '') {
  const decisionCode = DECISION_CODE[decision];
  const responseCode = RESPONSE_CAPABILITY[responseId];
  if (!decisionCode || !responseCode) throw new TypeError('unsupported evaluation review');
  if (['accept', 'modify'].includes(decisionCode) && responseCode === 'gather_evidence') {
    throw new TypeError('accepted review needs a deployable response');
  }
  const justification = [reason, note].filter(Boolean).join(' — ').trim();
  if (justification.length < 5 || justification.length > 500) {
    throw new TypeError('review justification must be 5–500 characters');
  }
  return { decisionCode, responseCode, justification };
}

export function summarizePersistedView(raw) {
  if (!raw?.session?.id || !Number.isInteger(raw.session.clock_minute) ||
      !['events', 'alerts', 'reviews', 'units', 'deployments', 'outcomes']
        .every(key => Array.isArray(raw[key]))) throw new TypeError('invalid persisted evaluation view');
  const alert = raw.alerts[0] || null;
  const deployment = raw.deployments[0] || null;
  const outcome = raw.outcomes[0] || null;
  return {
    sessionId: raw.session.id,
    scenarioId: raw.session.scenario_id,
    minute: raw.session.clock_minute,
    seed: raw.session.seed,
    events: raw.events,
    alert,
    review: raw.reviews[0] || null,
    units: raw.units,
    deployment,
    outcome,
    etaMethod: deployment?.eta_method || null,
    arrivalMinute: deployment?.arrival_minute ?? null,
    completionMinute: deployment?.completion_minute ?? null,
  };
}
