// A dated Met Éireann snapshot, deliberately separate from the synthetic scenario clock.
export const WARNING_MAX_AGE_MS = 60 * 60 * 1000;

export function forecastAccess(snapshot, now = Date.now()) {
  const checked = Date.parse(snapshot?.warningFeed?.checkedAt || '');
  if (!Number.isFinite(checked) || now - checked < 0 || now - checked > WARNING_MAX_AGE_MS)
    return { allowed: false, reason: 'Forecast hidden: current Met Éireann warning feed has not been verified within one hour.' };
  if (snapshot.warningFeed.count !== 0)
    return { allowed: false, reason: 'Forecast hidden: active weather warnings require full, current warning display.' };
  return { allowed: true, reason: 'Warning feed checked within one hour; no active warnings in the retrieved response.' };
}

export function timelineFrames(snapshot, mode, scenarioId, now = Date.now()) {
  if (snapshot?.contractVersion !== '1.0.0') throw new TypeError('Unsupported Met weather snapshot');
  if (mode === 'radar') return { frames: [], reason: 'Radar unavailable: the published HDF5 grid still needs georeferenced decoding and display.' };
  if (mode === 'observed') return { frames: snapshot.observed?.frames || [], reason: 'Phoenix Park station observation; not a corridor measurement.' };
  const access = forecastAccess(snapshot, now);
  return { frames: access.allowed ? snapshot.forecast?.points?.[scenarioId] || [] : [], reason: access.reason };
}

export function weatherCondition(frame) {
  if (!frame) return 'No weather frame available.';
  const rain = frame.rainAccumulationMm;
  const gust = frame.windGustMps;
  const parts = [];
  if (Number.isFinite(rain)) parts.push(`${rain.toFixed(1)} mm rain accumulated ${frame.rainIntervalStartUtc}–${frame.rainIntervalEndUtc}`);
  if (Number.isFinite(frame.windSpeedMps)) parts.push(`${frame.windSpeedMps.toFixed(1)} m/s wind from ${frame.windFromName || (Number.isFinite(frame.windFromDegrees) ? Math.round(frame.windFromDegrees) + '°' : 'unknown direction')}`);
  if (Number.isFinite(gust)) parts.push(`${gust.toFixed(1)} m/s gust`);
  if (Number.isFinite(frame.airTemperatureC)) parts.push(`${frame.airTemperatureC.toFixed(1)} °C air temperature`);
  const review = (Number.isFinite(rain) && rain >= 2) || (Number.isFinite(gust) && gust >= 15);
  return `${parts.join(' · ') || 'No measured variables.'}${review ? ' · Prototype weather review condition: ≥2 mm per stated interval or gust ≥15 m/s; not a crash prediction.' : ''}`;
}
