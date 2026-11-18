// Reviewed, cached public geography. No visitor page load calls a publisher API.
const SITE_KINDS = ['gardaStations', 'tiiCounters', 'metStations'];

export function validatePublicMapContext(snapshot) {
  if (snapshot?.contractVersion !== '1.0.0' || snapshot.status !== 'cached_public_snapshot' ||
      !Number.isFinite(Date.parse(snapshot.retrievedAt)) || !snapshot.resources ||
      !Array.isArray(snapshot.weatherObservations)) throw new Error('Invalid public map snapshot');
  for (const kind of SITE_KINDS) {
    const sites = snapshot[kind];
    if (!Array.isArray(sites) || !sites.length) throw new Error(`${kind} unavailable`);
    const ids = new Set();
    for (const site of sites) {
      if (typeof site.id !== 'string' || !site.id || ids.has(site.id) ||
          typeof site.name !== 'string' || !site.name ||
          !Number.isFinite(site.lat) || !Number.isFinite(site.lon) ||
          site.lat < 53 || site.lat > 53.75 || site.lon < -6.8 || site.lon > -5.9 ||
          !Number.isFinite(Date.parse(site.retrievedAt))) throw new Error(`${kind} site invalid`);
      ids.add(site.id);
      if ((kind === 'gardaStations' || kind === 'metStations') && (!Array.isArray(site.sourceIds) || !site.sourceIds.length ||
          site.popupNotice !== 'Public station location. Patrol units and deployments in this demonstration are simulated.')) {
        throw new Error('Station provenance or disclosure missing');
      }
    }
  }
  for (const [name, resource] of Object.entries(snapshot.resources)) {
    if (resource.status !== 'retrieved' || !/^https:\/\//.test(resource.url) ||
        !/^[a-f0-9]{64}$/.test(resource.sha256) ||
        !Number.isInteger(resource.bytes) || resource.bytes < 1 ||
        !resource.publisher || !resource.licence) throw new Error(`${name} resource invalid`);
  }
  if (!['retrieved', 'cached', 'unavailable'].includes(snapshot.weatherStatus)) {
    throw new Error('Weather status invalid');
  }
  return snapshot;
}

export function latestWeatherAtStation(snapshot, stationId = '0003', metric = 'air_temperature') {
  const records = snapshot?.weatherObservations || [];
  return records.filter(record => record.metric === metric &&
      String(record.originalSourceId || '').startsWith(`station-${stationId}:`) &&
      Number.isFinite(Date.parse(record.observationInterval?.instantUtc)) &&
      Number.isFinite(Number(record.value)))
    .sort((a, b) => Date.parse(b.observationInterval.instantUtc) - Date.parse(a.observationInterval.instantUtc))[0] || null;
}
