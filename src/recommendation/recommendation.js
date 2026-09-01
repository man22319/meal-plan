// ══════════════════════════════════════════
// RECOMMENDATION — Orchestrator & Action Application
// ══════════════════════════════════════════

import { generateStateFingerprint, ensureId } from '../core/state.js';
import { solveModel, Optimization } from '../core/solver.js';
import { Persistence } from '../io/persistence.js';
import { generateCandidates } from './candidates.js';
import { simulateCandidates, simulateCandidatesAsync } from './simulation.js';
import { rankRecommendations } from './scoring.js';

function formatResult(ranked, stateFingerprint, baselineSolve, candidateCount, allSimResults = []) {
  const formattedRecommendations = ranked.map(r => ({
    id: r.candidate.id,
    type: r.candidate.type,
    ingredientId: r.candidate.ingredientId,
    ingredientName: r.candidate.ingredientName,
    label: r.candidate.label,
    from: r.candidate.from,
    to: r.candidate.to,
    mutation: r.candidate.mutation,
    candidateData: r.candidate.candidateData || null,
    lowerBound: r.lowerBound,
    maxPossibleImprovement: r.maxPossibleImprovement,
    relaxationGap: r.relaxationGap,
    objectiveBefore: r.objectiveBefore,
    objectiveAfter: r.objectiveAfter,
    objectiveImprovement: r.objectiveImprovement,
    calorieImprovement: r.calorieImprovement,
    proteinImprovement: r.proteinImprovement,
    carbImprovement: r.carbImprovement,
    fatImprovement: r.fatImprovement,
    totalNormalizedMacroImprovement: r.totalNormalizedMacroImprovement,
    mealsImproved: r.mealsImproved,
    ingredientUsed: r.ingredientUsed,
    stage1: r.candidate.stage1 || null,
    stage2: r.candidate.stage2 || null,
    stage3: r.candidate.stage3 || null,
    stateFingerprint
  }));

  const lpPrunedCount = allSimResults.filter(s => s.pruned).length;
  const exactSolvedCount = allSimResults.filter(s => s.candidate?.stage3?.evaluated).length;

  return {
    stateFingerprint,
    timestamp: Date.now(),
    candidatesEvaluated: candidateCount,
    auditTrail: {
      stage1Candidates: candidateCount,
      stage2LPEvaluated: allSimResults.length,
      stage2BoundPruned: lpPrunedCount,
      stage3ExactSolved: exactSolvedCount,
      eligibleRecommendations: ranked.length
    },
    baselineSummary: {
      feasible: baselineSolve.feasible,
      objective: baselineSolve.objective,
      totals: baselineSolve.result?.totals || null,
      deviations: baselineSolve.result?.deviations || null
    },
    recommendations: formattedRecommendations,
    rawSimulations: allSimResults
  };
}

/**
 * Runs end-to-end counterfactual analysis and generates top recommendations (synchronous).
 * @param {object} state - Application state.
 * @param {object} [options] - Options (limit, candidatePool).
 * @returns {object} Recommendation analysis result including fingerprint and ranked recommendations.
 */
export function getRecommendations(state, options = {}) {
  const stateFingerprint = generateStateFingerprint(state);
  const baselineSolve = solveModel(state, { validate: false });

  const candidates = generateCandidates(state, { ...options, baselineSolve });
  const simResults = simulateCandidates(state, candidates, baselineSolve, options);
  const ranked = rankRecommendations(simResults, options);

  return formatResult(ranked, stateFingerprint, baselineSolve, candidates.length, simResults);
}

/**
 * Async version of getRecommendations that yields to the event loop between solves.
 * Prevents the browser UI from freezing during analysis.
 * @param {object} state - Application state.
 * @param {object} [options] - Options (limit, candidatePool, onProgress).
 * @returns {Promise<object>} Recommendation analysis result.
 */
