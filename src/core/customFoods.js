// ══════════════════════════════════════════
// CUSTOM FOODS — temporary daily food entries
// ══════════════════════════════════════════
// Pure data module. No DOM, no solver dependency.
// Custom foods are fixed consumed nutrition that
// the optimizer works around, never optimization variables.
//
// Nutrition values represent the ENTIRE declared quantity.
// amount + unit are human-readable labels only — they do
// not independently scale the nutrition values.

import { state, generateId, findIngredientById } from './state.js';

const MACROS = ['calories', 'protein', 'carbs', 'fat'];

const CONFIDENCE_VALUES = ['known', 'estimated', 'unknown'];

/**
 * Default unit options for the UI dropdown.
 * The system also accepts arbitrary strings.
 */
export const UNIT_OPTIONS = [
  'g', 'oz', 'ml', 'cup', 'tbsp', 'tsp',
  'piece', 'slice', 'bowl', 'plate',
  'wrap', 'sandwich', 'meal', 'serving'
];

// ── Range Parsing Helper ──────────────────────

/**
 * Parses and normalizes any supported range representation:
 * - [min, max] or [lower, upper]
 * - { min, max } or { lower, upper }
 *
 * @param {*} rawRange
 * @returns {{ min: number, max: number, raw: * } | null | { invalid: true }}
 */
export function parseRange(rawRange) {
  if (rawRange === null || rawRange === undefined) return null;

  if (Array.isArray(rawRange)) {
    if (rawRange.length >= 2) {
      const min = (rawRange[0] !== null && rawRange[0] !== undefined && rawRange[0] !== '') ? Number(rawRange[0]) : NaN;
      const max = (rawRange[1] !== null && rawRange[1] !== undefined && rawRange[1] !== '') ? Number(rawRange[1]) : NaN;
      return { min, max, raw: rawRange };
    }
    return { invalid: true };
  }

  if (typeof rawRange === 'object') {
    const minVal = rawRange.min !== undefined ? rawRange.min : rawRange.lower;
    const maxVal = rawRange.max !== undefined ? rawRange.max : rawRange.upper;
    const min = (minVal !== null && minVal !== undefined && minVal !== '') ? Number(minVal) : NaN;
    const max = (maxVal !== null && maxVal !== undefined && maxVal !== '') ? Number(maxVal) : NaN;
    return { min, max, raw: rawRange };
  }

  return { invalid: true };
}

// ── Validation ──────────────────────────────

export function validateCustomFood(food) {
  const errors = [];
  if (!food || typeof food !== 'object') {
    return ['Custom food must be an object.'];
  }
  if (typeof food.name !== 'string' || food.name.trim() === '') {
    errors.push('Name is required.');
  }
  if (typeof food.amount !== 'number' || isNaN(food.amount) || food.amount <= 0) {
    errors.push('Amount must be a positive number.');
  }
  if (typeof food.unit !== 'string' || food.unit.trim() === '') {
    errors.push('Unit is required.');
  }

  const rawConf = food.confidence || {};
  const rawRanges = food.ranges || {};

  MACROS.forEach(m => {
    const field = food[m];
    let val;
    let status = rawConf[m];
    let range = rawRanges[m] !== undefined ? rawRanges[m] : food[`${m}Range`];

    if (field && typeof field === 'object' && ('value' in field || 'status' in field || 'range' in field)) {
      val = field.value;
      if (field.status !== undefined) status = field.status;
      if (field.range !== undefined) range = field.range;
    } else {
      val = field;
    }

    // Validate value if provided
    if (val !== null && val !== undefined && val !== '') {
      if (typeof val !== 'number' || isNaN(val) || val < 0) {
        errors.push(`${m} must be a non-negative number or blank.`);
      }
    }

    const parsedR = parseRange(range);
    const hasRange = parsedR !== null;

    // Determine status:
    let effStatus = status;
    if (!effStatus) {
      if (val === null || val === undefined || val === '') {
        effStatus = hasRange ? 'estimated' : 'unknown';
      } else {
        effStatus = hasRange ? 'estimated' : 'known';
      }
    }

    // Range checks
    if (hasRange) {
      if (parsedR.invalid) {
        errors.push(`${m} range must be an object.`);
      } else if (effStatus === 'known') {
        errors.push(`${m} range cannot be supplied for known nutrients.`);
      } else if (effStatus === 'unknown') {
        errors.push(`${m} range cannot be supplied for unknown nutrients.`);
      } else if (effStatus === 'estimated') {
        const { min, max } = parsedR;
        if (typeof min !== 'number' || isNaN(min) || min < 0) {
          errors.push(`${m} range min must be a non-negative number.`);
        }
        if (typeof max !== 'number' || isNaN(max) || max < 0) {
          errors.push(`${m} range max must be a non-negative number.`);
        }
        if (typeof min === 'number' && typeof max === 'number' && !isNaN(min) && !isNaN(max)) {
          if (min > max) {
            errors.push(`${m} range min (${min}) cannot be greater than max (${max}).`);
          }
          if (typeof val === 'number' && !isNaN(val)) {
            if (val < min || val > max) {
              errors.push(`${m} value (${val}) must fall within the evidence range [${min}, ${max}].`);
            }
          }
        }
      }
    }
  });

  return errors;
}

