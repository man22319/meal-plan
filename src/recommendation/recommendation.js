// ══════════════════════════════════════════
// RECOMMENDATION — Orchestrator & Action Application
// ══════════════════════════════════════════

import { generateStateFingerprint, ensureId } from '../core/state.js';
import { solveModel, Optimization } from '../core/solver.js';
import { Persistence } from '../io/persistence.js';
import { generateCandidates } from './candidates.js';
import { simulateCandidates, simulateCandidatesAsync } from './simulation.js';
import { rankRecommendations, computeSigmoidScore } from './scoring.js';

function formatResult(ranked, stateFingerprint, baselineSolve, candidateCount, allSimResults = []) {
  const formattedRecommendations = ranked.map(r => {
    const rawDeltaJ = r.objectiveImprovement ?? 0;
    const sigmoidScore = computeSigmoidScore(rawDeltaJ);

    return {
      id: r.candidate.id,
      type: r.candidate.type,
      ingredientId: r.candidate.ingredientId,
      ingredientName: r.candidate.ingredientName,
      label: r.candidate.label,
      from: r.candidate.from,
      to: r.candidate.to,
      mutation: r.candidate.mutation,
      candidateData: r.candidate.candidateData || null,
      score: sigmoidScore,
      normalizedScore: sigmoidScore,
      lowerBound: r.lowerBound,
      maxPossibleImprovement: r.maxPossibleImprovement,
      relaxationGap: r.relaxationGap ?? 0,
      integralityGapAbs: r.integralityGapAbs ?? r.relaxationGap ?? 0,
      integralityGapRel: r.integralityGapRel ?? 0,
      objectiveBefore: r.objectiveBefore,
      objectiveAfter: r.objectiveAfter,
      objectiveImprovement: rawDeltaJ,
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
    };
  });

  const lpPrunedCount = allSimResults.filter(s => s.pruned).length;
  const exactSolvedCount = allSimResults.filter(s => s.candidate?.stage3?.evaluated).length;
  const winningRec = formattedRecommendations[0] || null;

  // Formulate natural language explainability
  let winnerExplanation = null;
  if (winningRec) {
    const macroDetails = [];
    if (Math.abs(winningRec.calorieImprovement || 0) >= 0.5) {
      macroDetails.push(`${(winningRec.calorieImprovement || 0) > 0 ? 'reduced' : 'shifted'} calorie error by ${Math.abs(winningRec.calorieImprovement || 0).toFixed(1)} kcal`);
    }
    if (Math.abs(winningRec.proteinImprovement || 0) >= 0.1) {
      macroDetails.push(`${(winningRec.proteinImprovement || 0) > 0 ? 'reduced' : 'shifted'} protein error by ${Math.abs(winningRec.proteinImprovement || 0).toFixed(1)}g`);
    }
    if (Math.abs(winningRec.carbImprovement || 0) >= 0.1) {
      macroDetails.push(`carb error by ${Math.abs(winningRec.carbImprovement || 0).toFixed(1)}g`);
    }
    if (Math.abs(winningRec.fatImprovement || 0) >= 0.1) {
      macroDetails.push(`fat error by ${Math.abs(winningRec.fatImprovement || 0).toFixed(1)}g`);
    }
    const macroStr = macroDetails.length > 0 ? ` (${macroDetails.join(', ')})` : '';
    const mealStr = winningRec.mealsImproved > 0 ? ` while improving balance across ${winningRec.mealsImproved} meal${winningRec.mealsImproved === 1 ? '' : 's'}` : '';

    winnerExplanation = `#1 ${winningRec.label} ranked first with the highest raw objective improvement (ΔJ = +${winningRec.objectiveImprovement.toFixed(6)}, impact score: ${(winningRec.normalizedScore * 100).toFixed(0)}%)${macroStr}${mealStr}.`;
  } else {
    winnerExplanation = 'No candidate actions produced a meaningful positive objective improvement over the current baseline state.';
  }

  // Formulate structured rejection reasons for all non-winning / pruned alternatives
  const winningId = winningRec?.id || null;
  const rejections = [];

  allSimResults.forEach(sim => {
    const cand = sim.candidate;
    if (!cand) return;
    if (cand.id === winningId) return;

    let stage = 'Unknown';
    let reasonCode = cand.rejectionReason?.code || 'REJECTED';
    let reasonDetails = cand.rejectionReason?.details || '';

    if (sim.pruned) {
      stage = 'Stage 2 (LP Relaxation Bound)';
      reasonCode = cand.rejectionReason?.code || 'LP_PRUNED';
      reasonDetails = cand.rejectionReason?.details || `Theoretical upper bound ΔJ_max = ${(sim.maxPossibleImprovement || 0).toFixed(6)} < threshold`;
    } else if (sim.feasible === false) {
      stage = 'Stage 3 (Exact MILP)';
      reasonCode = 'EXACT_INFEASIBLE';
      reasonDetails = 'Exact discrete optimization solve was infeasible';
    } else if (sim.ingredientUsed === false && !['INCREASE_CAPACITY', 'REDUCE_CAPACITY'].includes(cand.type)) {
      stage = 'Stage 3 (Eligibility)';
      reasonCode = 'UNUTILIZED';
      reasonDetails = 'Ingredient was not utilized in the solved meal plan (0 servings allocated)';
    } else if (reasonCode === 'DOMINATED') {
      stage = 'Scoring (Pareto Dominance)';
      reasonDetails = cand.rejectionReason?.details || 'Mathematically dominated by a superior candidate';
    } else if (reasonCode === 'DUPLICATE') {
      stage = 'Scoring (Deduplication)';
      reasonDetails = cand.rejectionReason?.details || 'Duplicate counterfactual outcome; superseded by minimal action';
    } else if (reasonCode === 'SUB_THRESHOLD') {
      stage = 'Scoring (Eligibility)';
      reasonDetails = cand.rejectionReason?.details || `Objective improvement ΔJ = ${(sim.objectiveImprovement || 0).toFixed(6)} below meaningful threshold`;
    } else {
      // Survived and eligible, but ranked lower than winner
      stage = 'Final Ranking';
      reasonCode = 'LOWER_OBJECTIVE_IMPROVEMENT';
      reasonDetails = `Achieved ΔJ = +${(sim.objectiveImprovement || 0).toFixed(6)} (lower than winning action ΔJ = +${(winningRec?.objectiveImprovement || 0).toFixed(6)})`;
    }

    rejections.push({
      candidateId: cand.id,
      label: cand.label,
      type: cand.type,
      stage,
      reasonCode,
      reasonDetails
    });
  });

  return {
    stateFingerprint,
    timestamp: Date.now(),
    candidatesEvaluated: candidateCount,
    auditTrail: {
      stage1Candidates: candidateCount,
      stage2LPEvaluated: allSimResults.length,
      stage2BoundPruned: lpPrunedCount,
      stage3ExactSolved: exactSolvedCount,
      eligibleRecommendations: ranked.length,
      winnerExplanation,
      rejections
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
  const baselineSolve = solveModel(state, { validate: false });
  const candidates = generateCandidates(state, { ...options, baselineSolve });

  const simResults = await simulateCandidatesAsync(
    state, candidates, baselineSolve, options.onProgress || null, options
  );

  const ranked = rankRecommendations(simResults, options);

  return formatResult(ranked, stateFingerprint, baselineSolve, candidates.length, simResults);
}

/**
 * Safely applies a recommendation to application state with fingerprint staleness validation.
 *
 * Transactional Invariant:
 *   1. Fingerprint is validated BEFORE any mutation (rejecting stale recommendations).
 *   2. State is mutated strictly according to the candidate specification.
 *   3. Solver re-solves on the mutated state.
 *   4. State is persisted and new fingerprint is returned.
 *
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

  // Fingerprint freshness check (MUST happen before any mutation)
  const currentFp = generateStateFingerprint(targetState);
  if (recommendation.stateFingerprint && recommendation.stateFingerprint !== currentFp) {
    return {
      success: false,
      error: 'STALE_FINGERPRINT',
      message: 'Recommendation was generated against a previous state. Please re-analyze before applying.'
    };
  }

  // Apply exact state mutation
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

  // Re-solve on the new mutated state
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
