// ══════════════════════════════════════════
// CUSTOM FOODS TEST SUITE
// ══════════════════════════════════════════

import assert from 'node:assert';
import { state, DEFAULT_INGREDIENTS, DEFAULT_TARGETS, DEFAULT_MEALS, generateStateFingerprint } from '../src/core/state.js';
import {
  addCustomFood,
  updateCustomFood,
  removeCustomFood,
  aggregateCustomFoods,
  getRemainingTargets,
  getRemainingMealTarget,
  detectInfeasibleDimensions,
  isValidCustomFoodEntry,
  resolveMeal,
  normalizeCustomFood,
  validateCustomFood,
  getPlanningValue,
  getRecordedValue
} from '../src/core/customFoods.js';
import { solveModel } from '../src/core/solver.js';
import { createIntakeSnapshot, recordIntakeSnapshot } from '../src/core/history.js';
import { calculateAverageIntake, getCombinedHistoryRows } from '../src/core/stats.js';
import { ImportExport } from '../src/io/persistence.js';
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

  // Normalize nested compatibility input into canonical flat representation
  const normalized = normalizeCustomFood({
    name: 'Nested Burrito',
    amount: 1,
    unit: 'wrap',
    calories: { value: 700, status: 'estimated', range: { min: 600, max: 850 } },
    protein: { value: 35, status: 'known' },
    carbs: { value: null, status: 'unknown' },
    fat: 25
  });
  assert.strictEqual(normalized.calories, 700);
  assert.strictEqual(normalized.confidence.calories, 'estimated');
  assert.deepStrictEqual(normalized.ranges.calories, { min: 600, max: 850 });
  assert.strictEqual(normalized.protein, 35);
  assert.strictEqual(normalized.confidence.protein, 'known');
  assert.strictEqual(normalized.ranges.protein, null);
  assert.strictEqual(normalized.carbs, null);
  assert.strictEqual(normalized.confidence.carbs, 'unknown');
  assert.strictEqual(normalized.ranges.carbs, null);
  assert.strictEqual(normalized.fat, 25);
  assert.strictEqual(normalized.confidence.fat, 'known');

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

// ── TEST 5: Known value uses recorded value ──
{
  resetTestState();
  addCustomFood({
    name: 'Known Food',
    amount: 1,
    unit: 'item',
    calories: 700,
    protein: 35,
    carbs: 80,
    fat: 25,
    confidence: { calories: 'known', protein: 'known', carbs: 'known', fat: 'known' }
  });
  assert.strictEqual(getPlanningValue('calories', state.customFoods[0]), 700);
  assert.strictEqual(getRecordedValue('calories', state.customFoods[0]), 700);
  console.log('[CF-5] Known value uses recorded value: PASSED');
}

// ── TEST 6: Estimated value without range uses recorded estimate ──
{
  resetTestState();
  addCustomFood({
    name: 'Estimated No Range',
    amount: 1,
    unit: 'item',
    calories: 700,
    protein: 35,
    carbs: 80,
    fat: 25,
    confidence: { calories: 'estimated', protein: 'known', carbs: 'known', fat: 'known' }
  });
  assert.strictEqual(getPlanningValue('calories', state.customFoods[0]), 700);
  assert.strictEqual(getRecordedValue('calories', state.customFoods[0]), 700);
  console.log('[CF-6] Estimated value without range uses recorded estimate: PASSED');
}

// ── TEST 7: Estimated value with range uses midpoint ──
{
  resetTestState();
  addCustomFood({
    name: 'Estimated With Range',
    amount: 1,
    unit: 'item',
    calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } }
  });
  assert.strictEqual(getPlanningValue('calories', state.customFoods[0]), 725, 'Midpoint of 600 and 850 is 725');
  assert.strictEqual(getRecordedValue('calories', state.customFoods[0]), 700, 'Recorded value remains 700');
  console.log('[CF-7] Estimated value with range uses midpoint: PASSED');
}

// ── TEST 8: Displayed value remains the recorded estimate ──
{
  resetTestState();
  addCustomFood({
    name: 'Display Check',
    amount: 1,
    unit: 'item',
    calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } }
  });
  const cf = state.customFoods[0];
  const isEstCal = cf.confidence?.calories === 'estimated';
  const recordedCal = getRecordedValue('calories', cf);
  const calStr = recordedCal !== null ? `${isEstCal ? '~' : ''}${Math.round(recordedCal)} kcal` : '—';
  assert.strictEqual(calStr, '~700 kcal', 'Displayed value is recorded estimate with tilde');
  console.log('[CF-8] Displayed value remains the recorded estimate: PASSED');
}

