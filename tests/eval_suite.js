// ══════════════════════════════════════════════════════════════════
// AUTOMATED TEST SUITE: MEAL ALLOCATION & PORTION REALISM EVALUATOR
// ══════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize vendor solver in Node environment
const vendorSolverPath = path.resolve(__dirname, '../src/vendor/solver.js');
const vendorCode = fs.readFileSync(vendorSolverPath, 'utf8');
const solverSandbox = {};
const initSolver = new Function('window', 'self', 'exports', 'module', vendorCode);
initSolver(solverSandbox, solverSandbox, undefined, undefined);
global.solver = solverSandbox.solver;

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };
}

import { Optimization } from '../src/core/solver.js';
import { state, STORAGE_KEY, SETTINGS_KEY, TARGETS_KEY, MEALS_KEY, RESULT_KEY, DEFAULT_TARGETS, DEFAULT_MEALS } from '../src/core/state.js';
import { Validation } from '../src/core/validation.js';
import { Persistence, ImportExport } from '../src/io/persistence.js';
import { createPressHoldController } from '../src/ui/pressHold.js';

// Base nutritional target
export const DAILY_TARGET = {
  calories: 2335,
  protein: 151,
  carbs: 291,
  fat: 62
};

// Test Set A: 3 Ingredients
export const SET_A_INGREDIENTS = [
  { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5 },
  { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5 },
  { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2 }
];

// Test Set B: Expanded 7 Ingredients
export const SET_B_INGREDIENTS = [
  { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5 },
  { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5 },
  { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2 },
  { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 0, maxServings: 4 },
  { name: 'Black Beans', servingSize: 100, unit: 'g', calories: 132, protein: 8.9, carbs: 23.7, fat: 0.5, minServings: 0, maxServings: 4 },
  { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 4 },
  { name: 'Tuna', servingSize: 100, unit: 'g', calories: 130, protein: 28, carbs: 0, fat: 1, minServings: 0, maxServings: 3 }
];

// Test allocations matrix
export const ALLOCATION_SCENARIOS = [
  // 3 meals
  { meals: 3, name: '3-meal 40/20/40', splits: [40, 20, 40] },
  { meals: 3, name: '3-meal 35/30/35', splits: [35, 30, 35] },
  { meals: 3, name: '3-meal 33.33/33.33/33.34', splits: [33.33, 33.33, 33.34] },
  { meals: 3, name: '3-meal 30/35/35', splits: [30, 35, 35] },

  // 4 meals
  { meals: 4, name: '4-meal 25/25/25/25', splits: [25, 25, 25, 25] },
  { meals: 4, name: '4-meal 30/20/25/25', splits: [30, 20, 25, 25] },
  { meals: 4, name: '4-meal 35/25/20/20', splits: [35, 25, 20, 20] },

  // 5 meals
  { meals: 5, name: '5-meal 20/20/20/20/20', splits: [20, 20, 20, 20, 20] },
  { meals: 5, name: '5-meal 25/20/20/20/15', splits: [25, 20, 20, 20, 15] }
];

/**
 * Diagnostic analysis on a solved result
 */
export function analyzeSolution(result, ingredients, splits, targets, mealConstraints) {
  if (!result || !result.mealResults) {
    return { feasible: false, error: 'Infeasible or No Solution' };
  }

  const { mealResults, deviations } = result;

  // 1. Nutritional accuracy metrics
  const macroMetrics = {
    calDev: deviations.calories.absolute,
    calDevPct: deviations.calories.percentage,
    proDev: deviations.protein.absolute,
    proDevPct: deviations.protein.percentage,
    carbDev: deviations.carbs.absolute,
    carbDevPct: deviations.carbs.percentage,
    fatDev: deviations.fat.absolute,
    fatDevPct: deviations.fat.percentage,
  };

  // 2. Practicality and portion metrics
  let maxPortionQuantity = 0;
  let maxPortionUnit = '';
  let maxPortionIngredient = '';
  let maxServings = 0;
  let maxServingsIngredient = '';
  let singleIngredientMealCount = 0;
  let mealsWithMaxBoundIngredient = 0;
  let tinyPortionCount = 0; // e.g. < 25g / < 0.25 serv
  const distinctIngredientsUsedSet = new Set();
  const ingredientMealCounts = {};
  const ingredientMaxBoundHits = {};

  ingredients.forEach(ing => {
    ingredientMealCounts[ing.name] = 0;
    ingredientMaxBoundHits[ing.name] = 0;
  });

  const mealIngredientCounts = [];
  let allMealCountsValid = true;

  mealResults.forEach((meal) => {
    const activeItems = meal.items.filter(item => item.servings > 0.01);
    const count = activeItems.length;
    mealIngredientCounts.push(count);

    if (mealConstraints) {
      if (mealConstraints.minIngredients && count < mealConstraints.minIngredients) allMealCountsValid = false;
      if (mealConstraints.maxIngredients && count > mealConstraints.maxIngredients) allMealCountsValid = false;
    }

    if (count === 1) {
      singleIngredientMealCount++;
    }

    let mealHitMaxBound = false;

    activeItems.forEach(item => {
      distinctIngredientsUsedSet.add(item.name);
      ingredientMealCounts[item.name] = (ingredientMealCounts[item.name] || 0) + 1;

      // Track max portion
      if (item.quantity > maxPortionQuantity) {
        maxPortionQuantity = item.quantity;
        maxPortionUnit = item.unit;
        maxPortionIngredient = item.name;
      }
      if (item.servings > maxServings) {
        maxServings = item.servings;
        maxServingsIngredient = item.name;
      }

      // Check max bound hit
      const ingDef = ingredients.find(ing => ing.name === item.name);
      const maxAllowed = (ingDef && ingDef.maxServings) ? ingDef.maxServings : 10;
      if (Math.abs(item.servings - maxAllowed) < 0.05) {
        mealHitMaxBound = true;
        ingredientMaxBoundHits[item.name] = (ingredientMaxBoundHits[item.name] || 0) + 1;
      }

      // Check tiny portions (e.g. < 0.25 servings or < 25g/mL)
      if (item.servings < 0.25 || item.quantity < 25) {
        tinyPortionCount++;
      }
    });

    if (mealHitMaxBound) {
      mealsWithMaxBoundIngredient++;
    }
  });

  // 3. Diagnostic Practicality Flags
  const flags = [];

  // Flag: Ingredient at maximum bound in multiple meals
  Object.entries(ingredientMaxBoundHits).forEach(([ingName, hits]) => {
    if (hits > 1) {
      flags.push(`${ingName} at max bound in ${hits} meals`);
    }
  });

  // Flag: High specific portions
  mealResults.forEach((meal, idx) => {
    meal.items.forEach(item => {
      if (item.name === 'Whole Milk' && item.quantity > 470) {
        flags.push(`Meal ${idx + 1}: ${item.quantity.toFixed(0)} mL Milk (>480mL threshold)`);
      }
      if (item.name === 'Chicken' && item.quantity > 300) {
        flags.push(`Meal ${idx + 1}: ${item.quantity.toFixed(0)}g Chicken (>300g)`);
      }
      if (item.name === 'Yuca' && item.quantity >= 400) {
        flags.push(`Meal ${idx + 1}: ${item.quantity.toFixed(0)}g Yuca (>=400g)`);
      }
    });
  });

  // Flag: Single-ingredient meal
  if (singleIngredientMealCount > 0) {
    flags.push(`${singleIngredientMealCount} meal(s) contain only 1 ingredient`);
  }

  // Flag: Tiny portions
  if (tinyPortionCount > 0) {
    flags.push(`${tinyPortionCount} tiny portion(s) (<0.25 serv)`);
  }

  // Flag: Unusually high repetition (used in 100% of meals)
  const totalMeals = mealResults.length;
  Object.entries(ingredientMealCounts).forEach(([ingName, count]) => {
    if (count === totalMeals && totalMeals >= 3) {
      flags.push(`${ingName} used in 100% of meals (${count}/${totalMeals})`);
    }
  });

  return {
    feasible: true,
    macroMetrics,
    portionMetrics: {
      maxPortion: `${maxPortionQuantity.toFixed(1)} ${maxPortionUnit} (${maxPortionIngredient}, ${maxServings.toFixed(2)} serv)`,
      maxPortionQuantity,
      maxPortionUnit,
      maxPortionIngredient,
      maxServings,
      maxServingsIngredient,
      ingPerMeal: mealIngredientCounts.join('/'),
      avgIngPerMeal: (mealIngredientCounts.reduce((a, b) => a + b, 0) / mealIngredientCounts.length).toFixed(2),
      minIngPerMeal: Math.min(...mealIngredientCounts),
      maxIngPerMeal: Math.max(...mealIngredientCounts),
      singleIngredientMealCount,
      mealsWithMaxBoundIngredient,
      tinyPortionCount,
      distinctIngredientsCount: distinctIngredientsUsedSet.size,
      totalIngredientsAvailable: ingredients.length,
      allMealCountsValid,
      ingredientMealCounts,
      ingredientMaxBoundHits
    },
    flags,
    mealResults
  };
}

