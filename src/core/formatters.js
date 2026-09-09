// ══════════════════════════════════════════
// FORMATTERS — Plain-text Result Presentation
// ══════════════════════════════════════════

import {
  calculateCurrentWeight,
  calculateMovingAverage,
  calculateWeightTrend,
  calculateIntakeStats,
  getLocalDateString
} from './stats.js';

/**
 * Formats macro values on ingredient line items (e.g. 31, 4.5, 0, 3.6, 63).
 * If close to integer, outputs integer; otherwise 1 decimal place.
 */
function formatItemMacro(val) {
  if (typeof val !== 'number' || isNaN(val)) return '0';
  const rounded = Math.round(val * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
    return Math.round(rounded).toString();
  }
  return rounded.toFixed(1);
}

/**
 * Formats physical quantity (e.g. 100, 154.5, 240).
 */
function formatQuantity(qty) {
  if (typeof qty !== 'number' || isNaN(qty)) return '0';
  const rounded = Math.round(qty * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
    return Math.round(rounded).toString();
  }
  return rounded.toFixed(1);
}

/**
 * Formats a percentage value to a specified number of decimal places.
 * Guarantees that any percentage rounding to 0.0% is formatted strictly as "0.0%" (or "0%" / "0.00%"),
 * never "-0.0%" or "+0.0%".
 *
 * @param {number} val - Numerical percentage value (e.g. -0.02, 15.4, 0)
 * @param {number} [decimals=1] - Number of decimal places (default: 1)
 * @param {boolean} [signed=false] - Whether to prefix non-zero positive values with '+'
 * @returns {string} Formatted percentage string (e.g. "0.0%", "-1.5%", "+3.2%")
 */
export function formatPercent(val, decimals = 1, signed = false) {
  if (val === null || val === undefined || isNaN(val)) {
    return decimals > 0 ? `0.${'0'.repeat(decimals)}%` : '0%';
  }
  const fixed = Math.abs(val).toFixed(decimals);
  if (parseFloat(fixed) === 0) {
    return `${fixed}%`;
  }
  const sign = val > 0 ? (signed ? '+' : '') : '-';
  return `${sign}${fixed}%`;
}

/**
 * Formats signed deviation and percentage for calories.
 * e.g. "(-31 kcal, -1.3%)" or "(+15 kcal, +0.6%)" or "(0 kcal, 0.0%)"
 */
export function formatCalorieDeviation(absDev, pctDev) {
  const roundedAbs = Math.round(absDev);
  let absStr;

  if (roundedAbs > 0) {
    absStr = `+${roundedAbs} kcal`;
  } else if (roundedAbs < 0) {
    absStr = `-${Math.abs(roundedAbs)} kcal`;
  } else {
    absStr = '0 kcal';
  }

  const pctStr = formatPercent(pctDev, 1, true);
  return `(${absStr}, ${pctStr})`;
}

/**
 * Formats signed deviation and percentage for macronutrients (P, C, F).
 * e.g. "(-3.9 g, -6.2%)" or "(+2.0 g, +1.3%)" or "(0.0 g, 0.0%)"
 */
export function formatMacroDeviation(absDev, pctDev) {
  const roundedAbs = Math.round(absDev * 10) / 10;
  let absStr;

  if (roundedAbs > 0.001) {
    absStr = `+${roundedAbs.toFixed(1)} g`;
  } else if (roundedAbs < -0.001) {
    absStr = `-${Math.abs(roundedAbs).toFixed(1)} g`;
  } else {
    absStr = '0.0 g';
  }

  const pctStr = formatPercent(pctDev, 1, true);
  return `(${absStr}, ${pctStr})`;
}

/**
 * Pure plain-text formatter for daily solver results.
 * 
 * @param {Object} result - Solver result containing totals, mealResults, and optional deviations
 * @param {Object} [targets] - Target calories and macros (calories, protein, carbs, fat)
 * @param {Array} [customFoods] - Optional custom food entries to include in meal listings
 * @returns {string} Plain-text formatted daily summary
 */
