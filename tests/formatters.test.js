// ══════════════════════════════════════════
// FORMATTERS UNIT TESTS — Pure Daily Summary Tests
// ══════════════════════════════════════════

import { formatDailySummary } from '../src/core/formatters.js';

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
console.log(' RUNNING FORMATTERS & DAILY SUMMARY TEST SUITE                     ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ── TEST A: Basic Summary ──
{
  const mockTargets = {
    calories: 2335,
    protein: 151,
    carbs: 291,
    fat: 62
  };

  const mockResult = {
    totals: {
      calories: 2304,
      protein: 151.0,
      carbs: 291.0,
      fat: 58.1
    },
    deviations: {
      calories: { absolute: -31, percentage: -1.3 },
      protein: { absolute: 0.0, percentage: 0.0 },
      carbs: { absolute: 0.0, percentage: 0.0 },
      fat: { absolute: -3.9, percentage: -6.2 }
    },
    mealResults: [
      {
        name: 'Breakfast',
        items: [
          {
            name: 'Chicken',
            servings: 1.00,
            quantity: 100,
            unit: 'g',
            calories: 165,
            protein: 31,
            carbs: 0,
            fat: 3.6
          },
          {
            name: 'Yuca',
            servings: 1.50,
            quantity: 154.5,
            unit: 'g',
            calories: 270,
            protein: 4.5,
            carbs: 63,
            fat: 0
          }
        ]
      }
    ]
  };

  const text = formatDailySummary(mockResult, mockTargets);

  assert('Test A: Starts with DAILY SUMMARY header', text.startsWith('DAILY SUMMARY\n\n'));
  assert('Test A: Formats calories with actual, target, and negative deviation',
    text.includes('Calories: 2304 / 2335 kcal (-31 kcal, -1.3%)'), `Output:\n${text}`);
  assert('Test A: Formats protein with 1 decimal actual and zero deviation',
    text.includes('Protein: 151.0 / 151 g (0.0 g, 0.0%)'), `Output:\n${text}`);
  assert('Test A: Formats carbs with 1 decimal actual and zero deviation',
    text.includes('Carbs: 291.0 / 291 g (0.0 g, 0.0%)'), `Output:\n${text}`);
  assert('Test A: Formats fat with 1 decimal actual and negative deviation',
    text.includes('Fat: 58.1 / 62 g (-3.9 g, -6.2%)'), `Output:\n${text}`);
}

// ── TEST B: Negative, Positive, and Zero Deviations ──
{
  const targets = { calories: 2000, protein: 150, carbs: 200, fat: 50 };

  // Case 1: Positive deviations (actual > target)
  const posResult = {
    totals: { calories: 2050, protein: 155.0, carbs: 210.0, fat: 55.0 },
    mealResults: []
  };
  const posText = formatDailySummary(posResult, targets);
  assert('Test B: Positive calorie deviation has + sign',
    posText.includes('Calories: 2050 / 2000 kcal (+50 kcal, +2.5%)'), `Got:\n${posText}`);
  assert('Test B: Positive macro deviation has + sign',
    posText.includes('Protein: 155.0 / 150 g (+5.0 g, +3.3%)'), `Got:\n${posText}`);

  // Case 2: Exact target match (actual = target)
  const exactResult = {
    totals: { calories: 2000, protein: 150.0, carbs: 200.0, fat: 50.0 },
    mealResults: []
  };
  const exactText = formatDailySummary(exactResult, targets);
  assert('Test B: Zero calorie deviation has no sign prefix',
    exactText.includes('Calories: 2000 / 2000 kcal (0 kcal, 0.0%)'), `Got:\n${exactText}`);
  assert('Test B: Zero macro deviation has 0.0 g and 0.0%',
    exactText.includes('Protein: 150.0 / 150 g (0.0 g, 0.0%)'), `Got:\n${exactText}`);

  // Case 3: Negative deviations (actual < target)
  const negResult = {
    totals: { calories: 1950, protein: 145.0, carbs: 190.0, fat: 45.0 },
    mealResults: []
  };
  const negText = formatDailySummary(negResult, targets);
  assert('Test B: Negative calorie deviation has - sign',
    negText.includes('Calories: 1950 / 2000 kcal (-50 kcal, -2.5%)'), `Got:\n${negText}`);
  assert('Test B: Negative macro deviation has - sign',
    negText.includes('Fat: 45.0 / 50 g (-5.0 g, -10.0%)'), `Got:\n${negText}`);
}

// ── TEST C: Meal Ordering ──
{
  const mockResult = {
    totals: { calories: 2000, protein: 150, carbs: 200, fat: 50 },
    mealResults: [
      { name: 'Breakfast', items: [{ name: 'Eggs', servings: 2, quantity: 100, unit: 'g', calories: 144, protein: 12.6, carbs: 0.8, fat: 9.6 }] },
      { name: 'Lunch', items: [{ name: 'Chicken', servings: 1, quantity: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6 }] },
      { name: 'Snack', items: [{ name: 'Whole Milk', servings: 1, quantity: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8 }] },
      { name: 'Dinner', items: [{ name: 'Tuna', servings: 1.5, quantity: 150, unit: 'g', calories: 195, protein: 42, carbs: 0, fat: 1.5 }] }
    ]
  };

  const text = formatDailySummary(mockResult, { calories: 2000, protein: 150, carbs: 200, fat: 50 });
  const breakfastIdx = text.indexOf('BREAKFAST');
  const lunchIdx = text.indexOf('LUNCH');
  const snackIdx = text.indexOf('SNACK');
  const dinnerIdx = text.indexOf('DINNER');

  assert('Test C: All meal headers present in uppercase',
    breakfastIdx !== -1 && lunchIdx !== -1 && snackIdx !== -1 && dinnerIdx !== -1);
  assert('Test C: Meals preserve exact order',
    breakfastIdx < lunchIdx && lunchIdx < snackIdx && snackIdx < dinnerIdx);
}

// ── TEST D: Ingredient Formatting & Precision ──
{
  const mockResult = {
    totals: { calories: 1000, protein: 50, carbs: 100, fat: 20 },
    mealResults: [
      {
        name: 'Breakfast',
        items: [
          {
            name: 'Chicken',
            servings: 1.00,
            quantity: 100,
            unit: 'g',
            calories: 165,
            protein: 31,
            carbs: 0,
            fat: 3.6
          },
          {
            name: 'Yuca',
            servings: 1.50,
            quantity: 154.5,
            unit: 'g',
            calories: 270,
            protein: 4.5,
            carbs: 63,
            fat: 0
          },
          {
            name: 'Whole Milk',
            servings: 0.50,
            quantity: 120,
            unit: 'mL',
            calories: 75,
            protein: 4,
            carbs: 6,
            fat: 4
          }
        ]
      }
    ]
  };

  const text = formatDailySummary(mockResult, { calories: 1000, protein: 50, carbs: 100, fat: 20 });

  assert('Test D: 1.00 serving singular format',
    text.includes('Chicken — 1.00 serving (100 g) — 165 kcal — 31P / 0C / 3.6F'), `Got:\n${text}`);
  assert('Test D: 1.50 servings plural format with decimal quantity and macros',
    text.includes('Yuca — 1.50 servings (154.5 g) — 270 kcal — 4.5P / 63C / 0F'), `Got:\n${text}`);
  assert('Test D: 0.50 servings plural format with mL unit',
    text.includes('Whole Milk — 0.50 servings (120 mL) — 75 kcal — 4P / 6C / 4F'), `Got:\n${text}`);
}

// ── TEST E: Actual / EATEN Quantities ──
{
  // Scenario 1: Item where planned = 2.00 serv (200 g), actual = 1.30 serv (130 g)
  const actualItem = {
    name: 'Chicken',
    plannedQuantity: 200,
    actualQuantity: 130,
    quantity: 130,
    servings: 1.30,
    unit: 'g',
    calories: 214.5, // 1.3 * 165
    protein: 40.3,   // 1.3 * 31
    carbs: 0,        // 1.3 * 0
    fat: 4.68,       // 1.3 * 3.6
    isActual: true,
    isEaten: false
  };

  const mockResult = {
    totals: { calories: 215, protein: 40.3, carbs: 0, fat: 4.7 },
    mealResults: [
      {
        name: 'Lunch',
        items: [actualItem]
      }
    ]
  };

  const text = formatDailySummary(mockResult, { calories: 215, protein: 40, carbs: 0, fat: 5 });

  assert('Test E: Formatter outputs actual quantity (130 g) and actual servings (1.30 servings)',
    text.includes('Chicken — 1.30 servings (130 g) — 215 kcal — 40.3P / 0C / 4.7F'), `Got:\n${text}`);
  assert('Test E: Formatter does not mention planned quantity in plain-text output',
    !text.includes('200 g') && !text.includes('2.00 serving'));

  // Scenario 2: Item where planned == actual (2.00 serv, 200 g)
  const exactItem = {
    name: 'Chicken',
    plannedQuantity: 200,
    actualQuantity: 200,
    quantity: 200,
    servings: 2.00,
    unit: 'g',
    calories: 330,
    protein: 62,
    carbs: 0,
    fat: 7.2,
    isActual: true,
    isEaten: true
  };

  const exactResult = {
    totals: { calories: 330, protein: 62, carbs: 0, fat: 7.2 },
    mealResults: [{ name: 'Dinner', items: [exactItem] }]
  };

  const exactText = formatDailySummary(exactResult, { calories: 330, protein: 62, carbs: 0, fat: 7 });
  assert('Test E: Planned equals actual formatted consistently',
    exactText.includes('Chicken — 2.00 servings (200 g) — 330 kcal — 62P / 0C / 7.2F'), `Got:\n${exactText}`);
}

// ── TEST F: Empty Meal / Zero-Result Edge Cases ──
{
  assert('Test F: Null result returns empty string', formatDailySummary(null) === '');
  assert('Test F: Undefined result returns empty string', formatDailySummary(undefined) === '');
  assert('Test F: Empty object result returns summary header without crashing',
    formatDailySummary({}).includes('DAILY SUMMARY'));

  const emptyMealResult = {
    totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    mealResults: [
      { name: 'Breakfast', items: [] },
      { name: 'Lunch', items: null }
    ]
  };

  const emptyText = formatDailySummary(emptyMealResult, { calories: 2000, protein: 150, carbs: 200, fat: 50 });
  assert('Test F: Empty meal results render meal headers without throwing',
    emptyText.includes('BREAKFAST') && emptyText.includes('LUNCH'));
}

console.log('\n═══════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(' ALL FORMATTERS TESTS PASSED (0 failures)                         ');
} else {
  console.error(` FORMATTERS TESTS FAILED (${failed} failures)                     `);
  process.exitCode = 1;
}
console.log('═══════════════════════════════════════════════════════════════════\n');

export function runFormattersTests() {
  return failed === 0;
}
