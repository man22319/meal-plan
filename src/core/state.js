// ══════════════════════════════════════════
// STATE — application data model
// ══════════════════════════════════════════

export const STORAGE_KEY = 'macroSolver_ingredients';
export const SETTINGS_KEY = 'macroSolver_settings';
export const TARGETS_KEY = 'macroSolver_targets';
export const MEALS_KEY = 'macroSolver_meals';
export const RESULT_KEY = 'macroSolver_result';
export const WEIGHT_KEY = 'macroSolver_weights';
export const INTAKE_KEY = 'macroSolver_intake';
export const CUSTOM_FOODS_KEY = 'macroSolver_customFoods';
export const CONSUMPTION_KEY = 'macroSolver_ateSoFar';

export function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).substring(2, 8)}_${Date.now().toString(36)}`;
}

export function ensureId(item, prefix = 'id') {
  if (!item.id || typeof item.id !== 'string') {
    item.id = generateId(prefix);
  }
  return item.id;
}

export const AVAILABILITY_STATES = Object.freeze(['normal', 'low', 'limited', 'out']);

export function resolveAvailability(value) {
  return AVAILABILITY_STATES.includes(value) ? value : 'normal';
}

export const DEFAULT_TARGETS = { calories: 2335, protein: 151, carbs: 291, fat: 62 };
export const DEFAULT_MEALS = [
  { id: 'meal_breakfast', name: 'Breakfast', pct: 40 },
  { id: 'meal_lunch', name: 'Lunch', pct: 20 },
  { id: 'meal_dinner', name: 'Dinner', pct: 40 }
];

export const DEFAULT_INGREDIENTS = [
  { id: 'ing_chicken', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
  { id: 'ing_yuca', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
  { id: 'ing_milk', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous', availability: 'normal' }
];

export const state = {
  targets: JSON.parse(JSON.stringify(DEFAULT_TARGETS)),
  meals: JSON.parse(JSON.stringify(DEFAULT_MEALS)),
  ingredients: JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS)),
  mealConstraints: {
    minIngredients: 1,
    maxIngredients: 4
  },
  weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2, macroReconciliation: 0.5 },
  penalties: {
    simplicity: 0.0005,
    quantity: 0.00001,
    boundaryExcess: 0.002,
    availabilityLow: 0.0005,
    availabilityLimited: 0.002
  },
  actuals: {},
  eatenItems: {},
  weightHistory: {},
  intakeHistory: {},
  customFoods: [],
  ateSoFar: {},
  result: null
};

export function copyMeal(sourceMealId, customState = state) {
  const s = customState || state;
  const meals = s.meals || [];
  const sourceMeal = meals.find(m => m.id === sourceMealId || m.name === sourceMealId);
  if (!sourceMeal) {
    return { error: `Source meal "${sourceMealId}" not found.` };
  }
  if (meals.length >= 6) {
    return { error: 'Maximum limit of 6 meals reached.' };
  }

  const newMealId = generateId('meal');
  const newMeal = {
    id: newMealId,
    name: `${sourceMeal.name} (Copy)`,
    pct: 0
  };
  meals.push(newMeal);

  // Duplicate custom food occurrences, preserving canonical foodDefinitionId
  if (Array.isArray(s.customFoods)) {
    const assignedCustom = s.customFoods.filter(cf => cf.meal === sourceMeal.id || cf.meal === sourceMeal.name);
    assignedCustom.forEach(cf => {
      const canonicalFoodDefId = cf.foodDefinitionId || cf.id;
      const copyCf = {
        ...JSON.parse(JSON.stringify(cf)),
        id: generateId('cf'),
        foodDefinitionId: canonicalFoodDefId,
        meal: newMealId,
        custom: true
      };
      s.customFoods.push(copyCf);
    });
  }

  // Duplicate actuals and meal result item locks
  if (!s.actuals) s.actuals = {};

  // Copy existing actual records for this meal
  Object.keys(s.actuals).forEach(key => {
    if (key.startsWith(`${sourceMeal.id}_`)) {
      const ingId = key.substring(`${sourceMeal.id}_`.length);
      s.actuals[`${newMealId}_${ingId}`] = JSON.parse(JSON.stringify(s.actuals[key]));
    } else if (sourceMeal.name && key.startsWith(`${sourceMeal.name}_`)) {
      const ingId = key.substring(`${sourceMeal.name}_`.length);
      s.actuals[`${newMealId}_${ingId}`] = JSON.parse(JSON.stringify(s.actuals[key]));
    }
  });

  // If solver results exist, lock items into actuals for the new meal so it reproduces identically
  if (s.result?.mealResults) {
    const resMeal = s.result.mealResults.find(m => m.id === sourceMeal.id || m.name === sourceMeal.name);
    if (resMeal && Array.isArray(resMeal.items)) {
      resMeal.items.forEach(it => {
        const itemFoodId = it.foodDefinitionId || it.id;
        const actualKey = `${newMealId}_${itemFoodId}`;
        if (!s.actuals[actualKey]) {
          const qty = it.isActual ? it.actualQuantity : (it.quantity ?? it.plannedQuantity);
          s.actuals[actualKey] = {
            actualQuantity: qty,
            plannedQuantityAtRecord: it.plannedQuantity ?? qty,
            isActual: true
          };
        }
      });
    }
  }

  return { meal: newMeal, newMealId };
}

export function canonicalizeValue(val) {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }
  const sortedKeys = Object.keys(val).sort();
  const res = {};
  for (const k of sortedKeys) {
    if (typeof val[k] !== 'undefined') {
      res[k] = canonicalizeValue(val[k]);
    }
  }
  return res;
}

export function canonicalJsonStringify(obj) {
  return JSON.stringify(canonicalizeValue(obj));
}

function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateStateFingerprint(customState = state) {
  const s = customState || state;
  const canonicalPayload = {
    targets: s.targets || {},
    meals: (s.meals || []).map(m => ({ id: m.id, name: m.name, pct: m.pct })),
    ingredients: (s.ingredients || []).map(i => ({
      id: i.id,
      name: i.name,
      servingSize: i.servingSize,
      unit: i.unit,
      calories: i.calories,
      protein: i.protein,
      carbs: i.carbs,
      fat: i.fat,
      minServings: i.minServings,
      maxServings: i.maxServings,
      quantityMode: i.quantityMode,
      availability: i.availability,
      preferredServings: i.preferredServings
    })),
    mealConstraints: s.mealConstraints || {},
    weights: s.weights || {},
    penalties: s.penalties || {},
    actuals: s.actuals || {},
    eatenItems: s.eatenItems || {},
    customFoods: (s.customFoods || []).map(cf => ({
      id: cf.id,
      name: cf.name,
      amount: cf.amount,
      unit: cf.unit,
      calories: cf.calories,
      protein: cf.protein,
      carbs: cf.carbs,
      fat: cf.fat,
      confidence: cf.confidence,
      meal: cf.meal
    }))
  };

  const canonicalString = canonicalJsonStringify(canonicalPayload);
  return `fp_${fnv1a32(canonicalString)}`;
}