/**
 * Runs a single test configuration
 */
export function runCase(scenario, ingredients, setName) {
  state.targets = { ...DAILY_TARGET };
  state.ingredients = JSON.parse(JSON.stringify(ingredients));
  state.meals = scenario.splits.map((pct, i) => ({
    name: `Meal ${i + 1}`,
    pct
  }));
  state.mealConstraints = {
    minIngredients: 1,
    maxIngredients: ingredients.length
  };
  state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
  state.penalties = { simplicity: 0.0005, quantity: 0.00001 };
  state.result = null;

  const outcome = Optimization.solve();

  let analysis;
  if (outcome.errors && outcome.errors.length > 0) {
    analysis = { feasible: false, errors: outcome.errors };
  } else {
    analysis = analyzeSolution(outcome.result, ingredients, scenario.splits, DAILY_TARGET, state.mealConstraints);
  }

  return {
    setName,
    meals: scenario.meals,
    scenarioName: scenario.name,
    splitsStr: scenario.splits.join('/'),
    splits: scenario.splits,
    analysis
  };
}

/**
 * Execute full evaluation suite
 */
export function runEvaluationSuite() {
  const results = [];
  const startTime = performance.now();

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(' RUNNING COMPREHENSIVE MEAL-ALLOCATION & PORTION REALISM TEST SUITE    ');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Test Set A
  console.log('>>> RUNNING TEST SET A: Current 3-Ingredient Set (Chicken, Yuca, Whole Milk)...');
  ALLOCATION_SCENARIOS.forEach((sc, idx) => {
    const t0 = performance.now();
    const res = runCase(sc, SET_A_INGREDIENTS, 'Set A (3 Ing)');
    const dt = (performance.now() - t0).toFixed(2);
    console.log(`  [A${idx + 1}] ${sc.name} (${sc.splits.join('/')}%): Feasible=${res.analysis.feasible} (${dt}ms)`);
    results.push(res);
  });

  // Test Set B
  console.log('\n>>> RUNNING TEST SET B: Expanded 7-Ingredient Set...');
  ALLOCATION_SCENARIOS.forEach((sc, idx) => {
    const t0 = performance.now();
    const res = runCase(sc, SET_B_INGREDIENTS, 'Set B (7 Ing)');
    const dt = (performance.now() - t0).toFixed(2);
    console.log(`  [B${idx + 1}] ${sc.name} (${sc.splits.join('/')}%): Feasible=${res.analysis.feasible} (${dt}ms)`);
    results.push(res);
  });

  const totalTime = (performance.now() - startTime).toFixed(2);
  console.log(`\nCompleted ${results.length} test cases in ${totalTime}ms.\n`);
  return results;
}

/**
 * Run simulations to find the mathematically best meal split with least error
 */
export function runMealSplitSimulations() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(' SIMULATION: DISCOVERING OPTIMAL MEAL SPLITS (LEAST ERROR & REALISM)   ');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const simResults = { 3: [], 4: [], 5: [] };

  // 3-Meal Simulation (Sweep step 5%)
  for (let p1 = 20; p1 <= 60; p1 += 5) {
    for (let p2 = 15; p2 <= 60; p2 += 5) {
      const p3 = 100 - p1 - p2;
      if (p3 >= 15 && p3 <= 60) {
        const sc = { meals: 3, name: `3-meal ${p1}/${p2}/${p3}`, splits: [p1, p2, p3] };
        const res = runCase(sc, SET_B_INGREDIENTS, 'Set B (7 Ing)');
        if (res.analysis.feasible) {
          const a = res.analysis;
          const score = calculateScore(a);
          simResults[3].push({ splits: [p1, p2, p3], score, analysis: a });
        }
      }
    }
  }

  // 4-Meal Simulation (Sweep step 5%)
  for (let p1 = 20; p1 <= 40; p1 += 5) {
    for (let p2 = 15; p2 <= 35; p2 += 5) {
      for (let p3 = 15; p3 <= 35; p3 += 5) {
        const p4 = 100 - p1 - p2 - p3;
        if (p4 >= 15 && p4 <= 35) {
          const sc = { meals: 4, name: `4-meal ${p1}/${p2}/${p3}/${p4}`, splits: [p1, p2, p3, p4] };
          const res = runCase(sc, SET_B_INGREDIENTS, 'Set B (7 Ing)');
          if (res.analysis.feasible) {
            const a = res.analysis;
            const score = calculateScore(a);
            simResults[4].push({ splits: [p1, p2, p3, p4], score, analysis: a });
          }
        }
      }
    }
  }

  // 5-Meal Simulation (Sweep step 5%)
  for (let p1 = 15; p1 <= 30; p1 += 5) {
    for (let p2 = 15; p2 <= 30; p2 += 5) {
      for (let p3 = 15; p3 <= 30; p3 += 5) {
        for (let p4 = 15; p4 <= 30; p4 += 5) {
          const p5 = 100 - p1 - p2 - p3 - p4;
          if (p5 >= 10 && p5 <= 30) {
            const sc = { meals: 5, name: `5-meal ${p1}/${p2}/${p3}/${p4}/${p5}`, splits: [p1, p2, p3, p4, p5] };
            const res = runCase(sc, SET_B_INGREDIENTS, 'Set B (7 Ing)');
            if (res.analysis.feasible) {
              const a = res.analysis;
              const score = calculateScore(a);
              simResults[5].push({ splits: [p1, p2, p3, p4, p5], score, analysis: a });
            }
          }
        }
      }
    }
  }

  // Sort by score
  [3, 4, 5].forEach(num => {
    simResults[num].sort((a, b) => b.score - a.score);
  });

  return simResults;
}

function calculateScore(a) {
  const mm = a.macroMetrics;
  const pm = a.portionMetrics;

  const macroError = Math.abs(mm.calDevPct) * 2 +
                     Math.abs(mm.proDevPct) * 3 +
                     Math.abs(mm.carbDevPct) * 1.5 +
                     Math.abs(mm.fatDevPct) * 1.5;

  let score = 100;
  score -= macroError * 5;
  score -= pm.singleIngredientMealCount * 15;
  score -= pm.tinyPortionCount * 3;

  return score;
}

/**
 * Adversarial & Boundary Stress Test Suite
 * Verifies the exact hierarchy invariant:
 * Hard Constraints -> Nutritional Objective -> Soft Practicality Preferences
 */
