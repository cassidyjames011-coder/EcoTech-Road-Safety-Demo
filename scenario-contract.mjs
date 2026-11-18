export const CONTRACT_VERSION = '1.0.0';
export const EVIDENCE_KINDS = Object.freeze([
  'real_geography',
  'public_observation',
  'synthetic_behavioural_input',
  'prototype_risk_output',
]);
export const RESPONSE_OPTION_IDS = Object.freeze([
  'visible_patrol',
  'gosafe_proposal',
  'roads_policing_proposal',
  'engineering_assessment',
  'gather_evidence',
]);
export const DECISION_CHOICES = Object.freeze(['accept', 'modify', 'reject', 'defer']);

// Multi-scenario Dublin Observatory Public Demo Suite extension (4 provisional Dublin scenarios)
export const OBSERVATORY_SCENARIO_IDS = Object.freeze([
  'DEMO-SCEN-01',
  'DEMO-SCEN-02',
  'DEMO-SCEN-03',
  'DEMO-SCEN-04',
]);
export const OBSERVATORY_DECISION_CHOICES = Object.freeze([
  'Accepted',
  'Modified',
  'Rejected',
  'Deferred',
]);

function fail(path, reason) {
  throw new TypeError(`${path}: ${reason}`);
}

function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'non-empty text required');
}

function textList(value, path) {
  if (!Array.isArray(value) || !value.length) fail(path, 'non-empty list required');
  value.forEach((item, index) => text(item, `${path}[${index}]`));
}

function exactIds(actual, expected, path) {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
      new Set(actual).size !== expected.length || expected.some(id => !actual.includes(id))) {
    fail(path, 'required IDs are missing, duplicated, or unexpected');
  }
}

