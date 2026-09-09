// ══════════════════════════════════════════════════════════════════════
// GROCERY RECOMMENDATION: CONTEXTUAL MARGINAL VALUE + GREEDY SELECTOR
// ══════════════════════════════════════════════════════════════════════
// Replaces static score ranking and hard nutritional role quotas with a
// contextual marginal-value selector and greedy diversification engine.
// Evaluates candidates against current pantry inventory and dynamically
// selected basket contents.

import { resolveAvailability } from '../core/state.js';
import { solveModel } from '../core/solver.js';
import { PRECISION } from '../core/precision.js';

export const NUTRITIONAL_ROLES = {
  LEAN_PROTEIN: 'LEAN_PROTEIN',
  CLEAN_CARB: 'CLEAN_CARB',
  HEALTHY_FAT: 'HEALTHY_FAT',
  BALANCED_STAPLE: 'BALANCED_STAPLE'
};

export const ROLE_LABELS = {
  LEAN_PROTEIN: 'Protein Anchor',
  CLEAN_CARB: 'Carbohydrate Source',
  HEALTHY_FAT: 'Fat Source',
  BALANCED_STAPLE: 'Balanced Staple'
};

const DEFAULT_TARGETS = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 60
};

const DEFAULT_WEIGHTS = {
  calories: 1.0,
  protein: 1.0,
  carbs: 0.5,
  fat: 0.5
};

const EPS = PRECISION.NUMERICAL_ZERO_EPS;

// ══════════════════════════════════════════════════════════════════════
// BASIC HELPERS
// ══════════════════════════════════════════════════════════════════════

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getTargets(targets = {}) {
  return {
    calories: positiveNumber(targets.calories, DEFAULT_TARGETS.calories),
    protein: positiveNumber(targets.protein, DEFAULT_TARGETS.protein),
    carbs: positiveNumber(targets.carbs, DEFAULT_TARGETS.carbs),
    fat: positiveNumber(targets.fat, DEFAULT_TARGETS.fat)
  };
}

function getWeights(weights = {}) {
  return {
    calories: Number.isFinite(weights.calories) ? weights.calories : DEFAULT_WEIGHTS.calories,
    protein: Number.isFinite(weights.protein) ? weights.protein : DEFAULT_WEIGHTS.protein,
    carbs: Number.isFinite(weights.carbs) ? weights.carbs : DEFAULT_WEIGHTS.carbs,
    fat: Number.isFinite(weights.fat) ? weights.fat : DEFAULT_WEIGHTS.fat
  };
}

function getMacros(ingredient) {
  return {
    protein: Math.max(0, Number(ingredient?.protein) || 0),
    carbs: Math.max(0, Number(ingredient?.carbs) || 0),
    fat: Math.max(0, Number(ingredient?.fat) || 0)
  };
}

function getCalories(ingredient, macros = getMacros(ingredient)) {
  return Math.max(
    1,
    Number(ingredient?.calories) ||
      (macros.protein * 4 + macros.carbs * 4 + macros.fat * 9)
  );
}

function macroCalories(macros) {
  return {
    protein: macros.protein * 4,
    carbs: macros.carbs * 4,
    fat: macros.fat * 9
  };
}

function normalizedMacroVector(ingredient, targets) {
  const macros = getMacros(ingredient);
  return [
    macros.protein / Math.max(1, targets.protein),
    macros.carbs / Math.max(1, targets.carbs),
    macros.fat / Math.max(1, targets.fat)
  ];
}

function cosineSimilarity(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const normA = Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
  const normB = Math.sqrt(b[0] ** 2 + b[1] ** 2 + b[2] ** 2);

  if (normA <= EPS || normB <= EPS) return 0;
  return clamp(dot / (normA * normB), 0, 1);
}

function cloneState(state) {
  if (!state || typeof state !== 'object') return {};
  return JSON.parse(JSON.stringify(state));
}

