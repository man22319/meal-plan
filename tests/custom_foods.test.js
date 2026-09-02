// ══════════════════════════════════════════
// CUSTOM FOODS TEST SUITE
// ══════════════════════════════════════════

import assert from 'node:assert';
import { state, DEFAULT_INGREDIENTS, DEFAULT_TARGETS, DEFAULT_MEALS } from '../src/core/state.js';
import {
  addCustomFood,
  updateCustomFood,
  removeCustomFood,
  aggregateCustomFoods,
  getRemainingTargets,
  getRemainingMealTarget,
  detectInfeasibleDimensions,
  isValidCustomFoodEntry
} from '../src/core/customFoods.js';
import { solveModel } from '../src/core/solver.js';
// Global mock solver and localStorage if in Node environment
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (typeof global.solver === 'undefined') {
  const vendorSolverPath = path.resolve(__dirname, '../src/vendor/solver.js');
  const vendorCode = fs.readFileSync(vendorSolverPath, 'utf8');
  const solverSandbox = {};
  const initSolver = new Function('window', 'self', 'exports', 'module', vendorCode);
  initSolver(solverSandbox, solverSandbox, undefined, undefined);
  global.solver = solverSandbox.solver;
}

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };
}

export function runCustomFoodsTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING CUSTOM FOODS & SURPRISE MEAL OPTIMIZATION TEST SUITE       ');
  console.log('═══════════════════════════════════════════════════════════════════');

  function resetTestState() {
    state.targets = { calories: 2335, protein: 151, carbs: 291, fat: 62 };
    state.meals = [
      { id: 'meal_breakfast', name: 'Breakfast', pct: 40 },
      { id: 'meal_lunch', name: 'Lunch', pct: 20 },
      { id: 'meal_dinner', name: 'Dinner', pct: 40 }
    ];
    state.ingredients = [
      { id: 'ing_chicken', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'ing_yuca', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'ing_milk', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous', availability: 'normal' }
    ];
    state.customFoods = [];
    state.actuals = {};
    state.eatenItems = {};
    state.result = null;
  }

// ── TEST 1: CRUD Operations & ID generation ──
{
  resetTestState();
  const res = addCustomFood({
    name: 'Buffalo Chicken Wrap',
    amount: 1,
    unit: 'wrap',
    calories: 650,
    protein: 35,
    carbs: 55,
    fat: 28,
    meal: 'meal_lunch'
  });

  assert.ok(res.entry, 'Entry created');
  assert.strictEqual(state.customFoods.length, 1);
  assert.strictEqual(res.entry.name, 'Buffalo Chicken Wrap');
  assert.strictEqual(res.entry.calories, 650);
  assert.strictEqual(res.entry.confidence.calories, 'known');
  assert.strictEqual(res.entry.meal, 'meal_lunch');

  // Update
  const updateRes = updateCustomFood(res.entry.id, {
    amount: 1.5,
    unit: 'wraps',
    calories: 700
  });
  assert.ok(updateRes.entry);
  assert.strictEqual(state.customFoods[0].amount, 1.5);
  assert.strictEqual(state.customFoods[0].unit, 'wraps');
  assert.strictEqual(state.customFoods[0].calories, 700);

  // Remove
  const removeRes = removeCustomFood(res.entry.id);
  assert.ok(removeRes.removed);
  assert.strictEqual(state.customFoods.length, 0);

  console.log('[CF-1] CRUD Operations & ID Generation: PASSED');
}

// ── TEST 2: Nutrition Values Represent Entire Declared Quantity ──
{
  resetTestState();
  // Entering 2 bowls does NOT scale 400 kcal into 800 kcal; 400 kcal is the declared total
  addCustomFood({
    name: 'Dining Hall Cereal',
    amount: 2,
    unit: 'bowls',
    calories: 400,
    protein: 12,
    carbs: 65,
    fat: 10
  });

  const agg = aggregateCustomFoods();
  assert.strictEqual(agg.calories.known, 400, 'Nutrition values are NOT multiplied by amount');
  assert.strictEqual(agg.protein.known, 12);
  assert.strictEqual(agg.carbs.known, 65);
  assert.strictEqual(agg.fat.known, 10);

  console.log('[CF-2] Nutrition Values Represent Entire Declared Quantity: PASSED');
}

// ── TEST 3: Per-Macro Confidence (Known vs Estimated vs Unknown) ──
{
  resetTestState();
  addCustomFood({
    name: 'Mixed Meal',
    amount: 1,
    unit: 'plate',
    calories: 500,
    protein: 30,
    carbs: null,
    fat: 15,
    confidence: {
      calories: 'known',
      protein: 'estimated',
      fat: 'estimated'
    }
  });

  const entry = state.customFoods[0];
  assert.strictEqual(entry.confidence.calories, 'known');
  assert.strictEqual(entry.confidence.protein, 'estimated');
  assert.strictEqual(entry.confidence.carbs, 'unknown', 'Null carbs automatically gets unknown confidence');
  assert.strictEqual(entry.confidence.fat, 'estimated');

  console.log('[CF-3] Per-Macro Confidence Mapping: PASSED');
}

// ── TEST 4: Partial Unknowns Across Multiple Custom Foods ──
// Explicitly requested by user:
// Food A: 650 kcal, 35P, 55C, 28F
// Food B: 300 kcal, null P, 40C, 10F
// Verify: Calories subtract 950, Carbs subtract 95g, Fat subtract 38g,
// Protein remains unconstrained because one entry is unknown,
// but known 35g is retained in aggregation display.
{
  resetTestState();
  addCustomFood({
    name: 'Food A',
    amount: 1,
    unit: 'wrap',
    calories: 650,
    protein: 35,
    carbs: 55,
    fat: 28
  });
  addCustomFood({
    name: 'Food B',
    amount: 1,
    unit: 'snack',
    calories: 300,
    protein: null,
    carbs: 40,
    fat: 10
  });

  const agg = aggregateCustomFoods();
  assert.strictEqual(agg.calories.known, 950);
  assert.strictEqual(agg.calories.hasUnknown, false);

  assert.strictEqual(agg.protein.known, 35, 'Known protein from Food A is preserved');
  assert.strictEqual(agg.protein.hasUnknown, true, 'Protein has unknown flag from Food B');

  assert.strictEqual(agg.carbs.known, 95);
  assert.strictEqual(agg.carbs.hasUnknown, false);

  assert.strictEqual(agg.fat.known, 38);
  assert.strictEqual(agg.fat.hasUnknown, false);

  const remaining = getRemainingTargets(state.targets);
  assert.strictEqual(remaining.calories.value, 2335 - 950, 'Calories remaining is 2335 - 950 = 1385');
  assert.strictEqual(remaining.calories.known, true);

  // Protein must NOT be reduced by 35g since Food B is unknown
  assert.strictEqual(remaining.protein.value, 151, 'Protein remains unconstrained / at original target');
  assert.strictEqual(remaining.protein.known, false);
  assert.strictEqual(remaining.protein.consumed, 35, 'Consumed protein tracks known 35g for display');

  assert.strictEqual(remaining.carbs.value, 291 - 95, 'Carbs remaining is 291 - 95 = 196');
  assert.strictEqual(remaining.fat.value, 62 - 38, 'Fat remaining is 62 - 38 = 24');

  console.log('[CF-4] Partial Unknowns Across Multiple Custom Foods: PASSED');
}

// ── TEST 5: Estimated Foods Still Participate in Optimization ──
{
  resetTestState();
  addCustomFood({
    name: 'Food A (Known)',
    amount: 1,
    unit: 'item',
    calories: 400,
    protein: 20,
    carbs: 50,
    fat: 10,
    confidence: { calories: 'known', protein: 'known', carbs: 'known', fat: 'known' }
  });
  addCustomFood({
    name: 'Food B (Estimated)',
    amount: 1,
    unit: 'item',
    calories: 200,
    protein: 10,
    carbs: 20,
    fat: 5,
    confidence: { calories: 'estimated', protein: 'estimated', carbs: 'estimated', fat: 'estimated' }
  });

  const remaining = getRemainingTargets(state.targets);
  assert.strictEqual(remaining.calories.value, 2335 - 600, 'Estimated foods participate in subtraction');
  assert.strictEqual(remaining.protein.value, 151 - 30);
  assert.strictEqual(remaining.carbs.value, 291 - 70);
  assert.strictEqual(remaining.fat.value, 62 - 15);

  console.log('[CF-5] Estimated Foods Participate in Optimization: PASSED');
}

// ── TEST 6: Meal-Level Target Subtraction ──
{
  resetTestState();
  // Lunch is 20% of 2335 = 467 kcal
  const lunchCalTarget = 0.20 * 2335;

  addCustomFood({
    name: 'Lunch Wrap',
    amount: 1,
    unit: 'wrap',
    calories: 300,
    protein: 25,
    carbs: 30,
    fat: 10,
    meal: 'meal_lunch'
  });
  addCustomFood({
    name: 'Unassigned Snack',
    amount: 1,
    unit: 'pack',
    calories: 150,
    protein: 5,
    carbs: 20,
    fat: 5,
    meal: null
  });

  // Lunch remaining target
  const lunchRemaining = getRemainingMealTarget('meal_lunch', lunchCalTarget);
  assert.strictEqual(lunchRemaining.consumed, 300, 'Lunch consumed tracks only lunch-assigned food');
  assert.strictEqual(lunchRemaining.value, lunchCalTarget - 300, 'Lunch remaining subtracts lunch custom food');

  // Breakfast remaining target (no custom foods)
  const bfastRemaining = getRemainingMealTarget('meal_breakfast', 0.40 * 2335);
  assert.strictEqual(bfastRemaining.consumed, 0);
  assert.strictEqual(bfastRemaining.value, 0.40 * 2335);

  console.log('[CF-6] Meal-Level Target Subtraction: PASSED');
}

// ── TEST 7: Infeasibility Detection ──
{
  resetTestState();
  addCustomFood({
    name: 'Fatty Feast',
    amount: 1,
    unit: 'meal',
    calories: 1200,
    protein: 50,
    carbs: 40,
    fat: 70 // Daily target is 62g -> 8g deficit!
  });

  const issues = detectInfeasibleDimensions(state.targets);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].macro, 'fat');
  assert.strictEqual(issues[0].target, 62);
  assert.strictEqual(issues[0].consumed, 70);
  assert.strictEqual(issues[0].deficit, 8);

  console.log('[CF-7] Infeasibility Detection: PASSED');
}