export function formatDailySummary(result, targets = null, customFoods = []) {
  if (!result || typeof result !== 'object') {
    return '';
  }

  const resolvedTargets = targets || result.targets || {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  };

  const totals = result.totals || {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  };

  const effectiveTotals = result.combinedTotals || totals;
  const effectiveDeviations = result.combinedDeviations || result.deviations;

  const getDev = (key) => {
    if (effectiveDeviations && effectiveDeviations[key]) {
      return effectiveDeviations[key];
    }
    const absDev = (effectiveTotals[key] || 0) - (resolvedTargets[key] || 0);
    const tgt = resolvedTargets[key] || 0;
    const pctDev = tgt > 0 ? (absDev / tgt) * 100 : 0;
    return { absolute: absDev, percentage: pctDev };
  };

  const calDev = getDev('calories');
  const proDev = getDev('protein');
  const carbDev = getDev('carbs');
  const fatDev = getDev('fat');

  const calTarget = Math.round(resolvedTargets.calories || 0);
  const proTarget = resolvedTargets.protein !== undefined && resolvedTargets.protein !== null
    ? (Number.isInteger(resolvedTargets.protein) ? String(resolvedTargets.protein) : Number(resolvedTargets.protein).toString())
    : '0';
  const carbTarget = resolvedTargets.carbs !== undefined && resolvedTargets.carbs !== null
    ? (Number.isInteger(resolvedTargets.carbs) ? String(resolvedTargets.carbs) : Number(resolvedTargets.carbs).toString())
    : '0';
  const fatTarget = resolvedTargets.fat !== undefined && resolvedTargets.fat !== null
    ? (Number.isInteger(resolvedTargets.fat) ? String(resolvedTargets.fat) : Number(resolvedTargets.fat).toString())
    : '0';

  const lines = [
    'DAILY SUMMARY',
    ''
  ];

  if (result.customFoodTotals && (result.customFoodTotals.calories > 0 || result.customFoodTotals.protein > 0 || result.customFoodTotals.carbs > 0 || result.customFoodTotals.fat > 0)) {
    const cf = result.customFoodTotals;
    const pStr = cf.proteinUnknown ? '—' : `${cf.protein.toFixed(1)}g`;
    const cStr = cf.carbsUnknown ? '—' : `${cf.carbs.toFixed(1)}g`;
    const fStr = cf.fatUnknown ? '—' : `${cf.fat.toFixed(1)}g`;
    lines.push(`TARGET: ${calTarget} kcal | ${proTarget}P | ${carbTarget}C | ${fatTarget}F`);
    lines.push(`CUSTOM FOODS: ${Math.round(cf.calories)} kcal | ${pStr}P | ${cStr}C | ${fStr}F`);
    lines.push(`OPTIMIZED FOODS: ${Math.round(totals.calories || 0)} kcal | ${(totals.protein || 0).toFixed(1)}P | ${(totals.carbs || 0).toFixed(1)}C | ${(totals.fat || 0).toFixed(1)}F`);
    lines.push(`TOTAL: ${Math.round(effectiveTotals.calories || 0)} kcal | ${(effectiveTotals.protein || 0).toFixed(1)}P | ${(effectiveTotals.carbs || 0).toFixed(1)}C | ${(effectiveTotals.fat || 0).toFixed(1)}F`);
    lines.push('');
  }

  lines.push(`Calories: ${Math.round(effectiveTotals.calories || 0)} / ${calTarget} kcal ${formatCalorieDeviation(calDev.absolute, calDev.percentage)}`);
  lines.push(`Protein: ${(effectiveTotals.protein || 0).toFixed(1)} / ${proTarget} g ${formatMacroDeviation(proDev.absolute, proDev.percentage)}`);
  lines.push(`Carbs: ${(effectiveTotals.carbs || 0).toFixed(1)} / ${carbTarget} g ${formatMacroDeviation(carbDev.absolute, carbDev.percentage)}`);
  lines.push(`Fat: ${(effectiveTotals.fat || 0).toFixed(1)} / ${fatTarget} g ${formatMacroDeviation(fatDev.absolute, fatDev.percentage)}`);

  const mealResults = Array.isArray(result.mealResults) ? result.mealResults : [];
  const cfFoods = Array.isArray(customFoods) ? customFoods : [];

  mealResults.forEach(meal => {
    lines.push('');
    lines.push((meal.name || 'MEAL').toUpperCase());

    const items = Array.isArray(meal.items) ? meal.items : [];
    items.forEach(item => {
      const servings = typeof item.servings === 'number' ? item.servings : 0;
      const servingsFormatted = servings.toFixed(2);
      const servingWord = Math.abs(servings - 1.0) < 0.001 ? 'serving' : 'servings';

      const qty = typeof item.quantity === 'number'
        ? item.quantity
        : (typeof item.displayQuantity === 'number' ? item.displayQuantity : servings * (item.servingSize || 100));
      const qtyStr = formatQuantity(qty);
      const unit = item.unit || 'g';

      const cal = typeof item.calories === 'number' ? Math.round(item.calories) : 0;
      const p = formatItemMacro(item.protein);
      const c = formatItemMacro(item.carbs);
      const f = formatItemMacro(item.fat);

      lines.push(`${item.name} — ${servingsFormatted} ${servingWord} (${qtyStr} ${unit}) — ${cal} kcal — ${p}P / ${c}C / ${f}F`);
    });

    // Include custom foods assigned to this meal
    const mealCustom = cfFoods.filter(cf => {
      const cfMeal = cf.meal;
      return cfMeal === meal.id || cfMeal === meal.name;
    });
    mealCustom.forEach(cf => {
      const cal = typeof cf.calories === 'number' ? Math.round(cf.calories) : '—';
      const p = typeof cf.protein === 'number' ? formatItemMacro(cf.protein) : '—';
      const c = typeof cf.carbs === 'number' ? formatItemMacro(cf.carbs) : '—';
      const f = typeof cf.fat === 'number' ? formatItemMacro(cf.fat) : '—';
      const amt = typeof cf.amount === 'number' ? formatQuantity(cf.amount) : '1';
      const unit = cf.unit || 'serving';
      lines.push(`Custom · ${cf.name} — ${amt} ${unit} — ${cal} kcal — ${p}P / ${c}C / ${f}F`);
    });
  });

  // Include unassigned custom foods (not linked to any meal)
  const unassigned = cfFoods.filter(cf => {
    if (!cf.meal) return true;
    return !mealResults.some(m => m.id === cf.meal || m.name === cf.meal);
  });
  if (unassigned.length > 0) {
    lines.push('');
    lines.push('CUSTOM FOODS (UNASSIGNED)');
    unassigned.forEach(cf => {
      const cal = typeof cf.calories === 'number' ? Math.round(cf.calories) : '—';
      const p = typeof cf.protein === 'number' ? formatItemMacro(cf.protein) : '—';
      const c = typeof cf.carbs === 'number' ? formatItemMacro(cf.carbs) : '—';
      const f = typeof cf.fat === 'number' ? formatItemMacro(cf.fat) : '—';
      const amt = typeof cf.amount === 'number' ? formatQuantity(cf.amount) : '1';
      const unit = cf.unit || 'serving';
      lines.push(`Custom · ${cf.name} — ${amt} ${unit} — ${cal} kcal — ${p}P / ${c}C / ${f}F`);
    });
  }

  return lines.join('\n');
}

