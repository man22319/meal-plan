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
 * Precomputed exact two-sided 95% critical values t_{0.975, df} for df = 1..100.
 * Derived from Student's t distribution (scipy.stats.t.ppf(0.975, df)).
 */
export const STUDENT_T_975_TABLE = [
  12.70620474, 4.30265273, 3.18244631, 2.77644511, 2.57058184, 2.44691185, 2.36462425, 2.30600414, 2.26215716, 2.22813885,
  2.20098516, 2.17881283, 2.16036866, 2.14478669, 2.13144955, 2.1199053, 2.10981558, 2.10092204, 2.09302405, 2.08596345,
  2.07961384, 2.07387307, 2.06865761, 2.06389856, 2.05953855, 2.05552944, 2.05183052, 2.04840714, 2.04522964, 2.04227246,
  2.03951345, 2.03693334, 2.0345153, 2.03224451, 2.03010793, 2.028094, 2.02619246, 2.02439416, 2.02269092, 2.02107539,
  2.01954097, 2.0180817, 2.0166922, 2.01536757, 2.01410339, 2.0128956, 2.01174051, 2.01063476, 2.00957524, 2.00855911,
  2.00758377, 2.00664681, 2.005746, 2.00487929, 2.00404478, 2.00324072, 2.00246546, 2.00171748, 2.00099538, 2.00029782,
  1.99962358, 1.99897152, 1.99834054, 1.99772965, 1.99713791, 1.99656442, 1.99600835, 1.99546893, 1.99494542, 1.99443711,
  1.99394337, 1.99346357, 1.99299713, 1.9925435, 1.99210215, 1.99167261, 1.9912544, 1.99084707, 1.99045021, 1.99006342,
  1.98968632, 1.98931856, 1.98895978, 1.98860967, 1.98826791, 1.98793421, 1.98760828, 1.98728986, 1.9869787, 1.98667454,
  1.98637715, 1.98608632, 1.98580181, 1.98552344, 1.985251, 1.98498431, 1.98472319, 1.98446745, 1.98421695, 1.98397152
];

/**
 * Returns the two-sided 95% critical value t_{0.975, df} for degrees of freedom df.
 *
 * NOTE ON STATISTICAL CONVENTION:
 * Using Student's t critical value with df = n - 2 is a practical finite-sample
 * convention applied to the Newey-West standard error. Because Newey-West is an
 * asymptotic covariance estimator, this finite-sample convention does not imply
 * that the finite-sample HAC t-statistic has an exact Student's t distribution.
 *
 * Uses precomputed exact table for df in 1..100, and a 4th-order Cornish-Fisher
 * asymptotic expansion for df > 100 converging to z_{0.975} = 1.9599639845...
 */
export function getStudentTCriticalValue(df, confidence = 0.95) {
  if (typeof df !== 'number' || isNaN(df) || df < 1) return NaN;

  if (confidence === 0.95) {
    const intDf = Math.round(df);
    if (intDf >= 1 && intDf <= STUDENT_T_975_TABLE.length) {
      return STUDENT_T_975_TABLE[intDf - 1];
    }
    // Cornish-Fisher expansion for df > 100
    const z = 1.9599639845400542;
    const z2 = z * z;
    const z3 = z2 * z;
    const z5 = z3 * z2;
    const z7 = z5 * z2;
    const z9 = z7 * z2;

    const t1 = (z3 + z) / 4;
    const t2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
    const t3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
    const t4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;

    return z + t1 / df + t2 / (df * df) + t3 / (df * df * df) + t4 / (df * df * df * df);
  }

  // Fallback for non-95% confidence using 1.96 standard normal approximation
  return 1.9599639845400542;
}

/**
 * Fits a simple linear regression W_i = alpha + beta * t_i + epsilon_i
 * using centered time x_i = t_i - bar{t} for numerical stability.
 *
 * Returns fitted slope beta (in lb/day), alpha, residuals, Sxx, and diagnostics.
 * Returns null if n < 3 or if elapsed time has zero variance.
 */
export function fitLinearRegression(observations) {
  if (!Array.isArray(observations) || observations.length < 3) return null;

  const n = observations.length;
  const t0 = observations[0].ms;

  const t = new Array(n);
  const w = new Array(n);
  let sumT = 0;
  let sumW = 0;

  for (let i = 0; i < n; i++) {
    const elapsedDays = (observations[i].ms - t0) / 86400000;
    const weight = observations[i].weight;
    if (typeof weight !== 'number' || isNaN(weight) || weight <= 0) return null;
    t[i] = elapsedDays;
    w[i] = weight;
    sumT += elapsedDays;
    sumW += weight;
  }

  const meanT = sumT / n;
  const meanW = sumW / n;

  let Sxx = 0;
  let Sxw = 0;
  const x = new Array(n);

  for (let i = 0; i < n; i++) {
    const xi = t[i] - meanT;
    x[i] = xi;
    Sxx += xi * xi;
    Sxw += xi * (w[i] - meanW);
  }

  // If time has zero or negligible variance (e.g. all timestamps identical)
  if (Sxx < 1e-10) {
    return null;
  }

  const beta = Sxw / Sxx; // lb/day
  const alpha = meanW - beta * meanT;

  const residuals = new Array(n);
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const res = w[i] - (alpha + beta * t[i]);
    residuals[i] = res;
    rss += res * res;
  }

  const df = n - 2;
  const s2 = rss / df;
  const olsVarBeta = s2 / Sxx;
  const olsSeBeta = Math.sqrt(Math.max(0, olsVarBeta));

  return {
    n,
    df,
    t0,
    t,
    w,
    x,
    meanT,
    meanW,
    Sxx,
    beta, // lb/day
    alpha,
    ratePerWeek: beta * 7,
    residuals,
    rss,
    olsVarBeta,
    olsSeBeta
  };
}