// ── TEST 9: Daily remaining targets use planning values ──
{
  resetTestState();
  addCustomFood({
    name: 'Planning Target Food',
    amount: 1,
    unit: 'item',
    calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } }
  });
  const remaining = getRemainingTargets(state.targets);
  assert.strictEqual(remaining.calories.value, 2335 - 725, 'Daily remaining uses planning value 725');
  assert.strictEqual(remaining.calories.consumed, 725);
  console.log('[CF-9] Daily remaining targets use planning values: PASSED');
}

// ── TEST 10: Meal remaining targets use planning values ──
{
  resetTestState();
  const lunchCalTarget = 0.20 * 2335;
  addCustomFood({
    name: 'Lunch Food',
    amount: 1,
    unit: 'item',
    calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } },
    meal: 'meal_lunch'
  });
  const lunchRemaining = getRemainingMealTarget('meal_lunch', lunchCalTarget);
  assert.strictEqual(lunchRemaining.consumed, 725, 'Meal consumed uses planning value 725');
  assert.strictEqual(lunchRemaining.value, lunchCalTarget - 725, 'Meal remaining subtracts planning value 725');
  console.log('[CF-10] Meal remaining targets use planning values: PASSED');
}

// ── TEST 11: Unknown contributes no numerical constraint ──
{
  resetTestState();
  addCustomFood({
    name: 'Partial Unknown Food',
    amount: 1,
    unit: 'item',
    calories: 500,
    protein: null,
    carbs: 60,
    fat: 15
  });
  assert.strictEqual(getPlanningValue('protein', state.customFoods[0]), null);
  const remaining = getRemainingTargets(state.targets);
  assert.strictEqual(remaining.protein.known, false);
  assert.strictEqual(remaining.protein.value, state.targets.protein, 'Unknown macro target is unconstrained');
  assert.strictEqual(remaining.calories.value, 2335 - 500, 'Known calories are subtracted');
  console.log('[CF-11] Unknown contributes no numerical constraint: PASSED');
}

// ── TEST 12: Different nutrient ranges are independently transformed ──
{
  resetTestState();
  addCustomFood({
    name: 'Multi-Range Burrito',
    amount: 1,
    unit: 'wrap',
    calories: 700,
    protein: 35,
    carbs: 80,
    fat: 25,
    confidence: {
      calories: 'estimated',
      protein: 'estimated',
      carbs: 'estimated',
      fat: 'estimated'
    },
    ranges: {
      calories: { min: 600, max: 850 },
      protein: { min: 30, max: 40 },
      carbs: { min: 65, max: 95 },
      fat: { min: 20, max: 30 }
    }
  });
  const cf = state.customFoods[0];
  assert.strictEqual(getPlanningValue('calories', cf), 725);
  assert.strictEqual(getPlanningValue('protein', cf), 35);
  assert.strictEqual(getPlanningValue('carbs', cf), 80);
  assert.strictEqual(getPlanningValue('fat', cf), 25);
  console.log('[CF-12] Different nutrient ranges independently transformed: PASSED');
}

// ── TEST 13: Multiple estimated foods aggregate their planning values correctly ──
{
  resetTestState();
  addCustomFood({
    name: 'Est Food 1',
    amount: 1,
    unit: 'serving',
    calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } } // midpoint 725
  });
  addCustomFood({
    name: 'Est Food 2',
    amount: 1,
    unit: 'serving',
    calories: 350,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 300, max: 400 } } // midpoint 350
  });
  const planningAgg = aggregateCustomFoods(null, state.customFoods, { usePlanning: true });
  const recordedAgg = aggregateCustomFoods(null, state.customFoods, { usePlanning: false });
  assert.strictEqual(planningAgg.calories.total, 725 + 350, 'Planning aggregation sums midpoints: 1075');
  assert.strictEqual(recordedAgg.calories.total, 700 + 350, 'Recorded aggregation sums user estimates: 1050');
  console.log('[CF-13] Multiple estimated foods aggregate planning values correctly: PASSED');
}