// ── Canonical Normalization & Accessors ─────

/**
 * Normalizes any custom food representation (flat or nested compatibility format)
 * into the canonical flat schema with explicit confidence and ranges.
 */
export function normalizeCustomFood(rawFood) {
  if (!rawFood || typeof rawFood !== 'object') return rawFood;

  const normalized = {
    ...rawFood
  };

  const rawConf = rawFood.confidence || {};
  const rawRanges = rawFood.ranges || {};

  const finalConf = {};
  const finalRanges = {};

  MACROS.forEach(m => {
    const field = rawFood[m];
    let val;
    let status = rawConf[m];
    let range = rawRanges[m] !== undefined ? rawRanges[m] : rawFood[`${m}Range`];

    if (field && typeof field === 'object' && ('value' in field || 'status' in field || 'range' in field)) {
      val = (typeof field.value === 'number' && !isNaN(field.value))
        ? field.value
        : (field.value === null || field.value === undefined ? null : field.value);
      if (field.status !== undefined) status = field.status;
      if (field.range !== undefined) range = field.range;
    } else {
      val = (typeof field === 'number' && !isNaN(field))
        ? field
        : (field === null || field === undefined ? null : field);
    }

    normalized[m] = val;

    const parsedR = parseRange(range);
    const hasValidRange = parsedR && !parsedR.invalid &&
      typeof parsedR.min === 'number' && !isNaN(parsedR.min) &&
      typeof parsedR.max === 'number' && !isNaN(parsedR.max) &&
      parsedR.min <= parsedR.max;

    // Determine canonical status
    if (val === null || val === undefined) {
      status = (hasValidRange && status !== 'unknown') ? 'estimated' : 'unknown';
    } else if (!status || !CONFIDENCE_VALUES.includes(status) || status === 'unknown') {
      status = hasValidRange ? 'estimated' : 'known';
    }

    finalConf[m] = status;

    // Determine canonical range: preserve original range without destroying it
    if (hasValidRange && status === 'estimated') {
      finalRanges[m] = { min: parsedR.min, max: parsedR.max };
    } else {
      finalRanges[m] = null;
    }
  });

  normalized.confidence = finalConf;
  normalized.ranges = finalRanges;

  // Preserve consumption accounting fields
  const amount = typeof normalized.amount === 'number' ? normalized.amount : 0;
  const logged = typeof rawFood.amountLogged === 'number'
    ? rawFood.amountLogged
    : (typeof rawFood.amount === 'number' ? rawFood.amount : amount);
  const eaten = typeof rawFood.amountEaten === 'number'
    ? rawFood.amountEaten
    : (typeof rawFood.eatenQuantity === 'number' ? rawFood.eatenQuantity : (rawFood.isEaten === false ? 0 : logged));
  const remaining = typeof rawFood.amountRemaining === 'number'
    ? rawFood.amountRemaining
    : Math.max(0, logged - eaten);

  normalized.amountLogged = logged;
  normalized.amountEaten = eaten;
  normalized.amountRemaining = remaining;
  normalized.eatenQuantity = eaten;
  normalized.isEaten = eaten >= logged;

  return normalized;
}

