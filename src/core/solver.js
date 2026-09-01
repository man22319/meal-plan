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
import { PRECISION } from './precision.js';

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

export function getActualRecord(meal, ing, mealIdx, _ingIdx, customActuals = null) {
  const actuals = customActuals !== null ? customActuals : state.actuals;
  if (!actuals || typeof actuals !== 'object') return null;
  const mealId = meal?.id;
  const ingId = ing?.id;
  const mealName = meal?.name;
  const ingName = ing?.name;

  if (mealId && ingId && actuals[`${mealId}_${ingId}`]) {
    return actuals[`${mealId}_${ingId}`];
  }
  if (ingId && actuals[`${mealIdx}_${ingId}`]) {
    return actuals[`${mealIdx}_${ingId}`];
  }
  if (mealId && ingName && actuals[`${mealId}_${ingName}`]) {
    return actuals[`${mealId}_${ingName}`];
  }
  if (mealName && ingName && actuals[`${mealName}_${ingName}`]) {
    return actuals[`${mealName}_${ingName}`];
  }
  if (ingName && actuals[`${mealIdx}_${ingName}`]) {
    return actuals[`${mealIdx}_${ingName}`];
  }
  return null;
}

export function getEatenItemRecord(meal, ing, mealIdx, _ingIdx, customEatenItems = null) {
  const eatenItems = customEatenItems !== null ? customEatenItems : state.eatenItems;
  if (!eatenItems || typeof eatenItems !== 'object') return null;
  const mealId = meal?.id;
  const ingId = ing?.id;
  const mealName = meal?.name;
  const ingName = ing?.name;

  if (mealId && ingId && eatenItems[`${mealId}_${ingId}`]) {
    return eatenItems[`${mealId}_${ingId}`];
  }
  if (ingId && eatenItems[`${mealIdx}_${ingId}`]) {
    return eatenItems[`${mealIdx}_${ingId}`];
  }
  if (mealId && ingName && eatenItems[`${mealId}_${ingName}`]) {
    return eatenItems[`${mealId}_${ingName}`];
  }
  if (mealName && ingName && eatenItems[`${mealName}_${ingName}`]) {
    return eatenItems[`${mealName}_${ingName}`];
  }
  if (ingName && eatenItems[`${mealIdx}_${ingName}`]) {
    return eatenItems[`${mealIdx}_${ingName}`];
  }
  return null;
}

export function hasAnyEatenItems(customEatenItems = null) {
  const eatenItems = customEatenItems !== null ? customEatenItems : state.eatenItems;
  return Boolean(eatenItems && Object.keys(eatenItems).length > 0);
}

function findMealResult(mealId, customResult = null) {
  const res = customResult !== null ? customResult : state.result;
  if (!res?.mealResults) return null;
  return res.mealResults.find(m => m.id === mealId || m.name === mealId) || null;
}

function findResultItem(mealId, ingId, customResult = null) {
  const meal = findMealResult(mealId, customResult);
  if (!meal) return null;
  return meal.items.find(it => it.id === ingId || it.name === ingId) || null;
}

