// Fictional, tab-local patrol and response model (state version 4).
// Routes are precomputed OSM road geometry; crews, shifts, allocations and scenario observations are illustrative.
// Every vehicle position is a pure function of (simulation seconds, seeded itinerary, cumulative route distance):
// travel speed is metres per simulated second and is independent of rendering frame rate or route vertex count.
export const LOCAL_PATROL_STATE_VERSION = 4;
export const LOCAL_PATROL_START_MINUTE = 22;
export const LOCAL_PATROL_MAX_MINUTE = 300;
export const LOCAL_PATROL_SCENE_MINUTES = 5;
export const DEFAULT_PATROL_KMH = 25;
export const DEFAULT_RESPONSE_KMH = 45;
export const DEFAULT_PLAYBACK_MULTIPLIER = 10;
export const PLAYBACK_MULTIPLIERS = Object.freeze([1, 5, 10, 20, 40]);
export const SIM_TIME_ZONE_LABEL = 'Europe/Dublin (GMT)';
export const SIM_ZERO_CLOCK_MINUTES = 12 * 60; // T+0 is 12:00 on the fictional shift day
const ENDING_SHIFT_MINUTES = 25;
const SHIFT_MARGIN_MINUTES = 10;
const MIN_AHEAD_METRES = 6;

export const LOCAL_FLEET = Object.freeze([
  { id: 'AZ-14', baseId: 'garda:cabinteely:53.261:-6.151', capability: 'Roads patrol', crew: ['Aisling Vale', 'Niall Rowan'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'BK-27', baseId: 'garda:cabinteely:53.261:-6.151', capability: 'Roads patrol', crew: ['Bríd Kavanagh', 'Eoin Marsh'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'CL-31', baseId: 'garda:ronanstown:53.338:-6.406', capability: 'Incident support', crew: ['Cora Lane', 'Liam Hart'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'DM-42', baseId: 'garda:ronanstown:53.338:-6.406', capability: 'Incident support', crew: ['Dara Moss', 'Maeve Quill'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'ER-53', baseId: 'garda:ballyfermot:53.345:-6.358', capability: 'Roads patrol', crew: ['Eva Reed', 'Ronan Bell'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'FS-64', baseId: 'garda:ballyfermot:53.345:-6.358', capability: 'Community response', crew: ['Fionn Shaw', 'Sara Keane'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'GT-75', baseId: 'garda:kilmainham:53.342:-6.304', capability: 'Roads patrol', crew: ['Gráinne Tate', 'Tom Finn'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'HU-86', baseId: 'garda:kilmainham:53.342:-6.304', capability: 'Community response', crew: ['Hugh Underwood', 'Una Dale'], shiftStartMinute: -240, shiftEndMinute: 240, breakUntilMinute: 30 },
  { id: 'IV-97', baseId: 'garda:rathmines:53.321:-6.267', capability: 'Community response', crew: ['Iona Voss', 'Victor Hale'], shiftStartMinute: -240, shiftEndMinute: 240 },
  { id: 'JW-08', baseId: 'garda:rathmines:53.321:-6.267', capability: 'Community response', crew: ['Jade Walsh', 'Willow Byrne'], shiftStartMinute: -420, shiftEndMinute: 45 },
]);

const FOLLOW_UP = Object.freeze({
  'DEMO-SCEN-01': 'A later synthetic speed-variance observation is lower; this is not evidence that patrol presence caused the change.',
  'DEMO-SCEN-02': 'A later synthetic conflict observation remains elevated; the fictional presence has no demonstrated improvement.',
  'DEMO-SCEN-03': 'A later synthetic delay observation is lower; works activity and causality remain unverified.',
  'DEMO-SCEN-04': 'A later synthetic conflict observation shifts toward an adjacent approach; possible displacement requires review.',
});

const PHONETIC = Object.freeze({ A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo',
  F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra',
  T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' });

export function phoneticCarId(id) {
  if (!/^[A-Z]{2}-[0-9]{2}$/.test(id)) throw new TypeError('invalid fictional car ID');
  return `${PHONETIC[id[0]]} ${PHONETIC[id[1]]} ${id[3]} ${id[4]}`;
}

// ---------- geometry ----------
export function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const lat = (b[0] - a[0]) * radians;
  const lon = (b[1] - a[1]) * radians;
  const hav = Math.sin(lat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(lon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(hav)));
}

export function bearingDegrees(a, b) {
  const radians = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * radians) * Math.cos(b[0] * radians);
  const x = Math.cos(a[0] * radians) * Math.sin(b[0] * radians) - Math.sin(a[0] * radians) * Math.cos(b[0] * radians) * Math.cos((b[1] - a[1]) * radians);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

const prepared = new WeakMap();
export function prepareRoute(points) {
  let item = prepared.get(points);
  if (!item) {
    const cum = [0];
    for (let index = 1; index < points.length; index += 1) cum.push(cum[index - 1] + distanceMeters(points[index - 1], points[index]));
    item = { points, cum, total: cum[cum.length - 1] };
    prepared.set(points, item);
  }
  return item;
}

// Position, segment index and local bearing at a cumulative distance (metres) along a polyline.
export function locateOnRoute(points, distance) {
  const route = prepareRoute(points);
  const d = Math.max(0, Math.min(route.total, distance));
  let low = 0;
  let high = route.cum.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (route.cum[mid] <= d) low = mid; else high = mid - 1;
  }
  const length = route.cum[low + 1] - route.cum[low];
  const t = length === 0 ? 1 : (d - route.cum[low]) / length;
  const a = points[low];
  const b = points[low + 1];
  return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: low, bearing: bearingDegrees(a, b) };
}

// Direction of travel measured a short distance ahead, so turns are anticipated rather than snapped.
export function headingAhead(points, distance, lookaheadMetres = 35) {
  const route = prepareRoute(points);
  const here = locateOnRoute(points, distance);
  const ahead = locateOnRoute(points, Math.min(route.total, distance + lookaheadMetres));
  return distanceMeters(here.position, ahead.position) < 1 ? here.bearing : bearingDegrees(here.position, ahead.position);
}

export function routeDistanceKm(points) { return prepareRoute(points).total / 1000; }

export function pointAlongRoute(points, fraction) {
  return locateOnRoute(points, Math.max(0, Math.min(1, fraction)) * prepareRoute(points).total).position;
}

export function routeWithinHomeRadius(points, home, limitMeters = 4000) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(home)) return false;
  return points.slice(1).every((point, index) => {
    const a = points[index];
    const steps = Math.max(1, Math.ceil(distanceMeters(a, point) / 50));
    return Array.from({ length: steps + 1 }, (_, step) =>
      [a[0] + (point[0] - a[0]) * step / steps, a[1] + (point[1] - a[1]) * step / steps]).every(sample => distanceMeters(sample, home) <= limitMeters);
  });
}

// ---------- seeded randomness ----------
export function hashString(value) {
  let h = 2166136261;
  for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- time and shift presentation ----------
export function clockLabel(minuteOfSimulation) {
  const total = ((SIM_ZERO_CLOCK_MINUTES + Math.floor(minuteOfSimulation)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function shiftInfo(unit, clockSec) {
  const remaining = Math.max(0, unit.shiftEndMinute * 60 - clockSec);
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  return { startLabel: clockLabel(unit.shiftStartMinute), endLabel: clockLabel(unit.shiftEndMinute), remainingSeconds: remaining,
    remainingText: remaining <= 0 ? 'shift has ended' : hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`,
    timeZone: SIM_TIME_ZONE_LABEL };
}

// ---------- seeded patrol itinerary ----------
const sequences = new Map();
function loopsOf(routeData, baseId) {
  const loops = routeData.patrolLoops?.[baseId];
  if (!Array.isArray(loops) || !loops.length) throw new TypeError(`no patrol loops for ${baseId}`);
  return loops;
}

function sequenceFor(unit, routeData, seed, epoch, needed) {
  const key = `${seed}|${unit.id}|${epoch}`;
  const loops = loopsOf(routeData, unit.baseId);
  let item = sequences.get(key);
  if (!item || item.loopCount !== loops.length) {
    const rng = mulberry32(hashString(key));
    const sibling = LOCAL_FLEET.filter(other => other.baseId === unit.baseId).findIndex(other => other.id === unit.id);
    const first = (Math.floor(rng() * loops.length) + (epoch === 0 ? sibling * 2 : 0)) % loops.length;
    item = { rng, loopCount: loops.length, order: [first],
      startFraction: epoch === 0 && !unit.breakUntilMinute ? 0.05 + 0.9 * mulberry32(hashString(`${key}|start`))() : 0 };
    sequences.set(key, item);
    if (sequences.size > 400) sequences.delete(sequences.keys().next().value);
  }
  while (item.order.length <= needed) {
    const previous = item.order.at(-1);
    const choices = loops.map((_, index) => index).filter(index => loops.length === 1 || index !== previous);
    item.order.push(choices[Math.floor(item.rng() * choices.length)]);
  }
  return item;
}

// Where is a patrolling unit on its seeded sequence of loops after `elapsed` seconds?
function patrolLocation(unit, routeData, seed, epoch, patrolStartSec, nowSec, speedMps) {
  const loops = loopsOf(routeData, unit.baseId);
  let remaining = Math.max(0, nowSec - patrolStartSec) * speedMps;
  let cycle = 0;
  let item = sequenceFor(unit, routeData, seed, epoch, 0);
  let loopDef = loops[item.order[0]];
  let route = prepareRoute(loopDef.points);
  let startDistance = item.startFraction * route.total;
  let span = route.total - startDistance;
  while (remaining >= span && cycle < 20000) {
    remaining -= span;
    cycle += 1;
    item = sequenceFor(unit, routeData, seed, epoch, cycle);
    loopDef = loops[item.order[cycle]];
    route = prepareRoute(loopDef.points);
    startDistance = 0;
    span = route.total;
  }
  const distance = Math.min(route.total, startDistance + remaining);
  return { cycle, loopDef, loopId: loopDef.id, route, distance, remainingOnLoop: route.total - distance };
}

// ---------- unit state ----------
function context(state, routeData) {
  return { routeData, scenarios: state.scenarios, seed: state.seed, patrolMps: state.speeds.patrolKmh / 3.6 };
}

function timelineFor(entry, unit, routeData, scenarioId) {
  const response = prepareRoute(entry.responseRoute);
  const inbound = routeData.returnRoutes?.[`${unit.baseId}:${scenarioId}`];
  if (!inbound) throw new Error('missing cached return route');
  const back = prepareRoute(inbound.points);
  const speed = entry.responseKmh / 3.6;
  const arrival = entry.assignedAtSec + response.total / speed;
  const sceneEnd = arrival + LOCAL_PATROL_SCENE_MINUTES * 60;
  return { response, inbound: back, inboundRoute: inbound, speed, arrival, sceneEnd, returned: sceneEnd + back.total / speed };
}

function assignmentsOf(unit, scenarios) {
  return Object.entries(scenarios || {})
    .filter(([, entry]) => entry?.unitId === unit.id && entry.assignedAtSec !== null && entry.assignedAtSec !== undefined)
    .map(([scenarioId, entry]) => ({ scenarioId, entry }))
    .sort((a, b) => a.entry.assignedAtSec - b.entry.assignedAtSec);
}

export function unitState(unit, clockSec, state, routeData) {
  const ctx = context(state, routeData);
  const base = routeData.bases[unit.baseId];
  const items = assignmentsOf(unit, state.scenarios).map(item => ({ ...item, times: timelineFor(item.entry, unit, routeData, item.scenarioId) }));
  const finished = items.filter(item => item.times.returned <= clockSec);
  const active = items.find(item => item.times.returned > clockSec && item.entry.assignedAtSec <= clockSec);
  const epoch = finished.length;
  const lastReturned = finished.length ? finished[finished.length - 1].times.returned : null;
  const minuteNow = Math.floor(clockSec / 60);

  if (active) {
    const { scenarioId, entry, times } = active;
    let status; let route; let distance; let key;
    if (clockSec <= entry.assignedAtSec) { status = 'assigned'; route = times.response; distance = 0; key = `response:${scenarioId}`; }
    else if (clockSec < times.arrival) { status = 'en_route'; route = times.response; distance = (clockSec - entry.assignedAtSec) * times.speed; key = `response:${scenarioId}`; }
    else if (clockSec < times.sceneEnd) { status = 'on_scene'; route = times.response; distance = times.response.total; key = `scene:${scenarioId}`; }
    else { status = 'returning'; route = times.inbound; distance = (clockSec - times.sceneEnd) * times.speed; key = `return:${scenarioId}`; }
    const located = locateOnRoute(route.points, distance);
    const labels = { assigned: 'assigned', en_route: 'en route', on_scene: 'on scene', returning: 'returning to base' };
    return { unit, base, status, eligible: false, scenarioId, entry, times, route: route.points, routeKey: key,
      distanceM: distance, progress: route.total ? distance / route.total : 1, position: located.position,
      headingDeg: status === 'on_scene' ? located.bearing : headingAhead(route.points, distance),
      reason: `Committed to ${scenarioId} (${labels[status]}); one assignment at a time`,
      availableAtSec: times.returned, epoch, loopId: null };
  }

  const patrolStartSec = lastReturned ?? (unit.breakUntilMinute ? unit.breakUntilMinute * 60 : LOCAL_PATROL_START_MINUTE * 60);
  const parkedAt = base.roadStart;
  const parked = (status, reason, availableAtSec = null) => ({ unit, base, status, eligible: false, scenarioId: null, route: null,
    routeKey: `parked:${unit.baseId}`, distanceM: 0, progress: 0, position: parkedAt,
    headingDeg: bearingDegrees(parkedAt, loopsOf(routeData, unit.baseId)[0].points[1]), reason, availableAtSec, epoch, loopId: null });

  if (epoch === 0 && unit.breakUntilMinute && clockSec < unit.breakUntilMinute * 60) {
    return parked('mandatory_downtime', `Synthetic mandatory downtime until ${clockLabel(unit.breakUntilMinute)} ${SIM_TIME_ZONE_LABEL}; demonstration assumption`, unit.breakUntilMinute * 60);
  }
  const shiftEndSec = unit.shiftEndMinute * 60;
  const patrol = patrolLocation(unit, routeData, state.seed, epoch, patrolStartSec, Math.min(clockSec, shiftEndSec), ctx.patrolMps);
  if (clockSec >= shiftEndSec) {
    const finishSec = shiftEndSec + patrol.remainingOnLoop / ctx.patrolMps;
    if (clockSec >= finishSec) return parked('off_shift', `Fictional shift ended at ${clockLabel(unit.shiftEndMinute)} ${SIM_TIME_ZONE_LABEL}; car is back at base`);
  }
  const now = clockSec >= shiftEndSec ? patrolLocation(unit, routeData, state.seed, epoch, patrolStartSec, clockSec, ctx.patrolMps) : patrol;
  const located = locateOnRoute(now.route.points, now.distance);
  const remainingMin = (shiftEndSec - clockSec) / 60;
  let status = 'available_patrolling';
  let eligible = true;
  let reason = 'Available for one immediate simulated response';
  if (clockSec >= shiftEndSec) {
    status = 'ending_shift'; eligible = false;
    reason = `Fictional shift ended at ${clockLabel(unit.shiftEndMinute)} ${SIM_TIME_ZONE_LABEL}; completing its loop back to base`;
  } else if (remainingMin < ENDING_SHIFT_MINUTES) {
    status = 'ending_shift'; eligible = false;
    reason = `Only ${Math.max(0, Math.floor(remainingMin))} min of fictional shift remain; too little for a new response`;
  }
  return { unit, base, status, eligible, scenarioId: null, route: now.route.points, routeKey: `patrol:${unit.baseId}:${now.loopId}:${epoch}:${now.cycle}`,
    distanceM: now.distance, progress: now.route.total ? now.distance / now.route.total : 0, position: located.position,
    headingDeg: headingAhead(now.route.points, now.distance), reason, availableAtSec: eligible ? clockSec : null, epoch,
    loopId: now.loopId, loopDef: now.loopDef, cycle: now.cycle };
}

export function fleetState(state, routeData, clockSec = state.clockSec) {
  return LOCAL_FLEET.map(unit => unitState(unit, clockSec, state, routeData));
}

// ---------- dispatch planning (from the car's current road position) ----------
export function planResponse(unit, scenario, state, routeData, clockSec = state.clockSec) {
  const here = unitState(unit, clockSec, state, routeData);
  if (here.status !== 'available_patrolling') return { error: here.reason };
  const home = routeData.bases[unit.baseId].center;
  const loop = here.loopDef;
  const prepared = prepareRoute(loop.points);
  let best = null;
  for (const node of loop.dispatchNodes || []) {
    const response = node.responses?.[scenario.id];
    if (!response) continue;
    const nodeDistance = prepared.cum[node.index];
    if (!(nodeDistance >= here.distanceM + MIN_AHEAD_METRES)) continue;
    const ahead = [here.position, ...loop.points.slice(locateOnRoute(loop.points, here.distanceM).index + 1, node.index + 1)];
    if (distanceMeters(ahead.at(-1), response.points[0]) > 1) continue;
    const route = [...ahead, ...response.points.slice(1)];
    const total = prepareRoute(route).total;
    if (best && best.distanceM <= total) continue;
    if (!routeWithinHomeRadius(route, home)) continue;
    best = { route, distanceM: total, nodeIndex: node.index, loopId: loop.id, metresToBranch: nodeDistance - here.distanceM, origin: here.position };
  }
  return best || { error: 'No validated cached road branch from the current position within 4 km of the home station' };
}

export function unitEligibility(unit, scenario, state, routeData, clockSec = state.clockSec) {
  const here = unitState(unit, clockSec, state, routeData);
  const baseLabel = routeData.bases[unit.baseId].label;
  const result = (eligible, reason, extra = {}) => ({ unit, eligible, reason, status: here.status, ...extra });
  if (clockSec >= LOCAL_PATROL_MAX_MINUTE * 60) return result(false, 'Demonstration clock has ended; restart the patrol clock');
  if (!here.eligible) {
    const free = here.availableAtSec ? `; free about ${clockLabel(Math.ceil(here.availableAtSec / 60))}` : '';
    return result(false, `${here.reason}${here.status === 'mandatory_downtime' ? '' : free}`);
  }
  if (!routeData.routes?.[`${unit.baseId}:${scenario.id}`] || !routeData.returnRoutes?.[`${unit.baseId}:${scenario.id}`]) {
    return result(false, `No cached road route from ${baseLabel} to this incident within the 4 km home-station limit`);
  }
  const plan = planResponse(unit, scenario, state, routeData, clockSec);
  if (plan.error) return result(false, plan.error);
  const inbound = prepareRoute(routeData.returnRoutes[`${unit.baseId}:${scenario.id}`].points).total;
  const needSec = (plan.distanceM + inbound) / (state.speeds.responseKmh / 3.6) + LOCAL_PATROL_SCENE_MINUTES * 60 + SHIFT_MARGIN_MINUTES * 60;
  const haveSec = unit.shiftEndMinute * 60 - clockSec;
  if (needSec > haveSec) return result(false, `Not enough fictional shift left for response, ${LOCAL_PATROL_SCENE_MINUTES} min on scene and return (needs ${Math.ceil(needSec / 60)} min, ${Math.floor(haveSec / 60)} min left)`);
  return result(true, `Eligible: ${(plan.distanceM / 1000).toFixed(1)} km by road, branching in ${Math.round(plan.metresToBranch)} m`, { plan });
}

export function scenarioEligibility(scenario, state, routeData, clockSec = state.clockSec) {
  return LOCAL_FLEET.map(unit => unitEligibility(unit, scenario, state, routeData, clockSec));
}

export function eligibleLocalUnits(scenario, state, routeData, clockSec = state.clockSec) {
  return scenarioEligibility(scenario, state, routeData, clockSec).filter(item => item.eligible).map(item => item.unit);
}

// ---------- session state ----------
export function createLocalPatrolState(scenarioIds, options = {}) {
  const patrolKmh = Number.isFinite(options.patrolKmh) ? Math.min(40, Math.max(10, options.patrolKmh)) : DEFAULT_PATROL_KMH;
  const responseKmh = Number.isFinite(options.responseKmh) ? Math.min(80, Math.max(15, options.responseKmh)) : DEFAULT_RESPONSE_KMH;
  return { version: LOCAL_PATROL_STATE_VERSION, seed: String(options.seed ?? 'DUBLIN-01'), clockSec: LOCAL_PATROL_START_MINUTE * 60,
    playbackMultiplier: PLAYBACK_MULTIPLIERS.includes(options.playbackMultiplier) ? options.playbackMultiplier : DEFAULT_PLAYBACK_MULTIPLIER,
    speeds: { patrolKmh, responseKmh }, selectedScenarioId: options.selectedScenarioId ?? scenarioIds[0], selectedUnitId: null,
    scenarios: Object.fromEntries(scenarioIds.map(id => [id, { assignedAtSec: null, unitId: null, selectedUnitId: null }])) };
}

export function validateLocalPatrolState(saved, scenarioIds, routeData) {
  try {
    if (saved?.version !== LOCAL_PATROL_STATE_VERSION || typeof saved.seed !== 'string' || !saved.seed) return false;
    if (!Number.isFinite(saved.clockSec) || saved.clockSec < LOCAL_PATROL_START_MINUTE * 60 || saved.clockSec > LOCAL_PATROL_MAX_MINUTE * 60) return false;
    if (!PLAYBACK_MULTIPLIERS.includes(saved.playbackMultiplier)) return false;
    if (!(saved.speeds?.patrolKmh >= 10 && saved.speeds.patrolKmh <= 40 && saved.speeds?.responseKmh >= 15 && saved.speeds.responseKmh <= 80)) return false;
    return scenarioIds.every(id => {
      const entry = saved.scenarios?.[id];
      if (!entry || typeof entry !== 'object') return false;
      if (entry.assignedAtSec === null) return entry.unitId === null;
      const unit = LOCAL_FLEET.find(item => item.id === entry.unitId);
      return Number.isFinite(entry.assignedAtSec) && entry.assignedAtSec >= LOCAL_PATROL_START_MINUTE * 60 && entry.assignedAtSec <= saved.clockSec &&
        unit && Array.isArray(entry.responseRoute) && entry.responseRoute.length >= 2 && entry.responseKmh >= 15 &&
        routeWithinHomeRadius(entry.responseRoute, routeData.bases[unit.baseId]?.center) && Boolean(routeData.returnRoutes?.[`${unit.baseId}:${id}`]);
    });
  } catch { return false; }
}

export function advanceClock(state, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('invalid clock step');
  return { ...state, clockSec: Math.min(LOCAL_PATROL_MAX_MINUTE * 60, state.clockSec + seconds) };
}

export function assignLocalPatrol(state, scenario, unitId, routeData) {
  const entry = state.scenarios[scenario.id];
  if (!entry) throw new Error('Unknown incident');
  if (entry.assignedAtSec !== null) throw new Error('A fictional unit is already assigned to this incident');
  const unit = LOCAL_FLEET.find(item => item.id === unitId);
  if (!unit) throw new Error('Unknown fictional unit');
  const check = unitEligibility(unit, scenario, state, routeData);
  if (!check.eligible) throw new Error(check.reason);
  const plan = check.plan;
  return { ...state, selectedUnitId: unitId, scenarios: { ...state.scenarios, [scenario.id]: {
    assignedAtSec: state.clockSec, unitId, selectedUnitId: unitId, responseRoute: plan.route, responseDistanceM: plan.distanceM,
    origin: plan.origin, loopId: plan.loopId, nodeIndex: plan.nodeIndex, responseKmh: state.speeds.responseKmh } } };
}

// ---------- incident view ----------
export function incidentView(state, scenario, routeData, clockSec = state.clockSec) {
  const entry = state.scenarios[scenario.id];
  if (!entry || entry.assignedAtSec === null) return null;
  const unit = LOCAL_FLEET.find(item => item.id === entry.unitId);
  const here = unitState(unit, clockSec, state, routeData);
  const times = timelineFor(entry, unit, routeData, scenario.id);
  const finished = clockSec >= times.returned;
  const status = finished ? here.status : here.status;
  return { unit, scenarioId: scenario.id, status, here, times, assignedAtSec: entry.assignedAtSec,
    responseKm: times.response.total / 1000, arrivalSec: times.arrival, sceneEndSec: times.sceneEnd, returnedSec: times.returned,
    followUpSec: times.arrival + 180, followUp: clockSec >= times.arrival + 180 ? FOLLOW_UP[scenario.id] : null,
    responseRoute: entry.responseRoute, returnRoute: times.inboundRoute.points, origin: entry.origin,
    target: entry.responseRoute.at(-1), routeMethod: 'precomputed OSRM/OpenStreetMap road geometry, verified within 4 km geodesic of a published station; no live routing or traffic; fictional crew, constant illustrative speeds' };
}
