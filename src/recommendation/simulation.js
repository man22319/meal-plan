// ══════════════════════════════════════════
// SIMULATION — Counterfactual Solver Simulator
// ══════════════════════════════════════════
// Evaluates candidate actions against a baseline MILP solve on isolated in-memory state clones.
// Guarantees 100% immutability of original application state.

import { solveModel } from '../core/solver.js';
import { PRECISION } from '../core/precision.js';

/**
 * Deep clones an application state payload.
 * @param {object} state - Application state to clone.
 * @returns {object} Isolated clone.
 */
export function cloneState(state) {
  if (!state || typeof state !== 'object') return {};
  return JSON.parse(JSON.stringify(state));
}

/**
 * Applies a candidate action mutation to an isolated in-memory state clone.
 * @param {object} stateClone - In-memory cloned state.
 * @param {object} candidate - Candidate action descriptor.
 */
export function applyCandidateToState(stateClone, candidate) {
  if (!stateClone || !candidate) return;

  if (candidate.type === 'RESTOCK') {
    const ing = stateClone.ingredients?.find(i =>
      i.id === candidate.ingredientId || i.name === candidate.ingredientName
    );
    if (ing) {
      ing.availability = candidate.to;
    } else {
      console.warn(`RESTOCK candidate ingredient not found: ${candidate.ingredientName} (id: ${candidate.ingredientId})`);
    }
  } else if (candidate.type === 'INCREASE_CAPACITY' || candidate.type === 'REDUCE_CAPACITY') {
    const ing = stateClone.ingredients?.find(i =>
      i.id === candidate.ingredientId || i.name === candidate.ingredientName
    );
    if (ing) {
      ing.maxServings = Number(candidate.to);
    } else {
      console.warn(`${candidate.type} candidate ingredient not found: ${candidate.ingredientName} (id: ${candidate.ingredientId})`);
    }
  } else if (candidate.type === 'ADD_INGREDIENT') {
    if (!stateClone.ingredients) stateClone.ingredients = [];
    const newIng = JSON.parse(JSON.stringify(candidate.candidateData || candidate.mutation?.ingredient));
    if (newIng) {
      stateClone.ingredients.push(newIng);
    }
  }
}

/**
 * Simulates the Continuous LP Relaxation of a candidate action to compute a rigorous lower bound.
 *
 * Mathematical Contract (Continuous LP Relaxation of Minimization MILP):
 *   Since continuous LP is a relaxation of discrete MILP:
 *     J*_LP <= J*_MILP
 *   Therefore, the maximum possible improvement achievable by the candidate is bounded:
 *     ΔJ_MILP = J_B - J*_MILP <= J_B - J*_LP = ΔJ_max
 *   Consequently, if ΔJ_max < ε_J, then ΔJ_MILP < ε_J is mathematically guaranteed.
 *   This provides a provably safe pruning condition:
 *     ΔJ_max < ε_J => PRUNE (candidate cannot achieve meaningful improvement in Stage 3 exact solve).
 *
 * @param {object} baseState - Base application state.
 * @param {object} candidate - Candidate action descriptor.
 * @param {object} baseSolve - Baseline MILP solve result.
 * @param {number} [minThreshold] - Objective improvement pruning threshold.
 * @returns {object} { feasible, lowerBound, maxPossibleImprovement, pruned, reason, lpSolve, effectiveThreshold }
 */
export function simulateCandidateLPBound(baseState, candidate, baseSolve, minThreshold = null) {
  const clonedState = cloneState(baseState);
  applyCandidateToState(clonedState, candidate);

  const lpSolve = solveModel(clonedState, { validate: false, relaxIntegrality: true });

  if (!lpSolve || !lpSolve.feasible || !lpSolve.result) {
    return {
      feasible: false,
      lowerBound: Infinity,
      maxPossibleImprovement: -Infinity,
      pruned: true,
      reason: 'LP_INFEASIBLE',
      effectiveThreshold: minThreshold ?? PRECISION.PRUNING_EPS,
      lpSolve: null
    };
  }

  const lowerBound = typeof lpSolve.objective === 'number' ? lpSolve.objective : Infinity;
  const baseObj = typeof baseSolve.objective === 'number' ? baseSolve.objective : 0;
  const maxPossibleImprovement = baseObj - lowerBound;

  // Exact mathematical contract: prune only if the theoretical upper bound on improvement
  // is strictly below the declared minimum meaningful improvement threshold.
  const isCapacityType = ['INCREASE_CAPACITY', 'REDUCE_CAPACITY'].includes(candidate?.type);
  const defaultThreshold = isCapacityType ? PRECISION.OBJECTIVE_CAPACITY_EPS : PRECISION.PRUNING_EPS;
  const effectiveThreshold = typeof minThreshold === 'number' ? minThreshold : defaultThreshold;
  const pruned = maxPossibleImprovement < effectiveThreshold;

  return {
    feasible: true,
    lowerBound,
    maxPossibleImprovement,
    pruned,
    reason: pruned ? 'BOUND_BELOW_THRESHOLD' : null,
    effectiveThreshold,
    lpSolve
  };
}

