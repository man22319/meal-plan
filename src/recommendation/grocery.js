// ══════════════════════════════════════════
// GROCERY RECOMMENDATION SCORER & DIVERSITY SELECTOR
// ══════════════════════════════════════════
// Evaluates ingredients on forward-looking stocking utility, nutritional density,
// macro flexibility, and target compatibility for future meal planning,
// decoupled from today's specific solve state.

import { resolveAvailability } from '../core/state.js';
import { PRECISION } from '../core/precision.js';

export const NUTRITIONAL_ROLES = {
  LEAN_PROTEIN: 'LEAN_PROTEIN',
  CLEAN_CARB: 'CLEAN_CARB',
  HEALTHY_FAT: 'HEALTHY_FAT',
  BALANCED_STAPLE: 'BALANCED_STAPLE'
};

export const ROLE_LABELS = {
  LEAN_PROTEIN: 'Lean Protein Anchor',
  CLEAN_CARB: 'Clean Carb Balancer',
  HEALTHY_FAT: 'Healthy Fat Source',
  BALANCED_STAPLE: 'Balanced Macro Staple'
};

/**
 * Derives the nutritional role of an ingredient purely from its macronutrient composition.
 * Centralizes thresholds to avoid hardcoded food taxonomies.
 *
 * @param {object} ingredient - Ingredient data ({ calories, protein, carbs, fat }).
 * @returns {string} One of NUTRITIONAL_ROLES.
 */
export function deriveNutritionalRole(ingredient) {
  const p = Math.max(0, Number(ingredient.protein) || 0);
  const c = Math.max(0, Number(ingredient.carbs) || 0);
  const f = Math.max(0, Number(ingredient.fat) || 0);

  const calFromP = p * 4;
  const calFromC = c * 4;
  const calFromF = f * 9;
  const totalMacroCal = calFromP + calFromC + calFromF;

  if (totalMacroCal <= 0) {
    return NUTRITIONAL_ROLES.BALANCED_STAPLE;
  }

  const pRatio = calFromP / totalMacroCal;
  const cRatio = calFromC / totalMacroCal;
  const fRatio = calFromF / totalMacroCal;

  // 1. Protein dominance: >= 45% calories from protein OR protein density >= 0.15 g/kcal
  const rawCals = Number(ingredient.calories) || totalMacroCal;
  const pDensity = rawCals > 0 ? p / rawCals : 0;
  if (pRatio >= 0.45 || pDensity >= 0.15) {
    return NUTRITIONAL_ROLES.LEAN_PROTEIN;
  }

  // 2. Carb dominance: >= 55% calories from carbohydrates
  if (cRatio >= 0.55) {
    return NUTRITIONAL_ROLES.CLEAN_CARB;
  }

  // 3. Fat dominance: >= 50% calories from fats
  if (fRatio >= 0.50) {
    return NUTRITIONAL_ROLES.HEALTHY_FAT;
  }

  // 4. Balanced multi-macro staple
  return NUTRITIONAL_ROLES.BALANCED_STAPLE;
}

/**
 * Evaluates the grocery and future stocking utility of an ingredient.
 *
 * Scoring Components:
 * 1. Macro Density & Purity (0 to 1): High density / low caloric overhead in its dominant role.
 * 2. Target Compatibility (0 to 1): How harmoniously the food matches the user's daily macro targets.
 * 3. Macro Flexibility (0 to 1): Purity of single-macro delivery (minimal unwanted cross-coupling).
 * 4. Resilience Contribution (0 to 1): Versatility as a reliable everyday staple.
 * 5. Inventory Urgency (Multiplier in [1.0, 1.35]): Urgency boost for out/low/limited items.
 *
 * The contract ensures:
 * - Urgency modulates priority on useful items, but cannot turn a low-utility item into #1.
 * - Explanation strings are generated directly from the computed metric components.
 *
 * @param {object} ingredient - Ingredient object.
 * @param {object} [targets] - Daily macro targets.
 * @param {object} [weights] - User macro weights.
 * @param {object} [state] - Current application state.
 * @returns {object} Structured evaluation result with score, role, reasons, and metrics.
 */
