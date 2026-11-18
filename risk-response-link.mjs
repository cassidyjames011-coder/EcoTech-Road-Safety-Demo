// Fictional risk-event response adapter. The existing v4 patrol engine remains
// responsible for eligibility, road geometry, movement and attendance times.
import { normaliseObservation } from './risk-observation.mjs';
import {
  LOCAL_FLEET, LOCAL_PATROL_START_MINUTE, LOCAL_PATROL_MAX_MINUTE,
  createLocalPatrolState, validateLocalPatrolState, advanceClock,
  assignLocalPatrol, eligibleLocalUnits, unitState, incidentView,
  distanceMeters,
} from './local-patrol-response.mjs';

export const RISK_RESPONSE_VERSION = '1.0.0';
export const RISK_PATROL_CLOCK_OFFSET_MINUTES = LOCAL_PATROL_START_MINUTE;
export const RISK_ROUTE_BINDINGS = Object.freeze({
  'RISK-DEMO-A': 'DEMO-SCEN-01', 'RISK-DEMO-B': 'DEMO-SCEN-03',
  'RISK-DEMO-C': 'DEMO-SCEN-04', 'RISK-DEMO-D': 'DEMO-SCEN-02',
  'RISK-DEMO-E': 'DEMO-SCEN-01', 'RISK-DEMO-F': 'DEMO-SCEN-02',
  'RISK-DEMO-G': 'DEMO-SCEN-03', 'RISK-DEMO-H': 'DEMO-SCEN-04',
  'RISK-DEMO-I': 'DEMO-SCEN-01', 'RISK-DEMO-J': 'DEMO-SCEN-02',
});
const TERMINAL = new Set(['resolved', 'withdrawn', 'expired']);
const RESPONSE_REVIEW = Object.freeze({
  confirmed_incident: ['acknowledge', 'investigate'],
  confirmed_hazardous_condition: ['acknowledge', 'investigate'],
  compound_predictive_risk: ['investigate'],
  unverified_anomaly: ['investigate'],
  emerging_hazard: [],
});

const clone = value => structuredClone(value);
const finiteMinute = value => Number.isFinite(value) && value >= 0 &&
  value <= LOCAL_PATROL_MAX_MINUTE - RISK_PATROL_CLOCK_OFFSET_MINUTES;
const engineMinute = minute => minute + RISK_PATROL_CLOCK_OFFSET_MINUTES;
const riskMinute = sec => sec / 60 - RISK_PATROL_CLOCK_OFFSET_MINUTES;
const atMinute = (reference, minute) => new Date(Date.parse(reference) + minute * 60_000).toISOString();

function checkScenario(scenario) {
  if (!scenario || !RISK_ROUTE_BINDINGS[scenario.scenarioId] ||
      !Array.isArray(scenario.location?.center) || scenario.location.center.length !== 2 ||
      !scenario.location.center.every(Number.isFinite) ||
      scenario.location.scopeStatus !== 'provisional_demo_only')
    throw new TypeError('reviewed fictional risk scenario required');
}

/** Reuse, without modifying, cached v3 roads already authored for matching demo targets. */
export function riskResponseRoutes(routeData, riskScenario) {
  checkScenario(riskScenario);
  if (routeData?.version !== 3 || !routeData.routes || !routeData.returnRoutes ||
      !routeData.patrolLoops || !routeData.bases)
    throw new TypeError('existing v3 road-route manifest required');
  const targetId = RISK_ROUTE_BINDINGS[riskScenario.scenarioId];
  const aliases = {}, returns = {};
  for (const [key, route] of Object.entries(routeData.routes)) {
    if (!key.endsWith(`:${targetId}`)) continue;
    const alias = `${key.slice(0, -targetId.length)}${riskScenario.scenarioId}`;
    if (!Array.isArray(route.points) || route.points.length < 2 ||
        distanceMeters(route.points.at(-1), riskScenario.location.center) > 100)
      throw new TypeError('cached road target does not match this authored fictional exercise');
    aliases[alias] = route;
    const inbound = routeData.returnRoutes[key];
    if (!inbound?.points?.length) throw new TypeError('cached road return is missing');
    returns[alias] = inbound;
  }
  if (!Object.keys(aliases).length) throw new TypeError('no cached road response for exercise');
  const patrolLoops = Object.fromEntries(Object.entries(routeData.patrolLoops).map(([baseId, loops]) =>
    [baseId, loops.map(loop => ({ ...loop, dispatchNodes: (loop.dispatchNodes || []).map(node => ({
      ...node, responses: node.responses?.[targetId]
        ? { ...node.responses, [riskScenario.scenarioId]: node.responses[targetId] }
        : { ...node.responses },
    })) }))]));
  return { ...routeData, routes: { ...routeData.routes, ...aliases },
    returnRoutes: { ...routeData.returnRoutes, ...returns }, patrolLoops };
}

