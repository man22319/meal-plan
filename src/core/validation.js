// ══════════════════════════════════════════
// VALIDATION — target, meal, ingredient checks
// ══════════════════════════════════════════

import { AVAILABILITY_STATES, state } from './state.js';

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

      const servingSize = (ing.servingSize === '' || typeof ing.servingSize === 'undefined') ? 100 : ing.servingSize;
      const calories = (ing.calories === '' || typeof ing.calories === 'undefined') ? 0 : ing.calories;
      const protein = (ing.protein === '' || typeof ing.protein === 'undefined') ? 0 : ing.protein;
      const carbs = (ing.carbs === '' || typeof ing.carbs === 'undefined') ? 0 : ing.carbs;
      const fat = (ing.fat === '' || typeof ing.fat === 'undefined') ? 0 : ing.fat;
      const minServings = (ing.minServings === '' || typeof ing.minServings === 'undefined') ? 0 : ing.minServings;
      const maxServings = (ing.maxServings === '' || typeof ing.maxServings === 'undefined') ? 5 : ing.maxServings;

      if (typeof servingSize !== 'number' || isNaN(servingSize) || servingSize <= 0) {
        errors.push(`"${label}": serving size must be positive.`);
      }
      if (!ing.unit || ing.unit.trim() === '') {
        errors.push(`"${label}": unit is empty.`);
      }
      const macros = { calories, protein, carbs, fat };
      ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
        if (typeof macros[k] !== 'number' || isNaN(macros[k])) {
          errors.push(`"${label}": ${k} must be a number.`);
        } else if (macros[k] < 0) {
          errors.push(`"${label}": ${k} cannot be negative.`);
        }
      });
      if (typeof minServings !== 'undefined' && (typeof minServings !== 'number' || isNaN(minServings) || minServings < 0)) {
        errors.push(`"${label}": min servings cannot be negative.`);
      }
      if (typeof maxServings !== 'undefined' && (typeof maxServings !== 'number' || isNaN(maxServings) || maxServings <= 0)) {
        errors.push(`"${label}": max servings must be positive.`);
      }
      if (typeof minServings === 'number' && typeof maxServings === 'number' && minServings > maxServings) {
        errors.push(`"${label}": min servings (${minServings}) cannot exceed max servings (${maxServings}).`);
      }
      if (typeof ing.quantityMode !== 'undefined' && ing.quantityMode !== 'continuous' && ing.quantityMode !== 'discrete') {
        errors.push(`"${label}": quantity mode must be "continuous" or "discrete".`);
      }
      if (typeof ing.availability !== 'undefined' && !AVAILABILITY_STATES.includes(ing.availability)) {
        errors.push(`"${label}": availability must be "normal", "low", "limited", or "out".`);
      }
    });
    return errors;
  },

  validateMealConstraints() {
    const errors = [];
    const mc = state.mealConstraints;
    if (!mc) return errors;
    const availableCount = state.ingredients.filter(ing => ing.availability !== 'out').length;
    if (typeof mc.minIngredients === 'number') {
      if (mc.minIngredients < 0) {
        errors.push('Min ingredients per meal cannot be negative.');
      } else if (mc.minIngredients > availableCount) {
        errors.push(`Min ingredients per meal (${mc.minIngredients}) cannot exceed available ingredients (${availableCount}).`);
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
