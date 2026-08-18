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

import { Optimization } from '../src/core/solver.js';
import { state } from '../src/core/state.js';
import { Validation } from '../src/core/validation.js';
import { ImportExport } from '../src/io/persistence.js';

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

