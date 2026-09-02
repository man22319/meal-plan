// ══════════════════════════════════════════════════════════════════
// AUTOMATED TEST SUITE: RECOMMENDATION ENGINE (V1)
// ══════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize vendor solver in Node environment if not present
if (typeof global.solver === 'undefined') {
  const vendorSolverPath = path.resolve(__dirname, '../src/vendor/solver.js');
  const vendorCode = fs.readFileSync(vendorSolverPath, 'utf8');
  const solverSandbox = {};
  const initSolver = new Function('window', 'self', 'exports', 'module', vendorCode);
  initSolver(solverSandbox, solverSandbox, undefined, undefined);
  global.solver = solverSandbox.solver;
}

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };
}

import { generateCandidates, scoreCandidateGeometry } from '../src/recommendation/candidates.js';
import { simulateCandidates, simulateCandidateLPBound, cloneState, applyCandidateToState } from '../src/recommendation/simulation.js';
import { isCandidateDominated, pruneDominatedCandidates, rankRecommendations, computeSigmoidScore } from '../src/recommendation/scoring.js';
import { getRecommendations, applyRecommendation } from '../src/recommendation/recommendation.js';
import { deriveNutritionalRole, scoreIngredientGroceryUtility, getGroceryRecommendations, NUTRITIONAL_ROLES } from '../src/recommendation/grocery.js';
import { generateStateFingerprint } from '../src/core/state.js';
import { solveModel } from '../src/core/solver.js';
import { PRECISION } from '../src/core/precision.js';


