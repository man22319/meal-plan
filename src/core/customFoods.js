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

import { state, generateId } from './state.js';

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
    let range = rawRanges[m];

    if (field && typeof field === 'object' && ('value' in field || 'status' in field || 'range' in field)) {
      val = field.value;
      if (field.status !== undefined) status = field.status;
      if (field.range !== undefined) range = field.range;
    } else {
      val = field;
    }

    // Validate value
    if (val !== null && val !== undefined) {
      if (typeof val !== 'number' || isNaN(val) || val < 0) {
        errors.push(`${m} must be a non-negative number or blank.`);
      }
    }

    // Determine status if not explicitly given
    const effStatus = (val === null || val === undefined)
      ? 'unknown'
      : (status || 'known');

    // Range checks
    if (range !== null && range !== undefined) {
      if (typeof range !== 'object') {
        errors.push(`${m} range must be an object.`);
      } else if (effStatus === 'known') {
        errors.push(`${m} range cannot be supplied for known nutrients.`);
      } else if (effStatus === 'unknown' || val === null || val === undefined) {
        errors.push(`${m} range cannot be supplied for unknown nutrients.`);
      } else if (effStatus === 'estimated') {
        const { min, max } = range;
        if (min !== null && min !== undefined || max !== null && max !== undefined) {
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
    let range = rawRanges[m];

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

    // Determine canonical status
    if (val === null || val === undefined) {
      status = 'unknown';
    } else if (!status || !CONFIDENCE_VALUES.includes(status) || status === 'unknown') {
      status = (range && typeof range === 'object') ? 'estimated' : 'known';
    }

    finalConf[m] = status;

    // Determine canonical range
    if (status === 'estimated' && range && typeof range === 'object') {
      const min = typeof range.min === 'number' && !isNaN(range.min) ? range.min : null;
      const max = typeof range.max === 'number' && !isNaN(range.max) ? range.max : null;
      if (min !== null && max !== null) {
        finalRanges[m] = { min, max };
      } else {
        finalRanges[m] = null;
      }
    } else {
      finalRanges[m] = null;
    }
  });

  normalized.confidence = finalConf;
  normalized.ranges = finalRanges;

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
 * - KNOWN: recorded value
 * - ESTIMATED + range: midpoint (min + max) / 2
 * - ESTIMATED + no range: recorded value
 * - UNKNOWN: null (no numerical planning contribution)
 */
export function getPlanningValue(nutrient, customFood) {
  if (!customFood || typeof customFood !== 'object') return null;

  let val = customFood[nutrient];
  let status = customFood.confidence?.[nutrient];
  let range = customFood.ranges?.[nutrient];

  if (val && typeof val === 'object' && ('value' in val || 'status' in val || 'range' in val)) {
    if (val.status !== undefined) status = val.status;
    if (val.range !== undefined) range = val.range;
    val = val.value;
  }

  if (!status) {
    status = (val === null || val === undefined) ? 'unknown' : 'known';
  }

  if (status === 'known') {
    return (typeof val === 'number' && !isNaN(val)) ? val : null;
  }

  if (status === 'estimated') {
    if (range && typeof range === 'object' &&
        typeof range.min === 'number' && !isNaN(range.min) &&
        typeof range.max === 'number' && !isNaN(range.max)) {
      return (range.min + range.max) / 2;
    }
    return (typeof val === 'number' && !isNaN(val)) ? val : null;
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
    unit: norm.unit.trim(),
    calories: norm.calories ?? null,
    protein: norm.protein ?? null,
    carbs: norm.carbs ?? null,
    fat: norm.fat ?? null,
    confidence: norm.confidence,
    ranges: norm.ranges,
    meal: norm.meal || null
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
  existing.unit = norm.unit.trim();
  existing.calories = norm.calories ?? null;
  existing.protein = norm.protein ?? null;
  existing.carbs = norm.carbs ?? null;
  existing.fat = norm.fat ?? null;
  existing.confidence = norm.confidence;
  existing.ranges = norm.ranges;
  existing.meal = norm.meal || null;

  return { entry: existing };
}

export function removeCustomFood(id) {
  const idx = state.customFoods.findIndex(cf => cf.id === id);
  if (idx === -1) return { errors: ['Custom food not found.'] };
  const removed = state.customFoods.splice(idx, 1)[0];
  return { removed };
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
      const status = cf.confidence?.[m] || (cf[m] === null || cf[m] === undefined ? 'unknown' : 'known');
      if (status === 'unknown') {
        result[m].hasUnknown = true;
      }

      if (usePlanning) {
        const pVal = getPlanningValue(m, cf);
        if (pVal !== null) {
          result[m].total += pVal;
          result[m].known += pVal;
        }
      } else {
        const rVal = getRecordedValue(m, cf);
        if (rVal !== null) {
          result[m].total += rVal;
          result[m].known += rVal;
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
