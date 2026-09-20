// ══════════════════════════════════════════════════════════════════
// TEST SUITE: LOG MEASURED FOODS BY INGREDIENT ID
// ══════════════════════════════════════════════════════════════════

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize vendor solver in Node environment if not already present
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
  state,
  CROCKFORD_BASE32_ALPHABET,
  generateIngredientId,
  ensureIngredientId,
  findIngredientById,
  isCrockfordBase32Id,
  DEFAULT_TARGETS,
  DEFAULT_MEALS,
  DEFAULT_INGREDIENTS
} from '../src/core/state.js';
import {
  createCustomFoodFromIngredient,
  recordPartialConsumption,
  getRemainingTargets
} from '../src/core/customFoods.js';
import {
  aggregateIngredients,
  calculateConsumption
} from '../src/core/consumption.js';
import { Optimization } from '../src/core/solver.js';
import { UI } from '../src/ui/render.js';

export function runMeasuredFoodsTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING MEASURED FOODS BY INGREDIENT ID TEST SUITE                ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  function resetTestState() {
    global.localStorage.clear();
    state.targets = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
    state.meals = JSON.parse(JSON.stringify(DEFAULT_MEALS));
    state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
    state.customFoods = [];
    state.actuals = {};
    state.eatenItems = {};
    state.ateSoFar = {};
    state.result = null;
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 0.5 };
    state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002, availabilityLow: 0.0005, availabilityLimited: 0.002 };
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
  }

  function approxEqual(a, b, epsilon = 0.001) {
    return Math.abs(a - b) <= epsilon;
  }

  // ─────────────────────────────────────────────────────────────
  // 1. INGREDIENT ID & CROCKFORD BASE32 GENERATION TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();

    // 1.1 Crockford alphabet verification: exactly 32 chars, excludes I, L, O, U
    assert.strictEqual(CROCKFORD_BASE32_ALPHABET.length, 32, 'Crockford Base32 alphabet must have length 32');
    assert.strictEqual(CROCKFORD_BASE32_ALPHABET.includes('I'), false, 'Crockford alphabet must not include I');
    assert.strictEqual(CROCKFORD_BASE32_ALPHABET.includes('L'), false, 'Crockford alphabet must not include L');
    assert.strictEqual(CROCKFORD_BASE32_ALPHABET.includes('O'), false, 'Crockford alphabet must not include O');
    assert.strictEqual(CROCKFORD_BASE32_ALPHABET.includes('U'), false, 'Crockford alphabet must not include U');

    // 1.2 Generated ID is 4 uppercase characters
    for (let i = 0; i < 50; i++) {
      const id = generateIngredientId();
      assert.strictEqual(id.length, 4, 'Generated ID must be exactly 4 characters');
      assert.strictEqual(id, id.toUpperCase(), 'Generated ID must be uppercase');
      for (const char of id) {
        assert.ok(CROCKFORD_BASE32_ALPHABET.includes(char), `Character "${char}" must belong to Crockford Base32 alphabet`);
      }
    }

    // 1.3 Rejection sampling collision reroll
    const mockExisting = [
      { id: 'AAAA' },
      { id: 'BBBB' },
      { id: 'CCCC' }
    ];
    const freshId = generateIngredientId(mockExisting);
    assert.ok(!['AAAA', 'BBBB', 'CCCC'].includes(freshId), 'Generated ID must not collide with existing IDs');

    // 1.4 ensureIngredientId preserves existing ID and generates once if missing
    const ingWithId = { id: '7F9K', name: 'Existing' };
    assert.strictEqual(ensureIngredientId(ingWithId), '7F9K', 'Existing valid ID must be preserved');

    const ingWithoutId = { name: 'New Item' };
    const assignedId = ensureIngredientId(ingWithoutId);
    assert.strictEqual(assignedId.length, 4, 'Assigned ID must be 4 characters');
    assert.strictEqual(ingWithoutId.id, assignedId, 'Assigned ID must be stored on ingredient object');
    // Calling again does not regenerate
    assert.strictEqual(ensureIngredientId(ingWithoutId), assignedId, 'Subsequent call must return same ID');

    // 1.5 Legacy/fixture IDs preserved internally, while auto-generated legacy IDs migrated
    const legacyIng = { id: 'ing_chicken', name: 'Chicken' };
    assert.strictEqual(ensureIngredientId(legacyIng), 'ing_chicken', 'Legacy fixture ID must be preserved');

    const legacyGeneratedIng = { id: 'ing_0_ywu7fx_mtkvm4og', name: 'Tyson Chicken Breast' };
    const migratedId = ensureIngredientId(legacyGeneratedIng);
    assert.strictEqual(migratedId.length, 4, 'Legacy auto-generated ID must be migrated to 4-character Base32');
    assert.ok(isCrockfordBase32Id(migratedId), 'Migrated ID must be valid Crockford Base32');
    assert.strictEqual(legacyGeneratedIng.legacyId, 'ing_0_ywu7fx_mtkvm4og', 'Original legacy ID preserved in legacyId');
    assert.strictEqual(findIngredientById('ing_0_ywu7fx_mtkvm4og', [legacyGeneratedIng])?.name, 'Tyson Chicken Breast');
    assert.strictEqual(findIngredientById(migratedId, [legacyGeneratedIng])?.name, 'Tyson Chicken Breast');

    // 1.6 Case-insensitive exact lookup
    state.ingredients.push({ id: '7F9K', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 });
    assert.strictEqual(findIngredientById('7F9K', state.ingredients)?.name, 'Texas Toast');
    assert.strictEqual(findIngredientById('7f9k', state.ingredients)?.name, 'Texas Toast');
    assert.strictEqual(findIngredientById('  7F9k  ', state.ingredients)?.name, 'Texas Toast');
    assert.strictEqual(findIngredientById('NONEXISTENT', state.ingredients), null);

    console.log('[PASS] Ingredient ID & Crockford Base32 Generation Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 2. LOOKUP TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: '1234', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 }
    ];

    // Valid ID resolves (case-insensitive)
    const res1 = createCustomFoodFromIngredient('1234', 34, 'g');
    assert.ok(res1.entry, 'Valid ID must resolve');
    assert.strictEqual(res1.entry.name, 'Texas Toast');

    // Invalid ID fails with exact error message
    const resInvalid = createCustomFoodFromIngredient('9999', 34, 'g');
    assert.ok(resInvalid.errors?.length > 0, 'Invalid ID must return errors');
    assert.strictEqual(resInvalid.errors[0], 'That ingredient ID does not exist. Check the ID shown on the ingredient card and try again.');
    assert.strictEqual(resInvalid.entry, undefined);

    // Empty ID fails with exact error message
    const resEmpty = createCustomFoodFromIngredient('', 34, 'g');
    assert.ok(resEmpty.errors?.length > 0, 'Empty ID must return errors');
    assert.strictEqual(resEmpty.errors[0], 'You need to enter an ingredient ID.');

    const resNull = createCustomFoodFromIngredient(null, 34, 'g');
    assert.strictEqual(resNull.errors[0], 'You need to enter an ingredient ID.');

    // No fuzzy or name matching
    const resName = createCustomFoodFromIngredient('Texas Toast', 34, 'g');
    assert.ok(resName.errors?.length > 0, 'Name matching must NOT occur');
    assert.strictEqual(resName.errors[0], 'That ingredient ID does not exist. Check the ID shown on the ingredient card and try again.');

    console.log('[PASS] Lookup Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. AMOUNT VALIDATION TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: '1234', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 }
    ];

    const EXPECTED_AMOUNT_ERR = 'Enter a valid amount greater than 0 g or mL.';

    // Positive integer succeeds
    const resInt = createCustomFoodFromIngredient('1234', 34, 'g');
    assert.ok(resInt.entry, 'Positive integer amount must succeed');
    assert.strictEqual(resInt.entry.amount, 34);

    // Positive decimal succeeds
    const resDec = createCustomFoodFromIngredient('1234', 34.5, 'g');
    assert.ok(resDec.entry, 'Positive decimal amount must succeed');
    assert.strictEqual(resDec.entry.amount, 34.5);

    // Zero fails
    const resZero = createCustomFoodFromIngredient('1234', 0, 'g');
    assert.strictEqual(resZero.errors?.[0], EXPECTED_AMOUNT_ERR);

    // Negative fails
    const resNeg = createCustomFoodFromIngredient('1234', -10, 'g');
    assert.strictEqual(resNeg.errors?.[0], EXPECTED_AMOUNT_ERR);

    // Empty fails
    const resEmptyAmt = createCustomFoodFromIngredient('1234', '', 'g');
    assert.strictEqual(resEmptyAmt.errors?.[0], EXPECTED_AMOUNT_ERR);

    // Non-numeric fails
    const resNonNum = createCustomFoodFromIngredient('1234', 'abc', 'g');
    assert.strictEqual(resNonNum.errors?.[0], EXPECTED_AMOUNT_ERR);

    // NaN fails
    const resNaN = createCustomFoodFromIngredient('1234', NaN, 'g');
    assert.strictEqual(resNaN.errors?.[0], EXPECTED_AMOUNT_ERR);

    // Infinity fails
    const resInf = createCustomFoodFromIngredient('1234', Infinity, 'g');
    assert.strictEqual(resInf.errors?.[0], EXPECTED_AMOUNT_ERR);

    const resNegInf = createCustomFoodFromIngredient('1234', -Infinity, 'g');
    assert.strictEqual(resNegInf.errors?.[0], EXPECTED_AMOUNT_ERR);

    console.log('[PASS] Amount Validation Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 4. UNIT RESTRICTION & CONVERSION TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: 'MASS', name: 'Solid Food', servingSize: 100, unit: 'g', calories: 200, protein: 20, carbs: 10, fat: 5 },
      { id: 'VOLM', name: 'Liquid Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8 },
      { id: 'BAR1', name: 'Snack Bar', servingSize: 1, unit: 'bar', calories: 250, protein: 10, carbs: 30, fat: 8 }
    ];

    const INCOMPATIBLE_ERR = 'This ingredient does not have a valid g/mL serving definition and cannot be logged using this unit.';

    // 'g' accepted for mass-based ingredient
    const resG = createCustomFoodFromIngredient('MASS', 50, 'g');
    assert.ok(resG.entry, 'g accepted for g ingredient');
    assert.strictEqual(resG.entry.unit, 'g');

    // 'mL' accepted for volume-based ingredient
    const resML = createCustomFoodFromIngredient('VOLM', 120, 'mL');
    assert.ok(resML.entry, 'mL accepted for mL ingredient');
    assert.strictEqual(resML.entry.unit, 'mL');

    // 'ml' case-insensitively accepted and normalized to 'mL'
    const resMLCase = createCustomFoodFromIngredient('VOLM', 120, 'ml');
    assert.ok(resMLCase.entry, 'ml case-insensitively accepted');
    assert.strictEqual(resMLCase.entry.unit, 'mL');

    // mL rejected for mass-based ingredient (no implicit 100g = 100mL)
    const resMassWithML = createCustomFoodFromIngredient('MASS', 50, 'mL');
    assert.strictEqual(resMassWithML.errors?.[0], INCOMPATIBLE_ERR);

    // g rejected for volume-based ingredient
    const resVolWithG = createCustomFoodFromIngredient('VOLM', 100, 'g');
    assert.strictEqual(resVolWithG.errors?.[0], INCOMPATIBLE_ERR);

    // Arbitrary units rejected
    const resBar = createCustomFoodFromIngredient('BAR1', 1, 'bar');
    assert.strictEqual(resBar.errors?.[0], 'Unit must be either g or mL.');

    const resServing = createCustomFoodFromIngredient('MASS', 1, 'serving');
    assert.strictEqual(resServing.errors?.[0], 'Unit must be either g or mL.');

    // Ingredient with unit 'bar' cannot be logged as g without conversion data
    const resBarAsG = createCustomFoodFromIngredient('BAR1', 50, 'g');
    assert.strictEqual(resBarAsG.errors?.[0], INCOMPATIBLE_ERR);

    console.log('[PASS] Unit Restriction & Compatibility Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 5. NUTRITION CALCULATION TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      {
        id: '1234',
        name: 'Texas Toast',
        servingSize: 28,
        unit: 'g',
        calories: 80,
        protein: 2,
        carbs: 13,
        fat: 2
      }
    ];

    const outcome = createCustomFoodFromIngredient('1234', 34, 'g');
    assert.ok(outcome.entry, 'Operation must succeed');

    const entry = outcome.entry;
    const expectedServings = 34 / 28;
    const expectedCalories = 80 * (34 / 28);
    const expectedProtein = 2 * (34 / 28);
    const expectedCarbs = 13 * (34 / 28);
    const expectedFat = 2 * (34 / 28);

    assert.ok(approxEqual(entry.servings, expectedServings), `Servings expected ${expectedServings}, got ${entry.servings}`);
    assert.ok(approxEqual(entry.calories, expectedCalories), `Calories expected ${expectedCalories}, got ${entry.calories}`);
    assert.ok(approxEqual(entry.protein, expectedProtein), `Protein expected ${expectedProtein}, got ${entry.protein}`);
    assert.ok(approxEqual(entry.carbs, expectedCarbs), `Carbs expected ${expectedCarbs}, got ${entry.carbs}`);
    assert.ok(approxEqual(entry.fat, expectedFat), `Fat expected ${expectedFat}, got ${entry.fat}`);

    console.log('[PASS] Nutrition Calculation Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 6. GENERATED CUSTOM-FOOD SCHEMA & EATEN INVARIANTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: '1234', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 }
    ];

    const outcome = createCustomFoodFromIngredient('1234', 34, 'g');
    const cf = outcome.entry;

    assert.strictEqual(cf.foodDefId, '1234', 'foodDefId must match source ingredient ID');
    assert.strictEqual(cf.foodDefinitionId, '1234', 'foodDefinitionId must match source ingredient ID');
    assert.strictEqual(cf.amount, 34, 'amount must equal measured amount');
    assert.strictEqual(cf.unit, 'g', 'unit must equal canonical unit');
    assert.strictEqual(cf.isEaten, true, 'isEaten must be automatically true');
    assert.strictEqual(cf.eatenQuantity, 34, 'eatenQuantity must equal measured amount');
    assert.strictEqual(cf.confidence.calories, 'known');
    assert.strictEqual(cf.confidence.protein, 'known');
    assert.strictEqual(cf.confidence.carbs, 'known');
    assert.strictEqual(cf.confidence.fat, 'known');

    // Added to state.customFoods
    assert.strictEqual(state.customFoods.length, 1);
    assert.strictEqual(state.customFoods[0].id, cf.id);

    console.log('[PASS] Generated Custom-Food Schema & Eaten Invariants');
  }

  // ─────────────────────────────────────────────────────────────
  // 7. CONSOLIDATED CONSUMPTION INTEGRATION TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: '1234', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 }
    ];

    createCustomFoodFromIngredient('1234', 34, 'g');

    // Aggregate foods
    const agg = aggregateIngredients(null, state.customFoods, {}, state.ingredients);
    assert.strictEqual(agg.length, 1);

    const consumption = calculateConsumption(agg, {});
    assert.strictEqual(consumption.items.length, 1);

    const row = consumption.items[0];
    assert.strictEqual(row.name, 'Texas Toast');
    assert.strictEqual(row.plannedAmount, 34, 'Planned amount must be measured amount (34 g)');
    assert.strictEqual(row.eatenAmount, 34, 'Eaten amount must be measured amount (34 g)');
    assert.strictEqual(row.remainingAmount, 0, 'Remaining amount must be 0 g');

    // Nutrition in eatenTotals
    const expectedCal = 80 * (34 / 28);
    const expectedPro = 2 * (34 / 28);
    const expectedCarb = 13 * (34 / 28);
    const expectedFat = 2 * (34 / 28);

    assert.ok(approxEqual(consumption.eatenTotals.calories, expectedCal), `Eaten calories: ${consumption.eatenTotals.calories} vs ${expectedCal}`);
    assert.ok(approxEqual(consumption.eatenTotals.protein, expectedPro));
    assert.ok(approxEqual(consumption.eatenTotals.carbs, expectedCarb));
    assert.ok(approxEqual(consumption.eatenTotals.fat, expectedFat));

    // Remaining totals must be 0 for this food
    assert.strictEqual(consumption.remainingTotals.calories, 0);

    // Remaining daily targets reduced
    const remainingTargets = getRemainingTargets(state.targets, state.customFoods);
    assert.ok(approxEqual(remainingTargets.calories.value, state.targets.calories - expectedCal));
    assert.ok(approxEqual(remainingTargets.protein.value, state.targets.protein - expectedPro));

    console.log('[PASS] Consolidated Consumption Integration Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 8. MULTIPLE-ENTRY & DUPLICATE LOGGING OF SAME INGREDIENT
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: '1234', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 },
      { id: '5678', name: 'Roast Turkey', servingSize: 100, unit: 'g', calories: 135, protein: 30, carbs: 0, fat: 1.5 }
    ];

    // Log 1: 34 g Texas Toast
    const out1 = createCustomFoodFromIngredient('1234', 34, 'g');
    // Log 2: 72 g Texas Toast (duplicate logging of SAME ingredient)
    const out2 = createCustomFoodFromIngredient('1234', 72, 'g');
    // Log 3: 150 g Roast Turkey (different ingredient)
    const out3 = createCustomFoodFromIngredient('5678', 150, 'g');

    // Verify 3 distinct custom food entries exist
    assert.strictEqual(state.customFoods.length, 3, 'Must maintain 3 distinct logged events');
    assert.strictEqual(state.customFoods[0].id, out1.entry.id);
    assert.strictEqual(state.customFoods[1].id, out2.entry.id);
    assert.strictEqual(state.customFoods[2].id, out3.entry.id);

    assert.notStrictEqual(out1.entry.id, out2.entry.id, 'Distinct entry IDs for duplicate ingredient logs');
    assert.strictEqual(out1.entry.amount, 34);
    assert.strictEqual(out2.entry.amount, 72);

    // Consolidated Consumption aggregates identical foodDefId: 34 + 72 = 106 g
    const agg = aggregateIngredients(null, state.customFoods, {}, state.ingredients);
    const consumption = calculateConsumption(agg, {});

    const toastRow = consumption.items.find(it => it.foodDefinitionId === '1234');
    assert.ok(toastRow, 'Texas Toast row must exist');
    assert.strictEqual(toastRow.plannedAmount, 106, 'Planned must be 34 + 72 = 106 g');
    assert.strictEqual(toastRow.eatenAmount, 106, 'Eaten must be 34 + 72 = 106 g');
    assert.strictEqual(toastRow.remainingAmount, 0, 'Remaining must be 0 g');

    const turkeyRow = consumption.items.find(it => it.foodDefinitionId === '5678');
    assert.ok(turkeyRow, 'Roast Turkey row must exist');
    assert.strictEqual(turkeyRow.plannedAmount, 150);
    assert.strictEqual(turkeyRow.eatenAmount, 150);
    assert.strictEqual(turkeyRow.remainingAmount, 0);

    // Total eaten calories = Texas Toast (106g) + Turkey (150g)
    const toastExpectedCal = 80 * (106 / 28);
    const turkeyExpectedCal = 135 * (150 / 100);
    assert.ok(approxEqual(consumption.eatenTotals.calories, toastExpectedCal + turkeyExpectedCal));

    console.log('[PASS] Multiple-Entry & Duplicate Logging of Same Ingredient Tests');
  }

  // ─────────────────────────────────────────────────────────────
  // 9. SOLVER REGRESSION TESTS (FROZEN CONSUMED QUANTITIES)
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    state.ingredients = [
      { id: '1234', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'CHCK', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'YUCA', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
      { id: 'MILK', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous', availability: 'normal' }
    ];

    // Log 34 g Texas Toast
    createCustomFoodFromIngredient('1234', 34, 'g');
    const toastCal = 80 * (34 / 28);

    // Execute solve with preserveActuals: false
    const solveRes = Optimization.solve({ preserveActuals: false });
    assert.ok(solveRes.result, 'Optimization must find feasible plan');

    // 1. Measured food remains present in state.customFoods
    assert.strictEqual(state.customFoods.length, 1);
    const cf = state.customFoods[0];
    assert.strictEqual(cf.foodDefId, '1234');

    // 2. Measured food remains eaten
    assert.strictEqual(cf.isEaten, true);

    // 3. Measured amount remains unchanged (34 g)
    assert.strictEqual(cf.amount, 34);

    // 4. Nutritional contribution accounted for in result
    const r = solveRes.result;
    assert.ok(r.customFoodTotals, 'result.customFoodTotals must exist');
    assert.ok(approxEqual(r.customFoodTotals.calories, toastCal));

    // 5. The solver did not re-optimize Texas Toast or allocate additional uneaten servings
    let totalSolverToast = 0;
    r.mealResults.forEach(meal => {
      meal.items.forEach(item => {
        if (item.foodDefinitionId === '1234' || item.id === '1234') {
          totalSolverToast += (item.plannedQuantity ?? item.quantity ?? 0);
        }
      });
    });
    assert.strictEqual(totalSolverToast, 0, 'Solver must not allocate additional planned servings of Texas Toast');

    // 6. Non-eaten foods remain eligible and are allocated around the fixed quantity
    const totalAllocatedItems = r.mealResults.reduce((sum, m) => sum + m.items.length, 0);
    assert.ok(totalAllocatedItems > 0, 'Non-eaten foods must be allocated in meals');

    // 7. Combined totals reflect target (~2335 kcal)
    assert.ok(approxEqual(r.combinedTotals.calories, 2335, 60), `Combined calories ${r.combinedTotals.calories} should equal target 2335`);

    // 8. Multiple frozen measured foods simultaneously
    createCustomFoodFromIngredient('MILK', 200, 'mL');
    const milkCal = 150 * (200 / 240);

    const solveRes2 = Optimization.solve({ preserveActuals: false });
    assert.ok(solveRes2.result, 'Second solve must be feasible');
    assert.strictEqual(state.customFoods.length, 2, 'Both custom foods must remain');
    assert.ok(approxEqual(solveRes2.result.customFoodTotals.calories, toastCal + milkCal));

    console.log('[PASS] Solver Regression Tests (Frozen Consumed Quantities)');
  }

  // ─────────────────────────────────────────────────────────────
  // 10. RENDERING IMMUTABILITY TESTS
  // ─────────────────────────────────────────────────────────────
  {
    resetTestState();
    let renderedHtml = '';
    const mockList = {
      get innerHTML() { return renderedHtml; },
      set innerHTML(v) { renderedHtml = v; },
      querySelectorAll: () => [],
      querySelector: () => null
    };

    const prevDoc = global.document;
    global.document = {
      getElementById: (id) => {
        if (id === 'ingredient-list') return mockList;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => []
    };

    state.ingredients = [
      { id: '7F9K', name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 }
    ];

    UI.renderIngredients();

    assert.ok(renderedHtml.includes('7F9K'), 'Rendered HTML must visibly display 7F9K');
    assert.ok(renderedHtml.includes('ing-id-meta'), 'Rendered HTML must contain ing-id-meta');
    assert.ok(renderedHtml.includes('ing-name-wrap'), 'Rendered HTML must contain left-aligned ing-name-wrap');
    assert.strictEqual(state.ingredients[0].id, '7F9K', 'Ingredient ID must be immutable across rendering');

    // Also verify Results rendering does NOT contain any IDs
    let resultsHtml = '';
    const mockResults = {
      get innerHTML() { return resultsHtml; },
      set innerHTML(v) { resultsHtml = v; },
      querySelectorAll: () => [],
      querySelector: () => null
    };
    global.document.getElementById = (id) => {
      if (id === 'meal-results') return mockResults;
      return null;
    };
    state.result = {
      mealResults: [
        {
          id: 'meal_0',
          name: 'Breakfast',
          pct: 40,
          items: [
            { id: '7F9K', name: 'Texas Toast', servings: 1.0, quantity: 28, unit: 'g', plannedQuantity: 28, calories: 80, protein: 2, carbs: 13, fat: 2 }
          ]
        }
      ],
      totals: { calories: 80, protein: 2, carbs: 13, fat: 2 },
      deviations: { calories: { absolute: 0, percentage: 0 }, protein: { absolute: 0, percentage: 0 }, carbs: { absolute: 0, percentage: 0 }, fat: { absolute: 0, percentage: 0 } }
    };
    UI.renderResults({ scroll: false });
    assert.ok(!resultsHtml.includes('result-ingredient-id'), 'Results must NOT contain result-ingredient-id');
    assert.ok(!resultsHtml.includes('ID: 7F9K'), 'Results must NOT display ingredient ID');

    global.document = prevDoc;
    console.log('[PASS] Rendering Immutability Tests');
  }

  // ── TEST: Partial Consumption Cumulative Tracking & Invariants ──
  {
    resetTestState();
    const breadId = '7F9K';
    state.ingredients = [
      { id: breadId, name: 'Texas Toast', servingSize: 28, unit: 'g', calories: 80, protein: 2, carbs: 13, fat: 2 }
    ];
    const createRes = createCustomFoodFromIngredient(breadId, 100, 'g', state);
    assert.strictEqual(createRes.errors.length, 0, 'Must create food without errors');
    const food = createRes.entry;

    assert.strictEqual(food.amountLogged, 100, 'Initial amountLogged is 100');
    assert.strictEqual(food.amountEaten, 100, 'Initial amountEaten is 100');
    assert.strictEqual(food.amountRemaining, 0, 'Initial amountRemaining is 0');
    assert.strictEqual(food.isEaten, true, 'Initial isEaten is true');

    // Partial consumption: 40 g eaten
    const partRes = recordPartialConsumption(food.id, 40, state);
    assert.strictEqual(partRes.errors.length, 0, 'No errors on recording 40g eaten');
    assert.strictEqual(food.amountLogged, 100, 'amountLogged remains 100');
    assert.strictEqual(food.amountEaten, 40, 'amountEaten becomes 40');
    assert.strictEqual(food.amountRemaining, 60, 'amountRemaining becomes 60');
    assert.strictEqual(food.eatenQuantity, 40, 'eatenQuantity is 40');
    assert.strictEqual(food.isEaten, false, 'isEaten becomes false');

    // Cumulative update: 40 g -> 70 g (replaces cumulative, NOT 110 g)
    const updateRes = recordPartialConsumption(food.id, 70, state);
    assert.strictEqual(updateRes.errors.length, 0, 'No errors updating to 70g');
    assert.strictEqual(food.amountLogged, 100, 'amountLogged remains 100');
    assert.strictEqual(food.amountEaten, 70, 'amountEaten is 70 (not 110)');
    assert.strictEqual(food.amountRemaining, 30, 'amountRemaining is 30');
    assert.strictEqual(food.eatenQuantity, 70, 'eatenQuantity is 70');
    assert.strictEqual(food.isEaten, false, 'isEaten is false');

    // Negative / invalid eaten amounts rejected
    const badRes = recordPartialConsumption(food.id, -10, state);
    assert.ok(badRes.errors.length > 0, 'Negative eaten quantity must be rejected');

    console.log('[PASS] Partial Consumption Cumulative Tracking Tests');
  }

  // ── TEST: Monochrome Preview Styling Invariant ──
  {
    const cssPath = path.resolve(__dirname, '../styles/components/custom-foods.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Extract .measured-food-preview block
    const previewMatch = cssContent.match(/\.measured-food-preview\s*\{([^}]+)\}/);
    assert.ok(previewMatch, '.measured-food-preview class must exist in custom-foods.css');
    const previewStyles = previewMatch[1];

    // Must NOT contain blue RGB or hex colors
    assert.ok(!previewStyles.includes('59, 130, 246'), 'Must not contain blue rgba(59, 130, 246)');
    assert.ok(!previewStyles.includes('37, 99, 235'), 'Must not contain blue rgba(37, 99, 235)');
    assert.ok(!previewStyles.includes('#3b82f6'), 'Must not contain hex blue #3b82f6');

    // Must contain monochrome design tokens
    assert.ok(previewStyles.includes('var(--bg2') || previewStyles.includes('rgba(40, 40, 40'), 'Must use monochrome --bg2');
    assert.ok(previewStyles.includes('var(--border-hi') || previewStyles.includes('rgba(255, 255, 255'), 'Must use monochrome --border-hi');

    console.log('[PASS] Monochrome Preview Styling Invariant Tests');
  }

  resetTestState();

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' ALL MEASURED FOODS TESTS PASSED (0 failures)                     ');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMeasuredFoodsTestSuite();
}
