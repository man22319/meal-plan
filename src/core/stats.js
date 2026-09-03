// ══════════════════════════════════════════
// STATS — Pure Longitudinal Statistical Functions
// ══════════════════════════════════════════

/**
 * Parses YYYY-MM-DD string into a UTC midnight Date timestamp (in ms)
 * to avoid timezone shifting issues.
 */
export function parseDateToMs(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return NaN;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return NaN;
  const [year, month, day] = parts.map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return NaN;
  return Date.UTC(year, month - 1, day);
}

/**
 * Formats a Date object or UTC ms into YYYY-MM-DD string.
 */
export function formatDateStr(dateInput) {
  const d = typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Helper to get local date string YYYY-MM-DD
 */
export function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retrieves sorted weight observations within the [endDate - (windowDays - 1), endDate] window.
 * If endDate is not provided, defaults to the latest recorded date or today.
 */
export function getWeightObservations(weightHistory, windowDays = null, referenceDate = null) {
  if (!weightHistory || typeof weightHistory !== 'object') return [];

  const entries = Object.entries(weightHistory)
    .map(([date, rec]) => {
      const weight = typeof rec === 'number' ? rec : rec?.weight;
      const ms = parseDateToMs(date);
      return { date, ms, weight: typeof weight === 'number' && !isNaN(weight) ? weight : null };
    })
    .filter(e => !isNaN(e.ms) && e.weight !== null)
    .sort((a, b) => a.ms - b.ms);

  if (entries.length === 0) return [];

  const refMs = referenceDate ? parseDateToMs(referenceDate) : entries[entries.length - 1].ms;
  if (isNaN(refMs)) return entries;

  if (windowDays === null) {
    return entries.filter(e => e.ms <= refMs);
  }

  const startMs = refMs - (windowDays - 1) * 86400000;
  return entries.filter(e => e.ms >= startMs && e.ms <= refMs);
}

/**
 * Retrieves sorted intake observations within the [endDate - (windowDays - 1), endDate] window.
 */
export function getIntakeObservations(intakeHistory, windowDays = null, referenceDate = null) {
  if (!intakeHistory || typeof intakeHistory !== 'object') return [];

  const entries = Object.entries(intakeHistory)
    .map(([date, rec]) => {
      const ms = parseDateToMs(date);
      const totals = rec?.totals;
      return { date, ms, totals, rec };
    })
    .filter(e => !isNaN(e.ms) && e.totals && (typeof e.totals.calories === 'number' || e.totals.calories === null))
    .sort((a, b) => a.ms - b.ms);

  if (entries.length === 0) return [];

  const refMs = referenceDate ? parseDateToMs(referenceDate) : entries[entries.length - 1].ms;
  if (isNaN(refMs)) return entries;

  if (windowDays === null) {
    return entries.filter(e => e.ms <= refMs);
  }

  const startMs = refMs - (windowDays - 1) * 86400000;
  return entries.filter(e => e.ms >= startMs && e.ms <= refMs);
}

/**
 * Calculates current weight (most recent observation up to referenceDate).
 */
export function calculateCurrentWeight(weightHistory, referenceDate = null) {
  const obs = getWeightObservations(weightHistory, null, referenceDate);
  if (obs.length === 0) return null;
  return obs[obs.length - 1].weight;
}

/**
 * Calculates arithmetic moving average of weight observations in the last `days` calendar window.
 * Returns null if 0 observations exist.
 */
export function calculateMovingAverage(weightHistory, days = 7, referenceDate = null) {
  const obs = getWeightObservations(weightHistory, days, referenceDate);
  if (obs.length === 0) return null;
  const sum = obs.reduce((acc, curr) => acc + curr.weight, 0);
  return sum / obs.length;
}

/**
 * Calculates weight change over the last `days` window (latest observation - earliest observation in window).
 */
export function calculateWeightChange(weightHistory, days = 7, referenceDate = null) {
  const obs = getWeightObservations(weightHistory, days, referenceDate);
  if (obs.length < 2) return null;
  return obs[obs.length - 1].weight - obs[0].weight;
}

/**
 * Calculates weight rate of change (lb/week) using Ordinary Least Squares (OLS) regression:
 * W(t) = beta_0 + beta_1 * t
 * where t is elapsed days from the first observation.
 * Rate = 7 * beta_1 (lb/week).
 * Requires at least minObservations (default 3) distinct days within window.
 */
export function calculateWeightTrend(weightHistory, { windowDays = 14, minObservations = 3, referenceDate = null } = {}) {
  const obs = getWeightObservations(weightHistory, windowDays, referenceDate);
  if (obs.length < minObservations) return null;

  const t0 = obs[0].ms;
  const n = obs.length;

  let sumT = 0;
  let sumW = 0;
  let sumTW = 0;
  let sumTT = 0;

  for (let i = 0; i < n; i++) {
    const t = (obs[i].ms - t0) / 86400000; // Elapsed days
    const w = obs[i].weight;
    sumT += t;
    sumW += w;
    sumTW += t * w;
    sumTT += t * t;
  }

  const denominator = n * sumTT - sumT * sumT;
  if (Math.abs(denominator) < 1e-10) {
    // All observations on the same day or zero variance in t
    return null;
  }

  const beta1 = (n * sumTW - sumT * sumW) / denominator;
  const ratePerWeek = beta1 * 7;
  return ratePerWeek;
}

/**
 * Calculates comprehensive longitudinal daily intake statistics over the last `days` window.
 * Computes independent mean, sample SD, median, min, max, n, and target deviations for each nutrient.
 */
export function calculateIntakeStats(intakeHistory, days = 7, referenceDate = null, fallbackTargets = null) {
  const obs = getIntakeObservations(intakeHistory, days, referenceDate);
  const nutrients = ['calories', 'protein', 'carbs', 'fat'];
  const distinctDays = new Set();

  obs.forEach(({ date, totals }) => {
    if (totals && nutrients.some(k => typeof totals[k] === 'number' && !isNaN(totals[k]))) {
      distinctDays.add(date);
    }
  });

  const result = {
    distinctDays: distinctDays.size,
    windowDays: days
  };

  nutrients.forEach(k => {
    const values = [];
    const targets = [];

    obs.forEach(({ totals, rec }) => {
      const v = totals ? totals[k] : null;
      if (typeof v === 'number' && !isNaN(v)) {
        values.push(v);
        const t = (rec && rec.targets && typeof rec.targets[k] === 'number')
          ? rec.targets[k]
          : (fallbackTargets && typeof fallbackTargets[k] === 'number' ? fallbackTargets[k] : null);
        if (typeof t === 'number' && !isNaN(t)) {
          targets.push(t);
        }
      }
    });

    const n = values.length;
    if (n === 0) {
      result[k] = {
        n: 0,
        mean: null,
        sd: null,
        median: null,
        min: null,
        max: null,
        target: null,
        difference: null,
        percentDifference: null
      };
    } else {
      const sum = values.reduce((acc, curr) => acc + curr, 0);
      const mean = sum / n;

      let sd = null;
      if (n >= 2) {
        const sumSqDiff = values.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0);
        sd = Math.sqrt(sumSqDiff / (n - 1));
      }

      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(n / 2);
      const median = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      let target = null;
      let difference = null;
      let percentDifference = null;

      if (targets.length > 0) {
        target = targets.reduce((acc, curr) => acc + curr, 0) / targets.length;
        difference = mean - target;
        percentDifference = target !== 0 ? (difference / target) * 100 : null;
      }

      result[k] = {
        n,
        mean,
        sd,
        median,
        min,
        max,
        target,
        difference,
        percentDifference
      };
    }
  });

  return result;
}

