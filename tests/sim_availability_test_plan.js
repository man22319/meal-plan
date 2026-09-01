import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize vendor solver
const vendorSolverPath = path.resolve(__dirname, '../src/vendor/solver.js');
const vendorCode = fs.readFileSync(vendorSolverPath, 'utf8');
const solverSandbox = {};
const initSolver = new Function('window', 'self', 'exports', 'module', vendorCode);
initSolver(solverSandbox, solverSandbox, undefined, undefined);
const solver = solverSandbox.solver;

// Builder for different formulations
export function buildAndSolveModel({
  targets = { calories: 2000, protein: 150, carbs: 200, fat: 60 },
  meals = [{ name: 'Meal 1', pct: 100 }],
  ingredients = [],
  weights = { calories: 1.0, protein: 2.0, carbs: 1.5, fat: 1.5, mealAllocation: 0.1 },
  penalties = { simplicity: 0.0005, quantity: 0.00001, availabilityLow: 0.0005, availabilityLimited: 0.002, boundaryExcess: 0.002 },
  mealConstraints = { minIngredients: 0, maxIngredients: 0 },
  formulation = 'current', // 'current' | 'capacity' | 'capacity_min' | 'capacity_min_reward'
  eatenActuals = {}, // { 'mealIdx_ingIdx': actualQuantity }
  customCapacity = {} // { ingIdx: maxDailyServings }
}) {
  const macros = ['calories', 'protein', 'carbs', 'fat'];
  const mw = [weights.calories, weights.protein, weights.carbs, weights.fat];

  const minIngPerMeal = mealConstraints?.minIngredients || 0;
  const maxIngPerMeal = mealConstraints?.maxIngredients || 0;

  const hasExplicitMin = ingredients.some(ing => typeof ing.minServings === 'number' && ing.minServings > 0);
  const enforceMin = formulation.includes('min') || hasExplicitMin;
  const needsBinaries = (minIngPerMeal > 1) || (maxIngPerMeal > 0 && maxIngPerMeal < ingredients.length) || enforceMin;
  const hasDiscrete = ingredients.some(ing => ing.quantityMode === 'discrete');

  const model = {
    optimize: 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    options: { timeout: 500, tolerance: 0.01 }
  };

  if (needsBinaries) model.binaries = {};
  if (hasDiscrete) model.ints = {};

  // 1. Daily macro deviation constraints
  macros.forEach((m, mi) => {
    const c = `daily_${m}`;
    model.constraints[c] = { equal: targets[m] };
    const coeff = targets[m] > 0 ? mw[mi] / targets[m] : 1.0;
    model.variables[`dP_${m}`] = { cost: coeff, [c]: -1 };
    model.variables[`dM_${m}`] = { cost: coeff, [c]: 1 };
  });

  // 2. Meal calorie allocation constraints
  meals.forEach((meal, j) => {
    const tgt = (meal.pct / 100) * targets.calories;
    if (tgt <= 0) return;
    const c = `meal_${j}`;
    model.constraints[c] = { equal: tgt };
    const coeff = targets.calories > 0 ? (weights.mealAllocation / targets.calories) : 0.001;
    model.variables[`mdP_${j}`] = { cost: coeff, [c]: -1 };
    model.variables[`mdM_${j}`] = { cost: coeff, [c]: 1 };
  });

  // 3. Meal ingredient limits
  if (needsBinaries) {
    meals.forEach((_, j) => {
      if (minIngPerMeal > 0) model.constraints[`meal_ing_min_${j}`] = { min: minIngPerMeal };
      if (maxIngPerMeal > 0) model.constraints[`meal_ing_max_${j}`] = { max: maxIngPerMeal };
    });
  }

  // 4. Daily ingredient capacity constraints for capacity formulations
  if (formulation !== 'current') {
    ingredients.forEach((ing, i) => {
      let cap = Infinity;
      if (typeof customCapacity[i] === 'number') {
        cap = customCapacity[i];
      } else if (ing.availability === 'out') {
        cap = 0;
      } else if (ing.availability === 'limited') {
        cap = 2.0; // Candidate capacity for limited
      } else if (ing.availability === 'low') {
        cap = 3.0; // Candidate capacity for low
      }

      if (cap < Infinity) {
        model.constraints[`daily_cap_${i}`] = { max: cap };
      }
    });
  }

  // 5. Decision variables
  ingredients.forEach((ing, i) => {
    const maxS = typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 10;
    let minS = typeof ing.minServings === 'number' && ing.minServings > 0 ? ing.minServings : 0;
    if (formulation.includes('min') && minS === 0 && ing.defaultMinServings) {
      minS = ing.defaultMinServings;
    }
    const prefS = typeof ing.preferredServings === 'number' && ing.preferredServings > 0 ? ing.preferredServings : 1.0;

    let availPenalty = 0;
    let availReward = 0;

    if (formulation === 'current') {
      if (ing.availability === 'low') availPenalty = penalties.availabilityLow ?? 0.0005;
      else if (ing.availability === 'limited') availPenalty = penalties.availabilityLimited ?? 0.002;
    } else if (formulation === 'capacity_min_reward') {
      // Reward finishing / using limited or low food
      if (ing.availability === 'limited') availReward = 0.0001;
      else if (ing.availability === 'low') availReward = 0.00005;
    }

    meals.forEach((meal, j) => {
      const v_x = `x_${i}_${j}`;
      const v_z = `z_${i}_${j}`;
      const v_excess = `excess_${i}_${j}`;

      if (ing.availability === 'out' && formulation === 'current') {
        const fixBnd = `fix_${i}_${j}`;
        model.constraints[fixBnd] = { equal: 0 };
        model.variables[v_x] = { cost: 0, [fixBnd]: 1 };
        if (needsBinaries) {
          model.binaries[v_z] = 1;
          const fixZ = `fix_z_${i}_${j}`;
          model.constraints[fixZ] = { equal: 0 };
          model.variables[v_z] = { cost: 0, [fixZ]: 1 };
        }
        return;
      }

      // Check if locked / eaten
      const lockQty = eatenActuals[`${j}_${i}`] ?? eatenActuals[`${meal.id || j}_${ing.id || i}`] ?? null;
      if (lockQty !== null) {
        const sActual = lockQty / (ing.servingSize || 100);
        const xEntry = { cost: 0 };
        macros.forEach(m => { xEntry[`daily_${m}`] = ing[m]; });
        xEntry[`meal_${j}`] = ing.calories;
        if (model.constraints[`daily_cap_${i}`]) {
          xEntry[`daily_cap_${i}`] = 1;
        }
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
        return;
      }

      // Unfixed decision variable
      const costX = (penalties.quantity || 0.00001) + availPenalty - availReward;
      const xEntry = { cost: costX };
      macros.forEach(m => { xEntry[`daily_${m}`] = ing[m]; });
      xEntry[`meal_${j}`] = ing.calories;

      if (model.constraints[`daily_cap_${i}`]) {
        xEntry[`daily_cap_${i}`] = 1;
      }

      if (maxS > prefS) {
        const softBnd = `soft_pref_${i}_${j}`;
        model.constraints[softBnd] = { max: prefS };
        xEntry[softBnd] = 1;
        model.variables[v_excess] = {
          cost: penalties.boundaryExcess || 0.002,
          [softBnd]: -1
        };
      }

      if (needsBinaries) {
        model.binaries[v_z] = 1;
        const costZ = (penalties.simplicity || 0.0005) + (availPenalty > 0 ? availPenalty * 0.5 : 0);
        const zEntry = { cost: costZ };

        const linkMax = `link_max_${i}_${j}`;
        model.constraints[linkMax] = { max: 0 };
        xEntry[linkMax] = 1;
        zEntry[linkMax] = -maxS;

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
    });
  });

  const raw = solver.Solve(model);
  return { raw, model };
}

export function extractResults({ raw, targets, meals, ingredients, _formulation }) {
  if (!raw || !raw.feasible) {
    return { feasible: false, objective: raw?.result || Infinity };
  }

  const items = [];
  let totalCal = 0, totalPro = 0, totalCarb = 0, totalFat = 0;
  let lowServings = 0, limitedServings = 0;
  let portionsUnderHalf = 0, portionsUnderQuarter = 0;
  let usedIngredients = new Set();

  meals.forEach((m, j) => {
    ingredients.forEach((ing, i) => {
      const s = raw[`x_${i}_${j}`] || 0;
      const z = raw[`z_${i}_${j}`] || 0;
      if (s > 0.0001) {
        usedIngredients.add(ing.name || i);
        if (s < 0.5) portionsUnderHalf++;
        if (s < 0.25) portionsUnderQuarter++;
        if (ing.availability === 'low') lowServings += s;
        if (ing.availability === 'limited') limitedServings += s;

        const qty = s * (ing.servingSize || 100);
        items.push({
          meal: m.name,
          mealIdx: j,
          ingredient: ing.name,
          servings: s,
          quantity: qty,
          unit: ing.unit,
          z,
          availability: ing.availability || 'normal'
        });

        totalCal += s * ing.calories;
        totalPro += s * ing.protein;
        totalCarb += s * ing.carbs;
        totalFat += s * ing.fat;
      }
    });
  });

  const calDev = totalCal - targets.calories;
  const proDev = totalPro - targets.protein;
  const carbDev = totalCarb - targets.carbs;
  const fatDev = totalFat - targets.fat;

  return {
    feasible: true,
    objective: raw.result,
    totalCal,
    totalPro,
    totalCarb,
    totalFat,
    calDev,
    proDev,
    carbDev,
    fatDev,
    usedCount: usedIngredients.size,
    portionsUnderHalf,
    portionsUnderQuarter,
    lowServings,
    limitedServings,
    items
  };
}