// ══════════════════════════════════════════════════════════════════════
// ROLE DERIVATION (Metadata & Explainability Only)
// ══════════════════════════════════════════════════════════════════════

/**
 * Role is descriptive metadata only for labeling and explanations.
 * It does NOT determine recommendation eligibility or enforce category quotas.
 */
export function deriveNutritionalRole(ingredient) {
  const macros = getMacros(ingredient);
  const cals = macroCalories(macros);
  const totalMacroCalories = cals.protein + cals.carbs + cals.fat;

  if (totalMacroCalories <= EPS) {
    return NUTRITIONAL_ROLES.BALANCED_STAPLE;
  }

  const pRatio = cals.protein / totalMacroCalories;
  const cRatio = cals.carbs / totalMacroCalories;
  const fRatio = cals.fat / totalMacroCalories;

  const rawCalories = getCalories(ingredient, macros);
  const proteinDensity = macros.protein / rawCalories;

  if (pRatio >= 0.45 || proteinDensity >= 0.15) {
    return NUTRITIONAL_ROLES.LEAN_PROTEIN;
  }

  if (cRatio >= 0.55) {
    return NUTRITIONAL_ROLES.CLEAN_CARB;
  }

  if (fRatio >= 0.50) {
    return NUTRITIONAL_ROLES.HEALTHY_FAT;
  }

  return NUTRITIONAL_ROLES.BALANCED_STAPLE;
}

// ══════════════════════════════════════════════════════════════════════
// INTRINSIC PROFILE (Low-weight Tie-breaker)
// ══════════════════════════════════════════════════════════════════════

function getIntrinsicProfile(ingredient, _targets) {
  const macros = getMacros(ingredient);
  const calories = getCalories(ingredient, macros);
  const role = deriveNutritionalRole(ingredient);
  const cal = macroCalories(macros);
  const totalMacroCalories = cal.protein + cal.carbs + cal.fat;

  if (totalMacroCalories <= EPS) {
    return { score: 0, role };
  }

  const shares = [
    cal.protein / totalMacroCalories,
    cal.carbs / totalMacroCalories,
    cal.fat / totalMacroCalories
  ];
  const dominantShare = Math.max(...shares);
  const purity = clamp((dominantShare - 0.33) / 0.67);

  const proteinDensity = macros.protein / calories;
  const proteinDensityScore = clamp(proteinDensity / 0.20);

  const maxServings = positiveNumber(ingredient?.maxServings, 5);
  const portionCapacity = clamp(maxServings / 6);

  const score = purity * 0.45 + proteinDensityScore * 0.35 + portionCapacity * 0.20;

  return {
    score: clamp(score),
    role
  };
}

// ══════════════════════════════════════════════════════════════════════
// INVENTORY & MACRO REDUNDANCY
// ══════════════════════════════════════════════════════════════════════

function getInventoryItems(state = {}) {
  const ingredients = Array.isArray(state?.ingredients) ? state.ingredients : [];

  return ingredients.filter(ingredient => {
    const availability = resolveAvailability(ingredient?.availability);
    return ingredient?.isPoolItem !== true && availability !== 'out';
  });
}

/**
 * Evaluates macro-profile redundancy against pantry inventory AND dynamically
 * selected basket items.
 *
 * Weighting contract:
 * - Existing pantry overlap: moderate penalty (0.7x)
 * - Newly selected basket overlap: stronger penalty (1.0x) to enforce diminishing returns
 */
function getMacroRedundancy(candidate, inventory = [], selected = [], targets = DEFAULT_TARGETS) {
  const candidateVector = normalizedMacroVector(candidate, targets);

  let maxPantrySim = 0;
  for (const item of inventory) {
    const itemVector = normalizedMacroVector(item, targets);
    maxPantrySim = Math.max(maxPantrySim, cosineSimilarity(candidateVector, itemVector));
  }

  let maxSelectedSim = 0;
  for (const item of selected) {
    const itemVector = normalizedMacroVector(item, targets);
    maxSelectedSim = Math.max(maxSelectedSim, cosineSimilarity(candidateVector, itemVector));
  }

  const combinedRedundancy = Math.max(maxPantrySim * 0.70, maxSelectedSim * 1.00);
  return clamp(combinedRedundancy);
}

