// ══════════════════════════════════════════
// UNEATEN ALL UNIT TESTS — Bulk Eaten State Clearing
// ══════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize solver in Node environment if not already loaded
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

import { Optimization } from '../src/core/solver.js';
import { state, DEFAULT_TARGETS } from '../src/core/state.js';
import { Persistence } from '../src/io/persistence.js';
import { createIntakeSnapshot, recordIntakeSnapshot } from '../src/core/history.js';

let failed = 0;
function assert(name, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name} ${details ? `— ${details}` : ''}`);
    failed++;
  }
}

function resetTestState() {
  global.localStorage.clear();
  Persistence.resetToDefaults();
  state.targets = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
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
  state.actuals = {};
  state.eatenItems = {};
  state.intakeHistory = {};
  state.result = null;
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' RUNNING UNEATEN ALL TEST SUITE                                    ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ── TEST 1: Basic Clearing (No items, One item, Multiple items across meals) ──
{
  resetTestState();
  Optimization.solve({ preserveActuals: false });

  // Case 1A: No eaten items -> unmarkAll leaves state clean
  Optimization.unmarkAllIngredientsEaten();
  assert('Test 1A: No eaten items leaves eatenItems empty', Object.keys(state.eatenItems).length === 0);

  // Case 1B: One eaten item
  Optimization.markIngredientEaten('meal_0', 'ing_chk');
  assert('Test 1B: Item marked eaten', state.result.mealResults[0].items.find(i => i.name === 'Chicken')?.isEaten === true);
  Optimization.unmarkAllIngredientsEaten();
  const chkAfter = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Test 1B: Single eaten item cleared by unmarkAll',
    Object.keys(state.eatenItems).length === 0 && chkAfter?.isEaten === false);

  // Case 1C: Multiple items across multiple meals
  Optimization.markIngredientEaten('meal_0', 'ing_chk');
  Optimization.markIngredientEaten('meal_0', 'ing_yuc');
  Optimization.markIngredientEaten('meal_1', 'ing_chk');
  Optimization.markIngredientEaten('meal_2', 'ing_chk');
  assert('Test 1C: 4 items marked eaten across 3 meals', Object.keys(state.eatenItems).length === 4);

  Optimization.unmarkAllIngredientsEaten();
  const allItems = state.result.mealResults.flatMap(m => m.items);
  const anyEaten = allItems.some(i => i.isEaten);
  assert('Test 1C: All eaten markers cleared across all meals',
    Object.keys(state.eatenItems).length === 0 && !anyEaten);
}

// ── TEST 2: Actual Quantity Preservation (planned ≠ actual) ──
{
  resetTestState();
  Optimization.solve({ preserveActuals: false });

  // Record actual portion: planned = 100g (or whatever solved), actual = 130g
  Optimization.recordActual('meal_0', 'ing_chk', 130, 100);
  const bChkBefore = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Test 2: Actual portion set (130g)', bChkBefore?.actualQuantity === 130 && bChkBefore?.isActual === true);

  // Mark as eaten
  Optimization.markIngredientEaten('meal_0', 'ing_chk');
  const bChkEaten = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Test 2: Marked eaten while having actual quantity', bChkEaten?.isEaten === true && bChkEaten?.isActual === true);

  // Perform UNEATEN ALL
  Optimization.unmarkAllIngredientsEaten();
  const bChkAfter = state.result.mealResults[0].items.find(i => i.name === 'Chicken');

  assert('Test 2: UNEATEN ALL cleared isEaten', bChkAfter?.isEaten === false);
  assert('Test 2: UNEATEN ALL preserved isActual=true', bChkAfter?.isActual === true);
  assert('Test 2: UNEATEN ALL preserved actualQuantity (130g)', bChkAfter?.actualQuantity === 130);
  assert('Test 2: UNEATEN ALL preserved display quantity (130g)', bChkAfter?.quantity === 130);
  assert('Test 2: UNEATEN ALL preserved plannedQuantity', typeof bChkAfter?.plannedQuantity === 'number');
  assert('Test 2: UNEATEN ALL preserved state.actuals record', state.actuals['meal_0_ing_chk']?.actualQuantity === 130);
}

// ── TEST 3: Planned/Actual Equality Preservation ──
{
  resetTestState();
  Optimization.solve({ preserveActuals: false });

  // Mock item where planned = 200g, actual = 200g, eaten = true
  const meal0 = state.result.mealResults[0];
  const targetItem = meal0.items.find(i => i.name === 'Chicken');
  targetItem.plannedQuantity = 200;
  targetItem.actualQuantity = 200;
  targetItem.quantity = 200;
  targetItem.isActual = true;
  targetItem.isEaten = true;
  state.actuals['meal_0_ing_chk'] = { actualQuantity: 200, plannedQuantityAtRecord: 200 };
  state.eatenItems['meal_0_ing_chk'] = { quantity: 200, servings: 2.0, plannedQuantity: 200, actualQuantity: 200 };

  Optimization.unmarkAllIngredientsEaten();

  const itemAfter = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Test 3: isEaten cleared when planned == actual', itemAfter?.isEaten === false);
  assert('Test 3: isActual preserved when planned == actual', itemAfter?.isActual === true);
  assert('Test 3: actualQuantity preserved (200g)', itemAfter?.actualQuantity === 200);
  assert('Test 3: plannedQuantity preserved (200g)', itemAfter?.plannedQuantity === 200);
}

// ── TEST 4: Mixed Quantities Result Integrity ──
{
  resetTestState();
  Optimization.solve({ preserveActuals: false });

  // Item A: planned = 100g, actual = 130g, eaten = true
  Optimization.recordActual('meal_0', 'ing_chk', 130, 100);
  Optimization.markIngredientEaten('meal_0', 'ing_chk');

  // Item B: normal planned, eaten = true (no actual override)
  Optimization.markIngredientEaten('meal_0', 'ing_yuc');

  // Item C: normal planned, uneaten
  // meal_1 Chicken is uneaten

  Optimization.unmarkAllIngredientsEaten();

  const chk = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  const yuc = state.result.mealResults[0].items.find(i => i.name === 'Yuca');
  const lChk = state.result.mealResults[1].items.find(i => i.name === 'Chicken');

  assert('Test 4: Item A (actual override) is uneaten with actualQuantity intact',
    chk?.isEaten === false && chk?.isActual === true && chk?.actualQuantity === 130);
  assert('Test 4: Item B (normal) is uneaten with isActual=false',
    yuc?.isEaten === false && yuc?.isActual === false && yuc?.actualQuantity === null);
  assert('Test 4: Item C (was uneaten) remains uneaten',
    lChk ? lChk.isEaten === false : true);
}

// ── TEST 5: Persistence Across Reloads ──
{
  resetTestState();
  Optimization.solve({ preserveActuals: false });

  Optimization.recordActual('meal_0', 'ing_chk', 145, 100);
  Optimization.markIngredientEaten('meal_0', 'ing_chk');
  Optimization.markIngredientEaten('meal_0', 'ing_yuc');

  Optimization.unmarkAllIngredientsEaten();
  Persistence.save();

  // Clear in-memory state and reload
  state.eatenItems = { 'fake': { quantity: 10 } };
  state.actuals = {};
  state.result = null;

  Persistence.load();

  const loadedChk = state.result?.mealResults[0].items.find(i => i.name === 'Chicken');
  const loadedYuc = state.result?.mealResults[0].items.find(i => i.name === 'Yuca');

  assert('Test 5: Persisted eatenItems is empty', Object.keys(state.eatenItems).length === 0);
  assert('Test 5: Persisted actuals contains Chicken override (145g)', state.actuals['meal_0_ing_chk']?.actualQuantity === 145);
  assert('Test 5: Loaded Chicken is uneaten and isActual with 145g',
    loadedChk?.isEaten === false && loadedChk?.isActual === true && loadedChk?.actualQuantity === 145);
  assert('Test 5: Loaded Yuca is uneaten and isActual=false',
    loadedYuc?.isEaten === false && loadedYuc?.isActual === false);
}

// ── TEST 6: Historical Intake Snapshot Independence ──
{
  resetTestState();
  Optimization.solve({ preserveActuals: false });
  Optimization.markIngredientEaten('meal_0', 'ing_chk');

  const snapshot = createIntakeSnapshot(state, '2026-08-25');
  const res = recordIntakeSnapshot(state.intakeHistory, snapshot);
  state.intakeHistory = res.intakeHistory;
  const snapCaloriesBefore = state.intakeHistory['2026-08-25']?.totals?.calories;

  // Run UNEATEN ALL
  Optimization.unmarkAllIngredientsEaten();

  const snapCaloriesAfter = state.intakeHistory['2026-08-25']?.totals?.calories;
  assert('Test 6: Intake history snapshot exists and is untouched by UNEATEN ALL',
    snapCaloriesBefore !== undefined && snapCaloriesBefore === snapCaloriesAfter);
}

console.log('\n═══════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(' ALL UNEATEN ALL TESTS PASSED (0 failures)                        ');
} else {
  console.error(` UNEATEN ALL TESTS FAILED (${failed} failures)                    `);
  process.exitCode = 1;
}
console.log('═══════════════════════════════════════════════════════════════════\n');

export function runUneatenAllTestSuite() {
  return failed === 0;
}