export function runAdversarialSuite() {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(' RUNNING ADVERSARIAL & BOUNDARY STRESS TEST SUITE                     ');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const adversarialResults = [];

  // ── TEST 1: Equivalent Foods -> Prefers Balanced Standard Portions ──
  {
    state.targets = { calories: 500, protein: 60, carbs: 40, fat: 10 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 5 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 3.5, minServings: 0, maxServings: 5, preferredServings: 1.0 },
      { name: 'Turkey Breast', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 3.5, minServings: 0, maxServings: 5, preferredServings: 1.0 },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, minServings: 0, maxServings: 4, preferredServings: 2.0 }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result ? outcome.result.mealResults[0].items : [];
    const chk = items.find(i => i.name === 'Chicken Breast')?.servings || 0;
    const trk = items.find(i => i.name === 'Turkey Breast')?.servings || 0;
    // Both foods should be chosen near ~0.95 - 1.0 serving rather than dumping 2.0 servings on one
    const passed = Math.abs(chk - trk) < 0.2 && chk > 0.5 && trk > 0.5;

    console.log(`[ADV-1] Redundant Macro Pathways (Chicken vs Turkey):`);
    console.log(`        Result: ${chk.toFixed(2)} serv Chicken (${(chk*100).toFixed(0)}g), ${trk.toFixed(2)} serv Turkey (${(trk*100).toFixed(0)}g)`);
    console.log(`        Expected: Balanced ~1.0 / 1.0 servings to avoid portion penalty on either food.`);
    console.log(`        Status: ${passed ? 'PASSED (Prefers standard portions when nutritionally equal)' : 'FAILED'}\n`);
    adversarialResults.push({ name: 'ADV-1: Equivalence Balancing', passed });
  }

  // ── TEST 2: Tight Nutritional Demand -> Soft Penalty is Subordinate ──
  {
    state.targets = { calories: 650, protein: 93, carbs: 40, fat: 12 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 5 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, preferredServings: 1.0 },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, minServings: 0, maxServings: 4, preferredServings: 2.0 }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result ? outcome.result.mealResults[0].items : [];
    const chk = items.find(i => i.name === 'Chicken Breast')?.servings || 0;
    const pDev = outcome.result ? outcome.result.deviations.protein.absolute : 999;
    const passed = Math.abs(chk - 2.9) < 0.2 && Math.abs(pDev) < 0.5;

    console.log(`[ADV-2] Nutrition Subordination (3x Chicken strictly required):`);
    console.log(`        Result: ${chk.toFixed(2)} serv Chicken (${(chk*100).toFixed(0)}g), Protein Dev: ${pDev.toFixed(1)}g`);
    console.log(`        Expected: Willing to exceed preferred portion (2.9-3.0 serv) to hit exact macros.`);
    console.log(`        Status: ${passed ? 'PASSED (Nutritional accuracy strictly dominates soft portion penalty)' : 'FAILED'}\n`);
    adversarialResults.push({ name: 'ADV-2: Nutrition Subordination', passed });
  }

  // ── TEST 3: Degenerate Multi-Boundary Saturation Case ──
  {
    state.targets = { calories: 990, protein: 84, carbs: 108, fat: 23.2 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 5 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 2, preferredServings: 1.0 },
      { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 2, preferredServings: 1.0 },
      { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, preferredServings: 1.0 }
    ];

    const outcome = Optimization.solve();
    const res = outcome.result;
    let allAtMax = false;
    if (res) {
      const c = res.mealResults[0].items.find(i => i.name === 'Chicken')?.servings || 0;
      const y = res.mealResults[0].items.find(i => i.name === 'Yuca')?.servings || 0;
      const m = res.mealResults[0].items.find(i => i.name === 'Whole Milk')?.servings || 0;
      allAtMax = Math.abs(c - 2.0) < 0.05 && Math.abs(y - 2.0) < 0.05 && Math.abs(m - 2.0) < 0.05;
    }

    console.log(`[ADV-3] Degenerate Multi-Boundary Case (All foods at 100% max bound):`);
    console.log(`        Result: Feasible=${!!res && !outcome.errors}, All At Max Bound=${allAtMax}`);
    console.log(`        Expected: Finds feasible solution at maximum capacity without failure.`);
    console.log(`        Status: ${allAtMax ? 'PASSED (Solver pushes all ingredients to boundary without distortion)' : 'FAILED'}\n`);
    adversarialResults.push({ name: 'ADV-3: Boundary Saturation', passed: allAtMax });
  }

  return adversarialResults;
}

/**
 * Quantity Mode Test Suite: Discrete vs Continuous Variable Domains
 */
