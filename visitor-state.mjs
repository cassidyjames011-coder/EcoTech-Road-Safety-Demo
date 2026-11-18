import {
  DECISION_CHOICES,
  OBSERVATORY_DECISION_CHOICES,
  RESPONSE_OPTION_IDS,
  validateObservatorySuite,
  validateScenario,
} from './scenario-contract.mjs';

function assertSession(session, scenario) {
  validateScenario(scenario);
  if (!session || session.scenarioId !== scenario.scenarioId || session.scenarioVersion !== scenario.scenarioVersion) {
    throw new TypeError('session does not match the reviewed scenario');
  }
}

export function createVisitorSession(scenario) {
  validateScenario(scenario);
  return Object.freeze({
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion,
    phase: 'reviewing',
    selectedOptionId: null,
    decision: null,
  });
}

export function selectResponseOption(session, scenario, optionId) {
  assertSession(session, scenario);
  if (!RESPONSE_OPTION_IDS.includes(optionId)) throw new TypeError('unknown response option');
  return Object.freeze({
    scenarioId: session.scenarioId,
    scenarioVersion: session.scenarioVersion,
    phase: 'comparing',
    selectedOptionId: optionId,
    decision: null,
  });
}

export function recordVisitorDecision(session, scenario, { choice, reasonId, modificationId = null } = {}) {
  assertSession(session, scenario);
  if (!DECISION_CHOICES.includes(choice)) throw new TypeError('unknown decision');
  if (!scenario.visitorDecision.justificationReasons.some(item => item.id === reasonId)) {
    throw new TypeError('select a reviewed justification');
  }
  if (choice !== 'defer' && !session.selectedOptionId) {
    throw new TypeError('select a response option first');
  }
  if (choice === 'modify') {
    if (!scenario.visitorDecision.modificationChoices.some(item => item.id === modificationId)) {
      throw new TypeError('select a reviewed modification');
    }
  } else if (modificationId !== null) {
    throw new TypeError('modification applies only to modify');
  }
  return Object.freeze({
    scenarioId: session.scenarioId,
    scenarioVersion: session.scenarioVersion,
    phase: 'decided',
    selectedOptionId: session.selectedOptionId,
    decision: Object.freeze({ choice, reasonId, modificationId }),
  });
}

export function restartScenario(session, scenario) {
  assertSession(session, scenario);
  return createVisitorSession(scenario);
}

export function startAnotherScenario(session, currentScenario, nextReviewedScenario) {
  assertSession(session, currentScenario);
  if (nextReviewedScenario.scenarioId === currentScenario.scenarioId) {
    throw new TypeError('restart the current scenario instead');
  }
  return createVisitorSession(nextReviewedScenario);
}

// --- Multi-Scenario Dublin Observatory Public Demo State Transitions ---

function assertObservatorySession(session, suite) {
  validateObservatorySuite(suite);
  if (!session || session.suiteId !== suite.suiteId || session.suiteVersion !== suite.suiteVersion) {
    throw new TypeError('session does not match the reviewed observatory suite');
  }
}

export function createObservatorySession(suite) {
  validateObservatorySuite(suite);
  return Object.freeze({
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    selectedScenarioId: null,
    selectedResponseId: null,
    decisions: Object.freeze({}),
  });
}

export function hydrateObservatorySession(suite, persistedDecisions = {}) {
  validateObservatorySuite(suite);
  const cleanDecisions = {};
  if (persistedDecisions && typeof persistedDecisions === 'object' && !Array.isArray(persistedDecisions)) {
    for (const scen of suite.scenarios) {
      const entry = persistedDecisions[scen.id];
      if (entry && typeof entry === 'object' && OBSERVATORY_DECISION_CHOICES.includes(entry.decision)) {
        const resp = scen.responses.find(r => r.id === entry.responseId) || scen.responses[0];
        const reason = suite.decisionReasons.includes(entry.reason) ? entry.reason : suite.decisionReasons[0];
        cleanDecisions[scen.id] = Object.freeze({
          scenarioId: scen.id,
          scenarioTitle: scen.title,
          decision: entry.decision,
          responseId: resp.id,
          responseName: resp.name,
          reason,
          note: typeof entry.note === 'string' ? entry.note.slice(0, 240) : '',
          timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '00:00',
        });
      }
    }
  }
  return Object.freeze({
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    selectedScenarioId: null,
    selectedResponseId: null,
    decisions: Object.freeze(cleanDecisions),
  });
}

