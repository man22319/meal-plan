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
import { state, DEFAULT_TARGETS, DEFAULT_MEALS } from '../src/core/state.js';
import { Persistence } from '../src/io/persistence.js';

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' RUNNING UI & STATE LIFECYCLE AUDIT TEST SUITE                     ');
console.log('═══════════════════════════════════════════════════════════════════\n');

let failed = 0;
function assert(desc, condition) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
  } else {
    console.error(`[FAIL] ${desc}`);
    failed++;
  }
}

// ── TEST 1: Full Edit -> Solve -> Edit -> Solve -> Reset -> Solve Cycle ──
{
  Persistence.resetToDefaults();
  
  // Step 1: Edit targets and ingredients
  state.targets.calories = 2000;
  state.targets.protein = 150;
  state.ingredients[0].maxServings = 4;
  
  // Step 2: Solve
  const out1 = Optimization.solve({ preserveActuals: false });
  assert('Cycle Step 1: Initial solve successful', !out1.errors && out1.result !== null);
  const chkPlanned = out1.result.mealResults[0].items.find(i => i.name === 'Chicken')?.quantity;
  assert('Cycle Step 1: Chicken allocated', typeof chkPlanned === 'number' && chkPlanned > 0);

  // Step 3: Edit portion in result (simulate modal adjustment to 130g)
  const outAdjust = Optimization.recordActual('meal_breakfast', 'ing_chicken', 130, chkPlanned);
  const chkAdj = outAdjust.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Cycle Step 2: Portion adjusted to 130g and marked actual', chkAdj?.isActual === true && Math.abs(chkAdj.actualQuantity - 130) < 0.01);

  // Step 4: Edit inputs (e.g. increase targets) and perform fresh Solve
  state.targets.calories = 2600;
  const out2 = Optimization.solve({ preserveActuals: false });
  const chkFresh = out2.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Cycle Step 3: Fresh solve does not carry over temporary 130g actual', chkFresh?.isActual === false && chkFresh?.actualQuantity === null);
  assert('Cycle Step 3: State actuals cleared on fresh solve', Object.keys(state.actuals).length === 0);

  // Step 5: Reset to defaults
  Persistence.resetToDefaults();
  assert('Cycle Step 4: Reset restores default targets', state.targets.calories === DEFAULT_TARGETS.calories);
  assert('Cycle Step 4: Reset restores default meals count', state.meals.length === DEFAULT_MEALS.length);
  assert('Cycle Step 4: Reset clears results', state.result === null);

  // Step 6: Solve after reset
  const out3 = Optimization.solve({ preserveActuals: false });
  assert('Cycle Step 5: Post-reset solve succeeds with default targets', !out3.errors && Math.abs(out3.result.totals.calories - DEFAULT_TARGETS.calories) < 5);
}

// ── TEST 2: Actual == Expected Quantity Auto-Clears Actual Lock ──
{
  Persistence.resetToDefaults();
  const initial = Optimization.solve({ preserveActuals: false });
  const plannedChicken = initial.result.mealResults[0].items.find(i => i.name === 'Chicken').quantity;

  // Case A: Adjust to different value -> locks actual
  Optimization.recordActual('meal_breakfast', 'ing_chicken', plannedChicken + 25, plannedChicken);
  const itemLocked = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Actual != Planned: isActual is true', itemLocked?.isActual === true && itemLocked?.actualQuantity === plannedChicken + 25);

  // Case B: Adjust back to exactly the planned quantity -> automatically clears actual lock
  Optimization.recordActual('meal_breakfast', 'ing_chicken', plannedChicken, plannedChicken);
  const itemCleared = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Actual == Planned: isActual reverted to false', itemCleared?.isActual === false && itemCleared?.actualQuantity === null);
  assert('Actual == Planned: actuals key removed', !state.actuals['meal_breakfast_ing_chicken']);
}

// ── TEST 3: Entity Deletion Cleans Up Orphaned State ──
{
  Persistence.resetToDefaults();
  Optimization.solve({ preserveActuals: false });
  Optimization.recordActual('meal_breakfast', 'ing_chicken', 115);
  Optimization.markIngredientEaten('meal_breakfast', 'ing_chicken');

  assert('Pre-deletion: Chicken eaten and actual present', !!state.eatenItems['meal_breakfast_ing_chicken'] && !!state.actuals['meal_breakfast_ing_chicken']);

  // Simulate ingredient deletion logic
  const removed = state.ingredients.splice(0, 1)[0]; // Remove Chicken
  const matchKey = (key) =>
    (removed.id && key.endsWith(`_${removed.id}`)) ||
    (removed.name && key.endsWith(`_${removed.name}`));

  Object.keys(state.eatenItems).forEach(k => { if (matchKey(k)) delete state.eatenItems[k]; });
  Object.keys(state.actuals).forEach(k => { if (matchKey(k)) delete state.actuals[k]; });

  assert('Post-deletion: Chicken eaten item cleaned up', !state.eatenItems['meal_breakfast_ing_chicken']);
  assert('Post-deletion: Chicken actual cleaned up', !state.actuals['meal_breakfast_ing_chicken']);
}

console.log(`\nLifecycle Audit Completed: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
if (failed > 0) process.exit(1);
