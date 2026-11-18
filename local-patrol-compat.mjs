// Compatibility boundary for the existing Gemini page while the v4 patrol engine is integrated.
// The v4 engine remains the source of geometry, eligibility, assignments and lifecycle state.
import {
  LOCAL_FLEET, LOCAL_PATROL_START_MINUTE, LOCAL_PATROL_MAX_MINUTE, LOCAL_PATROL_SCENE_MINUTES,
  createLocalPatrolState as createEngineState, assignLocalPatrol as assignEngine,
  eligibleLocalUnits as eligibleEngine, unitState, unitEligibility, incidentView,
  routeDistanceKm, routeWithinHomeRadius, pointAlongRoute, locateOnRoute, prepareRoute,
  phoneticCarId,
} from './local-patrol-response.mjs?rev=20261109-engine4';

export { LOCAL_FLEET, LOCAL_PATROL_START_MINUTE, LOCAL_PATROL_MAX_MINUTE,
  LOCAL_PATROL_SCENE_MINUTES, routeWithinHomeRadius, pointAlongRoute, phoneticCarId };

const routeAdapters = new WeakMap();
const RESPONSE_KMH = 30;
function routesForEngine(routes) {
  if (routes.version === 3) return routes;
  let adapted = routeAdapters.get(routes);
  if (adapted) return adapted;
  const patrolLoops = Object.fromEntries(Object.entries(routes.patrolLoops).map(([baseId, loop]) => {
    const responses = Object.fromEntries(Object.entries(routes.routes)
      .filter(([key]) => key.startsWith(baseId + ':'))
      .map(([key, route]) => [key.slice(baseId.length + 1), route]));
    return [baseId, [{ ...loop, id: baseId + ':original-loop',
      dispatchNodes: [{ index: loop.points.length - 1, responses }] }]];
  }));
  adapted = { ...routes, version: 3, patrolLoops };
  routeAdapters.set(routes, adapted);
  return adapted;
}

function engineState(minute, all = {}, currentId = null, current = null) {
  const entries = { ...all, ...(currentId && current ? { [currentId]: current } : {}) };
  const state = createEngineState(Object.keys(entries), { seed: 'DUBLIN-01', responseKmh: RESPONSE_KMH });
  state.clockSec = minute * 60;
  state.scenarios = Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, {
    assignedAtSec: entry?.assignedAt == null || !entry.responseRoute ? null : entry.assignedAt * 60,
    unitId: entry?.unitId ?? null,
    selectedUnitId: entry?.selectedUnitId ?? null,
    ...(entry?.responseRoute ? {
      responseRoute: entry.responseRoute, responseKmh: RESPONSE_KMH,
      origin: entry.origin ?? entry.responseRoute[0],
    } : {}),
  }]));
  return state;
}

export function createLocalPatrolState(minute = LOCAL_PATROL_START_MINUTE) {
  return { minute, assignedAt: null, unitId: null, selectedUnitId: null };
}

export function advanceLocalPatrol(state, minutes = 1) {
  if (!Number.isFinite(minutes) || minutes < 0) throw new TypeError('invalid scenario clock step');
  return { ...state, minute: Math.min(LOCAL_PATROL_MAX_MINUTE,
    Math.round((state.minute + minutes) * 1000) / 1000) };
}

export function patrolPosition(unit, minute, routes, resumeMinute = null) {
  const adapted = routesForEngine(routes);
  if (resumeMinute !== null) {
    const loop = adapted.patrolLoops[unit.baseId][0].points;
    const travelled = Math.max(0, minute - resumeMinute) * 60 * 25 / 3.6;
    const length = prepareRoute(loop).total;
    const phase = length ? (travelled % length) / length : 0;
    return { position: pointAlongRoute(loop, phase), phase, route: loop,
      circuitMinutes: length / (25 / 3.6) / 60 };
  }
  const view = unitState(unit, minute * 60, engineState(minute), adapted);
  const loop = view.route || adapted.patrolLoops[unit.baseId][0].points;
  const length = prepareRoute(loop).total;
  return { position: view.position, phase: view.progress, route: loop,
    circuitMinutes: length / (25 / 3.6) / 60 };
}

export function remainingPatrolPath(points, fraction) {
  const located = locateOnRoute(points, prepareRoute(points).total * Math.max(0, Math.min(1, fraction)));
  return [located.position, ...points.slice(located.index + 1)];
}

export function unitActivity(unit, minute, routes, allScenarioStates = {}) {
  const view = unitState(unit, minute * 60, engineState(minute, allScenarioStates), routesForEngine(routes));
  return { status: view.status, eligible: view.eligible, reason: view.reason,
    availableAt: view.availableAtSec == null ? null : Math.ceil(view.availableAtSec / 60),
    scenarioId: view.scenarioId ?? null, resumeMinute: null,
    position: view.position, route: view.route, progress: view.progress, routeKey: view.routeKey };
}