export async function getRecommendationsAsync(state, options = {}) {
  const stateFingerprint = generateStateFingerprint(state);
  console.log('Recommendation analysis - State fingerprint:', stateFingerprint);

  const baselineSolve = solveModel(state, { validate: false });
  console.log('Recommendation analysis - Baseline solve:', {
    feasible: baselineSolve.feasible,
    objective: baselineSolve.objective,
    hasResult: !!baselineSolve.result
  });

  const candidates = generateCandidates(state, { ...options, baselineSolve });
  console.log('Recommendation analysis - Candidates generated:', candidates.length);

  const simResults = await simulateCandidatesAsync(
    state, candidates, baselineSolve, options.onProgress || null, options
  );
  console.log('Recommendation analysis - Simulation results:', {
    total: simResults.length,
    feasible: simResults.filter(r => r.feasible).length,
    pruned: simResults.filter(r => r.pruned).length
  });

  const ranked = rankRecommendations(simResults, options);
  console.log('Recommendation analysis - Ranked recommendations:', ranked.length);

  return formatResult(ranked, stateFingerprint, baselineSolve, candidates.length, simResults);
}



/**
 * Safely applies a recommendation to application state with fingerprint staleness validation.
 * @param {object} targetState - State to mutate.
 * @param {object} recommendation - Recommendation object to apply.
 * @param {object} [options] - Options (autoSolve: boolean, autoPersist: boolean).
 * @returns {object} Application outcome ({ success, error, newFingerprint }).
 */
export function applyRecommendation(targetState, recommendation, options = {}) {
  if (!targetState || !recommendation) {
    return {
      success: false,
      error: 'INVALID_ARGUMENTS',
      message: 'State and recommendation objects are required.'
    };
  }

  // Fingerprint freshness check
  const currentFp = generateStateFingerprint(targetState);
  if (recommendation.stateFingerprint && recommendation.stateFingerprint !== currentFp) {
    return {
      success: false,
      error: 'STALE_FINGERPRINT',
      message: 'Recommendation was generated against a previous state. Please re-analyze before applying.'
    };
  }

  // Apply state mutation
  if (recommendation.type === 'RESTOCK') {
    const ing = targetState.ingredients?.find(i =>
      i.id === recommendation.ingredientId || i.name === recommendation.ingredientName
    );
    if (!ing) {
      return { success: false, error: 'INGREDIENT_NOT_FOUND', message: `Ingredient ${recommendation.ingredientName} not found in state.` };
    }
    ing.availability = recommendation.to;
  } else if (recommendation.type === 'INCREASE_CAPACITY' || recommendation.type === 'REDUCE_CAPACITY') {
    const ing = targetState.ingredients?.find(i =>
      i.id === recommendation.ingredientId || i.name === recommendation.ingredientName
    );
    if (!ing) {
      return { success: false, error: 'INGREDIENT_NOT_FOUND', message: `Ingredient ${recommendation.ingredientName} not found in state.` };
    }
    ing.maxServings = Number(recommendation.to);
  } else if (recommendation.type === 'ADD_INGREDIENT') {
    if (!targetState.ingredients) targetState.ingredients = [];
    const sourceIng = recommendation.candidateData || recommendation.mutation?.ingredient;
    if (!sourceIng) {
      return { success: false, error: 'MISSING_INGREDIENT_DATA', message: 'Candidate ingredient payload is missing.' };
    }
    const newIng = JSON.parse(JSON.stringify(sourceIng));
    ensureId(newIng, 'ing');
    targetState.ingredients.push(newIng);
  } else {
    return { success: false, error: 'UNKNOWN_TYPE', message: `Unknown recommendation type: ${recommendation.type}. Supported types: RESTOCK, INCREASE_CAPACITY, REDUCE_CAPACITY, ADD_INGREDIENT` };
  }

  // Re-solve
  if (options.autoSolve !== false && typeof Optimization !== 'undefined' && typeof Optimization.solve === 'function') {
    Optimization.solve({ preserveActuals: true });
  }

  // Persist
  if (options.autoPersist !== false && typeof Persistence !== 'undefined' && typeof Persistence.save === 'function') {
    Persistence.save();
  }

  const newFingerprint = generateStateFingerprint(targetState);
  return {
    success: true,
    state: targetState,
    newFingerprint
  };
}
