// ══════════════════════════════════════════
// SOLVER — LP model construction + invocation
// ══════════════════════════════════════════
// Uses javascript-lp-solver (loaded as global `solver` via CDN script tag).
// Linearizes absolute-value deviation with d+/d- auxiliary variables.

import { state } from './state.js';
import { Validation } from './validation.js';

export const Optimization = {
  /**
   * Runs validation, builds LP model, solves, and writes state.result.
   * Returns { errors: string[] } if validation fails,
   *         { result: object }   on success.
   */
  solve() {
    const errors = Validation.validateAll();
    if (errors.length > 0) {
      state.result = null;
      return { errors };
    }

    const { targets, meals, ingredients, weights } = state;
    const macros = ['calories', 'protein', 'carbs', 'fat'];
    const mw = [weights.calories, weights.protein, weights.carbs, weights.fat];

    const model = {
      optimize: 'cost',
      opType: 'min',
      constraints: {},
      variables: {}
    };

    // Daily macro constraints: sum(x_ij * M_i) + dMinus - dPlus = M*
    macros.forEach((m, mi) => {
      const c = `daily_${m}`;
      model.constraints[c] = { equal: targets[m] };
      const coeff = mw[mi] / targets[m];
      model.variables[`dP_${m}`] = { cost: coeff, [c]: -1 };
      model.variables[`dM_${m}`] = { cost: coeff, [c]: 1 };
    });

    // Meal calorie constraints: sum(x_ij * K_i) + dMinus_j - dPlus_j = alpha_j * K*
    meals.forEach((meal, j) => {
      const tgt = (meal.pct / 100) * targets.calories;
      if (tgt <= 0) return;
      const c = `meal_${j}`;
      model.constraints[c] = { equal: tgt };
      const coeff = weights.mealAllocation / tgt;
      model.variables[`mdP_${j}`] = { cost: coeff, [c]: -1 };
      model.variables[`mdM_${j}`] = { cost: coeff, [c]: 1 };
    });

    // Decision variables: x_i_j = servings of ingredient i in meal j
    ingredients.forEach((ing, i) => {
      meals.forEach((_, j) => {
        const v = `x_${i}_${j}`;
        const entry = { cost: 0 };
        macros.forEach(m => { entry[`daily_${m}`] = ing[m]; });
        entry[`meal_${j}`] = ing.calories;
        model.variables[v] = entry;
      });
    });

    // Invoke solver
    let raw;
    try {
      const solverInstance = typeof solver !== 'undefined' ? solver : (typeof window !== 'undefined' ? window.solver : null);
      if (!solverInstance || typeof solverInstance.Solve !== 'function') {
        throw new Error('LP Solver library is not loaded. Please ensure solver.js is included.');
      }
      raw = solverInstance.Solve(model);
    } catch (e) {
      return { errors: ['Solver error: ' + (e.message || 'unknown failure.')] };
    }

    if (!raw || !raw.feasible) {
      if (raw && typeof raw === 'object') {
        state.result = Optimization._extract(raw, true);
        return { errors: ['No exact solution found. Displaying best approximation.'], result: state.result };
      }
      return { errors: ['No feasible solution. Check that ingredients can satisfy the targets.'] };
    }

    state.result = Optimization._extract(raw, false);
    return { result: state.result };
  },

  _extract(raw, approximate) {
    const { meals, ingredients, targets } = state;

    const mealResults = meals.map((meal, j) => {
      const items = [];
      let mCal = 0, mPro = 0, mCarb = 0, mFat = 0;

      ingredients.forEach((ing, i) => {
        const s = raw[`x_${i}_${j}`] || 0;
        if (s > 0.001) {
          items.push({ name: ing.name, quantity: s * ing.servingSize, unit: ing.unit, servings: s });
          mCal += s * ing.calories;
          mPro += s * ing.protein;
          mCarb += s * ing.carbs;
          mFat += s * ing.fat;
        }
      });

      const tgt = (meal.pct / 100) * targets.calories;
      return {
        name: meal.name, pct: meal.pct, items,
        calories: mCal, protein: mPro, carbs: mCarb, fat: mFat,
        targetCalories: tgt, calDeviation: mCal - tgt
      };
    });

    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    mealResults.forEach(m => {
      totals.calories += m.calories;
      totals.protein += m.protein;
      totals.carbs += m.carbs;
      totals.fat += m.fat;
    });

    const deviations = {};
    ['calories', 'protein', 'carbs', 'fat'].forEach(m => {
      deviations[m] = {
        absolute: totals[m] - targets[m],
        percentage: ((totals[m] - targets[m]) / targets[m]) * 100
      };
    });

    return { mealResults, totals, deviations, approximate };
  }
};