export function runQuantityModeTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(' RUNNING QUANTITY MODE TEST SUITE (DISCRETE VS CONTINUOUS)           ');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const results = [];

  // QM-1: Pure discrete ingredients produce strictly integer servings
  {
    state.targets = { calories: 800, protein: 70, carbs: 80, fat: 20 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 0, maxServings: 5, quantityMode: 'discrete' },
      { name: 'Bread Slice', servingSize: 40, unit: 'g', calories: 100, protein: 4, carbs: 20, fat: 1, minServings: 0, maxServings: 5, quantityMode: 'discrete' },
      { name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'discrete' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result ? outcome.result.mealResults[0].items : [];
    const allDiscreteInteger = items.length > 0 && items.every(item => Number.isInteger(item.servings) && item.servings >= 0);

    console.log(`[QM-1] Pure Discrete Ingredients (Whole Servings Only):`);
    items.forEach(i => console.log(`       - ${i.name}: ${i.servings} serv (${i.quantity} ${i.unit})`));
    console.log(`       Status: ${allDiscreteInteger ? 'PASSED (All servings are strictly integer)' : 'FAILED'}\n`);
    results.push({ name: 'QM-1: Pure Discrete', passed: allDiscreteInteger });
  }

  // QM-2: Continuous ingredients produce fractional servings when needed
  {
    state.targets = { calories: 532, protein: 42.5, carbs: 62.1, fat: 11.2 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 3 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous' },
      { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous' },
      { name: 'Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result ? outcome.result.mealResults[0].items : [];
    const hasFractional = items.some(item => !Number.isInteger(item.servings));

    console.log(`[QM-2] Pure Continuous Ingredients (Fractional Servings Allowed):`);
    items.forEach(i => console.log(`       - ${i.name}: ${i.servings.toFixed(2)} serv (${i.quantity.toFixed(1)} ${i.unit})`));
    console.log(`       Status: ${hasFractional ? 'PASSED (Fractional continuous servings generated)' : 'FAILED'}\n`);
    results.push({ name: 'QM-2: Pure Continuous', passed: hasFractional });
  }

  // QM-3: Mixed Discrete & Continuous Ingredients
  {
    state.targets = { calories: 750, protein: 55, carbs: 70, fat: 22 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 0, maxServings: 4, quantityMode: 'discrete' },
      { name: 'Pita', servingSize: 60, unit: 'g', calories: 165, protein: 5.5, carbs: 33, fat: 1, minServings: 0, maxServings: 3, quantityMode: 'discrete' },
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous' },
      { name: 'Olive Oil', servingSize: 15, unit: 'mL', calories: 120, protein: 0, carbs: 0, fat: 14, minServings: 0, maxServings: 2, quantityMode: 'continuous' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result ? outcome.result.mealResults[0].items : [];
    const eggs = items.find(i => i.name === 'Eggs');
    const pita = items.find(i => i.name === 'Pita');

    const discreteValid = (!eggs || Number.isInteger(eggs.servings)) && (!pita || Number.isInteger(pita.servings));
    const continuousValid = items.length > 0;
    const passed = discreteValid && continuousValid;

    console.log(`[QM-3] Mixed Discrete/Continuous Set:`);
    items.forEach(i => console.log(`       - ${i.name} (${i.quantityMode}): ${Number.isInteger(i.servings) ? i.servings : i.servings.toFixed(2)} serv`));
    console.log(`       Status: ${passed ? 'PASSED (Discrete are integers, continuous allowed fractional)' : 'FAILED'}\n`);
    results.push({ name: 'QM-3: Mixed Discrete/Continuous', passed });
  }

  // QM-4: Discrete Serving Bounds (Min & Max Servings)
  {
    state.targets = { calories: 600, protein: 40, carbs: 50, fat: 15 };
    state.meals = [{ name: 'Meal 1', pct: 100 }];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 3 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 };
    state.ingredients = [
      { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 2, maxServings: 3, quantityMode: 'discrete' },
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result ? outcome.result.mealResults[0].items : [];
    const eggs = items.find(i => i.name === 'Eggs');
    const passed = eggs && Number.isInteger(eggs.servings) && eggs.servings >= 2 && eggs.servings <= 3;

    console.log(`[QM-4] Discrete Serving Bounds (Eggs min=2, max=3):`);
    console.log(`       Result: Eggs = ${eggs ? eggs.servings : 0} serv`);
    console.log(`       Status: ${passed ? 'PASSED (Discrete bounds strictly satisfied)' : 'FAILED'}\n`);
    results.push({ name: 'QM-4: Discrete Bounds', passed });
  }

  // QM-5: Validation & Backward Compatibility
  {
    state.ingredients = [
      { name: 'Old Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2 },
      { name: 'Discrete Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, quantityMode: 'discrete' }
    ];
    const validationErrors = Validation.validateIngredients();

    const testValid = ImportExport._validate({
      ingredients: [
        { name: 'Old Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2 },
        { name: 'Discrete Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, quantityMode: 'discrete' }
      ]
    });
    const testInvalid = ImportExport._validate({
      ingredients: [
        { name: 'Bad Mode Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, quantityMode: 'invalid_mode' }
      ]
    });

    const passed = validationErrors.length === 0 && testValid.length === 0 && testInvalid.length > 0;
    console.log(`[QM-5] Schema Validation & Backward Compatibility:`);
    console.log(`       Valid legacy/discrete check: errors=${testValid.length}`);
    console.log(`       Invalid mode check: errors=${testInvalid.length} (${testInvalid[0] || ''})`);
    console.log(`       Status: ${passed ? 'PASSED (Backward compatibility and validation verified)' : 'FAILED'}\n`);
    results.push({ name: 'QM-5: Validation & Backward Compatibility', passed });
  }

  // QM-6: Export/Import of Weights, Limits & Ingredient Quantity Modes
  {
    const fullPayload = {
      ingredients: [
        { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 1, maxServings: 4, quantityMode: 'discrete' },
        { name: 'Oats', servingSize: 40, unit: 'g', calories: 150, protein: 5, carbs: 27, fat: 3, minServings: 0.5, maxServings: 3, quantityMode: 'continuous' }
      ],
      mealConstraints: {
        minIngredients: 2,
        maxIngredients: 5
      },
      weights: {
        calories: 1.5,
        protein: 2.0,
        carbs: 0.8,
        fat: 0.4,
        mealAllocation: 0.3
      }
    };

    const validErrors = ImportExport._validate(fullPayload);

    const invalidWeightsPayload = {
      ...fullPayload,
      weights: { calories: -1, protein: 'high' }
    };
    const invalidWeightsErrors = ImportExport._validate(invalidWeightsPayload);

    const invalidConstraintsPayload = {
      ...fullPayload,
      mealConstraints: { minIngredients: 6, maxIngredients: 2 }
    };
    const invalidConstraintsErrors = ImportExport._validate(invalidConstraintsPayload);

    const passed = validErrors.length === 0 &&
      invalidWeightsErrors.length > 0 &&
      invalidConstraintsErrors.length > 0;

    console.log(`[QM-6] Weights & Limits Import/Export Validation:`);
    console.log(`       Full payload check: errors=${validErrors.length}`);
    console.log(`       Invalid weights errors=${invalidWeightsErrors.length} (${invalidWeightsErrors[0] || ''})`);
    console.log(`       Invalid constraints errors=${invalidConstraintsErrors.length} (${invalidConstraintsErrors[0] || ''})`);
    console.log(`       Status: ${passed ? 'PASSED (Weights, limits and quantityMode properly validated)' : 'FAILED'}\n`);
    results.push({ name: 'QM-6: Weights & Limits Validation', passed });
  }

  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('ERROR: Some quantity mode tests failed!');
    process.exitCode = 1;
  }
  return results;
}

// If run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const allResults = runEvaluationSuite();

  // Print Summary Table
  console.log('| Meals | Allocation | Ingredient Set | kcal Dev | P Dev | C Dev | F Dev | Max Portion | Ingredients/Meal | Practical Flags |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');

  allResults.forEach(r => {
    const a = r.analysis;
    if (!a.feasible) {
      console.log(`| ${r.meals} | ${r.splitsStr} | ${r.setName} | INFEASIBLE | - | - | - | - | - | ${a.errors ? a.errors.join('; ') : 'Failed'} |`);
      return;
    }

    const mm = a.macroMetrics;
    const pm = a.portionMetrics;
    const flagsStr = a.flags.length > 0 ? a.flags.join('; ') : 'None (clean)';

    const kcalStr = `${mm.calDev >= 0 ? '+' : ''}${mm.calDev.toFixed(0)} (${mm.calDevPct.toFixed(1)}%)`;
    const pStr = `${mm.proDev >= 0 ? '+' : ''}${mm.proDev.toFixed(1)}g (${mm.proDevPct.toFixed(1)}%)`;
    const cStr = `${mm.carbDev >= 0 ? '+' : ''}${mm.carbDev.toFixed(1)}g (${mm.carbDevPct.toFixed(1)}%)`;
    const fStr = `${mm.fatDev >= 0 ? '+' : ''}${mm.fatDev.toFixed(1)}g (${mm.fatDevPct.toFixed(1)}%)`;
    const maxPortionStr = `${pm.maxPortionQuantity.toFixed(0)}${pm.maxPortionUnit} ${pm.maxPortionIngredient}`;

    console.log(`| ${r.meals} | ${r.splitsStr} | ${r.setName} | ${kcalStr} | ${pStr} | ${cStr} | ${fStr} | ${maxPortionStr} | ${pm.ingPerMeal} | ${flagsStr} |`);
  });

  // Run Adversarial Test Suite
  runAdversarialSuite();

  // Run Quantity Mode Test Suite
  runQuantityModeTestSuite();

  // Run Availability Test Suite
  runAvailabilityTestSuite();

  // Run Persistence & Refresh-Resistance Test Suite
  runPersistenceTestSuite();

  // Run Actual Portion Recording & Re-optimization Test Suite
  runActualPortionTestSuite();

  // Run EATEN / UNEATEN meal locking test suite
  runEatenMealTestSuite();

  console.log('\n');
  const sim = runMealSplitSimulations();

  console.log('TOP RECOMMENDATIONS FOR MEAL SPLITS BY SIMULATION SCORE:');
  [3, 4, 5].forEach(num => {
    console.log(`\n--- Top ${num}-Meal Allocations ---`);
    sim[num].slice(0, 3).forEach((item, idx) => {
      const pm = item.analysis.portionMetrics;
      const mm = item.analysis.macroMetrics;
      console.log(`  #${idx + 1}: [${item.splits.join('/')}%] Score=${item.score.toFixed(1)} | Ing/Meal=${pm.ingPerMeal} | MaxPortion=${pm.maxPortion} | kcalDev=${mm.calDev.toFixed(0)}`);
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// AVAILABILITY TEST SUITE (NORMAL | RUNNING LOW | ALMOST OUT)
// ══════════════════════════════════════════════════════════════════

export function runAvailabilityTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING INGREDIENT AVAILABILITY TEST SUITE                        ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const results = [];

  // Helper to reset state
  function resetSolverState() {
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = {
      simplicity: 0.0005,
      quantity: 0.00001,
      boundaryExcess: 0.002,
      availabilityLow: 0.0005,
      availabilityOut: 0.002
    };
    state.meals = [{ name: 'Single Meal', pct: 100 }];
    state.targets = { calories: 350, protein: 32, carbs: 30, fat: 5 };
  }

  // AV-1: Normal ingredients baseline
  {
    resetSolverState();
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
      { name: 'Turkey', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 5, availability: 'normal' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result?.mealResults[0]?.items || [];
    const chicken = items.find(i => i.name === 'Chicken')?.servings || 0;
    const turkey = items.find(i => i.name === 'Turkey')?.servings || 0;
    const passed = outcome.result && !outcome.errors && (chicken + turkey > 0.9);

    console.log(`[AV-1] Normal Ingredients Baseline:`);
    console.log(`       Chicken: ${chicken.toFixed(2)} serv, Turkey: ${turkey.toFixed(2)} serv`);
    console.log(`       Status: ${passed ? 'PASSED (Normal ingredients used standardly)' : 'FAILED'}\n`);
    results.push({ name: 'AV-1: Normal Baseline', passed });
  }

  // AV-2: Running Low ingredients are used less when alternative exists
  {
    resetSolverState();
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
      { name: 'Turkey', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'low' },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 5, availability: 'normal' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result?.mealResults[0]?.items || [];
    const chicken = items.find(i => i.name === 'Chicken')?.servings || 0;
    const turkey = items.find(i => i.name === 'Turkey')?.servings || 0;
    const passed = outcome.result && chicken > 0.9 && turkey < 0.05;

    console.log(`[AV-2] Running Low Disfavoring:`);
    console.log(`       Chicken (Normal): ${chicken.toFixed(2)} serv, Turkey (Running Low): ${turkey.toFixed(2)} serv`);
    console.log(`       Status: ${passed ? 'PASSED (Solver strongly preferred Normal over Running Low)' : 'FAILED'}\n`);
    results.push({ name: 'AV-2: Running Low Preference', passed });
  }

  // AV-3: Almost Out ingredients used even less than Running Low
  {
    resetSolverState();
    state.targets = { calories: 450, protein: 42, carbs: 30, fat: 6 };
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 0.5, availability: 'normal' },
      { name: 'Turkey', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'low' },
      { name: 'Tuna', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'out' },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 5, availability: 'normal' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result?.mealResults[0]?.items || [];
    const chicken = items.find(i => i.name === 'Chicken')?.servings || 0;
    const turkey = items.find(i => i.name === 'Turkey')?.servings || 0;
    const tuna = items.find(i => i.name === 'Tuna')?.servings || 0;
    const passed = outcome.result && chicken >= 0.49 && turkey > 0.6 && tuna < 0.01;

    console.log(`[AV-3] Availability Hierarchy (Normal > Running Low > Almost Out):`);
    console.log(`       Chicken (Normal max=0.5): ${chicken.toFixed(2)} serv, Turkey (Running Low): ${turkey.toFixed(2)} serv, Tuna (Almost Out): ${tuna.toFixed(2)} serv`);
    console.log(`       Status: ${passed ? 'PASSED (Solver picked Running Low over Almost Out when Normal was capped)' : 'FAILED'}\n`);
    results.push({ name: 'AV-3: Availability Hierarchy', passed });
  }

  // AV-4: Nutritional accuracy strictly dominates Almost Out penalty
  {
    resetSolverState();
    state.targets = { calories: 500, protein: 50, carbs: 40, fat: 10 };
    // Only Chicken provides significant protein, but is marked "Almost Out"
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'out' },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 5, availability: 'normal' }
    ];

    const outcome = Optimization.solve();
    const items = outcome.result?.mealResults[0]?.items || [];
    const chicken = items.find(i => i.name === 'Chicken')?.servings || 0;
    const proDev = Math.abs(outcome.result?.deviations?.protein?.absolute || 0);
    const passed = outcome.result && chicken > 1.2 && proDev < 1.0;

    console.log(`[AV-4] Nutritional Subordination (Almost Out strictly used when needed for macros):`);
    console.log(`       Chicken (Almost Out): ${chicken.toFixed(2)} serv, Protein Deviation: ${proDev.toFixed(2)}g`);
    console.log(`       Status: ${passed ? 'PASSED (Nutritional accuracy dominated Almost Out penalty)' : 'FAILED'}\n`);
    results.push({ name: 'AV-4: Nutritional Dominance', passed });
  }

  // AV-5: Import/Export, Schema Validation & Backward Compatibility
  {
    // 1. Validation of valid availability strings
    const validPayload = {
      ingredients: [
        { name: 'Normal Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, availability: 'normal' },
        { name: 'Low Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, availability: 'low' },
        { name: 'Out Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, availability: 'out' },
        { name: 'Legacy Food No Avail', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2 }
      ]
    };
    const validErrors = ImportExport._validate(validPayload);

    // 2. Validation of invalid availability string
    const invalidPayload = {
      ingredients: [
        { name: 'Bad Avail Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, availability: 'super_rare' }
      ]
    };
    const invalidErrors = ImportExport._validate(invalidPayload);

    // 3. Validation via Validation.validateIngredients
    state.ingredients = [
      { name: 'Bad Food', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, availability: 'not_valid' }
    ];
    const validationErrors = Validation.validateIngredients();

    const passed = validErrors.length === 0 && invalidErrors.length > 0 && validationErrors.length > 0;

    console.log(`[AV-5] Schema Validation & Backward Compatibility:`);
    console.log(`       Valid/legacy import check: errors=${validErrors.length}`);
    console.log(`       Invalid availability import check: errors=${invalidErrors.length} (${invalidErrors[0] || ''})`);
    console.log(`       Validation.validateIngredients check: errors=${validationErrors.length} (${validationErrors[0] || ''})`);
    console.log(`       Status: ${passed ? 'PASSED (Schema validation and backward compatibility confirmed)' : 'FAILED'}\n`);
    results.push({ name: 'AV-5: Validation & Compatibility', passed });
  }

  // AV-6: Dynamic update immediate effect
  {
    resetSolverState();
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
      { name: 'Turkey', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 5, availability: 'normal' }
    ];

    // Solve 1: both normal
    Optimization.solve();
    const c1 = state.result?.mealResults[0]?.items.find(i => i.name === 'Chicken')?.servings || 0;

    // Mutate Chicken to 'out'
    state.ingredients[0].availability = 'out';
    Optimization.solve();
    const c2 = state.result?.mealResults[0]?.items.find(i => i.name === 'Chicken')?.servings || 0;
    const t2 = state.result?.mealResults[0]?.items.find(i => i.name === 'Turkey')?.servings || 0;

    const passed = (c1 > 0.5 || state.result?.mealResults[0]?.items.find(i => i.name === 'Turkey')?.servings > 0.5) && c2 < 0.05 && t2 > 0.9;
    console.log(`[AV-6] Immediate Solver Re-Evaluation:`);
    console.log(`       Before (Chicken Normal): Chicken=${c1.toFixed(2)} serv`);
    console.log(`       After (Chicken Almost Out): Chicken=${c2.toFixed(2)} serv, Turkey=${t2.toFixed(2)} serv`);
    console.log(`       Status: ${passed ? 'PASSED (Changing availability immediately alters next solve)' : 'FAILED'}\n`);
    results.push({ name: 'AV-6: Immediate Solver Re-Evaluation', passed });
  }

  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('ERROR: Some availability tests failed!');
    process.exitCode = 1;
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════
// PERSISTENCE & REFRESH-RESISTANCE TEST SUITE
// ══════════════════════════════════════════════════════════════════

export function runPersistenceTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING PERSISTENCE & REFRESH-RESISTANCE TEST SUITE              ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const results = [];

  // PS-1: Persist and restore working state (targets, meals, ingredients, settings, results)
  {
    global.localStorage.clear();
    state.targets = { calories: 2500, protein: 180, carbs: 250, fat: 70 };
    state.meals = [
      { name: 'Breakfast', pct: 30 },
      { name: 'Lunch', pct: 30 },
      { name: 'Dinner', pct: 40 }
    ];
    state.ingredients = [
      { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 1, maxServings: 4, quantityMode: 'continuous', availability: 'normal' },
      { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 2, maxServings: 5, quantityMode: 'discrete', availability: 'low' }
    ];
    state.mealConstraints = { minIngredients: 2, maxIngredients: 3 };
    state.weights = { calories: 1.2, protein: 1.5, carbs: 0.6, fat: 0.6, mealAllocation: 0.4 };
    state.result = {
      solved: true,
      feasible: true,
      approximate: false,
      mealResults: [{ name: 'Breakfast', pct: 30, calories: 750, protein: 54, carbs: 75, fat: 21, items: [] }],
      totals: { calories: 2500, protein: 180, carbs: 250, fat: 70 },
      deviations: { calories: { absolute: 0, percentage: 0 } }
    };

    Persistence.save();

    // Verify localStorage has keys
    const hasIngredients = !!global.localStorage.getItem(STORAGE_KEY);
    const hasSettings = !!global.localStorage.getItem(SETTINGS_KEY);
    const hasTargets = !!global.localStorage.getItem(TARGETS_KEY);
    const hasMeals = !!global.localStorage.getItem(MEALS_KEY);
    const hasResult = !!global.localStorage.getItem(RESULT_KEY);

    // Reset in-memory state to blanks/defaults
    state.targets = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    state.meals = [];
    state.ingredients = [];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 1 };
    state.weights = { calories: 1, protein: 1, carbs: 1, fat: 1, mealAllocation: 1 };
    state.result = null;

    // Load from persistence
    const loaded = Persistence.load();

    const passed = loaded &&
      hasIngredients && hasSettings && hasTargets && hasMeals && hasResult &&
      state.targets.calories === 2500 &&
      state.targets.protein === 180 &&
      state.meals.length === 3 &&
      state.meals[0].pct === 30 &&
      state.ingredients.length === 2 &&
      state.ingredients[1].quantityMode === 'discrete' &&
      state.ingredients[1].availability === 'low' &&
      state.mealConstraints.minIngredients === 2 &&
      state.weights.protein === 1.5 &&
      state.result !== null &&
      state.result.totals.calories === 2500;

    console.log(`[PS-1] Full State Persistence & Restoration:`);
    console.log(`       Stored Keys Present: targets=${hasTargets}, meals=${hasMeals}, ingredients=${hasIngredients}, settings=${hasSettings}, result=${hasResult}`);
    console.log(`       Restored Targets: kcal=${state.targets.calories}, P=${state.targets.protein}`);
    console.log(`       Restored Meals: count=${state.meals.length}, M1=${state.meals[0]?.name} (${state.meals[0]?.pct}%)`);
    console.log(`       Restored Results: totals.calories=${state.result?.totals?.calories}`);
    console.log(`       Status: ${passed ? 'PASSED (Working state successfully persisted and restored)' : 'FAILED'}\n`);
    results.push({ name: 'PS-1: State Persistence & Restoration', passed });
  }

  // PS-2: Reset Data clears storage and restores defaults
  {
    Persistence.resetToDefaults();

    const targetsCleared = global.localStorage.getItem(TARGETS_KEY) === null;
    const mealsCleared = global.localStorage.getItem(MEALS_KEY) === null;
    const ingCleared = global.localStorage.getItem(STORAGE_KEY) === null;
    const settingsCleared = global.localStorage.getItem(SETTINGS_KEY) === null;
    const resultCleared = global.localStorage.getItem(RESULT_KEY) === null;

    const passed = targetsCleared && mealsCleared && ingCleared && settingsCleared && resultCleared &&
      state.targets.calories === DEFAULT_TARGETS.calories &&
      state.meals.length === DEFAULT_MEALS.length &&
      state.result === null;

    console.log(`[PS-2] Reset to Defaults Clears Persistent Storage:`);
    console.log(`       Keys Cleared: ${targetsCleared && mealsCleared && ingCleared && settingsCleared && resultCleared}`);
    console.log(`       Default Targets kcal: ${state.targets.calories}`);
    console.log(`       Default Meals count: ${state.meals.length}`);
    console.log(`       Status: ${passed ? 'PASSED (Reset properly removes stored keys and restores defaults)' : 'FAILED'}\n`);
    results.push({ name: 'PS-2: Reset Data Storage Clearance', passed });
  }

  // PS-3: Non-overwriting of valid saved state on initialization
  {
    global.localStorage.clear();
    // Simulate user modified targets and meals before reload
    global.localStorage.setItem(TARGETS_KEY, JSON.stringify({ calories: 3000, protein: 200, carbs: 350, fat: 80 }));
    global.localStorage.setItem(MEALS_KEY, JSON.stringify([{ name: 'Solo Big Meal', pct: 100 }]));

    Persistence.load();

    const passed = state.targets.calories === 3000 &&
      state.targets.protein === 200 &&
      state.meals.length === 1 &&
      state.meals[0].name === 'Solo Big Meal';

    console.log(`[PS-3] Preservation of Valid Custom State on Init:`);
    console.log(`       Loaded Target Calories: ${state.targets.calories} (expected 3000)`);
    console.log(`       Loaded Meals: ${state.meals[0]?.name} (${state.meals[0]?.pct}%)`);
    console.log(`       Status: ${passed ? 'PASSED (Custom saved state preserved on initialization)' : 'FAILED'}\n`);
    results.push({ name: 'PS-3: Preservation on Init', passed });
  }

  // PS-4: Graceful handling of corrupted storage
  {
    global.localStorage.setItem(TARGETS_KEY, 'invalid json {[');
    global.localStorage.setItem(MEALS_KEY, JSON.stringify([{ invalid: true }]));

    const result = Persistence.load();

    const passed = typeof result === 'boolean' &&
      state.targets.calories === 3000 && // preserved or default
      state.meals.length >= 1;

    console.log(`[PS-4] Error Handling for Corrupted Storage:`);
    console.log(`       Load result: ${result}`);
    console.log(`       Status: ${passed ? 'PASSED (Corrupted data does not crash the application)' : 'FAILED'}\n`);
    results.push({ name: 'PS-4: Corrupted Storage Fallback', passed });
  }

  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('ERROR: Some persistence tests failed!');
    process.exitCode = 1;
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════
// ACTUAL PORTION RECORDING & RE-OPTIMIZATION TEST SUITE
// ══════════════════════════════════════════════════════════════════

export function runActualPortionTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING ACTUAL PORTION RECORDING & RE-OPTIMIZATION TEST SUITE     ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const results = [];

  function resetToTestDefaults() {
    Persistence.resetToDefaults();
    state.targets = { calories: 2335, protein: 151, carbs: 291, fat: 62 };
    state.meals = [
      { id: 'meal_0', name: 'Breakfast', pct: 40 },
      { id: 'meal_1', name: 'Lunch', pct: 20 },
      { id: 'meal_2', name: 'Dinner', pct: 40 }
    ];
    state.ingredients = [
      { id: 'ing_chk', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'ing_yuc', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'ing_mlk', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous', availability: 'normal' }
    ];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002, availabilityLow: 0.0005, availabilityOut: 0.002 };
    state.actuals = {};
  }

  // AP-1: Single actual portion recording locks quantity and re-optimizes
  {
    resetToTestDefaults();
    const initial = Optimization.solve({ preserveActuals: false });
    const initChk = initial.result.mealResults[0].items.find(i => i.name === 'Chicken');
    const initPlannedQty = initChk ? initChk.quantity : 100;

    // Record actual portion for Breakfast Chicken = 117g
    const reopt = Optimization.recordActual('meal_0', 'ing_chk', 117, initPlannedQty);
    const bItems = reopt.result ? reopt.result.mealResults[0].items : [];
    const bChk = bItems.find(i => i.name === 'Chicken');

    const isLocked = bChk && bChk.isActual === true && Math.abs(bChk.actualQuantity - 117) < 0.01 && Math.abs(bChk.quantity - 117) < 0.01;
    const plannedPreserved = bChk && Math.abs(bChk.plannedQuantity - initPlannedQty) < 0.01;
    const macrosAccurate = reopt.result && Math.abs(reopt.result.deviations.calories.absolute) < 5;

    const passed = Boolean(isLocked && plannedPreserved && macrosAccurate);

    console.log(`[AP-1] Single Portion Recording & Re-optimization:`);
    console.log(`       Chicken in Breakfast: ${bChk?.quantity}g ACTUAL (planned ${bChk?.plannedQuantity?.toFixed(1)}g), serv=${bChk?.servings?.toFixed(2)}`);
    console.log(`       Daily Totals: kcal=${reopt.result?.totals?.calories?.toFixed(0)}, P=${reopt.result?.totals?.protein?.toFixed(1)}g`);
    console.log(`       Status: ${passed ? 'PASSED (Portion locked, planned preserved, remaining re-optimized)' : 'FAILED'}\n`);
    results.push({ name: 'AP-1: Single Portion Recording & Re-optimization', passed });
  }

  // AP-2: Sequential daily workflow (Breakfast -> Lunch -> Dinner)
  {
    resetToTestDefaults();
    // Step 1: Baseline solve
    Optimization.solve({ preserveActuals: false });

    // Step 2: Record Breakfast Chicken = 125g
    Optimization.recordActual('meal_0', 'ing_chk', 125);

    // Step 3: Record Lunch Yuca = 85g
    const outcome = Optimization.recordActual('meal_1', 'ing_yuc', 85);

    const bChk = outcome.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const lYuc = outcome.result?.mealResults[1].items.find(i => i.name === 'Yuca');
    const dItems = outcome.result?.mealResults[2].items || [];

    const passed = bChk?.isActual === true && Math.abs(bChk.actualQuantity - 125) < 0.01 &&
                   lYuc?.isActual === true && Math.abs(lYuc.actualQuantity - 85) < 0.01 &&
                   dItems.length > 0 &&
                   Math.abs(outcome.result.deviations.calories.absolute) < 5;

    console.log(`[AP-2] Sequential Daily Workflow:`);
    console.log(`       Breakfast Chicken: ${bChk?.quantity}g ACTUAL (locked=${bChk?.isActual})`);
    console.log(`       Lunch Yuca: ${lYuc?.quantity}g ACTUAL (locked=${lYuc?.isActual})`);
    console.log(`       Dinner items dynamically adjusted: count=${dItems.length}`);
    console.log(`       Status: ${passed ? 'PASSED (Multi-meal sequential locks preserved)' : 'FAILED'}\n`);
    results.push({ name: 'AP-2: Sequential Daily Workflow', passed });
  }

  // AP-3: Re-solving after changing target preserves recorded actuals
  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    Optimization.recordActual('meal_0', 'ing_chk', 117);

    // User changes target to 2500 kcal and clicks SOLVE (default preserveActuals = true)
    state.targets.calories = 2500;
    const reSolved = Optimization.solve({ preserveActuals: true });

    const bChk = reSolved.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const passed = bChk?.isActual === true && Math.abs(bChk.actualQuantity - 117) < 0.01 &&
                   Math.abs(reSolved.result.totals.calories - 2500) < 5;

    console.log(`[AP-3] Re-solving After Changing Target:`);
    console.log(`       Breakfast Chicken: ${bChk?.quantity}g ACTUAL (expected 117g)`);
    console.log(`       New Total Calories: ${reSolved.result?.totals?.calories?.toFixed(0)} kcal (target 2500)`);
    console.log(`       Status: ${passed ? 'PASSED (Actuals preserved when target changed and re-solved)' : 'FAILED'}\n`);
    results.push({ name: 'AP-3: Re-solving After Target Change', passed });
  }

  // AP-4: Re-solving after changing meal percentage preserves recorded actuals
  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    Optimization.recordActual('meal_0', 'ing_chk', 117);

    // Change meal splits to 30 / 35 / 35
    state.meals[0].pct = 30;
    state.meals[1].pct = 35;
    state.meals[2].pct = 35;

    const outcome = Optimization.solve({ preserveActuals: true });
    const bChk = outcome.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const passed = bChk?.isActual === true && Math.abs(bChk.actualQuantity - 117) < 0.01;

    console.log(`[AP-4] Re-solving After Changing Meal Percentage:`);
    console.log(`       Breakfast Chicken: ${bChk?.quantity}g ACTUAL`);
    console.log(`       Status: ${passed ? 'PASSED (Actuals preserved across meal split adjustments)' : 'FAILED'}\n`);
    results.push({ name: 'AP-4: Meal Split Change Preservation', passed });
  }

  // AP-5: Re-solving after changing ingredient nutrition values
  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    Optimization.recordActual('meal_0', 'ing_chk', 117);

    // User updates Chicken definition (e.g. higher protein)
    const chkDef = state.ingredients.find(i => i.id === 'ing_chk');
    chkDef.protein = 35; // increased from 31

    const outcome = Optimization.solve({ preserveActuals: true });
    const bChk = outcome.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const passed = bChk?.isActual === true && Math.abs(bChk.actualQuantity - 117) < 0.01;

    console.log(`[AP-5] Re-solving After Changing Ingredient Definition:`);
    console.log(`       Breakfast Chicken: ${bChk?.quantity}g ACTUAL with updated 35g protein/serv`);
    console.log(`       Status: ${passed ? 'PASSED (Actuals use updated ingredient nutrition smoothly)' : 'FAILED'}\n`);
    results.push({ name: 'AP-5: Ingredient Definition Update', passed });
  }

  // AP-6: Physical observation exceeding configured max bounds
  {
    resetToTestDefaults();
    // Configure strict maxServings: 1.0 (100g max)
    const chkDef = state.ingredients.find(i => i.id === 'ing_chk');
    chkDef.maxServings = 1.0;

    // User physically consumed 137g (1.37 serv > 1.0 maxServings)
    const outcome = Optimization.recordActual('meal_0', 'ing_chk', 137);
    const bChk = outcome.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const passed = !outcome.errors && outcome.result && bChk?.isActual === true && Math.abs(bChk.quantity - 137) < 0.01;

    console.log(`[AP-6] Physical Observation Exceeding Configured Max Bound (137g > 100g max):`);
    console.log(`       Feasible: ${!outcome.errors && !!outcome.result}`);
    console.log(`       Chicken Quantity: ${bChk?.quantity}g ACTUAL (${bChk?.servings?.toFixed(2)} serv)`);
    console.log(`       Status: ${passed ? 'PASSED (Observation honoured without failing feasibility)' : 'FAILED'}\n`);
    results.push({ name: 'AP-6: Physical Bound Exceedance', passed });
  }

  // AP-7: Discrete ingredients remain strictly integer when unfixed
  {
    resetToTestDefaults();
    state.ingredients.push({
      id: 'ing_egg',
      name: 'Eggs',
      servingSize: 50,
      unit: 'g',
      calories: 72,
      protein: 6.3,
      carbs: 0.4,
      fat: 4.8,
      minServings: 0,
      maxServings: 4,
      quantityMode: 'discrete',
      availability: 'normal'
    });

    Optimization.solve({ preserveActuals: false });
    const outcome = Optimization.recordActual('meal_0', 'ing_chk', 117);

    const allEggs = [];
    outcome.result?.mealResults.forEach(m => {
      m.items.forEach(item => {
        if (item.name === 'Eggs') allEggs.push(item);
      });
    });

    const discretePreserved = allEggs.every(e => Number.isInteger(e.servings));
    const passed = Boolean(allEggs.length > 0 && discretePreserved);

    console.log(`[AP-7] Discrete Ingredients Domain Preservation:`);
    allEggs.forEach(e => console.log(`       Meal item: ${e.name} = ${e.servings} serv (${e.quantity} ${e.unit})`));
    console.log(`       Status: ${passed ? 'PASSED (Unfixed discrete variables strictly remain integers)' : 'FAILED'}\n`);
    results.push({ name: 'AP-7: Discrete Domain Preservation', passed });
  }

  // AP-8: Clearing actual portion restores flexible optimization
  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    Optimization.recordActual('meal_0', 'ing_chk', 117);

    // Clear actual
    const outcome = Optimization.clearActual('meal_0', 'ing_chk');
    const bChk = outcome.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const passed = bChk ? bChk.isActual === false && bChk.actualQuantity === null : true;

    console.log(`[AP-8] Clearing Actual Portion:`);
    console.log(`       Breakfast Chicken isActual: ${bChk?.isActual} (actualQuantity: ${bChk?.actualQuantity})`);
    console.log(`       Status: ${passed ? 'PASSED (Clearing restored flexible optimization)' : 'FAILED'}\n`);
    results.push({ name: 'AP-8: Clearing Actual Portion', passed });
  }

  // AP-9: Persistence and restoration of actual portions
  {
    resetToTestDefaults();
    global.localStorage.clear();
    Optimization.solve({ preserveActuals: false });
    Optimization.recordActual('meal_0', 'ing_chk', 117, 100);
    Persistence.save();

    // Verify localStorage has actuals in result
    const rawResult = global.localStorage.getItem(RESULT_KEY);
    const parsed = JSON.parse(rawResult);
    const hasActualsInStorage = parsed && parsed.actuals && Object.keys(parsed.actuals).length > 0;

    // Clear memory state and reload
    state.actuals = {};
    state.result = null;
    Persistence.load();

    const loadedChk = state.result?.mealResults[0].items.find(i => i.name === 'Chicken');
    const passed = hasActualsInStorage && state.actuals['meal_0_ing_chk'] && loadedChk?.isActual === true && Math.abs(loadedChk.actualQuantity - 117) < 0.01;

    console.log(`[AP-9] Persistence and Restoration of Actual Portions:`);
    console.log(`       In Storage: ${hasActualsInStorage}`);
    console.log(`       Restored Chicken isActual: ${loadedChk?.isActual}, actual=${loadedChk?.actualQuantity}g`);
    console.log(`       Status: ${passed ? 'PASSED (Actuals saved and restored across reloads)' : 'FAILED'}\n`);
    results.push({ name: 'AP-9: Persistence and Restoration', passed });
  }

  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('ERROR: Some actual portion tests failed!');
    process.exitCode = 1;
  }
  return results;
}

function mealItemSignature(meal) {
  return (meal?.items || [])
    .map(i => `${i.name}:${Number(i.quantity).toFixed(3)}`)
    .sort()
    .join('|');
}

function mealNames(meal) {
  return (meal?.items || []).map(i => i.name).sort().join(',');
}

export function runEatenMealTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING EATEN / UNEATEN MEAL LOCKING TEST SUITE                    ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const results = [];

  function resetToTestDefaults() {
    Persistence.resetToDefaults();
    state.targets = { calories: 2335, protein: 151, carbs: 291, fat: 62 };
    state.meals = [
      { id: 'meal_0', name: 'Breakfast', pct: 40 },
      { id: 'meal_1', name: 'Lunch', pct: 20 },
      { id: 'meal_2', name: 'Dinner', pct: 40 }
    ];
    state.ingredients = [
      { id: 'ing_chk', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'ing_yuc', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'ing_mlk', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous', availability: 'normal' }
    ];
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002, availabilityLow: 0.0005, availabilityOut: 0.002 };
    state.actuals = {};
    state.eatenMeals = {};
  }

  {
    resetToTestDefaults();
    const initial = Optimization.solve({ preserveActuals: false });
    const before = initial.result.mealResults.map(mealItemSignature);
    Optimization.markMealEaten('meal_0');
    const after = state.result.mealResults.map(mealItemSignature);
    const passed = before.every((sig, i) => sig === after[i]) && state.result.mealResults[0].isEaten === true;

    console.log(`[EM-1] Marking EATEN Does Not Change Quantities:`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-1: Mark EATEN does not change quantities', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    const breakfastBefore = mealItemSignature(state.result.mealResults[0]);
    Optimization.markMealEaten('meal_0');
    const outcome = Optimization.solve({ preserveActuals: true });
    const breakfastAfter = mealItemSignature(outcome.result?.mealResults[0]);
    const passed = Boolean(outcome.result) && breakfastBefore === breakfastAfter &&
      outcome.result.mealResults[0].isEaten === true;

    console.log(`[EM-2] EATEN Meal Survives SOLVE:`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-2: EATEN survives SOLVE unchanged', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    const breakfastBefore = mealItemSignature(state.result.mealResults[0]);
    const lunchBefore = mealItemSignature(state.result.mealResults[1]);
    const dinnerBefore = mealItemSignature(state.result.mealResults[2]);
    Optimization.markMealEaten('meal_0');
    state.ingredients.forEach(ing => { ing.maxServings = 20; });
    state.targets.calories = 2800;
    const outcome = Optimization.solve({ preserveActuals: true });
    const breakfastAfter = mealItemSignature(outcome.result?.mealResults[0]);
    const uneatenChanged = mealItemSignature(outcome.result?.mealResults[1]) !== lunchBefore ||
      mealItemSignature(outcome.result?.mealResults[2]) !== dinnerBefore;
    const passed = breakfastBefore === breakfastAfter && Boolean(outcome.result) && uneatenChanged;

    console.log(`[EM-3] UNEATEN Re-optimized Around EATEN:`);
    console.log(`       Breakfast locked=${breakfastBefore === breakfastAfter} uneatenChanged=${uneatenChanged} totals=${outcome.result?.totals?.calories?.toFixed(0)}`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-3: UNEATEN re-optimized around EATEN', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    const b0 = mealItemSignature(state.result.mealResults[0]);
    const l0 = mealItemSignature(state.result.mealResults[1]);
    Optimization.markMealEaten('meal_0');
    Optimization.markMealEaten('meal_1');
    const outcome = Optimization.solve({ preserveActuals: true });
    const passed = mealItemSignature(outcome.result?.mealResults[0]) === b0 &&
      mealItemSignature(outcome.result?.mealResults[1]) === l0 &&
      outcome.result.mealResults[0].isEaten &&
      outcome.result.mealResults[1].isEaten &&
      outcome.result.mealResults[2].isEaten !== true;

    console.log(`[EM-4] Multiple EATEN Meals:`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-4: Multiple EATEN meals', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    Optimization.markMealEaten('meal_0');
    Optimization.unmarkMealEaten('meal_0');
    const unlocked = !state.result.mealResults[0].isEaten && !state.eatenMeals['meal_0'];
    const outcome = Optimization.solve({ preserveActuals: true });
    const passed = unlocked && outcome.result && outcome.result.mealResults[0].isEaten !== true;

    console.log(`[EM-5] Mark UNEATEN Again:`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-5: EATEN can be marked UNEATEN', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    const namesBefore = mealNames(state.result.mealResults[0]);
    const sigBefore = mealItemSignature(state.result.mealResults[0]);
    Optimization.markMealEaten('meal_0');
    state.targets.protein = 180;
    const outcome = Optimization.solve({ preserveActuals: true });
    const namesAfter = mealNames(outcome.result?.mealResults[0]);
    const passed = namesBefore === namesAfter && sigBefore === mealItemSignature(outcome.result?.mealResults[0]);

    console.log(`[EM-6] EATEN Ingredient Set Immutable:`);
    console.log(`       Ingredients: ${namesBefore} -> ${namesAfter}`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-6: EATEN cannot gain/remove ingredients', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    const bCal = state.result.mealResults[0].calories;
    Optimization.markMealEaten('meal_0');
    state.ingredients.forEach(ing => { ing.maxServings = 20; });
    state.targets.calories = 2600;
    const outcome = Optimization.solve({ preserveActuals: true });
    const bCalAfter = outcome.result?.mealResults[0].calories;
    const passed = Math.abs(bCal - bCalAfter) < 0.01 &&
      Math.abs((outcome.result.mealResults[1].calories + outcome.result.mealResults[2].calories) - (2600 - bCalAfter)) < 80;

    console.log(`[EM-7] Allocation Changes Only Among UNEATEN:`);
    console.log(`       Breakfast kcal ${bCal.toFixed(1)} -> ${bCalAfter?.toFixed(1)}`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-7: Allocation only among UNEATEN', passed });
  }

  {
    resetToTestDefaults();
    Optimization.solve({ preserveActuals: false });
    const breakfastBefore = mealItemSignature(state.result.mealResults[0]);
    Optimization.markMealEaten('meal_0');
    state.mealConstraints.minIngredients = 10;
    const outcome = Optimization.solve({ preserveActuals: true });
    const passed = Boolean(outcome.errors && outcome.errors.length > 0) &&
      mealItemSignature(state.result.mealResults[0]) === breakfastBefore &&
      Boolean(state.eatenMeals['meal_0']);

    console.log(`[EM-8] Infeasible Remaining Leaves EATEN Unchanged:`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-8: Infeasible remaining never modifies EATEN', passed });
  }

  {
    resetToTestDefaults();
    global.localStorage.clear();
    Optimization.solve({ preserveActuals: false });
    Optimization.markMealEaten('meal_0');
    Persistence.save();

    const rawResult = global.localStorage.getItem(RESULT_KEY);
    const parsed = JSON.parse(rawResult);
    const stored = parsed && parsed.eatenMeals && parsed.eatenMeals.meal_0;

    state.eatenMeals = {};
    state.result = null;
    Persistence.load();

    const passed = Boolean(stored) && Boolean(state.eatenMeals['meal_0']) &&
      state.result?.mealResults[0]?.isEaten === true;

    console.log(`[EM-9] Persistence Across Reloads:`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-9: EATEN persists across reloads', passed });
  }

  {
    let t = 0;
    let completed = 0;
    let cancelled = 0;
    const controller = createPressHoldController({
      duration: 800,
      now: () => t,
      onComplete: () => { completed += 1; },
      onCancel: () => { cancelled += 1; }
    });

    controller.pointerDown(0, 0);
    t = 100;
    controller.tick();
    controller.pointerUp();
    const tapDidNotComplete = completed === 0 && cancelled === 1;

    t = 200;
    controller.pointerDown(0, 0);
    t = 1000;
    const holdCompleted = controller.tick() === true && completed === 1;

    t = 1100;
    controller.pointerDown(0, 0);
    controller.pointerMove(20, 0);
    const moveCancelled = cancelled === 2 && completed === 1;

    const passed = tapDidNotComplete && holdCompleted && moveCancelled;

    console.log(`[EM-10] Long-Press Reliability:`);
    console.log(`       Tap ignored=${tapDidNotComplete}, hold completed=${holdCompleted}, move cancelled=${moveCancelled}`);
    console.log(`       Status: ${passed ? 'PASSED' : 'FAILED'}\n`);
    results.push({ name: 'EM-10: Long-press completes; taps do not toggle', passed });
  }

  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('ERROR: Some EATEN meal tests failed!');
    process.exitCode = 1;
  }
  return results;
}




