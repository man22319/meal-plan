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

function validateCustomFood(food) {
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
  MACROS.forEach(m => {
    const v = food[m];
    if (v !== null && v !== undefined) {
      if (typeof v !== 'number' || isNaN(v) || v < 0) {
        errors.push(`${m} must be a non-negative number or blank.`);
      }
    }
  });
  return errors;
}

// ── Confidence helpers ──────────────────────

/**
 * Builds a confidence object, syncing with macro values.
 * A null macro forces confidence to 'unknown'.
 * A non-null macro with no explicit confidence defaults to 'known'.
 */
function buildConfidence(food, explicitConfidence) {
  const conf = {};
  MACROS.forEach(m => {
    if (food[m] === null || food[m] === undefined) {
      conf[m] = 'unknown';
    } else if (explicitConfidence && CONFIDENCE_VALUES.includes(explicitConfidence[m])) {
      // If macro is non-null but explicit says 'unknown', that's contradictory — treat as 'estimated'
      conf[m] = explicitConfidence[m] === 'unknown' ? 'estimated' : explicitConfidence[m];
    } else {
      conf[m] = 'known';
    }
  });
  return conf;
}

// ── CRUD ────────────────────────────────────

export function addCustomFood(food) {
  const errors = validateCustomFood(food);
  if (errors.length > 0) return { errors };

  const entry = {
    id: generateId('cf'),
    name: food.name.trim(),
    amount: food.amount,
    unit: food.unit.trim(),
    calories: food.calories ?? null,
    protein: food.protein ?? null,
    carbs: food.carbs ?? null,
    fat: food.fat ?? null,
    confidence: buildConfidence(food, food.confidence),
    meal: food.meal || null
  };

  state.customFoods.push(entry);
  return { entry };
}

export function updateCustomFood(id, patch) {
  const idx = state.customFoods.findIndex(cf => cf.id === id);
  if (idx === -1) return { errors: ['Custom food not found.'] };

  const existing = state.customFoods[idx];

  // Apply field patches
  if (typeof patch.name === 'string' && patch.name.trim() !== '') {
    existing.name = patch.name.trim();
  }
  if (typeof patch.amount === 'number' && !isNaN(patch.amount) && patch.amount > 0) {
    existing.amount = patch.amount;
  }
  if (typeof patch.unit === 'string' && patch.unit.trim() !== '') {
    existing.unit = patch.unit.trim();
  }
  MACROS.forEach(m => {
    if (m in patch) {
      existing[m] = (patch[m] === null || patch[m] === undefined) ? null
        : (typeof patch[m] === 'number' && !isNaN(patch[m]) && patch[m] >= 0) ? patch[m]
        : existing[m];
    }
  });
  if (patch.meal !== undefined) {
    existing.meal = patch.meal || null;
  }

  // Rebuild confidence with any explicit overrides
  existing.confidence = buildConfidence(existing, patch.confidence || existing.confidence);

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
 * Returns per-macro: { known: number, hasUnknown: boolean }
 *
 * `known` accumulates all non-null values.
 * `hasUnknown` is true if ANY food has null for that macro.
 *
 * @param {string|null} mealFilter - if provided, only include custom foods assigned to this meal
 * @param {Array} customFoods - optional custom foods array (defaults to state.customFoods)
 */
export function aggregateCustomFoods(mealFilter = null, customFoods = null) {
  const foods = customFoods || state.customFoods;
  const result = {};
  MACROS.forEach(m => {
    result[m] = { known: 0, hasUnknown: false };
  });

  const filtered = mealFilter
    ? foods.filter(cf => cf.meal === mealFilter)
    : foods;

  filtered.forEach(cf => {
    MACROS.forEach(m => {
      if (cf[m] === null || cf[m] === undefined) {
        result[m].hasUnknown = true;
      } else {
        result[m].known += cf[m];
      }
    });
  });

  return result;
}

/**
 * Computes remaining daily targets after subtracting known custom food contributions.
 *
 * For each macro:
 * - If all custom foods have known values: remaining = target - sum(known)
 * - If any custom food has unknown: remaining = target (no constraint imposed)
 *   but the known contributions are still tracked separately
 *
 * @returns {{ [macro]: { value: number, known: boolean, consumed: number } }}
 */
export function getRemainingTargets(targets, customFoods = null) {
  const agg = aggregateCustomFoods(null, customFoods);
  const result = {};

  MACROS.forEach(m => {
    const target = targets[m] || 0;
    if (agg[m].hasUnknown) {
      // Can't constrain this dimension — use original target
      result[m] = {
        value: target,
        known: false,
        consumed: agg[m].known
      };
    } else {
      result[m] = {
        value: target - agg[m].known,
        known: true,
        consumed: agg[m].known
      };
    }
  });

  return result;
}

/**
 * Computes remaining meal-level calorie allocation after subtracting
 * custom foods assigned to that meal.
 *
 * @returns {{ value: number, consumed: number, known: boolean }}
 */
export function getRemainingMealTarget(mealId, mealCalTarget, customFoods = null) {
  const agg = aggregateCustomFoods(mealId, customFoods);
  const calAgg = agg.calories;

  if (calAgg.hasUnknown) {
    return { value: mealCalTarget, consumed: calAgg.known, known: false };
  }
  return { value: mealCalTarget - calAgg.known, consumed: calAgg.known, known: true };
}

/**
 * Detects macro dimensions where known custom food totals exceed daily targets.
 *
 * @returns {Array<{ macro: string, target: number, consumed: number, deficit: number }>}
 */
export function detectInfeasibleDimensions(targets, customFoods = null) {
  const agg = aggregateCustomFoods(null, customFoods);
  const issues = [];

  MACROS.forEach(m => {
    if (!agg[m].hasUnknown) {
      const target = targets[m] || 0;
      if (agg[m].known > target) {
        issues.push({
          macro: m,
          target,
          consumed: agg[m].known,
          deficit: agg[m].known - target
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