// ── TEST 8: Discarding Malformed Entries in Persistence ──
{
  assert.strictEqual(isValidCustomFoodEntry(null), false);
  assert.strictEqual(isValidCustomFoodEntry({}), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: '', amount: 1, unit: 'g' }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: -1, unit: 'g' }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: 1, unit: '' }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: 1, unit: 'g', calories: -50 }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: 1, unit: 'g', calories: 95, protein: null }), true);

  console.log('[CF-8] Discarding Malformed Entries: PASSED');
}

// ── TEST 9: Full End-to-End MILP Solver Optimization with Custom Foods ──
{
  resetTestState();
  addCustomFood({
    name: 'Buffalo Chicken Wrap',
    amount: 1,
    unit: 'wrap',
    calories: 650,
    protein: 35,
    carbs: 55,
    fat: 28,
    meal: 'meal_lunch'
  });

  const outcome = solveModel(state);
  assert.strictEqual(outcome.feasible, true, 'Solver is feasible');
  assert.ok(outcome.result, 'Result generated');

  const r = outcome.result;
  assert.ok(r.customFoodTotals, 'Result contains customFoodTotals');
  assert.strictEqual(r.customFoodTotals.calories, 650);
  assert.strictEqual(r.customFoodTotals.protein, 35);
  assert.strictEqual(r.customFoodTotals.carbs, 55);
  assert.strictEqual(r.customFoodTotals.fat, 28);

  // Normal ingredients optimized for remaining (2335 - 650 = 1685 kcal)
  // totals.calories should be around 1685 kcal (within solver multi-macro compromise)
  const remainingKcal = 2335 - 650;
  assert.ok(Math.abs(r.totals.calories - remainingKcal) < 60, `Optimizer satisfied remaining calories: ${r.totals.calories} vs ${remainingKcal}`);

  // Combined totals should equal target (~2335 kcal within 60 kcal)
  assert.ok(Math.abs(r.combinedTotals.calories - 2335) < 60, `Combined total equals target: ${r.combinedTotals.calories} vs 2335`);

  // Deviations evaluated against original target
  assert.ok(Math.abs(r.combinedDeviations.calories.absolute) < 60, `Combined deviation within compromise: ${r.combinedDeviations.calories.absolute}`);

  console.log('[CF-9] End-to-End Solver Optimization with Custom Foods: PASSED');
}

  // Reset state back to defaults so other test suites are clean
  state.targets = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
  state.meals = JSON.parse(JSON.stringify(DEFAULT_MEALS));
  state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
  state.customFoods = [];
  state.actuals = {};
  state.eatenItems = {};
  state.result = null;

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' ALL CUSTOM FOOD TESTS PASSED!                                     ');
  console.log('═══════════════════════════════════════════════════════════════════');
}

if (process.argv[1] && process.argv[1].endsWith('custom_foods.test.js')) {
  runCustomFoodsTestSuite();
}