// ══════════════════════════════════════════════════════════════════════
// MACRO COMPLEMENTARITY (Heuristic Layer Proxy)
// ══════════════════════════════════════════════════════════════════════

function getMacroComplementarity(candidate, comparisonSet = [], targets = DEFAULT_TARGETS) {
  const candidateMacros = getMacros(candidate);
  const candidateVector = normalizedMacroVector(candidate, targets);

  const targetCoverage = [
    clamp(candidateMacros.protein / targets.protein),
    clamp(candidateMacros.carbs / targets.carbs),
    clamp(candidateMacros.fat / targets.fat)
  ];

  const rawCoverage =
    targetCoverage[0] * 0.50 +
    targetCoverage[1] * 0.30 +
    targetCoverage[2] * 0.20;

  if (!comparisonSet.length) {
    return clamp(rawCoverage);
  }

  let averageSimilarity = 0;
  for (const item of comparisonSet) {
    const itemVector = normalizedMacroVector(item, targets);
    averageSimilarity += cosineSimilarity(candidateVector, itemVector);
  }
  averageSimilarity /= Math.max(1, comparisonSet.length);

  return clamp(rawCoverage * (1 - averageSimilarity * 0.65));
  
}

// ══════════════════════════════════════════════════════════════════════
// AVAILABILITY / RESTOCK SIGNAL (Deterministic Tie-breaker)
// ══════════════════════════════════════════════════════════════════════

function getAvailabilityModifier(ingredient) {
  const rawAvail = ingredient?.availability;
  if (rawAvail === undefined && ingredient?.isPoolItem === true) {
    return {
      multiplier: 1.00,
      label: 'CANDIDATE'
    };
  }

  const availability = resolveAvailability(rawAvail);

  switch (availability) {
    case 'out':
      return {
        multiplier: 1.08,
        label: 'OUT → BUY'
      };
    case 'limited':
      return {
        multiplier: 1.05,
        label: 'LIMITED → STOCK UP'
      };
    case 'low':
      return {
        multiplier: 1.025,
        label: 'LOW → RESTOCK'
      };
    default:
      return {
        multiplier: 1.00,
        label: 'AVAILABLE'
      };
  }
}

// ══════════════════════════════════════════════════════════════════════
// FAST HEURISTIC MARGINAL UTILITY (Zero-Solver Fallback Layer)
// ══════════════════════════════════════════════════════════════════════

function getHeuristicMarginalUtility(ingredient, context = {}) {
  const targets = context.targets || DEFAULT_TARGETS;
  const inventory = context.inventory || [];
  const selected = context.selected || [];
  const comparisonSet = [...inventory, ...selected];

  const complementarity = getMacroComplementarity(ingredient, comparisonSet, targets);
  const macroRedundancy = getMacroRedundancy(ingredient, inventory, selected, targets);
  const intrinsic = getIntrinsicProfile(ingredient, targets).score;

  // Asymmetric weighting: complementarity primary, redundancy penalty, intrinsic tie-breaker
  const utility =
    complementarity * 0.60 +
    intrinsic * 0.20 +
    (1 - macroRedundancy) * 0.20;

  return clamp(utility);
}

// ══════════════════════════════════════════════════════════════════════
// LEGACY METRICS COMPATIBILITY HELPER
// ══════════════════════════════════════════════════════════════════════