// ── TEST 14: Known food with identical numeric value to an estimate remains semantically different ──
{
  resetTestState();
  addCustomFood({
    name: 'Known 700',
    amount: 1,
    unit: 'serving',
    calories: 700,
    confidence: { calories: 'known' }
  });
  addCustomFood({
    name: 'Estimated 700',
    amount: 1,
    unit: 'serving',
    calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } }
  });
  const foodKnown = state.customFoods[0];
  const foodEst = state.customFoods[1];
  assert.strictEqual(foodKnown.confidence.calories, 'known');
  assert.strictEqual(foodEst.confidence.calories, 'estimated');
  assert.strictEqual(getPlanningValue('calories', foodKnown), 700);
  assert.strictEqual(getPlanningValue('calories', foodEst), 725);
  console.log('[CF-14] Known vs Estimated semantic difference: PASSED');
}

// ── TEST 15: Invalid ranges are rejected ──
{
  // min > max
  const err1 = validateCustomFood({
    name: 'Bad 1', amount: 1, unit: 'g', calories: 700,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 800, max: 700 } }
  });
  assert.ok(err1.some(e => e.includes('cannot be greater than max')));

  // value < min
  const err2 = validateCustomFood({
    name: 'Bad 2', amount: 1, unit: 'g', calories: 500,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 800 } }
  });
  assert.ok(err2.some(e => e.includes('must fall within the evidence range')));

  // value > max
  const err3 = validateCustomFood({
    name: 'Bad 3', amount: 1, unit: 'g', calories: 900,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 800 } }
  });
  assert.ok(err3.some(e => e.includes('must fall within the evidence range')));

  // min < 0
  const err4 = validateCustomFood({
    name: 'Bad 4', amount: 1, unit: 'g', calories: 100,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: -10, max: 200 } }
  });
  assert.ok(err4.some(e => e.includes('must be a non-negative number')));

  // range on known
  const err5 = validateCustomFood({
    name: 'Bad 5', amount: 1, unit: 'g', calories: 700,
    confidence: { calories: 'known' },
    ranges: { calories: { min: 600, max: 800 } }
  });
  assert.ok(err5.some(e => e.includes('cannot be supplied for known nutrients')));

  // range on unknown
  const err6 = validateCustomFood({
    name: 'Bad 6', amount: 1, unit: 'g', calories: null,
    confidence: { calories: 'unknown' },
    ranges: { calories: { min: 600, max: 800 } }
  });
  assert.ok(err6.some(e => e.includes('cannot be supplied for unknown nutrients')));

  console.log('[CF-15] Invalid ranges are rejected: PASSED');
}

// ── TEST 16: Atwater reconciliation receives planning nutrient values ──
{
  resetTestState();
  addCustomFood({
    name: 'Burrito (Estimated with ranges)',
    amount: 1,
    unit: 'wrap',
    calories: 700,
    protein: 35,
    carbs: 80,
    fat: 25,
    confidence: {
      calories: 'estimated',
      protein: 'estimated',
      carbs: 'known',
      fat: 'known'
    },
    ranges: {
      calories: { min: 600, max: 850 },
      protein: { min: 30, max: 40 }
    }
  });

  const outcomeEst = solveModel(state);
  assert.strictEqual(outcomeEst.feasible, true);

  // Compare with identical planning numbers provided as known:
  resetTestState();
  addCustomFood({
    name: 'Burrito (Known planning equivalents)',
    amount: 1,
    unit: 'wrap',
    calories: 725,
    protein: 35,
    carbs: 80,
    fat: 25,
    confidence: { calories: 'known', protein: 'known', carbs: 'known', fat: 'known' }
  });
  const outcomeKnown = solveModel(state);
  assert.strictEqual(outcomeKnown.feasible, true);

  // Both models face identical remaining targets and produce identical solver solutions
  assert.strictEqual(outcomeEst.result.totals.calories, outcomeKnown.result.totals.calories);
  assert.strictEqual(outcomeEst.result.totals.protein, outcomeKnown.result.totals.protein);
  assert.strictEqual(outcomeEst.result.totals.carbs, outcomeKnown.result.totals.carbs);
  assert.strictEqual(outcomeEst.result.totals.fat, outcomeKnown.result.totals.fat);

  console.log('[CF-16] Atwater reconciliation receives planning values: PASSED');
}

// ── TEST 17: Range changes invalidate the solved plan ──
{
  resetTestState();
  addCustomFood({
    name: 'Range Invalidation Food',
    amount: 1,
    unit: 'item',
    calories: 750,
    confidence: { calories: 'estimated' },
    ranges: { calories: { min: 600, max: 850 } }
  });

  const fp1 = generateStateFingerprint(state);

  // Update evidence range to [700, 900] (shifts midpoint to 800)
  updateCustomFood(state.customFoods[0].id, {
    ranges: { calories: { min: 700, max: 900 } }
  });

  const fp2 = generateStateFingerprint(state);
  assert.notStrictEqual(fp1, fp2, 'Fingerprint changes when evidence range changes');

  console.log('[CF-17] Range changes invalidate the solved plan: PASSED');
}

