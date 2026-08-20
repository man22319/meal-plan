// ══════════════════════════════════════════
// SOLVER — MILP model construction + invocation
// ══════════════════════════════════════════
// Uses javascript-lp-solver (loaded as global `solver` via vendor script).
// Mixed-Integer Linear Programming with binary selection variables (z_ij),
// serving bounds (minServings / maxServings), meal ingredient limits,
// deviation linearization with d+/d- auxiliary variables,
// and immutable actual portion observation locking.

import { state, ensureId } from './state.js';
import { Validation } from './validation.js';

export function resolveMealAndIngIds(mealRef, ingRef) {
  let mealId = (mealRef && typeof mealRef === 'object') ? mealRef.id : mealRef;
  let ingId = (ingRef && typeof ingRef === 'object') ? ingRef.id : ingRef;

  if (typeof mealRef === 'number' && state.meals[mealRef]) {
    mealId = ensureId(state.meals[mealRef], 'meal');
  } else if (typeof mealRef === 'string') {
    const foundMeal = state.meals.find(m => m.id === mealRef || m.name === mealRef);
    if (foundMeal) mealId = ensureId(foundMeal, 'meal');
  }

  if (typeof ingRef === 'number' && state.ingredients[ingRef]) {
    ingId = ensureId(state.ingredients[ingRef], 'ing');
  } else if (typeof ingRef === 'string') {
    const foundIng = state.ingredients.find(i => i.id === ingRef || i.name === ingRef);
    if (foundIng) ingId = ensureId(foundIng, 'ing');
  }

  return { mealId: mealId || String(mealRef), ingId: ingId || String(ingRef) };
}

export function getActualRecord(meal, ing, mealIdx, _ingIdx) {
  if (!state.actuals || typeof state.actuals !== 'object') return null;
  const mealId = meal?.id;
  const ingId = ing?.id;
  const mealName = meal?.name;
  const ingName = ing?.name;

  if (mealId && ingId && state.actuals[`${mealId}_${ingId}`]) {
    return state.actuals[`${mealId}_${ingId}`];
  }
  if (ingId && state.actuals[`${mealIdx}_${ingId}`]) {
    return state.actuals[`${mealIdx}_${ingId}`];
  }
  if (mealId && ingName && state.actuals[`${mealId}_${ingName}`]) {
    return state.actuals[`${mealId}_${ingName}`];
  }
  if (mealName && ingName && state.actuals[`${mealName}_${ingName}`]) {
    return state.actuals[`${mealName}_${ingName}`];
  }
  if (ingName && state.actuals[`${mealIdx}_${ingName}`]) {
    return state.actuals[`${mealIdx}_${ingName}`];
  }
  return null;
}

export function resolveMealId(mealRef) {
  if (mealRef && typeof mealRef === 'object') {
    if (typeof mealRef.id === 'string' && mealRef.id) return mealRef.id;
    if (typeof mealRef.name === 'string') {
      const found = state.meals.find(m => m.name === mealRef.name || m.id === mealRef.id);
      if (found) return ensureId(found, 'meal');
    }
  }
  if (typeof mealRef === 'number' && state.meals[mealRef]) {
    return ensureId(state.meals[mealRef], 'meal');
  }
  if (typeof mealRef === 'string') {
    const foundMeal = state.meals.find(m => m.id === mealRef || m.name === mealRef);
    if (foundMeal) return ensureId(foundMeal, 'meal');
    return mealRef;
  }
  return mealRef != null ? String(mealRef) : null;
}

export function getEatenMealRecord(meal, mealIdx) {
  if (!state.eatenMeals || typeof state.eatenMeals !== 'object') return null;
  if (meal?.id && state.eatenMeals[meal.id]) return state.eatenMeals[meal.id];
  if (typeof mealIdx === 'number' && state.eatenMeals[String(mealIdx)]) {
    return state.eatenMeals[String(mealIdx)];
  }
  if (meal?.name && state.eatenMeals[meal.name]) return state.eatenMeals[meal.name];
  return null;
}

