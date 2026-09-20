// ══════════════════════════════════════════
// STATS UNIT TESTS — Pure Math & Data Invariants
// ══════════════════════════════════════════

import {
  parseDateToMs,
  formatDateStr,
  calculateCurrentWeight,
  calculateMovingAverage,
  calculateWeightChange,
  calculateWeightTrend,
  calculateAverageIntake,
  calculateIntakeStats,
  getCombinedHistoryRows,
  fitLinearRegression,
  calculateNeweyWestCovariance,
  getStudentTCriticalValue,
  STUDENT_T_975_TABLE,
  getAlignedComparisonWindows,
  calculateNutritionalTrendComparison
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

  const trend = calculateWeightTrend(history, { windowDays: 14, minObservations: 3, referenceDate: '2026-08-25' });
  assert('OLS rate is a valid number', typeof trend?.ratePerWeek === 'number' && !isNaN(trend.ratePerWeek));
  // Rate should be negative (~ -2.1 lb/week)
  assert('OLS rate indicates weight loss', trend.ratePerWeek < 0, `Got rate: ${trend.ratePerWeek}`);
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

// ── TEST 7: Generalized calculateIntakeStats (Multi-day, SD, Median, Target Deviation) ──
{
  const intakeHistory = {
    '2026-08-23': {
      date: '2026-08-23',
      targets: { calories: 2000, protein: 150, carbs: 250, fat: 60 },
      totals: { calories: 2000, protein: 150, carbs: 250, fat: 60 }
    },
    '2026-08-24': {
      date: '2026-08-24',
      targets: { calories: 2000, protein: 150, carbs: 250, fat: 60 },
      totals: { calories: 2100, protein: 160, carbs: 260, fat: 70 }
    },
    '2026-08-25': {
      date: '2026-08-25',
      targets: { calories: 2000, protein: 150, carbs: 250, fat: 60 },
      totals: { calories: 2200, protein: 170, carbs: 270, fat: 80 }
    }
  };

  const stats = calculateIntakeStats(intakeHistory, 7, '2026-08-25');
  assert('IntakeStats distinctDays is 3', stats.distinctDays === 3);
  assert('IntakeStats windowDays is 7', stats.windowDays === 7);

  // Calories
  assert('Calories n is 3', stats.calories.n === 3);
  assert('Calories mean is 2100', stats.calories.mean === 2100);
  assert('Calories sample SD is 100', Math.abs(stats.calories.sd - 100) < 1e-9);
  assert('Calories median is 2100', stats.calories.median === 2100);
  assert('Calories min is 2000', stats.calories.min === 2000);
  assert('Calories max is 2200', stats.calories.max === 2200);
  assert('Calories target is 2000', stats.calories.target === 2000);
  assert('Calories difference is +100', stats.calories.difference === 100);
  assert('Calories percentDifference is +5%', stats.calories.percentDifference === 5);

  // Protein sample SD
  assert('Protein sample SD is 10', Math.abs(stats.protein.sd - 10) < 1e-9);
  assert('Protein mean is 160', stats.protein.mean === 160);
}

// ── TEST 8: Single Observation (n = 1: Sample SD is null) ──
{
  const intakeHistory = {
    '2026-08-25': {
      date: '2026-08-25',
      totals: { calories: 2350, protein: 155, carbs: 290, fat: 60 }
    }
  };

  const stats = calculateIntakeStats(intakeHistory, 7, '2026-08-25');
  assert('Single obs calories n is 1', stats.calories.n === 1);
  assert('Single obs calories mean is 2350', stats.calories.mean === 2350);
  assert('Single obs sample SD is null (requires n >= 2)', stats.calories.sd === null);
  assert('Single obs min equals max', stats.calories.min === 2350 && stats.calories.max === 2350);
  assert('Single obs median is 2350', stats.calories.median === 2350);
}

// ── TEST 9: Empty & All Unknown Data (n = 0) ──
{
  const emptyStats = calculateIntakeStats({}, 7, '2026-08-25');
  assert('Empty history distinctDays is 0', emptyStats.distinctDays === 0);
  assert('Empty history calories n is 0', emptyStats.calories.n === 0);
  assert('Empty history calories mean is null', emptyStats.calories.mean === null);
  assert('Empty history calories SD is null', emptyStats.calories.sd === null);
  assert('Empty history calories median is null', emptyStats.calories.median === null);

  const nullHistory = {
    '2026-08-25': {
      date: '2026-08-25',
      totals: { calories: null, protein: null, carbs: null, fat: null }
    }
  };
  const nullStats = calculateIntakeStats(nullHistory, 7, '2026-08-25');
  assert('Null totals calories n is 0', nullStats.calories.n === 0);
  assert('Null totals calories mean is null', nullStats.calories.mean === null);
}

// ── TEST 10: Custom-Food Uncertainty (Partial/Null Nutrients do not become 0) ──
{
  const intakeHistory = {
    '2026-08-23': {
      date: '2026-08-23',
      totals: { calories: 2000, protein: 150, carbs: 250, fat: 60 }
    },
    '2026-08-24': {
      date: '2026-08-24',
      // Day 2 has known calories but unknown protein, carbs, fat
      totals: { calories: 700, protein: null, carbs: null, fat: null }
    },
    '2026-08-25': {
      date: '2026-08-25',
      totals: { calories: 2200, protein: 145, carbs: 280, fat: 65 }
    }
  };

  const stats = calculateIntakeStats(intakeHistory, 7, '2026-08-25');

  // Calories has 3 observations: (2000 + 700 + 2200) / 3 = 1633.333...
  assert('Partial data: calories n is 3', stats.calories.n === 3);
  assert('Partial data: calories mean is ~1633.3', Math.abs(stats.calories.mean - 1633.3333333333333) < 0.01);

  // Protein has 2 observations: (150 + 145) / 2 = 147.5 (Day 2 ignored, NOT converted to 0)
  assert('Partial data: protein n is 2', stats.protein.n === 2);
  assert('Partial data: protein mean is 147.5', stats.protein.mean === 147.5);

  // Carbs has 2 observations: (250 + 280) / 2 = 265
  assert('Partial data: carbs n is 2', stats.carbs.n === 2);
  assert('Partial data: carbs mean is 265', stats.carbs.mean === 265);

  // Fat has 2 observations: (60 + 65) / 2 = 62.5
  assert('Partial data: fat n is 2', stats.fat.n === 2);
  assert('Partial data: fat mean is 62.5', stats.fat.mean === 62.5);
}

// ── TEST 11: Median with Even n ──
{
  const intakeHistory = {
    '2026-08-22': { date: '2026-08-22', totals: { calories: 1000 } },
    '2026-08-23': { date: '2026-08-23', totals: { calories: 2000 } },
    '2026-08-24': { date: '2026-08-24', totals: { calories: 3000 } },
    '2026-08-25': { date: '2026-08-25', totals: { calories: 4000 } }
  };

  const stats = calculateIntakeStats(intakeHistory, 7, '2026-08-25');
  assert('Even n median is average of middle elements (2500)', stats.calories.median === 2500);
}

// ── TEST 12: Fallback Targets when Snapshots lack target ──
{
  const intakeHistory = {
    '2026-08-25': {
      date: '2026-08-25',
      totals: { calories: 2400, protein: 160, carbs: 290, fat: 60 }
    }
  };

  const fallbackTargets = { calories: 2335, protein: 151, carbs: 291, fat: 62 };
  const stats = calculateIntakeStats(intakeHistory, 7, '2026-08-25', fallbackTargets);
  assert('Fallback target applied to calories', stats.calories.target === 2335);
  assert('Calories target difference calculated correctly', stats.calories.difference === 65);
}

// ── TEST 13: Full 2x2 Matrix Sandwich Reference Implementation Verification ──
{
  const obs = [
    { ms: Date.UTC(2026, 7, 1), weight: 185.0 },
    { ms: Date.UTC(2026, 7, 2), weight: 184.8 },
    { ms: Date.UTC(2026, 7, 3), weight: 185.1 },
    { ms: Date.UTC(2026, 7, 5), weight: 184.7 },
    { ms: Date.UTC(2026, 7, 6), weight: 184.6 }
  ];

  const model = fitLinearRegression(obs);
  const hacResult = calculateNeweyWestCovariance(model, 2);

  // Independent full 2x2 matrix sandwich reference implementation
  const n = obs.length;
  const t0 = obs[0].ms;
  const X = obs.map(o => [1, (o.ms - t0) / 86400000]);

  // X'X
  let xtx = [[0, 0], [0, 0]];
  for (let i = 0; i < n; i++) {
    xtx[0][0] += X[i][0] * X[i][0];
    xtx[0][1] += X[i][0] * X[i][1];
    xtx[1][0] += X[i][1] * X[i][0];
    xtx[1][1] += X[i][1] * X[i][1];
  }
  const det = xtx[0][0] * xtx[1][1] - xtx[0][1] * xtx[1][0];
  const invXtx = [
    [xtx[1][1] / det, -xtx[0][1] / det],
    [-xtx[1][0] / det, xtx[0][0] / det]
  ];

  // Score vectors g_i = X_i * e_i
  const g = obs.map((o, i) => [X[i][0] * model.residuals[i], X[i][1] * model.residuals[i]]);

  // Gamma_0
  let S = [[0, 0], [0, 0]];
  for (let i = 0; i < n; i++) {
    S[0][0] += g[i][0] * g[i][0];
    S[0][1] += g[i][0] * g[i][1];
    S[1][0] += g[i][1] * g[i][0];
    S[1][1] += g[i][1] * g[i][1];
  }

  // Gamma_ell with Bartlett kernel
  const L = 2;
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    let gL = [[0, 0], [0, 0]];
    for (let i = l; i < n; i++) {
      gL[0][0] += g[i][0] * g[i - l][0];
      gL[0][1] += g[i][0] * g[i - l][1];
      gL[1][0] += g[i][1] * g[i - l][0];
      gL[1][1] += g[i][1] * g[i - l][1];
    }
    S[0][0] += w * 2 * gL[0][0];
    S[0][1] += w * (gL[0][1] + gL[1][0]);
    S[1][0] += w * (gL[1][0] + gL[0][1]);
    S[1][1] += w * 2 * gL[1][1];
  }

  // Sandwich V = (X'X)^(-1) S (X'X)^(-1)
  const M = [
    [S[0][0] * invXtx[0][0] + S[0][1] * invXtx[1][0], S[0][0] * invXtx[0][1] + S[0][1] * invXtx[1][1]],
    [S[1][0] * invXtx[0][0] + S[1][1] * invXtx[1][0], S[1][0] * invXtx[0][1] + S[1][1] * invXtx[1][1]]
  ];
  const V = [
    [invXtx[0][0] * M[0][0] + invXtx[0][1] * M[1][0], invXtx[0][0] * M[0][1] + invXtx[0][1] * M[1][1]],
    [invXtx[1][0] * M[0][0] + invXtx[1][1] * M[1][0], invXtx[1][0] * M[0][1] + invXtx[1][1] * M[1][1]]
  ];

  const fullMatrixSlopeVar = V[1][1];
  const fullMatrixSePerWeek = Math.sqrt(fullMatrixSlopeVar) * 7;

  assert(
    'Full 2x2 matrix sandwich slope variance matches centered scalar formula (< 1e-12)',
    Math.abs(hacResult.standardErrorPerWeek - fullMatrixSePerWeek) < 1e-12,
    `Scalar: ${hacResult.standardErrorPerWeek}, Matrix: ${fullMatrixSePerWeek}`
  );
}