function computeLegacyMetrics(ingredient, role, targets, weights, macros, calories) {
  let macroDensity = 0.5;
  if (role === NUTRITIONAL_ROLES.LEAN_PROTEIN) {
    macroDensity = Math.min(1.0, (macros.protein / calories) * 4.5);
  } else if (role === NUTRITIONAL_ROLES.CLEAN_CARB) {
    const cRatio = (macros.carbs * 4) / Math.max(1, calories);
    const lowFatBonus = Math.max(0, 1 - (macros.fat * 9) / Math.max(1, calories));
    macroDensity = Math.min(1.0, (cRatio * 0.7) + (lowFatBonus * 0.3));
  } else if (role === NUTRITIONAL_ROLES.HEALTHY_FAT) {
    const fRatio = (macros.fat * 9) / Math.max(1, calories);
    const portionManageable = macros.fat <= 18 ? 1.0 : Math.max(0.3, 1.0 - (macros.fat - 18) / 25);
    macroDensity = Math.min(0.85, fRatio * 0.8 * portionManageable);
  } else {
    macroDensity = 0.65;
  }

  const pYield = (macros.protein / targets.protein) * (targets.calories / Math.max(1, calories));
  const cYield = (macros.carbs / targets.carbs) * (targets.calories / Math.max(1, calories));
  const fYield = (macros.fat / targets.fat) * (targets.calories / Math.max(1, calories));
  const weightedYield = (pYield * 0.5 * weights.protein) + (cYield * 0.3 * weights.carbs) + (fYield * 0.2 * weights.fat);
  const targetCompatibility = Math.max(0.1, Math.min(1.0, weightedYield / 1.4));

  const calP = macros.protein * 4;
  const calC = macros.carbs * 4;
  const calF = macros.fat * 9;
  const totalCal = Math.max(1, calP + calC + calF);
  const maxShare = Math.max(calP / totalCal, calC / totalCal, calF / totalCal);
  const macroFlexibility = Math.min(1.0, Math.max(0.3, maxShare * 1.05));

  return {
    macroDensity: Math.round(macroDensity * 100) / 100,
    macroFlexibility: Math.round(macroFlexibility * 100) / 100,
    targetCompatibility: Math.round(targetCompatibility * 100) / 100
  };
}

// ══════════════════════════════════════════════════════════════════════
// PUBLIC SCORER
// ══════════════════════════════════════════════════════════════════════

/**
 * Scores an ingredient in the current grocery context.
 *
 * Supports two distinct modes:
 * - Solver mode: U = 0.90 ΔV + 0.07 (1 - R) + 0.03 I (avoids double-counting complementarity)
 * - Heuristic mode: U = 0.70 ΔV_heur + 0.12 C + 0.10 (1 - R) + 0.08 I
 */
