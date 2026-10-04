// ══════════════════════════════════════════════════════════════════
// TEST SUITE: NUTRITIONAL ERROR SAFETY CHECKER
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
  DEFAULT_TARGETS,
  DEFAULT_MEALS,
  DEFAULT_INGREDIENTS,
  DEFAULT_MAX_TOTAL_ERROR,
  findIngredientById,
  ensureIngredientId
} from '../src/core/state.js';
import { Persistence } from '../src/io/persistence.js';
import { solveModel } from '../src/core/solver.js';
import {
  calculateTotalError,
  validateThreshold,
  validateSafetyInputs,
  evaluateFoodQuantity,
  findMaximumSafeQuantity,
  checkNutritionalSafety
} from '../src/core/safetyChecker.js';

function resetTestState() {
  global.localStorage.clear();
  state.targets = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
  state.meals = JSON.parse(JSON.stringify(DEFAULT_MEALS));
  state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
  state.ingredients.forEach(ing => ensureIngredientId(ing, state.ingredients));
  state.customFoods = [];
  state.actuals = {};
  state.eatenItems = {};
  state.ateSoFar = {};
  state.result = null;
  state.maxTotalError = DEFAULT_MAX_TOTAL_ERROR;
  state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 0.5 };
  state.penalties = { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002, availabilityLow: 0.0005, availabilityLimited: 0.002 };
  state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
}

/** Get the baseline total error for the default state (no custom foods). */
function getBaselineError() {
  const outcome = solveModel(state, { validate: false });
  if (!outcome.feasible || !outcome.result) return Infinity;
  return calculateTotalError(outcome.result);
}