export function selectObservatoryScenario(session, suite, scenarioId) {
  assertObservatorySession(session, suite);
  const scen = suite.scenarios.find(s => s.id === scenarioId);
  if (!scen) throw new TypeError('unknown observatory scenario');
  const prior = session.decisions[scen.id];
  const selectedResponseId = prior ? prior.responseId : scen.responses[0].id;
  return Object.freeze({
    suiteId: session.suiteId,
    suiteVersion: session.suiteVersion,
    selectedScenarioId: scen.id,
    selectedResponseId,
    decisions: session.decisions,
  });
}

export function closeObservatoryScenario(session, suite) {
  assertObservatorySession(session, suite);
  return Object.freeze({
    suiteId: session.suiteId,
    suiteVersion: session.suiteVersion,
    selectedScenarioId: null,
    selectedResponseId: null,
    decisions: session.decisions,
  });
}

export function selectObservatoryResponse(session, suite, responseId) {
  assertObservatorySession(session, suite);
  if (!session.selectedScenarioId) throw new TypeError('select a scenario first');
  const scen = suite.scenarios.find(s => s.id === session.selectedScenarioId);
  if (!scen || !scen.responses.some(r => r.id === responseId)) {
    throw new TypeError('unknown response option for selected scenario');
  }
  return Object.freeze({
    suiteId: session.suiteId,
    suiteVersion: session.suiteVersion,
    selectedScenarioId: session.selectedScenarioId,
    selectedResponseId: responseId,
    decisions: session.decisions,
  });
}

export function recordObservatoryDecision(
  session,
  suite,
  { decision, reason, note = '', timestamp = '12:00' } = {}
) {
  assertObservatorySession(session, suite);
  if (!session.selectedScenarioId) throw new TypeError('select a scenario first');
  if (!OBSERVATORY_DECISION_CHOICES.includes(decision)) throw new TypeError('unknown observatory decision');
  const scen = suite.scenarios.find(s => s.id === session.selectedScenarioId);
  const activeResp = scen.responses.find(r => r.id === session.selectedResponseId) || scen.responses[0];
  const validReason = suite.decisionReasons.includes(reason) ? reason : suite.decisionReasons[0];
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 240) : '';

  const nextDecisions = {
    ...session.decisions,
    [scen.id]: Object.freeze({
      scenarioId: scen.id,
      scenarioTitle: scen.title,
      decision,
      responseId: activeResp.id,
      responseName: activeResp.name,
      reason: validReason,
      note: cleanNote,
      timestamp: String(timestamp || '12:00'),
    }),
  };

  return Object.freeze({
    suiteId: session.suiteId,
    suiteVersion: session.suiteVersion,
    selectedScenarioId: scen.id,
    selectedResponseId: activeResp.id,
    decisions: Object.freeze(nextDecisions),
  });
}

export function resetObservatorySession(session, suite) {
  assertObservatorySession(session, suite);
  const currentScen = session.selectedScenarioId
    ? suite.scenarios.find(s => s.id === session.selectedScenarioId)
    : null;
  return Object.freeze({
    suiteId: session.suiteId,
    suiteVersion: session.suiteVersion,
    selectedScenarioId: currentScen ? currentScen.id : null,
    selectedResponseId: currentScen ? currentScen.responses[0].id : null,
    decisions: Object.freeze({}),
  });
}
