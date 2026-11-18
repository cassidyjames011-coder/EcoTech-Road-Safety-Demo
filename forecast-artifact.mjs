export function parseForecastArtifact(value) {
  if (!value || value.contractVersion !== '1.0.0' || value.model !== 'TimesFM 3.0') {
    throw new Error('Invalid forecast artifact contract');
  }
  if (value.status === 'unavailable') {
    return { status: 'unavailable', message: String(value.reason || 'Model forecast unavailable.') };
  }
  if (value.status !== 'evaluated_offline' || !Array.isArray(value.forecast) ||
      !Array.isArray(value.holdoutActual) || !value.forecast.length ||
      value.forecast.length !== value.holdoutActual.length ||
      !value.forecast.every(Number.isFinite) || !value.holdoutActual.every(Number.isFinite) ||
      !Number.isFinite(value.modelMae) || !Number.isFinite(value.naiveLastValueMae) ||
      !/^[a-f0-9]{64}$/i.test(value.sourceSha256 || '')) {
    throw new Error('Forecast artifact lacks measured holdout evidence');
  }
  return {
    status: 'evaluated_offline',
    message: `Offline TimesFM 3.0 holdout: ${value.forecast.length} points; model MAE ${value.modelMae.toFixed(2)}, last-value baseline MAE ${value.naiveLastValueMae.toFixed(2)}. Historical evaluation only, not a live corridor forecast.`,
  };
}