/**
 * Builds a confidence object, syncing with macro values.
 * A null macro forces confidence to 'unknown'.
 * A non-null macro with no explicit confidence defaults to 'known'.
 */
export function buildConfidence(food, explicitConfidence) {
  const conf = {};
  MACROS.forEach(m => {
    if (food[m] === null || food[m] === undefined) {
      conf[m] = 'unknown';
    } else if (explicitConfidence && CONFIDENCE_VALUES.includes(explicitConfidence[m])) {
      conf[m] = explicitConfidence[m] === 'unknown' ? 'estimated' : explicitConfidence[m];
    } else {
      conf[m] = 'known';
    }
  });
  return conf;
}

/**
 * Authoritative user-facing recorded consumption accessor.
 * Returns the exact stored numerical value entered by the user, or null if unknown.
 */
export function getRecordedValue(nutrient, customFood) {
  if (!customFood || typeof customFood !== 'object') return null;
  let val = customFood[nutrient];
  if (val && typeof val === 'object' && 'value' in val) {
    val = val.value;
  }
  return (typeof val === 'number' && !isNaN(val)) ? val : null;
}

/**
 * Authoritative solver-facing planning value accessor.
 *
 * Precedence contract:
 * - Explicit single value (if provided): preserved as authoritative value
 * - Range-only (empty single value + valid range): arithmetic midpoint (min + max) / 2
 * - Unknown (no value and no range): null (no numerical planning contribution)
 *
 * @param {string} nutrient - 'calories', 'protein', 'carbs', or 'fat'
 * @param {Object} customFood - Custom food or ingredient item
 * @returns {number|null} Planning value or null
 */
export function getPlanningValue(nutrient, customFood) {
  if (!customFood || typeof customFood !== 'object') return null;

  let val = customFood[nutrient];
  let status = customFood.confidence?.[nutrient];
  let range = customFood.ranges?.[nutrient] !== undefined
    ? customFood.ranges[nutrient]
    : customFood[`${nutrient}Range`];

  if (val && typeof val === 'object' && ('value' in val || 'status' in val || 'range' in val)) {
    if (val.status !== undefined) status = val.status;
    if (val.range !== undefined) range = val.range;
    val = val.value;
  }

  const parsedR = parseRange(range);
  const hasValidRange = parsedR && !parsedR.invalid &&
    typeof parsedR.min === 'number' && !isNaN(parsedR.min) &&
    typeof parsedR.max === 'number' && !isNaN(parsedR.max) &&
    parsedR.min <= parsedR.max;

  const hasExplicitVal = typeof val === 'number' && !isNaN(val);

  if (!status) {
    if (hasExplicitVal) {
      status = 'known';
    } else if (hasValidRange) {
      status = 'estimated';
    } else {
      status = 'unknown';
    }
  }

  if (status === 'known') {
    return hasExplicitVal ? val : null;
  }

  if (status === 'estimated') {
    if (hasValidRange) {
      return (parsedR.min + parsedR.max) / 2;
    }
    return hasExplicitVal ? val : null;
  }

  if (status !== 'unknown' && hasValidRange) {
    return (parsedR.min + parsedR.max) / 2;
  }

  return null;
}

// ── CRUD ────────────────────────────────────

