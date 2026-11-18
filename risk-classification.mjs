// Pure synthetic risk-event assessment. Thresholds are illustrative, not calibrated probabilities.
export const RULE_VERSION = '1.0.0';
export const EVENT_CLASSES = Object.freeze([
  'confirmed_incident', 'confirmed_hazardous_condition', 'emerging_hazard',
  'compound_predictive_risk', 'unverified_anomaly',
]);
export const COMPOUND_THRESHOLDS = Object.freeze({
  wet: { rain: 2, volume: 1500, speed: 60, curve: 0.5, history: 0.5 },
  queue: { queue: 1, fast: 60, slow: 30, volume: 1500 },
  ice: { air: 0, surface: 0, moisture: 0.5 },
  visibility: { visibility: 150, speed: 60, volume: 1000 },
  works: { queue: 1, speed: 50, volume: 1200 },
});
const MEASURE = Object.freeze({
  confirm: ['collision_report', 'incident_confirmation'], water: ['road_surface_condition', 'water_depth'],
  rain: ['rainfall', 'rain_rate'], volume: ['traffic_volume', 'vehicle_count'],
  speed: ['traffic_speed', 'speed'], queue: ['traffic_congestion', 'queue_length'],
  curve: ['road_geometry', 'wet_curve_exposure'], history: ['historical_road_safety_characteristic', 'wet_collision_vulnerability'],
  air: ['temperature', 'air_temperature'], surface: ['road_surface_condition', 'surface_temperature'],
  moisture: ['road_surface_condition', 'moisture_indicator'], visibility: ['visibility', 'visibility_range'],
  works: ['roadworks', 'works_active'], minor: ['traffic_flow_anomaly', 'minor_flow_variation'],
});
const BLOCKING_QUALITY = new Set(['invalid', 'stale', 'duplicate', 'degraded', 'conflicting', 'unverified', 'future', 'missing_critical_information']);
const number = o => o?.normalisedMeasurement?.status === 'compatible'
  ? o.normalisedMeasurement.normalizedValue : NaN;
