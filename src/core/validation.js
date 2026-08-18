// ══════════════════════════════════════════
// VALIDATION — target, meal, ingredient checks
// ══════════════════════════════════════════

import { state } from './state.js';

export const Validation = {
  validateAll() {
    return [
      ...Validation.validateTargets(),
      ...Validation.validateMeals(),
      ...Validation.validateIngredients(),
      ...Validation.validateMealConstraints()
    ];
  },

  validateTargets() {
    const errors = [];
    const t = state.targets;
    ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
      if (typeof t[k] !== 'number' || isNaN(t[k])) {
        errors.push(`Target ${k}: must be a number.`);
      } else if (t[k] <= 0) {
        errors.push(`Target ${k}: must be positive.`);
      }
    });
    return errors;
  },

  validateMeals() {
    const errors = [];
    if (state.meals.length === 0) {
      errors.push('At least one meal is required.');
      return errors;
    }
    let totalPct = 0;
    state.meals.forEach((m, i) => {
      if (!m.name || m.name.trim() === '') {
        errors.push(`Meal ${i + 1}: name is empty.`);
      }
      if (typeof m.pct !== 'number' || isNaN(m.pct)) {
        errors.push(`Meal ${i + 1}: percentage must be a number.`);
      } else if (m.pct < 0) {
        errors.push(`Meal ${i + 1}: percentage cannot be negative.`);
      } else if (m.pct > 100) {
        errors.push(`Meal ${i + 1}: percentage cannot exceed 100.`);
      } else {
        totalPct += m.pct;
      }
    });
    if (Math.abs(totalPct - 100) > 0.01) {
      errors.push(`Meal percentages total ${totalPct.toFixed(1)}%. Must equal 100%.`);
    }
    return errors;
  },

  validateIngredients() {
    const errors = [];
    if (state.ingredients.length === 0) {
      errors.push('At least one ingredient is required.');
      return errors;
    }
    state.ingredients.forEach((ing, i) => {
      const label = ing.name || `#${i + 1}`;
      if (!ing.name || ing.name.trim() === '') {
        errors.push(`Ingredient ${i + 1}: name is empty.`);
      }
      if (typeof ing.servingSize !== 'number' || isNaN(ing.servingSize) || ing.servingSize <= 0) {
        errors.push(`"${label}": serving size must be positive.`);
      }
      if (!ing.unit || ing.unit.trim() === '') {
        errors.push(`"${label}": unit is empty.`);
      }
      ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
        if (typeof ing[k] !== 'number' || isNaN(ing[k])) {
          errors.push(`"${label}": ${k} must be a number.`);
        } else if (ing[k] < 0) {
          errors.push(`"${label}": ${k} cannot be negative.`);
        }
      });
      if (typeof ing.minServings !== 'undefined' && (typeof ing.minServings !== 'number' || isNaN(ing.minServings) || ing.minServings < 0)) {
        errors.push(`"${label}": min servings cannot be negative.`);
      }
      if (typeof ing.maxServings !== 'undefined' && (typeof ing.maxServings !== 'number' || isNaN(ing.maxServings) || ing.maxServings <= 0)) {
        errors.push(`"${label}": max servings must be positive.`);
      }
      if (typeof ing.minServings === 'number' && typeof ing.maxServings === 'number' && ing.minServings > ing.maxServings) {
        errors.push(`"${label}": min servings (${ing.minServings}) cannot exceed max servings (${ing.maxServings}).`);
      }
    });
    return errors;
  },

  validateMealConstraints() {
    const errors = [];
    const mc = state.mealConstraints;
    if (!mc) return errors;
    if (typeof mc.minIngredients === 'number') {
      if (mc.minIngredients < 0) {
        errors.push('Min ingredients per meal cannot be negative.');
      } else if (mc.minIngredients > state.ingredients.length) {
        errors.push(`Min ingredients per meal (${mc.minIngredients}) cannot exceed total available ingredients (${state.ingredients.length}).`);
      }
    }
    if (typeof mc.maxIngredients === 'number') {
      if (mc.maxIngredients < 1) {
        errors.push('Max ingredients per meal must be at least 1.');
      }
    }
    if (typeof mc.minIngredients === 'number' && typeof mc.maxIngredients === 'number') {
      if (mc.minIngredients > mc.maxIngredients) {
        errors.push(`Min ingredients per meal (${mc.minIngredients}) cannot exceed max ingredients per meal (${mc.maxIngredients}).`);
      }
    }
    return errors;
  }
};
