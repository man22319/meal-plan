// ══════════════════════════════════════════
// SCORING & RANKING — Multi-metric Ranking & Dominance Pruning
// ══════════════════════════════════════════

const EPSILON_OBJ = 1e-4;
const EPSILON_TOL = 1e-2;
const EPSILON_STRICT_MACRO = 1e-2;

const ACTION_TYPE_PRIORITY = {
  REDUCE_CAPACITY: 1,
  RESTOCK: 2,
  INCREASE_CAPACITY: 3,
  ADD_INGREDIENT: 4
};

/**
 * Checks whether a simulation result is eligible for recommendation.
 * Requires the candidate to actually be utilized in the solution and to provide
 * meaningful improvement (avoiding fractional LP penalty jitter like 0.00001).
 *
 * @param {object} simResult - Simulation outcome.
 * @returns {boolean} True if candidate is feasible and provides meaningful positive improvement.
 */
export function isCandidateEligible(simResult) {
  if (!simResult || !simResult.feasible || !simResult.candidate || simResult.pruned) {
    return false;
  }

  // 1. The ingredient must actually be used in the meal plan (if evaluated)
  // For capacity reductions, the ingredient might not be used in the new solution but still provides value
  if (simResult.ingredientUsed === false &&
      !['INCREASE_CAPACITY', 'REDUCE_CAPACITY'].includes(simResult.candidate?.type)) {
    return false;
  }

  // 2. Meaningful threshold: Must provide a real improvement (>= 0.0001 ΔJ or >= 0.1% macro improvement)
  const MIN_OBJ_IMPROVEMENT = 0.0001;
  const MIN_MACRO_IMPROVEMENT = 0.001;

  const improvesObjective = (simResult.objectiveImprovement || 0) >= MIN_OBJ_IMPROVEMENT;
  const improvesMacros = (simResult.totalNormalizedMacroImprovement || 0) >= MIN_MACRO_IMPROVEMENT;

  // Also check if any single macro deviation improved directly (lowered thresholds)
  const improvesAnyMacroDirect =
    (simResult.calorieImprovement || 0) >= 0.5 ||
    (simResult.proteinImprovement || 0) >= 0.1 ||
    (simResult.carbImprovement || 0) >= 0.1 ||
    (simResult.fatImprovement || 0) >= 0.1;

  // For capacity modifications, use lower thresholds since they expand/contract feasible region
  if (['INCREASE_CAPACITY', 'REDUCE_CAPACITY'].includes(simResult.candidate?.type)) {
    const MIN_OBJ_CAPACITY = 0.00001; // Much lower threshold for capacity changes
    const improvesObjectiveCapacity = (simResult.objectiveImprovement || 0) >= MIN_OBJ_CAPACITY;
    return improvesObjectiveCapacity || improvesMacros || improvesAnyMacroDirect;
  }

  return improvesObjective || improvesMacros || improvesAnyMacroDirect;
}


/**
 * Checks whether Candidate A is mathematically dominated by Candidate B.
 * Candidate A is dominated by B if B achieves:
 * 1. ΔJ_B >= ΔJ_A (equal or better objective improvement)
 * 2. I_{m,B} >= I_{m,A} for all tracked macros (calories, protein, carbs, fat) within numerical tolerance
 * 3. At least one strict inequality.
 *
 * @param {object} simA - Candidate A simulation outcome.
 * @param {object} simB - Candidate B simulation outcome.
 * @returns {boolean} True if Candidate A is dominated by Candidate B.
 */
export function isCandidateDominated(simA, simB) {
  if (!simA || !simB || !simA.feasible || !simB.feasible) {
    return false;
  }

  const deltaJ_A = simA.objectiveImprovement;
  const deltaJ_B = simB.objectiveImprovement;

  // Condition 1: ΔJ_B >= ΔJ_A
  if (deltaJ_B < deltaJ_A - EPSILON_TOL) {
    return false;
  }

  // Condition 2: I_{m, B} >= I_{m, A} for all tracked macros
  const macros = ['calories', 'protein', 'carbs', 'fat'];
  const impA = [
    simA.calorieImprovement || 0,
    simA.proteinImprovement || 0,
    simA.carbImprovement || 0,
    simA.fatImprovement || 0
  ];
  const impB = [
    simB.calorieImprovement || 0,
    simB.proteinImprovement || 0,
    simB.carbImprovement || 0,
    simB.fatImprovement || 0
  ];

  for (let i = 0; i < macros.length; i++) {
    if (impB[i] < impA[i] - EPSILON_TOL) {
      return false;
    }
  }

  // Condition 3: At least one strict inequality
  const strictObj = deltaJ_B > deltaJ_A + EPSILON_OBJ;
  let strictMacro = false;
  for (let i = 0; i < macros.length; i++) {
    if (impB[i] > impA[i] + EPSILON_STRICT_MACRO) {
      strictMacro = true;
      break;
    }
  }

  return strictObj || strictMacro;
}