export function addCustomFood(food) {
  const errors = validateCustomFood(food);
  if (errors.length > 0) return { errors };

  const norm = normalizeCustomFood(food);

  const entry = {
    id: generateId('cf'),
    name: norm.name.trim(),
    amount: norm.amount,
    amountLogged: norm.amountLogged,
    amountEaten: norm.amountEaten,
    amountRemaining: norm.amountRemaining,
    unit: norm.unit.trim(),
    calories: norm.calories ?? null,
    protein: norm.protein ?? null,
    carbs: norm.carbs ?? null,
    fat: norm.fat ?? null,
    confidence: norm.confidence,
    ranges: norm.ranges,
    meal: norm.meal || null,
    foodDefId: norm.foodDefId || norm.foodDefinitionId || null,
    foodDefinitionId: norm.foodDefinitionId || norm.foodDefId || null,
    servings: typeof norm.servings === 'number' ? norm.servings : null,
    isEaten: norm.isEaten,
    eatenQuantity: norm.eatenQuantity
  };

  state.customFoods.push(entry);
  return { entry };
}

export function updateCustomFood(id, patch) {
  const idx = state.customFoods.findIndex(cf => cf.id === id);
  if (idx === -1) return { errors: ['Custom food not found.'] };

  const existing = state.customFoods[idx];

  const merged = {
    ...existing,
    ...patch,
    confidence: {
      ...(existing.confidence || {}),
      ...(patch.confidence || {})
    },
    ranges: {
      ...(existing.ranges || {}),
      ...(patch.ranges || {})
    }
  };

  const errors = validateCustomFood(merged);
  if (errors.length > 0) return { errors };

  const norm = normalizeCustomFood(merged);

  existing.name = norm.name.trim();
  existing.amount = norm.amount;
  existing.amountLogged = norm.amountLogged;
  existing.amountEaten = norm.amountEaten;
  existing.amountRemaining = norm.amountRemaining;
  existing.unit = norm.unit.trim();
  existing.calories = norm.calories ?? null;
  existing.protein = norm.protein ?? null;
  existing.carbs = norm.carbs ?? null;
  existing.fat = norm.fat ?? null;
  existing.confidence = norm.confidence;
  existing.ranges = norm.ranges;
  existing.meal = norm.meal || null;
  if (norm.foodDefId !== undefined) existing.foodDefId = norm.foodDefId;
  if (norm.foodDefinitionId !== undefined) existing.foodDefinitionId = norm.foodDefinitionId;
  if (norm.servings !== undefined) existing.servings = norm.servings;
  existing.isEaten = norm.isEaten;
  existing.eatenQuantity = norm.eatenQuantity;

  return { entry: existing };
}

/**
 * Records cumulative partial consumption for a custom food / measured ingredient.
 * Updates amountEaten, derives amountRemaining = max(0, amountLogged - amountEaten),
 * and syncs eatenQuantity and isEaten.
 *
 * Repeated updates overwrite the current cumulative amountEaten rather than adding to it.
 *
 * @param {string} id - Custom food ID
 * @param {number} amountEaten - Cumulative amount consumed
 * @param {Object} customState - Application state (defaults to global state)
 * @returns {{ entry?: Object, errors?: string[] }}
 */
export function recordPartialConsumption(id, amountEaten, customState = state) {
  const foods = customState?.customFoods || state?.customFoods || [];
  const entry = foods.find(cf => cf.id === id);
  if (!entry) return { errors: ['Custom food not found.'] };

  if (amountEaten === null || amountEaten === undefined || amountEaten === '' || typeof amountEaten === 'boolean') {
    return { errors: ['Enter a valid eaten amount >= 0.'] };
  }
  const numEaten = Number(amountEaten);
  if (isNaN(numEaten) || !isFinite(numEaten) || numEaten < 0) {
    return { errors: ['Enter a valid eaten amount >= 0.'] };
  }

  const logged = (typeof entry.amountLogged === 'number')
    ? entry.amountLogged
    : ((typeof entry.amount === 'number') ? entry.amount : 0);

  const clampedEaten = Math.min(logged, numEaten);
  entry.amountLogged = logged;
  entry.amountEaten = clampedEaten;
  entry.amountRemaining = Math.max(0, logged - clampedEaten);
  entry.eatenQuantity = clampedEaten;
  entry.isEaten = clampedEaten >= logged;

  return { entry, errors: [] };
}