function engineScenario(riskScenario) {
  checkScenario(riskScenario);
  return { id: riskScenario.scenarioId, center: riskScenario.location.center };
}

function checkSession(session, riskScenario = null, routeData = null) {
  if (!session || session.version !== RISK_RESPONSE_VERSION ||
      !RISK_ROUTE_BINDINGS[session.scenarioId] ||
      typeof session.sessionId !== 'string' || !session.sessionId ||
      typeof session.seed !== 'string' || !session.seed ||
      !Number.isFinite(Date.parse(session.referenceTimeUtc)) ||
      !finiteMinute(session.clockMinute) ||
      !Array.isArray(session.history) || !Array.isArray(session.outcomes) ||
      session.outcomes.length > 1 ||
      session.patrolState?.clockSec !== engineMinute(session.clockMinute) * 60 ||
      !session.patrolState?.scenarios?.[session.scenarioId])
    throw new TypeError('invalid fictional risk response session');
  if (riskScenario && session.scenarioId !== riskScenario.scenarioId)
    throw new TypeError('response exercise mismatch');
  if (riskScenario && routeData && !validateLocalPatrolState(session.patrolState,
      [session.scenarioId], riskResponseRoutes(routeData, riskScenario)))
    throw new TypeError('invalid cached patrol state');
  const entry = session.patrolState.scenarios[session.scenarioId];
  if ((session.deployment === null) !== (entry.assignedAtSec === null))
    throw new TypeError('deployment and patrol state disagree');
  if (session.deployment) {
    const d = session.deployment;
    if (!d.deploymentId || !d.eventId || d.scenarioId !== session.scenarioId ||
        d.unitId !== entry.unitId || !Number.isFinite(d.assignedAtMinute) ||
        d.assignedAtMinute !== riskMinute(entry.assignedAtSec) ||
        !(d.arrivalMinute >= d.assignedAtMinute) ||
        !(d.sceneEndMinute >= d.arrivalMinute) ||
        !(d.returnedMinute >= d.sceneEndMinute) ||
        d.assignedAtMinute > session.clockMinute)
      throw new TypeError('invalid linked fictional deployment');
    if (session.outcomes.some(o => o.deploymentId !== d.deploymentId ||
        o.eventId !== d.eventId || o.availableMinute < d.arrivalMinute ||
        o.availableMinute > session.clockMinute))
      throw new TypeError('invalid linked fictional outcome');
  } else if (session.outcomes.length) throw new TypeError('outcome without deployment');
  return session;
}

export function createRiskResponseSession({ scenarioId, seed, sessionId,
  referenceTimeUtc = '2026-11-14T12:00:00Z' } = {}) {
  if (!RISK_ROUTE_BINDINGS[scenarioId] || typeof seed !== 'string' || !seed ||
      typeof sessionId !== 'string' || !sessionId ||
      !Number.isFinite(Date.parse(referenceTimeUtc)))
    throw new TypeError('fictional scenario, seed, session and reference time required');
  const patrolState = createLocalPatrolState([scenarioId], { seed, responseKmh: 30,
    selectedScenarioId: scenarioId });
  return { version: RISK_RESPONSE_VERSION, scenarioId, seed, sessionId, referenceTimeUtc,
    clockMinute: 0, patrolState, deployment: null, outcomes: [], history: [],
    disclosure: 'Tab-local fictional patrol response; no Garda dispatch or operational write.' };
}

/** Clock is absolute risk T+minutes; the v4 patrol engine receives T+22 internally. */
export function advanceRiskResponse(session, toRiskMinute) {
  checkSession(session);
  if (!finiteMinute(toRiskMinute) || toRiskMinute < session.clockMinute)
    throw new TypeError('fictional response clock cannot move backwards or beyond patrol range');
  const next = clone(session);
  next.patrolState = advanceClock(next.patrolState, (toRiskMinute - next.clockMinute) * 60);
  next.clockMinute = toRiskMinute;
  return next;
}

export function responseReviewPolicy(riskEvent) {
  if (!riskEvent?.isSynthetic || !RISK_ROUTE_BINDINGS[riskEvent.scenarioId] ||
      TERMINAL.has(riskEvent.lifecycleStatus))
    return { allowed: false, reason: 'No active fictional event can be assigned.' };
  if (riskEvent.operationalUrgency === 'informational' || riskEvent.alert?.status === 'suppressed')
    return { allowed: false, reason: 'Information-only or suppressed notices do not justify a fictional deployment.' };
  const allowedActions = RESPONSE_REVIEW[riskEvent.classification];
  if (!allowedActions) return { allowed: false, reason: 'Unsupported event class.' };
  if (!allowedActions.length)
    return { allowed: false, reason: 'Emerging rain is monitoring-only; no automatic fictional patrol.' };
  const lastReview = riskEvent.reviewHistory?.at(-1);
  if (!lastReview || !allowedActions.includes(lastReview.action))
    return { allowed: false, reason: `Review first: ${allowedActions.join(' or ')} the fictional event.` };
  return { allowed: true, reason: 'Human review recorded; fictional response is optional.' };
}

