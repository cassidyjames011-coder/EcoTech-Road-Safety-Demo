import { normaliseObservation } from './risk-observation.mjs';
import { correlateObservations } from './risk-correlation.mjs';
import { assessClassifications } from './risk-classification.mjs';
import { createRiskEventSession, hydrateRiskEventSession, reconcileRiskEvents,
  reviewRiskEvent, resetRiskEventSession } from './risk-event-state.mjs';

export const RISK_PIPELINE_VERSION = '1.0.0';
function scenarioFor(suite, id) {
  if (suite?.contractVersion !== RISK_PIPELINE_VERSION || !Array.isArray(suite.scenarios))
    throw new TypeError('unsupported risk scenario suite');
  const scenario = suite.scenarios.find(item => item.scenarioId === id);
  if (!scenario || !Array.isArray(scenario.observations) || !Array.isArray(scenario.location?.center))
    throw new TypeError('unknown risk scenario');
  return scenario;
}
function atMinute(suite, minute) {
  if (!Number.isInteger(minute) || minute < 0 || minute > suite.clock?.totalMinutes)
    throw new TypeError('invalid risk replay minute');
  return new Date(Date.parse(suite.referenceTimeUtc) + minute * 60_000).toISOString();
}
function anchorFor(scenario, observation) {
  return { scenarioId: scenario.scenarioId, isSynthetic: true,
    roadSegmentId: scenario.location.roadSegmentId || null,
    roadDirection: scenario.location.roadDirection || null,
    spatialCoverage: observation.spatialCoverage,
    location: { lat: scenario.location.center[0], lon: scenario.location.center[1] },
    metadata: { roadSegmentVerified: false } };
}
export function assessRiskMinute(suite, scenarioId, minute, additionalObservations = []) {
  const scenario = scenarioFor(suite, scenarioId);
  const assessmentAt = atMinute(suite, minute);
  if (!Array.isArray(additionalObservations)) throw new TypeError('additional observations must be an array');
  const observations = [...scenario.observations, ...additionalObservations].map(item => normaliseObservation(item));
  if (observations.some(item => item.scenarioId !== scenarioId || item.isSynthetic !== true))
    throw new TypeError('risk replay accepts only this exercise’s synthetic observations');
  const correlation = correlateObservations(observations, {
    assessmentAt, anchor: anchorFor(scenario, observations[0]),
    windowMinutes: { default: 36, historical_road_safety_characteristic: 36,
      road_geometry: 36, rainfall: 24 },
  });
  return { assessmentAt, observations, correlation,
    candidates: assessClassifications(correlation) };
}
export function createRiskReplay(suite, scenarioId, { seed, sessionId } = {}) {
  const scenario = scenarioFor(suite, scenarioId);
  const session = createRiskEventSession({
    scenarioId, seed: String(seed || scenario.seed || 'ECOTECH-01'), ...(sessionId ? {sessionId} : {}),
  });
  const first = assessRiskMinute(suite,scenarioId,0);
  return { schemaVersion:RISK_PIPELINE_VERSION, fixtureRevision:suite.fixtureRevision,
    scenarioId, minute:0, additionalObservations:[],
    session:reconcileRiskEvents(session,first.candidates,
      {assessmentAt:first.assessmentAt,observations:first.correlation.included.map(e=>e.observation)}),
    correlation:first.correlation };
}
export function advanceRiskReplay(replay,suite,minutes=1) {
  if (replay?.schemaVersion !== RISK_PIPELINE_VERSION ||
      replay.fixtureRevision !== suite.fixtureRevision || replay.session?.blockedRestoration)
    throw new TypeError('risk replay unavailable; reset corrupt session explicitly');
  if (!Number.isInteger(minutes) || minutes < 0) throw new TypeError('invalid replay step');
  scenarioFor(suite,replay.scenarioId);
  const end=Math.min(suite.clock.totalMinutes,replay.minute+minutes);
  let session=replay.session, correlation=replay.correlation;
  for(let minute=replay.minute+1;minute<=end;minute++){
    const current=assessRiskMinute(suite,replay.scenarioId,minute,replay.additionalObservations || []);
    correlation=current.correlation;
    session=reconcileRiskEvents(session,current.candidates,{
      assessmentAt:current.assessmentAt,observations:current.correlation.included.map(e=>e.observation)});
  }
  return {...replay,minute:end,session,correlation};
}
export function reviewRiskReplay(replay,eventId,{action,reason,actor='anonymous demo visitor'}={}) {
  if(replay?.session?.blockedRestoration) throw new TypeError('reset corrupt session explicitly');
  const at=replay.session.lastAssessmentAt;
  return {...replay,session:reviewRiskEvent(replay.session,eventId,{action,reason,actor,at})};
}
/** Add an authored fictional response observation only after its receipt time. */
export function appendRiskOutcome(replay,suite,rawObservation) {
  if (replay?.schemaVersion !== RISK_PIPELINE_VERSION ||
      replay.fixtureRevision !== suite.fixtureRevision || replay.session?.blockedRestoration)
    throw new TypeError('risk replay unavailable');
  const observation=normaliseObservation(rawObservation);
  const eventId=observation.metadata?.responseEventId;
  const linkedEvent=replay.session.events[eventId];
  if (observation.isSynthetic !== true || observation.scenarioId !== replay.scenarioId ||
      !eventId || !linkedEvent || !observation.metadata?.deploymentId ||
      !observation.metadata?.outcomeId ||
      !linkedEvent.responseHistory?.some(item => item.status === 'assigned' &&
        item.deploymentId === observation.metadata.deploymentId && item.eventId === eventId))
    throw new TypeError('fictional outcome must reference an existing event and deployment');
  const assessmentAt=atMinute(suite,replay.minute);
  if (Date.parse(observation.receivedAt)>Date.parse(assessmentAt) ||
      Date.parse(observation.observedAt)>Date.parse(assessmentAt))
    throw new TypeError('fictional outcome is not yet available');
  if ((replay.additionalObservations || []).some(item => item.observationId===observation.observationId))
    throw new TypeError('duplicate fictional outcome');
  const additionalObservations=[...(replay.additionalObservations || []),rawObservation];
  const current=assessRiskMinute(suite,replay.scenarioId,replay.minute,additionalObservations);
  const session=reconcileRiskEvents(replay.session,current.candidates,{
    assessmentAt:current.assessmentAt,observations:current.correlation.included.map(e=>e.observation)});
  return {...replay,additionalObservations,session,correlation:current.correlation};
}
export function resetRiskReplay(replay,suite) {
  if (!replay || !replay.scenarioId) throw new TypeError('risk replay required');
  const cleared=resetRiskEventSession(replay.session);
  const first=assessRiskMinute(suite,replay.scenarioId,0);
  return { schemaVersion:RISK_PIPELINE_VERSION,fixtureRevision:suite.fixtureRevision,
    scenarioId:replay.scenarioId,minute:0,additionalObservations:[],
    session:reconcileRiskEvents(cleared,first.candidates,
      {assessmentAt:first.assessmentAt,observations:first.correlation.included.map(e=>e.observation)}),
    correlation:first.correlation };
}
export function hydrateRiskReplay(raw,suite,scenarioId) {
  let parsed;
  try {
    parsed=typeof raw==='string'?JSON.parse(raw):raw;
    if(parsed?.schemaVersion!==RISK_PIPELINE_VERSION || parsed.fixtureRevision!==suite.fixtureRevision ||
      parsed.scenarioId!==scenarioId ||
      !Number.isInteger(parsed.minute) || parsed.minute<0 || parsed.minute>suite.clock.totalMinutes)
      throw new TypeError('invalid saved risk replay');
    const session=hydrateRiskEventSession(parsed.session,{scenarioId});
    if(session.blockedRestoration) throw new TypeError('invalid saved event history');
    const additionalObservations=parsed.additionalObservations || [];
    if (!Array.isArray(additionalObservations) || additionalObservations.some(item =>
      !item?.metadata?.responseEventId || !session.events[item.metadata.responseEventId] ||
      !session.events[item.metadata.responseEventId].responseHistory?.some(link =>
        link.status === 'assigned' && link.deploymentId === item.metadata.deploymentId) ||
      Date.parse(item.receivedAt)>Date.parse(atMinute(suite,parsed.minute))))
      throw new TypeError('invalid saved fictional outcome');
    const correlation=assessRiskMinute(suite,scenarioId,parsed.minute,additionalObservations).correlation;
    return {...parsed,additionalObservations,session,correlation};
  } catch {
    const fallback=createRiskReplay(suite,scenarioId);
    fallback.session.blockedRestoration=true;
    fallback.session.recoveryWarning='Stored synthetic event history could not be validated. It has not been overwritten. Reset explicitly to begin again.';
    return fallback;
  }
}
export function riskReplayView(replay) {
  const events=Object.values(replay.session.events);
  return { scenarioId:replay.scenarioId,minute:replay.minute,
    events,active:events.filter(event=>!['resolved','withdrawn','expired'].includes(event.lifecycleStatus) &&
      !['suppressed','withdrawn','expired'].includes(event.alert?.status)),
    history:replay.session.history,alertHistory:replay.session.alertHistory,
    excluded:replay.correlation.excluded, included:replay.correlation.included,
    blockedRestoration:Boolean(replay.session.blockedRestoration),
    recoveryWarning:replay.session.recoveryWarning || null };
}
