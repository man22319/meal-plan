// ══════════════════════════════════════════
// HISTORY — Pure Snapshot & Longitudinal Data Management
// ══════════════════════════════════════════

import { getLocalDateString } from './stats.js';

/**
 * Creates an immutable snapshot from the current solver result state.
 * Captures all allocated items in the active meal plan with exact physical portion,
 * unit, servings, and frozen nutrient contributions.
 */
export function createIntakeSnapshot(stateObj, dateStr = null, recordedAtStr = null) {
  const date = dateStr || getLocalDateString();
  const recordedAt = recordedAtStr || new Date().toISOString();

  if (!stateObj?.result?.mealResults || !Array.isArray(stateObj.result.mealResults)) {
    return null;
  }

  const items = [];
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  stateObj.result.mealResults.forEach((meal, mealIdx) => {
    if (!meal.items || !Array.isArray(meal.items)) return;

    meal.items.forEach(item => {
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

      totalCalories += itemCalories;
      totalProtein += itemProtein;
      totalCarbs += itemCarbs;
      totalFat += itemFat;

      items.push({
        mealId: item.mealId || meal.id || `meal_${mealIdx}`,
        mealName: meal.name,
        ingredientId: item.id || `ing_${item.name}`,
        ingredientName: item.name,
        quantity: item.quantity,
        unit: item.unit || ing.unit || 'g',
        servings: Number(servings.toFixed(4)),
        isEaten: Boolean(item.isEaten),
        isActual: Boolean(item.isActual),
        nutrients: {
          calories: Math.round(itemCalories * 100) / 100,
          protein: Math.round(itemProtein * 100) / 100,
          carbs: Math.round(itemCarbs * 100) / 100,
          fat: Math.round(itemFat * 100) / 100
        }
      });
    });
  });

  return {
    date,
    recordedAt,
    items,
    totals: {
      calories: Math.round(totalCalories * 100) / 100,
      protein: Math.round(totalProtein * 100) / 100,
      carbs: Math.round(totalCarbs * 100) / 100,
      fat: Math.round(totalFat * 100) / 100
    }
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
