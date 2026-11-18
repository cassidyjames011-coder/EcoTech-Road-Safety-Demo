// Logical, tab-local event history for the synthetic public evaluation demo.
// Browser storage is visitor controlled: this is neither an operational nor an immutable audit log.
export const RISK_EVENT_STATE_VERSION = '1.0.0';
const CLASSES = new Set(['confirmed_incident', 'confirmed_hazardous_condition',
  'emerging_hazard', 'compound_predictive_risk', 'unverified_anomaly']);
const URGENCY = ['informational', 'monitor', 'review', 'urgent_review'];
const CONDITION_REVALIDATION_GRACE_MS = 15 * 60_000;
const TERMINAL = new Set(['resolved', 'withdrawn', 'expired']);
const RESPONSE_STATES = new Set(['assigned', 'en_route', 'on_scene',
  'outcome_recorded', 'returning', 'completed']);
const TRANSITIONS = Object.freeze({
  detected: ['awaiting_verification', 'active', 'withdrawn'],
  awaiting_verification: ['active', 'acknowledged', 'under_review', 'monitoring', 'withdrawn', 'expired'],
  active: ['awaiting_verification', 'acknowledged', 'under_review', 'monitoring', 'resolved', 'withdrawn', 'expired'],
  acknowledged: ['active', 'awaiting_verification', 'under_review', 'monitoring', 'resolved', 'withdrawn', 'expired'],
  under_review: ['active', 'awaiting_verification', 'acknowledged', 'monitoring', 'resolved', 'withdrawn', 'expired'],
  monitoring: ['active', 'awaiting_verification', 'acknowledged', 'under_review', 'resolved', 'withdrawn', 'expired'],
  resolved: [], withdrawn: [], expired: [],
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validTime(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function hash(value) {
  let h = 2166136261;
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
function scopeKey(location) {
  if (location?.roadSegmentId) return `segment-label:${location.roadSegmentId}:${location.roadDirection || ''}`;
  if (location?.areaId) return `area:${location.areaId}`;
  if (Number.isFinite(location?.location?.lat) && Number.isFinite(location?.location?.lon))
    return `provisional:${location.location.lat.toFixed(5)},${location.location.lon.toFixed(5)}`;
  if (Number.isFinite(location?.lat) && Number.isFinite(location?.lon))
    return `provisional:${location.lat.toFixed(5)},${location.lon.toFixed(5)}`;
  throw new TypeError('candidate geographic scope required');
}
function identityKey(candidate) {
  return `${candidate.scenarioId}|${candidate.hazardSubtype}|${scopeKey(candidate.location)}|${candidate.sourceEventIdentity || ''}`;
}
function overlaps(a, b) {
  return Date.parse(a.from) <= Date.parse(b.until) && Date.parse(b.from) <= Date.parse(a.until);
}
function checkCandidate(candidate, scenarioId) {
  if (!candidate || candidate.schemaVersion !== RISK_EVENT_STATE_VERSION ||
      !CLASSES.has(candidate.classification) || candidate.isSynthetic !== true ||
      candidate.scenarioId !== scenarioId || typeof candidate.hazardSubtype !== 'string' ||
      !candidate.hazardSubtype || !candidate.ruleId || !candidate.ruleVersion ||
      !validTime(candidate.timeWindow?.from) || !validTime(candidate.timeWindow?.until) ||
      Date.parse(candidate.timeWindow.from) > Date.parse(candidate.timeWindow.until) ||
      !Array.isArray(candidate.evidenceReferences) || !candidate.evidenceReferences.length ||
      !candidate.evidenceReferences.every(id => typeof id === 'string' && id) ||
      !URGENCY.includes(candidate.operationalUrgency) || !candidate.explanation ||
      !candidate.evidenceConfidence || !candidate.severity)
    throw new TypeError('invalid synthetic risk-event candidate');
  scopeKey(candidate.location);
}
function checkSession(session) {
  if (!session || session.schemaVersion !== RISK_EVENT_STATE_VERSION ||
      typeof session.scenarioId !== 'string' || !session.scenarioId ||
      typeof session.seed !== 'string' || !session.seed ||
      typeof session.sessionId !== 'string' || !session.sessionId ||
      !Number.isSafeInteger(session.nextSequence) || session.nextSequence < 1 ||
      !session.events || typeof session.events !== 'object' || Array.isArray(session.events) ||
      !Array.isArray(session.history) || !Array.isArray(session.alertHistory))
    throw new TypeError('invalid risk-event session');
  for (const [id, event] of Object.entries(session.events)) {
    if (id !== event?.eventId || !Array.isArray(event.revisions) ||
        !Number.isSafeInteger(event.revisionNumber) ||
        event.revisionNumber !== event.revisions.length ||
        event.revisions.some((revision, index) => revision?.revisionNumber !== index + 1 ||
          !validTime(revision.at)) ||
        !Array.isArray(event.reviewHistory) || !TRANSITIONS[event.lifecycleStatus] ||
        (event.responseHistory !== undefined &&
          (!Array.isArray(event.responseHistory) || event.responseHistory.some(item =>
            !item || !RESPONSE_STATES.has(item.status) ||
            !validTime(item.at) || item.eventId !== id || item.isSynthetic !== true))) ||
        !Array.isArray(event.relatedEventIds) ||
        new Set(event.relatedEventIds).size !== event.relatedEventIds.length ||
        event.relatedEventIds.includes(id) ||
        (event.parentEventId != null && event.parentEventId === id))
      throw new TypeError('invalid stored risk event');
  }
  for (const [id, event] of Object.entries(session.events)) {
    if (event.relatedEventIds.some(other => !session.events[other] ||
        !session.events[other].relatedEventIds.includes(id)) ||
        (event.parentEventId != null &&
          (!session.events[event.parentEventId] || !event.relatedEventIds.includes(event.parentEventId))))
      throw new TypeError('invalid stored event relationship');
  }
  const actionIds = new Set();
  for (const action of [...session.history, ...session.alertHistory]) {
    const id = action?.actionId || action?.alertActionId;
    if (!id || actionIds.has(id) || !session.events[action.eventId] || !validTime(action.at))
      throw new TypeError('invalid stored event history');
    actionIds.add(id);
  }
  return session;
}
function append(session, event, actionType, at, previousState, newState, reason, references = []) {
  session.history.push({ actionId: `${session.sessionId}:A${session.nextSequence++}`,
    eventId: event.eventId, actionType, at,
    actor: actionType.startsWith('visitor_') ? 'anonymous demo visitor' : 'synthetic rule engine',
    previousState, newState, reason, supportingReferences: [...references] });
}
function transition(event, next) {
  if (event.lifecycleStatus === next) return;
  if (!TRANSITIONS[event.lifecycleStatus]?.includes(next))
    throw new TypeError(`invalid event transition: ${event.lifecycleStatus} to ${next}`);
  event.lifecycleStatus = next;
}
function alertAction(session, event, action, at, reason) {
  const prior = event.alert?.status || 'none';
  const next = action === 'suppress' ? 'suppressed' : action === 'withdraw' ? 'withdrawn' :
    action === 'expire' ? 'expired' : action === 'acknowledge' ? 'acknowledged' : 'active';
  event.alert = { status: next, priority: event.operationalUrgency, updatedAt: at,
    explanation: `${event.explanation} ${reason}`.trim(), eventId: event.eventId,
    isSynthetic: true };
  session.alertHistory.push({ alertActionId: `${session.sessionId}:L${session.nextSequence++}`,
    eventId: event.eventId, action, at, previousStatus: prior, newStatus: next,
    priority: event.operationalUrgency, reason });
}
function material(candidate) {
  return JSON.stringify({ classification: candidate.classification, hazardSubtype: candidate.hazardSubtype,
    title: candidate.title, description: candidate.description, location: candidate.location,
    timeWindow: candidate.timeWindow, evidenceReferences: candidate.evidenceReferences,
    supportingEvidence: candidate.supportingEvidence, conflictingEvidence: candidate.conflictingEvidence,
    confirmationState: candidate.confirmationState, severity: candidate.severity,
    evidenceConfidence: candidate.evidenceConfidence, operationalUrgency: candidate.operationalUrgency,
    predictionHorizon: candidate.predictionHorizon, ruleId: candidate.ruleId,
    ruleVersion: candidate.ruleVersion, explanation: candidate.explanation,
    recommendedActions: candidate.recommendedActions, isSynthetic: candidate.isSynthetic });
}
function revise(session, event, at, trigger, reason, priorState, references) {
  event.revisionNumber += 1;
  event.updatedAt = at;
  event.revisions.push({ revisionNumber: event.revisionNumber, previousState: priorState,
    newState: event.lifecycleStatus, at, trigger, reason, ruleId: event.ruleId,
    ruleVersion: event.ruleVersion, classification: event.classification,
    evidenceReferences: [...references], explanation: event.explanation });
  append(session, event, trigger, at, priorState, event.lifecycleStatus, reason, references);
}
function confirmationAuthority(observation) {
  return observation?.isSynthetic === true && observation.qualityStatus === 'usable' &&
    observation.metadata?.confirmationAuthority?.type === 'synthetic_controller' &&
    observation.metadata.confirmationAuthority.confirmedWithinSimulation === true &&
    observation.metadata.confirmationScope === 'simulation_only';
}
function sameScope(event, observation) {
  if (observation.scenarioId !== event.scenarioId) return false;
  const segment = event.location?.roadSegmentId;
  if (segment && observation.roadSegmentId) return segment === observation.roadSegmentId;
  const area = event.location?.areaId;
  if (area && observation.spatialCoverage?.areaId) return area === observation.spatialCoverage.areaId;
  return false;
}
function resolutionObservation(event, observations, assessmentAt) {
  return observations.find(observation => confirmationAuthority(observation) && sameScope(event, observation) &&
    validTime(observation.receivedAt) && Date.parse(observation.receivedAt) <= Date.parse(assessmentAt) &&
    validTime(observation.observedAt) && Date.parse(observation.observedAt) <= Date.parse(assessmentAt) &&
    (event.classification === 'confirmed_incident'
      ? observation.measurementType === 'incident_resolution' && Number(observation.measurementValue) === 1
      : event.classification === 'confirmed_hazardous_condition' &&
        observation.measurementType === 'water_depth' && Number(observation.measurementValue) === 0));
}

function explicitContextualPredecessor(candidate, observations, events, assessmentAt) {
  if (candidate.classification !== 'confirmed_hazardous_condition' ||
      candidate.hazardSubtype !== 'standing_water' ||
      candidate.confirmationState !== 'confirmed_within_simulation') return null;
  const observation = observations.find(item => candidate.evidenceReferences.includes(item.observationId) &&
    confirmationAuthority(item) && item.measurementType === 'water_depth' &&
    item.metadata?.relationType === 'contextual_temporal_scope' &&
    item.metadata?.relatedRiskEventSubtype === 'increasing_rainfall' &&
    item.metadata?.relatedRiskRuleId === 'SIM-RAIN-TREND' &&
    validTime(item.receivedAt) && Date.parse(item.receivedAt) <= Date.parse(assessmentAt));
  if (!observation) return null;
  const previous = Object.values(events).find(event => event.scenarioId === candidate.scenarioId &&
    event.classification === 'emerging_hazard' &&
    event.hazardSubtype === observation.metadata.relatedRiskEventSubtype &&
    event.ruleId === observation.metadata.relatedRiskRuleId &&
    event.location?.areaId && event.location.areaId === observation.spatialCoverage?.areaId &&
    (!event.location.roadDirection || !observation.roadDirection ||
      event.location.roadDirection === observation.roadDirection) &&
    Date.parse(event.createdAt) <= Date.parse(observation.observedAt) &&
    Date.parse(observation.observedAt) <= Date.parse(event.timeWindow.until));
  return previous ? { previous, observation } : null;
}

function linkContextualAssessments(session, predecessor, condition, observation, at) {
  if (predecessor.eventId === condition.eventId ||
      predecessor.scenarioId !== condition.scenarioId ||
      predecessor.relatedEventIds.includes(condition.eventId))
    throw new TypeError('invalid contextual event relationship');
  predecessor.relatedEventIds.push(condition.eventId);
  condition.relatedEventIds.push(predecessor.eventId);
  condition.parentEventId = predecessor.eventId;
  predecessor.relationshipType = condition.relationshipType = 'contextual_temporal_scope';
  condition.relationshipEvidenceReferences = [observation.observationId];
  const reason = `Fictional standing water was independently confirmed by ${observation.observationId} in the same provisional exercise area. This contextual relationship does not establish that rainfall caused the condition.`;
  revise(session, predecessor, at, 'relationship_linked', reason,
    predecessor.lifecycleStatus, [observation.observationId]);
  revise(session, condition, at, 'relationship_linked', reason,
    condition.lifecycleStatus, [observation.observationId]);
}

/** A new browser tab creates a distinct session; deterministic event IDs depend on evidence, not this UUID. */
export function createRiskEventSession({ scenarioId, seed, sessionId = globalThis.crypto?.randomUUID?.() } = {}) {
  if (typeof scenarioId !== 'string' || !scenarioId || typeof seed !== 'string' || !seed ||
      typeof sessionId !== 'string' || !sessionId) throw new TypeError('scenario, seed and session identity required');
  return { schemaVersion: RISK_EVENT_STATE_VERSION, sessionId, scenarioId, seed,
    events: {}, history: [], alertHistory: [], nextSequence: 1, lastAssessmentAt: null,
    storageNotice: 'Visitor-controlled browser session history; not an immutable or operational audit log.' };
}

/** Return a new session with stable logical event IDs, revisions and explicit alert actions. */
export function reconcileRiskEvents(session, candidates, { assessmentAt, observations = [] } = {}) {
  checkSession(session);
  if (!Array.isArray(candidates) || !Array.isArray(observations) || !validTime(assessmentAt))
    throw new TypeError('candidates, observations and assessmentAt required');
  if (session.lastAssessmentAt && Date.parse(assessmentAt) < Date.parse(session.lastAssessmentAt))
    throw new TypeError('assessment clock cannot move backwards');
  const next = clone(session);
  const seen = new Set();
  for (const raw of candidates) {
    checkCandidate(raw, session.scenarioId);
    const candidate = clone(raw);
    const key = identityKey(candidate);
    const existing = Object.values(next.events).find(event => event.identityKey === key &&
      !TERMINAL.has(event.lifecycleStatus) && overlaps(event.timeWindow, candidate.timeWindow));
    if (existing) {
      if (seen.has(existing.eventId)) throw new TypeError('duplicate candidate for one event');
      seen.add(existing.eventId);
      if (existing.materialSignature === material(candidate)) continue;
      const previousState = existing.lifecycleStatus;
      const previousClass = existing.classification;
      const oldPriority = URGENCY.indexOf(existing.operationalUrgency);
      Object.assign(existing, candidate, { eventId: existing.eventId, identityKey: key,
        createdAt: existing.createdAt, reviewHistory: existing.reviewHistory,
        revisions: existing.revisions, revisionNumber: existing.revisionNumber,
        alert: existing.alert, relatedEventIds: existing.relatedEventIds || [],
        materialSignature: material(candidate) });
      const assessedState = candidate.classification === 'unverified_anomaly' ? 'awaiting_verification' : 'active';
      if (existing.lifecycleStatus !== assessedState) transition(existing, assessedState);
      const reason = 'Material synthetic evidence or assessment changed.';
      revise(next, existing, assessmentAt, 'assessment_update', reason, previousState, candidate.evidenceReferences);
      const newPriority = URGENCY.indexOf(candidate.operationalUrgency);
      const newlyConfirmed = previousClass === 'unverified_anomaly' &&
        ['confirmed_incident', 'confirmed_hazardous_condition'].includes(candidate.classification);
      const action = candidate.operationalUrgency === 'informational' ? 'suppress' :
        newlyConfirmed || newPriority > oldPriority ? 'escalate' :
        newPriority < oldPriority ? 'deescalate' : 'update';
      alertAction(next, existing, action, assessmentAt, reason);
      continue;
    }
    const index = Object.values(next.events).filter(event => event.identityKey === key).length + 1;
    const eventId = `DEMO-EVT-${hash(`${key}|${candidate.timeWindow.from}|${index}`)}`;
    if (next.events[eventId]) throw new TypeError('event identity collision');
    const status = candidate.classification === 'unverified_anomaly' ? 'awaiting_verification' : 'active';
    const event = { ...candidate, eventId, identityKey: key, createdAt: assessmentAt,
      updatedAt: assessmentAt, lifecycleStatus: status, revisionNumber: 0,
      revisions: [], reviewHistory: [], responseHistory: [], relatedEventIds: [],
      parentEventId: null, alert: null,
      materialSignature: material(candidate) };
    next.events[eventId] = event;
    seen.add(eventId);
    revise(next, event, assessmentAt, 'detected', 'Synthetic candidate first met its rule.',
      'detected', candidate.evidenceReferences);
    alertAction(next, event, candidate.operationalUrgency === 'informational' ? 'suppress' : 'generate',
      assessmentAt, 'Synthetic decision-support notice only; no real dispatch.');
    const link = explicitContextualPredecessor(candidate, observations, next.events, assessmentAt);
    if (link && link.previous.eventId !== event.eventId)
      linkContextualAssessments(next, link.previous, event, link.observation, assessmentAt);
  }

  for (const event of Object.values(next.events)) {
    if (seen.has(event.eventId) || TERMINAL.has(event.lifecycleStatus)) continue;
    const previousState = event.lifecycleStatus;
    const resolution = resolutionObservation(event, observations, assessmentAt);
    let newState = null, action = null, reason = '';
    if (resolution) {
      newState = 'resolved'; action = 'withdraw';
      reason = `Explicit synthetic-controller resolution ${resolution.observationId} received; no real-world resolution is claimed.`;
    } else if (event.classification === 'confirmed_hazardous_condition' &&
        Date.parse(assessmentAt) > Date.parse(event.timeWindow.until) + CONDITION_REVALIDATION_GRACE_MS) {
      newState = 'expired'; action = 'expire';
      reason = 'Simulated condition validity and 15-minute revalidation grace expired; past confirmation remains in history.';
    } else if (event.classification === 'emerging_hazard' || event.classification === 'compound_predictive_risk') {
      newState = 'withdrawn'; action = 'withdraw';
      reason = 'Previously supporting synthetic conditions no longer satisfy the rule; prior warning retained in history.';
    } else if (event.classification === 'unverified_anomaly' &&
        Date.parse(assessmentAt) > Date.parse(event.timeWindow.until) + 30 * 60_000) {
      newState = 'expired'; action = 'expire';
      reason = 'Unverified synthetic anomaly expired after the review window without confirmation.';
    } else if (event.classification === 'unverified_anomaly' && event.lifecycleStatus !== 'monitoring') {
      newState = 'monitoring'; action = event.operationalUrgency === 'informational' ? 'suppress' : 'deescalate';
      reason = 'Anomaly was not corroborated at this assessment; continue verification without claiming resolution.';
    }
    if (newState) {
      transition(event, newState);
      revise(next, event, assessmentAt, action === 'withdraw' ? 'assessment_withdrawal' : 'assessment_deescalation',
        reason, previousState, resolution ? [resolution.observationId] : event.evidenceReferences);
      alertAction(next, event, action, assessmentAt, reason);
    }
  }
  next.lastAssessmentAt = assessmentAt;
  return next;
}

export function reviewRiskEvent(session, eventId, { action, reason, at,
  actor = 'anonymous demo visitor' } = {}) {
  checkSession(session);
  if (actor !== 'anonymous demo visitor' || !validTime(at) ||
      typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500)
    throw new TypeError('valid anonymous demo review, time and reason required');
  if (session.lastAssessmentAt && Date.parse(at) < Date.parse(session.lastAssessmentAt))
    throw new TypeError('review clock cannot move backwards');
  const target = { acknowledge: 'acknowledged', investigate: 'under_review', monitor: 'monitoring',
    dismiss: 'withdrawn' }[action];
  if (!target) throw new TypeError('unsupported demo review action');
  const next = clone(session), event = next.events[eventId];
  if (!event) throw new TypeError('unknown event');
  if (event.lifecycleStatus === target) return next;
  if (action === 'dismiss' && event.classification === 'confirmed_incident')
    throw new TypeError('a confirmed simulated incident requires explicit resolution evidence');
  const previousState = event.lifecycleStatus;
  transition(event, target);
  const cleanReason = reason.trim();
  event.reviewHistory.push({ action, reason: cleanReason, at, actor,
    previousState, newState: target, isSynthetic: true });
  revise(next, event, at, `visitor_${action}`, cleanReason, previousState, event.evidenceReferences);
  if (action === 'acknowledge') alertAction(next, event, 'acknowledge', at, cleanReason);
  if (action === 'dismiss') alertAction(next, event, 'withdraw', at, cleanReason);
  next.lastAssessmentAt = at;
  return next;
}

/** Append a fictional response milestone without changing the assessed hazard state. */
export function recordRiskResponseLink(session, eventId, details = {}) {
  checkSession(session);
  const {deploymentId,unitId,status,at,relatedEventRevision,scenarioId,isSynthetic,
    outcomeId = null,observationId = null} = details;
  if (!session.events[eventId] || typeof deploymentId !== 'string' || !deploymentId ||
      typeof unitId !== 'string' || !unitId || !RESPONSE_STATES.has(status) ||
      !validTime(at) || scenarioId !== session.scenarioId || isSynthetic !== true ||
      !Number.isSafeInteger(relatedEventRevision) || relatedEventRevision < 1 ||
      relatedEventRevision > session.events[eventId].revisionNumber ||
      (status === 'outcome_recorded' &&
        (typeof outcomeId !== 'string' || !outcomeId ||
         typeof observationId !== 'string' || !observationId)))
    throw new TypeError('valid fictional deployment milestone required');
  if (session.lastAssessmentAt && Date.parse(at) < Date.parse(session.lastAssessmentAt))
    throw new TypeError('response clock cannot move backwards');
  const next=clone(session), event=next.events[eventId];
  event.responseHistory ||= [];
  const records=event.responseHistory.filter(item=>item.deploymentId===deploymentId);
  const previous=records.at(-1);
  if (event.responseHistory.some(item=>item.deploymentId===deploymentId &&
      (item.unitId!==unitId || item.relatedEventRevision!==relatedEventRevision)))
    throw new TypeError('deployment identity changed');
  const allowed={assigned: ['en_route','on_scene'], en_route: ['on_scene'],
    on_scene: ['outcome_recorded','returning','completed'],
    outcome_recorded: ['returning','completed'], returning: ['completed'],
    completed: ['outcome_recorded']}; // A delayed fictional report may arrive after the unit returns.
  if (!previous) {
    if (status!=='assigned' || event.responseHistory.some(item=>item.deploymentId===deploymentId) ||
        Object.values(next.events).some(other=>other.eventId!==eventId &&
          other.responseHistory?.some(item=>item.deploymentId===deploymentId)))
      throw new TypeError('fictional response must start with a unique assignment');
  } else {
    if (status===previous.status) {
      if (status==='assigned' || status==='outcome_recorded')
        throw new TypeError('duplicate fictional assignment or outcome');
      return next;
    }
    if (!allowed[previous.status].includes(status) || Date.parse(at)<Date.parse(previous.at))
      throw new TypeError('invalid fictional response transition');
    if (status==='outcome_recorded' && records.some(item=>item.status==='outcome_recorded'))
      throw new TypeError('duplicate fictional outcome');
  }
  const milestone={deploymentId,eventId,scenarioId,unitId,status,at,
    relatedEventRevision,isSynthetic:true,...(outcomeId?{outcomeId}:{}),
    ...(observationId?{observationId}:{})};
  event.responseHistory.push(milestone);
  const reason=`Fictional deployment ${deploymentId} for unit ${unitId}: ${status.replaceAll('_',' ')}. No real dispatch or automatic incident resolution.`;
  revise(next,event,at,`fictional_response_${status}`,reason,event.lifecycleStatus,
    observationId?[observationId]:event.evidenceReferences);
  next.lastAssessmentAt=at;
  return next;
}

/** Invalid storage is quarantined by the caller: this function never writes it back. */
export function hydrateRiskEventSession(raw, { scenarioId, seed = 'DUBLIN-01' } = {}) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    checkSession(parsed);
    if (parsed.scenarioId !== scenarioId) throw new TypeError('scenario mismatch');
    return clone(parsed);
  } catch {
    return { ...createRiskEventSession({ scenarioId, seed }), blockedRestoration: true,
      recoveryWarning: 'Stored event history is incompatible or corrupt. It was not overwritten; reset explicitly to begin a new local session.' };
  }
}

export function resetRiskEventSession(session) {
  checkSession(session);
  return createRiskEventSession({ scenarioId: session.scenarioId, seed: session.seed });
}
