// ══════════════════════════════════════════
// CONSUMPTION — Derived consumption state & ingredient aggregation
// ══════════════════════════════════════════
// Pure module. No DOM dependencies.
// Decoupled from MILP solver state.
// Aggregation groups identical food definitions across meals.
// Consumption derives non-negative remaining quantities and canonical remaining macros.

import { generateId } from './state.js';

/**
 * Duplicates a meal item instance while preserving its food definition
 * and complete nutritional macro attributes.
 *
 * @param {Object} item - Original meal item or custom food
 * @returns {Object} Duplicated meal item instance
 */
export function duplicateMealItem(item) {
  if (!item || typeof item !== 'object') return null;

  const foodDefinitionId = item.foodDefinitionId || item.id;
  const servingSize = (typeof item.servingSize === 'number' && item.servingSize > 0)
    ? item.servingSize
    : (typeof item.amount === 'number' && item.amount > 0 ? item.amount : 100);

  const servings = typeof item.servings === 'number' ? item.servings : 1;

  const caloriesPerServing = item.caloriesPerServing ?? (item.calories !== undefined && item.calories !== null ? (item.calories / servings) : 0);
  const proteinPerServing = item.proteinPerServing ?? (item.protein !== undefined && item.protein !== null ? (item.protein / servings) : 0);
  const carbsPerServing = item.carbsPerServing ?? (item.carbs !== undefined && item.carbs !== null ? (item.carbs / servings) : 0);
  const fatPerServing = item.fatPerServing ?? (item.fat !== undefined && item.fat !== null ? (item.fat / servings) : 0);

  return {
    mealItemId: generateId('item'),
    foodDefinitionId,
    id: foodDefinitionId,
    name: item.name,
    unit: item.unit || 'g',
    servingSize,
    servings,
    quantity: item.quantity ?? (servings * servingSize),
    plannedQuantity: item.plannedQuantity ?? item.quantity ?? (servings * servingSize),
    calories: item.calories ?? (caloriesPerServing * servings),
    protein: item.protein ?? (proteinPerServing * servings),
    carbs: item.carbs ?? (carbsPerServing * servings),
    fat: item.fat ?? (fatPerServing * servings),
    caloriesPerServing,
    proteinPerServing,
    carbsPerServing,
    fatPerServing,
    custom: Boolean(item.custom),
    quantityMode: item.quantityMode || 'continuous',
    minServings: item.minServings,
    maxServings: item.maxServings
  };
}

/**
 * Derives canonical per-unit nutrient density d_i = nutrientPerServing / servingSize.
 *
 * @param {Object} item
 * @returns {{ caloriesPerUnit: number, proteinPerUnit: number, carbsPerUnit: number, fatPerUnit: number }}
 */
export function getCanonicalNutrientDensity(item) {
  const servingSize = (typeof item.servingSize === 'number' && item.servingSize > 0)
    ? item.servingSize
    : 100;

  const calPerServing = typeof item.caloriesPerServing === 'number'
    ? item.caloriesPerServing
    : (typeof item.calories === 'number' ? item.calories : 0);

  const proPerServing = typeof item.proteinPerServing === 'number'
    ? item.proteinPerServing
    : (typeof item.protein === 'number' ? item.protein : 0);

  const carbPerServing = typeof item.carbsPerServing === 'number'
    ? item.carbsPerServing
    : (typeof item.carbs === 'number' ? item.carbs : 0);

  const fatPerServing = typeof item.fatPerServing === 'number'
    ? item.fatPerServing
    : (typeof item.fat === 'number' ? item.fat : 0);

  return {
    caloriesPerUnit: calPerServing / servingSize,
    proteinPerUnit: proPerServing / servingSize,
    carbsPerUnit: carbPerServing / servingSize,
    fatPerUnit: fatPerServing / servingSize
  };
}

/**
 * Groups identical ingredients across meals by stable foodDefinitionId.
 *
 * @param {Object} solverResult - State result containing mealResults
 * @param {Array} customFoods - Optional custom food entries from state
 * @param {Object} ateSoFar - Optional historical eaten amounts { [foodDefinitionId]: amount }
 * @param {Array} knownIngredients - Optional ingredients database for metadata lookup
 * @returns {Array} List of consolidated food objects
 */