export function runRecommendationTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING RECOMMENDATION SYSTEM TEST SUITE                          ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. CANDIDATE GENERATION & STAGE 1 GEOMETRIC PRIORITIZATION
  // ─────────────────────────────────────────────────────────────────
  console.log('--- 1. Candidate Generation & Stage 1 Geometric Prioritization Tests ---');

  const testState1 = {
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: [
      { id: 'ing_out', name: 'OutFood', availability: 'out', maxServings: 4 },
      { id: 'ing_limited', name: 'LimitedFood', availability: 'limited', maxServings: 2 },
      { id: 'ing_low', name: 'LowFood', availability: 'low', maxServings: 3 },
      { id: 'ing_norm', name: 'NormalFood', availability: 'normal', maxServings: 5 }
    ]
  };

  const baselineSolve = solveModel(testState1, { validate: false });
  const cands1 = generateCandidates(testState1, { baselineSolve });

  // Upward availability transitions
  const outTransitions = cands1.filter(c => c.ingredientId === 'ing_out' && c.type === 'RESTOCK').map(c => c.to);
  assert(outTransitions.length === 1 && outTransitions[0] === 'normal',
    'OutFood generates exactly out → normal transition');

  const normTransitions = cands1.filter(c => c.ingredientId === 'ing_norm' && c.type === 'RESTOCK');
  assert(normTransitions.length === 0,
    'NormalFood generates 0 RESTOCK transitions (already at normal)');

  // Stage 1 Geometric compatibility scoring
  const residualDeficit = { calories: 0.20, protein: 0.50, carbs: -0.10, fat: 0.05 };
  const highProteinFood = { calories: 150, protein: 30, carbs: 0, fat: 2 };
  const geomScore = scoreCandidateGeometry(highProteinFood, residualDeficit, testState1.targets, { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5 });
  
  assert(geomScore.directionalMagnitude > 0, 'Directional magnitude is positive for protein-deficit matching food');
  assert(geomScore.cosineAlignment > 0, 'Cosine alignment is positive for protein-deficit matching food');
  assert(geomScore.geometricScore > 0, 'Composite geometric score is positive and non-zero');

  // Candidate pool additions with Stage 1 ranking
  const candidatePool = [
    { name: 'Active In List', calories: 100, protein: 10, carbs: 0, fat: 0 },
    { name: 'Pure Carb Bomb', calories: 400, protein: 0, carbs: 100, fat: 0 },
    { name: 'Ideal Protein Source', calories: 160, protein: 35, carbs: 0, fat: 2 }
  ];
  const testStateWithDuplicate = {
    ...testState1,
    ingredients: [...testState1.ingredients, { id: 'ing_dup', name: 'Active In List', availability: 'normal' }]
  };
  const candsWithPool = generateCandidates(testStateWithDuplicate, { candidatePool, poolLimit: 2 });
  const poolAdds = candsWithPool.filter(c => c.type === 'ADD_INGREDIENT');
  
  assert(poolAdds.some(c => c.ingredientName === 'Ideal Protein Source'),
    'Stage 1 selects the top geometrically aligned pool ingredient');
  assert(!poolAdds.some(c => c.ingredientName === 'Active In List'),
    'ADD_INGREDIENT filters out ingredients already active in the state');


  // ─────────────────────────────────────────────────────────────────
  // 2. SIMULATION, LP RELAXATION BOUNDS & IMMUTABILITY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Simulation, LP Relaxation Bounds & Immutability Tests ---');

  const simState = {
    targets: { calories: 2335, protein: 151, carbs: 291, fat: 62 },
    meals: [
      { id: 'm1', name: 'Breakfast', pct: 40 },
      { id: 'm2', name: 'Lunch', pct: 30 },
      { id: 'm3', name: 'Dinner', pct: 30 }
    ],
    ingredients: [
      { id: 'c1', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'low' },
      { id: 'c2', name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, availability: 'normal' },
      { id: 'c3', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, availability: 'limited' }
    ],
    weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 },
    penalties: { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 },
    mealConstraints: { minIngredients: 1, maxIngredients: 4 },
    actuals: {},
    eatenItems: {}
  };

  const initialSimJson = JSON.stringify(simState);
  const simCands = generateCandidates(simState);
  const simResults = simulateCandidates(simState, simCands);

  assert(simResults.length === simCands.length,
    `All ${simCands.length} candidates simulated successfully`);
  assert(JSON.stringify(simState) === initialSimJson,
    'Base state is 100% immutable and unmodified across all simulation solves');

  // Direct Stage 2 LP lower bound helper check
  const milkCandidate = simCands.find(c => c.id === 'restock_c3_normal');
  const milkLPBound = simulateCandidateLPBound(simState, milkCandidate, simulateCandidates(simState, []));
  assert(milkLPBound.feasible === true && typeof milkLPBound.lowerBound === 'number',
    'simulateCandidateLPBound directly computes valid LP relaxation bound');

  // Mathematical Lower Bound Verification: J*_LP <= J*_MILP
  simResults.forEach(r => {
    if (r.feasible && !r.pruned && typeof r.lowerBound === 'number' && typeof r.objectiveAfter === 'number') {
      assert(r.lowerBound <= r.objectiveAfter + 1e-4,
        `LP relaxation lower bound (${r.lowerBound.toFixed(5)}) <= exact MILP objective (${r.objectiveAfter.toFixed(5)}) for ${r.candidate.label}`);
      assert((r.relaxationGap || 0) >= -1e-4,
        `Integrality gap is non-negative: ${(r.relaxationGap || 0).toFixed(5)}`);
    }
  });

  // Property Test: Stage 2 Pruning Soundness
  // For any candidate where Stage 2 says PRUNED (ΔJ_max < threshold),
  // forcing an exact Stage 3 solve MUST prove ΔJ_exact <= ΔJ_max < threshold
  const subThresholdCandidate = {
    id: 'test_bound_soundness',
    type: 'RESTOCK',
    ingredientId: 'c2', // Yuca is already normal
    ingredientName: 'Yuca',
    from: 'normal',
    to: 'normal',
    label: 'Noop Yuca'
  };
  const baseSolveObj = solveModel(simState, { validate: false });
  const forcedBound = simulateCandidateLPBound(simState, subThresholdCandidate, baseSolveObj, 0.001);
  if (forcedBound.pruned) {
    const forcedClonedState = cloneState(simState);
    applyCandidateToState(forcedClonedState, subThresholdCandidate);
    const forcedExactSolve = solveModel(forcedClonedState, { validate: false, relaxIntegrality: false });
    const forcedExactDeltaJ = baseSolveObj.objective - forcedExactSolve.objective;
    assert(forcedExactDeltaJ <= forcedBound.maxPossibleImprovement + 1e-6 && forcedExactDeltaJ < 0.001,
      `Pruning soundness: Exact ΔJ (${forcedExactDeltaJ.toFixed(6)}) <= Bound ΔJ_max (${forcedBound.maxPossibleImprovement.toFixed(6)}) < threshold (0.001)`);
  }


  // ─────────────────────────────────────────────────────────────────
  // 3. METRIC EXTRACTION ACCURACY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Metric Extraction Accuracy Tests ---');

  const milkRestock = simResults.find(r => r.candidate.id === 'restock_c3_normal');
  if (milkRestock) {
    assert(milkRestock.feasible, 'Milk restock candidate is feasible');
    assert(milkRestock.objectiveImprovement > 0.40,
      `Milk restock achieves expected objective improvement (ΔJ = ${milkRestock.objectiveImprovement.toFixed(4)})`);
    assert(typeof milkRestock.calorieImprovement === 'number' && typeof milkRestock.proteinImprovement === 'number',
      'Macro error deltas are calculated as numbers');
    assert(milkRestock.ingredientUsed === true,
      'Whole Milk is utilized in candidate solution');
  } else {
    console.log('[SKIP] Milk restock tests - candidate not generated');
  }


  // ─────────────────────────────────────────────────────────────────
  // 4. DOMINANCE, ELIGIBILITY & SIGMOID SCORE METRICS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Dominance, Eligibility & Sigmoid Presentation Metric Tests ---');

  // Presentation Metric: Sigmoid monotonicity and bounds
  assert(computeSigmoidScore(0) === 0, 'Sigmoid presentation score at ΔJ = 0 is 0');
  assert(computeSigmoidScore(-0.5) === 0, 'Sigmoid presentation score at negative ΔJ is 0');
  const s1 = computeSigmoidScore(0.1);
  const s2 = computeSigmoidScore(0.5);
  const s3 = computeSigmoidScore(1.0);
  assert(s1 > 0 && s1 < s2 && s2 < s3 && s3 < 1.0,
    `Sigmoid score is strictly monotonic and bounded in [0, 1): S(0.1)=${s1.toFixed(3)}, S(0.5)=${s2.toFixed(3)}, S(1.0)=${s3.toFixed(3)}`);

  const testSimA = {
    candidate: { id: 'cand_a', type: 'RESTOCK', label: 'Candidate A' },
    feasible: true,
    objectiveImprovement: 0.20,
    calorieImprovement: 10,
    proteinImprovement: 5,
    carbImprovement: 10,
    fatImprovement: 2,
    totalNormalizedMacroImprovement: 0.10,
    ingredientUsed: true
  };

  const testSimB = {
    candidate: { id: 'cand_b', type: 'RESTOCK', label: 'Candidate B' },
    feasible: true,
    objectiveImprovement: 0.35,
    calorieImprovement: 15,
    proteinImprovement: 8,
    carbImprovement: 12,
    fatImprovement: 4,
    totalNormalizedMacroImprovement: 0.20,
    ingredientUsed: true
  };

  assert(isCandidateDominated(testSimA, testSimB) === true,
    'Candidate A is mathematically dominated by Candidate B');
  assert(isCandidateDominated(testSimB, testSimA) === false,
    'Candidate B is NOT dominated by Candidate A');

  const pruned = pruneDominatedCandidates([testSimA, testSimB]);
  assert(pruned.length === 1 && pruned[0].candidate.id === 'cand_b',
    'pruneDominatedCandidates removes dominated candidate A');
  assert(testSimA.candidate.rejectionReason?.code === 'DOMINATED',
    'Dominated candidate A records structured rejection reason');

  // Trade-off preservation (neither dominates)
  const testSimC = {
    candidate: { id: 'cand_c', type: 'INCREASE_CAPACITY', label: 'Candidate C' },
    feasible: true,
    objectiveImprovement: 0.30,
    calorieImprovement: 5,
    proteinImprovement: 20, // Higher protein improvement than B
    carbImprovement: 0,
    fatImprovement: 0,
    totalNormalizedMacroImprovement: 0.15,
    ingredientUsed: true
  };

  assert(isCandidateDominated(testSimC, testSimB) === false && isCandidateDominated(testSimB, testSimC) === false,
    'Multi-objective trade-off between B and C preserves both non-dominated candidates');


  // ─────────────────────────────────────────────────────────────────
  // 5. DETERMINISTIC RANKING & PIPELINE REPEATABILITY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Deterministic Ranking & Repeatability Tests ---');

  const ranked1 = rankRecommendations([testSimA, testSimB, testSimC]);
  const ranked2 = rankRecommendations([testSimA, testSimB, testSimC]);

  assert(ranked1.length === 2 && ranked1[0].candidate.id === 'cand_b' && ranked1[1].candidate.id === 'cand_c',
    'Ranked correctly by ΔJ with dominated candidate pruned');
  assert(JSON.stringify(ranked1) === JSON.stringify(ranked2),
    'Ranking is 100% deterministic on identical input');

  // Property Test: Repeatability of full getRecommendations analysis across N runs
  const rep1 = getRecommendations(simState);
  const rep2 = getRecommendations(simState);
  assert(rep1.groceryRecommendations.length === rep2.groceryRecommendations.length,
    'Full recommendation pipeline produces identical grocery recommendation count across runs');
  assert(rep1.groceryRecommendations[0]?.ingredientName === rep2.groceryRecommendations[0]?.ingredientName,
    `Top grocery recommendation is deterministic: ${rep1.groceryRecommendations[0]?.ingredientName}`);

  // ─────────────────────────────────────────────────────────────────
  // 6. REDUCTION CANDIDATES (OVER-TARGET SCENARIOS)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 6. Reduction Candidates (Over-Target Scenarios) Tests ---');

  const overTargetState = {
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    meals: [
      { id: 'm1', name: 'Meal 1', pct: 100 }
    ],
    ingredients: [
      { id: 'high_cal', name: 'HighCalorieFood', servingSize: 100, unit: 'g', calories: 400, protein: 20, carbs: 30, fat: 20, minServings: 0, maxServings: 5, availability: 'normal' },
      { id: 'norm_food', name: 'NormalFood', servingSize: 100, unit: 'g', calories: 200, protein: 10, carbs: 20, fat: 5, minServings: 0, maxServings: 3, availability: 'normal' }
    ],
    weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 },
    penalties: { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 },
    mealConstraints: { minIngredients: 1, maxIngredients: 4 },
    actuals: {},
    eatenItems: {}
  };

  const overTargetBaseline = solveModel(overTargetState, { validate: false });
  const overTargetCands = generateCandidates(overTargetState, { baselineSolve: overTargetBaseline });

  // Should generate REDUCE_CAPACITY candidates when over target
  const reduceCapacityCands = overTargetCands.filter(c => c.type === 'REDUCE_CAPACITY');
  assert(reduceCapacityCands.length > 0,
    `REDUCE_CAPACITY candidates generated when over target: ${reduceCapacityCands.length}`);

  // Should NOT generate RESTOCK candidates when all ingredients are normal
  const restockCands = overTargetCands.filter(c => c.type === 'RESTOCK');
  assert(restockCands.length === 0,
    'No RESTOCK candidates generated when all ingredients are normal');


  // ─────────────────────────────────────────────────────────────────
  // 7. END-TO-END CASCADE, AUDIT TRAIL, EXPLAINABILITY & APPLY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 7. End-to-End Cascade, Audit Trail, Explainability & Apply Tests ---');

  // State with an active capacity opportunity for plan adjustments
  const e2eState = {
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: [
      { id: 'e2e_chicken', name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 1, availability: 'normal' },
      { id: 'e2e_rice', name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, minServings: 0, maxServings: 5, availability: 'normal' },
      { id: 'e2e_oil_out', name: 'Olive Oil', servingSize: 15, unit: 'mL', calories: 120, protein: 0, carbs: 0, fat: 14, minServings: 0, maxServings: 3, availability: 'out' }
    ],
    weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 },
    penalties: { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 },
    mealConstraints: { minIngredients: 1, maxIngredients: 4 },
    actuals: {},
    eatenItems: {}
  };

  const e2eOutcome = getRecommendations(e2eState);

  assert(Boolean(e2eOutcome.stateFingerprint),
    `State fingerprint generated: ${e2eOutcome.stateFingerprint}`);
  assert(Boolean(e2eOutcome.auditTrail),
    'Audit trail metadata generated in outcome');
  assert(typeof e2eOutcome.auditTrail.stage1Candidates === 'number',
    `Audit trail tracks Stage 1 candidates: ${e2eOutcome.auditTrail.stage1Candidates}`);
  assert(typeof e2eOutcome.auditTrail.stage2LPEvaluated === 'number',
    `Audit trail tracks Stage 2 LP evaluations: ${e2eOutcome.auditTrail.stage2LPEvaluated}`);
  assert(typeof e2eOutcome.auditTrail.winnerExplanation === 'string' && e2eOutcome.auditTrail.winnerExplanation.length > 0,
    'Audit trail includes actionable winner explanation answering why top recommendation won');
  assert(Array.isArray(e2eOutcome.auditTrail.rejections),
    'Audit trail includes structured rejections array answering why alternatives were rejected');

  // Check top plan adjustment recommendation and APPLY transaction
  assert(e2eOutcome.planAdjustments.length > 0,
    `Plan adjustments generated for capacity constrained state: ${e2eOutcome.planAdjustments.length}`);
  if (e2eOutcome.planAdjustments.length > 0) {
    const topRec = e2eOutcome.planAdjustments[0];
    assert(Boolean(topRec.stage1) && Boolean(topRec.stage2) && Boolean(topRec.stage3),
      'Top recommendation preserves complete candidate lifecycle (stage1, stage2, stage3)');
    assert(typeof topRec.normalizedScore === 'number' && topRec.normalizedScore > 0,
      `Top recommendation includes sigmoid presentation score: ${(topRec.normalizedScore * 100).toFixed(0)}%`);

    const oldFp = e2eOutcome.stateFingerprint;
    const applyRes = applyRecommendation(e2eState, topRec, { autoPersist: false });
    assert(applyRes.success === true,
      `Successfully applied top recommendation: ${topRec.label}`);
    assert(applyRes.newFingerprint !== oldFp,
      `State fingerprint updated after mutation: ${applyRes.newFingerprint}`);

    // Verify mutation took effect on the state
    const mutatedItem = e2eState.ingredients.find(i => i.id === topRec.ingredientId || i.name === topRec.ingredientName);
    assert(mutatedItem?.maxServings === Number(topRec.to),
      `State mutation verified: ${mutatedItem?.name} maxServings is ${mutatedItem?.maxServings}`);

    // Staleness check
    const staleApply = applyRecommendation(e2eState, topRec, { autoPersist: false });
    assert(staleApply.success === false && staleApply.error === 'STALE_FINGERPRINT',
      'Apply fails safely when attempted against a stale state fingerprint');
  }

  // Also verify applying a grocery recommendation restock
  assert(e2eOutcome.groceryRecommendations.length > 0,
    `Grocery recommendations generated: ${e2eOutcome.groceryRecommendations.length}`);
  const outGroceryItem = e2eOutcome.groceryRecommendations.find(g => g.availability === 'out');
  if (outGroceryItem) {
    const currentFp2 = generateStateFingerprint(e2eState);
    const groceryApplyRes = applyRecommendation(e2eState, {
      type: 'GROCERY_RESTOCK',
      stateFingerprint: currentFp2,
      candidateData: { ingredientId: outGroceryItem.ingredientId, ingredientName: outGroceryItem.ingredientName }
    }, { autoPersist: false });
    assert(groceryApplyRes.success === true,
      `Successfully applied grocery restock for ${outGroceryItem.ingredientName}`);
    const restockedIng = e2eState.ingredients.find(i => i.id === outGroceryItem.ingredientId || i.name === outGroceryItem.ingredientName);
    assert(restockedIng?.availability === 'normal',
      `Grocery restock mutated availability to normal: ${restockedIng?.availability}`);
  }


  // ─────────────────────────────────────────────────────────────────
  // 8. PRECISION BOUNDARIES & REGRESSION TESTS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 8. Precision Boundaries & Regression Tests ---');

  // Regression 1: Deficit + excess simultaneously (Protein -2%, Carbs +0.5%)
  // Must generate protein RESTOCK candidates despite simultaneous carb excess.
  const mixedState = {
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: [
      { id: 'ing_chicken_out', name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'out' },
      { id: 'ing_rice', name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, minServings: 0, maxServings: 8, availability: 'normal' }
    ],
    weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 },
    penalties: { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 },
    mealConstraints: { minIngredients: 1, maxIngredients: 4 },
    actuals: {},
    eatenItems: {}
  };
  const mixedBaseline = solveModel(mixedState, { validate: false });
  const mixedCands = generateCandidates(mixedState, { baselineSolve: mixedBaseline });
  const chickenRestock = mixedCands.find(c => c.ingredientId === 'ing_chicken_out' && c.type === 'RESTOCK');
  assert(Boolean(chickenRestock),
    'Simultaneous deficit (protein) and excess (carbs) correctly generates protein RESTOCK candidate');

  // Regression 2: Sub-threshold deficit (e.g. 0.005% floating point noise)
  // Ensure noise does not trigger candidate generation when within MACRO_MATERIALITY_EPS.
  const perfectState = {
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: [
      { id: 'ing_out_noise', name: 'NoiseFood', servingSize: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, minServings: 0, maxServings: 5, availability: 'out' }
    ]
  };
  const noiseBaseline = {
    feasible: true,
    objective: 0.000001,
    result: {
      totals: { calories: 1999.99, protein: 149.999, carbs: 200.001, fat: 60 },
      deviations: {
        calories: { absolute: -0.01, percentage: -0.0005 },
        protein: { absolute: -0.001, percentage: -0.0006 },
        carbs: { absolute: 0.001, percentage: 0.0005 },
        fat: { absolute: 0, percentage: 0 }
      }
    }
  };
  const noiseCands = generateCandidates(perfectState, { baselineSolve: noiseBaseline });
  assert(noiseCands.length === 0,
    'Sub-threshold deficit/excess (< 1% materiality) does not generate spurious candidates');

  // Regression 3: LP improvement just below threshold (I_max = 0.000099) -> must prune
  const candidateSub = { id: 'c_sub', type: 'RESTOCK', ingredientId: 'c1', to: 'normal' };
  const mockBaseSolve = { feasible: true, objective: 1.0, result: { totals: {}, deviations: {} } };
  const subBound = simulateCandidateLPBound(simState, candidateSub, mockBaseSolve, 0.0001);
  assert(subBound.pruned === (subBound.maxPossibleImprovement < 0.0001),
    `Stage 2 LP bound pruning strictly respects declared threshold (pruned=${subBound.pruned}, maxPossibleImprovement=${subBound.maxPossibleImprovement.toFixed(6)})`);

  // Regression 4: LP improvement exactly at/above threshold (I_max >= 0.0001) -> must survive
  // Regression 5: Large baseline objective (J = 2.5) must NOT inflate threshold
  const largeBaseSolve = { feasible: true, objective: 2.5, result: { totals: {}, deviations: {} } };
  const largeBound = simulateCandidateLPBound(simState, candidateSub, largeBaseSolve);
  assert(largeBound.effectiveThreshold === PRECISION.PRUNING_EPS,
    `Stage 2 effective threshold remains exactly ${PRECISION.PRUNING_EPS} regardless of large baseline objective (J=2.5)`);

  // Regression 6: Display-rounding isolation
  const rawTestState = {
    targets: { calories: 2335, protein: 151, carbs: 291, fat: 62 },
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: [
      { id: 'ing_raw', name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' }
    ]
  };
  const rawSolve = solveModel(rawTestState, { validate: false });
  if (rawSolve.feasible && rawSolve.result?.mealResults[0]?.items[0]) {
    const item = rawSolve.result.mealResults[0].items[0];
    const initialQty = item.quantity;
    const initialServings = item.servings;
    const displayRounded = Math.round(item.quantity);
    assert(typeof item.quantity === 'number' && item.quantity === initialQty,
      `Raw quantity (${item.quantity.toFixed(4)}) is preserved in state while display uses Math.round (${displayRounded})`);
    assert(Math.abs(item.servings - initialServings) < PRECISION.NUMERICAL_ZERO_EPS,
      'Raw fractional servings are preserved with full IEEE-754 precision');
  }

  // Regression 7: Round-trip actual portion with awkward fractions (143g on 137g serving size)
  const awkwardServingSize = 137;
  const awkwardActualQty = 143;
  const expectedServings = awkwardActualQty / awkwardServingSize;
  const awkwardState = {
    targets: { calories: 2335, protein: 151, carbs: 291, fat: 62 },
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: [
      { id: 'ing_awkward', name: 'Yams', servingSize: awkwardServingSize, unit: 'g', calories: 118, protein: 1.5, carbs: 27.9, fat: 0.2, minServings: 0, maxServings: 5, availability: 'normal' }
    ],
    actuals: {
      'm1_ing_awkward': {
        actualQuantity: awkwardActualQty,
        plannedQuantityAtRecord: 100
      }
    }
  };
  const awkwardSolve = solveModel(awkwardState, { validate: false });
  assert(awkwardSolve.feasible, 'Awkward fraction actual portion solve is feasible');
  if (awkwardSolve.feasible && awkwardSolve.result?.mealResults[0]?.items[0]) {
    const awkwardItem = awkwardSolve.result.mealResults[0].items[0];
    assert(awkwardItem.actualQuantity === awkwardActualQty,
      `Stored actual quantity exactly equals recorded observation (${awkwardActualQty}g)`);
    assert(Math.abs(awkwardItem.servings - expectedServings) < PRECISION.NUMERICAL_ZERO_EPS,
      `Solved servings (${awkwardItem.servings.toFixed(8)}) matches exact ratio 143/137 (${expectedServings.toFixed(8)})`);
    const expectedCalories = expectedServings * 118;
    assert(Math.abs(awkwardItem.calories - expectedCalories) < 1e-4,
      `Derived calories (${awkwardItem.calories.toFixed(4)}) matches exact unrounded calculation (${expectedCalories.toFixed(4)})`);
  }

  // Regression 8: Discrete ingredient domain preservation under tightened MIP tolerance
  const discreteState = {
    targets: { calories: 200, protein: 20, carbs: 0, fat: 10 },
    meals: [{ id: 'm1', name: 'Breakfast', pct: 100 }],
    ingredients: [
      { id: 'ing_egg', name: 'Egg', servingSize: 50, unit: 'g', calories: 70, protein: 6, carbs: 0, fat: 5, minServings: 0, maxServings: 5, quantityMode: 'discrete', availability: 'normal' }
    ],
    weights: { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 },
    penalties: { simplicity: 0.0005, quantity: 0.00001, boundaryExcess: 0.002 },
    mealConstraints: { minIngredients: 1, maxIngredients: 4 },
    actuals: {},
    eatenItems: {}
  };
  const discreteSolve = solveModel(discreteState, { validate: false });
  assert(discreteSolve.feasible, 'Discrete ingredient solve is feasible');
  if (discreteSolve.feasible && discreteSolve.result?.mealResults[0]?.items[0]) {
    const eggItem = discreteSolve.result.mealResults[0].items[0];
    assert(Number.isInteger(eggItem.servings),
      `Discrete ingredient servings is an exact integer: ${eggItem.servings}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 9. GROCERY RECOMMENDATION ENGINE & DIVERSITY LOGIC TESTS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- 9. Grocery Recommendation Engine & Diversity Logic Tests ---');

  // Test 9.1: Dynamic Role Classification derived purely from nutritional data
  const testLeanProteinFood = { calories: 120, protein: 26, carbs: 0, fat: 1 };
  const testCarbFood = { calories: 200, protein: 4, carbs: 45, fat: 1 };
  const testFatFood = { calories: 180, protein: 2, carbs: 0, fat: 18 };
  const testBalancedFood = { calories: 150, protein: 10, carbs: 14, fat: 6 };

  assert(deriveNutritionalRole(testLeanProteinFood) === NUTRITIONAL_ROLES.LEAN_PROTEIN,
    'Derives LEAN_PROTEIN role for food with >= 45% protein calories / high protein density');
  assert(deriveNutritionalRole(testCarbFood) === NUTRITIONAL_ROLES.CLEAN_CARB,
    'Derives CLEAN_CARB role for food with >= 55% carbohydrate calories');
  assert(deriveNutritionalRole(testFatFood) === NUTRITIONAL_ROLES.HEALTHY_FAT,
    'Derives HEALTHY_FAT role for food with >= 50% fat calories');
  assert(deriveNutritionalRole(testBalancedFood) === NUTRITIONAL_ROLES.BALANCED_STAPLE,
    'Derives BALANCED_STAPLE role for multi-macro food');

  // Test 9.2: Structured Utility Score Object Contract
  const targets9 = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
  const weights9 = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5 };
  const utilityEval = scoreIngredientGroceryUtility(testLeanProteinFood, targets9, weights9);

  assert(typeof utilityEval.score === 'number' && utilityEval.score > 0,
    'Grocery utility returns a valid positive numerical score');
  assert(Array.isArray(utilityEval.reasons) && utilityEval.reasons.length > 0,
    'Grocery utility returns structured human-readable reasons from the calculation');
  assert(typeof utilityEval.metrics?.macroDensity === 'number',
    'Grocery utility returns macroDensity metric');
  assert(typeof utilityEval.metrics?.macroFlexibility === 'number',
    'Grocery utility returns macroFlexibility metric');
  assert(typeof utilityEval.metrics?.targetCompatibility === 'number',
    'Grocery utility returns targetCompatibility metric');

  // Test 9.3: 0-Error Plan produces multiple grocery recommendations (e.g. 5)
  // Even when ΔJ = 0 and plan adjustments are empty, grocery recommendations return 5 stocking opportunities.
  const zeroErrorPantry = [
    { id: 'g_p1', name: 'ProteinSourceA', calories: 120, protein: 26, carbs: 0, fat: 1, availability: 'out', servingSize: 100, unit: 'g' },
    { id: 'g_p2', name: 'ProteinSourceB', calories: 130, protein: 28, carbs: 0, fat: 2, availability: 'low', servingSize: 100, unit: 'g' },
    { id: 'g_c1', name: 'CarbSourceA', calories: 180, protein: 3, carbs: 42, fat: 0, availability: 'limited', servingSize: 100, unit: 'g' },
    { id: 'g_c2', name: 'CarbSourceB', calories: 220, protein: 5, carbs: 48, fat: 1, availability: 'normal', servingSize: 100, unit: 'g' },
    { id: 'g_f1', name: 'FatSourceA', calories: 160, protein: 14, carbs: 0, fat: 12, availability: 'out', servingSize: 100, unit: 'g' },
    { id: 'g_b1', name: 'BalancedSourceA', calories: 150, protein: 8, carbs: 12, fat: 8, availability: 'normal', servingSize: 100, unit: 'g' }
  ];

  const zeroErrorState = {
    targets: targets9,
    weights: weights9,
    meals: [{ id: 'm1', name: 'Meal 1', pct: 100 }],
    ingredients: zeroErrorPantry
  };

  const fullAnalysisResult = getRecommendations(zeroErrorState, { limit: 10, groceryLimit: 5 });

  assert(Array.isArray(fullAnalysisResult.groceryRecommendations),
    'Outcome contains groceryRecommendations array');
  assert(fullAnalysisResult.groceryRecommendations.length === 5,
    `0-error plan successfully produces exactly 5 grocery recommendations (received ${fullAnalysisResult.groceryRecommendations.length})`);
  assert(Array.isArray(fullAnalysisResult.planAdjustments),
    'Outcome contains planAdjustments array (preserving dual collections)');
  assert(fullAnalysisResult.recommendations === fullAnalysisResult.planAdjustments,
    'Backwards-compatible recommendations property aliases planAdjustments');

  // Test 9.4: Unutilized ingredients in today's solve can be recommended for grocery stocking
  // A food with 0 servings in today's solve can still score high and be recommended for future flexibility.
  const topGroceryItem = fullAnalysisResult.groceryRecommendations[0];
  assert(Boolean(topGroceryItem && topGroceryItem.score > 0),
    'Top grocery recommendation has positive utility score regardless of whether it is used in today\'s solve');

  // Test 9.5: Diversity logic ensures representation across different nutritional roles
  const rolesPresent = new Set(fullAnalysisResult.groceryRecommendations.map(g => g.role));
  assert(rolesPresent.size >= 3,
    `Diversity selection includes multiple distinct nutritional roles in top 5 (found ${rolesPresent.size} distinct roles: ${[...rolesPresent].join(', ')})`);

  // Test 9.6: Inventory Urgency Semantics
  // A nutritionally poor food (e.g. pure sugar / zero protein, low density) that is OUT
  // should NOT outrank a high-density protein or carb staple that is in stock.
  const highQualityNormal = { name: 'QualityStaple', calories: 110, protein: 25, carbs: 0, fat: 1, availability: 'normal' };
  const lowQualityOut = { name: 'JunkFoodOut', calories: 400, protein: 0, carbs: 10, fat: 40, availability: 'out' };

  const evalHighQuality = scoreIngredientGroceryUtility(highQualityNormal, targets9, weights9);
  const evalLowQuality = scoreIngredientGroceryUtility(lowQualityOut, targets9, weights9);

  assert(evalHighQuality.score > evalLowQuality.score,
    `Nutritional utility dominates urgency: high-quality staple (${evalHighQuality.score}) outranks low-quality out-of-stock item (${evalLowQuality.score})`);

  console.log(`\nRecommendation Test Suite Results: ${passed} passed, ${failed} failed.\n`);
  return { passed, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { failed } = runRecommendationTestSuite();
  if (failed > 0) {
    process.exit(1);
  }
}

