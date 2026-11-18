// Versioned, deterministic correlation for the synthetic risk-event demonstration.
// A geographic association is evidence about scope, not confirmation of an incident.
export const CORRELATION_VERSION = '1.0.0';

const EXCLUDED_QUALITY = new Set(['invalid', 'duplicate', 'stale', 'missing_critical_information']);
const EARTH_RADIUS_M = 6_371_000;

function timeMs(value) {
  if (typeof value !== 'string') return NaN;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : NaN;
}

function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const term = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

function coordinate(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lon) &&
    value.lat >= -90 && value.lat <= 90 && value.lon >= -180 && value.lon <= 180;
}

function qualityFlags(value) {
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
}

function windowFor(observation, configured, fallback) {
  const selected = typeof configured === 'number' ? configured :
    configured?.[observation.observationCategory] ?? configured?.default ?? fallback;
  if (!Number.isFinite(selected) || selected <= 0 || selected > 24 * 60 * 365)
    throw new TypeError('invalid correlation window');
  return selected;
}

function geographicMatch(observation, anchor, radius) {
  const directionA = anchor.roadDirection;
  const directionB = observation.roadDirection;
  if (directionA && directionB && directionA !== directionB)
    return { exclusion: 'opposite_road_direction' };

  const segmentA = anchor.roadSegmentId;
  const segmentB = observation.roadSegmentId;
  if (segmentA && segmentB) {
    if (segmentA !== segmentB) return { exclusion: 'different_road_segment' };
    // An authored or provisional segment label is not proof of road matching.
    if (anchor.metadata?.roadSegmentVerified === true &&
        observation.metadata?.roadSegmentVerified === true)
      return { matchLevel: 'exact_segment', reason: 'matching explicitly verified road-segment IDs' };
  }

  const areaA = anchor.spatialCoverage?.areaId;
  const areaB = observation.spatialCoverage?.areaId;
  if (areaA && areaB) {
    if (areaA !== areaB) return { exclusion: 'different_mapped_area' };
    if (anchor.spatialCoverage?.type === 'provisional_demo_area' ||
        observation.spatialCoverage?.type === 'provisional_demo_area')
      return { matchLevel: 'provisional_proximity',
        reason: 'matching provisional exercise-area labels only; road or carriageway equivalence is not established' };
    return { matchLevel: 'mapped_area',
      reason: 'matching explicitly mapped area IDs; road-segment equivalence is not established' };
  }

  if (!coordinate(anchor.location) || !coordinate(observation.location))
    return { exclusion: 'missing_geographic_scope' };
  const separationMeters = distanceMeters(anchor.location, observation.location);
  const uncertainty = Number(anchor.spatialUncertainty?.radiusMeters || 0) +
    Number(observation.spatialUncertainty?.radiusMeters || 0);
  if (separationMeters > radius + Math.max(0, uncertainty))
    return { exclusion: 'outside_provisional_radius', separationMeters };
  return { matchLevel: 'provisional_proximity',
    reason: 'provisional proximity only; no road-segment or carriageway match is established',
    separationMeters };
}

/**
 * Group observations available at `assessmentAt` around one explicit anchor.
 * `windowMinutes` can be a number or a category-to-minutes map with `default`.
 * Every returned included/excluded entry preserves its original observation.
 */
