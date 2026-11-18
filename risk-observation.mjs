// Versioned evidence boundary for the synthetic risk-event demonstration.
// This module never upgrades dated public reference data into current road evidence.
import { interpretMeasurement } from './risk-measurements.mjs';
export const OBSERVATION_SCHEMA_VERSION = '1.0.0';

export const OBSERVATION_CATEGORIES = Object.freeze([
  'traffic_speed', 'traffic_volume', 'traffic_congestion', 'traffic_flow_anomaly',
  'rainfall', 'weather_forecast', 'visibility', 'temperature', 'wind',
  'road_surface_condition', 'roadworks', 'road_obstruction', 'collision_report',
  'near_miss_observation', 'aggregated_telematics',
  'historical_road_safety_characteristic', 'road_geometry',
  'infrastructure_vulnerability', 'authorised_field_report',
]);
export const PROVENANCE_TYPES = Object.freeze([
  'synthetic_scenario_input', 'dated_public_reference',
  'current_approved_provider', 'authorised_operational_report',
  'derived_analytical_output', 'unverified_external_report',
]);
export const QUALITY_STATUSES = Object.freeze([
  'usable', 'degraded', 'stale', 'duplicate', 'invalid',
  'missing_critical_information', 'conflicting', 'unverified',
]);
export const QUALITY_FLAGS = QUALITY_STATUSES;

// Compatibility is explicit. An unknown unit must be rejected, not silently
// interpreted as a different measurement. Null is allowed for qualitative reports.
const UNITS = Object.freeze({
  traffic_speed: ['km/h', 'm/s', 'index', 'index_points'],
  traffic_volume: ['vehicles/h', 'vehicles/hour', 'vehicles/day', 'vehicles/minute', 'count', 'index', 'index_points'],
  traffic_congestion: ['percent', 'vehicles/km', 'km/h', 'km', 'index', 'index_points'],
  traffic_flow_anomaly: ['km/h', 'percent', 'index', 'index_points'],
  rainfall: ['mm', 'mm/h', 'mm/hour'],
  weather_forecast: ['mm', 'mm/h', 'm/s', 'km/h', 'C', '°C', 'F', '°F', 'K', 'index'],
  visibility: ['m', 'km'], temperature: ['C', '°C', 'F', '°F', 'K'], wind: ['m/s', 'km/h'],
  road_surface_condition: ['C', '°C', 'F', '°F', 'K', 'mm', 'index', 'boolean'],
  roadworks: ['boolean', 'index', 'index_points'], road_obstruction: ['boolean', 'index'],
  collision_report: ['count', 'boolean', 'index'],
  near_miss_observation: ['count', 'index', 'index_points'],
  aggregated_telematics: ['count', 'km/h', 'percent', 'index', 'index_points'],
  historical_road_safety_characteristic: ['count', 'percent', 'index', 'index_points'],
  road_geometry: ['m', 'km', 'degrees', 'percent', 'index'],
  infrastructure_vulnerability: ['boolean', 'index', 'percent'],
  authorised_field_report: ['boolean', 'count', 'index'],
});
const QUANTITATIVE = new Set([
  'traffic_speed', 'traffic_volume', 'traffic_congestion', 'traffic_flow_anomaly',
  'rainfall', 'visibility', 'temperature', 'wind',
]);
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function timestamp(value, name) {
  if (typeof value !== 'string' || !UTC_TIME.test(value)) throw new TypeError(`${name} must be an ISO timestamp with timezone`);
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19));
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const offset = value.endsWith('Z') ? null : value.slice(-6);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day ||
      hour > 23 || minute > 59 || second > 59 ||
      (offset && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))) {
    throw new TypeError(`${name} is not a calendar timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} is not a valid timestamp`);
  return new Date(parsed).toISOString();
}
function optionalTimestamp(value, name) {
  return value === null || value === undefined ? null : timestamp(value, name);
}
function coordinate(location) {
  if (location === null || location === undefined) return null;
  if (!plainObject(location) || !Number.isFinite(location.lat) || !Number.isFinite(location.lon) ||
      location.lat < -90 || location.lat > 90 || location.lon < -180 || location.lon > 180) {
    throw new TypeError('location requires valid latitude and longitude');
  }
  // Dublin is the scope of this demonstrator, not an official service area.
  if (location.lat < 53 || location.lat > 53.75 || location.lon < -6.8 || location.lon > -5.9)
    throw new TypeError('location is outside the Dublin demonstration extent');
  return { lat: location.lat, lon: location.lon };
}
function spatialCoverage(value) {
  if (value === null || value === undefined) return null;
  if (!plainObject(value) || !['verified_segment', 'mapped_area', 'provisional_demo_area'].includes(value.type) ||
      (value.areaId !== null && value.areaId !== undefined && typeof value.areaId !== 'string') ||
      (value.radiusMeters !== null && value.radiusMeters !== undefined &&
       (!Number.isFinite(value.radiusMeters) || value.radiusMeters < 0))) {
    throw new TypeError('spatialCoverage is invalid');
  }
  if (value.type === 'provisional_demo_area' && value.verified === true)
    throw new TypeError('provisional geography cannot be verified');
  return { type: value.type, areaId: value.areaId ?? null,
    radiusMeters: value.radiusMeters ?? null, verified: value.verified === true };
}
function spatialUncertainty(value) {
  if (value === null || value === undefined) return null;
  const item = typeof value === 'string' ? { method: value, radiusMeters: null } : value;
  if (!plainObject(item) || typeof item.method !== 'string' || !item.method.trim() ||
      (item.radiusMeters !== null && item.radiusMeters !== undefined &&
       (!Number.isFinite(item.radiusMeters) || item.radiusMeters < 0)))
    throw new TypeError('spatialUncertainty is invalid');
  return { method: item.method.trim(), radiusMeters: item.radiusMeters ?? null };
}

