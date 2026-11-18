export function workerEndpoint(config) {
  if (config?.contractVersion !== '1.0.0') throw new Error('Public Worker configuration version unsupported');
  if (config.workerBaseUrl === null) return null;
  const url = new URL(config.workerBaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Public Worker must have a reviewed HTTPS origin');
  return `${url.origin}/v1/context`;
}

export function validateWorkerContext(snapshot) {
  if (snapshot?.contractVersion !== '1.0.0' || snapshot.status !== 'dated_public_context' ||
      !Number.isFinite(Date.parse(snapshot.refreshedAt)) || !snapshot.sources || typeof snapshot.sources !== 'object')
    throw new Error('Public Worker response invalid');
  const sources = snapshot.sources;
  for (const name of ['met', 'tiiLocations', 'tiiRecent', 'tiiHistorical', 'rsa']) {
    const source = sources[name];
    if (!source) continue;
    if (!['retrieved', 'stale', 'unavailable'].includes(source.status) ||
        !Number.isFinite(Date.parse(source.attemptedAt))) throw new Error(`Invalid ${name} status`);
  }
  if (sources.met?.data && (sources.met.data.stationId !== '0003' ||
      sources.met.data.stationName !== 'Phoenix Park' || !Array.isArray(sources.met.data.observed?.frames)))
    throw new Error('Worker weather must be Phoenix Park only');
  if (sources.tiiLocations?.data && !Array.isArray(sources.tiiLocations.data)) throw new Error('Invalid TII locations');
  if (sources.rsa?.data && (sources.rsa.data.provenance !== 'public_historical_county_aggregate' ||
      !Array.isArray(sources.rsa.data.records))) throw new Error('Invalid RSA county data');
  return snapshot;
}

export async function getWorkerContext(fetcher = fetch) {
  const configResponse = await fetcher('./public-worker.config.v1.json', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Worker configuration unavailable');
  const endpoint = workerEndpoint(await configResponse.json());
  if (!endpoint) return { status: 'not_configured', snapshot: null };
  const response = await fetcher(endpoint, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
  return { status: 'connected', snapshot: validateWorkerContext(await response.json()) };
}
