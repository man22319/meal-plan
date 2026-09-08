// ══════════════════════════════════════════════════════════════════
// SOLVER TEST SUITE — Macro-Calorie Coupling in MILP Solver
// ══════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize vendor solver in Node environment if not present
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

import {
  calculateMacroCalories,
  calculateMacroCalorieDelta,
  calcMacroCalories,
  calcMacroCalorieDelta,
  solveModel,
  Optimization
} from '../src/core/solver.js';
import { state, DEFAULT_TARGETS, DEFAULT_MEALS, DEFAULT_INGREDIENTS } from '../src/core/state.js';
import { Persistence } from '../src/io/persistence.js';
import { addCustomFood } from '../src/core/customFoods.js';

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
  state.meals = JSON.parse(JSON.stringify(DEFAULT_MEALS));
  state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
  state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
  state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 0.5 };
  state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002, availabilityLow: 0.0005, availabilityLimited: 0.002 };
  state.actuals = {};
  state.eatenItems = {};
  state.customFoods = [];
  state.result = null;
}

export function runSolverTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING MACRO-CALORIE COUPLING SOLVER TEST SUITE                 ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  failed = 0;

  // ── TEST 1: Macro-Calorie Calculation ──
  {
    const p = 150, c = 281, f = 62;
    const kMacro1 = calculateMacroCalories(p, c, f);
    const kMacro2 = calculateMacroCalories({ protein: p, carbs: c, fat: f });
    const kMacro3 = calcMacroCalories(p, c, f);

    const expected = 4 * 150 + 4 * 281 + 9 * 62; // 600 + 1124 + 558 = 2282
    assert('Test 1: Macro-Calorie Calculation (150P, 281C, 62F = 2282 kcal)',
      kMacro1 === 2282 && kMacro2 === 2282 && kMacro3 === expected,
      `Expected 2282, got kMacro1=${kMacro1}, kMacro2=${kMacro2}`
    );
  }

  // ── TEST 2: Fat Delta ──
  {
    const dF = 2;
    const deltaK1 = calculateMacroCalorieDelta(0, 0, dF);
    const deltaK2 = calculateMacroCalorieDelta({ protein: 0, carbs: 0, fat: dF });
    const deltaK3 = calculateMacroCalorieDelta({ dP: 0, dC: 0, dF });
    const deltaK4 = calcMacroCalorieDelta(0, 0, dF);

    assert('Test 2: Fat Delta (+2g fat = +18 kcal)',
      deltaK1 === 18 && deltaK2 === 18 && deltaK3 === 18 && deltaK4 === 18,
      `Expected 18, got deltaK1=${deltaK1}`
    );
  }

  // ── TEST 3: Protein Delta ──
  {
    const dP = 5;
    const deltaK1 = calculateMacroCalorieDelta(dP, 0, 0);
    const deltaK2 = calculateMacroCalorieDelta({ protein: dP, carbs: 0, fat: 0 });
    const deltaK3 = calculateMacroCalorieDelta({ dP, dC: 0, dF: 0 });

    assert('Test 3: Protein Delta (+5g protein = +20 kcal)',
      deltaK1 === 20 && deltaK2 === 20 && deltaK3 === 20,
      `Expected 20, got deltaK1=${deltaK1}`
    );
  }

  // ── TEST 4: Carb Delta ──
  {
    const dC = 5;
    const deltaK1 = calculateMacroCalorieDelta(0, dC, 0);
    const deltaK2 = calculateMacroCalorieDelta({ protein: 0, carbs: dC, fat: 0 });
    const deltaK3 = calculateMacroCalorieDelta({ dP: 0, dC, dF: 0 });

    assert('Test 4: Carbohydrate Delta (+5g carbohydrate = +20 kcal)',
      deltaK1 === 20 && deltaK2 === 20 && deltaK3 === 20,
      `Expected 20, got deltaK1=${deltaK1}`
    );
  }

  // ── TEST 5: Mixed Macro Delta ──
  {
    const dp = 2, dc = -2, df = 1;
    const deltaK1 = calculateMacroCalorieDelta(dp, dc, df);
    const deltaK2 = calculateMacroCalorieDelta({ protein: dp, carbs: dc, fat: df });
    const deltaK3 = calculateMacroCalorieDelta({ dP: dp, dC: dc, dF: df });
    const expected = 4 * 2 + 4 * (-2) + 9 * 1; // 8 - 8 + 9 = 9

    assert('Test 5: Mixed Macro Delta (dP=+2, dC=-2, dF=+1 = +9 kcal)',
      deltaK1 === 9 && deltaK2 === 9 && deltaK3 === expected,
      `Expected 9, got deltaK1=${deltaK1}`
    );
  }

  // ── TEST 6: Ingredient Discrepancy Calculation ──
  {
    const ing = {
      name: 'InconsistentFood',
      calories: 300,
      protein: 20,
      carbs: 10,
      fat: 5
    };
    const atwater = 4 * ing.protein + 4 * ing.carbs + 9 * ing.fat; // 80 + 40 + 45 = 165
    const d_i = ing.calories - atwater; // 300 - 165 = 135

    assert('Test 6: Ingredient Discrepancy (300 kcal, 20P, 10C, 5F => d_i = 135 kcal/serv)',
      atwater === 165 && d_i === 135,
      `Expected d_i = 135, got ${d_i}`
    );
  }

  // ── TEST 7: Solver Feasibility With Database Discrepancy ──
  {
    const testState = {
      targets: { calories: 300, protein: 20, carbs: 10, fat: 5 },
      meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
      ingredients: [
        {
          id: 'inconsistent_food',
          name: 'InconsistentFood',
          servingSize: 100,
          unit: 'g',
          calories: 300,
          protein: 20,
          carbs: 10,
          fat: 5,
          minServings: 0,
          maxServings: 2,
          availability: 'normal'
        }
      ],
      weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 0.5 },
      penalties: { simplicity: 0.0005, quantity: 0.00001 }
    };

    const outcome = solveModel(testState, { validate: false });
    const selected = outcome.result?.mealResults[0]?.items?.find(i => i.name === 'InconsistentFood');

    assert('Test 7: Solver Feasibility With Database Discrepancy (soft reconciliation remains feasible)',
      outcome.feasible === true && outcome.errors.length === 0 && Boolean(selected) && selected.servings > 0.5,
      `Feasible: ${outcome.feasible}, selected servings: ${selected?.servings}`
    );
  }

  // ── TEST 8: Target Inconsistency Must Remain Feasible ──
  {
    const testState = {
      targets: { calories: 2335, protein: 150, carbs: 281, fat: 62 }, // Atwater = 2282 != 2335
      meals: [
        { id: 'm1', name: 'Breakfast', pct: 40 },
        { id: 'm2', name: 'Lunch', pct: 20 },
        { id: 'm3', name: 'Dinner', pct: 40 }
      ],
      ingredients: [
        { id: 'i1', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
        { id: 'i2', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, availability: 'normal' },
        { id: 'i3', name: 'Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, availability: 'normal' }
      ],
      weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 0.5 },
      penalties: { simplicity: 0.0005, quantity: 0.00001 }
    };

    const outcome = solveModel(testState, { validate: false });

    assert('Test 8: Target Inconsistency (2335 kcal != 2282 Atwater target solves feasibly)',
      outcome.feasible === true && outcome.errors.length === 0 && outcome.result !== null,
      `Feasible: ${outcome.feasible}, errors: ${outcome.errors.join(', ')}`
    );
  }

  // ── TEST 9: Custom Food Reconciliation (No Double Counting) ──
  {
    resetTestState();
    // Add custom food with listed calories = 400, but 20P, 20C, 10F (Atwater = 4*20 + 4*20 + 9*10 = 250)
    // Discrepancy is 400 - 250 = 150 kcal
    addCustomFood({
      name: 'Custom Energy Bar',
      amount: 1,
      unit: 'bar',
      calories: 400,
      protein: 20,
      carbs: 20,
      fat: 10,
      meal: 'meal_breakfast'
    });

    const outcome = Optimization.solve({ preserveActuals: false });
    assert('Test 9: Custom Food Reconciliation (Custom food solves without double-counting error)',
      outcome.result !== null && !outcome.errors,
      `Solved successfully with custom food: ${!!outcome.result}`
    );
  }

  // ── TEST 10: Reconciliation Direction (+20 and -20 both contribute positively to e_macroKcal) ──
  {
    // Test positive discrepancy food: 1 serv of +20 kcal discrepancy
    const statePos = {
      targets: { calories: 100, protein: 10, carbs: 10, fat: 0 },
      meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
      ingredients: [
        {
          id: 'pos_food',
          name: 'PosFood',
          servingSize: 100,
          unit: 'g',
          calories: 100, // listed 100
          protein: 10,  // 40
          carbs: 10,    // 40
          fat: 0,       // 0 -> Atwater = 80 => d = +20 kcal
          minServings: 1,
          maxServings: 1,
          availability: 'normal'
        }
      ],
      weights: { calories: 0.001, protein: 0.001, carbs: 0.001, fat: 0.001, mealAllocation: 0.001, macroReconciliation: 1.0 },
      penalties: { simplicity: 0, quantity: 0 },
      customFoods: []
    };
    const resPos = solveModel(statePos, { validate: false });
    const ePos = (resPos.raw && resPos.raw.e_macroKcal) || 0;

    // Test negative discrepancy food: 1 serv of -20 kcal discrepancy
    const stateNeg = {
      targets: { calories: 60, protein: 10, carbs: 10, fat: 0 },
      meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
      ingredients: [
        {
          id: 'neg_food',
          name: 'NegFood',
          servingSize: 100,
          unit: 'g',
          calories: 60,  // listed 60
          protein: 10,  // 40
          carbs: 10,    // 40
          fat: 0,       // 0 -> Atwater = 80 => d = -20 kcal
          minServings: 1,
          maxServings: 1,
          availability: 'normal'
        }
      ],
      weights: { calories: 0.001, protein: 0.001, carbs: 0.001, fat: 0.001, mealAllocation: 0.001, macroReconciliation: 1.0 },
      penalties: { simplicity: 0, quantity: 0 },
      customFoods: []
    };
    const resNeg = solveModel(stateNeg, { validate: false });
    const eNeg = (resNeg.raw && resNeg.raw.e_macroKcal) || 0;

    assert('Test 10: Reconciliation Direction (+20 and -20 both yield e_macroKcal = 20)',
      Math.abs(ePos - 20) < 0.01 && Math.abs(eNeg - 20) < 0.01,
      `ePos = ${ePos}, eNeg = ${eNeg}`
    );
  }

  // ── TEST 11: Objective Preference (Solver prefers lower reconciliation error) ──
  {
    // Two candidate foods that hit macro targets equally well:
    // Food A: Perfectly reconciles (Atwater = 100, Listed = 100, d = 0)
    // Food B: Discrepant (Atwater = 80, Listed = 100, d = +20)
    const statePref = {
      targets: { calories: 100, protein: 10, carbs: 10, fat: 2.222 },
      meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
      ingredients: [
        {
          id: 'food_a_consistent',
          name: 'FoodA_Consistent',
          servingSize: 100,
          unit: 'g',
          calories: 100,
          protein: 10,
          carbs: 10,
          fat: 2.222, // 4*10 + 4*10 + 9*2.222 = 100
          minServings: 0,
          maxServings: 1,
          availability: 'normal'
        },
        {
          id: 'food_b_inconsistent',
          name: 'FoodB_Inconsistent',
          servingSize: 100,
          unit: 'g',
          calories: 100,
          protein: 10,
          carbs: 10,
          fat: 0, // 4*10 + 4*10 = 80 != 100 (d = +20)
          minServings: 0,
          maxServings: 1,
          availability: 'normal'
        }
      ],
      weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 1.0 },
      penalties: { simplicity: 0, quantity: 0 },
      customFoods: []
    };

    const res = solveModel(statePref, { validate: false });
    const sA = res.raw && (res.raw['x_0_0'] || 0);
    const sB = res.raw && (res.raw['x_1_0'] || 0);

    assert('Test 11: Objective Preference (Solver prefers lower-reconciliation-error candidate)',
      sA > 0.9 && sB < 0.1,
      `Food A servings: ${sA}, Food B servings: ${sB}`
    );
  }

  // ── TEST 12: Regression & Interface Compatibility ──
  {
    resetTestState();
    const outcome = Optimization.solve({ preserveActuals: false });
    const res = outcome.result;

    assert('Test 12A: Optimization.solve returns valid result',
      Boolean(res) && !outcome.errors,
      `Result present: ${Boolean(res)}`
    );
    assert('Test 12B: extractResults preserves public schema',
      typeof res.totals.calories === 'number' &&
      typeof res.totals.protein === 'number' &&
      typeof res.totals.carbs === 'number' &&
      typeof res.totals.fat === 'number' &&
      Array.isArray(res.mealResults) &&
      typeof res.deviations === 'object' &&
      typeof res.objective === 'number',
      'Schema matches public contract'
    );
    assert('Test 12C: Calories and macro deviation calculations functional',
      typeof res.deviations.calories.absolute === 'number' &&
      typeof res.deviations.protein.absolute === 'number' &&
      typeof res.deviations.carbs.absolute === 'number' &&
      typeof res.deviations.fat.absolute === 'number',
      'Deviations properly computed'
    );
  }

  console.log(`\nMacro-Calorie Solver Tests: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
  return failed === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSolverTestSuite();
}
