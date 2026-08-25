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
    .filter(e => !isNaN(e.ms) && e.totals && typeof e.totals.calories === 'number')
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
 * Calculates average daily intake metrics over the last `days` window.
 */
export function calculateAverageIntake(intakeHistory, days = 7, referenceDate = null) {
  const obs = getIntakeObservations(intakeHistory, days, referenceDate);
  if (obs.length === 0) return null;

  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  obs.forEach(({ totals: t }) => {
    totals.calories += t.calories || 0;
    totals.protein += t.protein || 0;
    totals.carbs += t.carbs || 0;
    totals.fat += t.fat || 0;
  });

  const count = obs.length;
  return {
    count,
    calories: totals.calories / count,
    protein: totals.protein / count,
    carbs: totals.carbs / count,
    fat: totals.fat / count
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
