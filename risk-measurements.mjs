// Measurement semantics shared by observation validation and synthetic rules.
// An observation's original value/unit always remain separate from a rule-ready value.
export const MEASUREMENT_PROFILES = Object.freeze({
  'collision_report:incident_report': ['boolean_flag', 'boolean', 'incident_report'],
  'collision_report:incident_confirmation': ['boolean_flag', 'boolean', 'incident_confirmation'],
  'collision_report:incident_resolution': ['boolean_flag', 'boolean', 'incident_resolution'],
  'road_surface_condition:water_depth': ['road_water_depth', 'mm', 'water_depth'],
  'rainfall:rain_rate': ['rainfall_intensity', 'mm/h', 'rain_rate'],
  'rainfall:rain_accumulation': ['rainfall_intensity', 'mm/h', 'rain_rate'],
  'traffic_volume:vehicle_count': ['vehicle_flow_rate', 'vehicles/h', 'vehicle_count'],
  'traffic_speed:speed': ['vehicle_speed', 'km/h', 'speed'],
  'traffic_congestion:queue_length': ['queue_distance', 'km', 'queue_length'],
  'road_geometry:wet_curve_exposure': ['dimensionless_index', 'index', 'wet_curve_exposure'],
  'historical_road_safety_characteristic:wet_collision_vulnerability': ['dimensionless_index', 'index', 'wet_collision_vulnerability'],
  'temperature:air_temperature': ['air_temperature', 'C', 'air_temperature'],
  'road_surface_condition:surface_temperature': ['surface_temperature', 'C', 'surface_temperature'],
  'road_surface_condition:moisture_indicator': ['dimensionless_index', 'index', 'moisture_indicator'],
  'visibility:visibility_range': ['sight_distance', 'm', 'visibility_range'],
  'roadworks:works_active': ['boolean_flag', 'boolean', 'works_active'],
  'traffic_flow_anomaly:minor_flow_variation': ['dimensionless_index', 'index', 'minor_flow_variation'],
});

const compatible = (profile, unit, interval, measurementType) => {
  const [quantity, normalizedUnit] = profile;
  switch (quantity) {
    case 'boolean_flag': return unit === 'boolean' ? value => [value, 'direct'] : null;
    case 'dimensionless_index': return unit === 'index' ? value => [value, 'direct'] : null;
    case 'road_water_depth': return unit === 'mm' ? value => [value, 'direct'] : null;
    case 'rainfall_intensity':
      if (measurementType === 'rain_accumulation' && unit !== 'mm') return null;
      if (unit === 'mm/h' || unit === 'mm/hour') return value => [value, unit === normalizedUnit ? 'direct' : 'unit_alias'];
      return unit === 'mm' && interval !== null ? value => [value * 60 / interval, 'accumulation_over_explicit_interval'] : null;
    case 'vehicle_flow_rate':
      if (unit === 'vehicles/h' || unit === 'vehicles/hour') return value => [value, unit === normalizedUnit ? 'direct' : 'unit_alias'];
      if (unit === 'vehicles/minute') return value => [value * 60, 'minute_rate_to_hour_rate'];
      if (unit === 'vehicles/day') return value => [value / 24, 'day_rate_to_hour_rate'];
      return unit === 'count' && interval !== null ? value => [value * 60 / interval, 'count_over_explicit_interval'] : null;
    case 'vehicle_speed': return unit === 'km/h' ? value => [value, 'direct'] :
      unit === 'm/s' ? value => [value * 3.6, 'metres_per_second_to_kilometres_per_hour'] : null;
    case 'queue_distance': return unit === 'km' ? value => [value, 'direct'] :
      unit === 'm' ? value => [value / 1000, 'metres_to_kilometres'] : null;
    case 'air_temperature': case 'surface_temperature':
      if (unit === 'C' || unit === '°C') return value => [value, unit === normalizedUnit ? 'direct' : 'unit_alias'];
      if (unit === 'F' || unit === '°F') return value => [(value - 32) * 5 / 9, 'fahrenheit_to_celsius'];
      return unit === 'K' ? value => [value - 273.15, 'kelvin_to_celsius'] : null;
    case 'sight_distance': return unit === 'm' ? value => [value, 'direct'] :
      unit === 'km' ? value => [value * 1000, 'kilometres_to_metres'] : null;
    default: throw new TypeError('unknown measurement profile quantity');
  }
};

/** Pure interpretation: invalid semantics are retained as explicit exclusions, not guessed. */
export function interpretMeasurement({ observationCategory, measurementType, measurementValue,
  measurementUnit, measurementIntervalMinutes = null } = {}) {
  const profile = MEASUREMENT_PROFILES[`${observationCategory}:${measurementType}`];
  const originalValue = measurementValue ?? null, originalUnit = measurementUnit ?? null;
  const interval = measurementIntervalMinutes ?? null;
  const base = { originalValue, originalUnit, measurementIntervalMinutes: interval,
    quantity: profile?.[0] || 'unmodelled', normalizedType: profile?.[2] || null,
    normalizedValue: null, normalizedUnit: profile?.[1] || null, derivation: null };
  if (interval !== null && (!Number.isFinite(interval) || interval <= 0 || interval > 366 * 24 * 60))
    return { ...base, status: 'incompatible', reason: 'measurement interval must be a positive finite number of minutes' };
  if (!profile) return { ...base, status: 'unmodelled', reason: 'no active rule measurement profile' };
  if (originalValue === null) return { ...base, status: 'missing', reason: 'measurement value missing for active rule' };
  if (!Number.isFinite(originalValue)) return { ...base, status: 'incompatible', reason: 'measurement value must be finite' };
  const convert = compatible(profile, originalUnit, interval, measurementType);
  if (!convert) return { ...base, status: 'incompatible',
    reason: `${observationCategory}/${measurementType} requires ${profile[1]} or an explicitly convertible unit and interval` };
  const [normalizedValue, derivation] = convert(originalValue);
  if (!Number.isFinite(normalizedValue) ||
      (profile[0] === 'boolean_flag' && ![0, 1].includes(normalizedValue)) ||
      (profile[0] === 'dimensionless_index' && (normalizedValue < 0 || normalizedValue > 1)) ||
      ((profile[0] === 'air_temperature' || profile[0] === 'surface_temperature') && normalizedValue < -273.15))
    return { ...base, status: 'incompatible', reason: 'measurement value is outside its defined physical or index range' };
  return { ...base, status: 'compatible', normalizedValue, derivation, reason: null };
}