export function scoreIngredientGroceryUtility(ingredient, targets = {}, weights = {}, _state = {}) {
  const tgts = {
    calories: targets.calories > 0 ? targets.calories : 2000,
    protein: targets.protein > 0 ? targets.protein : 150,
    carbs: targets.carbs > 0 ? targets.carbs : 200,
    fat: targets.fat > 0 ? targets.fat : 60
  };

  const w = {
    calories: typeof weights.calories === 'number' ? weights.calories : 1.0,
    protein: typeof weights.protein === 'number' ? weights.protein : 1.0,
    carbs: typeof weights.carbs === 'number' ? weights.carbs : 0.5,
    fat: typeof weights.fat === 'number' ? weights.fat : 0.5
  };

  const p = Math.max(0, Number(ingredient.protein) || 0);
  const c = Math.max(0, Number(ingredient.carbs) || 0);
  const f = Math.max(0, Number(ingredient.fat) || 0);
  const cal = Math.max(1, Number(ingredient.calories) || (p * 4 + c * 4 + f * 9));

  const role = deriveNutritionalRole(ingredient);
  const reasons = [];

  // 1. Macro Density & Purity (0 to 1)
  let macroDensity = 0;
  if (role === NUTRITIONAL_ROLES.LEAN_PROTEIN) {
    // Protein density: 30g P / 150 kcal = 0.20 -> score ~ 0.85-0.95
    const pPerCal = p / cal;
    macroDensity = Math.min(1.0, pPerCal * 4.5);
    reasons.push(`High protein concentration (${p.toFixed(1)}g P per serving / ${Math.round(cal)} kcal)`);
  } else if (role === NUTRITIONAL_ROLES.CLEAN_CARB) {
    // Clean carb: high carbs with low fat ratio
    const cRatio = (c * 4) / Math.max(1, cal);
    const lowFatBonus = Math.max(0, 1 - (f * 9) / Math.max(1, cal));
    macroDensity = Math.min(1.0, (cRatio * 0.7) + (lowFatBonus * 0.3));
    reasons.push(`Clean carbohydrate source (${c.toFixed(1)}g C with low fat overhead)`);
  } else if (role === NUTRITIONAL_ROLES.HEALTHY_FAT) {
    // Healthy fat: reward controlled, moderate fat delivery (5-15g) without single-serving fat bomb overload
    const fRatio = (f * 9) / Math.max(1, cal);
    const portionManageable = f <= 18 ? 1.0 : Math.max(0.3, 1.0 - (f - 18) / 25);
    macroDensity = Math.min(0.85, fRatio * 0.8 * portionManageable);
    reasons.push(`Controlled dietary fat builder (${f.toFixed(1)}g F per serving)`);
  } else {
    // Balanced staple
    macroDensity = 0.65;
    reasons.push(`Balanced multi-macro composition (P=${p.toFixed(1)}g, C=${c.toFixed(1)}g, F=${f.toFixed(1)}g)`);
  }

  // 2. Target Compatibility (0 to 1)
  // Evaluates macro yield relative to caloric cost against daily target vector
  const pYield = (p / tgts.protein) * (tgts.calories / Math.max(1, cal));
  const cYield = (c / tgts.carbs) * (tgts.calories / Math.max(1, cal));
  const fYield = (f / tgts.fat) * (tgts.calories / Math.max(1, cal));
  const weightedYield = (pYield * 0.5 * w.protein) + (cYield * 0.3 * w.carbs) + (fYield * 0.2 * w.fat);
  const targetCompatibility = Math.max(0.1, Math.min(1.0, weightedYield / 1.4));

  // 3. Macro Flexibility (0 to 1)
  // Measures purity on a single macro axis vs unwanted cross-coupling
  const calP = p * 4;
  const calC = c * 4;
  const calF = f * 9;
  const totalCal = Math.max(1, calP + calC + calF);
  const shares = [calP / totalCal, calC / totalCal, calF / totalCal];
  const maxShare = Math.max(...shares);
  // Dominant single macro share close to 1.0 gives high flexibility (solver can tune one axis freely)
  const macroFlexibility = Math.min(1.0, Math.max(0.3, maxShare * 1.05));
  if (macroFlexibility >= 0.75) {
    reasons.push('High macro flexibility: isolated nutritional profile minimizes solver coupling');
  }

  // 4. Resilience Contribution (0 to 1)
  // Versatile portion capacity and realistic serving bounds
  const maxS = typeof ingredient.maxServings === 'number' && ingredient.maxServings > 0 ? ingredient.maxServings : 5;
  const resilience = Math.min(1.0, 0.5 + (Math.min(maxS, 6) / 12));

  // 5. Inventory Urgency (Multiplier in [1.0, 1.15])
  // Urgency provides a priority boost for out/low stock items, but cannot turn a low-utility item into #1.
  const currentAvail = resolveAvailability(ingredient.availability);
  let inventoryUrgency = 1.0;
  let urgencyLabel = 'IN STOCK';

  if (currentAvail === 'out') {
    inventoryUrgency = 1.15;
    urgencyLabel = 'OUT → BUY';
    reasons.push('Currently OUT OF STOCK in pantry');
  } else if (currentAvail === 'limited') {
    inventoryUrgency = 1.10;
    urgencyLabel = 'LIMITED → STOCK UP';
    reasons.push('Limited availability cap (<= 2.0 servings)');
  } else if (currentAvail === 'low') {
    inventoryUrgency = 1.05;
    urgencyLabel = 'LOW → RESTOCK';
    reasons.push('Low inventory cap (<= 3.0 servings)');
  } else {
    inventoryUrgency = 1.0;
    urgencyLabel = 'AVAILABLE';
  }

  // Core Nutritional Base Utility (0 to 100)
  const baseUtility = (
    (macroDensity * 0.35) +
    (targetCompatibility * 0.25) +
    (macroFlexibility * 0.25) +
    (resilience * 0.15)
  ) * 100;

  // Final Grocery Score with Urgency Multiplier
  const finalScore = Math.round(baseUtility * inventoryUrgency * 10) / 10;

  return {
    score: finalScore,
    baseUtility: Math.round(baseUtility * 10) / 10,
    role,
    roleLabel: ROLE_LABELS[role] || role,
    urgencyLabel,
    availability: currentAvail,
    reasons,
    metrics: {
      macroDensity: Math.round(macroDensity * 100) / 100,
      targetCompatibility: Math.round(targetCompatibility * 100) / 100,
      macroFlexibility: Math.round(macroFlexibility * 100) / 100,
      resilience: Math.round(resilience * 100) / 100,
      inventoryUrgency
    }
  };
}

