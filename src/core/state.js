// ══════════════════════════════════════════
// STATE — application data model
// ══════════════════════════════════════════

export const STORAGE_KEY = 'macroSolver_ingredients';
export const SETTINGS_KEY = 'macroSolver_settings';

export const DEFAULT_INGREDIENTS = [
  { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
  { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, quantityMode: 'continuous', availability: 'normal' },
  { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, quantityMode: 'continuous', availability: 'normal' }
];

export const state = {
  targets: { calories: 2335, protein: 151, carbs: 291, fat: 62 },
  meals: [
    { name: 'Breakfast', pct: 40 },
    { name: 'Lunch', pct: 20 },
    { name: 'Dinner', pct: 40 }
  ],
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
    availabilityOut: 0.002
  },
  result: null
};