/**
 * Formats a comprehensive plain-text statistical summary of weight trend and nutritional history
 * for clipboard export. Covers ALL logged intake (no window limit) and outputs every
 * descriptive stat: n, mean, median, SD, min, max, range, diff, % diff, plus
 * calorie-contribution rows for each macro.
 *
 * @param {Object} [options={}]
 * @param {Object} [options.weightHistory] - Weight entries keyed by YYYY-MM-DD
 * @param {Object} [options.intakeHistory] - Intake entries keyed by YYYY-MM-DD
 * @param {Object} [options.targets] - Daily nutrient targets (calories, protein, carbs, fat)
 * @param {number} [options.windowDays] - Ignored — all history is used; kept for API compat
 * @param {string} [options.referenceDate] - YYYY-MM-DD reference date (defaults to today)
 * @returns {string} Formatted plain-text summary
 */
export function formatWeightAndNutritionSummary({
  weightHistory = {},
  intakeHistory = {},
  targets = null,
  windowDays,        // kept for API compatibility — ignored; we always use full history
  referenceDate = null
} = {}) {
  const refDate = referenceDate || getLocalDateString();

  // ── Weight metrics ──────────────────────────────────────────────────────────
  const curW    = calculateCurrentWeight(weightHistory, refDate);
  const avg7    = calculateMovingAverage(weightHistory, 7,  refDate);
  const avg14   = calculateMovingAverage(weightHistory, 14, refDate);
  const trendRate = calculateWeightTrend(weightHistory, {
    windowDays: 14, minObservations: 3, referenceDate: refDate
  });

  const wFmt = (v) => (v !== null ? `${v.toFixed(1)} lb` : '—');
  let rateDisplay = '—';
  if (trendRate !== null) {
    const sign = trendRate > 0.001 ? '+' : '';
    rateDisplay = `${sign}${trendRate.toFixed(2)} lb/wk`;
  }

  // ── Intake stats over ALL history (windowDays = null) ────────────────────────
  const intakeStats = calculateIntakeStats(intakeHistory, null, refDate, targets);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const COL_W = 14;   // label column width
  const pad  = (s, w = COL_W) => String(s).padEnd(w);
  const sep  = (char = '─', len = 72) => char.repeat(len);

  /** Format a numeric value; kcal rounded to integer, macros to 1 dp */
  const fv = (v, isKcal) => {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
    return isKcal ? Math.round(v).toLocaleString() : Number(v).toFixed(1);
  };

  /**
   * Build a compact stat block for one nutrient.
   * Returns an array of lines.
   */
  const buildStatBlock = (label, stat, unit, isKcal = false) => {
    if (!stat || stat.n === 0 || stat.mean === null) {
      return [`${pad(label)}n=0  (no data)`];
    }

    const u   = unit ? ` ${unit}` : '';
    const obs = stat.n;
    const mn  = fv(stat.mean,   isKcal);
    const med = fv(stat.median, isKcal);
    const sd  = stat.sd !== null ? fv(stat.sd, isKcal) : '—';
    const mi  = fv(stat.min,  isKcal);
    const mx  = fv(stat.max,  isKcal);
    const rng = (stat.min !== null && stat.max !== null)
      ? `${mi}–${mx}${u}`
      : '—';

    let diffStr = '—';
    let pctStr  = '—';
    let tgtStr  = '—';
    if (stat.target !== null && stat.difference !== null) {
      tgtStr  = `${fv(stat.target, isKcal)}${u}`;
      const sign = stat.difference >= 0 ? '+' : '';
      diffStr = `${sign}${fv(stat.difference, isKcal)}${u}`;
      pctStr  = stat.percentDifference !== null
        ? formatPercent(stat.percentDifference, 2, true)
        : '—';
    }

    return [
      `${pad(label)}n=${obs}  mean=${mn}${u}  median=${med}${u}  SD=${sd}${u}`,
      `${pad('')}min=${mi}${u}  max=${mx}${u}  range=${rng}`,
      `${pad('')}target=${tgtStr}  diff=${diffStr}  %diff=${pctStr}`
    ];
  };

  // ── Calorie-contribution stats ───────────────────────────────────────────────
  /**
   * Derive per-observation calorie-from-macro values and compute stats inline.
   */
  const derivedCalStats = (key, kcalPerG) => {
    const src = intakeStats[key];
    if (!src || src.n === 0 || src.mean === null) return null;

    // Reconstruct the distribution by scaling the raw stats isn't possible without
    // raw values, so we approximate using the available descriptive stats (mean,
    // median, SD, min, max are linearly scaled by kcalPerG).
    const scale = (v) => (v !== null ? v * kcalPerG : null);

    const tgt  = src.target !== null ? src.target * kcalPerG : null;
    const diff = src.difference !== null ? src.difference * kcalPerG : null;
    const pct  = src.percentDifference;   // % doesn't change under linear scaling

    return {
      n:                src.n,
      mean:             scale(src.mean),
      median:           scale(src.median),
      sd:               scale(src.sd),
      min:              scale(src.min),
      max:              scale(src.max),
      target:           tgt,
      difference:       diff,
      percentDifference: pct
    };
  };

  // ── Macro calorie split (based on mean intakes) ──────────────────────────────
  const avgC = intakeStats.carbs?.mean  ?? null;
  const avgF = intakeStats.fat?.mean    ?? null;
  const avgP = intakeStats.protein?.mean ?? null;

  let macroSplitLines = [];
  if (avgC !== null && avgF !== null && avgP !== null) {
    const kcalC    = avgC * 4;
    const kcalF    = avgF * 9;
    const kcalP    = avgP * 4;
    const kcalTot  = kcalC + kcalF + kcalP;
    if (kcalTot > 0) {
      macroSplitLines = [
        sep(),
        'MACRO CALORIE SPLIT (based on mean intakes)',
        sep(),
        `${'Carbs (4 kcal/g)'.padEnd(22)}avg ${fv(kcalC, true)} kcal/day  (${formatPercent((kcalC / kcalTot) * 100, 1)})`,
        `${'Fat (9 kcal/g)'.padEnd(22)}avg ${fv(kcalF, true)} kcal/day  (${formatPercent((kcalF / kcalTot) * 100, 1)})`,
        `${'Protein (4 kcal/g)'.padEnd(22)}avg ${fv(kcalP, true)} kcal/day  (${formatPercent((kcalP / kcalTot) * 100, 1)})`,
        `${'Total from macros'.padEnd(22)}avg ${fv(kcalTot, true)} kcal/day`
      ];
    }
  }

  // ── Assemble lines ──────────────────────────────────────────────────────────
  const lines = [
    'WEIGHT & NUTRITIONAL SUMMARY',
    '',
    sep(),
    'WEIGHT TREND',
    sep(),
    `Current:    ${wFmt(curW)}`,
    `7-Day Avg:  ${wFmt(avg7)}`,
    `14-Day Avg: ${wFmt(avg14)}`,
    `Rate:       ${rateDisplay}`,
  ];

  if (!intakeStats || intakeStats.distinctDays === 0) {
    lines.push('');
    lines.push(sep());
    lines.push('NUTRITIONAL STATISTICS');
    lines.push(sep());
    lines.push('No intake snapshots recorded.');
    return lines.join('\n');
  }

  const totalObs = intakeStats.calories?.n ?? intakeStats.distinctDays;
  lines.push('');
  lines.push(sep());
  lines.push(`NUTRITIONAL STATISTICS  (n=${totalObs} logged days, all history)`);
  lines.push(sep());
  lines.push('');

  // Calories
  lines.push('── CALORIES ──');
  buildStatBlock('Calories', intakeStats.calories, 'kcal', true).forEach(l => lines.push(l));

  // Cals from carbs
  lines.push('');
  lines.push('── CALORIES FROM CARBS ──');
  buildStatBlock('Cals·Carbs', derivedCalStats('carbs', 4), 'kcal', true).forEach(l => lines.push(l));

  // Cals from fat
  lines.push('');
  lines.push('── CALORIES FROM FAT ──');
  buildStatBlock('Cals·Fat', derivedCalStats('fat', 9), 'kcal', true).forEach(l => lines.push(l));

  // Cals from protein
  lines.push('');
  lines.push('── CALORIES FROM PROTEIN ──');
  buildStatBlock('Cals·Protein', derivedCalStats('protein', 4), 'kcal', true).forEach(l => lines.push(l));

  // Carbs
  lines.push('');
  lines.push('── CARBOHYDRATES ──');
  buildStatBlock('Carbs', intakeStats.carbs, 'g').forEach(l => lines.push(l));

  // Fat
  lines.push('');
  lines.push('── FAT ──');
  buildStatBlock('Fat', intakeStats.fat, 'g').forEach(l => lines.push(l));

  // Protein
  lines.push('');
  lines.push('── PROTEIN ──');
  buildStatBlock('Protein', intakeStats.protein, 'g').forEach(l => lines.push(l));

  // Macro split
  if (macroSplitLines.length > 0) {
    lines.push('');
    macroSplitLines.forEach(l => lines.push(l));
  }

  return lines.join('\n');
}

