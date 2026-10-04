// ══════════════════════════════════════════
// NUTRITIONAL ERROR SAFETY CHECKER
// ══════════════════════════════════════════
// Evaluates whether consuming a specified quantity of a food
// can still yield a feasible diet solution within a user-defined
// maximum total nutritional error threshold.
// Reuses the existing LP solver, ingredient definitions, and error calculation.

import { state, findIngredientById, DEFAULT_MAX_TOTAL_ERROR } from './state.js';
import { solveModel } from './solver.js';
import { createCustomFoodFromIngredient } from './customFoods.js';
import { formatQuantity, formatPercent } from './formatters.js';

const MACROS = ['calories', 'protein', 'carbs', 'fat'];

/**
 * Calculates the total nutritional error percentage from a solver result.
 * Sums the absolute percentage deviations across all primary macronutrient
 * and energy targets (calories, protein, carbs, fat) against original daily targets.
 *
 * @param {object} result - Solver result containing combinedDeviations or deviations.
 * @returns {number} Full precision total error percentage (e.g. 2.9814).
 */
export function calculateTotalError(result) {
  if (!result || typeof result !== 'object') return Infinity;
  const devs = result.combinedDeviations || result.deviations;
  if (!devs || typeof devs !== 'object') return Infinity;

  let sum = 0;
  for (const m of MACROS) {
    const dev = devs[m];
    const pct = (dev && typeof dev.percentage === 'number' && !isNaN(dev.percentage))
      ? Math.abs(dev.percentage)
      : 0;
    sum += pct;
  }
  return sum;
}

/**
 * Validates a user-defined error threshold.
 * Must be numeric, finite, and non-negative.
 *
 * @param {*} threshold - The threshold to validate.
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validateThreshold(threshold) {
  if (threshold === null || threshold === undefined || threshold === '' || typeof threshold === 'boolean') {
    return { valid: false, error: 'Maximum allowed error must be a non-negative number.' };
  }
  const num = Number(threshold);
  if (isNaN(num) || !isFinite(num) || num < 0) {
    return { valid: false, error: 'Maximum allowed error must be a non-negative number.' };
  }
  return { valid: true, value: num };
}

/**
 * Validates all safety checker user inputs against existing application state.
 *
 * @param {string} foodId - Food or ingredient ID
 * @param {number|string} amount - Requested amount
 * @param {string} unit - 'g' or 'mL'
 * @param {number|string} threshold - Maximum total error %
 * @param {object} customState - Application state
 * @returns {{ valid: boolean, ingredient?: object, amount?: number, unit?: string, threshold?: number, error?: string }}
 */
export function validateSafetyInputs(foodId, amount, unit, threshold = null, customState = state) {
  // 1. Validate Threshold
  const effectiveThreshold = threshold !== null && threshold !== undefined
    ? threshold
    : (customState?.maxTotalError ?? state?.maxTotalError ?? DEFAULT_MAX_TOTAL_ERROR);

  const threshVal = validateThreshold(effectiveThreshold);
  if (!threshVal.valid) {
    return { valid: false, error: threshVal.error };
  }

  // 2. Validate Food ID
  if (!foodId || typeof foodId !== 'string' || foodId.trim() === '') {
    return { valid: false, error: 'You need to enter a Food ID.' };
  }
  const trimmedId = foodId.trim().toUpperCase();

  const ingredients = customState?.ingredients || state?.ingredients || [];
  const ingredient = findIngredientById(trimmedId, ingredients);
  if (!ingredient) {
    return { valid: false, error: 'That Food ID does not exist. Check the ID shown on the ingredient card and try again.' };
  }

  // 3. Validate Amount
  if (amount === null || amount === undefined || amount === '' || typeof amount === 'boolean') {
    return { valid: false, error: 'Enter a valid amount greater than 0 g or mL.' };
  }
  const numAmount = Number(amount);
  if (isNaN(numAmount) || !isFinite(numAmount) || numAmount <= 0) {
    return { valid: false, error: 'Enter a valid amount greater than 0 g or mL.' };
  }

  // 4. Validate Unit
  if (!unit || typeof unit !== 'string' || unit.trim() === '') {
    return { valid: false, error: 'Unit must be either g or mL.' };
  }
  const lowerUnit = unit.trim().toLowerCase();
  let canonicalUnit;
  if (lowerUnit === 'g') {
    canonicalUnit = 'g';
  } else if (lowerUnit === 'ml') {
    canonicalUnit = 'mL';
  } else {
    return { valid: false, error: 'Unit must be either g or mL.' };
  }

  // 5. Validate Ingredient Serving Definition & Unit Compatibility
  const servingSize = Number(ingredient.servingSize);
  if (typeof servingSize !== 'number' || isNaN(servingSize) || servingSize <= 0) {
    return { valid: false, error: 'This food does not have a valid g/mL serving definition and cannot be evaluated.' };
  }

  const ingUnit = (ingredient.unit || '').trim().toLowerCase();
  if (canonicalUnit === 'g' && ingUnit !== 'g') {
    return { valid: false, error: 'This food is measured in volume (mL) and cannot be evaluated using mass (g).' };
  }
  if (canonicalUnit === 'mL' && ingUnit !== 'ml') {
    return { valid: false, error: 'This food is measured in mass (g) and cannot be evaluated using volume (mL).' };
  }

  // 6. Check for complete/valid nutritional definition
  const hasKcal = typeof ingredient.calories === 'number' && !isNaN(ingredient.calories);
  const hasPro = typeof ingredient.protein === 'number' && !isNaN(ingredient.protein);
  const hasCarb = typeof ingredient.carbs === 'number' && !isNaN(ingredient.carbs);
  const hasFat = typeof ingredient.fat === 'number' && !isNaN(ingredient.fat);
  if (!hasKcal && !hasPro && !hasCarb && !hasFat) {
    return { valid: false, error: 'This food has an incomplete nutritional definition and cannot be evaluated.' };
  }

  return {
    valid: true,
    ingredient,
    amount: numAmount,
    unit: canonicalUnit,
    threshold: threshVal.value
  };
}

