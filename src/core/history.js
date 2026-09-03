// ══════════════════════════════════════════
// HISTORY — Pure Snapshot & Longitudinal Data Management
// ══════════════════════════════════════════

import { getLocalDateString } from './stats.js';
import { resolveMeal } from './customFoods.js';

const MACROS = ['calories', 'protein', 'carbs', 'fat'];

function collectEatenIngredients(stateObj) {
  if (!stateObj?.result?.mealResults || !Array.isArray(stateObj.result.mealResults)) {
    return [];
  }
  const items = [];
  stateObj.result.mealResults.forEach((meal, mealIdx) => {
    if (!meal.items || !Array.isArray(meal.items)) return;

    meal.items.forEach(item => {
      // Only snapshot items that have been explicitly marked EATEN
      if (!item.isEaten) return;

      // Look up current ingredient metadata to freeze nutrient values
      const ing = (stateObj.ingredients || []).find(i => i.id === item.id || i.name === item.name) || {};
      const servingSize = (item.servingSize && item.servingSize > 0) ? item.servingSize : (ing.servingSize || 100);
      const servings = item.servings || (item.quantity / servingSize);

      const calPerServ = typeof ing.calories === 'number' ? ing.calories : 0;
      const proPerServ = typeof ing.protein === 'number' ? ing.protein : 0;
      const carbPerServ = typeof ing.carbs === 'number' ? ing.carbs : 0;
      const fatPerServ = typeof ing.fat === 'number' ? ing.fat : 0;

      const itemCalories = servings * calPerServ;
      const itemProtein = servings * proPerServ;
      const itemCarbs = servings * carbPerServ;
      const itemFat = servings * fatPerServ;

      items.push({
        mealId: item.mealId || meal.id || `meal_${mealIdx}`,
        mealName: meal.name,
        ingredientId: item.id || `ing_${item.name}`,
        ingredientName: item.name,
        quantity: item.quantity,
        unit: item.unit || ing.unit || 'g',
        servings: Number(servings.toFixed(4)),
        isEaten: true,
        isActual: Boolean(item.isActual),
        isCustomFood: false,
        nutrients: {
          calories: Math.round(itemCalories * 100) / 100,
          protein: Math.round(itemProtein * 100) / 100,
          carbs: Math.round(itemCarbs * 100) / 100,
          fat: Math.round(itemFat * 100) / 100
        }
      });
    });
  });
  return items;
}

function collectCustomFoods(stateObj) {
  if (!stateObj?.customFoods || !Array.isArray(stateObj.customFoods)) {
    return [];
  }
  return stateObj.customFoods.map(cf => {
    const resolvedMeal = resolveMeal(cf.meal, stateObj.meals);
    const mealId = resolvedMeal ? resolvedMeal.id : null;
    const mealName = resolvedMeal ? resolvedMeal.name : 'Unassigned';

    return {
      mealId,
      mealName,
      ingredientId: cf.id,
      customFoodId: cf.id,
      ingredientName: cf.name,
      quantity: cf.amount,
      unit: cf.unit,
      servings: 1,
      isEaten: true,
      isActual: true,
      isCustomFood: true,
      confidence: cf.confidence ? { ...cf.confidence } : null,
      nutrients: {
        calories: typeof cf.calories === 'number' ? Math.round(cf.calories * 100) / 100 : null,
        protein: typeof cf.protein === 'number' ? Math.round(cf.protein * 100) / 100 : null,
        carbs: typeof cf.carbs === 'number' ? Math.round(cf.carbs * 100) / 100 : null,
        fat: typeof cf.fat === 'number' ? Math.round(cf.fat * 100) / 100 : null
      }
    };
  });
}

/**
 * Creates an immutable snapshot from the current solver result state and custom foods.
 * Only captures solver items marked EATEN along with all day-specific custom foods.
 *
 * Totals represent the sum of all known values. totals[k] is null only when zero values
 * for that nutrient are known. totals[k + 'Unknown'] indicates whether any contributing
 * item has an unknown value.
 *
 * Returns null if neither solver results nor custom foods exist.
 */
export function createIntakeSnapshot(stateObj, dateStr = null, recordedAtStr = null) {
  const date = dateStr || getLocalDateString();
  const recordedAt = recordedAtStr || new Date().toISOString();

  const eatenIngredients = collectEatenIngredients(stateObj);
  const customFoodItems = collectCustomFoods(stateObj);
  const items = [...eatenIngredients, ...customFoodItems];

  const hasSolverResult = Boolean(stateObj?.result?.mealResults && Array.isArray(stateObj.result.mealResults));
  const hasCustomFoods = Array.isArray(stateObj?.customFoods) && stateObj.customFoods.length > 0;

  // If no solver result and no custom foods exist, return null
  if (!hasSolverResult && !hasCustomFoods) {
    return null;
  }

  // If solver result existed or custom foods array existed but 0 items were eaten/logged
  if (items.length === 0) {
    return {
      date,
      recordedAt,
      eatenItemCount: 0,
      items: [],
      totals: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        caloriesUnknown: false,
        proteinUnknown: false,
        carbsUnknown: false,
        fatUnknown: false
      }
    };
  }

  const knownTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const hasKnown = { calories: false, protein: false, carbs: false, fat: false };
  const hasUnknown = { calories: false, protein: false, carbs: false, fat: false };

  items.forEach(it => {
    MACROS.forEach(m => {
      const v = it.nutrients ? it.nutrients[m] : null;
      if (typeof v === 'number' && !isNaN(v)) {
        knownTotals[m] += v;
        hasKnown[m] = true;
      } else {
        hasUnknown[m] = true;
      }
    });
  });

  const totals = {};
  MACROS.forEach(m => {
    totals[m] = hasKnown[m] ? Math.round(knownTotals[m] * 100) / 100 : null;
    totals[`${m}Unknown`] = Boolean(hasUnknown[m]);
  });

  return {
    date,
    recordedAt,
    eatenItemCount: items.length,
    items,
    totals
  };
}

/**
 * Records or updates a canonical daily weight measurement in the history map.
 * Enforces exactly one record per calendar date.
 */
export function recordWeightEntry(weightHistory = {}, weightValue, dateStr = null, recordedAtStr = null) {
  const date = dateStr || getLocalDateString();
  const recordedAt = recordedAtStr || new Date().toISOString();
  const weight = Number(weightValue);

  if (isNaN(weight) || weight <= 0) {
    return { error: 'Weight must be a positive number.' };
  }

  const updated = {
    ...weightHistory,
    [date]: {
      weight: Math.round(weight * 100) / 100,
      recordedAt
    }
  };

  return { weightHistory: updated, date, weight };
}

/**
 * Records or updates a daily intake snapshot in the history map.
 * Enforces exactly one snapshot per calendar date.
 */
export function recordIntakeSnapshot(intakeHistory = {}, snapshot) {
  if (!snapshot || !snapshot.date || !snapshot.totals) {
    return { error: 'Invalid intake snapshot.' };
  }

  const updated = {
    ...intakeHistory,
    [snapshot.date]: JSON.parse(JSON.stringify(snapshot))
  };

  return { intakeHistory: updated, date: snapshot.date };
}