export function removeCustomFood(id) {
  const idx = state.customFoods.findIndex(cf => cf.id === id);
  if (idx === -1) return { errors: ['Custom food not found.'] };
  const removed = state.customFoods.splice(idx, 1)[0];
  return { removed };
}

/**
 * Logs an actual measured amount of an existing ingredient by ingredient ID.
 *
 * Requirements:
 * 1. Validate foodDefId is provided and non-empty.
 * 2. Resolve ingredient against existing definitions using exact case-insensitive match.
 * 3. Reject nonexistent IDs without fuzzy/name matching.
 * 4. Validate amount is numeric, finite, and > 0.
 * 5. Restrict units to 'g' and 'mL' only.
 * 6. Validate ingredient serving definition (positive servingSize) and unit compatibility.
 * 7. Derive servings and nutrition linearly directly from source ingredient definition.
 * 8. Create a custom-food entry marked isEaten: true.
 * 9. Append to customFoods and return { entry, errors: [] }.
 *
 * @param {string} foodDefId - The ingredient's immutable ID
 * @param {number} actualAmount - The measured mass or volume
 * @param {string} unit - 'g' or 'mL'
 * @param {Object} customState - Application state (defaults to global state)
 * @returns {{ entry?: Object, errors?: string[] }}
 */
export function createCustomFoodFromIngredient(foodDefId, actualAmount, unit, customState = state) {
  // 1. Validate ID
  if (foodDefId === undefined || foodDefId === null || typeof foodDefId !== 'string' || foodDefId.trim() === '') {
    return { errors: ['You need to enter an ingredient ID.'] };
  }

  const trimmedId = foodDefId.trim().toUpperCase();

  // 2. Resolve ingredient against existing ingredient definitions (exact match, case-insensitive)
  const ingredients = customState?.ingredients || state?.ingredients || [];
  const ingredient = findIngredientById(trimmedId, ingredients);

  if (!ingredient) {
    return { errors: ['That ingredient ID does not exist. Check the ID shown on the ingredient card and try again.'] };
  }

  // 3. Validate amount
  if (
    actualAmount === null ||
    actualAmount === undefined ||
    actualAmount === '' ||
    typeof actualAmount === 'boolean'
  ) {
    return { errors: ['Enter a valid amount greater than 0 g or mL.'] };
  }
  const numAmount = Number(actualAmount);
  if (typeof actualAmount !== 'number' && isNaN(Number(actualAmount))) {
    return { errors: ['Enter a valid amount greater than 0 g or mL.'] };
  }
  if (isNaN(numAmount) || !isFinite(numAmount) || numAmount <= 0) {
    return { errors: ['Enter a valid amount greater than 0 g or mL.'] };
  }

  // 4. Restrict unit to g and mL
  if (typeof unit !== 'string' || unit.trim() === '') {
    return { errors: ['Unit must be either g or mL.'] };
  }
  const lowerUnit = unit.trim().toLowerCase();
  let canonicalUnit;
  if (lowerUnit === 'g') {
    canonicalUnit = 'g';
  } else if (lowerUnit === 'ml') {
    canonicalUnit = 'mL';
  } else {
    return { errors: ['Unit must be either g or mL.'] };
  }

  // 5. Validate ingredient serving definition and unit compatibility
  const ingServingSize = Number(ingredient.servingSize);
  if (typeof ingServingSize !== 'number' || isNaN(ingServingSize) || ingServingSize <= 0) {
    return { errors: ['This ingredient does not have a valid g/mL serving definition and cannot be logged using this unit.'] };
  }

  const ingUnit = (ingredient.unit || '').trim().toLowerCase();
  if (canonicalUnit === 'g' && ingUnit !== 'g') {
    return { errors: ['This ingredient does not have a valid g/mL serving definition and cannot be logged using this unit.'] };
  }
  if (canonicalUnit === 'mL' && ingUnit !== 'ml') {
    return { errors: ['This ingredient does not have a valid g/mL serving definition and cannot be logged using this unit.'] };
  }

  // 6. Calculate servings and nutrition directly from source ingredient definition
  const servings = numAmount / ingServingSize;
  const calories = (Number(ingredient.calories) || 0) * servings;
  const protein = (Number(ingredient.protein) || 0) * servings;
  const carbs = (Number(ingredient.carbs) || 0) * servings;
  const fat = (Number(ingredient.fat) || 0) * servings;

  // 7. Construct custom food entry
  const customFoodId = generateId('cf');
  const entry = {
    id: customFoodId,
    name: ingredient.name,
    foodDefId: ingredient.id,
    foodDefinitionId: ingredient.id,
    amount: numAmount,
    amountLogged: numAmount,
    amountEaten: numAmount,
    amountRemaining: 0,
    unit: canonicalUnit,
    servings,
    calories,
    protein,
    carbs,
    fat,
    confidence: {
      calories: 'known',
      protein: 'known',
      carbs: 'known',
      fat: 'known'
    },
    ranges: {
      calories: null,
      protein: null,
      carbs: null,
      fat: null
    },
    meal: null,
    isEaten: true,
    eatenQuantity: numAmount
  };

  // 8. Add to customFoods
  const targetFoods = customState?.customFoods || state?.customFoods;
  if (Array.isArray(targetFoods)) {
    targetFoods.push(entry);
  }

  return { entry, errors: [] };
}