export function correlateObservations(observations, {
  assessmentAt, anchor, windowMinutes = 24, provisionalRadiusMeters = 750,
  forecastHorizonMinutes = 120,
} = {}) {
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array');
  const at = timeMs(assessmentAt);
  if (!Number.isFinite(at)) throw new TypeError('valid assessmentAt required');
  if (!anchor || typeof anchor !== 'object' || (!anchor.roadSegmentId &&
      !anchor.spatialCoverage?.areaId && !coordinate(anchor.location)))
    throw new TypeError('explicit geographic anchor required');
  if (!Number.isFinite(provisionalRadiusMeters) || provisionalRadiusMeters < 0 || provisionalRadiusMeters > 20_000)
    throw new TypeError('invalid provisional radius');
  if (!Number.isFinite(forecastHorizonMinutes) || forecastHorizonMinutes < 0 || forecastHorizonMinutes > 24 * 60 * 14)
    throw new TypeError('invalid forecast horizon');

  const included = [], excluded = [];
  const seenIds = new Set(), seenSourceRecords = new Set();
  for (const observation of observations) {
    const reasons = [];
    const id = observation?.observationId ?? null;
    if (!observation || observation.schemaVersion !== CORRELATION_VERSION || !id)
      reasons.push('invalid_observation_contract');
    if (id && seenIds.has(id)) reasons.push('duplicate_observation_id');
    if (id) seenIds.add(id);
    const sourceRecord = observation?.sourceId && observation?.sourceRecordId
      ? `${observation.sourceId}\u0000${observation.sourceRecordId}` : null;
    if (sourceRecord && seenSourceRecords.has(sourceRecord)) reasons.push('duplicate_source_record');
    if (sourceRecord) seenSourceRecords.add(sourceRecord);

    const flags = qualityFlags(observation?.qualityStatus);
    for (const flag of flags) if (EXCLUDED_QUALITY.has(flag)) reasons.push(`quality_${flag}`);
    if (Boolean(observation?.isSynthetic) !== Boolean(anchor.isSynthetic))
      reasons.push('synthetic_public_boundary');
    if (anchor.scenarioId && observation?.scenarioId && anchor.scenarioId !== observation.scenarioId)
      reasons.push('different_scenario');
    if (observation?.provenanceType === 'dated_public_reference') reasons.push('dated_reference_not_event_signal');

    const observed = timeMs(observation?.observedAt);
    const received = timeMs(observation?.receivedAt);
    const from = observation?.validFrom == null ? observed : timeMs(observation.validFrom);
    const until = observation?.validUntil == null ? Infinity : timeMs(observation.validUntil);
    if (![observed, received, from].every(Number.isFinite) || Number.isNaN(until) || until < from)
      reasons.push('invalid_time');
    else {
      const forecast = observation.observationCategory === 'weather_forecast';
      const windowMs = windowFor(observation, windowMinutes, 24) * 60_000;
      if (received > at) reasons.push('not_yet_received');
      if (observed > at) reasons.push('future_observation');
      if (from > at && !forecast) reasons.push('not_yet_valid');
      if (forecast && from > at + forecastHorizonMinutes * 60_000) reasons.push('beyond_forecast_horizon');
      if (until < at) reasons.push('expired');
      if (!forecast && observed < at - windowMs) reasons.push('outside_time_window');
    }

    const geographic = observation ? geographicMatch(observation, anchor, provisionalRadiusMeters)
      : { exclusion: 'missing_geographic_scope' };
    if (geographic.exclusion) reasons.push(geographic.exclusion);
    if (reasons.length) {
      excluded.push({ observationId: id, observation, exclusionReasons: [...new Set(reasons)] });
      continue;
    }
    included.push({ observationId: id, observation, matchLevel: geographic.matchLevel,
      inclusionReasons: [geographic.reason,
        observation.observationCategory === 'weather_forecast'
          ? 'forecast received by assessment time; future validity remains labelled forecast'
          : 'received and valid by assessment time',
        'within configured category time or forecast horizon'],
      independenceGroup: observation.independenceGroup || observation.sourceId,
      ...(geographic.separationMeters === undefined ? {} : { separationMeters: geographic.separationMeters }) });
  }

  const independentGroups = [...new Set(included.map(entry => entry.independenceGroup).filter(Boolean))].sort();
  const matchLevels = [...new Set(included.map(entry => entry.matchLevel))];
  const anchorKey = anchor.roadSegmentId || anchor.spatialCoverage?.areaId ||
    `${anchor.location.lat.toFixed(5)},${anchor.location.lon.toFixed(5)}`;
  return {
    schemaVersion: CORRELATION_VERSION,
    groupId: `${anchor.scenarioId || 'unspecified'}:${anchorKey}:${assessmentAt}`,
    assessmentAt, scope: { roadSegmentId: anchor.roadSegmentId || null,
      roadDirection: anchor.roadDirection || null, areaId: anchor.spatialCoverage?.areaId || null,
      location: anchor.location || null, provisionalRadiusMeters },
    timeWindow: { configuredMinutes: windowMinutes, endsAt: assessmentAt, forecastHorizonMinutes },
    included, excluded, independentGroups,
    uncertainty: {
      geographic: matchLevels.includes('provisional_proximity') ? 'provisional' :
        matchLevels.includes('mapped_area') ? 'mapped_area' : matchLevels.includes('exact_segment') ? 'verified_segment' : 'unmatched',
      sourceIndependence: 'independenceGroup is an asserted source grouping; upstream independence requires separate verification',
    },
    coverageLimitations: matchLevels.includes('provisional_proximity')
      ? ['Proximity does not establish matching road, direction or carriageway'] : [],
  };
}
