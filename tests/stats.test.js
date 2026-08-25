// ══════════════════════════════════════════
// STATS UNIT TESTS — Pure Math & Data Invariants
// ══════════════════════════════════════════

import {
  parseDateToMs,
  formatDateStr,
  getLocalDateString,
  getWeightObservations,
  getIntakeObservations,
  calculateCurrentWeight,
  calculateMovingAverage,
  calculateWeightChange,
  calculateWeightTrend,
  calculateAverageIntake,
  getCombinedHistoryRows
} from '../src/core/stats.js';

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
console.log(' RUNNING STATS & LONGITUDINAL CALCULATION TEST SUITE               ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ── TEST 1: Date Parsing and Ordering ──
{
  const ms1 = parseDateToMs('2026-08-20');
  const ms2 = parseDateToMs('2026-08-25');
  assert('Date parsing to UTC ms', !isNaN(ms1) && !isNaN(ms2));
  assert('Date ordering', ms2 > ms1);
  assert('Format date string roundtrip', formatDateStr(ms1) === '2026-08-20');
}

// ── TEST 2: Current Weight & Moving Averages (With Missing Days) ──
{
  const weightHistory = {
    '2026-08-20': { weight: 187.0 },
    '2026-08-21': { weight: 186.5 },
    // 2026-08-22 missing
    '2026-08-23': { weight: 185.8 },
    '2026-08-24': { weight: 185.4 },
    '2026-08-25': { weight: 184.3 }
  };

  const cur = calculateCurrentWeight(weightHistory, '2026-08-25');
  assert('Current weight matches latest on reference date', cur === 184.3);

  // 7-day average from Aug 19 to Aug 25 (includes all 5 recorded days)
  // Sum = 187.0 + 186.5 + 185.8 + 185.4 + 184.3 = 929.0
  // Mean = 929.0 / 5 = 185.8
  const avg7 = calculateMovingAverage(weightHistory, 7, '2026-08-25');
  assert('7-day average computes actual observations mean without interpolation', Math.abs(avg7 - 185.8) < 0.001, `Got ${avg7}`);

  // Weight change over 7 days: 184.3 - 187.0 = -2.7
  const change = calculateWeightChange(weightHistory, 7, '2026-08-25');
  assert('Weight change computes window delta', Math.abs(change - (-2.7)) < 0.001, `Got ${change}`);
}

// ── TEST 3: Insufficient Data / Missing Data Handling ──
{
  const emptyHistory = {};
  assert('Empty history current weight is null', calculateCurrentWeight(emptyHistory) === null);
  assert('Empty history moving average is null', calculateMovingAverage(emptyHistory, 7) === null);
  assert('Empty history trend is null', calculateWeightTrend(emptyHistory) === null);
  assert('Single day history trend is null (requires min 3 days)', calculateWeightTrend({ '2026-08-25': { weight: 184.3 } }) === null);
  assert('Two days history trend is null when minObservations=3', calculateWeightTrend({ '2026-08-24': { weight: 185.0 }, '2026-08-25': { weight: 184.3 } }, { minObservations: 3 }) === null);
}

// ── TEST 4: OLS Regression Rate with Calendar Elapsed Time ──
{
  // 3 measurements over 7 calendar days:
  // Aug 18 (t=0): 186.0
  // Aug 21 (t=3): 185.0
  // Aug 25 (t=7): 183.9
  // OLS slope beta1 should account for t in [0, 3, 7]
  const history = {
    '2026-08-18': { weight: 186.0 },
    '2026-08-21': { weight: 185.0 },
    '2026-08-25': { weight: 183.9 }
  };

  const rate = calculateWeightTrend(history, { windowDays: 14, minObservations: 3, referenceDate: '2026-08-25' });
  assert('OLS rate is a valid number', typeof rate === 'number' && !isNaN(rate));
  // Rate should be negative (~ -2.1 lb/week)
  assert('OLS rate indicates weight loss', rate < 0, `Got rate: ${rate}`);
}

// ── TEST 5: Average Daily Intake ──
{
  const intakeHistory = {
    '2026-08-24': {
      date: '2026-08-24',
      totals: { calories: 2400, protein: 160, carbs: 280, fat: 60 }
    },
    '2026-08-25': {
      date: '2026-08-25',
      totals: { calories: 2300, protein: 150, carbs: 290, fat: 58 }
    }
  };

  const avgIntake = calculateAverageIntake(intakeHistory, 7, '2026-08-25');
  assert('Intake averages count matches', avgIntake.count === 2);
  assert('Average calories correct', avgIntake.calories === 2350);
  assert('Average protein correct', avgIntake.protein === 155);
}

// ── TEST 6: Combined Outer Join Rows (Weight ∪ Intake) ──
{
  const weightHistory = {
    '2026-08-25': { weight: 184.3 },
    '2026-08-24': { weight: 185.0 }
    // 2026-08-23 has no weight
  };

  const intakeHistory = {
    '2026-08-25': { date: '2026-08-25', totals: { calories: 2335, protein: 151, carbs: 291, fat: 62 } },
    '2026-08-23': { date: '2026-08-23', totals: { calories: 2290, protein: 148, carbs: 285, fat: 60 } }
    // 2026-08-24 has no intake snapshot
  };

  const rows = getCombinedHistoryRows(weightHistory, intakeHistory);
  assert('Outer join produces 3 total dates', rows.length === 3);
  assert('Rows are sorted descending by date', rows[0].date === '2026-08-25' && rows[1].date === '2026-08-24' && rows[2].date === '2026-08-23');

  // Aug 25: has both
  assert('Aug 25 has both weight and intake', rows[0].hasWeight && rows[0].hasIntake && rows[0].weight === 184.3 && rows[0].calories === 2335);

  // Aug 24: has weight only
  assert('Aug 24 has weight only', rows[1].hasWeight && !rows[1].hasIntake && rows[1].weight === 185.0 && rows[1].calories === null);

  // Aug 23: has intake only
  assert('Aug 23 has intake only', !rows[2].hasWeight && rows[2].hasIntake && rows[2].weight === null && rows[2].calories === 2290);
}

console.log(`\nStats Tests Completed: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
if (failed > 0) process.exit(1);