export function isMealEaten(meal, mealIdx) {
  return Boolean(getEatenMealRecord(meal, mealIdx));
}

export function hasAnyEatenMeals() {
  return Boolean(state.eatenMeals && Object.keys(state.eatenMeals).length > 0);
}

function snapshotMealItems(mealResult) {
  return (mealResult.items || []).map(item => ({
    id: item.id,
    mealId: item.mealId,
    mealIdx: item.mealIdx,
    name: item.name,
    quantity: item.quantity,
    displayQuantity: item.displayQuantity ?? item.quantity,
    plannedQuantity: item.plannedQuantity,
    actualQuantity: item.actualQuantity ?? null,
    isActual: Boolean(item.isActual),
    unit: item.unit,
    servings: item.servings,
    servingSize: item.servingSize,
    selected: item.selected,
    quantityMode: item.quantityMode,
    availability: item.availability
  }));
}

function computeEatenMacroTotals(ingredients) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  state.meals.forEach((meal, j) => {
    const rec = getEatenMealRecord(meal, j);
    if (!rec) return;
    (rec.items || []).forEach(item => {
      const ing = ingredients.find(i => i.id === item.id || i.name === item.name);
      if (!ing) return;
      const servings = typeof item.servings === 'number'
        ? item.servings
        : (Number(item.quantity) || 0) / (ing.servingSize || 100);
      totals.calories += servings * ing.calories;
      totals.protein += servings * ing.protein;
      totals.carbs += servings * ing.carbs;
      totals.fat += servings * ing.fat;
    });
  });
  return totals;
}

function findMealResult(mealId) {
  if (!state.result?.mealResults) return null;
  return state.result.mealResults.find(m => m.id === mealId || m.name === mealId) || null;
}