// ── Aggregation ─────────────────────────────

/**
 * Aggregates custom food nutrition.
 *
 * Per-macro returns: { total: number, known: number, hasUnknown: boolean }
 * (`known` is an alias to `total` for backward compatibility).
 *
 * @param {string|null} mealFilter - if provided, only include custom foods assigned to this meal
 * @param {Array} customFoods - optional custom foods array (defaults to state.customFoods)
 * @param {object} options - { usePlanning: boolean }
 */
export function aggregateCustomFoods(mealFilter = null, customFoods = null, options = {}) {
  const usePlanning = Boolean(options && options.usePlanning);
  const foods = customFoods || state.customFoods;
  const result = {};
  MACROS.forEach(m => {
    result[m] = { total: 0, known: 0, hasUnknown: false };
  });

  const filtered = mealFilter
    ? foods.filter(cf => cf.meal === mealFilter)
    : foods;

  filtered.forEach(cf => {
    MACROS.forEach(m => {
      const pVal = getPlanningValue(m, cf);
      const rVal = getRecordedValue(m, cf);
      const status = cf.confidence?.[m] || (cf[m] === null || cf[m] === undefined ? 'unknown' : 'known');
      if (status === 'unknown' && pVal === null) {
        result[m].hasUnknown = true;
      }

      if (usePlanning) {
        if (pVal !== null) {
          result[m].total += pVal;
          result[m].known += pVal;
        }
      } else {
        if (rVal !== null) {
          result[m].total += rVal;
          result[m].known += rVal;
        } else if (pVal !== null) {
          result[m].total += pVal;
          result[m].known += pVal;
        }
      }
    });
  });

  return result;
}

/**
 * Computes remaining daily targets after subtracting planning custom food contributions.
 *
 * For each macro:
 * - If all custom foods have known values: remaining = target - sum(planning)
 * - If any custom food has unknown: remaining = target (no constraint imposed)
 *   but available contributions are still accumulated in consumed.
 *
 * @returns {{ [macro]: { value: number, known: boolean, consumed: number } }}
 */