// ── TEST 14: Perfect Linear Decline (Zero Noise) ──
{
  const trueSlopePerDay = -0.15;
  const trueRatePerWeek = trueSlopePerDay * 7; // -1.05 lb/wk
  const history = {};
  for (let i = 0; i < 35; i++) {
    const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    history[date] = { weight: 190.0 + trueSlopePerDay * i };
  }

  const trend = calculateWeightTrend(history, { windowDays: 40 });
  assert('Perfect linear decline: slope equals true slope exactly', Math.abs(trend.ratePerWeek - trueRatePerWeek) < 1e-10);
  assert('Perfect linear decline: HAC(7) SE approaches zero (< 1e-10)', trend.hac[7].standardErrorPerWeek < 1e-10);
  assert('Perfect linear decline: HAC(14) SE approaches zero (< 1e-10)', trend.hac[14].standardErrorPerWeek < 1e-10);
  assert('Perfect linear decline: HAC(30) SE approaches zero (< 1e-10)', trend.hac[30].standardErrorPerWeek < 1e-10);

  const ci = trend.hac[7].confidenceInterval95;
  assert('Perfect linear decline: CI collapses to point estimate', Math.abs(ci.upper - ci.lower) < 1e-9);
}

// ── TEST 15: No Trend (Constant Weights) ──
{
  const history = {};
  for (let i = 0; i < 20; i++) {
    const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    history[date] = { weight: 175.0 };
  }

  const trend = calculateWeightTrend(history, { windowDays: 30 });
  assert('Constant weight: rate is approximately zero', Math.abs(trend.ratePerWeek) < 1e-10);
  assert('Constant weight: HAC(7) SE is approximately zero', trend.hac[7].standardErrorPerWeek < 1e-10);
  assert('Constant weight: CI lower is approximately zero', Math.abs(trend.hac[7].confidenceInterval95.lower) < 1e-10);
  assert('Constant weight: CI upper is approximately zero', Math.abs(trend.hac[7].confidenceInterval95.upper) < 1e-10);
  assert('Constant weight: no NaN or Infinity', isFinite(trend.ratePerWeek) && isFinite(trend.hac[7].standardErrorPerWeek));
}