export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) fail('scenario', 'object required');
  if (scenario.contractVersion !== CONTRACT_VERSION) fail('contractVersion', 'unsupported version');
  if (typeof scenario.scenarioId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario.scenarioId)) {
    fail('scenarioId', 'stable slug required');
  }
  if (typeof scenario.scenarioVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(scenario.scenarioVersion)) {
    fail('scenarioVersion', 'semantic version required');
  }
  text(scenario.title, 'title');
  if (typeof scenario.referenceAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(scenario.referenceAt) ||
      Number.isNaN(Date.parse(scenario.referenceAt)) ||
      new Date(scenario.referenceAt).toISOString().replace('.000Z', 'Z') !== scenario.referenceAt) {
    fail('referenceAt', 'UTC timestamp required');
  }
  const location = scenario.location;
  if (!location || typeof location !== 'object') fail('location', 'object required');
  text(location.label, 'location.label');
  if (location.city !== 'Dublin' || location.country !== 'Ireland') fail('location', 'Dublin, Ireland required');
  if (location.boundaryStatus !== 'illustrative_demo_only' || location.isOfficialGardaBoundary !== false) {
    fail('location.boundaryStatus', 'must disclaim official boundary');
  }
  text(location.geographyEvidenceId, 'location.geographyEvidenceId');
  text(location.boundaryExplanation, 'location.boundaryExplanation');

  if (!Array.isArray(scenario.evidence) || scenario.evidence.length < EVIDENCE_KINDS.length) {
    fail('evidence', 'all provenance categories required');
  }
  const evidenceIds = new Set();
  const kinds = new Set();
  scenario.evidence.forEach((item, index) => {
    const path = `evidence[${index}]`;
    if (!item || typeof item !== 'object') fail(path, 'object required');
    text(item.id, `${path}.id`);
    if (evidenceIds.has(item.id)) fail(`${path}.id`, 'duplicate');
    evidenceIds.add(item.id);
    if (!EVIDENCE_KINDS.includes(item.kind)) fail(`${path}.kind`, 'unknown provenance category');
    kinds.add(item.kind);
    text(item.title, `${path}.title`);
    text(item.statement, `${path}.statement`);
    if (!item.source || typeof item.source !== 'object') fail(`${path}.source`, 'object required');
    text(item.source.name, `${path}.source.name`);
    if (item.source.url !== null && (typeof item.source.url !== 'string' || !/^https:\/\//.test(item.source.url))) {
      fail(`${path}.source.url`, 'HTTPS URL or null required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || Number.isNaN(Date.parse(item.date))) {
      fail(`${path}.date`, 'calendar date required');
    }
    if (!['accessed', 'authored'].includes(item.dateBasis)) fail(`${path}.dateBasis`, 'unknown date basis');
    text(item.provenance, `${path}.provenance`);
    textList(item.limitations, `${path}.limitations`);
    const isInvented = ['synthetic_behavioural_input', 'prototype_risk_output'].includes(item.kind);
    if (item.synthetic !== isInvented) fail(`${path}.synthetic`, 'must match provenance category');
    if (isInvented && item.source.url !== null) fail(`${path}.source.url`, 'synthetic item must not imply an external source');
    if (!isInvented && item.source.url === null) fail(`${path}.source.url`, 'public source required');
    if (item.kind === 'public_observation' && item.locationSpecific !== false) {
      fail(`${path}.locationSpecific`, 'national context must not imply local observation');
    }
  });
  EVIDENCE_KINDS.forEach(kind => {
    if (!kinds.has(kind)) fail('evidence', `missing ${kind}`);
  });
  const geography = scenario.evidence.find(item => item.id === location.geographyEvidenceId);
  if (!geography || geography.kind !== 'real_geography') fail('location.geographyEvidenceId', 'real geography item required');

  if (!Array.isArray(scenario.responseOptions)) fail('responseOptions', 'list required');
  exactIds(scenario.responseOptions.map(option => option?.id), RESPONSE_OPTION_IDS, 'responseOptions');
  scenario.responseOptions.forEach((option, index) => {
    const path = `responseOptions[${index}]`;
    text(option.label, `${path}.label`);
    text(option.purpose, `${path}.purpose`);
    textList(option.supportingEvidenceIds, `${path}.supportingEvidenceIds`);
    option.supportingEvidenceIds.forEach(id => {
      if (!evidenceIds.has(id)) fail(`${path}.supportingEvidenceIds`, 'unknown evidence ID');
    });
    textList(option.drawbacks, `${path}.drawbacks`);
    textList(option.missingInformation, `${path}.missingInformation`);
    textList(option.evaluationRequirements, `${path}.evaluationRequirements`);
    text(option.authorityNote, `${path}.authorityNote`);
  });

  const decision = scenario.visitorDecision;
  if (!decision || typeof decision !== 'object') fail('visitorDecision', 'object required');
  exactIds(decision.choices, DECISION_CHOICES, 'visitorDecision.choices');
  if (decision.justificationRequired !== true || decision.modificationChoiceRequired !== true || decision.freeTextAllowed !== false) {
    fail('visitorDecision', 'fixed justification and modification rules required');
  }
  for (const key of ['justificationReasons', 'modificationChoices']) {
    const items = decision[key];
    if (!Array.isArray(items) || !items.length) fail(`visitorDecision.${key}`, 'non-empty list required');
    const ids = new Set();
    items.forEach((item, index) => {
      const path = `visitorDecision.${key}[${index}]`;
      text(item?.id, `${path}.id`);
      text(item?.label, `${path}.label`);
      if (ids.has(item.id)) fail(`${path}.id`, 'duplicate');
      ids.add(item.id);
    });
  }
  if (!Array.isArray(scenario.participation)) fail('participation', 'list required');
  exactIds(scenario.participation.map(item => item?.id), ['garda', 'tii', 'rsa', 'insurance', 'general_visitor'], 'participation');
  scenario.participation.forEach((item, index) => {
    const path = `participation[${index}]`;
    text(item.evaluationRole, `${path}.evaluationRole`);
    textList(item.potentialDataInputs, `${path}.potentialDataInputs`);
    textList(item.accessConditions, `${path}.accessConditions`);
    text(item.nonCommitment, `${path}.nonCommitment`);
  });
  for (const key of ['noLogin', 'noBackendCredentials', 'noOperationalApi', 'noSharedWrites',
    'noActualDispatch', 'noOffenceProcessing', 'noLiveAi', 'noVisitorPersonalData']) {
    if (scenario.constraints?.[key] !== true) fail(`constraints.${key}`, 'must be true');
  }
  return true;
}

function validateDublinCoordPair(coord, path) {
  if (!Array.isArray(coord) || coord.length !== 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
    fail(path, '[lat, lng] numeric pair required');
  }
  if (coord[0] < 53.15 || coord[0] > 53.50 || coord[1] < -6.55 || coord[1] > -6.05) {
    fail(path, 'coordinates must lie within Greater Dublin reference bounds');
  }
}

export function validateObservatoryScenario(scen, index = 0) {
  const path = `scenarios[${index}]`;
  if (!scen || typeof scen !== 'object' || Array.isArray(scen)) fail(path, 'object required');
  if (!OBSERVATORY_SCENARIO_IDS.includes(scen.id)) fail(`${path}.id`, 'must be one of DEMO-SCEN-01..04');
  text(scen.shortLabel, `${path}.shortLabel`);
  text(scen.theme, `${path}.theme`);
  text(scen.title, `${path}.title`);
  text(scen.locationShort, `${path}.locationShort`);
  if (scen.city !== 'Dublin' || scen.country !== 'Ireland') fail(`${path}.location`, 'Dublin, Ireland required');
  if (scen.provisionalSetting !== true) fail(`${path}.provisionalSetting`, 'must be marked provisional');
  if (scen.dbMapping !== 'Unassigned') fail(`${path}.dbMapping`, 'database mapping must remain Unassigned unless verified');
  if (scen.isSurveyedOrRoadSnapped !== false) {
    fail(`${path}.isSurveyedOrRoadSnapped`, 'approximate geometry must not claim surveyed or 1:1 road-snapped status');
  }
  text(scen.geometryDisclosure, `${path}.geometryDisclosure`);
  text(scen.roadCorridorLabel, `${path}.roadCorridorLabel`);
  validateDublinCoordPair(scen.center, `${path}.center`);
  if (!Array.isArray(scen.approximateWaypoints) || scen.approximateWaypoints.length < 2) {
    fail(`${path}.approximateWaypoints`, 'at least 2 corridor waypoints required');
  }
  scen.approximateWaypoints.forEach((pt, ptIdx) => validateDublinCoordPair(pt, `${path}.approximateWaypoints[${ptIdx}]`));

  if (typeof scen.chanceAdjustedConfidence !== 'number' || scen.chanceAdjustedConfidence <= 0 || scen.chanceAdjustedConfidence >= 1) {
    fail(`${path}.chanceAdjustedConfidence`, 'illustrative index in (0, 1) required');
  }
  text(scen.confidenceLabel, `${path}.confidenceLabel`);
  text(scen.uncertaintyRange, `${path}.uncertaintyRange`);
  if (!/illustrative|not statistically validated/i.test(scen.uncertaintyRange)) {
    fail(`${path}.uncertaintyRange`, 'must explicitly state illustrative / not statistically validated');
  }
  text(scen.counterfactualNote, `${path}.counterfactualNote`);
  textList(scen.publicReferenceContext, `${path}.publicReferenceContext`);
  textList(scen.syntheticScenarioInputs, `${path}.syntheticScenarioInputs`);

  text(scen.chartTitle, `${path}.chartTitle`);
  textList(scen.chartLabels, `${path}.chartLabels`);
  text(scen.chartReferenceLabel, `${path}.chartReferenceLabel`);
  text(scen.chartSyntheticLabel, `${path}.chartSyntheticLabel`);
  if (!Array.isArray(scen.chartReferenceData) || scen.chartReferenceData.length !== scen.chartLabels.length) {
    fail(`${path}.chartReferenceData`, 'must match chartLabels length');
  }
  if (!Array.isArray(scen.chartSyntheticData) || scen.chartSyntheticData.length !== scen.chartLabels.length) {
    fail(`${path}.chartSyntheticData`, 'must match chartLabels length');
  }

  if (!Array.isArray(scen.responses) || scen.responses.length !== 3) {
    fail(`${path}.responses`, '3 response options required');
  }
  const respIds = new Set();
  scen.responses.forEach((resp, rIdx) => {
    const rPath = `${path}.responses[${rIdx}]`;
    text(resp?.id, `${rPath}.id`);
    if (respIds.has(resp.id)) fail(`${rPath}.id`, 'duplicate response id');
    respIds.add(resp.id);
    text(resp.name, `${rPath}.name`);
    text(resp.tier, `${rPath}.tier`);
    text(resp.expectedEffect, `${rPath}.expectedEffect`);
    text(resp.displacementRisk, `${rPath}.displacementRisk`);
    text(resp.safeguardNote, `${rPath}.safeguardNote`);
  });
  return true;
}

export function validateObservatorySuite(suite) {
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)) fail('suite', 'object required');
  if (suite.contractVersion !== CONTRACT_VERSION) fail('contractVersion', 'unsupported version');
  text(suite.suiteId, 'suiteId');
  text(suite.suiteVersion, 'suiteVersion');
  text(suite.title, 'title');
  if (suite.provisionalStatus !== 'provisional_pending_owner_review') {
    fail('provisionalStatus', 'provisional_pending_owner_review required');
  }
  validateDublinCoordPair(suite.overviewCenter, 'overviewCenter');
  if (!suite.externalFeeds || typeof suite.externalFeeds !== 'object') fail('externalFeeds', 'object required');
  for (const feedKey of ['tii', 'met']) {
    const feed = suite.externalFeeds[feedKey];
    if (!feed || feed.configured !== false || feed.status !== 'not_connected') {
      fail(`externalFeeds.${feedKey}`, 'must remain not_connected and configured: false unless separately verified');
    }
  }
  exactIds(suite.decisionChoices, OBSERVATORY_DECISION_CHOICES, 'decisionChoices');
  textList(suite.decisionReasons, 'decisionReasons');
  for (const key of ['noLogin', 'noBackendCredentials', 'noOperationalApi', 'noSharedWrites',
    'noActualDispatch', 'noOffenceProcessing', 'noLiveAi']) {
    if (suite.constraints?.[key] !== true) fail(`constraints.${key}`, 'must be true');
  }
  if (!Array.isArray(suite.scenarios)) fail('scenarios', 'list required');
  exactIds(suite.scenarios.map(s => s?.id), OBSERVATORY_SCENARIO_IDS, 'scenarios');
  suite.scenarios.forEach((scen, idx) => validateObservatoryScenario(scen, idx));
  return true;
}