/**
 * Runs the existing diet solver with a candidate food quantity constrained on an isolated state clone.
 * Does not mutate the application state.
 *
 * @param {object} ingredient - Ingredient data object
 * @param {number} quantity - Quantity in ingredient units (g or mL)
 * @param {string} unit - 'g' or 'mL'
 * @param {object} customState - Application state to clone
 * @returns {{ feasible: boolean, totalError: number, result?: object, errors?: string[] }}
 */
export function evaluateFoodQuantity(ingredient, quantity, unit, customState = state) {
  const cloneState = JSON.parse(JSON.stringify(customState || state));
  if (!cloneState.customFoods) cloneState.customFoods = [];

  if (quantity > 0) {
    const cfOutcome = createCustomFoodFromIngredient(ingredient.id, quantity, unit, cloneState);
    if (cfOutcome.errors && cfOutcome.errors.length > 0) {
      return { feasible: false, totalError: Infinity, errors: cfOutcome.errors };
    }
  }

  const solveOutcome = solveModel(cloneState, { validate: false });
  if (!solveOutcome.feasible || !solveOutcome.result) {
    return {
      feasible: false,
      totalError: Infinity,
      errors: solveOutcome.errors || ['Solver failed to find a feasible solution.']
    };
  }

  const totalError = calculateTotalError(solveOutcome.result);
  return {
    feasible: true,
    totalError,
    result: solveOutcome.result,
    errors: []
  };
}

/**
 * Calculates the maximum safe amount of a food that can be consumed while remaining
 * within the user's error threshold.
 *
 * Uses bisection (binary search) to locate the exact mathematical feasibility boundary
 * without arbitrary linear increments, then applies application precision rules
 * while verifying that the displayed rounded quantity is strictly feasible.
 *
 * @param {object} ingredient - Source food definition
 * @param {number} threshold - Maximum total error %
 * @param {string} unit - 'g' or 'mL'
 * @param {object} customState - Application state
 * @param {number} upperLimit - Upper search bound (typically requestedAmount)
 * @returns {{ found: boolean, maxSafeAmount: number, rawMaxAmount: number, resultingErrorAtMax: number, reason?: string }}
 */
