function seedNumber(value) {
  let h = 2166136261;
  for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

function randomFrom(seed) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function validateSimulationConfig(config, scenarioIds) {
  if (config?.contractVersion !== '1.0.0' || config.provenance !== 'entirely_synthetic_replay') throw new TypeError('invalid simulation contract');
  if (!Number.isInteger(config.clock?.totalMinutes) || config.clock.totalMinutes < 10) throw new TypeError('invalid simulation clock');
  if (!Number.isInteger(config.clock?.defaultTickMs) || config.clock.defaultTickMs < 100) throw new TypeError('invalid simulation pace');
  if (!Number.isInteger(config.clock?.signalFreshnessMinutes) || config.clock.signalFreshnessMinutes < 1) throw new TypeError('invalid freshness window');
  for (const id of scenarioIds) {
    const scenario = config.scenarios?.[id];
    if (!scenario || !Array.isArray(scenario.events) || scenario.events.length < 4) throw new TypeError(`missing simulation events: ${id}`);
    for (const e of scenario.events) {
      if (!Number.isInteger(e.minute) || e.minute < 0 || !Number.isInteger(e.lag) || e.lag < 0 || e.minute + e.lag > config.clock.totalMinutes) throw new TypeError('invalid event clock');
      if (!['usable', 'duplicate', 'stale', 'degraded'].includes(e.quality) || !e.group || !e.label || !Number.isFinite(e.value)) throw new TypeError('invalid event evidence');
      if (!Array.isArray(e.offset) || e.offset.length !== 2 || e.offset.some(v => !Number.isFinite(v))) throw new TypeError('invalid event location');
    }
  }
  return config;
}

export function createSimulation(config, scenario, seed = 'DUBLIN-01') {
  validateSimulationConfig(config, [scenario.id]);
  const rng = randomFrom(seedNumber(`${seed}:${scenario.id}`));
  const events = config.scenarios[scenario.id].events.map((template, index) => ({
    ...template,
    id: `${scenario.id}-E${String(index + 1).padStart(2, '0')}`,
    arrivalMinute: template.minute + template.lag,
    value: Math.max(0, template.value + Math.round((rng() - 0.5) * 2)),
    lat: scenario.center[0] + template.offset[0] + (rng() - 0.5) * 0.0003,
    lon: scenario.center[1] + template.offset[1] + (rng() - 0.5) * 0.0003,
    provenance: 'synthetic',
  })).sort((a, b) => a.arrivalMinute - b.arrivalMinute || a.id.localeCompare(b.id));
  return { scenarioId: scenario.id, seed: String(seed), minute: 0, events, referenceTimeUtc: config.referenceTimeUtc, totalMinutes: config.clock.totalMinutes, signalFreshnessMinutes: config.clock.signalFreshnessMinutes };
}

export function advanceSimulation(simulation, minutes = 1) {
  if (!Number.isInteger(minutes) || minutes < 0) throw new TypeError('invalid clock step');
  return { ...simulation, minute: Math.min(simulation.totalMinutes, simulation.minute + minutes) };
}

export function simulationView(simulation) {
  const visible = simulation.events.filter(e => e.arrivalMinute <= simulation.minute);
  const recentUsable = visible.filter(e => e.signal && e.quality === 'usable' && simulation.minute - e.minute <= simulation.signalFreshnessMinutes);
  const groups = [...new Set(recentUsable.map(e => e.group))];
  const alert = groups.length >= 2;
  const excluded = visible.filter(e => e.signal && e.quality !== 'usable');
  const explanation = alert
    ? `Prototype alert: ${groups.length} independent synthetic source groups have usable, fresh signals. No operational alert or crash probability is implied.`
    : `No prototype alert: ${groups.length} usable independent signal group${groups.length === 1 ? '' : 's'}; 2 required. Duplicate, stale and degraded evidence is excluded.`;
  return { minute: simulation.minute, visible, alert, groups, excluded, explanation, complete: simulation.minute >= simulation.totalMinutes };
}

export function chooseSeededScenario(scenarios, seed) {
  if (!Array.isArray(scenarios) || !scenarios.length) throw new TypeError('missing scenarios');
  return scenarios[seedNumber(seed) % scenarios.length];
}