/**
 * Prunes dominated candidates from a collection of candidate simulation results.
 * @param {Array<object>} eligibleResults - List of eligible simulation results.
 * @returns {Array<object>} Filtered list with all dominated candidates removed.
 */
export function pruneDominatedCandidates(eligibleResults) {
  if (!Array.isArray(eligibleResults) || eligibleResults.length === 0) {
    return [];
  }

  const nonDominated = [];

  for (let i = 0; i < eligibleResults.length; i++) {
    const candidateA = eligibleResults[i];
    let dominated = false;

    for (let j = 0; j < eligibleResults.length; j++) {
      if (i === j) continue;
      const candidateB = eligibleResults[j];
      if (isCandidateDominated(candidateA, candidateB)) {
        dominated = true;
        break;
      }
    }

    if (!dominated) {
      nonDominated.push(candidateA);
    }
  }

  return nonDominated;
}

/**
 * Generates a deduplication key from the counterfactual result vector.
 * Candidates targeting the same ingredient that produce identical solver outcomes
 * (within tolerance) are considered duplicates — only the minimal action is kept.
 */
function resultDeduplicationKey(sim) {
  const ingId = sim.candidate?.ingredientId || sim.candidate?.ingredientName || '';
  const dj = Math.round(sim.objectiveImprovement * 1e4);
  const dc = Math.round((sim.calorieImprovement || 0) * 10);
  const dp = Math.round((sim.proteinImprovement || 0) * 10);
  const dk = Math.round((sim.carbImprovement || 0) * 10);
  const df = Math.round((sim.fatImprovement || 0) * 10);
  return `${ingId}|${dj}|${dc}|${dp}|${dk}|${df}`;
}

/**
 * Deduplicates candidates that produce identical counterfactual outcomes.
 * When two candidates for the same ingredient yield the same ΔJ and macro deltas,
 * keeps the one with the smallest transition (minimal action principle).
 */
function deduplicateByResult(candidates) {
  const seen = new Map();
  for (const sim of candidates) {
    const key = resultDeduplicationKey(sim);
    if (!seen.has(key)) {
      seen.set(key, sim);
    } else {
      // Keep the minimal action: prefer lower 'to' value (smallest sufficient change)
      const existing = seen.get(key);
      const existingTo = typeof existing.candidate?.to === 'number' ? existing.candidate.to : Infinity;
      const currentTo = typeof sim.candidate?.to === 'number' ? sim.candidate.to : Infinity;
      if (currentTo < existingTo) {
        seen.set(key, sim);
      }
    }
  }
  return [...seen.values()];
}

/**
 * Ranks candidate simulations deterministically and returns the top recommendations.
 * Tie-breaker hierarchy:
 * 1. ΔJ (Objective improvement) descending
 * 2. Total normalized macro improvement descending
 * 3. Action simplicity (RESTOCK < INCREASE_CAPACITY < ADD_INGREDIENT)
 * 4. Deterministic Candidate ID string ascending
 *
 * @param {Array<object>} simulationResults - List of candidate simulation results.
 * @param {object} [options] - Options including limit (default: 10).
 * @returns {Array<object>} Ranked recommendations.
 */
export function rankRecommendations(simulationResults, options = {}) {
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 10;

  // 1. Filter eligible candidates
  const eligible = (simulationResults || []).filter(isCandidateEligible);

  // 2. Prune mathematically dominated candidates
  const nonDominated = pruneDominatedCandidates(eligible);

  // 3. Deduplicate candidates producing identical counterfactual outcomes
  const deduplicated = deduplicateByResult(nonDominated);

  // 4. Sort by deterministic tie-breakers
  const ranked = [...deduplicated].sort((a, b) => {
    // 1. Objective improvement (ΔJ) descending
    const diffObj = b.objectiveImprovement - a.objectiveImprovement;
    if (Math.abs(diffObj) > EPSILON_OBJ) {
      return diffObj;
    }

    // 2. Total normalized macro improvement descending
    const diffNorm = (b.totalNormalizedMacroImprovement || 0) - (a.totalNormalizedMacroImprovement || 0);
    if (Math.abs(diffNorm) > 1e-4) {
      return diffNorm;
    }

    // 3. Action type priority (RESTOCK first, then CAPACITY, then ADD)
    const prioA = ACTION_TYPE_PRIORITY[a.candidate?.type] || 99;
    const prioB = ACTION_TYPE_PRIORITY[b.candidate?.type] || 99;
    if (prioA !== prioB) {
      return prioA - prioB;
    }

    // 4. Deterministic candidate ID ascending
    const idA = String(a.candidate?.id || '');
    const idB = String(b.candidate?.id || '');
    return idA.localeCompare(idB);
  });

  return ranked.slice(0, limit);
}