export function eligibleLocalUnits(scenario, routes, allScenarioStates = {}, minute = LOCAL_PATROL_START_MINUTE) {
  const occupied = new Set(Object.values(allScenarioStates)
    .filter(entry => entry?.assignedAt !== null && entry?.unitId).map(entry => entry.unitId));
  return eligibleEngine(scenario, engineState(minute, allScenarioStates), routesForEngine(routes))
    .filter(unit => !occupied.has(unit.id));
}

export function responseEligibility(unit, scenario, routes, allScenarioStates = {}, minute = LOCAL_PATROL_START_MINUTE) {
  return unitEligibility(unit, scenario, engineState(minute, allScenarioStates), routesForEngine(routes));
}

export function assignLocalPatrol(state, unitId, allScenarioStates = {}, options = {}) {
  if (state.assignedAt !== null) throw new Error('Fictional unit already assigned in this scenario');
  if (Object.values(allScenarioStates).some(entry => entry?.unitId === unitId && entry.assignedAt !== null))
    throw new Error('Fictional unit already assigned to another incident');
  const unit = LOCAL_FLEET.find(item => item.id === unitId);
  if (!unit) throw new Error('Unknown fictional unit');
  if (!options.routeData || !options.scenario) {
    return { ...state, assignedAt: state.minute, unitId, selectedUnitId: unitId };
  }
  const adapted = routesForEngine(options.routeData);
  const global = engineState(state.minute, allScenarioStates, options.scenario.id, state);
  const assigned = assignEngine(global, options.scenario, unitId, adapted).scenarios[options.scenario.id];
  return { ...state, assignedAt: state.minute, unitId, selectedUnitId: unitId,
    responseRoute: assigned.responseRoute, responseDistanceKm: assigned.responseDistanceM / 1000,
    origin: assigned.origin };
}

export function localPatrolView(entry, scenario, routes, requestedUnitId = null,
  allScenarioStates = {}, clockMinute = entry.minute) {
  const adapted = routesForEngine(routes);
  const global = engineState(clockMinute, allScenarioStates, scenario.id, entry);
  const chosen = LOCAL_FLEET.find(item => item.id === (entry.unitId || requestedUnitId || entry.selectedUnitId))
    || eligibleEngine(scenario, global, adapted)[0]
    || LOCAL_FLEET.find(item => adapted.routes[`${item.baseId}:${scenario.id}`]);
  if (!chosen) throw new Error('No fictional unit has a route to this incident');
  const current = unitState(chosen, clockMinute * 60, global, adapted);
  const incident = entry.assignedAt == null || !entry.responseRoute ? null
    : incidentView(global, scenario, adapted, clockMinute * 60);
  const response = incident?.responseRoute || adapted.routes[`${chosen.baseId}:${scenario.id}`].points;
  const eta = incident ? (incident.arrivalSec - incident.assignedAtSec) / 60
    : routeDistanceKm(response) / (RESPONSE_KMH / 60);
  const followUpMinute = incident ? incident.followUpSec / 60 : null;
  const checked = unitEligibility(chosen, scenario, global, adapted);
  return {
    unitId: chosen.id, capability: chosen.capability, baseLabel: adapted.bases[chosen.baseId].label,
    status: current.status, position: current.position, origin: incident?.origin || current.position,
    target: response.at(-1), route: current.route || response,
    responseRoute: response, returnRoute: incident?.returnRoute || null,
    routeDistanceKm: routeDistanceKm(response), progress: current.progress,
    elapsed: incident ? (clockMinute * 60 - incident.assignedAtSec) / 60 : null,
    etaMinutes: Math.ceil(eta), arrivalMinute: incident ? Math.ceil(incident.arrivalSec / 60) : null,
    completionMinute: incident ? Math.ceil(incident.sceneEndSec / 60) : null,
    returnCompletionMinute: incident ? Math.ceil(incident.returnedSec / 60) : null,
    completionMinuteExact: incident ? incident.sceneEndSec / 60 : null,
    returnCompletionMinuteExact: incident ? incident.returnedSec / 60 : null,
    followUpMinute: followUpMinute == null ? null : Math.ceil(followUpMinute), followUp: incident?.followUp || null,
    activity: { status: current.status, eligible: checked.eligible, reason: checked.reason,
      availableAt: current.availableAtSec == null ? null : Math.ceil(current.availableAtSec / 60) },
    unit: chosen, patrolPhase: current.progress,
    routeMethod: 'precomputed OSRM/OpenStreetMap road geometry; no live routing or traffic; fictional crew and ETA',
  };
}