export function scoreIngredientGroceryUtility(
  ingredient,
  targets = {},
  weights = {},
  state = {},
  context = {}
) {
  const tgts = getTargets(targets);
  const w = getWeights(weights);

  const availability = ingredient?.isPoolItem === true && ingredient.availability === undefined
    ? 'candidate'
    : resolveAvailability(ingredient?.availability);

  const role = deriveNutritionalRole(ingredient);
  const inventory = context.inventory || getInventoryItems(state);
  const selected = context.selected || [];
  const comparisonSet = [...inventory, ...selected];

  const intrinsic = getIntrinsicProfile(ingredient, tgts);
  const macroRedundancy = getMacroRedundancy(ingredient, inventory, selected, tgts);
  const complementarity = getMacroComplementarity(ingredient, comparisonSet, tgts);

  const marginalSource = context.marginalSource || 'heuristic';

  let marginalValue;
  if (Number.isFinite(context.marginalValue)) {
    marginalValue = clamp(context.marginalValue);
  } else {
    marginalValue = getHeuristicMarginalUtility(ingredient, {
      targets: tgts,
      weights: w,
      inventory,
      selected
    });
  }

  const availabilityInfo = getAvailabilityModifier(ingredient);

  let baseUtility;
  if (marginalSource === 'solver') {
    // Solver mode: Solver ΔV is primary; no double-counting of complementarity
    baseUtility =
      marginalValue * 0.90 +
      (1 - macroRedundancy) * 0.07 +
      intrinsic.score * 0.03;
  } else {
    // Heuristic mode: Fast nutritional proxy
    baseUtility =
      marginalValue * 0.70 +
      complementarity * 0.12 +
      (1 - macroRedundancy) * 0.10 +
      intrinsic.score * 0.08;
  }

  const finalScore = clamp(baseUtility) * availabilityInfo.multiplier * 100;
  const macros = getMacros(ingredient);
  const calories = getCalories(ingredient, macros);

  const reasons = [];
  if (marginalSource === 'solver') {
    reasons.push('Directly expands future meal-plan optimization space');
  } else {
    reasons.push('Adds useful planning capacity based on current pantry composition');
  }

  if (complementarity >= 0.65) {
    reasons.push('Strongly complements the current macro profile');
  }

  if (macroRedundancy >= 0.75) {
    reasons.push('Macro profile overlaps heavily with existing foods');
  } else if (macroRedundancy <= 0.30) {
    reasons.push('Adds a distinct, non-redundant macro profile');
  }

  if (availability === 'out') {
    reasons.push('Currently OUT OF STOCK in pantry');
  } else if (availability === 'limited') {
    reasons.push('Limited inventory cap');
  } else if (availability === 'low') {
    reasons.push('Low inventory cap');
  }

  const legacyMetrics = computeLegacyMetrics(ingredient, role, tgts, w, macros, calories);

  return {
    score: Math.round(finalScore * 10) / 10,
    baseUtility: Math.round(clamp(baseUtility) * 1000) / 10,
    role,
    roleLabel: ROLE_LABELS[role] || role,
    urgencyLabel: availabilityInfo.label,
    availability,
    reasons,
    metrics: {
      marginalValue: Math.round(marginalValue * 100) / 100,
      marginalSource,
      complementarity: Math.round(complementarity * 100) / 100,
      macroRedundancy: Math.round(macroRedundancy * 100) / 100,
      redundancy: Math.round(macroRedundancy * 100) / 100,
      intrinsicUtility: Math.round(intrinsic.score * 100) / 100,
      availabilityMultiplier: availabilityInfo.multiplier,
      calories: Math.round(calories),
      protein: Math.round(macros.protein),
      carbs: Math.round(macros.carbs),
      fat: Math.round(macros.fat),
      // Backward-compatible deprecated aliases
      ...legacyMetrics
    }
  };
}

// ══════════════════════════════════════════════════════════════════════
// CANDIDATE POOL NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

function getCandidateKey(ingredient, fallbackIndex = 0) {
  if (ingredient?.id) return `id:${ingredient.id}`;
  const normalizedName = String(ingredient?.name || '').trim().toLowerCase();
  return normalizedName ? `name:${normalizedName}` : `anon:${fallbackIndex}`;
}

function buildCandidatePool(state = {}, options = {}) {
  const ingredients = Array.isArray(state?.ingredients) ? state.ingredients : [];
  const explicitPool = Array.isArray(options.candidatePool)
    ? options.candidatePool
    : Array.isArray(options.candidateIngredients)
      ? options.candidateIngredients
      : null;

  const candidates = [];
  const seen = new Set();

  // Explicit purchase candidate pool (pool items do NOT fake 'out' availability)
  if (explicitPool) {
    explicitPool.forEach((ingredient, index) => {
      const key = getCandidateKey(ingredient, index);
      if (seen.has(key)) return;
      seen.add(key);

      candidates.push({
        ...ingredient,
        source: 'candidate',
        isPoolItem: true,
        availability: undefined
      });
    });
  }

  // Pantry items (low/limited/out or available staples)
  ingredients.forEach((ingredient, index) => {
    const rawAvail = ingredient?.availability;
    const availability = resolveAvailability(rawAvail);

    if (rawAvail === 'in_stock' || options.excludeInStock && availability === 'normal') {
      return;
    }

    const candidate = {
      ...ingredient,
      source: 'inventory',
      isPoolItem: false,
      availability
    };

    const key = getCandidateKey(candidate, index);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  });

  return candidates;
}