export function getRemainingTargets(targets, customFoods = null) {
  const agg = aggregateCustomFoods(null, customFoods, { usePlanning: true });
  const result = {};

  MACROS.forEach(m => {
    const target = targets[m] || 0;
    if (agg[m].hasUnknown) {
      // Can't constrain this dimension — use original target
      result[m] = {
        value: target,
        known: false,
        consumed: agg[m].total
      };
    } else {
      result[m] = {
        value: target - agg[m].total,
        known: true,
        consumed: agg[m].total
      };
    }
  });

  return result;
}

/**
 * Computes remaining meal-level calorie allocation after subtracting
 * planning custom foods assigned to that meal.
 *
 * @returns {{ value: number, consumed: number, known: boolean }}
 */
export function getRemainingMealTarget(mealId, mealCalTarget, customFoods = null) {
  const agg = aggregateCustomFoods(mealId, customFoods, { usePlanning: true });
  const calAgg = agg.calories;

  if (calAgg.hasUnknown) {
    return { value: mealCalTarget, consumed: calAgg.total, known: false };
  }
  return { value: mealCalTarget - calAgg.total, consumed: calAgg.total, known: true };
}

/**
 * Detects macro dimensions where planning custom food totals exceed daily targets.
 *
 * @returns {Array<{ macro: string, target: number, consumed: number, deficit: number }>}
 */
export function detectInfeasibleDimensions(targets, customFoods = null) {
  const agg = aggregateCustomFoods(null, customFoods, { usePlanning: true });
  const issues = [];

  MACROS.forEach(m => {
    if (!agg[m].hasUnknown) {
      const target = targets[m] || 0;
      if (agg[m].total > target) {
        issues.push({
          macro: m,
          target,
          consumed: agg[m].total,
          deficit: agg[m].total - target
        });
      }
    }
  });

  return issues;
}

/**
 * Validates a custom food entry loaded from persistence.
 * Returns true if the entry is structurally valid, false otherwise.
 */
export function isValidCustomFoodEntry(cf) {
  if (!cf || typeof cf !== 'object') return false;
  if (typeof cf.id !== 'string' || cf.id.trim() === '') return false;
  if (typeof cf.name !== 'string' || cf.name.trim() === '') return false;
  if (typeof cf.amount !== 'number' || isNaN(cf.amount) || cf.amount <= 0) return false;
  if (typeof cf.unit !== 'string' || cf.unit.trim() === '') return false;

  for (const m of MACROS) {
    const v = cf[m];
    if (v !== null && v !== undefined) {
      if (typeof v !== 'number' || isNaN(v) || v < 0) return false;
    }
    if (cf.ranges && cf.ranges[m]) {
      const r = cf.ranges[m];
      if (typeof r !== 'object') return false;
      if (typeof r.min !== 'number' || isNaN(r.min) || r.min < 0) return false;
      if (typeof r.max !== 'number' || isNaN(r.max) || r.max < 0) return false;
      if (r.min > r.max) return false;
      if (v !== null && v !== undefined && (v < r.min || v > r.max)) return false;
    }
  }

  return true;
}

/**
 * Canonical meal resolver for custom foods.
 * Resolves a meal reference string (id or name) against the meals list.
 * Returns { id: string, name: string } if resolved, or null if unassigned.
 */
export function resolveMeal(mealRef, meals = state.meals) {
  if (!mealRef || typeof mealRef !== 'string') return null;
  const trimmed = mealRef.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'unassigned') return null;

  const mealList = Array.isArray(meals) ? meals : [];
  const found = mealList.find(m =>
    m.id === trimmed ||
    m.name === trimmed ||
    (typeof m.name === 'string' && m.name.toLowerCase() === trimmed.toLowerCase())
  );

  if (found) {
    return { id: found.id, name: found.name };
  }

  return { id: trimmed, name: trimmed };
}