export const Optimization = {
  /**
   * Runs validation, builds MILP model, solves, and writes state.result.
   * preserveActuals: whether to keep recorded actual portion constraints (default: true).
   */
  solve({ preserveActuals = true } = {}) {
    const errors = Validation.validateAll();
    if (errors.length > 0) {
      if (!hasAnyEatenMeals()) {
        state.result = null;
      }
      return { errors };
    }

    if (!preserveActuals) {
      state.actuals = {};
    }

    state.meals.forEach((m, idx) => ensureId(m, `meal_${idx}`));
    state.ingredients.forEach((ing, idx) => ensureId(ing, `ing_${idx}`));

    const { targets, meals, weights, penalties, mealConstraints } = state;
    const ingredients = state.ingredients.map(ing => ({
      ...ing,
      servingSize: (ing.servingSize === '' || typeof ing.servingSize === 'undefined') ? 100 : Number(ing.servingSize),
      calories: (ing.calories === '' || typeof ing.calories === 'undefined') ? 0 : Number(ing.calories),
      protein: (ing.protein === '' || typeof ing.protein === 'undefined') ? 0 : Number(ing.protein),
      carbs: (ing.carbs === '' || typeof ing.carbs === 'undefined') ? 0 : Number(ing.carbs),
      fat: (ing.fat === '' || typeof ing.fat === 'undefined') ? 0 : Number(ing.fat),
      minServings: (ing.minServings === '' || typeof ing.minServings === 'undefined') ? 0 : Number(ing.minServings),
      maxServings: (ing.maxServings === '' || typeof ing.maxServings === 'undefined') ? 5 : Number(ing.maxServings)
    }));
    const macros = ['calories', 'protein', 'carbs', 'fat'];
    const mw = [weights.calories, weights.protein, weights.carbs, weights.fat];

    const simplicityPenalty = (penalties && typeof penalties.simplicity === 'number') ? penalties.simplicity : 0.0005;
    const quantityPenalty = (penalties && typeof penalties.quantity === 'number') ? penalties.quantity : 0.00001;
    const availabilityLowPenalty = (penalties && typeof penalties.availabilityLow === 'number') ? penalties.availabilityLow : 0.0005;
    const availabilityOutPenalty = (penalties && typeof penalties.availabilityOut === 'number') ? penalties.availabilityOut : 0.002;

    const minIngPerMeal = mealConstraints && typeof mealConstraints.minIngredients === 'number' ? mealConstraints.minIngredients : 0;
    const maxIngPerMeal = mealConstraints && typeof mealConstraints.maxIngredients === 'number' ? mealConstraints.maxIngredients : 0;

    // Determine if discrete integer/binary selection constraints are actively required
    const needsBinaries = (minIngPerMeal > 1) ||
                          (maxIngPerMeal > 0 && maxIngPerMeal < ingredients.length) ||
                          ingredients.some(ing => typeof ing.minServings === 'number' && ing.minServings > 0);

    const hasDiscrete = ingredients.some(ing => ing.quantityMode === 'discrete');

    const model = {
      optimize: 'cost',
      opType: 'min',
      constraints: {},
      variables: {},
      options: {
        timeout: 300,
        tolerance: 0.05
      }
    };

    if (needsBinaries) {
      model.binaries = {};
    }

    if (hasDiscrete) {
      model.ints = {};
    }

    const eatenFlags = meals.map((meal, j) => isMealEaten(meal, j));
    const uneatenIdxs = meals.map((_, j) => j).filter(j => !eatenFlags[j]);
    const eatenTotals = computeEatenMacroTotals(ingredients);

    if (uneatenIdxs.length === 0) {
      state.result = Optimization._extract({});
      return { result: state.result };
    }

    const remainingTargets = {
      calories: targets.calories - eatenTotals.calories,
      protein: targets.protein - eatenTotals.protein,
      carbs: targets.carbs - eatenTotals.carbs,
      fat: targets.fat - eatenTotals.fat
    };
    const uneatenPctSum = uneatenIdxs.reduce((sum, j) => sum + (meals[j].pct || 0), 0);

    // 1. Daily macro constraints on remaining uneaten allocation
    macros.forEach((m, mi) => {
      const c = `daily_${m}`;
      model.constraints[c] = { equal: remainingTargets[m] };
      const coeff = targets[m] > 0 ? mw[mi] / targets[m] : 1.0;
      model.variables[`dP_${m}`] = { cost: coeff, [c]: -1 };
      model.variables[`dM_${m}`] = { cost: coeff, [c]: 1 };
    });

    // 2. Meal calorie allocation among UNEATEN meals only
    uneatenIdxs.forEach(j => {
      const meal = meals[j];
      const remainingCal = remainingTargets.calories;
      const tgt = uneatenPctSum > 0
        ? (meal.pct / uneatenPctSum) * remainingCal
        : remainingCal / uneatenIdxs.length;
      if (tgt === 0 && remainingCal === 0) return;
      const c = `meal_${j}`;
      model.constraints[c] = { equal: tgt };
      const coeff = targets.calories > 0 ? (weights.mealAllocation / targets.calories) : 0.001;
      model.variables[`mdP_${j}`] = { cost: coeff, [c]: -1 };
      model.variables[`mdM_${j}`] = { cost: coeff, [c]: 1 };
    });

    // 3. Per-meal ingredient count constraints (uneaten meals only)
    if (needsBinaries) {
      uneatenIdxs.forEach(j => {
        if (minIngPerMeal > 0) {
          model.constraints[`meal_ing_min_${j}`] = { min: minIngPerMeal };
        }
        if (maxIngPerMeal > 0) {
          model.constraints[`meal_ing_max_${j}`] = { max: maxIngPerMeal };
        }
      });
    }

    const boundaryExcessPenalty = (penalties && typeof penalties.boundaryExcess === 'number') ? penalties.boundaryExcess : 0.002;

    // 4. Decision variables: x_i_j (servings), optional z_i_j (binary selection), and soft boundary excess
    ingredients.forEach((ing, i) => {
      const maxS = typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 10;
      const minS = typeof ing.minServings === 'number' && ing.minServings > 0 ? ing.minServings : 0;
      const prefS = typeof ing.preferredServings === 'number' && ing.preferredServings > 0 ? ing.preferredServings : 1.0;

      let availPenalty = 0;
      if (ing.availability === 'low' || ing.availability === 'running_low') {
        availPenalty = availabilityLowPenalty;
      } else if (ing.availability === 'out' || ing.availability === 'almost_out') {
        availPenalty = availabilityOutPenalty;
      }

      uneatenIdxs.forEach(j => {
        const meal = meals[j];
        const v_x = `x_${i}_${j}`;
        const v_z = `z_${i}_${j}`;
        const v_excess = `excess_${i}_${j}`;

        const actualRec = getActualRecord(meal, ing, j, i);
        const isRecorded = Boolean(actualRec && typeof actualRec.actualQuantity === 'number');

        if (isRecorded) {
          // Recorded actual quantity is an immutable observation
          const sActual = actualRec.actualQuantity / (ing.servingSize || 100);
          const xEntry = {
            cost: 0
          };

          macros.forEach(m => {
            xEntry[`daily_${m}`] = ing[m];
          });
          xEntry[`meal_${j}`] = ing.calories;

          // Lock variable exactly to recorded physical portion
          const fixBnd = `fix_${i}_${j}`;
          model.constraints[fixBnd] = { equal: sActual };
          xEntry[fixBnd] = 1;

          if (needsBinaries) {
            model.binaries[v_z] = 1;
            const isSelected = sActual > 0.001;
            const zEntry = { cost: 0 };
            const fixZ = `fix_z_${i}_${j}`;
            model.constraints[fixZ] = { equal: isSelected ? 1 : 0 };
            zEntry[fixZ] = 1;

            if (isSelected) {
              if (minIngPerMeal > 0) zEntry[`meal_ing_min_${j}`] = 1;
              if (maxIngPerMeal > 0) zEntry[`meal_ing_max_${j}`] = 1;
            }
            model.variables[v_z] = zEntry;
          }

          model.variables[v_x] = xEntry;
        } else {
          // Unfixed decision variable
          const xEntry = {
            cost: quantityPenalty + availPenalty
          };

          macros.forEach(m => {
            xEntry[`daily_${m}`] = ing[m];
          });
          xEntry[`meal_${j}`] = ing.calories;

          // Soft boundary preference: penalize servings above preferred baseline
          if (maxS > prefS) {
            const softBnd = `soft_pref_${i}_${j}`;
            model.constraints[softBnd] = { max: prefS };
            xEntry[softBnd] = 1;
            model.variables[v_excess] = {
              cost: boundaryExcessPenalty,
              [softBnd]: -1
            };
          }

          if (needsBinaries) {
            model.binaries[v_z] = 1;

            const zEntry = {
              cost: simplicityPenalty + (availPenalty > 0 ? availPenalty * 0.5 : 0)
            };

            // Link upper bound: x_ij - maxServings_i * z_ij <= 0
            const linkMax = `link_max_${i}_${j}`;
            model.constraints[linkMax] = { max: 0 };
            xEntry[linkMax] = 1;
            zEntry[linkMax] = -maxS;

            // Link lower bound: x_ij - minServings_i * z_ij >= 0 (if minServings > 0)
            if (minS > 0) {
              const linkMin = `link_min_${i}_${j}`;
              model.constraints[linkMin] = { min: 0 };
              xEntry[linkMin] = 1;
              zEntry[linkMin] = -minS;
            }

            if (minIngPerMeal > 0) zEntry[`meal_ing_min_${j}`] = 1;
            if (maxIngPerMeal > 0) zEntry[`meal_ing_max_${j}`] = 1;

            model.variables[v_z] = zEntry;
          } else {
            // Direct bounds for continuous LP
            const bndMax = `bound_max_${i}_${j}`;
            model.constraints[bndMax] = { max: maxS };
            xEntry[bndMax] = 1;

            if (minS > 0) {
              const bndMin = `bound_min_${i}_${j}`;
              model.constraints[bndMin] = { min: minS };
              xEntry[bndMin] = 1;
            }
          }

          if (ing.quantityMode === 'discrete') {
            if (!model.ints) model.ints = {};
            model.ints[v_x] = 1;
          }

          model.variables[v_x] = xEntry;
        }
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
      return { errors: ['Structural infeasibility: No valid solution satisfies the current constraints (e.g. ingredient serving bounds or meal ingredient limits). EATEN meals were left unchanged. Try adjusting ingredient limits.'] };
    }

    state.result = Optimization._extract(raw);
    return { result: state.result };
  },

  recordActual(mealRef, ingRef, actualQuantity, plannedQuantityAtRecord) {
    const { mealId, ingId } = resolveMealAndIngIds(mealRef, ingRef);
    if (!state.actuals) state.actuals = {};
    const key = `${mealId}_${ingId}`;
    state.actuals[key] = {
      actualQuantity: Number(actualQuantity),
      plannedQuantityAtRecord: typeof plannedQuantityAtRecord === 'number' ? plannedQuantityAtRecord : Number(actualQuantity)
    };
    return Optimization.solve({ preserveActuals: true });
  },

  clearActual(mealRef, ingRef) {
    const { mealId, ingId } = resolveMealAndIngIds(mealRef, ingRef);
    if (!state.actuals) return Optimization.solve({ preserveActuals: true });
    delete state.actuals[`${mealId}_${ingId}`];
    return Optimization.solve({ preserveActuals: true });
  },

  clearAllActuals() {
    state.actuals = {};
    return Optimization.solve({ preserveActuals: false });
  },

  markMealEaten(mealRef) {
    const mealId = resolveMealId(mealRef);
    const mealResult = findMealResult(mealId);
    if (!mealResult) {
      return { errors: ['No solved meal plan to lock. Press SOLVE first.'] };
    }
    if (!state.eatenMeals) state.eatenMeals = {};
    state.eatenMeals[mealId] = { items: snapshotMealItems(mealResult) };
    mealResult.isEaten = true;
    return { result: state.result };
  },

  unmarkMealEaten(mealRef) {
    const mealId = resolveMealId(mealRef);
    if (!state.eatenMeals) return { result: state.result };
    delete state.eatenMeals[mealId];
    const meal = state.meals.find(m => m.id === mealId || m.name === mealId);
    if (meal?.name) delete state.eatenMeals[meal.name];
    const idx = state.meals.findIndex(m => m.id === mealId || m.name === mealId);
    if (idx >= 0) delete state.eatenMeals[String(idx)];
    const mealResult = findMealResult(mealId);
    if (mealResult) mealResult.isEaten = false;
    return { result: state.result };
  },

  toggleMealEaten(mealRef) {
    const mealId = resolveMealId(mealRef);
    const meal = state.meals.find(m => m.id === mealId || m.name === mealId);
    const idx = state.meals.findIndex(m => m.id === mealId || m.name === mealId);
    if (isMealEaten(meal || { id: mealId }, idx >= 0 ? idx : undefined) || (state.eatenMeals && state.eatenMeals[mealId])) {
      return Optimization.unmarkMealEaten(mealRef);
    }
    return Optimization.markMealEaten(mealRef);
  },

  _extract(raw) {
    const { meals, targets } = state;
    const ingredients = state.ingredients.map(ing => ({
      ...ing,
      servingSize: (ing.servingSize === '' || typeof ing.servingSize === 'undefined') ? 100 : Number(ing.servingSize),
      calories: (ing.calories === '' || typeof ing.calories === 'undefined') ? 0 : Number(ing.calories),
      protein: (ing.protein === '' || typeof ing.protein === 'undefined') ? 0 : Number(ing.protein),
      carbs: (ing.carbs === '' || typeof ing.carbs === 'undefined') ? 0 : Number(ing.carbs),
      fat: (ing.fat === '' || typeof ing.fat === 'undefined') ? 0 : Number(ing.fat),
      minServings: (ing.minServings === '' || typeof ing.minServings === 'undefined') ? 0 : Number(ing.minServings),
      maxServings: (ing.maxServings === '' || typeof ing.maxServings === 'undefined') ? 5 : Number(ing.maxServings)
    }));

    const mealResults = meals.map((meal, j) => {
      const eatenRec = getEatenMealRecord(meal, j);
      if (eatenRec) {
        const items = snapshotMealItems({ items: eatenRec.items });
        let mCal = 0, mPro = 0, mCarb = 0, mFat = 0;
        items.forEach(item => {
          const ing = ingredients.find(i => i.id === item.id || i.name === item.name);
          const servings = typeof item.servings === 'number'
            ? item.servings
            : (Number(item.quantity) || 0) / (ing?.servingSize || item.servingSize || 100);
          item.servings = servings;
          if (ing) {
            mCal += servings * ing.calories;
            mPro += servings * ing.protein;
            mCarb += servings * ing.carbs;
            mFat += servings * ing.fat;
          }
        });
        const tgt = (meal.pct / 100) * targets.calories;
        return {
          id: meal.id,
          name: meal.name,
          pct: meal.pct,
          items,
          calories: mCal,
          protein: mPro,
          carbs: mCarb,
          fat: mFat,
          targetCalories: tgt,
          calDeviation: mCal - tgt,
          isEaten: true
        };
      }

      const items = [];
      let mCal = 0, mPro = 0, mCarb = 0, mFat = 0;

      ingredients.forEach((ing, i) => {
        const actualRec = getActualRecord(meal, ing, j, i);
        const isActual = Boolean(actualRec && typeof actualRec.actualQuantity === 'number');

        let s = (raw && raw[`x_${i}_${j}`]) || 0;
        const z = (raw && raw[`z_${i}_${j}`]) || 0;

        if (isActual) {
          const actualQuantity = Number(actualRec.actualQuantity);
          const plannedQuantity = typeof actualRec.plannedQuantityAtRecord === 'number'
            ? actualRec.plannedQuantityAtRecord
            : Math.round((s * ing.servingSize) * 100) / 100;
          const displayQuantity = actualQuantity;
          const servings = displayQuantity / (ing.servingSize || 100);

          if (servings > 0.001 || z > 0.5 || actualQuantity > 0) {
            items.push({
              id: ing.id,
              mealId: meal.id,
              mealIdx: j,
              name: ing.name,
              quantity: displayQuantity,
              displayQuantity,
              plannedQuantity,
              actualQuantity,
              isActual: true,
              unit: ing.unit,
              servings,
              servingSize: ing.servingSize,
              selected: servings > 0.001 || z > 0.5,
              quantityMode: ing.quantityMode || 'continuous',
              availability: ing.availability || 'normal'
            });

            mCal += servings * ing.calories;
            mPro += servings * ing.protein;
            mCarb += servings * ing.carbs;
            mFat += servings * ing.fat;
          }
        } else {
          if (ing.quantityMode === 'discrete') {
            s = Math.round(s);
          }
          if (s > 0.001) {
            const plannedQuantity = s * ing.servingSize;
            const displayQuantity = plannedQuantity;

            items.push({
              id: ing.id,
              mealId: meal.id,
              mealIdx: j,
              name: ing.name,
              quantity: displayQuantity,
              displayQuantity,
              plannedQuantity,
              actualQuantity: null,
              isActual: false,
              unit: ing.unit,
              servings: s,
              servingSize: ing.servingSize,
              selected: z > 0.5,
              quantityMode: ing.quantityMode || 'continuous',
              availability: ing.availability || 'normal'
            });

            mCal += s * ing.calories;
            mPro += s * ing.protein;
            mCarb += s * ing.carbs;
            mFat += s * ing.fat;
          }
        }
      });

      const tgt = (meal.pct / 100) * targets.calories;
      return {
        id: meal.id,
        name: meal.name,
        pct: meal.pct,
        items,
        calories: mCal,
        protein: mPro,
        carbs: mCarb,
        fat: mFat,
        targetCalories: tgt,
        calDeviation: mCal - tgt,
        isEaten: false
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