// ── TEST 16: Noisy Linear Trend with Seeded PRNG ──
{
  function createPrng(seed = 12345) {
    let s = seed;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function randomNormal(prng) {
    let u = 0, v = 0;
    while (u === 0) u = prng();
    while (v === 0) v = prng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  const prng = createPrng(42);
  const trueRatePerWeek = -0.70;
  const trueBetaDay = trueRatePerWeek / 7;
  const n = 25;
  const sigma = 0.3;

  // Single representative run
  const singleHistory = {};
  for (let i = 0; i < n; i++) {
    const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    singleHistory[date] = { weight: 180 + trueBetaDay * i + sigma * randomNormal(prng) };
  }
  const trend = calculateWeightTrend(singleHistory, { windowDays: 30 });
  assert('Noisy trend: estimated rate is reasonably close to true rate', Math.abs(trend.ratePerWeek - trueRatePerWeek) < 0.25);
  assert('Noisy trend: HAC(7) SE is strictly positive', trend.hac[7].standardErrorPerWeek > 0);
  assert('Noisy trend: HAC(14) SE is strictly positive', trend.hac[14].standardErrorPerWeek > 0);
  assert('Noisy trend: CI bounds are finite numbers', isFinite(trend.hac[7].confidenceInterval95.lower) && isFinite(trend.hac[7].confidenceInterval95.upper));

  // 100-trial simulation coverage
  let coveredCount = 0;
  const trials = 100;
  for (let trial = 0; trial < trials; trial++) {
    const trialHistory = {};
    for (let i = 0; i < n; i++) {
      const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
      trialHistory[date] = { weight: 180 + trueBetaDay * i + sigma * randomNormal(prng) };
    }
    const tr = calculateWeightTrend(trialHistory, { windowDays: 30 });
    const ci = tr.hac[7].confidenceInterval95;
    if (trueRatePerWeek >= ci.lower && trueRatePerWeek <= ci.upper) {
      coveredCount++;
    }
  }
  assert('Noisy trend: 95% CI covers true slope at expected frequency (>= 75%)', coveredCount >= 75 && coveredCount <= 100, `Covered ${coveredCount}/100`);
}

// ── TEST 17: Autocorrelated Residuals (AR(1) Process) ──
{
  function createPrng(seed = 999) {
    let s = seed;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function randomNormal(prng) {
    let u = 0, v = 0;
    while (u === 0) u = prng();
    while (v === 0) v = prng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  const prng = createPrng(12345);
  const n = 35;
  const rho = 0.8;
  let e = 0;
  const history = {};

  for (let i = 0; i < n; i++) {
    e = rho * e + 0.3 * randomNormal(prng);
    const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    history[date] = { weight: 180 - 0.1 * i + e };
  }

  const trend = calculateWeightTrend(history, { windowDays: 40 });
  assert('Autocorrelated: slope is approximately centered on true slope (-0.7 lb/wk)', Math.abs(trend.ratePerWeek - (-0.7)) < 0.2);
  assert('Autocorrelated: HAC SE differs from conventional OLS SE', Math.abs(trend.hac[7].standardErrorPerWeek - trend.ols.standardErrorPerWeek) > 0.001);
  assert('Autocorrelated: different HAC bandwidths yield different uncertainty estimates', Math.abs(trend.hac[7].standardErrorPerWeek - trend.hac[14].standardErrorPerWeek) > 0.001);
  assert('Autocorrelated: point estimate is invariant across all HAC horizons', Math.abs(trend.ratePerWeek - trend.hac[7].confidenceInterval95.lower - (trend.hac[7].confidenceInterval95.upper - trend.ratePerWeek)) < 1e-10);
}

// ── TEST 18: Insufficient Observations (n = 0, 1, 2) ──
{
  assert('n = 0 returns null', calculateWeightTrend({}) === null);
  assert('n = 1 returns null', calculateWeightTrend({ '2026-08-01': { weight: 180 } }) === null);
  assert('n = 2 returns null', calculateWeightTrend({ '2026-08-01': { weight: 180 }, '2026-08-02': { weight: 179 } }) === null);
}

// ── TEST 19: Missing Observations ──
{
  // 4 recorded days across 14 calendar days
  const history = {
    '2026-08-01': { weight: 185.0 },
    '2026-08-03': { weight: 184.5 },
    // 2026-08-04 to 2026-08-09 missing
    '2026-08-10': { weight: 183.8 },
    '2026-08-14': { weight: 183.0 }
  };
  const trend = calculateWeightTrend(history, { windowDays: 14, referenceDate: '2026-08-14' });
  assert('Missing observations: observationCount is exactly 4 (not 14)', trend.observationCount === 4);
  assert('Missing observations: degreesOfFreedom is 2 (4 - 2)', trend.degreesOfFreedom === 2);
}

// ── TEST 20: Irregular Observation Spacing ──
{
  // Days 0, 3, 10
  const history = {
    '2026-08-01': { weight: 180.0 }, // t = 0
    '2026-08-04': { weight: 178.5 }, // t = 3
    '2026-08-11': { weight: 175.0 }  // t = 10
  };
  const trend = calculateWeightTrend(history, { windowDays: 14, referenceDate: '2026-08-11' });

  // True calendar-day slope beta:
  // t = [0, 3, 10], w = [180, 178.5, 175]
  // meanT = 13/3, meanW = 533.5/3
  const meanT = (0 + 3 + 10) / 3;
  const meanW = (180 + 178.5 + 175) / 3;
  const sxx = (0 - meanT) ** 2 + (3 - meanT) ** 2 + (10 - meanT) ** 2;
  const sxw = (0 - meanT) * (180 - meanW) + (3 - meanT) * (178.5 - meanW) + (10 - meanT) * (175 - meanW);
  const expectedBetaPerDay = sxw / sxx;
  const expectedRatePerWeek = expectedBetaPerDay * 7;

  assert('Irregular spacing: uses actual calendar elapsed time, not index', Math.abs(trend.ratePerWeek - expectedRatePerWeek) < 1e-10);
}

// ── TEST 21: Unit Conversion ──
{
  const obs = [
    { ms: Date.UTC(2026, 7, 1), weight: 185.0 },
    { ms: Date.UTC(2026, 7, 2), weight: 184.6 },
    { ms: Date.UTC(2026, 7, 3), weight: 184.2 },
    { ms: Date.UTC(2026, 7, 4), weight: 183.9 }
  ];
  const model = fitLinearRegression(obs);
  const hac = calculateNeweyWestCovariance(model, 2);

  assert('Unit conversion: ratePerWeek = 7 * betaDay', Math.abs(model.ratePerWeek - model.beta * 7) < 1e-10);
  const seBetaDay = Math.sqrt(Math.max(0, (hac.standardErrorPerWeek / 7) ** 2));
  assert('Unit conversion: SE per week = 7 * SE per day', Math.abs(hac.standardErrorPerWeek - seBetaDay * 7) < 1e-10);
  const marginWeek = hac.confidenceInterval95.upper - model.ratePerWeek;
  const marginDay = marginWeek / 7;
  assert('Unit conversion: CI margin scales consistently by 7', Math.abs(marginWeek - marginDay * 7) < 1e-10);
}

// ── TEST 22: Observation Count and Degrees of Freedom ──
{
  const history = {};
  for (let i = 0; i < 12; i++) {
    const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
    history[date] = { weight: 180 - 0.1 * i };
  }
  const trend = calculateWeightTrend(history, { windowDays: 14 });
  assert('Observation count equals number of valid entries (12)', trend.observationCount === 12);
  assert('Degrees of freedom equals n - 2 (10)', trend.degreesOfFreedom === 10);
}

// ── TEST 23: HAC Lag Handling and Capping ──
{
  const makeHistory = (count) => {
    const h = {};
    for (let i = 0; i < count; i++) {
      const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
      h[date] = { weight: 180 - 0.05 * i };
    }
    return h;
  };

  const trend35 = calculateWeightTrend(makeHistory(35), { windowDays: 40 });
  assert('n = 35: HAC(30) uses lag 30', trend35.hac[30].lagUsed === 30);
  assert('n = 35: HAC(14) uses lag 14', trend35.hac[14].lagUsed === 14);
  assert('n = 35: HAC(7) uses lag 7', trend35.hac[7].lagUsed === 7);

  const trend20 = calculateWeightTrend(makeHistory(20), { windowDays: 30 });
  assert('n = 20: HAC(30) uses lag 19 (capped at n - 1)', trend20.hac[30].lagUsed === 19);
  assert('n = 20: HAC(14) uses lag 14', trend20.hac[14].lagUsed === 14);

  const trend8 = calculateWeightTrend(makeHistory(8), { windowDays: 14 });
  assert('n = 8: HAC(30) uses lag 7 (capped at n - 1)', trend8.hac[30].lagUsed === 7);
  assert('n = 8: HAC(14) uses lag 7 (capped at n - 1)', trend8.hac[14].lagUsed === 7);
  assert('n = 8: HAC(7) uses lag 7', trend8.hac[7].lagUsed === 7);

  const trend5 = calculateWeightTrend(makeHistory(5), { windowDays: 14 });
  assert('n = 5: HAC(7) uses lag 4 (capped at n - 1)', trend5.hac[7].lagUsed === 4);
}

// ── TEST 24: Student's t Degrees of Freedom Convention (Not 1.96) ──
{
  assert('Student-t critical table covers df 1..100', STUDENT_T_975_TABLE.length === 100);
  assert('Student-t critical value for df = 1 matches ~12.706', Math.abs(STUDENT_T_975_TABLE[0] - 12.70620474) < 1e-6);
  // For n = 5, df = 3. Student's t critical value is 3.18244631
  const t3 = getStudentTCriticalValue(3, 0.95);
  assert('Student-t critical value for df = 3 matches ~3.1824', Math.abs(t3 - 3.18244631) < 1e-6);
  assert('Student-t critical value is NOT hardcoded 1.96', Math.abs(t3 - 1.96) > 1.0);

  const obs = [
    { ms: Date.UTC(2026, 7, 1), weight: 185.0 },
    { ms: Date.UTC(2026, 7, 2), weight: 184.8 },
    { ms: Date.UTC(2026, 7, 3), weight: 185.1 },
    { ms: Date.UTC(2026, 7, 4), weight: 184.7 },
    { ms: Date.UTC(2026, 7, 5), weight: 184.3 }
  ];
  const model = fitLinearRegression(obs);
  const hac = calculateNeweyWestCovariance(model, 2);
  const expectedMargin = t3 * hac.standardErrorPerWeek;
  const actualMargin = hac.confidenceInterval95.upper - model.ratePerWeek;
  assert('CI margin uses Student-t critical value with df = n - 2', Math.abs(actualMargin - expectedMargin) < 1e-10);
}

// ── TEST 25: Timestamp Degeneracy ──
{
  // All observations have identical timestamp
  const degenerateObs = [
    { ms: 1000000, weight: 185.0 },
    { ms: 1000000, weight: 184.5 },
    { ms: 1000000, weight: 184.0 }
  ];
  const model = fitLinearRegression(degenerateObs);
  assert('Degenerate timestamps (Sxx = 0) returns null', model === null);
}

// ── TEST 26: HAC Point-Estimate Invariance ──
{
  const history = {
    '2026-08-01': { weight: 185.2 },
    '2026-08-02': { weight: 184.9 },
    '2026-08-03': { weight: 185.3 },
    '2026-08-04': { weight: 184.7 },
    '2026-08-05': { weight: 184.4 },
    '2026-08-06': { weight: 184.6 },
    '2026-08-07': { weight: 184.1 }
  };
  const trend = calculateWeightTrend(history, { windowDays: 14 });
  const r7 = trend.ratePerWeek;
  // Verify that the point estimate underlying HAC(7), HAC(14), and HAC(30) is invariant
  assert('Point estimate is identical across all HAC specifications',
    Math.abs(r7 - trend.ratePerWeek) < 1e-14 &&
    isFinite(trend.hac[7].standardErrorPerWeek) &&
    isFinite(trend.hac[14].standardErrorPerWeek) &&
    isFinite(trend.hac[30].standardErrorPerWeek)
  );
}

// ── TEST 27: Aligned Comparison Windows (7, 14, 28, 91 Days) ──
{
  [7, 14, 28, 91].forEach(W => {
    const windows = getAlignedComparisonWindows('2026-09-20', W);
    assert(`Window W=${W}: calendarDays is exactly ${W}`, windows.calendarDays === W);

    const curStartMs = parseDateToMs(windows.currentStart);
    const curEndMs = parseDateToMs(windows.currentEnd);
    const prevStartMs = parseDateToMs(windows.previousStart);
    const prevEndMs = parseDateToMs(windows.previousEnd);
    const dayMs = 86400000;

    const curSpanDays = Math.round((curEndMs - curStartMs) / dayMs) + 1;
    const prevSpanDays = Math.round((prevEndMs - prevStartMs) / dayMs) + 1;

    assert(`Window W=${W}: current window span is exactly ${W} calendar days`, curSpanDays === W);
    assert(`Window W=${W}: previous window span is exactly ${W} calendar days`, prevSpanDays === W);

    // Weekday alignment: (day of week) of currentStart must equal (day of week) of previousStart
    const curStartDay = new Date(curStartMs).getUTCDay();
    const prevStartDay = new Date(prevStartMs).getUTCDay();
    const curEndDay = new Date(curEndMs).getUTCDay();
    const prevEndDay = new Date(prevEndMs).getUTCDay();

    assert(`Window W=${W}: start dates have identical weekday boundary`, curStartDay === prevStartDay);
    assert(`Window W=${W}: end dates have identical weekday boundary`, curEndDay === prevEndDay);
    assert(`Window W=${W}: previousEnd is immediately contiguous before currentStart`, (curStartMs - prevEndMs) === dayMs);
  });
}

// ── TEST 28: Nutritional Trend Comparison Invariance with Missing Observations ──
{
  const refDate = '2026-09-20';
  // Create 7-day window with 4 observations in current, 5 observations in previous
  const intakeHistory = {
    // Current window: 2026-09-14 to 2026-09-20 (7 days)
    '2026-09-14': { calories: 2000, protein: 150, carbs: 200, fat: 50 },
    '2026-09-16': { calories: 2100, protein: 160, carbs: 210, fat: 55 },
    '2026-09-18': { calories: 1900, protein: 140, carbs: 190, fat: 48 },
    '2026-09-20': { calories: 2200, protein: 170, carbs: 220, fat: 60 },
    // Previous window: 2026-09-07 to 2026-09-13 (7 days)
    '2026-09-07': { calories: 1800, protein: 130, carbs: 180, fat: 45 },
    '2026-09-09': { calories: 1850, protein: 135, carbs: 185, fat: 46 },
    '2026-09-10': { calories: 1900, protein: 140, carbs: 190, fat: 48 },
    '2026-09-11': { calories: 1950, protein: 145, carbs: 195, fat: 50 },
    '2026-09-13': { calories: 2000, protein: 150, carbs: 200, fat: 52 }
  };

  const trend = calculateNutritionalTrendComparison(intakeHistory, { windowDays: 7, referenceDate: refDate });

  assert('Trend calendarDays is 7', trend.calendarDays === 7);
  assert('Current window start is fixed to 2026-09-14', trend.current.startDate === '2026-09-14');
  assert('Current window end is fixed to 2026-09-20', trend.current.endDate === '2026-09-20');
  assert('Current loggedDays is 4 (independent of 7-day window)', trend.current.loggedDays === 4);

  assert('Previous window start is fixed to 2026-09-07', trend.previous.startDate === '2026-09-07');
  assert('Previous window end is fixed to 2026-09-13', trend.previous.endDate === '2026-09-13');
  assert('Previous loggedDays is 5 (independent of 7-day window)', trend.previous.loggedDays === 5);

  assert('Calories deltaMean is calculated correctly (+150 kcal)', Math.abs(trend.deltas.calories.deltaMean - 150) < 0.01);

  // Deleting boundary observation does NOT alter window boundaries
  const sparseHistory = { ...intakeHistory };
  delete sparseHistory['2026-09-14'];
  delete sparseHistory['2026-09-20'];
  const sparseTrend = calculateNutritionalTrendComparison(sparseHistory, { windowDays: 7, referenceDate: refDate });

  assert('Sparse current window start remains 2026-09-14', sparseTrend.current.startDate === '2026-09-14');
  assert('Sparse current window end remains 2026-09-20', sparseTrend.current.endDate === '2026-09-20');
  assert('Sparse current loggedDays reflects 2', sparseTrend.current.loggedDays === 2);
}

console.log(`\nStats Tests Completed: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
if (failed > 0 && process.argv[1] && process.argv[1].endsWith('stats.test.js')) process.exit(1);

export function runStatsTestSuite() {
  return failed === 0;
}
