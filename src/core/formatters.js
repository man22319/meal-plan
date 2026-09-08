// ══════════════════════════════════════════
// FORMATTERS — Plain-text Result Presentation
// ══════════════════════════════════════════

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
 * @returns {string} Plain-text formatted daily summary
 */
export function formatDailySummary(result, targets = null) {
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
  });

  return lines.join('\n');
}