const groupCount = obs => new Set(obs.map(o => o.independenceGroup)).size;
function usableEvidence(correlation) {
  if (!correlation || !Array.isArray(correlation.included)) throw new TypeError('correlation required');
  return correlation.included.map(e => e.observation || e).filter(o =>
    o?.isSynthetic === true && o.provenanceType === 'synthetic_scenario_input' &&
    ![...(Array.isArray(o.qualityStatus) ? o.qualityStatus : [o.qualityStatus])].some(q => BLOCKING_QUALITY.has(q)));
}
function unverifiedReports(correlation) {
  return correlation.included.map(e => e.observation || e).filter(o =>
    o?.isSynthetic === true && o.provenanceType === 'synthetic_scenario_input' &&
    o.observationCategory === 'collision_report' && o.measurementType === 'incident_report' &&
    number(o) === 1 && o.qualityStatus === 'unverified');
}
function series(obs, key) {
  const [category, type] = MEASURE[key];
  return obs.filter(o => o.observationCategory === category &&
    o.normalisedMeasurement?.status === 'compatible' &&
    o.normalisedMeasurement.normalizedType === type)
    .sort((a,b) => Date.parse(a.observedAt)-Date.parse(b.observedAt) || a.observationId.localeCompare(b.observationId));
}
const last = (obs,key) => series(obs,key).at(-1) || null;
function authority(o) {
  return o?.metadata?.confirmationAuthority?.type === 'synthetic_controller' &&
    o.metadata.confirmationAuthority.confirmedWithinSimulation === true &&
    o.metadata.confirmationScope === 'simulation_only';
}
function build(correlation, { classification, subtype, ruleId, title, evidence, why, severity='moderate',
  urgency, confirmed=false, horizon=null, actions=['Review supporting synthetic evidence'] }) {
  if (!evidence?.length || evidence.some(o => !o)) throw new TypeError('complete evidence required');
  const distinct = [...new Map(evidence.map(o => [o.observationId,o])).values()];
  const independence = groupCount(distinct);
  const matchLevels = correlation.included.filter(e => distinct.some(o => o.observationId === e.observationId)).map(e => e.matchLevel);
  const provisional = !matchLevels.length || matchLevels.includes('provisional_proximity');
  const relevantPairs = new Set(distinct.map(o => `${o.observationCategory}:${o.measurementType}`));
  const conflicting = correlation.included.map(e => e.observation || e).filter(o =>
    o.qualityStatus === 'conflicting' && relevantPairs.has(`${o.observationCategory}:${o.measurementType}`));
  const band = conflicting.length ? 'limited_within_simulation' :
    independence >= 6 && provisional ? 'corroborated_within_simulation' :
    independence >= 3 && !provisional ? 'strong_within_simulation' :
    independence >= 2 ? 'moderate_within_simulation' : 'limited_within_simulation';
  const from = distinct.reduce((a,b) => Date.parse(a.observedAt) < Date.parse(b.observedAt) ? a : b).observedAt;
  const until = distinct.reduce((a,b) => Date.parse(a.validUntil) > Date.parse(b.validUntil) ? a : b).validUntil;
  const evidenceReferences = distinct.map(o => o.observationId);
  const measurementEvidence = distinct.map(o => ({ observationId: o.observationId,
    originalValue: o.normalisedMeasurement.originalValue,
    originalUnit: o.normalisedMeasurement.originalUnit,
    normalizedValue: o.normalisedMeasurement.normalizedValue,
    normalizedUnit: o.normalisedMeasurement.normalizedUnit,
    normalizedType: o.normalisedMeasurement.normalizedType,
    intervalMinutes: o.normalisedMeasurement.measurementIntervalMinutes,
    derivation: o.normalisedMeasurement.derivation }));
  const conversions = measurementEvidence.filter(item => item.derivation && item.derivation !== 'direct');
  return { schemaVersion:'1.0.0', classification, hazardSubtype:subtype, title,
    description:'Fictional, simulation-only road-safety assessment.', location:correlation.scope,
    timeWindow:{from,until}, assessmentAt:correlation.assessmentAt, evidenceReferences,
    supportingEvidence:evidenceReferences, conflictingEvidence:conflicting.map(o=>o.observationId),
    measurementEvidence,
    confirmationState:confirmed ? 'confirmed_within_simulation' : classification === 'unverified_anomaly' ? 'unverified' : 'not_confirmed',
    severity, evidenceConfidence:{ band, observation:'synthetic_fixture_only',
      geographicAssociation:provisional ? 'provisional' : 'mapped_or_exact',
      classification:band, predictedOutcome:'not_calibrated',
      explanation:`${independence} independent synthetic groups; ${provisional ? 'provisional' : 'mapped or exact'} geography. ${conflicting.length ? `${conflicting.length} relevant conflicting record(s) reduce support. ` : ''}No probability is claimed.` },
    operationalUrgency:urgency || (classification === 'emerging_hazard' ? 'monitor' : severity === 'critical' ? 'urgent_review' : 'review'),
    predictionHorizon:horizon, ruleId, ruleVersion:RULE_VERSION,
    explanation:`${why} ${conversions.length ? `${conversions.length} measurement(s) converted from their recorded units using explicit conversion rules; originals remain in evidence. ` : ''}${conflicting.length ? 'Relevant conflicting evidence reduces confidence without confirming or dismissing the event. ' : ''}All evidence is synthetic; no actual Dublin event or calibrated probability is claimed.`,
    recommendedActions:actions, isSynthetic:true, scenarioId:distinct[0].scenarioId };
}
function compound(out, correlation, id, subtype, title, factors, why, minGroups=2, urgency='review') {
  if (factors.some(o => !o) || groupCount(factors) < minGroups) return;
  out.push(build(correlation,{classification:'compound_predictive_risk',ruleId:id,subtype,title,evidence:factors,
    why, severity:'high',urgency,horizon:'next_30_simulated_minutes',
    actions:['Review source coverage and conditions','Consider proportionate preventive measures in an authorised trial']}));
}
export function assessClassifications(correlation) {
  const obs=usableEvidence(correlation), out=[];
  const confirmed=last(obs,'confirm');
  const resolved=correlation.included.map(e=>e.observation || e).some(o =>
    o?.observationCategory === 'collision_report' && o.measurementType === 'incident_resolution' &&
    number(o) === 1 && authority(o));
  if (confirmed && !resolved && number(confirmed)===1 && authority(confirmed))
    out.push(build(correlation,{classification:'confirmed_incident',subtype:'collision',ruleId:'SIM-COLLISION',
      title:confirmed.metadata?.simulatedImpact === 'minor_property_damage_only' ?
        'Fictional minor collision confirmed within simulation' : 'Fictional collision confirmed within simulation',
      evidence:[confirmed],confirmed:true,
      severity:confirmed.metadata?.simulatedImpact === 'minor_property_damage_only' ? 'low' : 'high',
      why:'An explicit synthetic-controller confirmation is present. Two unverified reports alone cannot confirm a collision.'}));
  const water=last(obs,'water');
  if (water && number(water)>=20 && authority(water))
    out.push(build(correlation,{classification:'confirmed_hazardous_condition',subtype:'standing_water',
      ruleId:'SIM-WATER',title:'Fictional standing-water hazard confirmed within simulation',
      evidence:[water],confirmed:true,why:`Synthetic road water depth ${number(water)} mm meets an illustrative 20 mm threshold and has explicit simulated field confirmation. Regional rain alone cannot establish road flooding.`}));
  const rain=series(obs,'rain'), recent=rain.slice(-3);
  if (recent.length===3 && number(recent[2])>=2 && number(recent[2])-number(recent[0])>=2 &&
      number(recent[0])<number(recent[1]) && number(recent[1])<number(recent[2]))
    out.push(build(correlation,{classification:'emerging_hazard',subtype:'increasing_rainfall',ruleId:'SIM-RAIN-TREND',
      title:'Fictional rainfall deterioration',evidence:recent,
      why:`Three synthetic rain rates rise ${recent.map(number).join(' → ')} mm/h. Road-surface impact is unverified.`,
      urgency:'monitor',actions:['Monitor subsequent observations']}));
  const speeds=series(obs,'speed');
  const speedCollapse=speeds.length>=2 && number(speeds[0])-number(speeds.at(-1))>=40;
  if (speedCollapse)
    out.push(build(correlation,{classification:'unverified_anomaly',subtype:'speed_collapse',ruleId:'SIM-SPEED-ANOMALY',
      title:'Fictional unexplained speed collapse',evidence:[speeds[0],speeds.at(-1)],severity:'high',
      why:`Synthetic speed fell from ${number(speeds[0])} to ${number(speeds.at(-1))} km/h. Cause is unverified.`,
      actions:['Request verification','Inspect independent traffic evidence']}));
  const minor=last(obs,'minor');
  if (minor && number(minor)>=0 && number(minor)<0.25)
    out.push(build(correlation,{classification:'unverified_anomaly',subtype:'minor_flow_variation',
      ruleId:'SIM-MINOR-FLOW',title:'Fictional minor flow variation retained as information',
      evidence:[minor],severity:'low',urgency:'informational',
      why:`A synthetic dimensionless flow-variation index of ${number(minor)} is below an illustrative 0.25 information-only threshold; no incident or actionable hazard is asserted.`,
      actions:['Retain as context','No simulated deployment is indicated']}));
  if (!speedCollapse && !confirmed && !resolved) {
    const report=unverifiedReports(correlation).at(-1);
    if (report)
      out.push(build(correlation,{classification:'unverified_anomaly',subtype:'collision',
        ruleId:'SIM-UNVERIFIED-REPORT',title:'Fictional unverified collision report',evidence:[report],
        severity:'high',why:'One unverified fictional report is available; no authorised confirmation exists.',
        actions:['Request verification']}));
  }
  const t=COMPOUND_THRESHOLDS, volume=last(obs,'volume'), speed=last(obs,'speed');
  const curve=last(obs,'curve'), history=last(obs,'history'), wet=[last(obs,'rain'),volume,speed,curve,history];
  if(wet.every(Boolean) && number(wet[0])>=t.wet.rain && number(volume)>=t.wet.volume &&
     number(speed)>=t.wet.speed && number(curve)>=t.wet.curve && number(history)>=t.wet.history)
    {
      const otherRain=series(obs,'rain').filter(o => o.observationId !== wet[0].observationId &&
        o.independenceGroup !== wet[0].independenceGroup).at(-1);
      const evidence=otherRain ? [...wet,otherRain] : wet;
      const urgent=number(wet[0])>=5;
      compound(out,correlation,'SIM-COMPOUND-WET','wet_weather_collision','Fictional wet-weather collision risk',evidence,
        'Rain, traffic, speed, road characteristics and historical vulnerability meet an illustrative conjunction rule. ' +
        (urgent ? 'At least 5 mm/h synthetic rainfall intensity raises human-review urgency without changing severity. ' :
          'Rainfall intensity remains below the illustrative urgent-review trigger. ') +
        'Hydroplaning is not asserted.',3,urgent ? 'urgent_review' : 'review');
    }
  const queue=last(obs,'queue'), fast=speeds.find(o=>number(o)>=t.queue.fast), slow=speeds.findLast(o=>number(o)<=t.queue.slow);
  if(queue && fast && slow && volume && number(queue)>=t.queue.queue && number(volume)>=t.queue.volume)
    compound(out,correlation,'SIM-COMPOUND-QUEUE','queue_end_collision','Fictional queue-end collision risk',
      [queue,fast,slow,volume],'Queue, upstream/downstream speed difference and traffic volume meet an illustrative conjunction rule.');
  const air=last(obs,'air'), surface=last(obs,'surface'), moisture=last(obs,'moisture');
  if(air && surface && moisture && number(air)<=t.ice.air && number(surface)<=t.ice.surface && number(moisture)>=t.ice.moisture)
    compound(out,correlation,'SIM-COMPOUND-ICE','ice_collision','Fictional ice-related collision risk',
      [air,surface,moisture],'Below-freezing air and surface temperatures plus moisture meet an illustrative rule; road ice is not confirmed.');
  const visibility=last(obs,'visibility');
  if(visibility && speed && volume && number(visibility)<=t.visibility.visibility &&
     number(speed)>=t.visibility.speed && number(volume)>=t.visibility.volume)
    compound(out,correlation,'SIM-COMPOUND-VISIBILITY','low_visibility_collision','Fictional low-visibility collision risk',
      [visibility,speed,volume],'Visibility, speed and volume meet an illustrative conjunction rule.');
  const works=last(obs,'works');
  if(works && queue && speed && volume && number(works)===1 && number(queue)>=t.works.queue &&
     number(speed)>=t.works.speed && number(volume)>=t.works.volume)
    compound(out,correlation,'SIM-COMPOUND-WORKS','roadworks_collision','Fictional roadworks-related collision risk',
      [works,queue,speed,volume],'Fictional works, queue, speed and volume meet an illustrative conjunction rule; no real works are asserted.');
  return out;
}