export function findMaximumSafeQuantity(ingredient, threshold, unit, customState = state, upperLimit = 1000) {
  const TOLERANCE_EPS = 1e-7;

  // 1. Verify if baseline quantity (0) is feasible within threshold
  const ev0 = evaluateFoodQuantity(ingredient, 0, unit, customState);
  if (!ev0.feasible || ev0.totalError > threshold + TOLERANCE_EPS) {
    return {
      found: false,
      maxSafeAmount: 0,
      rawMaxAmount: 0,
      resultingErrorAtMax: ev0.totalError,
      reason: 'Current meal plan baseline already exceeds the error threshold.'
    };
  }

  // 2. Perform binary search (bisection) to locate boundary
  let low = 0;
  let high = Math.max(upperLimit, 1);
  const evHigh = evaluateFoodQuantity(ingredient, high, unit, customState);
  if (evHigh.feasible && evHigh.totalError <= threshold + TOLERANCE_EPS) {
    // Already safe at upperLimit
    return {
      found: true,
      maxSafeAmount: high,
      rawMaxAmount: high,
      resultingErrorAtMax: evHigh.totalError
    };
  }

  const MAX_ITERATIONS = 24; // Precision < 0.0001
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const mid = (low + high) / 2;
    const ev = evaluateFoodQuantity(ingredient, mid, unit, customState);
    if (ev.feasible && ev.totalError <= threshold + TOLERANCE_EPS) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const rawMax = low;

  // 3. Rounding near feasibility boundary:
  //    Respect application display precision (1 decimal place or whole integer).
  //    Never present an infeasible quantity due to upward rounding.
  let cand = Math.round(rawMax * 10) / 10;
  let evCand = evaluateFoodQuantity(ingredient, cand, unit, customState);

  if (!evCand.feasible || evCand.totalError > threshold + TOLERANCE_EPS) {
    // Upward rounding pushed error over threshold — round down to 1 decimal
    cand = Math.floor(rawMax * 10) / 10;
    evCand = evaluateFoodQuantity(ingredient, cand, unit, customState);
  }

  if (!evCand.feasible || evCand.totalError > threshold + TOLERANCE_EPS) {
    // Fall back to integer floor
    cand = Math.floor(rawMax);
    evCand = evaluateFoodQuantity(ingredient, cand, unit, customState);
  }

  const maxSafeAmount = Math.max(0, cand);
  const resultingErrorAtMax = evCand.feasible ? evCand.totalError : ev0.totalError;

  return {
    found: true,
    maxSafeAmount,
    rawMaxAmount: rawMax,
    resultingErrorAtMax
  };
}

/**
 * Main feature entry point: Determines whether consuming a specified amount
 * of a food can still produce a diet solution within the user-defined maximum total error.
 *
 * @param {string} foodId - Food ID to check
 * @param {number|string} amount - Requested amount
 * @param {string} unit - 'g' or 'mL'
 * @param {number|string} [threshold] - Maximum allowed total error % (defaults to state.maxTotalError)
 * @param {object} [customState] - Application state (defaults to state)
 * @returns {object} Safety evaluation outcome
 */
export function checkNutritionalSafety(foodId, amount, unit, threshold = null, customState = state) {
  const s = customState || state;
  const validation = validateSafetyInputs(foodId, amount, unit, threshold, s);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error
    };
  }

  const { ingredient, amount: numAmount, unit: canonicalUnit, threshold: numThreshold } = validation;

  // Check if ingredient represents estimated values or ranges
  const hasEstimates = Boolean(
    ingredient.ranges ||
    ingredient.confidence?.calories === 'estimated' ||
    ingredient.confidence?.protein === 'estimated' ||
    ingredient.confidence?.carbs === 'estimated' ||
    ingredient.confidence?.fat === 'estimated'
  );

  // Evaluate requested amount
  const reqEval = evaluateFoodQuantity(ingredient, numAmount, canonicalUnit, s);

  const TOLERANCE_EPS = 1e-7;
  const isCompatible = reqEval.feasible && (reqEval.totalError <= numThreshold + TOLERANCE_EPS);

  if (isCompatible) {
    return {
      success: true,
      compatible: true,
      status: 'YES',
      foodId: ingredient.id,
      foodName: ingredient.name,
      requestedAmount: numAmount,
      unit: canonicalUnit,
      totalError: reqEval.totalError,
      threshold: numThreshold,
      hasEstimates,
      message: `The requested quantity of ${formatQuantity(numAmount)} ${canonicalUnit} is compatible with the selected error threshold of ${formatPercent(numThreshold, 1, false)}.`
    };
  }

  // Requested quantity exceeds threshold or is infeasible -> determine maximum feasible amount
  const maxSafe = findMaximumSafeQuantity(ingredient, numThreshold, canonicalUnit, s, numAmount);

  return {
    success: true,
    compatible: false,
    status: 'NO',
    foodId: ingredient.id,
    foodName: ingredient.name,
    requestedAmount: numAmount,
    unit: canonicalUnit,
    totalError: reqEval.totalError,
    threshold: numThreshold,
    maxSafeAmount: maxSafe.maxSafeAmount,
    rawMaxSafeAmount: maxSafe.rawMaxAmount,
    resultingErrorAtMax: maxSafe.resultingErrorAtMax,
    hasEstimates,
    message: `The requested quantity of ${formatQuantity(numAmount)} ${canonicalUnit} exceeds the selected error threshold of ${formatPercent(numThreshold, 1, false)}.`
  };
}
