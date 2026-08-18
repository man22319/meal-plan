// ══════════════════════════════════════════
// SOLVER — MILP model construction + invocation
// ══════════════════════════════════════════
// Uses javascript-lp-solver (loaded as global `solver` via vendor script).
// Mixed-Integer Linear Programming with binary selection variables (z_ij),
// serving bounds (minServings / maxServings), meal ingredient limits,
// and deviation linearization with d+/d- auxiliary variables.

import { state } from './state.js';
import { Validation } from './validation.js';

export const Optimization = {
  /**
   * Runs validation, builds MILP model, solves, and writes state.result.
   * Returns { errors: string[] } if validation or structural feasibility fails,
   *         { result: object }   on success.
   */
  solve() {
    const errors = Validation.validateAll();
    if (errors.length > 0) {
      state.result = null;
      return { errors };
    }

    const { targets, meals, ingredients, weights, penalties, mealConstraints } = state;
    const macros = ['calories', 'protein', 'carbs', 'fat'];
    const mw = [weights.calories, weights.protein, weights.carbs, weights.fat];

    const simplicityPenalty = (penalties && typeof penalties.simplicity === 'number') ? penalties.simplicity : 0.0005;
    const quantityPenalty = (penalties && typeof penalties.quantity === 'number') ? penalties.quantity : 0.00001;

    const minIngPerMeal = mealConstraints && typeof mealConstraints.minIngredients === 'number' ? mealConstraints.minIngredients : 0;
    const maxIngPerMeal = mealConstraints && typeof mealConstraints.maxIngredients === 'number' ? mealConstraints.maxIngredients : 0;

    const model = {
      optimize: 'cost',
      opType: 'min',
      constraints: {},
      variables: {},
      binaries: {}
    };

    // 1. Daily macro constraints (with deviation variables dP and dM)
    // sum_j sum_i (x_ij * Macro_i) + dM_m - dP_m = target_m
    macros.forEach((m, mi) => {
      const c = `daily_${m}`;
      model.constraints[c] = { equal: targets[m] };
      const coeff = targets[m] > 0 ? mw[mi] / targets[m] : 1.0;
      model.variables[`dP_${m}`] = { cost: coeff, [c]: -1 };
      model.variables[`dM_${m}`] = { cost: coeff, [c]: 1 };
    });

    // 2. Meal calorie allocation constraints (soft target per meal)
    // sum_i (x_ij * cal_i) + mdM_j - mdP_j = mealTargetCal_j
    meals.forEach((meal, j) => {
      const tgt = (meal.pct / 100) * targets.calories;
      if (tgt <= 0) return;
      const c = `meal_${j}`;
      model.constraints[c] = { equal: tgt };
      const coeff = targets.calories > 0 ? (weights.mealAllocation / targets.calories) : 0.001;
      model.variables[`mdP_${j}`] = { cost: coeff, [c]: -1 };
      model.variables[`mdM_${j}`] = { cost: coeff, [c]: 1 };
    });

    // 3. Per-meal ingredient count constraints
    // minIngredients <= sum_i z_ij <= maxIngredients
    meals.forEach((_, j) => {
      if (minIngPerMeal > 0) {
        model.constraints[`meal_ing_min_${j}`] = { min: minIngPerMeal };
      }
      if (maxIngPerMeal > 0) {
        model.constraints[`meal_ing_max_${j}`] = { max: maxIngPerMeal };
      }
    });

    // 4. Decision variables: x_i_j (servings) and z_i_j (binary selection)
    ingredients.forEach((ing, i) => {
      const maxS = typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 10;
      const minS = typeof ing.minServings === 'number' && ing.minServings > 0 ? ing.minServings : 0;

      meals.forEach((_, j) => {
        const v_x = `x_${i}_${j}`;
        const v_z = `z_${i}_${j}`;

        // Declare z_i_j as binary
        model.binaries[v_z] = 1;

        // Binary selection variable entry with weak simplicity penalty
        const zEntry = {
          cost: simplicityPenalty
        };

        // Continuous servings variable entry with minute quantity penalty
        const xEntry = {
          cost: quantityPenalty
        };

        // Contribute to daily macros
        macros.forEach(m => {
          xEntry[`daily_${m}`] = ing[m];
        });

        // Contribute to meal calories
        xEntry[`meal_${j}`] = ing.calories;

        // Link upper bound: x_ij <= maxServings_i * z_ij  =>  x_ij - maxServings_i * z_ij <= 0
        const linkMax = `link_max_${i}_${j}`;
        model.constraints[linkMax] = { max: 0 };
        xEntry[linkMax] = 1;
        zEntry[linkMax] = -maxS;

        // Link lower bound: x_ij >= minServings_i * z_ij  =>  x_ij - minServings_i * z_ij >= 0 (if minServings > 0)
        if (minS > 0) {
          const linkMin = `link_min_${i}_${j}`;
          model.constraints[linkMin] = { min: 0 };
          xEntry[linkMin] = 1;
          zEntry[linkMin] = -minS;
        }

        // Link to meal ingredient limits
        if (minIngPerMeal > 0) {
          zEntry[`meal_ing_min_${j}`] = 1;
        }
        if (maxIngPerMeal > 0) {
          zEntry[`meal_ing_max_${j}`] = 1;
        }

        model.variables[v_x] = xEntry;
        model.variables[v_z] = zEntry;
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
      return { errors: ['Structural infeasibility: No valid solution satisfies the current constraints (e.g. ingredient serving bounds or meal ingredient limits). Try adjusting ingredient limits.'] };
    }

    state.result = Optimization._extract(raw);
    return { result: state.result };
  },

  _extract(raw) {
    const { meals, ingredients, targets } = state;

    const mealResults = meals.map((meal, j) => {
      const items = [];
      let mCal = 0, mPro = 0, mCarb = 0, mFat = 0;

      ingredients.forEach((ing, i) => {
        const s = raw[`x_${i}_${j}`] || 0;
        const z = raw[`z_${i}_${j}`] || 0;
        if (s > 0.001) {
          items.push({
            name: ing.name,
            quantity: s * ing.servingSize,
            unit: ing.unit,
            servings: s,
            selected: z > 0.5
          });
          mCal += s * ing.calories;
          mPro += s * ing.protein;
          mCarb += s * ing.carbs;
          mFat += s * ing.fat;
        }
      });

      const tgt = (meal.pct / 100) * targets.calories;
      return {
        name: meal.name,
        pct: meal.pct,
        items,
        calories: mCal,
        protein: mPro,
        carbs: mCarb,
        fat: mFat,
        targetCalories: tgt,
        calDeviation: mCal - tgt
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
      const absDev = totals[m] - targets[m];
      const pctDev = targets[m] > 0 ? (absDev / targets[m]) * 100 : 0;
      deviations[m] = {
        absolute: absDev,
        percentage: pctDev
      };
    });

    // Check whether nutritional solution is approximate due to constraints
    const approximate =
      Math.abs(deviations.calories.absolute) > 50 ||
      Math.abs(deviations.protein.percentage) > 5 ||
      Math.abs(deviations.carbs.percentage) > 5 ||
      Math.abs(deviations.fat.percentage) > 5;

    return { mealResults, totals, deviations, approximate };
  }
};