// ── TEST 18: Infeasibility Detection ──
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

  console.log('[CF-18] Infeasibility Detection: PASSED');
}

// ── TEST 19: Discarding Malformed Entries in Persistence ──
{
  assert.strictEqual(isValidCustomFoodEntry(null), false);
  assert.strictEqual(isValidCustomFoodEntry({}), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: '', amount: 1, unit: 'g' }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: -1, unit: 'g' }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: 1, unit: '' }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: 1, unit: 'g', calories: -50 }), false);
  assert.strictEqual(isValidCustomFoodEntry({ id: 'cf_1', name: 'Apple', amount: 1, unit: 'g', calories: 95, protein: null }), true);

  console.log('[CF-19] Discarding Malformed Entries: PASSED');
}

// ── TEST 20: Full End-to-End MILP Solver Optimization with Custom Foods ──
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

  console.log('[CF-20] End-to-End Solver Optimization with Custom Foods: PASSED');
}

// ── TEST 21: Snapshot Baseline Invariance (No Custom Foods) ──
{
  resetTestState();
  const outcome = solveModel(state);
  state.result = outcome.result;
  state.result.mealResults[0].items[0].isEaten = true;
  const eatenIng = state.result.mealResults[0].items[0];

  const snap = createIntakeSnapshot(state, '2026-09-02');
  assert.ok(snap, 'Snapshot created');
  assert.strictEqual(snap.items.length, 1, 'Only eaten ingredient in snapshot');
  assert.strictEqual(snap.eatenItemCount, 1);
  assert.strictEqual(snap.items[0].ingredientName, eatenIng.name);
  assert.strictEqual(snap.items[0].isCustomFood, false);
  assert.strictEqual(snap.totals.calories, snap.items[0].nutrients.calories);
  assert.strictEqual(snap.totals.protein, snap.items[0].nutrients.protein);
  assert.strictEqual(snap.totals.caloriesUnknown, false);
  assert.strictEqual(snap.totals.proteinUnknown, false);

  // When 0 items eaten and 0 custom foods: returns empty snapshot with 0 totals
  state.result.mealResults[0].items[0].isEaten = false;
  const emptySnap = createIntakeSnapshot(state, '2026-09-02');
  assert.ok(emptySnap);
  assert.strictEqual(emptySnap.eatenItemCount, 0);
  assert.strictEqual(emptySnap.totals.calories, 0);

  // When no solver result and no custom foods: returns null
  resetTestState();
  assert.strictEqual(createIntakeSnapshot(state, '2026-09-02'), null);

  console.log('[CF-21] Snapshot Baseline Invariance (No Custom Foods): PASSED');
}

// ── TEST 22: Standalone Custom Food Snapshot Without Solver Result ──
{
  resetTestState();
  state.result = null; // No solver run!

  addCustomFood({
    name: 'Avocado Toast',
    amount: 1,
    unit: 'slice',
    calories: 350,
    protein: 10,
    carbs: 35,
    fat: 20,
    meal: null
  });

  const snap = createIntakeSnapshot(state, '2026-09-02');
  assert.ok(snap, 'Snapshot succeeds without state.result when custom foods exist');
  assert.strictEqual(snap.items.length, 1);
  assert.strictEqual(snap.eatenItemCount, 1);
  assert.strictEqual(snap.items[0].ingredientName, 'Avocado Toast');
  assert.strictEqual(snap.items[0].isCustomFood, true);
  assert.strictEqual(snap.items[0].customFoodId, state.customFoods[0].id);
  assert.strictEqual(snap.items[0].mealName, 'Unassigned');
  assert.strictEqual(snap.items[0].mealId, null);
  assert.strictEqual(snap.totals.calories, 350);
  assert.strictEqual(snap.totals.protein, 10);
  assert.strictEqual(snap.totals.carbs, 35);
  assert.strictEqual(snap.totals.fat, 20);
  assert.strictEqual(snap.totals.caloriesUnknown, false);

  console.log('[CF-22] Standalone Custom Food Snapshot Without Solver Result: PASSED');
}