/**
 * Calculates average daily intake metrics over the last `days` window.
 * Preserved for backward compatibility.
 */
export function calculateAverageIntake(intakeHistory, days = 7, referenceDate = null) {
  const obs = getIntakeObservations(intakeHistory, days, referenceDate);
  if (obs.length === 0) return null;

  const stats = calculateIntakeStats(intakeHistory, days, referenceDate);
  return {
    count: obs.length,
    calories: stats.calories.mean,
    protein: stats.protein.mean,
    carbs: stats.carbs.mean,
    fat: stats.fat.mean
  };
}

/**
 * Combines weightHistory and intakeHistory via an outer join on calendar dates,
 * returning a unified list sorted descending by date.
 */
export function getCombinedHistoryRows(weightHistory = {}, intakeHistory = {}) {
  const dateSet = new Set([
    ...Object.keys(weightHistory || {}),
    ...Object.keys(intakeHistory || {})
  ]);

  const rows = Array.from(dateSet)
    .filter(d => !isNaN(parseDateToMs(d)))
    .map(date => {
      const weightRec = weightHistory[date];
      const intakeRec = intakeHistory[date];

      const weight = typeof weightRec === 'number' ? weightRec : (typeof weightRec?.weight === 'number' ? weightRec.weight : null);
      const totals = intakeRec?.totals || null;

      return {
        date,
        ms: parseDateToMs(date),
        weight,
        hasWeight: weight !== null,
        calories: totals ? totals.calories : null,
        protein: totals ? totals.protein : null,
        carbs: totals ? totals.carbs : null,
        fat: totals ? totals.fat : null,
        hasIntake: totals !== null,
        items: intakeRec?.items || []
      };
    })
    .sort((a, b) => b.ms - a.ms);

  return rows;
}