// ══════════════════════════════════════════════════════════════════════
// SOLVER MARGINAL EVALUATOR (Clean Round-Cached Lifecycle)
// ══════════════════════════════════════════════════════════════════════

function applyGroceryToState(stateClone, candidate) {
  if (!stateClone.ingredients) stateClone.ingredients = [];

  if (candidate.isPoolItem) {
    const existing = stateClone.ingredients.find(i =>
      (candidate.id && i.id === candidate.id) || i.name === candidate.name
    );
    if (!existing) {
      stateClone.ingredients.push({
        ...candidate,
        availability: 'normal',
        minServings: typeof candidate.minServings === 'number' ? candidate.minServings : 0,
        maxServings: typeof candidate.maxServings === 'number' ? candidate.maxServings : 5,
        isPoolItem: false
      });
    } else {
      existing.availability = 'normal';
    }
  } else {
    const ing = stateClone.ingredients.find(i =>
      (candidate.id && i.id === candidate.id) || i.name === candidate.name
    );
    if (ing) {
      ing.availability = 'normal';
    }
  }
}

/**
 * Creates an explicit round-cached solver marginal evaluator.
 *
 * Lifecycle:
 *   evaluator.beginRound(selected)
 *   evaluator.evaluate(candidate)
 *   evaluator.normalizeRoundEvaluations(evalMap)
 *   evaluator.commit(bestCandidate)
 */
export function createSolverMarginalEvaluator({ state, solve = solveModel } = {}) {
  let selectedGroceries = [];
  let roundBaselineState = null;
  let roundBaselineObjective = Infinity;

  return {
    beginRound(selected) {
      selectedGroceries = Array.isArray(selected) ? [...selected] : [];
      roundBaselineState = cloneState(state);
      for (const item of selectedGroceries) {
        applyGroceryToState(roundBaselineState, item);
      }
      const baselineSolve = solve(roundBaselineState, { validate: false });
      roundBaselineObjective = (baselineSolve && baselineSolve.feasible && Number.isFinite(baselineSolve.objective))
        ? baselineSolve.objective
        : Infinity;
    },

    evaluate(candidate) {
      if (!roundBaselineState) {
        this.beginRound(selectedGroceries);
      }
      const candState = cloneState(roundBaselineState);
      applyGroceryToState(candState, candidate);
      const candSolve = solve(candState, { validate: false });

      if (!candSolve || !candSolve.feasible || !Number.isFinite(candSolve.objective)) {
        return {
          status: 'infeasible',
          value: 0,
          rawValue: 0,
          baselineObjective: roundBaselineObjective,
          counterfactualObjective: Infinity,
          feasible: false
        };
      }

      const counterfactualObjective = candSolve.objective;
      const rawDelta = roundBaselineObjective - counterfactualObjective;

      let status = 'neutral';
      if (rawDelta > PRECISION.NUMERICAL_ZERO_EPS) {
        status = 'improves';
      } else if (rawDelta < -PRECISION.NUMERICAL_ZERO_EPS) {
        status = 'worsens';
      }

      return {
        status,
        value: Math.max(0, rawDelta),
        rawValue: rawDelta,
        baselineObjective: roundBaselineObjective,
        counterfactualObjective,
        feasible: true
      };
    },

    normalizeRoundEvaluations(evalMap) {
      const improvements = [];
      for (const evalRes of evalMap.values()) {
        if (evalRes && evalRes.status === 'improves' && evalRes.rawValue > 0) {
          improvements.push(evalRes.rawValue);
        }
      }

      if (!improvements.length) {
        for (const evalRes of evalMap.values()) {
          if (evalRes) evalRes.value = 0;
        }
        return;
      }

      const minGain = Math.min(...improvements);
      const maxGain = Math.max(...improvements);
      const span = maxGain - minGain;

      for (const evalRes of evalMap.values()) {
        if (!evalRes) continue;
        if (evalRes.status === 'improves' && evalRes.rawValue > 0) {
          evalRes.value = span > PRECISION.NUMERICAL_ZERO_EPS
            ? clamp((evalRes.rawValue - minGain) / span)
            : 1.0;
        } else {
          evalRes.value = 0;
        }
      }
    },

    commit(bestCandidate) {
      if (bestCandidate) {
        selectedGroceries.push(bestCandidate);
      }
    }
  };
}

