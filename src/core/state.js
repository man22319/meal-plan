// ══════════════════════════════════════════
// STATE — application data model
// ══════════════════════════════════════════

export const STORAGE_KEY = 'macroSolver_ingredients';
export const SETTINGS_KEY = 'macroSolver_settings';
export const TARGETS_KEY = 'macroSolver_targets';
export const MEALS_KEY = 'macroSolver_meals';
export const RESULT_KEY = 'macroSolver_result';

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
  weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 },
  penalties: {
    simplicity: 0.0005,
    quantity: 0.00001,
    boundaryExcess: 0.002,
    availabilityLow: 0.0005,
    availabilityLimited: 0.002
  },
  actuals: {},
  eatenItems: {},
  result: null
};

