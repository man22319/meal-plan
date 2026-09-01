import { resolveAvailability } from '../core/state.js';

export const AVAILABILITY_UPWARD_TRANSITIONS = {
  out: ['limited', 'low', 'normal'],
  limited: ['low', 'normal'],
  low: ['normal'],
  normal: []
};

/**
 * Computes Stage 1 geometric compatibility metrics between a candidate ingredient and current macro deficits.
 * Evaluates directional magnitude (D_k), cosine alignment (C_k), and composite geometric score (S_k).
 *
 * @param {object} candidateIng - Candidate ingredient nutritional definition.
 * @param {object} residualDeficit - Normalized macro deficit vector e_m = (Target_m - Current_m) / Target_m.
 * @param {object} targets - Daily macro targets.
 * @param {object} weights - Optimization macro weights.
 * @returns {object} { directionalMagnitude, cosineAlignment, geometricScore }
 */
export function scoreCandidateGeometry(candidateIng, residualDeficit = {}, targets = {}, weights = {}) {
  const macros = ['calories', 'protein', 'carbs', 'fat'];
  const tgt = {
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

  let dotProduct = 0;       // D_k = e^T W v_k
  let normDeficitSq = 0;    // ||e||_W^2
  let normCandidateSq = 0;  // ||v_k||_W^2

  macros.forEach(m => {
    const weight = w[m];
    const e_m = typeof residualDeficit[m] === 'number' ? residualDeficit[m] : 0;
    const v_m = (Number(candidateIng[m]) || 0) / tgt[m];

    dotProduct += weight * e_m * v_m;
    normDeficitSq += weight * (e_m * e_m);
    normCandidateSq += weight * (v_m * v_m);
  });

  const normDeficit = Math.sqrt(normDeficitSq);
  const normCandidate = Math.sqrt(normCandidateSq);

  let cosineAlignment = 0;
  if (normDeficit > 1e-6 && normCandidate > 1e-6) {
    cosineAlignment = Math.max(-1, Math.min(1, dotProduct / (normDeficit * normCandidate)));
  }

  // Modified scoring: handle both deficits (positive residual) and excess (negative residual)
  // For deficits: positive dotProduct is good (adds what's missing)
  // For excess: negative dotProduct is good (candidate with opposite composition could help balance)
  const absoluteScore = Math.abs(dotProduct) * Math.abs(cosineAlignment);

  return {
    directionalMagnitude: dotProduct,
    cosineAlignment,
    geometricScore: absoluteScore
  };
}

/**
 * Extracts normalized residual macro deficits e_m from baseline solve result.
 * e_m > 0 indicates a deficit (need more), e_m < 0 indicates an excess (over target).
 */
export function extractResidualDeficit(baselineSolve, targets = {}) {
  const macros = ['calories', 'protein', 'carbs', 'fat'];
  const residual = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const tgt = {
    calories: targets.calories > 0 ? targets.calories : 2000,
    protein: targets.protein > 0 ? targets.protein : 150,
    carbs: targets.carbs > 0 ? targets.carbs : 200,
    fat: targets.fat > 0 ? targets.fat : 60
  };

  if (!baselineSolve || !baselineSolve.result) {
    return residual;
  }

  const totals = baselineSolve.result.totals || {};
  macros.forEach(m => {
    const actual = typeof totals[m] === 'number' ? totals[m] : 0;
    residual[m] = (tgt[m] - actual) / tgt[m];
  });

  return residual;
}

/**
 * Generates candidate actions from a given application state with Stage 1 heuristic screening.
 * @param {object} state - Application state object.
 * @param {object} [options] - Optional configuration (candidatePool, poolLimit, baselineSolve).
 * @returns {Array<object>} Array of pure candidate action descriptors with Stage 1 metadata.
 */
export function generateCandidates(state, options = {}) {
  const candidates = [];
  const ingredients = state?.ingredients || [];
  const targets = state?.targets || { calories: 2000, protein: 150, carbs: 200, fat: 60 };
  const weights = state?.weights || { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5 };
  const baselineSolve = options.baselineSolve;
  const residualDeficit = extractResidualDeficit(baselineSolve, targets);

  console.log('Candidate generation - Residual deficits:', residualDeficit);

  // Determine if we have excess (over target) or deficit (under target)
  const hasExcess = Object.values(residualDeficit).some(v => v < -0.01);
  const hasDeficit = Object.values(residualDeficit).some(v => v > 0.01);

  console.log('Candidate generation - hasExcess:', hasExcess, 'hasDeficit:', hasDeficit);

  // 1. Availability Upgrades (RESTOCK) — emit maximal target (→ normal)
  // Only generate RESTOCK candidates if we have deficits (need more ingredients)
  // If we have excess, adding more ingredients will likely make things worse
  if (hasDeficit && !hasExcess) {
    ingredients.forEach(ing => {
      const currentAvail = resolveAvailability(ing.availability);
      if (currentAvail === 'normal') return;

      const targetAvail = 'normal';
      const ingId = ing.id || ing.name;
      const geom = scoreCandidateGeometry(ing, residualDeficit, targets, weights);

      candidates.push({
        id: `restock_${ingId}_${targetAvail}`,
        type: 'RESTOCK',
        ingredientId: ing.id,
        ingredientName: ing.name,
        from: currentAvail,
        to: targetAvail,
        label: `Restock ${ing.name} (${currentAvail} → ${targetAvail})`,
        mutation: {
          field: 'availability',
          value: targetAvail
        },
        stage1: {
          directionalMagnitude: geom.directionalMagnitude,
          cosineAlignment: geom.cosineAlignment,
          geometricScore: geom.geometricScore,
          passed: true
        }
      });
    });
  }

  // 2. Capacity Expansions (INCREASE_CAPACITY)
  // Only generate when we have deficits (need more capacity to meet targets)
  // When over target, we want to reduce, not expand
  if (hasDeficit) {
    console.log('Generating INCREASE_CAPACITY candidates (hasDeficit = true)');
    const usageMap = new Map();
    if (baselineSolve && Array.isArray(baselineSolve.result?.mealResults)) {
      baselineSolve.result.mealResults.forEach(m => {
        (m.items || []).forEach(it => {
          const id = it.id || it.name;
          const cur = usageMap.get(id) || 0;
          usageMap.set(id, cur + (it.servings || 0));
        });
      });
    }

    ingredients.forEach(ing => {
      const avail = resolveAvailability(ing.availability);
      if (avail === 'out') return;

      const currentMax = (typeof ing.maxServings === 'number' && ing.maxServings > 0)
        ? ing.maxServings
        : 5;

      if (currentMax >= 10) return;

      // Binding constraint heuristic filter: prioritize ingredients actively binding / near cap
      // Relaxed: only filter if usage is very low (< 10% of capacity) to allow more candidates
      if (baselineSolve && baselineSolve.feasible) {
        const ingKey = ing.id || ing.name;
        const usage = usageMap.get(ingKey) || 0;
        let effectiveCap = currentMax;
        if (avail === 'low') effectiveCap = Math.min(currentMax, 3);
        if (avail === 'limited') effectiveCap = Math.min(currentMax, 2);

        if (usage < effectiveCap * 0.1) {
          return;
        }
      }

      const targetMax = Math.min(Math.ceil(currentMax * 1.5), 10);
      if (targetMax <= currentMax) return;

      const ingId = ing.id || ing.name;
      const geom = scoreCandidateGeometry(ing, residualDeficit, targets, weights);

      candidates.push({
        id: `capacity_${ingId}_${targetMax}`,
        type: 'INCREASE_CAPACITY',
        ingredientId: ing.id,
        ingredientName: ing.name,
        from: currentMax,
        to: targetMax,
        label: `Increase ${ing.name} max servings (${currentMax} → ${targetMax})`,
        mutation: {
          field: 'maxServings',
          value: targetMax
        },
        stage1: {
          directionalMagnitude: geom.directionalMagnitude,
          cosineAlignment: geom.cosineAlignment,
          geometricScore: geom.geometricScore,
          passed: true
        }
      });
    });
  } else {
    console.log('Skipping INCREASE_CAPACITY candidates (hasDeficit = false)');
  }

  // 3. Reduction Candidates (when over target)
  if (hasExcess) {
    console.log('Generating REDUCE_CAPACITY candidates (hasExcess = true)');
    // 3a. Reduce max servings for ingredients that are currently used and contribute to excess
    const usageMap = new Map();
    const ingredientCalories = new Map();

    if (baselineSolve && Array.isArray(baselineSolve.result?.mealResults)) {
      baselineSolve.result.mealResults.forEach(m => {
        (m.items || []).forEach(it => {
          const id = it.id || it.name;
          const cur = usageMap.get(id) || 0;
          usageMap.set(id, cur + (it.servings || 0));
          ingredientCalories.set(id, (ingredientCalories.get(id) || 0) + (it.calories || 0));
        });
      });
    }

    let reduceCount = 0;
    ingredients.forEach(ing => {
      const avail = resolveAvailability(ing.availability);
      if (avail === 'out') return;

      const currentMax = (typeof ing.maxServings === 'number' && ing.maxServings > 0)
        ? ing.maxServings
        : 5;

      const ingKey = ing.id || ing.name;
      const usage = usageMap.get(ingKey) || 0;

      // Only consider reducing ingredients that are actually being used
      if (usage < 0.1) return;

      // Only reduce if we have room to reduce (currentMax > 1)
      if (currentMax <= 1) return;

      // Target: reduce by 50% or to 1, whichever is higher
      const targetMax = Math.max(1, Math.floor(currentMax * 0.5));
      if (targetMax >= currentMax) return;

      const ingId = ing.id || ing.name;
      const geom = scoreCandidateGeometry(ing, residualDeficit, targets, weights);

      reduceCount++;
      candidates.push({
        id: `reduce_${ingId}_${targetMax}`,
        type: 'REDUCE_CAPACITY',
        ingredientId: ing.id,
        ingredientName: ing.name,
        from: currentMax,
        to: targetMax,
        label: `Reduce ${ing.name} max servings (${currentMax} → ${targetMax})`,
        mutation: {
          field: 'maxServings',
          value: targetMax
        },
        stage1: {
          directionalMagnitude: geom.directionalMagnitude,
          cosineAlignment: geom.cosineAlignment,
          geometricScore: geom.geometricScore,
          passed: true
        }
      });
    });

    console.log(`Generated ${reduceCount} REDUCE_CAPACITY candidates`);

    // 3b. Skip availability reductions - they're mostly ineffective
    // Only use capacity reductions which actually constrain the solver
  } else {
    console.log('Skipping REDUCE_CAPACITY candidates (hasExcess = false)');
  }

  // 4. Pool Ingredient Additions (ADD_INGREDIENT) — Stage 1 Heuristic Candidate Reduction
  const candidatePool = options.candidatePool || options.candidateIngredients || [];
  if (Array.isArray(candidatePool) && candidatePool.length > 0) {
    const activeNames = new Set(ingredients.map(i => i.name.trim().toLowerCase()));
    const activeIds = new Set(ingredients.map(i => i.id).filter(Boolean));

    // Score all distinct candidate pool ingredients
    const scoredPool = [];

    candidatePool.forEach((poolIng, idx) => {
      const ingNameNorm = (poolIng.name || '').trim().toLowerCase();
      if (!ingNameNorm || activeNames.has(ingNameNorm) || (poolIng.id && activeIds.has(poolIng.id))) {
        return;
      }

      const ingId = poolIng.id || `candidate_${idx}_${ingNameNorm.replace(/\s+/g, '_')}`;
      const candidateCopy = {
        ...poolIng,
        id: ingId,
        availability: 'normal',
        minServings: typeof poolIng.minServings === 'number' ? poolIng.minServings : 0,
        maxServings: typeof poolIng.maxServings === 'number' ? poolIng.maxServings : 5,
        quantityMode: poolIng.quantityMode || 'continuous'
      };

      const geom = scoreCandidateGeometry(candidateCopy, residualDeficit, targets, weights);

      scoredPool.push({
        candidateData: candidateCopy,
        ingId,
        poolIng,
        geom
      });
    });

    // Stage 1 Selection: sort by composite geometric score descending
    scoredPool.sort((a, b) => b.geom.geometricScore - a.geom.geometricScore);

    const poolLimit = typeof options.poolLimit === 'number' && options.poolLimit > 0
      ? options.poolLimit
      : 25;

    const selectedPool = scoredPool.slice(0, poolLimit);

    selectedPool.forEach(({ candidateData, ingId, poolIng, geom }) => {
      candidates.push({
        id: `add_${ingId}`,
        type: 'ADD_INGREDIENT',
        ingredientId: ingId,
        ingredientName: poolIng.name,
        from: null,
        to: 'normal',
        label: `Add ${poolIng.name} to ingredient pool`,
        candidateData,
        mutation: {
          action: 'add',
          ingredient: candidateData
        },
        stage1: {
          directionalMagnitude: geom.directionalMagnitude,
          cosineAlignment: geom.cosineAlignment,
          geometricScore: geom.geometricScore,
          passed: true
        }
      });
    });
  }

  return candidates;
}