export function eligibleRiskUnits(session, { riskScenario, riskEvent, routeData,
  occupiedUnitIds = [] } = {}) {
  checkSession(session, riskScenario, routeData);
  if (!Array.isArray(occupiedUnitIds) || occupiedUnitIds.some(id => typeof id !== 'string'))
    throw new TypeError('occupied unit IDs must be an array');
  if (riskEvent?.scenarioId !== session.scenarioId || !responseReviewPolicy(riskEvent).allowed ||
      session.deployment) return [];
  const roads = riskResponseRoutes(routeData, riskScenario);
  return eligibleLocalUnits(engineScenario(riskScenario), session.patrolState, roads)
    .filter(unit => !occupiedUnitIds.includes(unit.id)).map(unit => {
      const here = unitState(unit, session.patrolState.clockSec, session.patrolState, roads);
      return { unitId: unit.id, capability: unit.capability,
        baseLabel: roads.bases[unit.baseId].label, position: here.position,
        routeMethod: 'existing precomputed OSRM/OpenStreetMap geometry; fictional ETA' };
    });
}

export function assignRiskUnit(session, { riskScenario, riskEvent, unitId, routeData,
  occupiedUnitIds = [] } = {}) {
  checkSession(session, riskScenario, routeData);
  if (riskEvent?.scenarioId !== session.scenarioId || !riskEvent?.eventId ||
      !Number.isInteger(riskEvent.revisionNumber) || !responseReviewPolicy(riskEvent).allowed)
    throw new TypeError('active reviewed fictional event required');
  if (session.deployment) throw new TypeError('fictional deployment already linked to this exercise');
  const available = eligibleRiskUnits(session, { riskScenario, riskEvent, routeData, occupiedUnitIds });
  if (!available.some(unit => unit.unitId === unitId))
    throw new TypeError('fictional unit is ineligible, assigned elsewhere or lacks a cached road route');
  const roads = riskResponseRoutes(routeData, riskScenario);
  const patrolState = assignLocalPatrol(session.patrolState, engineScenario(riskScenario), unitId, roads);
  const incident = incidentView(patrolState, engineScenario(riskScenario), roads);
  const deployment = {
    deploymentId: `DEMO-DEP-${session.sessionId}-${riskEvent.eventId}`,
    scenarioId: session.scenarioId, eventId: riskEvent.eventId, relatedEventRevision: riskEvent.revisionNumber,
    unitId, assignedAtMinute: session.clockMinute,
    arrivalMinute: riskMinute(incident.arrivalSec),
    sceneEndMinute: riskMinute(incident.sceneEndSec),
    returnedMinute: riskMinute(incident.returnedSec), outcomeId: null,
    isSynthetic: true, routeMethod: incident.routeMethod,
  };
  const next = { ...session, patrolState, deployment,
    history: [...session.history, { action: 'fictional_assignment',
      atMinute: session.clockMinute, deploymentId: deployment.deploymentId,
      eventId: riskEvent.eventId, unitId, relatedEventRevision: riskEvent.revisionNumber }] };
  checkSession(next, riskScenario, routeData);
  return next;
}

export function riskResponseView(session, { riskScenario, routeData } = {}) {
  checkSession(session, riskScenario, routeData);
  const roads = riskResponseRoutes(routeData, riskScenario);
  const unitViews = LOCAL_FLEET.map(unit => {
    const current = unitState(unit, session.patrolState.clockSec, session.patrolState, roads);
    return { unitId: unit.id, status: current.status, eligible: current.eligible,
      position: current.position, route: current.route, progress: current.progress,
      capability: unit.capability, baseLabel: roads.bases[unit.baseId].label };
  });
  if (!session.deployment) return { clockMinute: session.clockMinute, deployment: null,
    units: unitViews, outcomes: session.outcomes, history: session.history };
  const incident = incidentView(session.patrolState, engineScenario(riskScenario), roads);
  const unit = unitViews.find(item => item.unitId === session.deployment.unitId);
  const responseStatus = session.clockMinute >= session.deployment.returnedMinute ? 'completed' : unit.status;
  return { clockMinute: session.clockMinute, deployment: { ...session.deployment,
    status: responseStatus, unitStatus: unit.status, position: unit.position,
    route: unit.route, responseRoute: incident.responseRoute, returnRoute: incident.returnRoute,
    progress: unit.progress, etaMinutes: Math.max(0, incident.arrivalSec / 60 - session.patrolState.clockSec / 60),
    outcomeAvailable: session.outcomes.length > 0,
  }, units: unitViews, outcomes: session.outcomes, history: session.history };
}