// ══════════════════════════════════════════════════════════════════════
// GREEDY MARGINAL BASKET SELECTOR
// ══════════════════════════════════════════════════════════════════════

/**
 * Greedily selects the grocery basket that maximizes marginal planning value:
 *   argmax_i ΔV(i | selected)
 *
 * Integrates an adaptive shortlist:
 *   solverPreselect = Math.min(candidates.length, Math.max(15, limit * 5))
 *
 * @param {object} state - Application state.
 * @param {object} [options] - Options (limit, solverEvaluator, evaluateMarginalValue, candidatePool).
 * @returns {Array<object>} Selected grocery recommendations.
 */
export function getGroceryRecommendations(state, options = {}) {
  const limit = typeof options.limit === 'number' && options.limit > 0
    ? Math.floor(options.limit)
    : 5;

  const targets = getTargets(state?.targets);
  const weights = getWeights(state?.weights);
  const inventory = getInventoryItems(state);
  const candidates = buildCandidatePool(state, options);

  if (!candidates.length) {
    return [];
  }

  // Fast pre-ranker layer (cheap proxy score)
  const fastScored = candidates
    .map(ingredient => {
      const heuristicValue = getHeuristicMarginalUtility(ingredient, {
        targets,
        weights,
        inventory,
        selected: []
      });

      const evaluation = scoreIngredientGroceryUtility(
        ingredient,
        targets,
        weights,
        state,
        {
          inventory,
          selected: [],
          marginalValue: heuristicValue,
          marginalSource: 'heuristic'
        }
      );

      return {
        ingredient,
        heuristicValue,
        evaluation
      };
    })
    .sort((a, b) => {
      const diff = b.evaluation.score - a.evaluation.score;
      if (Math.abs(diff) > EPS) return diff;
      return String(a.ingredient.name || '').localeCompare(String(b.ingredient.name || ''));
    });

  // Solver mode setup (adaptive shortlist: max(15, limit * 5))
  const solverPreselect = Math.min(
    candidates.length,
    Math.max(15, limit * 5)
  );

  const customCallback = typeof options.evaluateMarginalValue === 'function'
    ? options.evaluateMarginalValue
    : null;

  const solverEvaluator = options.solverEvaluator ||
    (options.useSolver === true ? createSolverMarginalEvaluator({ state, solve: options.solve || solveModel }) : null);

  const isSolverActive = Boolean(customCallback || solverEvaluator);

  const activeCandidates = isSolverActive
    ? fastScored.slice(0, solverPreselect)
    : [...fastScored];

  const selected = [];
  const selectedKeys = new Set();

  while (selected.length < limit && activeCandidates.length > 0) {
    const currentSelectedIngredients = selected.map(item => item.ingredient);

    if (solverEvaluator) {
      solverEvaluator.beginRound(currentSelectedIngredients);
    }

    // Evaluate marginal values for all candidates in the active set
    const roundEvalMap = new Map();

    for (let i = 0; i < activeCandidates.length; i++) {
      const entry = activeCandidates[i];
      const ingredient = entry.ingredient;
      const key = getCandidateKey(ingredient, i);

      let marginalValue = null;
      let marginalSource = 'heuristic';
      let rawMarginalValue = null;
      let solverStatus = 'heuristic';

      if (solverEvaluator) {
        const evalRes = solverEvaluator.evaluate(ingredient);
        roundEvalMap.set(key, evalRes);
      } else if (customCallback) {
        const result = customCallback(ingredient, {
          state,
          inventory,
          selected: currentSelectedIngredients,
          targets,
          weights
        });

        if (typeof result === 'number' && Number.isFinite(result)) {
          marginalValue = clamp(result);
          marginalSource = 'solver';
          solverStatus = result > 0 ? 'improves' : 'neutral';
        } else if (result && typeof result === 'object') {
          marginalValue = Number.isFinite(result.value) ? clamp(result.value) : 0;
          rawMarginalValue = Number.isFinite(result.rawValue) ? result.rawValue : null;
          marginalSource = 'solver';
          solverStatus = result.status || (marginalValue > 0 ? 'improves' : 'neutral');
        }
        roundEvalMap.set(key, { value: marginalValue, rawValue: rawMarginalValue, status: solverStatus, marginalSource });
      } else {
        marginalValue = getHeuristicMarginalUtility(ingredient, {
          targets,
          weights,
          inventory,
          selected: currentSelectedIngredients
        });
        roundEvalMap.set(key, { value: marginalValue, rawValue: null, status: 'heuristic', marginalSource: 'heuristic' });
      }
    }

    if (solverEvaluator) {
      solverEvaluator.normalizeRoundEvaluations(roundEvalMap);
    }

    let best = null;

    for (let i = 0; i < activeCandidates.length; i++) {
      const entry = activeCandidates[i];
      const ingredient = entry.ingredient;
      const key = getCandidateKey(ingredient, i);

      let marginalValue = null;
      let marginalSource = 'heuristic';
      let rawMarginalValue = null;

      if (roundEvalMap.has(key)) {
        const evalRes = roundEvalMap.get(key);
        marginalValue = evalRes.value;
        rawMarginalValue = evalRes.rawValue;
        marginalSource = evalRes.marginalSource || (solverEvaluator ? 'solver' : 'heuristic');
      } else {
        marginalValue = getHeuristicMarginalUtility(ingredient, {
          targets,
          weights,
          inventory,
          selected: currentSelectedIngredients
        });
      }

      const evaluation = scoreIngredientGroceryUtility(
        ingredient,
        targets,
        weights,
        state,
        {
          inventory,
          selected: currentSelectedIngredients,
          marginalValue,
          marginalSource
        }
      );

      const candidateResult = {
        ingredient,
        evaluation,
        rawMarginalValue
      };

      if (!best) {
        best = candidateResult;
        continue;
      }

      const scoreDiff = candidateResult.evaluation.score - best.evaluation.score;
      if (scoreDiff > EPS) {
        best = candidateResult;
      } else if (Math.abs(scoreDiff) <= EPS) {
        const nameA = String(candidateResult.ingredient.name || '');
        const nameB = String(best.ingredient.name || '');
        if (nameA.localeCompare(nameB) < 0) {
          best = candidateResult;
        }
      }
    }

    if (!best) break;

    const bestKey = getCandidateKey(best.ingredient);
    if (selectedKeys.has(bestKey)) break;

    selectedKeys.add(bestKey);
    selected.push(best);

    if (solverEvaluator) {
      solverEvaluator.commit(best.ingredient);
    }

    const selectedIndex = activeCandidates.findIndex(
      entry => getCandidateKey(entry.ingredient) === bestKey
    );
    if (selectedIndex >= 0) {
      activeCandidates.splice(selectedIndex, 1);
    }
  }

  return selected.map(item => {
    const ingredient = item.ingredient;
    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      servingSize: ingredient.servingSize,
      unit: ingredient.unit || 'g',
      calories: ingredient.calories,
      protein: ingredient.protein,
      carbs: ingredient.carbs,
      fat: ingredient.fat,
      source: ingredient.source || (ingredient.isPoolItem ? 'candidate' : 'inventory'),
      availability: item.evaluation.availability,
      isPoolItem: ingredient.isPoolItem === true,
      ...item.evaluation,
      rawMarginalValue: item.rawMarginalValue
    };
  });
}