// ── TEST 23: Combined Solver Ingredients + Custom Foods Snapshot ──
{
  resetTestState();
  const outcome = solveModel(state);
  state.result = outcome.result;
  state.result.mealResults[0].items[0].isEaten = true;
  const eatenIng = state.result.mealResults[0].items[0];
  assert.ok(eatenIng.name, 'Eaten ingredient exists');

  // Verify canonical resolveMeal helper
  assert.strictEqual(resolveMeal('meal_lunch', state.meals)?.name, 'Lunch');
  assert.strictEqual(resolveMeal('Breakfast', state.meals)?.id, 'meal_breakfast');
  assert.strictEqual(resolveMeal(null, state.meals), null);
  assert.strictEqual(resolveMeal('unassigned', state.meals), null);

  addCustomFood({
    name: 'Protein Shake',
    amount: 1,
    unit: 'bottle',
    calories: 200,
    protein: 30,
    carbs: 10,
    fat: 4,
    meal: 'meal_lunch'
  });

  const snap = createIntakeSnapshot(state, '2026-09-02');
  assert.strictEqual(snap.items.length, 2, 'Snapshot contains both eaten ingredient and custom food');
  assert.strictEqual(snap.eatenItemCount, 2);

  const ingItem = snap.items.find(i => !i.isCustomFood);
  const cfItem = snap.items.find(i => i.isCustomFood);
  assert.ok(ingItem && cfItem, 'Both items present with correct isCustomFood discriminator');
  assert.strictEqual(cfItem.customFoodId, state.customFoods[0].id);
  assert.strictEqual(cfItem.mealName, 'Lunch');
  assert.strictEqual(cfItem.mealId, 'meal_lunch');

  // Verify combined totals
  const expectedCal = Math.round((ingItem.nutrients.calories + 200) * 100) / 100;
  const expectedPro = Math.round((ingItem.nutrients.protein + 30) * 100) / 100;
  assert.strictEqual(snap.totals.calories, expectedCal);
  assert.strictEqual(snap.totals.protein, expectedPro);

  console.log('[CF-23] Combined Solver Ingredients + Custom Foods Snapshot: PASSED');
}

// ── TEST 24: Multiple Custom Foods & Duplicate Counting Invariant ──
{
  resetTestState();
  const outcome = solveModel(state);
  state.result = outcome.result;
  state.result.mealResults[0].items[0].isEaten = true; // 1 eaten ingredient

  // Add 1 food assigned to Breakfast, 1 food assigned to Lunch, 1 unassigned
  addCustomFood({
    name: 'Greek Yogurt',
    amount: 1,
    unit: 'cup',
    calories: 130,
    protein: 15,
    carbs: 9,
    fat: 4,
    meal: 'Breakfast'
  });
  addCustomFood({
    name: 'Turkey Wrap',
    amount: 1,
    unit: 'wrap',
    calories: 450,
    protein: 28,
    carbs: 40,
    fat: 16,
    meal: 'meal_lunch'
  });
  addCustomFood({
    name: 'Apple',
    amount: 1,
    unit: 'medium',
    calories: 95,
    protein: 0.5,
    carbs: 25,
    fat: 0.3,
    meal: null
  });

  const snap = createIntakeSnapshot(state, '2026-09-02');
  // Invariant: snapshot.items.length === eatenIngredientCount + customFoodCount
  assert.strictEqual(snap.items.length, 1 + 3, 'Invariant: items.length === eatenIngredientCount + customFoodCount');
  assert.strictEqual(snap.eatenItemCount, 4);

  // Each custom food represented exactly once
  const yogurtEntries = snap.items.filter(i => i.ingredientName === 'Greek Yogurt');
  assert.strictEqual(yogurtEntries.length, 1);
  assert.strictEqual(yogurtEntries[0].mealName, 'Breakfast');
  assert.strictEqual(yogurtEntries[0].mealId, 'meal_breakfast');

  const wrapEntries = snap.items.filter(i => i.ingredientName === 'Turkey Wrap');
  assert.strictEqual(wrapEntries.length, 1);
  assert.strictEqual(wrapEntries[0].mealName, 'Lunch');
  assert.strictEqual(wrapEntries[0].mealId, 'meal_lunch');

  const appleEntries = snap.items.filter(i => i.ingredientName === 'Apple');
  assert.strictEqual(appleEntries.length, 1);
  assert.strictEqual(appleEntries[0].mealName, 'Unassigned');
  assert.strictEqual(appleEntries[0].mealId, null);

  console.log('[CF-24] Multiple Custom Foods & Duplicate Counting Invariant: PASSED');
}

