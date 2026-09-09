// ══════════════════════════════════════════
// CONSUMPTION & INGREDIENT AGGREGATION TEST SUITE
// ══════════════════════════════════════════

import assert from 'node:assert';
import { state, copyMeal, DEFAULT_TARGETS } from '../src/core/state.js';
import {
  aggregateIngredients,
  calculateConsumption,
  duplicateMealItem,
  distributeConsolidatedEaten,
  getConsolidatedEaten,
  getItemEatenQuantity
} from '../src/core/consumption.js';
import { Optimization } from '../src/core/solver.js';
import { formatDailySummary } from '../src/core/formatters.js';
import { Persistence } from '../src/io/persistence.js';
import { UI } from '../src/ui/render.js';

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

export function runConsumptionTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING MEAL STATE & INGREDIENT CONSOLIDATION TEST SUITE          ');
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
    state.ateSoFar = {};
    state.result = null;
  }

  // ── TEST 1: duplicateMealItem() retains complete nutritional definition ──
  {
    const original = {
      id: 'custom_turkey',
      foodDefinitionId: 'custom_turkey',
      name: 'Custom Turkey',
      servingSize: 100,
      servings: 1.5,
      unit: 'g',
      calories: 225,
      protein: 45,
      carbs: 0,
      fat: 4.5,
      caloriesPerServing: 150,
      proteinPerServing: 30,
      carbsPerServing: 0,
      fatPerServing: 3,
      custom: true
    };

    const duplicate = duplicateMealItem(original);
    assert.strictEqual(duplicate.foodDefinitionId, 'custom_turkey', 'Food definition ID must match original');
    assert.notStrictEqual(duplicate.mealItemId, undefined, 'Must have a new mealItemId');
    assert.strictEqual(duplicate.caloriesPerServing, 150, 'caloriesPerServing must be retained');
    assert.strictEqual(duplicate.proteinPerServing, 30, 'proteinPerServing must be retained');
    assert.strictEqual(duplicate.carbsPerServing, 0, 'carbsPerServing must be retained');
    assert.strictEqual(duplicate.fatPerServing, 3, 'fatPerServing must be retained');
    assert.strictEqual(duplicate.custom, true, 'custom flag must be retained');

    console.log('[CS-1] duplicateMealItem Preserves Nutritional Definition & Identity: PASSED');
  }

  // ── TEST 2: Copy Meal duplicates meal and preserves custom food identity ──
  {
    resetTestState();
    // Add custom food assigned to Breakfast
    state.customFoods.push({
      id: 'cf_turkey_1',
      foodDefinitionId: 'def_turkey_1',
      name: 'Smoked Turkey',
      amount: 150,
      unit: 'g',
      calories: 220,
      protein: 42,
      carbs: 0,
      fat: 4.5,
      meal: 'meal_breakfast',
      custom: true
    });

    const copyResult = copyMeal('meal_breakfast', state);
    assert.ok(copyResult.newMealId, 'New meal ID created');
    assert.strictEqual(state.meals.length, 4, 'Meal count increased by 1');
    assert.strictEqual(state.meals[3].name, 'Breakfast (Copy)');

    // Verify custom food occurrence duplicated with same foodDefinitionId
    const newCustomFood = state.customFoods.find(cf => cf.meal === copyResult.newMealId);
    assert.ok(newCustomFood, 'Copied meal has assigned custom food');
    assert.strictEqual(newCustomFood.foodDefinitionId, 'def_turkey_1', 'Canonical foodDefinitionId preserved');
    assert.notStrictEqual(newCustomFood.id, 'cf_turkey_1', 'New occurrence has unique instance ID');
    assert.strictEqual(newCustomFood.amount, 150);
    assert.strictEqual(newCustomFood.calories, 220);
    assert.strictEqual(newCustomFood.protein, 42);

    console.log('[CS-2] Copy Meal Duplication & Food Definition Identity: PASSED');
  }

  // ── TEST 3: Copy Meal respects maximum limit of 6 meals ──
  {
    resetTestState();
    state.meals = [
      { id: 'm1', name: 'M1', pct: 15 },
      { id: 'm2', name: 'M2', pct: 15 },
      { id: 'm3', name: 'M3', pct: 20 },
      { id: 'm4', name: 'M4', pct: 20 },
      { id: 'm5', name: 'M5', pct: 15 },
      { id: 'm6', name: 'M6', pct: 15 }
    ];

    const copyRes = copyMeal('m1', state);
    assert.ok(copyRes.error, 'Returns error when attempting to exceed 6 meals');
    assert.strictEqual(state.meals.length, 6, 'Meal count unchanged at limit');

    console.log('[CS-3] Copy Meal Max Capacity Invariant: PASSED');
  }

  // ── TEST 4: Aggregation groups identical foodDefinitionId across meal splits ──
  {
    const mockSolverResult = {
      mealResults: [
        {
          id: 'meal_breakfast',
          name: 'Breakfast',
          items: [
            {
              id: 'ing_chicken',
              foodDefinitionId: 'ing_chicken',
              name: 'Chicken',
              unit: 'g',
              servingSize: 100,
              quantity: 112,
              plannedQuantity: 112,
              servings: 1.12,
              calories: 184.8,
              protein: 34.72,
              carbs: 0,
              fat: 4.032,
              caloriesPerServing: 165,
              proteinPerServing: 31,
              carbsPerServing: 0,
              fatPerServing: 3.6
            }
          ]
        },
        {
          id: 'meal_lunch',
          name: 'Lunch',
          items: [
            {
              id: 'ing_rice',
              foodDefinitionId: 'ing_rice',
              name: 'Rice',
              unit: 'g',
              servingSize: 100,
              quantity: 180,
              plannedQuantity: 180,
              servings: 1.8,
              calories: 234,
              protein: 4.86,
              carbs: 50.76,
              fat: 0.54,
              caloriesPerServing: 130,
              proteinPerServing: 2.7,
              carbsPerServing: 28.2,
              fatPerServing: 0.3
            }
          ]
        },
        {
          id: 'meal_dinner',
          name: 'Dinner',
          items: [
            {
              id: 'ing_chicken',
              foodDefinitionId: 'ing_chicken',
              name: 'Chicken',
              unit: 'g',
              servingSize: 100,
              quantity: 23,
              plannedQuantity: 23,
              servings: 0.23,
              calories: 37.95,
              protein: 7.13,
              carbs: 0,
              fat: 0.828,
              caloriesPerServing: 165,
              proteinPerServing: 31,
              carbsPerServing: 0,
              fatPerServing: 3.6
            }
          ]
        }
      ]
    };

    const aggregated = aggregateIngredients(mockSolverResult, []);
    assert.strictEqual(aggregated.length, 2, 'Consolidates 3 items into 2 unique food definitions');

    const chicken = aggregated.find(a => a.foodDefinitionId === 'ing_chicken');
    assert.ok(chicken, 'Chicken aggregated');
    // 112 + 23 = 135 g
    assert.strictEqual(Math.round(chicken.plannedAmount * 100) / 100, 135);
    assert.strictEqual(Math.round(chicken.totalServings * 100) / 100, 1.35);
    assert.strictEqual(chicken.meals.length, 2, 'Tracks 2 contributing meals');

    const rice = aggregated.find(a => a.foodDefinitionId === 'ing_rice');
    assert.ok(rice, 'Rice aggregated');
    assert.strictEqual(rice.plannedAmount, 180);

    console.log('[CS-4] Ingredient Aggregation Across Meal Splits (112g + 23g = 135g): PASSED');
  }

  // ── TEST 5: Ingredient identity: distinct IDs with same display name NOT merged ──
  {
    const mockSolverResult = {
      mealResults: [
        {
          id: 'm1',
          name: 'Meal 1',
          items: [
            {
              id: 'ing_chicken_cooked',
              foodDefinitionId: 'ing_chicken_cooked',
              name: 'Chicken Breast',
              unit: 'g',
              servingSize: 100,
              quantity: 100,
              plannedQuantity: 100,
              servings: 1,
              calories: 165,
              protein: 31,
              carbs: 0,
              fat: 3.6
            },
            {
              id: 'ing_chicken_raw',
              foodDefinitionId: 'ing_chicken_raw',
              name: 'Chicken Breast',
              unit: 'g',
              servingSize: 100,
              quantity: 100,
              plannedQuantity: 100,
              servings: 1,
              calories: 120,
              protein: 22,
              carbs: 0,
              fat: 2.5
            }
          ]
        }
      ]
    };

    const aggregated = aggregateIngredients(mockSolverResult, []);
    assert.strictEqual(aggregated.length, 2, 'Must not merge foods sharing display name with distinct IDs');

    console.log('[CS-5] Food Identity Preserved Over Name Collisions: PASSED');
  }

  // ── TEST 6: "Ate So Far" calculation & non-negative boundary invariant ──
  {
    const mockFoods = [
      {
        foodDefinitionId: 'chicken',
        name: 'Chicken',
        unit: 'g',
        servingSize: 100,
        caloriesPerServing: 165,
        proteinPerServing: 31,
        carbsPerServing: 0,
        fatPerServing: 3.6,
        plannedAmount: 135,
        totalServings: 1.35,
        density: {
          caloriesPerUnit: 1.65,
          proteinPerUnit: 0.31,
          carbsPerUnit: 0,
          fatPerUnit: 0.036
        },
        meals: []
      },
      {
        foodDefinitionId: 'rice',
        name: 'Rice',
        unit: 'g',
        servingSize: 100,
        caloriesPerServing: 130,
        proteinPerServing: 2.7,
        carbsPerServing: 28.2,
        fatPerServing: 0.3,
        plannedAmount: 200,
        totalServings: 2,
        density: {
          caloriesPerUnit: 1.30,
          proteinPerUnit: 0.027,
          carbsPerUnit: 0.282,
          fatPerUnit: 0.003
        },
        meals: []
      },
      {
        foodDefinitionId: 'milk',
        name: 'Milk',
        unit: 'mL',
        servingSize: 240,
        caloriesPerServing: 150,
        proteinPerServing: 8,
        carbsPerServing: 12,
        fatPerServing: 8,
        plannedAmount: 300,
        totalServings: 1.25,
        density: {
          caloriesPerUnit: 150 / 240,
          proteinPerUnit: 8 / 240,
          carbsPerUnit: 12 / 240,
          fatPerUnit: 8 / 240
        },
        meals: []
      }
    ];

    const ateSoFar = {
      chicken: 50,
      rice: 75,
      milk: 300
    };

    const consumption = calculateConsumption(mockFoods, ateSoFar);
    const cItem = consumption.items.find(i => i.foodDefinitionId === 'chicken');
    assert.strictEqual(cItem.plannedAmount, 135);
    assert.strictEqual(cItem.eatenAmount, 50);
    assert.strictEqual(cItem.remainingAmount, 85, '135 - 50 = 85g remaining');

    const rItem = consumption.items.find(i => i.foodDefinitionId === 'rice');
    assert.strictEqual(rItem.remainingAmount, 125, '200 - 75 = 125g remaining');

    const mItem = consumption.items.find(i => i.foodDefinitionId === 'milk');
    assert.strictEqual(mItem.remainingAmount, 0, '300 - 300 = 0mL remaining');

    // Overeating boundary test: Planned = 100, Ate = 125 -> Remaining = 0
    const overeatenFoods = [
      {
        foodDefinitionId: 'beef',
        name: 'Beef',
        unit: 'g',
        plannedAmount: 100,
        servingSize: 100,
        density: { caloriesPerUnit: 2.0, proteinPerUnit: 0.25, carbsPerUnit: 0, fatPerUnit: 0.1 },
        meals: []
      }
    ];
    const overeatenConsumption = calculateConsumption(overeatenFoods, { beef: 125 });
    const beefItem = overeatenConsumption.items[0];
    assert.strictEqual(beefItem.remainingAmount, 0, 'Remaining must be 0 when eaten > planned, never negative');

    console.log('[CS-6] Ate So Far & Non-Negative Boundary Invariants: PASSED');
  }

  // ── TEST 7: Canonical nutrient density & remaining macros derivation ──
  {
    const mockFoods = [
      {
        foodDefinitionId: 'chicken',
        name: 'Chicken',
        unit: 'g',
        servingSize: 100,
        caloriesPerServing: 165,
        proteinPerServing: 31,
        carbsPerServing: 0,
        fatPerServing: 3.6,
        plannedAmount: 135,
        density: {
          caloriesPerUnit: 1.65,
          proteinPerUnit: 0.31,
          carbsPerUnit: 0,
          fatPerUnit: 0.036
        },
        meals: []
      }
    ];

    const consumption = calculateConsumption(mockFoods, { chicken: 50 });
    const item = consumption.items[0];
    // Remaining = 85g
    // Canonical density: 1.65 kcal/g, 0.31 P/g, 0.036 F/g
    const expectedKcal = 85 * 1.65;
    const expectedPro = 85 * 0.31;
    const expectedFat = 85 * 0.036;

    assert.strictEqual(Math.round(item.remainingMacros.calories * 10) / 10, Math.round(expectedKcal * 10) / 10);
    assert.strictEqual(Math.round(item.remainingMacros.protein * 10) / 10, Math.round(expectedPro * 10) / 10);
    assert.strictEqual(Math.round(item.remainingMacros.fat * 10) / 10, Math.round(expectedFat * 10) / 10);

    assert.strictEqual(consumption.remainingTotals.calories, item.remainingMacros.calories);
    assert.strictEqual(consumption.remainingTotals.protein, item.remainingMacros.protein);

    console.log('[CS-7] Canonical Nutrient Density Remaining Macros Derivation: PASSED');
  }

  // ── TEST 8: Solver rerun preserves historical eaten state and handles P = 0 ──
  {
    // Case 1: Solver plan adjusts chicken from 135g to 110g, Ate remains 50g -> Remaining = 60g
    const updatedPlanFoods = [
      {
        foodDefinitionId: 'chicken',
        name: 'Chicken',
        unit: 'g',
        servingSize: 100,
        plannedAmount: 110,
        density: { caloriesPerUnit: 1.65, proteinPerUnit: 0.31, carbsPerUnit: 0, fatPerUnit: 0.036 },
        meals: []
      }
    ];

    const eatenHistory = { chicken: 50 };
    const res1 = calculateConsumption(updatedPlanFoods, eatenHistory);
    assert.strictEqual(res1.items[0].remainingAmount, 60, '110 - 50 = 60g remaining after solver reallocation');

    // Case 2: Solver removes chicken entirely: Planned = 0, Ate = 50 -> Remaining = 0, unplanned record preserved
    const solverRemovedResult = { mealResults: [] };
    const knownIngredients = [
      { id: 'chicken', name: 'Chicken', unit: 'g', servingSize: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6 }
    ];

    const aggregatedUnplanned = aggregateIngredients(solverRemovedResult, [], eatenHistory, knownIngredients);
    assert.strictEqual(aggregatedUnplanned.length, 1, 'Preserves eaten food as unplanned record when planned is 0');
    assert.strictEqual(aggregatedUnplanned[0].plannedAmount, 0);
    assert.strictEqual(aggregatedUnplanned[0].unplanned, true);

    const res2 = calculateConsumption(aggregatedUnplanned, eatenHistory);
    assert.strictEqual(res2.items[0].eatenAmount, 50, 'Historical eaten amount preserved');
    assert.strictEqual(res2.items[0].remainingAmount, 0, 'Remaining is 0 when planned is 0');
    assert.strictEqual(res2.items[0].unplanned, true);

    console.log('[CS-8] Solver Rerun State Decoupling & Unplanned Eaten Preservation: PASSED');
  }

  // ── TEST 9: Persistence of ateSoFar across Save, Load, and Reset ──
  {
    resetTestState();
    state.ateSoFar = { ing_chicken: 75, ing_milk: 120 };
    Persistence.save();

    // Verify stored in localStorage
    const saved = JSON.parse(global.localStorage.getItem('macroSolver_ateSoFar'));
    assert.strictEqual(saved.ing_chicken, 75);
    assert.strictEqual(saved.ing_milk, 120);

    // Reset state and restore
    state.ateSoFar = {};
    Persistence.load();
    assert.strictEqual(state.ateSoFar.ing_chicken, 75);
    assert.strictEqual(state.ateSoFar.ing_milk, 120);

    // Reset to defaults
    Persistence.resetToDefaults();
    assert.strictEqual(Object.keys(state.ateSoFar).length, 0, 'Reset clears ateSoFar');
    assert.strictEqual(global.localStorage.getItem('macroSolver_ateSoFar'), null);

    console.log('[CS-9] Consumption State Persistence Lifecycle: PASSED');
  }

  // ── TEST 10: Consolidated Consumption planned and remaining amounts rounded to whole numbers ──
  {
    resetTestState();
    let html = '';
    const containerEl = {
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; },
      classList: { add: () => {}, remove: () => {} },
      querySelector: () => null,
      querySelectorAll: () => []
    };

    if (typeof global.document === 'undefined') {
      global.document = {
        createElement: (tag) => ({ tag, textContent: '', set innerHTML(v) {}, get innerHTML() { return this.textContent; } }),
        getElementById: () => null
      };
    }

    const origGetById = global.document.getElementById;
    global.document.getElementById = (id) => (id === 'consumption-container' ? containerEl : null);

    state.result = {
      mealResults: [{
        id: 'm1',
        name: 'Breakfast',
        items: [{
          id: 'chicken',
          name: 'Chicken',
          plannedQuantity: 124.6,
          quantity: 124.6,
          unit: 'g',
          servingSize: 100,
          calories: 205,
          protein: 38.6,
          carbs: 0,
          fat: 4.5
        }]
      }]
    };
    state.customFoods = [];
    state.ateSoFar = { chicken: 40.2 };
    state.ingredients = [];

    UI.renderConsumptionCard();

    const plannedMatch = html.match(/class="col-planned"[\s\S]*?>([\s\S]*?)<\/td>/);
    const remainingMatch = html.match(/class="col-remaining"[\s\S]*?>([\s\S]*?)<\/td>/);

    const plannedText = plannedMatch ? plannedMatch[1].trim() : '';
    const remainingText = remainingMatch ? remainingMatch[1].trim() : '';

    assert.strictEqual(plannedText, '125 g', 'Planned 124.6g must round to whole number 125 g (no tenths)');
    assert.strictEqual(remainingText, '84 g', 'Remaining 84.4g must round to whole number 84 g (no tenths)');

    // Dynamic row update in updateConsumptionDisplay
    const remTdEl = { innerHTML: '' };
    const rowEl = {
      classList: { toggle: () => {} },
      querySelector: (sel) => (sel === '.col-remaining' ? remTdEl : null)
    };
    containerEl.querySelector = (sel) => (sel.includes('chicken') ? rowEl : null);

    state.ateSoFar = { chicken: 50 };
    UI.updateConsumptionDisplay(containerEl);
    assert.strictEqual(remTdEl.innerHTML, '75 g', 'Dynamic update rounds 74.6g to whole number 75 g');

    global.document.getElementById = origGetById;
    console.log('[CS-10] Consolidated Consumption Whole Number Rounding: PASSED');
  }

  // ── TEST 11: Deterministic Meal-Order Distribution Across Items ──
  {
    resetTestState();
    const mealResults = [
      {
        id: 'meal_breakfast',
        name: 'Breakfast',
        items: [
          { id: 'ing_chicken', foodDefinitionId: 'ing_chicken', mealId: 'meal_breakfast', name: 'Chicken', plannedQuantity: 100, quantity: 100 }
        ]
      },
      {
        id: 'meal_lunch',
        name: 'Lunch',
        items: [
          { id: 'ing_chicken', foodDefinitionId: 'ing_chicken', mealId: 'meal_lunch', name: 'Chicken', plannedQuantity: 150, quantity: 150 }
        ]
      },
      {
        id: 'meal_dinner',
        name: 'Dinner',
        items: [
          { id: 'ing_chicken', foodDefinitionId: 'ing_chicken', mealId: 'meal_dinner', name: 'Chicken', plannedQuantity: 100, quantity: 100 }
        ]
      }
    ];

    const eatenItems = {};
    // Distribute 180g of chicken across 100g Breakfast, 150g Lunch, 100g Dinner:
    // Breakfast gets 100g (full -> isEaten: true)
    // Lunch gets 80g (partial -> isEaten: false)
    // Dinner gets 0g (uneaten -> isEaten: false)
    distributeConsolidatedEaten('ing_chicken', 180, mealResults, eatenItems);

    assert.strictEqual(eatenItems['meal_breakfast_ing_chicken']?.eatenQuantity, 100);
    assert.strictEqual(mealResults[0].items[0].isEaten, true);
    assert.strictEqual(mealResults[0].items[0].eatenQuantity, 100);

    assert.strictEqual(eatenItems['meal_lunch_ing_chicken']?.eatenQuantity, 80);
    assert.strictEqual(mealResults[1].items[0].isEaten, false);
    assert.strictEqual(mealResults[1].items[0].eatenQuantity, 80);

    assert.strictEqual(eatenItems['meal_dinner_ing_chicken'], undefined);
    assert.strictEqual(mealResults[2].items[0].isEaten, false);
    assert.strictEqual(mealResults[2].items[0].eatenQuantity, 0);

    console.log('[CS-11] Deterministic Meal-Order Distribution Invariants: PASSED');
  }

  // ── TEST 12: Consolidated Eaten Derivation from Item Source of Truth ──
  {
    resetTestState();
    const mealResults = [
      {
        id: 'meal_1',
        items: [{ id: 'ing_chicken', foodDefinitionId: 'ing_chicken', mealId: 'meal_1', plannedQuantity: 100 }]
      },
      {
        id: 'meal_2',
        items: [{ id: 'ing_chicken', foodDefinitionId: 'ing_chicken', mealId: 'meal_2', plannedQuantity: 150 }]
      }
    ];
    const eatenItems = {
      'meal_1_ing_chicken': { eatenQuantity: 100, plannedQuantity: 100 },
      'meal_2_ing_chicken': { eatenQuantity: 50, plannedQuantity: 150 }
    };

    const totalEaten = getConsolidatedEaten('ing_chicken', eatenItems, mealResults);
    assert.strictEqual(totalEaten, 150, 'Consolidated total must be exactly 100 + 50 = 150');

    console.log('[CS-12] Consolidated Eaten Derivation: PASSED');
  }

  // ── TEST 13: Apply Consolidated to Ingredients via Solver Method ──
  {
    resetTestState();
    state.result = {
      mealResults: [
        {
          id: 'meal_b',
          name: 'Breakfast',
          items: [{ id: 'ing_rice', foodDefinitionId: 'ing_rice', mealId: 'meal_b', name: 'Rice', plannedQuantity: 120, quantity: 120, servings: 1.2 }]
        },
        {
          id: 'meal_d',
          name: 'Dinner',
          items: [{ id: 'ing_rice', foodDefinitionId: 'ing_rice', mealId: 'meal_d', name: 'Rice', plannedQuantity: 80, quantity: 80, servings: 0.8 }]
        }
      ]
    };
    state.eatenItems = {};

    Optimization.applyConsolidatedToIngredients('ing_rice', 150);

    // Breakfast Rice: planned 120, allocated 120 -> isEaten = true
    const bRice = state.result.mealResults[0].items[0];
    assert.strictEqual(bRice.isEaten, true);
    assert.strictEqual(bRice.eatenQuantity, 120);

    // Dinner Rice: planned 80, allocated 30 -> isEaten = false
    const dRice = state.result.mealResults[1].items[0];
    assert.strictEqual(dRice.isEaten, false);
    assert.strictEqual(dRice.eatenQuantity, 30);

    // Consolidated aggregation reflects the 150g eaten
    const agg = aggregateIngredients(state.result, [], state.eatenItems, []);
    const riceAgg = agg.find(i => i.foodDefinitionId === 'ing_rice');
    assert.strictEqual(riceAgg.consolidatedEaten, 150);

    console.log('[CS-13] Optimization.applyConsolidatedToIngredients: PASSED');
  }

  // ── TEST 14: Nuclear Reset on unmarkAllIngredientsEaten ──
  {
    resetTestState();
    state.eatenItems = {
      'm1_ing_chicken': { eatenQuantity: 100, plannedQuantity: 100 }
    };
    state.ateSoFar = { ing_chicken: 100 };
    state.result = {
      mealResults: [
        {
          id: 'm1',
          items: [{ id: 'ing_chicken', isEaten: true, eatenQuantity: 100 }]
        }
      ]
    };

    Optimization.unmarkAllIngredientsEaten();

    assert.strictEqual(Object.keys(state.eatenItems).length, 0, 'eatenItems must be completely cleared');
    assert.strictEqual(Object.keys(state.ateSoFar).length, 0, 'ateSoFar must be completely cleared');
    assert.strictEqual(state.result.mealResults[0].items[0].isEaten, false);
    assert.strictEqual(state.result.mealResults[0].items[0].eatenQuantity, 0);

    console.log('[CS-14] Nuclear Reset on unmarkAllIngredientsEaten: PASSED');
  }

  // ── TEST 15: formatDailySummary includes Custom Foods in Copy Output ──
  {
    resetTestState();
    const result = {
      totals: { calories: 2000, protein: 140, carbs: 200, fat: 50 },
      deviations: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      mealResults: [
        {
          id: 'meal_1',
          name: 'Breakfast',
          pct: 50,
          calories: 1000,
          targetCalories: 1000,
          protein: 70,
          carbs: 100,
          fat: 25,
          items: [
            { name: 'Oats', quantity: 80, unit: 'g', servings: 2 }
          ]
        }
      ]
    };

    const customFoods = [
      {
        id: 'cf_1',
        name: 'Protein Shake',
        meal: 'meal_1',
        amount: 1,
        unit: 'serving',
        calories: 180,
        protein: 30,
        carbs: 5,
        fat: 2
      },
      {
        id: 'cf_2',
        name: 'Apple',
        meal: null, // unassigned
        amount: 1,
        unit: 'whole',
        calories: 95,
        protein: 0,
        carbs: 25,
        fat: 0
      }
    ];

    const text = formatDailySummary(result, DEFAULT_TARGETS, customFoods);
    assert.ok(text.includes('Custom · Protein Shake — 1 serving'), 'Assigned custom food must appear in meal section');
    assert.ok(text.includes('CUSTOM FOODS (UNASSIGNED)'), 'Unassigned section header must appear');
    assert.ok(text.includes('Custom · Apple — 1 whole'), 'Unassigned custom food must appear in unassigned section');

    console.log('[CS-15] formatDailySummary Includes Custom Foods: PASSED');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runConsumptionTestSuite();
}