/**
 * Evaluates all ingredients and returns top diverse grocery recommendations.
 *
 * Diversity Logic:
 * - Ranks candidates within their nutritional roles.
 * - Picks the top candidate from each present role (Lean Protein, Clean Carb, Healthy Fat, Balanced Staple)
 *   to ensure a well-rounded shopping basket.
 * - Fills remaining recommendation slots with the highest overall scoring candidates.
 *
 * @param {object} state - Application state.
 * @param {object} [options] - Options (limit = 5, candidatePool).
 * @returns {Array<object>} Ranked, diverse grocery recommendations.
 */
export function getGroceryRecommendations(state, options = {}) {
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 5;
  const ingredients = state?.ingredients || [];
  const targets = state?.targets || { calories: 2000, protein: 150, carbs: 200, fat: 60 };
  const weights = state?.weights || { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5 };

  // Combine pantry ingredients + candidate pool
  const allCandidates = [];
  const seenIds = new Set();
  const seenNames = new Set();

  ingredients.forEach(ing => {
    const nameNorm = (ing.name || '').trim().toLowerCase();
    if (!nameNorm || seenNames.has(nameNorm)) return;
    seenNames.add(nameNorm);
    if (ing.id) seenIds.add(ing.id);

    allCandidates.push({
      ...ing,
      isPoolItem: false
    });
  });

  const candidatePool = options.candidatePool || options.candidateIngredients || [];
  if (Array.isArray(candidatePool)) {
    candidatePool.forEach((poolIng, idx) => {
      const nameNorm = (poolIng.name || '').trim().toLowerCase();
      if (!nameNorm || seenNames.has(nameNorm) || (poolIng.id && seenIds.has(poolIng.id))) return;
      seenNames.add(nameNorm);
      if (poolIng.id) seenIds.add(poolIng.id);

      allCandidates.push({
        ...poolIng,
        id: poolIng.id || `pool_${idx}_${nameNorm.replace(/\s+/g, '_')}`,
        availability: 'out',
        isPoolItem: true
      });
    });
  }

  // Score all ingredients
  const scored = allCandidates.map(ing => {
    const evalResult = scoreIngredientGroceryUtility(ing, targets, weights, state);
    return {
      ingredientId: ing.id,
      ingredientName: ing.name,
      servingSize: ing.servingSize,
      unit: ing.unit || 'g',
      calories: ing.calories,
      protein: ing.protein,
      carbs: ing.carbs,
      fat: ing.fat,
      availability: evalResult.availability,
      isPoolItem: ing.isPoolItem,
      ...evalResult
    };
  });

  // Sort overall by score descending, tie-broken by ingredient name
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > PRECISION.NUMERICAL_ZERO_EPS) return diff;
    return a.ingredientName.localeCompare(b.ingredientName);
  });

  // Apply Diversity Logic:
  // 1. Group candidates by derived nutritional role
  const roleBuckets = {
    [NUTRITIONAL_ROLES.LEAN_PROTEIN]: [],
    [NUTRITIONAL_ROLES.CLEAN_CARB]: [],
    [NUTRITIONAL_ROLES.HEALTHY_FAT]: [],
    [NUTRITIONAL_ROLES.BALANCED_STAPLE]: []
  };

  scored.forEach(item => {
    if (roleBuckets[item.role]) {
      roleBuckets[item.role].push(item);
    }
  });

  const selected = [];
  const selectedKeys = new Set();

  function tryAdd(item) {
    if (!item) return false;
    const key = item.ingredientId || item.ingredientName;
    if (selectedKeys.has(key)) return false;
    selected.push(item);
    selectedKeys.add(key);
    return true;
  }

  // Pass 1: Select top candidate from each primary role (Protein, Carb, Fat, Balanced)
  const rolePriority = [
    NUTRITIONAL_ROLES.LEAN_PROTEIN,
    NUTRITIONAL_ROLES.CLEAN_CARB,
    NUTRITIONAL_ROLES.HEALTHY_FAT,
    NUTRITIONAL_ROLES.BALANCED_STAPLE
  ];

  rolePriority.forEach(role => {
    if (selected.length < limit && roleBuckets[role].length > 0) {
      tryAdd(roleBuckets[role][0]);
    }
  });

  // Pass 2: Fill remaining slots with the highest scoring candidates regardless of role
  for (const item of scored) {
    if (selected.length >= limit) break;
    tryAdd(item);
  }

  return selected.slice(0, limit);
}
