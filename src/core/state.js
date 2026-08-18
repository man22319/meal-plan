// ══════════════════════════════════════════
// STATE — application data model
// ══════════════════════════════════════════

export const STORAGE_KEY = 'macroSolver_ingredients';

export const state = {
  targets: { calories: 2335, protein: 151, carbs: 291, fat: 62 },
  meals: [
    { name: 'Breakfast', pct: 40 },
    { name: 'Lunch', pct: 20 },
    { name: 'Dinner', pct: 40 }
  ],
  ingredients: [
    { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0 },
    { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8 }
  ],
  weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 1.0 },
  result: null
};

export const DEFAULT_INGREDIENTS = [
  { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0 },
  { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8 }
];