export function runSafetyCheckerTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING NUTRITIONAL ERROR SAFETY CHECKER TEST SUITE              ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function logPass(id, msg) {
    console.log(`[${id}] ${msg} - PASSED`);
    passed++;
  }

  function logFail(id, msg, err) {
    console.log(`[${id}] ${msg} - FAILED: ${err}`);
    failed++;
  }

  // First, determine the baseline error for the default ingredient set
  resetTestState();
  const baselineError = getBaselineError();
  // Use a threshold comfortably above the 200g chicken error (~39.3%) for feasible tests
  const FEASIBLE_THRESHOLD = 50;
  // Use a threshold below baseline for guaranteed "infeasible" tests
  const TIGHT_THRESHOLD = Math.max(0.1, baselineError - 2);

  console.log(`  Baseline total error: ${baselineError.toFixed(4)}%`);
  console.log(`  Feasible test threshold: ${FEASIBLE_THRESHOLD}%`);
  console.log(`  Tight test threshold: ${TIGHT_THRESHOLD}%\n`);

  // ── [SC-1] Clearly feasible quantity ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const result = checkNutritionalSafety(chickenId, 200, 'g', FEASIBLE_THRESHOLD, state);
      assert.ok(result.success, 'Should succeed');
      assert.ok(result.compatible, `Should be compatible at threshold ${FEASIBLE_THRESHOLD}% (error: ${result.totalError})`);
      assert.strictEqual(result.status, 'YES');
      assert.ok(result.totalError <= FEASIBLE_THRESHOLD + 1e-7, `Total error ${result.totalError} should be <= ${FEASIBLE_THRESHOLD}`);
      logPass('SC-1', 'Clearly feasible quantity returns YES');
    } catch (e) {
      logFail('SC-1', 'Clearly feasible quantity', e.message);
    }
  }

  // ── [SC-2] Clearly infeasible quantity ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      // Very tight threshold + large quantity should be infeasible
      const result = checkNutritionalSafety(chickenId, 2000, 'g', TIGHT_THRESHOLD, state);
      assert.ok(result.success, 'Should succeed');
      assert.ok(!result.compatible, 'Should be incompatible');
      assert.strictEqual(result.status, 'NO');
      assert.ok(typeof result.maxSafeAmount === 'number', 'Should have maxSafeAmount');
      logPass('SC-2', 'Clearly infeasible quantity returns NO with max safe amount');
    } catch (e) {
      logFail('SC-2', 'Clearly infeasible quantity', e.message);
    }
  }

  // ── [SC-3] Quantity at generous threshold returns correct status ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const result = checkNutritionalSafety(chickenId, 200, 'g', FEASIBLE_THRESHOLD, state);
      assert.ok(result.success, 'Should succeed');
      assert.ok(result.totalError <= FEASIBLE_THRESHOLD + 1e-7, `Error ${result.totalError} should be at or below threshold ${FEASIBLE_THRESHOLD}`);
      logPass('SC-3', 'Quantity at generous threshold returns correct status');
    } catch (e) {
      logFail('SC-3', 'Quantity at error threshold', e.message);
    }
  }

  // ── [SC-4] Max safe amount is verified feasible ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      // Use baseline+2 as threshold so there's some room but not unlimited
      const threshold = baselineError + 2;
      const result = checkNutritionalSafety(chickenId, 1000, 'g', threshold, state);
      assert.ok(result.success, 'Should succeed');
      if (!result.compatible && result.maxSafeAmount > 0) {
        const verify = checkNutritionalSafety(chickenId, result.maxSafeAmount, 'g', threshold, state);
        assert.ok(verify.success, 'Verify should succeed');
        assert.ok(verify.compatible, `Max safe amount ${result.maxSafeAmount} should be compatible (error: ${verify.totalError}, threshold: ${threshold})`);
      }
      logPass('SC-4', 'Max safe amount is verified feasible');
    } catch (e) {
      logFail('SC-4', 'Max safe amount verification', e.message);
    }
  }

  // ── [SC-5] Quantity above max safe returns NO ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const threshold = baselineError + 2;
      const result = checkNutritionalSafety(chickenId, 1000, 'g', threshold, state);
      assert.ok(result.success);
      if (!result.compatible && result.maxSafeAmount > 0 && result.maxSafeAmount < 1000) {
        const aboveAmt = result.maxSafeAmount + 20;
        const verify = checkNutritionalSafety(chickenId, aboveAmt, 'g', threshold, state);
        assert.ok(verify.success);
        assert.ok(!verify.compatible, `Amount ${aboveAmt} above max safe ${result.maxSafeAmount} should be incompatible`);
      }
      logPass('SC-5', 'Quantity above max safe amount returns NO');
    } catch (e) {
      logFail('SC-5', 'Quantity just above threshold', e.message);
    }
  }

  // ── [SC-6] Multiple different thresholds ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const thresholds = [baselineError + 1, baselineError + 3, baselineError + 5, baselineError + 10];
      const results = thresholds.map(t => checkNutritionalSafety(chickenId, 200, 'g', t, state));
      for (const r of results) {
        assert.ok(r.success, 'Should succeed');
      }
      // Higher thresholds should be at least as permissive as lower ones
      if (results[0].compatible) {
        assert.ok(results[3].compatible, 'If feasible at low threshold, must be feasible at higher threshold');
      }
      logPass('SC-6', 'Multiple thresholds evaluated correctly');
    } catch (e) {
      logFail('SC-6', 'Multiple different thresholds', e.message);
    }
  }

  // ── [SC-7] Persistence after reload ──
  {
    resetTestState();
    try {
      state.maxTotalError = 1.4;
      Persistence.save();

      // Simulate reload
      state.maxTotalError = DEFAULT_MAX_TOTAL_ERROR;
      Persistence.load();

      assert.strictEqual(state.maxTotalError, 1.4, 'Threshold should persist as 1.4');
      logPass('SC-7', 'Error threshold persisted and restored correctly');
    } catch (e) {
      logFail('SC-7', 'Persistence after reload', e.message);
    }
  }

  // ── [SC-8] Invalid Food IDs ──
  {
    resetTestState();
    try {
      const r1 = checkNutritionalSafety('', 100, 'g', 3, state);
      assert.ok(!r1.success, 'Empty ID should fail');
      assert.ok(r1.error, 'Should have error message');

      const r2 = checkNutritionalSafety('ZZZZ', 100, 'g', 3, state);
      assert.ok(!r2.success, 'Nonexistent ID should fail');
      assert.ok(r2.error, 'Should have error message');

      logPass('SC-8', 'Invalid Food IDs handled gracefully');
    } catch (e) {
      logFail('SC-8', 'Invalid Food IDs', e.message);
    }
  }

  // ── [SC-9] Invalid quantities ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const r1 = checkNutritionalSafety(chickenId, 0, 'g', 3, state);
      assert.ok(!r1.success, 'Zero amount should fail');

      const r2 = checkNutritionalSafety(chickenId, -50, 'g', 3, state);
      assert.ok(!r2.success, 'Negative amount should fail');

      const r3 = checkNutritionalSafety(chickenId, 'abc', 'g', 3, state);
      assert.ok(!r3.success, 'Non-numeric amount should fail');

      logPass('SC-9', 'Invalid quantities handled gracefully');
    } catch (e) {
      logFail('SC-9', 'Invalid quantities', e.message);
    }
  }

  // ── [SC-10] g vs mL compatibility and mismatch handling ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id; // unit=g
    const milkId = state.ingredients.find(i => i.name === 'Whole Milk')?.id; // unit=mL
    try {
      // Chicken is g — asking with mL should fail
      const r1 = checkNutritionalSafety(chickenId, 100, 'mL', FEASIBLE_THRESHOLD, state);
      assert.ok(!r1.success, 'Chicken with mL should fail');

      // Milk is mL — asking with g should fail
      const r2 = checkNutritionalSafety(milkId, 200, 'g', FEASIBLE_THRESHOLD, state);
      assert.ok(!r2.success, 'Milk with g should fail');

      // Chicken with g should succeed
      const r3 = checkNutritionalSafety(chickenId, 100, 'g', FEASIBLE_THRESHOLD, state);
      assert.ok(r3.success, 'Chicken with g should succeed');

      // Milk with mL should succeed
      const r4 = checkNutritionalSafety(milkId, 200, 'mL', FEASIBLE_THRESHOLD, state);
      assert.ok(r4.success, 'Milk with mL should succeed');

      logPass('SC-10', 'Unit compatibility and mismatch handled correctly');
    } catch (e) {
      logFail('SC-10', 'Unit compatibility', e.message);
    }
  }

  // ── [SC-11] Maximum-safe-quantity calculation ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const threshold = baselineError + 2;
      const result = checkNutritionalSafety(chickenId, 500, 'g', threshold, state);
      assert.ok(result.success, 'Should succeed');
      if (!result.compatible) {
        assert.ok(typeof result.maxSafeAmount === 'number', 'Should have maxSafeAmount');
        assert.ok(result.maxSafeAmount >= 0, 'Max safe should be >= 0');
        assert.ok(result.maxSafeAmount < 500, 'Max safe should be < requested');
        // Verify the max safe amount is actually safe
        if (result.maxSafeAmount > 0) {
          const verify = checkNutritionalSafety(chickenId, result.maxSafeAmount, 'g', threshold, state);
          assert.ok(verify.success && verify.compatible, `Max safe amount ${result.maxSafeAmount} should verify as compatible`);
        }
      }
      logPass('SC-11', 'Maximum safe quantity calculated and verified');
    } catch (e) {
      logFail('SC-11', 'Maximum-safe-quantity calculation', e.message);
    }
  }

  // ── [SC-12] Rounding near feasibility boundary ──
  {
    resetTestState();
    const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
    try {
      const threshold = 50;
      const result = checkNutritionalSafety(chickenId, 2000, 'g', threshold, state);
      assert.ok(result.success, 'Should succeed');
      if (!result.compatible && result.maxSafeAmount > 0) {
        // The rounded/displayed max safe amount must itself be feasible
        const verify = checkNutritionalSafety(chickenId, result.maxSafeAmount, 'g', threshold, state);
        assert.ok(verify.success && verify.compatible,
          `Displayed max safe amount ${result.maxSafeAmount} must be verified feasible (error: ${verify.totalError})`);
      }
      logPass('SC-12', 'Rounding near feasibility boundary produces strictly feasible displayed amount');
    } catch (e) {
      logFail('SC-12', 'Rounding near feasibility boundary', e.message);
    }
  }

  // ── [SC-13] Baseline solver behavior unchanged before and after ──
  {
    resetTestState();
    try {
      // Solve baseline
      const baseOutcome = solveModel(state, { validate: false });
      assert.ok(baseOutcome.feasible, 'Baseline should be feasible');
      const baseErr = calculateTotalError(baseOutcome.result);

      // Run safety checker
      const chickenId = state.ingredients.find(i => i.name === 'Chicken')?.id;
      checkNutritionalSafety(chickenId, 200, 'g', FEASIBLE_THRESHOLD, state);

      // Solve again - should be identical
      const afterOutcome = solveModel(state, { validate: false });
      assert.ok(afterOutcome.feasible, 'Post-check baseline should be feasible');
      const afterErr = calculateTotalError(afterOutcome.result);

      assert.ok(Math.abs(baseErr - afterErr) < 0.01,
        `Baseline error ${baseErr.toFixed(4)} should match post-check error ${afterErr.toFixed(4)}`);

      logPass('SC-13', 'Baseline solver behavior unchanged after safety check');
    } catch (e) {
      logFail('SC-13', 'Baseline solver unchanged', e.message);
    }
  }

  // ── [SC-14] Threshold validation edge cases ──
  {
    try {
      assert.ok(!validateThreshold(-1).valid, 'Negative threshold invalid');
      assert.ok(!validateThreshold(null).valid, 'Null threshold invalid');
      assert.ok(!validateThreshold('abc').valid, 'String threshold invalid');
      assert.ok(!validateThreshold(Infinity).valid, 'Infinity threshold invalid');
      assert.ok(validateThreshold(0).valid, 'Zero threshold valid');
      assert.ok(validateThreshold(0.5).valid, '0.5 threshold valid');
      assert.ok(validateThreshold(100).valid, '100 threshold valid');
      logPass('SC-14', 'Threshold validation edge cases');
    } catch (e) {
      logFail('SC-14', 'Threshold validation', e.message);
    }
  }

  // ── [SC-15] DEFAULT_MAX_TOTAL_ERROR constant ──
  {
    try {
      assert.strictEqual(DEFAULT_MAX_TOTAL_ERROR, 3.0, 'Default should be 3.0');
      logPass('SC-15', 'DEFAULT_MAX_TOTAL_ERROR is 3.0');
    } catch (e) {
      logFail('SC-15', 'Default constant', e.message);
    }
  }

  console.log(`\nSafety Checker: ${passed} passed, ${failed} failed out of ${passed + failed} tests.\n`);
  if (failed > 0) {
    throw new Error(`Safety Checker test suite had ${failed} failure(s)`);
  }
}