/** Return a fully authored synthetic observation only after fictional arrival and delay. */
export function recordRiskOutcome(session, { riskScenario, riskEvent, routeData,
  outcomeDefinition } = {}) {
  checkSession(session, riskScenario, routeData);
  if (!session.deployment || session.outcomes.length ||
      riskEvent?.scenarioId !== session.scenarioId || riskEvent.eventId !== session.deployment.eventId)
    throw new TypeError('outcome requires the linked fictional deployment and event');
  const definition = outcomeDefinition, template = definition?.observationTemplate;
  if (typeof definition?.outcomeId !== 'string' || !definition.outcomeId ||
      !Number.isInteger(definition.availableAfterArrivalMinutes) ||
      definition.availableAfterArrivalMinutes < 0 ||
      !Number.isInteger(definition.validForMinutes) || definition.validForMinutes <= 0 ||
      !template || template.qualityStatus !== 'usable' ||
      template.metadata?.confirmationAuthority?.type !== 'synthetic_controller' ||
      template.metadata.confirmationAuthority.confirmedWithinSimulation !== true ||
      template.metadata.confirmationScope !== 'simulation_only')
    throw new TypeError('explicit authored fictional controller outcome required');
  const availableMinute = session.deployment.arrivalMinute + definition.availableAfterArrivalMinutes;
  if (session.clockMinute < availableMinute)
    throw new TypeError('fictional outcome is unavailable until after arrival and authored delay');
  const observedAt = atMinute(session.referenceTimeUtc, availableMinute);
  const raw = {
    ...template, observationId: definition.outcomeId, schemaVersion: '1.0.0',
    provenanceType: 'synthetic_scenario_input', isSynthetic: true,
    scenarioId: session.scenarioId, observedAt, receivedAt: observedAt, validFrom: observedAt,
    validUntil: atMinute(session.referenceTimeUtc, availableMinute + definition.validForMinutes),
    location: { lat: riskScenario.location.center[0], lon: riskScenario.location.center[1] },
    roadSegmentId: riskScenario.location.roadSegmentId,
    roadDirection: riskScenario.location.roadDirection,
    spatialCoverage: { type: 'provisional_demo_area',
      areaId: `${session.scenarioId}-AREA`, radiusMeters: 500, verified: false },
    spatialUncertainty: { method: 'provisional', radiusMeters: 500 },
    qualityReasons: [], metadata: { ...template.metadata,
      responseEventId: riskEvent.eventId, deploymentId: session.deployment.deploymentId,
      outcomeId: definition.outcomeId, roadSegmentVerified: false,
      syntheticDisclosure: 'Fictional controller outcome after simulated response; no real resolution asserted.' },
  };
  const observation = normaliseObservation(raw);
  const outcome = { outcomeId: definition.outcomeId,
    deploymentId: session.deployment.deploymentId, eventId: riskEvent.eventId,
    relatedEventRevision: riskEvent.revisionNumber,
    availableMinute, recordedMinute: session.clockMinute,
    observationId: observation.observationId, isSynthetic: true };
  const next = { ...session, deployment: { ...session.deployment, outcomeId: definition.outcomeId },
    outcomes: [...session.outcomes, outcome],
    history: [...session.history, { action: 'fictional_outcome',
      atMinute: session.clockMinute, deploymentId: session.deployment.deploymentId,
      eventId: riskEvent.eventId, outcomeId: definition.outcomeId,
      relatedEventRevision: riskEvent.revisionNumber }] };
  checkSession(next, riskScenario, routeData);
  return { session: next, observation };
}

export function hydrateRiskResponseSession(raw, { riskScenario, routeData,
  scenarioId, seed, sessionId, referenceTimeUtc } = {}) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    checkSession(parsed, riskScenario, routeData);
    if (parsed.scenarioId !== scenarioId || parsed.seed !== seed ||
        parsed.sessionId !== sessionId || parsed.referenceTimeUtc !== referenceTimeUtc)
      throw new TypeError('fictional response identity mismatch');
    return clone(parsed);
  } catch {
    return { ...createRiskResponseSession({ scenarioId, seed, sessionId, referenceTimeUtc }),
      blockedRestoration: true,
      recoveryWarning: 'Stored fictional response is invalid. It was not overwritten; reset the exercise explicitly.' };
  }
}