/**
 * Simulates a single candidate action against a baseline solution using the 2-stage solver cascade
 * (Stage 2 LP Lower Bound -> Stage 3 Exact MILP).
 *
 * @param {object} baseState - Original application state (never mutated).
 * @param {object} candidate - Candidate action descriptor.
 * @param {object} [baselineSolve] - Precomputed baseline solve result.
 * @param {object} [options] - Simulation options (minThreshold).
 * @returns {object} Simulation metrics and candidate evaluation result.
 */
export function simulateCandidate(baseState, candidate, baselineSolve = null, options = {}) {
  const baseSolve = baselineSolve || solveModel(baseState, { validate: false });
  const targets = baseState.targets || { calories: 2000, protein: 150, carbs: 200, fat: 60 };
  const minThreshold = typeof options.minThreshold === 'number' ? options.minThreshold : null;

  // Initialize Stage 1 metadata if not already attached
  if (!candidate.stage1) {
    candidate.stage1 = {
      directionalMagnitude: 0,
      cosineAlignment: 0,
      geometricScore: 0,
      passed: true
    };
  }

  // ── Stage 2: Continuous LP Relaxation Bound ─────────────────────────
  const lpBound = simulateCandidateLPBound(baseState, candidate, baseSolve, minThreshold);

  candidate.stage2 = {
    evaluated: true,
    feasible: lpBound.feasible,
    lowerBound: lpBound.lowerBound,
    maxPossibleImprovement: lpBound.maxPossibleImprovement,
    pruned: lpBound.pruned,
    reason: lpBound.reason,
    effectiveThreshold: lpBound.effectiveThreshold
  };

  // If Stage 2 bound proves the candidate cannot achieve sufficient improvement, skip Stage 3 exact solve
  if (lpBound.pruned) {
    candidate.stage3 = {
      evaluated: false,
      feasible: false,
      objective: Infinity,
      exactImprovement: -Infinity,
      integralityGapAbs: 0,
      integralityGapRel: 0,
      prunedByBound: true
    };

    const pruneReasonDetails = lpBound.reason === 'LP_INFEASIBLE'
      ? 'Continuous LP relaxation was infeasible'
      : `LP upper bound on improvement ΔJ_max = ${lpBound.maxPossibleImprovement.toFixed(6)} < threshold ${lpBound.effectiveThreshold.toFixed(6)}`;

    candidate.rejectionReason = {
      code: 'LP_PRUNED',
      details: pruneReasonDetails
    };

    return {
      candidate,
      feasible: lpBound.feasible,
      pruned: true,
      pruneStage: 'stage2_lp_bound',
      pruneReason: lpBound.reason,
      rejectionReason: candidate.rejectionReason,
      lowerBound: lpBound.lowerBound,
      maxPossibleImprovement: lpBound.maxPossibleImprovement,
      relaxationGap: 0,
      integralityGapAbs: 0,
      integralityGapRel: 0,
      objectiveBefore: baseSolve.objective,
      objectiveAfter: lpBound.lowerBound,
      objectiveImprovement: lpBound.maxPossibleImprovement,
      calorieErrorBefore: Math.abs(baseSolve.result?.deviations?.calories?.absolute ?? 0),
      calorieErrorAfter: Infinity,
      calorieImprovement: -Infinity,
      proteinErrorBefore: Math.abs(baseSolve.result?.deviations?.protein?.absolute ?? 0),
      proteinErrorAfter: Infinity,
      proteinImprovement: -Infinity,
      carbErrorBefore: Math.abs(baseSolve.result?.deviations?.carbs?.absolute ?? 0),
      carbErrorAfter: Infinity,
      carbImprovement: -Infinity,
      fatErrorBefore: Math.abs(baseSolve.result?.deviations?.fat?.absolute ?? 0),
      fatErrorAfter: Infinity,
      fatImprovement: -Infinity,
      normalizedMacroImprovements: { calories: -Infinity, protein: -Infinity, carbs: -Infinity, fat: -Infinity },
      totalNormalizedMacroImprovement: -Infinity,
      mealsImproved: 0,
      ingredientUsed: false,
      isMeaningful: false,
      result: null
    };
  }

  // ── Stage 3: Exact Discrete MILP Solve ─────────────────────────────
  const clonedState = cloneState(baseState);
  applyCandidateToState(clonedState, candidate);

  const candSolve = solveModel(clonedState, { validate: false, relaxIntegrality: false });
  const macros = ['calories', 'protein', 'carbs', 'fat'];

  // Handle infeasible exact solve
  if (!candSolve || !candSolve.feasible || !candSolve.result) {
    candidate.stage3 = {
      evaluated: true,
      feasible: false,
      objective: Infinity,
      exactImprovement: -Infinity,
      integralityGapAbs: Infinity,
      integralityGapRel: Infinity,
      prunedByBound: false
    };

    candidate.rejectionReason = {
      code: 'EXACT_INFEASIBLE',
      details: 'Stage 3 exact discrete MILP solve was infeasible'
    };

    return {
      candidate,
      feasible: false,
      pruned: false,
      rejectionReason: candidate.rejectionReason,
      lowerBound: lpBound.lowerBound,
      maxPossibleImprovement: lpBound.maxPossibleImprovement,
      relaxationGap: Infinity,
      integralityGapAbs: Infinity,
      integralityGapRel: Infinity,
      objectiveBefore: baseSolve.objective,
      objectiveAfter: Infinity,
      objectiveImprovement: -Infinity,
      calorieErrorBefore: Math.abs(baseSolve.result?.deviations?.calories?.absolute ?? 0),
      calorieErrorAfter: Infinity,
      calorieImprovement: -Infinity,
      proteinErrorBefore: Math.abs(baseSolve.result?.deviations?.protein?.absolute ?? 0),
      proteinErrorAfter: Infinity,
      proteinImprovement: -Infinity,
      carbErrorBefore: Math.abs(baseSolve.result?.deviations?.carbs?.absolute ?? 0),
      carbErrorAfter: Infinity,
      carbImprovement: -Infinity,
      fatErrorBefore: Math.abs(baseSolve.result?.deviations?.fat?.absolute ?? 0),
      fatErrorAfter: Infinity,
      fatImprovement: -Infinity,
      normalizedMacroImprovements: { calories: -Infinity, protein: -Infinity, carbs: -Infinity, fat: -Infinity },
      totalNormalizedMacroImprovement: -Infinity,
      mealsImproved: 0,
      ingredientUsed: false,
      isMeaningful: false,
      result: null
    };
  }

  // Calculate optimization objective delta (ΔJ = J_base - J_cand)
  const objBefore = baseSolve.objective;
  const objAfter = candSolve.objective;
  const objImprovement = objBefore - objAfter;
  const integralityGapAbs = Math.max(0, objAfter - lpBound.lowerBound);
  const integralityGapRel = integralityGapAbs / Math.max(Math.abs(objAfter), PRECISION.NUMERICAL_ZERO_EPS);

  candidate.stage3 = {
    evaluated: true,
    feasible: true,
    objective: objAfter,
    exactImprovement: objImprovement,
    relaxationGap: integralityGapAbs,
    integralityGapAbs,
    integralityGapRel
  };

  // Macro deviations and improvements
  const baseDevs = baseSolve.result?.deviations || {};
  const candDevs = candSolve.result?.deviations || {};

  const macroMetrics = {};
  const normImprovements = {};
  let totalNormImprovement = 0;

  macros.forEach(m => {
    const errBefore = Math.abs(baseDevs[m]?.absolute ?? 0);
    const errAfter = Math.abs(candDevs[m]?.absolute ?? 0);
    const improvement = errBefore - errAfter;
    const tgt = targets[m] > 0 ? targets[m] : 100;
    const normImp = improvement / tgt;

    macroMetrics[m] = {
      before: errBefore,
      after: errAfter,
      improvement
    };
    normImprovements[m] = normImp;
    totalNormImprovement += normImp;
  });

  // Calculate meal allocation improvements
  let mealsImproved = 0;
  const baseMeals = baseSolve.result?.mealResults || [];
  const candMeals = candSolve.result?.mealResults || [];

  baseMeals.forEach((bm, idx) => {
    const cm = candMeals[idx];
    if (!cm) return;
    const baseMealDev = Math.abs(bm.calDeviation || 0);
    const candMealDev = Math.abs(cm.calDeviation || 0);
    if (candMealDev < baseMealDev - 0.5) {
      mealsImproved++;
    }
  });

  // Check if candidate ingredient was actively utilized in the solved candidate meal plan
  let ingredientUsed = false;
  candMeals.forEach(m => {
    (m.items || []).forEach(it => {
      if ((candidate.ingredientId && it.id === candidate.ingredientId) ||
          (candidate.ingredientName && it.name === candidate.ingredientName)) {
        if (it.servings > PRECISION.SERVING_MIN_EPS || it.quantity > PRECISION.MACRO_MATERIALITY_EPS) {
          ingredientUsed = true;
        }
      }
    });
  });

  const isMeaningful = (objImprovement > PRECISION.OBJECTIVE_CAPACITY_EPS) || (totalNormImprovement > PRECISION.SERVING_MIN_EPS);

  return {
    candidate,
    feasible: true,
    pruned: false,
    lowerBound: lpBound.lowerBound,
    maxPossibleImprovement: lpBound.maxPossibleImprovement,
    relaxationGap: integralityGapAbs,
    integralityGapAbs,
    integralityGapRel,
    objectiveBefore: objBefore,
    objectiveAfter: objAfter,
    objectiveImprovement: objImprovement,
    calorieErrorBefore: macroMetrics.calories.before,
    calorieErrorAfter: macroMetrics.calories.after,
    calorieImprovement: macroMetrics.calories.improvement,
    proteinErrorBefore: macroMetrics.protein.before,
    proteinErrorAfter: macroMetrics.protein.after,
    proteinImprovement: macroMetrics.protein.improvement,
    carbErrorBefore: macroMetrics.carbs.before,
    carbErrorAfter: macroMetrics.carbs.after,
    carbImprovement: macroMetrics.carbs.improvement,
    fatErrorBefore: macroMetrics.fat.before,
    fatErrorAfter: macroMetrics.fat.after,
    fatImprovement: macroMetrics.fat.improvement,
    normalizedMacroImprovements: normImprovements,
    totalNormalizedMacroImprovement: totalNormImprovement,
    mealsImproved,
    ingredientUsed,
    isMeaningful,
    result: candSolve.result
  };
}

