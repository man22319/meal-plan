// ══════════════════════════════════════════
// CROSS-BOUNDARY HISTORY IMMUTABILITY TEST
// ══════════════════════════════════════════

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

import { state } from '../src/core/state.js';
import { Optimization } from '../src/core/solver.js';
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

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' RUNNING CROSS-BOUNDARY INTAKE IMMUTABILITY TEST SUITE             ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ── TEST 1: Core Cross-Boundary Immutability Invariant ──
{
  Persistence.resetToDefaults();

  // 1. Initial solve
  const solveOutcome = Optimization.solve({ preserveActuals: false });
  assert('Step 1: Initial solve successful', Boolean(solveOutcome.result));

  // 2. Adjust portion: Chicken in Breakfast to 130g and mark eaten
  Optimization.recordActual('meal_breakfast', 'ing_chicken', 130, 100);
  Optimization.markIngredientEaten('meal_breakfast', 'ing_chicken');

  // Verify state before snapshot
  const initialBreakfastChicken = state.result.mealResults[0].items.find(i => i.name === 'Chicken');
  assert('Step 2: Chicken actual portion recorded as 130g', initialBreakfastChicken?.quantity === 130);

  // 3. Create intake snapshot for 2026-08-25
  const snapshotDate = '2026-08-25';
  const snapshot1 = createIntakeSnapshot(state, snapshotDate, '2026-08-25T12:00:00Z');
  assert('Step 3: Snapshot created with items', snapshot1 && snapshot1.items.length > 0);

  const snapChicken = snapshot1.items.find(i => i.mealName === 'Breakfast' && i.ingredientName === 'Chicken');
  assert('Step 3: Snapshot contains Breakfast Chicken at 130g', snapChicken?.quantity === 130);

  const originalCalories = snapChicken.nutrients.calories;
  const originalProtein = snapChicken.nutrients.protein;
  const originalTotalKcal = snapshot1.totals.calories;
  const originalTotalProtein = snapshot1.totals.protein;

  const res = recordIntakeSnapshot(state.intakeHistory, snapshot1);
  state.intakeHistory = res.intakeHistory;
  Persistence.save();

  // 4. Mutate ingredient definition (e.g. increase protein and calories drastically)
  const chickenIng = state.ingredients.find(i => i.name === 'Chicken');
  chickenIng.calories = 300; // was 165
  chickenIng.protein = 50;   // was 31

  // 5. Change solver target and re-solve with different meal splits
  state.targets.calories = 3000;
  state.targets.protein = 200;
  Optimization.clearAllActuals();
  state.eatenItems = {};
  Optimization.solve({ preserveActuals: false });

  // 6. Reload from storage
  Persistence.load();

  // 7. Assert that historical intake record remains completely unchanged
  const historicalRecord = state.intakeHistory[snapshotDate];
  assert('Step 7: Historical record exists for 2026-08-25', Boolean(historicalRecord));

  const histChicken = historicalRecord.items.find(i => i.mealName === 'Breakfast' && i.ingredientName === 'Chicken');
  assert('Step 7: Historical Chicken portion remains strictly 130g', histChicken?.quantity === 130);
  assert('Step 7: Historical Chicken calories unaffected by later ingredient edits', histChicken?.nutrients.calories === originalCalories, `Expected ${originalCalories}, got ${histChicken?.nutrients.calories}`);
  assert('Step 7: Historical Chicken protein unaffected by later ingredient edits', histChicken?.nutrients.protein === originalProtein, `Expected ${originalProtein}, got ${histChicken?.nutrients.protein}`);
  assert('Step 7: Historical total calories completely immutable', historicalRecord.totals.calories === originalTotalKcal, `Expected ${originalTotalKcal}, got ${historicalRecord.totals.calories}`);
  assert('Step 7: Historical total protein completely immutable', historicalRecord.totals.protein === originalTotalProtein, `Expected ${originalTotalProtein}, got ${historicalRecord.totals.protein}`);
}

// ── TEST 2: Updating Today's Snapshot Replaces Record ──
{
  const today = '2026-08-26';
  // Create first snapshot of today
  const snapA = createIntakeSnapshot(state, today, '2026-08-26T12:00:00Z');
  state.intakeHistory = recordIntakeSnapshot(state.intakeHistory, snapA).intakeHistory;
  const countBefore = Object.keys(state.intakeHistory).length;

  // Later in the day, user consumes more and updates snapshot
  const snapB = createIntakeSnapshot(state, today, '2026-08-26T20:00:00Z');
  state.intakeHistory = recordIntakeSnapshot(state.intakeHistory, snapB).intakeHistory;
  const countAfter = Object.keys(state.intakeHistory).length;

  assert('Updating today snapshot does not create duplicate dates', countBefore === countAfter);
  assert('Today snapshot record was updated with new timestamp', state.intakeHistory[today].recordedAt === '2026-08-26T20:00:00Z');
}

console.log(`\nImmutability Tests Completed: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
if (failed > 0) process.exit(1);