/** Normalise one observation without mutating the input. `seenIds`, if supplied,
 * is the caller's session-local duplicate ledger and is updated on acceptance. */
export function normaliseObservation(raw, {
  assessmentAt = null, seenIds = null, freshnessMsByCategory = {},
} = {}) {
  if (!plainObject(raw)) throw new TypeError('observation must be an object');
  if (raw.schemaVersion !== OBSERVATION_SCHEMA_VERSION) throw new TypeError('unsupported observation schemaVersion');
  const observationId = nonempty(raw.observationId, 'observationId');
  const observationCategory = nonempty(raw.observationCategory, 'observationCategory');
  if (!OBSERVATION_CATEGORIES.includes(observationCategory)) throw new TypeError('unsupported observationCategory');
  const provenanceType = nonempty(raw.provenanceType, 'provenanceType');
  if (!PROVENANCE_TYPES.includes(provenanceType)) throw new TypeError('unsupported provenanceType');
  if (typeof raw.isSynthetic !== 'boolean') throw new TypeError('isSynthetic must be explicit');
  if (raw.isSynthetic !== (provenanceType === 'synthetic_scenario_input') &&
      provenanceType !== 'derived_analytical_output') throw new TypeError('synthetic provenance mismatch');
  if (raw.isSynthetic && !raw.scenarioId) throw new TypeError('synthetic observation requires scenarioId');
  if (!raw.isSynthetic && provenanceType === 'synthetic_scenario_input') throw new TypeError('synthetic marker cannot be removed');

  const measurementValue = raw.measurementValue === undefined || raw.measurementValue === null ? null : raw.measurementValue;
  if (measurementValue !== null && !Number.isFinite(measurementValue)) throw new TypeError('measurementValue must be finite or null');
  const measurementUnit = raw.measurementUnit ?? null;
  const measurementType = nonempty(raw.measurementType, 'measurementType');
  if (measurementUnit !== null && !UNITS[observationCategory].includes(measurementUnit))
    throw new TypeError('unsupported measurementUnit for observationCategory');
  if (measurementValue !== null && measurementUnit === null) throw new TypeError('numeric measurement requires a unit');
  const normalisedMeasurement = interpretMeasurement({ observationCategory, measurementType,
    measurementValue, measurementUnit, measurementIntervalMinutes: raw.measurementIntervalMinutes });

  const observedAt = timestamp(raw.observedAt, 'observedAt');
  const receivedAt = timestamp(raw.receivedAt, 'receivedAt');
  const validFrom = timestamp(raw.validFrom, 'validFrom');
  const validUntil = optionalTimestamp(raw.validUntil, 'validUntil');
  if (validUntil && Date.parse(validUntil) < Date.parse(validFrom)) throw new TypeError('validUntil precedes validFrom');
  if (observationCategory !== 'weather_forecast' && Date.parse(receivedAt) < Date.parse(observedAt))
    throw new TypeError('receivedAt precedes observedAt');

  const location = coordinate(raw.location);
  const roadSegmentId = raw.roadSegmentId == null ? null : nonempty(raw.roadSegmentId, 'roadSegmentId');
  const roadDirection = raw.roadDirection == null ? null : nonempty(raw.roadDirection, 'roadDirection');
  const coverage = spatialCoverage(raw.spatialCoverage);
  const uncertainty = spatialUncertainty(raw.spatialUncertainty);
  if (coverage?.type === 'provisional_demo_area' && raw.metadata?.roadSegmentVerified === true)
    throw new TypeError('provisional geography cannot claim a verified road segment');
  if (coverage?.type === 'verified_segment' && (!roadSegmentId || raw.metadata?.roadSegmentVerified !== true))
    throw new TypeError('verified segment coverage requires an explicitly verified roadSegmentId');

  const qualityStatus = raw.qualityStatus ?? 'usable';
  if (!QUALITY_STATUSES.includes(qualityStatus)) throw new TypeError('unsupported qualityStatus');
  if (raw.qualityReasons !== undefined &&
      (!Array.isArray(raw.qualityReasons) || raw.qualityReasons.some(item => typeof item !== 'string' || !item.trim())))
    throw new TypeError('qualityReasons must contain nonempty strings');
  const reasons = [...(raw.qualityReasons || [])];
  const flags = new Set(qualityStatus === 'usable' ? [] : [qualityStatus]);
  if (normalisedMeasurement.status === 'incompatible') {
    flags.add('invalid'); reasons.push(normalisedMeasurement.reason);
  } else if (normalisedMeasurement.status === 'missing') {
    flags.add('missing_critical_information'); reasons.push(normalisedMeasurement.reason);
  }
  if (seenIds && !(seenIds instanceof Set)) throw new TypeError('seenIds must be a Set');
  if (seenIds?.has(observationId)) { flags.add('duplicate'); reasons.push('duplicate observationId in this evaluation'); }
  if (measurementValue === null && QUANTITATIVE.has(observationCategory)) {
    flags.add('missing_critical_information'); reasons.push('required numeric measurement missing');
  }
  if (!location && !roadSegmentId && !coverage?.areaId) {
    flags.add('missing_critical_information'); reasons.push('geographic scope missing');
  }
  if (assessmentAt !== null) {
    const assessed = Date.parse(timestamp(assessmentAt, 'assessmentAt'));
    if (Date.parse(receivedAt) > assessed || Date.parse(validFrom) > assessed) {
      flags.add('unverified'); reasons.push('observation unavailable at assessment time');
    } else if (validUntil && Date.parse(validUntil) < assessed) {
      flags.add('stale'); reasons.push('observation validity ended before assessment');
    } else if (Number.isFinite(freshnessMsByCategory[observationCategory]) &&
               assessed - Date.parse(observedAt) > freshnessMsByCategory[observationCategory]) {
      flags.add('stale'); reasons.push('observation exceeds category freshness window');
    }
  }

  const sourceRecordId = raw.sourceRecordId == null ? null : nonempty(raw.sourceRecordId, 'sourceRecordId');
  const independenceGroup = nonempty(raw.independenceGroup, 'independenceGroup');
  const metadata = raw.metadata === undefined ? {} : raw.metadata;
  if (!plainObject(metadata)) throw new TypeError('metadata must be an object');
  if (provenanceType === 'derived_analytical_output') {
    if (!Array.isArray(metadata.parentObservationIds) || !metadata.parentObservationIds.length)
      throw new TypeError('derived observation requires parentObservationIds');
    if (typeof metadata.parentSynthetic !== 'boolean' || metadata.parentSynthetic !== raw.isSynthetic)
      throw new TypeError('derived observation must preserve parentSynthetic provenance');
  }

  const status = ['invalid', 'duplicate', 'missing_critical_information', 'conflicting',
    'stale', 'degraded', 'unverified'].find(item => flags.has(item)) || 'usable';
  const result = Object.freeze({

    observationId, schemaVersion: OBSERVATION_SCHEMA_VERSION,
    sourceId: nonempty(raw.sourceId, 'sourceId'),
    sourceType: nonempty(raw.sourceType, 'sourceType'),
    sourceGroup: nonempty(raw.sourceGroup, 'sourceGroup'),
    sourceProvider: nonempty(raw.sourceProvider, 'sourceProvider'),
    sourceRecordId, provenanceType, observationCategory,
    measurementType, measurementValue, measurementUnit,
    measurementIntervalMinutes: raw.measurementIntervalMinutes ?? null,
    normalisedMeasurement: Object.freeze(normalisedMeasurement),
    observedAt, receivedAt, validFrom, validUntil,
    location, roadSegmentId, roadDirection, spatialCoverage: coverage,
    spatialUncertainty: uncertainty, qualityStatus: status,
    qualityFlags: Object.freeze([...flags]),
    qualityReasons: Object.freeze([...new Set(reasons)]), independenceGroup,
    isSynthetic: raw.isSynthetic, scenarioId: raw.scenarioId ?? null,
    metadata: Object.freeze({ ...metadata }),
  });
  if (seenIds) seenIds.add(observationId);
  return result;
}

