// ══════════════════════════════════════════
// PRECISION POLICY — Single Source of Truth
// ══════════════════════════════════════════
// Defines explicit numerical tolerances, materiality thresholds,
// solver gap parameters, and display precision across all layers.

export const PRECISION = Object.freeze({
  /**
   * Minimum meaningful improvement in the optimization objective function (ΔJ).
   * Used for Stage 2 LP lower bound pruning, Stage 3 eligibility, and scoring.
   */
  OBJECTIVE_EPS: 1e-4, // 0.0001
  OBJECTIVE_COMPARISON_EPS: 1e-4, // Explicit epsilon for objective tie-breaking
  PRUNING_EPS: 1e-4, // Safe pruning threshold for Stage 2 LP lower bound

  /**
   * Minimum objective improvement specifically for capacity adjustments
   * which alter the boundary envelope of the feasible region.
   */
  OBJECTIVE_CAPACITY_EPS: 1e-5, // 0.00001

  /**
   * Materiality threshold for residual macro/calorie deficits and excesses (1% / 0.01).
   * Distinguishes actionable nutritional gaps from floating-point noise.
   */
  MACRO_MATERIALITY_EPS: 1e-2, // 0.01 (1%)

  /**
   * Numerical zero tolerance for floating point comparisons (|x| < 1e-6 => 0).
   */
  NUMERICAL_ZERO_EPS: 1e-6,

  /**
   * Practical threshold for non-zero serving detection (0.001 servings = 0.1g of a 100g item).
   * Prevents micro-portion floating point jitter.
   */
  SERVING_MIN_EPS: 1e-3, // 0.001

  /**
   * Direct macro improvement thresholds considered practically meaningful for user recommendations.
   */
  CALORIE_DIRECT_IMP_EPS: 0.5, // 0.5 kcal
  MACRO_DIRECT_IMP_EPS: 0.1,   // 0.1 g

  /**
   * Strict dominance tolerance for comparing two candidates across macro improvements.
   */
  DOMINANCE_TOL_EPS: 1e-2, // 0.01

  /**
   * Optimality MIP gap tolerance for branch-and-cut in javascript-lp-solver.
   * Tightened from 0.05 (5%) to 0.0001 (0.01%) for exact discrete solutions.
   */
  SOLVER_MIP_GAP_TOLERANCE: 1e-4, // 0.0001

  /**
   * Validation tolerance for meal percentage sum (e.g. 33.33 + 33.33 + 33.34 = 100).
   */
  MEAL_PCT_SUM_TOLERANCE: 1e-2, // 0.01%

  /**
   * UI Display Rounding Configuration (presentation layer only).
   */
  DISPLAY: Object.freeze({
    QUANTITY_DECIMALS: 0, // Whole numbers for kitchen food scale
    CALORIE_DECIMALS: 0,  // Whole numbers for calories
    MACRO_DECIMALS: 1,    // 1 decimal place for macro grams
    SERVINGS_DECIMALS: 2  // 2 decimal places for serving counts
  })
});