// ── TEST 25: Partial and Unknown Macro Semantics ──
{
  resetTestState();
  // Case A: 1 eaten ingredient (with protein) + 1 custom food with unknown protein
  const outcome = solveModel(state);
  state.result = outcome.result;
  state.result.mealResults[0].items[0].isEaten = true;

  addCustomFood({
    name: 'Mystery Snack',
    amount: 1,
    unit: 'portion',
    calories: 300,
    protein: null, // unknown!
    carbs: 40,
    fat: 10
  });

  const snapA = createIntakeSnapshot(state, '2026-09-02');
  // Protein known subtotal preserved: ingItem.nutrients.protein
  const snapIngItem = snapA.items.find(i => !i.isCustomFood);
  assert.strictEqual(snapA.totals.protein, snapIngItem.nutrients.protein);
  assert.strictEqual(snapA.totals.proteinUnknown, true, 'proteinUnknown flag is true');
  assert.strictEqual(snapA.totals.carbsUnknown, false, 'carbsUnknown flag is false');
  const mysteryItem = snapA.items.find(i => i.ingredientName === 'Mystery Snack');
  assert.strictEqual(mysteryItem.nutrients.protein, null, 'Custom food preserves null protein in nutrients');

  // Case B: No eaten ingredients, only custom foods with completely unknown protein
  resetTestState();
  state.result = null;
  addCustomFood({
    name: 'Unknown Macro Salad',
    amount: 1,
    unit: 'bowl',
    calories: 250,
    protein: null,
    carbs: null,
    fat: 15
  });

  const snapB = createIntakeSnapshot(state, '2026-09-02');
  assert.strictEqual(snapB.totals.calories, 250);
  assert.strictEqual(snapB.totals.protein, null, 'totals.protein === null when zero values are known');
  assert.strictEqual(snapB.totals.proteinUnknown, true);
  assert.strictEqual(snapB.totals.carbs, null, 'totals.carbs === null when zero values are known');
  assert.strictEqual(snapB.totals.carbsUnknown, true);
  assert.strictEqual(snapB.totals.fat, 15);
  assert.strictEqual(snapB.totals.fatUnknown, false);

  console.log('[CF-25] Partial and Unknown Macro Semantics: PASSED');
}

// ── TEST 26: Schema Hygiene, Persistence & Longitudinal Stats Integration ──
{
  resetTestState();
  state.result = null;

  addCustomFood({
    name: 'Chipotle Bowl',
    amount: 1,
    unit: 'bowl',
    calories: 750,
    protein: null,
    carbs: 85,
    fat: 25,
    meal: 'meal_lunch'
  });

  const snap = createIntakeSnapshot(state, '2026-09-02');
  const recordRes = recordIntakeSnapshot(state.intakeHistory, snap);
  assert.ok(!recordRes.error, 'Snapshot successfully recorded in history');
  state.intakeHistory = recordRes.intakeHistory;

  // Persistence Export validation
  const exportPayload = {
    version: 1,
    ingredients: state.ingredients,
    intakeHistory: state.intakeHistory
  };
  const valErrors = ImportExport._validate(exportPayload);
  assert.strictEqual(valErrors.length, 0, `Export validation passed without errors: ${valErrors.join(', ')}`);

  // Stats: calculateAverageIntake with null observations
  const intakeHistory = {
    '2026-09-01': {
      date: '2026-09-01',
      totals: { calories: 2000, protein: 150, carbs: 250, fat: 50 }
    },
    '2026-09-02': {
      date: '2026-09-02',
      totals: { calories: 2200, protein: null, carbs: 260, fat: 60, proteinUnknown: true }
    },
    '2026-09-03': {
      date: '2026-09-03',
      totals: { calories: 2100, protein: 120, carbs: 240, fat: 55 }
    }
  };

  const avg = calculateAverageIntake(intakeHistory, 7, '2026-09-03');
  assert.strictEqual(avg.count, 3);
  assert.strictEqual(avg.calories, 2100);
  // Average of known observations for protein: (150 + 120) / 2 = 135
  assert.strictEqual(avg.protein, 135, 'Protein average ignores null observation and averages known');

  // getCombinedHistoryRows
  const rows = getCombinedHistoryRows({}, intakeHistory);
  assert.strictEqual(rows.length, 3);
  const sep2 = rows.find(r => r.date === '2026-09-02');
  assert.strictEqual(sep2.protein, null);
  assert.strictEqual(sep2.calories, 2200);

  console.log('[CF-26] Schema Hygiene, Persistence & Longitudinal Stats Integration: PASSED');
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