export function extractResults(raw, customState = state) {
  const targets = customState?.targets || state.targets;
  const meals = customState?.meals || state.meals;
  const actuals = customState?.actuals || state.actuals || {};
  const eatenItems = customState?.eatenItems || state.eatenItems || {};
  const ingredients = (customState?.ingredients || state.ingredients).map((ing, idx) => ({
    ...ing,
    id: ing.id || `ing_${idx}`,
    servingSize: (ing.servingSize === '' || typeof ing.servingSize === 'undefined') ? 100 : Number(ing.servingSize),
    calories: (ing.calories === '' || typeof ing.calories === 'undefined') ? 0 : Number(ing.calories),
    protein: (ing.protein === '' || typeof ing.protein === 'undefined') ? 0 : Number(ing.protein),
    carbs: (ing.carbs === '' || typeof ing.carbs === 'undefined') ? 0 : Number(ing.carbs),
    fat: (ing.fat === '' || typeof ing.fat === 'undefined') ? 0 : Number(ing.fat),
    minServings: (ing.minServings === '' || typeof ing.minServings === 'undefined') ? 0 : Number(ing.minServings),
    maxServings: (ing.maxServings === '' || typeof ing.maxServings === 'undefined') ? 5 : Number(ing.maxServings)
  }));

  const mealResults = meals.map((meal, j) => {
    const items = [];
    let mCal = 0, mPro = 0, mCarb = 0, mFat = 0;

    ingredients.forEach((ing, i) => {
      const actualRec = getActualRecord(meal, ing, j, i, actuals);
      const eatenRec = getEatenItemRecord(meal, ing, j, i, eatenItems);
      const isActual = Boolean(actualRec && typeof actualRec.actualQuantity === 'number');
      const isEaten = Boolean(eatenRec && typeof eatenRec.quantity === 'number');

      let s = (raw && raw[`x_${i}_${j}`]) || 0;
      const z = (raw && raw[`z_${i}_${j}`]) || 0;

      if (isActual || isEaten) {
        const lockedQuantity = isActual ? Number(actualRec.actualQuantity) : Number(eatenRec.quantity);
        const plannedQuantity = isActual && typeof actualRec.plannedQuantityAtRecord === 'number'
          ? actualRec.plannedQuantityAtRecord
          : (typeof eatenRec?.plannedQuantity === 'number'
            ? eatenRec.plannedQuantity
            : Math.round((s * ing.servingSize) * 100) / 100);
        const displayQuantity = lockedQuantity;
        const servings = displayQuantity / (ing.servingSize || 100);

        if (servings > PRECISION.SERVING_MIN_EPS || z > 0.5 || lockedQuantity > 0) {
          const itemCal = servings * ing.calories;
          const itemPro = servings * ing.protein;
          const itemCarb = servings * ing.carbs;
          const itemFat = servings * ing.fat;

          items.push({
            id: ing.id,
            mealId: meal.id || `meal_${j}`,
            mealIdx: j,
            name: ing.name,
            quantity: displayQuantity,
            displayQuantity,
            plannedQuantity,
            actualQuantity: isActual ? Number(actualRec.actualQuantity) : null,
            isActual,
            isEaten,
            unit: ing.unit,
            servings,
            servingSize: ing.servingSize,
            calories: itemCal,
            protein: itemPro,
            carbs: itemCarb,
            fat: itemFat,
            selected: servings > PRECISION.SERVING_MIN_EPS || z > 0.5,
            quantityMode: ing.quantityMode || 'continuous',
            availability: ing.availability || 'normal'
          });

          mCal += itemCal;
          mPro += itemPro;
          mCarb += itemCarb;
          mFat += itemFat;
        }
      } else {
        if (ing.quantityMode === 'discrete') {
          s = Math.round(s);
        }
        if (s > PRECISION.SERVING_MIN_EPS) {
          const plannedQuantity = s * ing.servingSize;
          const displayQuantity = plannedQuantity;
          const itemCal = s * ing.calories;
          const itemPro = s * ing.protein;
          const itemCarb = s * ing.carbs;
          const itemFat = s * ing.fat;

          items.push({
            id: ing.id,
            mealId: meal.id || `meal_${j}`,
            mealIdx: j,
            name: ing.name,
            quantity: displayQuantity,
            displayQuantity,
            plannedQuantity,
            actualQuantity: null,
            isActual: false,
            isEaten: false,
            unit: ing.unit,
            servings: s,
            servingSize: ing.servingSize,
            calories: itemCal,
            protein: itemPro,
            carbs: itemCarb,
            fat: itemFat,
            selected: z > 0.5,
            quantityMode: ing.quantityMode || 'continuous',
            availability: ing.availability || 'normal'
          });

          mCal += itemCal;
          mPro += itemPro;
          mCarb += itemCarb;
          mFat += itemFat;
        }
      }
    });

    const tgt = (meal.pct / 100) * targets.calories;
    return {
      id: meal.id || `meal_${j}`,
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

  return {
    mealResults,
    totals,
    deviations,
    approximate,
    objective: (raw && typeof raw.result === 'number') ? raw.result : 0
  };
}

export function solveModel(customState = state, { validate = false, relaxIntegrality = false } = {}) {
  if (validate) {
    const errors = Validation.validateAll(customState);
    if (errors.length > 0) {
      return { feasible: false, objective: Infinity, raw: null, result: null, errors };
    }
  }

  const targets = customState.targets || state.targets;
  const meals = customState.meals || state.meals;
  const weights = customState.weights || state.weights;
  const penalties = customState.penalties || state.penalties;
  const mealConstraints = customState.mealConstraints || state.mealConstraints;
  const actuals = customState.actuals || {};
  const eatenItems = customState.eatenItems || {};

  const ingredients = (customState.ingredients || state.ingredients).map((ing, idx) => ({
    ...ing,
    id: ing.id || `ing_${idx}`,
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
      tolerance: PRECISION.SOLVER_MIP_GAP_TOLERANCE
    }
  };

  if (needsBinaries && !relaxIntegrality) {
    model.binaries = {};
  }

  if (hasDiscrete && !relaxIntegrality) {
    model.ints = {};
  }

  // 1. Daily macro constraints (with deviation variables dP and dM)
  macros.forEach((m, mi) => {
    const c = `daily_${m}`;
    model.constraints[c] = { equal: targets[m] };
    const coeff = targets[m] > 0 ? mw[mi] / targets[m] : 1.0;
    model.variables[`dP_${m}`] = { cost: coeff, [c]: -1 };
    model.variables[`dM_${m}`] = { cost: coeff, [c]: 1 };
  });

  // 2. Meal calorie allocation constraints (soft target per meal)
  meals.forEach((meal, j) => {
    const tgt = (meal.pct / 100) * targets.calories;
    if (tgt <= 0) return;
    const c = `meal_${j}`;
    model.constraints[c] = { equal: tgt };
    const coeff = targets.calories > 0 ? (weights.mealAllocation / targets.calories) : 0.001;
    model.variables[`mdP_${j}`] = { cost: coeff, [c]: -1 };
    model.variables[`mdM_${j}`] = { cost: coeff, [c]: 1 };
  });

  // 3. Per-meal ingredient count constraints (if binaries needed)
  if (needsBinaries) {
    meals.forEach((_, j) => {
      if (minIngPerMeal > 0) {
        model.constraints[`meal_ing_min_${j}`] = { min: minIngPerMeal };
      }
      if (maxIngPerMeal > 0) {
        model.constraints[`meal_ing_max_${j}`] = { max: maxIngPerMeal };
      }
    });
  }

  const boundaryExcessPenalty = (penalties && typeof penalties.boundaryExcess === 'number') ? penalties.boundaryExcess : 0.002;

  const AVAILABILITY_CAPS = {
    low: 3.0,
    limited: 2.0
  };

  // 4. Daily aggregate availability capacity constraints on future inventory (LOW <= 3.0, LIMITED <= 2.0)
  ingredients.forEach((ing, i) => {
    if (ing.availability in AVAILABILITY_CAPS) {
      model.constraints[`daily_cap_${i}`] = { max: AVAILABILITY_CAPS[ing.availability] };
    }
  });

  // 5. Decision variables: x_i_j (servings), optional z_i_j (binary selection), and soft boundary excess
  ingredients.forEach((ing, i) => {
    const maxS = typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 10;
    const minS = typeof ing.minServings === 'number' && ing.minServings > 0 ? ing.minServings : 0;
    const prefS = typeof ing.preferredServings === 'number' && ing.preferredServings > 0 ? ing.preferredServings : 1.0;
    const hasDailyCap = ing.availability in AVAILABILITY_CAPS;

    meals.forEach((meal, j) => {
      const v_x = `x_${i}_${j}`;
      const v_z = `z_${i}_${j}`;
      const v_excess = `excess_${i}_${j}`;

      const actualRec = getActualRecord(meal, ing, j, i, actuals);
      const eatenRec = getEatenItemRecord(meal, ing, j, i, eatenItems);
      const lockQty = (actualRec && typeof actualRec.actualQuantity === 'number')
        ? actualRec.actualQuantity
        : (eatenRec && typeof eatenRec.quantity === 'number' ? eatenRec.quantity : null);
      const isRecorded = lockQty !== null;

      if (isRecorded) {
        // Recorded actual quantity is an immutable physical observation
        const sActual = lockQty / (ing.servingSize || 100);
        const xEntry = {
          cost: 0
        };

        macros.forEach(m => {
          xEntry[`daily_${m}`] = ing[m];
        });
        xEntry[`meal_${j}`] = ing.calories;

        // Note: Recorded consumption does NOT consume remaining inventory cap
        // (daily_cap_i is reserved for unrecorded allocation going forward)

        // Lock variable exactly to recorded physical portion
        const fixBnd = `fix_${i}_${j}`;
        model.constraints[fixBnd] = { equal: sActual };
        xEntry[fixBnd] = 1;

        if (needsBinaries) {
          if (!relaxIntegrality) {
            if (!model.binaries) model.binaries = {};
            model.binaries[v_z] = 1;
          }
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
      } else if (ing.availability === 'out') {
        // Unrecorded item for an OUT ingredient cannot be allocated going forward
        const fixBnd = `fix_${i}_${j}`;
        model.constraints[fixBnd] = { equal: 0 };
        model.variables[v_x] = { cost: 0, [fixBnd]: 1 };

        if (needsBinaries) {
          if (!relaxIntegrality) {
            if (!model.binaries) model.binaries = {};
            model.binaries[v_z] = 1;
          }
          const fixZ = `fix_z_${i}_${j}`;
          model.constraints[fixZ] = { equal: 0 };
          model.variables[v_z] = { cost: 0, [fixZ]: 1 };
        }
      } else {
        // Unfixed decision variable (pure quantity penalty without availability cost distortion)
        const xEntry = {
          cost: quantityPenalty
        };

        macros.forEach(m => {
          xEntry[`daily_${m}`] = ing[m];
        });
        xEntry[`meal_${j}`] = ing.calories;

        if (hasDailyCap) {
          xEntry[`daily_cap_${i}`] = 1;
        }

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
          const zEntry = {
            cost: simplicityPenalty
          };

          if (!relaxIntegrality) {
            if (!model.binaries) model.binaries = {};
            model.binaries[v_z] = 1;
          } else {
            // In continuous LP relaxation, enforce upper bound 0 <= z_ij <= 1
            const zBound = `z_bnd_${i}_${j}`;
            model.constraints[zBound] = { max: 1 };
            zEntry[zBound] = 1;
          }

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

        if (ing.quantityMode === 'discrete' && !relaxIntegrality) {
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
    return { feasible: false, objective: Infinity, raw: null, result: null, errors: ['Solver error: ' + (e.message || 'unknown failure.')] };
  }

  if (!raw || !raw.feasible) {
    return {
      feasible: false,
      objective: Infinity,
      raw: raw || null,
      result: null,
      errors: ['Structural infeasibility: No valid solution satisfies the current constraints (e.g. ingredient serving bounds or meal ingredient limits). EATEN ingredients were left unchanged. Try adjusting ingredient limits.']
    };
  }

  const result = extractResults(raw, { targets, meals, ingredients, actuals, eatenItems });
  return {
    feasible: true,
    objective: raw.result,
    raw,
    result,
    errors: []
  };
}

export const Optimization = {
  /**
   * Runs validation, builds MILP model, solves, and writes state.result.
   * preserveActuals: whether to keep recorded actual portion constraints (default: false).
   */
  solve({ preserveActuals = false } = {}) {
    const errors = Validation.validateAll();
    if (errors.length > 0) {
      if (!hasAnyEatenItems()) {
        state.result = null;
      }
      return { errors };
    }

    if (!preserveActuals) {
      state.actuals = {};
    }

    state.meals.forEach((m, idx) => ensureId(m, `meal_${idx}`));
    state.ingredients.forEach((ing, idx) => ensureId(ing, `ing_${idx}`));

    const outcome = solveModel(state, { validate: false });
    if (!outcome.feasible || outcome.errors?.length > 0) {
      return { errors: outcome.errors?.length ? outcome.errors : ['Optimization failed to find a feasible solution.'] };
    }

    state.result = outcome.result;
    return { result: state.result };
  },

  recordActual(mealRef, ingRef, actualQuantity, plannedQuantityAtRecord) {
    const { mealId, ingId } = resolveMealAndIngIds(mealRef, ingRef);
    const actQty = Number(actualQuantity);

    const existingItem = findResultItem(mealId, ingId);
    const planQty = typeof plannedQuantityAtRecord === 'number'
      ? plannedQuantityAtRecord
      : (typeof existingItem?.plannedQuantity === 'number' ? existingItem.plannedQuantity : null);

    if (planQty !== null && Math.abs(actQty - planQty) < 0.001) {
      return Optimization.clearActual(mealRef, ingRef);
    }

    if (!state.actuals) state.actuals = {};
    const key = `${mealId}_${ingId}`;
    state.actuals[key] = {
      actualQuantity: actQty,
      plannedQuantityAtRecord: planQty !== null ? planQty : actQty
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

  markIngredientEaten(mealRef, ingRef) {
    const { mealId, ingId } = resolveMealAndIngIds(mealRef, ingRef);
    const item = findResultItem(mealId, ingId);
    if (!item) {
      return { errors: ['No solved quantity to lock. Press SOLVE first.'] };
    }
    if (!state.eatenItems) state.eatenItems = {};
    state.eatenItems[`${mealId}_${ingId}`] = {
      quantity: Number(item.quantity),
      servings: item.servings,
      plannedQuantity: item.plannedQuantity,
      actualQuantity: item.actualQuantity ?? null
    };
    item.isEaten = true;
    return { result: state.result };
  },

  unmarkIngredientEaten(mealRef, ingRef) {
    const { mealId, ingId } = resolveMealAndIngIds(mealRef, ingRef);
    if (!state.eatenItems) return { result: state.result };
    delete state.eatenItems[`${mealId}_${ingId}`];
    const item = findResultItem(mealId, ingId);
    if (item) item.isEaten = false;
    return { result: state.result };
  },

  toggleIngredientEaten(mealRef, ingRef) {
    const { mealId, ingId } = resolveMealAndIngIds(mealRef, ingRef);
    const meal = state.meals.find(m => m.id === mealId || m.name === mealId);
    const ing = state.ingredients.find(i => i.id === ingId || i.name === ingId);
    const idx = state.meals.findIndex(m => m.id === mealId || m.name === mealId);
    if (getEatenItemRecord(meal || { id: mealId }, ing || { id: ingId, name: ingId }, idx, 0)
      || (state.eatenItems && state.eatenItems[`${mealId}_${ingId}`])) {
      return Optimization.unmarkIngredientEaten(mealRef, ingRef);
    }
    return Optimization.markIngredientEaten(mealRef, ingRef);
  },

  unmarkAllIngredientsEaten() {
    state.eatenItems = {};
    if (state.result?.mealResults) {
      state.result.mealResults.forEach(meal => {
        if (Array.isArray(meal.items)) {
          meal.items.forEach(item => {
            item.isEaten = false;
          });
        }
      });
    }
    return { result: state.result };
  },

  _extract(raw) {
    return extractResults(raw, state);
  }
};