/**
 * Evaluates an array of candidates sequentially against the baseline state.
 * @param {object} baseState - Application state.
 * @param {Array<object>} candidates - List of candidate actions.
 * @param {object} [baselineSolve] - Optional precomputed baseline solve.
 * @param {object} [options] - Options (minThreshold).
 * @returns {Array<object>} List of evaluated simulation outcomes.
 */
export function simulateCandidates(baseState, candidates, baselineSolve = null, options = {}) {
  const baseSolve = baselineSolve || solveModel(baseState, { validate: false });
  const results = [];

  for (const candidate of candidates) {
    const simResult = simulateCandidate(baseState, candidate, baseSolve, options);
    results.push(simResult);
  }

  return results;
}

/**
 * Async version of simulateCandidates that yields to the event loop between solves
 * to prevent the browser UI from freezing.
 * @param {object} baseState - Application state.
 * @param {Array<object>} candidates - List of candidate actions.
 * @param {object} [baselineSolve] - Optional precomputed baseline solve.
 * @param {function} [onProgress] - Optional callback(completed, total) called after each solve.
 * @param {object} [options] - Options (minThreshold).
 * @returns {Promise<Array<object>>} List of evaluated simulation outcomes.
 */
export async function simulateCandidatesAsync(baseState, candidates, baselineSolve = null, onProgress = null, options = {}) {
  const baseSolve = baselineSolve || solveModel(baseState, { validate: false });
  const results = [];
  const total = candidates.length;

  for (let i = 0; i < total; i++) {
    const simResult = simulateCandidate(baseState, candidates[i], baseSolve, options);
    results.push(simResult);

    if (onProgress) onProgress(i + 1, total);

    // Yield to the event loop every candidate so the browser stays responsive
    if (i < total - 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return results;
}