/**
 * Calculates Newey-West HAC covariance estimate for a fitted linear regression
 * with Bartlett kernel weights w_ell = 1 - ell / (L_effective + 1).
 *
 * MATHEMATICAL NOTE ON SCALAR EQUIVALENCE:
 * Because the regression includes an intercept and the predictor is centered (x_i = t_i - bar{t}),
 * the design matrix X_c = [1, x] has orthogonal columns (sum x_i = 0), so (X_c' X_c)^{-1}
 * is diag(1/n, 1/Sxx). The slope component of the Newey-West sandwich estimator
 * (X_c' X_c)^{-1} S_hat (X_c' X_c)^{-1} simplifies identically to S_hat_{22} / Sxx^2,
 * where s_i = x_i * hat{epsilon}_i. This is verified against an independent full 2x2
 * matrix sandwich implementation in unit tests.
 *
 * Lags are defined in observation-index space: correlations up to requestedLag adjacent
 * observations, capped at L_effective = min(requestedLag, n - 1).
 */
export function calculateNeweyWestCovariance(fittedModel, requestedLag) {
  if (!fittedModel || fittedModel.n < 3) return null;

  const { n, df, x, residuals, Sxx, ratePerWeek } = fittedModel;
  const lagUsed = Math.min(requestedLag, n - 1);

  // Score vector element for slope: s_i = x_i * hat{epsilon}_i
  const s = new Array(n);
  let gamma0 = 0;
  for (let i = 0; i < n; i++) {
    const si = x[i] * residuals[i];
    s[i] = si;
    gamma0 += si * si;
  }

  let sumGamma = 0;
  if (lagUsed > 0) {
    for (let l = 1; l <= lagUsed; l++) {
      const w = 1 - l / (lagUsed + 1); // Bartlett kernel weight
      let gammaL = 0;
      for (let i = l; i < n; i++) {
        gammaL += s[i] * s[i - l];
      }
      sumGamma += w * 2 * gammaL;
    }
  }

  const S22 = gamma0 + sumGamma;
  const varBeta = Math.max(0, S22 / (Sxx * Sxx));
  const seBetaDay = Math.sqrt(varBeta);
  const standardErrorPerWeek = seBetaDay * 7;

  // Two-sided 95% confidence interval using Student's t finite-sample convention with df = n - 2
  const tCrit = getStudentTCriticalValue(df, 0.95);
  const margin = tCrit * standardErrorPerWeek;

  return {
    requestedLag,
    lagUsed,
    standardErrorPerWeek,
    confidenceInterval95: {
      lower: ratePerWeek - margin,
      upper: ratePerWeek + margin
    },
    tCritical: tCrit
  };
}

/**
 * Calculates weight rate of change (lb/week) and Newey-West HAC uncertainty estimates:
 * W_i = alpha + beta * t_i + epsilon_i
 * where t is elapsed days from the first observation.
 *
 * Returns a comprehensive domain object reporting:
 * - ratePerWeek: estimated rate of weight change (7 * beta)
 * - observationCount: valid observations entering regression (n)
 * - degreesOfFreedom: regression degrees of freedom (df = n - 2)
 * - hac: uncertainty estimates for HAC(7), HAC(14), and HAC(30) observation-index lags
 * - standardErrorPerWeekHac7, confidenceInterval95Hac7 (and 14, 30): direct accessors
 * - ols: conventional OLS SE and CI diagnostic
 *
 * Returns null if n < minObservations (default 3) or if observation time has zero variance.
 */
export function calculateWeightTrend(weightHistory, { windowDays = 14, minObservations = 3, referenceDate = null } = {}) {
  const obs = getWeightObservations(weightHistory, windowDays, referenceDate);
  if (obs.length < minObservations) return null;

  const model = fitLinearRegression(obs);
  if (!model) return null;

  const hac7 = calculateNeweyWestCovariance(model, 7);
  const hac14 = calculateNeweyWestCovariance(model, 14);
  const hac30 = calculateNeweyWestCovariance(model, 30);

  // OLS diagnostic
  const tCrit = getStudentTCriticalValue(model.df, 0.95);
  const olsSePerWeek = model.olsSeBeta * 7;
  const olsMargin = tCrit * olsSePerWeek;

  return {
    ratePerWeek: model.ratePerWeek,
    observationCount: model.n,
    degreesOfFreedom: model.df,
    hac: {
      7: hac7,
      14: hac14,
      30: hac30
    },
    standardErrorPerWeekHac7: hac7.standardErrorPerWeek,
    confidenceInterval95Hac7: hac7.confidenceInterval95,
    standardErrorPerWeekHac14: hac14.standardErrorPerWeek,
    confidenceInterval95Hac14: hac14.confidenceInterval95,
    standardErrorPerWeekHac30: hac30.standardErrorPerWeek,
    confidenceInterval95Hac30: hac30.confidenceInterval95,
    ols: {
      standardErrorPerWeek: olsSePerWeek,
      confidenceInterval95: {
        lower: model.ratePerWeek - olsMargin,
        upper: model.ratePerWeek + olsMargin
      }
    }
  };
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