export function aggregateIngredients(solverResult, customFoods = [], ateSoFar = {}, knownIngredients = []) {
  const groups = new Map();

  // 1. Group solver-allocated meal items
  if (solverResult && Array.isArray(solverResult.mealResults)) {
    solverResult.mealResults.forEach(meal => {
      if (Array.isArray(meal.items)) {
        meal.items.forEach(item => {
          const foodDefId = item.foodDefinitionId || item.id;
          if (!foodDefId) return;

          let group = groups.get(foodDefId);
          if (!group) {
            const servingSize = (typeof item.servingSize === 'number' && item.servingSize > 0)
              ? item.servingSize
              : 100;

            const calPerServing = item.caloriesPerServing ?? (item.calories !== undefined && item.servings ? item.calories / item.servings : (item.calories ?? 0));
            const proPerServing = item.proteinPerServing ?? (item.protein !== undefined && item.servings ? item.protein / item.servings : (item.protein ?? 0));
            const carbPerServing = item.carbsPerServing ?? (item.carbs !== undefined && item.servings ? item.carbs / item.servings : (item.carbs ?? 0));
            const fatPerServing = item.fatPerServing ?? (item.fat !== undefined && item.servings ? item.fat / item.servings : (item.fat ?? 0));

            group = {
              foodDefinitionId: foodDefId,
              name: item.name,
              unit: item.unit || 'g',
              servingSize,
              caloriesPerServing: calPerServing,
              proteinPerServing: proPerServing,
              carbsPerServing: carbPerServing,
              fatPerServing: fatPerServing,
              custom: Boolean(item.custom),
              plannedAmount: 0,
              totalServings: 0,
              meals: []
            };
            groups.set(foodDefId, group);
          }

          const qty = item.plannedQuantity ?? item.quantity ?? 0;
          const serv = item.servings ?? (group.servingSize > 0 ? qty / group.servingSize : 0);

          group.plannedAmount += qty;
          group.totalServings += serv;
          group.meals.push({
            mealId: meal.id,
            mealName: meal.name,
            amount: qty,
            servings: serv,
            unit: item.unit || group.unit
          });
        });
      }
    });
  }

  // 2. Group custom foods
  if (Array.isArray(customFoods)) {
    customFoods.forEach(cf => {
      const foodDefId = cf.foodDefinitionId || cf.id;
      if (!foodDefId) return;

      let group = groups.get(foodDefId);
      if (!group) {
        const amount = typeof cf.amount === 'number' && cf.amount > 0 ? cf.amount : 1;
        const cal = typeof cf.calories === 'number' ? cf.calories : 0;
        const pro = typeof cf.protein === 'number' ? cf.protein : 0;
        const carb = typeof cf.carbs === 'number' ? cf.carbs : 0;
        const fat = typeof cf.fat === 'number' ? cf.fat : 0;

        group = {
          foodDefinitionId: foodDefId,
          name: cf.name,
          unit: cf.unit || 'serving',
          servingSize: amount,
          caloriesPerServing: cal,
          proteinPerServing: pro,
          carbsPerServing: carb,
          fatPerServing: fat,
          custom: true,
          plannedAmount: 0,
          totalServings: 0,
          meals: []
        };
        groups.set(foodDefId, group);
      }

      const qty = typeof cf.amount === 'number' ? cf.amount : 1;
      group.plannedAmount += qty;
      group.totalServings += (group.servingSize > 0 ? qty / group.servingSize : 1);
      group.meals.push({
        mealId: cf.meal || null,
        mealName: cf.meal || 'Custom Food',
        amount: qty,
        servings: group.servingSize > 0 ? qty / group.servingSize : 1,
        unit: cf.unit || group.unit
      });
    });
  }

  // 3. Preserve unplanned items that were eaten (P = 0, E > 0)
  if (ateSoFar && typeof ateSoFar === 'object') {
    Object.keys(ateSoFar).forEach(foodDefId => {
      const eatenVal = Number(ateSoFar[foodDefId]);
      if (eatenVal > 0 && !groups.has(foodDefId)) {
        // Look up known ingredients or custom foods for definition metadata
        const known = Array.isArray(knownIngredients)
          ? knownIngredients.find(i => i.id === foodDefId || i.name === foodDefId)
          : null;

        const servingSize = known?.servingSize || 100;
        const calPerServing = known?.calories || 0;
        const proPerServing = known?.protein || 0;
        const carbPerServing = known?.carbs || 0;
        const fatPerServing = known?.fat || 0;

        groups.set(foodDefId, {
          foodDefinitionId: foodDefId,
          name: known?.name || foodDefId,
          unit: known?.unit || 'g',
          servingSize,
          caloriesPerServing: calPerServing,
          proteinPerServing: proPerServing,
          carbsPerServing: carbPerServing,
          fatPerServing: fatPerServing,
          custom: Boolean(known?.custom),
          plannedAmount: 0,
          totalServings: 0,
          meals: [],
          unplanned: true
        });
      }
    });
  }

  // Calculate canonical densities for all groups
  return Array.from(groups.values()).map(group => {
    const density = getCanonicalNutrientDensity(group);
    return {
      ...group,
      density
    };
  });
}