export function validateObservation(raw) {
  normaliseObservation(raw);
  return true;
}

const EVENT_CATEGORY = Object.freeze({
  baseline: 'historical_road_safety_characteristic',
  speed_variance: 'traffic_speed', count_anomaly: 'traffic_volume',
  conflict_report: 'near_miss_observation', vru_conflict: 'near_miss_observation',
  harsh_braking: 'aggregated_telematics', works_notice: 'roadworks',
  delay: 'traffic_congestion', crossing_count: 'traffic_volume',
});

/** Adapter for the existing replay event *after* createSimulation has assigned an ID.
 * It preserves the authored quality/source group and does not assert real independence. */
export function adaptSyntheticEvent(event, {
  scenarioId, scenarioCenter, referenceTimeUtc, freshnessMinutes = 24,
} = {}) {
  if (!EVENT_CATEGORY[event?.kind] || !Number.isInteger(event.minute) ||
      !Number.isInteger(event.arrivalMinute) || !Array.isArray(scenarioCenter) ||
      scenarioCenter.length !== 2) throw new TypeError('invalid synthetic replay event');
  const reference = Date.parse(timestamp(referenceTimeUtc, 'referenceTimeUtc'));
  const observedAt = new Date(reference + event.minute * 60_000).toISOString();
  const receivedAt = new Date(reference + event.arrivalMinute * 60_000).toISOString();
  const lat = Number.isFinite(event.lat) ? event.lat : scenarioCenter[0] + (event.offset?.[0] || 0);
  const lon = Number.isFinite(event.lon) ? event.lon : scenarioCenter[1] + (event.offset?.[1] || 0);
  return normaliseObservation({
    observationId: event.id, schemaVersion: OBSERVATION_SCHEMA_VERSION,
    sourceId: `synthetic:${event.group}`, sourceType: 'synthetic_fixture',
    sourceGroup: event.group, sourceProvider: 'EcoTech synthetic replay',
    sourceRecordId: event.id, provenanceType: 'synthetic_scenario_input',
    observationCategory: EVENT_CATEGORY[event.kind], measurementType: event.kind,
    measurementValue: event.value, measurementUnit: 'index_points',
    observedAt, receivedAt, validFrom: observedAt,
    validUntil: new Date(reference + (event.minute + freshnessMinutes) * 60_000).toISOString(),
    location: { lat, lon }, roadSegmentId: null, roadDirection: null,
    spatialCoverage: { type: 'provisional_demo_area', areaId: scenarioId, radiusMeters: 600, verified: false },
    spatialUncertainty: { method: 'synthetic_offset_within_provisional_area', radiusMeters: 600 },
    qualityStatus: event.quality, qualityReasons: [], independenceGroup: event.group,
    isSynthetic: true, scenarioId,
    metadata: { signal: event.signal === true, label: event.label,
      independenceClaim: 'fixture_group_only', originalMinute: event.minute,
      arrivalMinute: event.arrivalMinute },
  });
}