/**
 * Calculates consumption state, remaining quantities, and remaining macros
 * from aggregated foods and eaten amounts.
 *
 * Enforces core invariants:
 *  - R_i = max(0, P_i - E_i)
 *  - E_i >= 0
 *  - P_i >= 0
 *  - R_i <= P_i
 *  - N_remaining,i = d_i * R_i (using canonical nutrient density)
 *
 * @param {Array} aggregatedFoods - Output of aggregateIngredients
 * @param {Object} ateSoFar - Object mapping foodDefinitionId -> amount eaten
 * @returns {Object} Consumption state with items and daily remaining totals
 */
export function calculateConsumption(aggregatedFoods = [], ateSoFar = {}) {
  const items = [];
  const remainingTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const eatenTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const plannedTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

  aggregatedFoods.forEach(food => {
    const rawEaten = Number(ateSoFar[food.foodDefinitionId]);
    const eaten = (!isNaN(rawEaten) && rawEaten > 0) ? rawEaten : 0;
    const planned = Math.max(0, food.plannedAmount);
    const remaining = Math.max(0, planned - eaten);

    const d = food.density;

    // Remaining macros from canonical density
    const remCal = d.caloriesPerUnit * remaining;
    const remPro = d.proteinPerUnit * remaining;
    const remCarb = d.carbsPerUnit * remaining;
    const remFat = d.fatPerUnit * remaining;

    // Eaten macros from canonical density
    const eatCal = d.caloriesPerUnit * eaten;
    const eatPro = d.proteinPerUnit * eaten;
    const eatCarb = d.carbsPerUnit * eaten;
    const eatFat = d.fatPerUnit * eaten;

    // Planned macros from canonical density
    const planCal = d.caloriesPerUnit * planned;
    const planPro = d.proteinPerUnit * planned;
    const planCarb = d.carbsPerUnit * planned;
    const planFat = d.fatPerUnit * planned;

    remainingTotals.calories += remCal;
    remainingTotals.protein += remPro;
    remainingTotals.carbs += remCarb;
    remainingTotals.fat += remFat;

    eatenTotals.calories += eatCal;
    eatenTotals.protein += eatPro;
    eatenTotals.carbs += eatCarb;
    eatenTotals.fat += eatFat;

    plannedTotals.calories += planCal;
    plannedTotals.protein += planPro;
    plannedTotals.carbs += planCarb;
    plannedTotals.fat += planFat;

    items.push({
      foodDefinitionId: food.foodDefinitionId,
      name: food.name,
      unit: food.unit,
      servingSize: food.servingSize,
      caloriesPerServing: food.caloriesPerServing,
      proteinPerServing: food.proteinPerServing,
      carbsPerServing: food.carbsPerServing,
      fatPerServing: food.fatPerServing,
      density: food.density,
      custom: food.custom,
      unplanned: Boolean(food.unplanned),
      meals: food.meals,
      plannedAmount: planned,
      totalServings: food.totalServings,
      eatenAmount: eaten,
      remainingAmount: remaining,
      remainingMacros: {
        calories: remCal,
        protein: remPro,
        carbs: remCarb,
        fat: remFat
      },
      eatenMacros: {
        calories: eatCal,
        protein: eatPro,
        carbs: eatCarb,
        fat: eatFat
      },
      plannedMacros: {
        calories: planCal,
        protein: planPro,
        carbs: planCarb,
        fat: planFat
      }
    });
  });

  return {
    items,
    remainingTotals,
    eatenTotals,
    plannedTotals
  };
}
