import { buildAndSolveModel, extractResults } from './sim_availability_test_plan.js';

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' RUNNING LOW / LIMITED AVAILABILITY BEHAVIOR EXPERIMENTAL SUITE   ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════
// TEST 0: BASELINE (CURRENT SOLVER UNCHANGED)
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 0: Current Baseline Problematic Meal Plan ---');
export const baselineTargets = { calories: 2335, protein: 151, carbs: 291, fat: 62 };
export const baselineMeals = [
  { name: 'Breakfast', pct: 30 },
  { name: 'Lunch', pct: 40 },
  { name: 'Dinner', pct: 30 }
];
export const baselineIngredients = [
  { name: 'Chicken', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'low' },
  { name: 'Turkey', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, maxServings: 5, availability: 'normal' },
  { name: 'Yuca', servingSize: 103, unit: 'g', calories: 180, protein: 3, carbs: 42, fat: 0, minServings: 0, maxServings: 5, availability: 'normal' },
  { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, maxServings: 2, availability: 'limited' },
  { name: 'Black Beans', servingSize: 100, unit: 'g', calories: 132, protein: 8.9, carbs: 23.7, fat: 0.5, minServings: 0, maxServings: 4, availability: 'normal' },
  { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, maxServings: 4, availability: 'normal' },
  { name: 'Tuna', servingSize: 100, unit: 'g', calories: 130, protein: 28, carbs: 0, fat: 1, minServings: 0, maxServings: 3, availability: 'limited' },
  { name: 'Olive Oil', servingSize: 15, unit: 'mL', calories: 120, protein: 0, carbs: 0, fat: 14, minServings: 0, maxServings: 2, availability: 'normal' }
];

const t0Res = buildAndSolveModel({
  targets: baselineTargets,
  meals: baselineMeals,
  ingredients: baselineIngredients,
  formulation: 'current'
});
const t0Ext = extractResults({ raw: t0Res.raw, targets: baselineTargets, meals: baselineMeals, ingredients: baselineIngredients, formulation: 'current' });

console.log('Baseline Output Items:');
t0Ext.items.forEach(it => {
  console.log(`  [${it.meal}] ${it.ingredient} (${it.availability}): ${it.servings.toFixed(2)} serv (${it.quantity.toFixed(1)} ${it.unit})`);
});
console.log(`Global Baseline Stats:`);
console.log(`  Calories: ${t0Ext.totalCal.toFixed(1)} (dev: ${t0Ext.calDev.toFixed(1)})`);
console.log(`  Protein: ${t0Ext.totalPro.toFixed(1)}g (dev: ${t0Ext.proDev.toFixed(1)}g)`);
console.log(`  Carbs: ${t0Ext.totalCarb.toFixed(1)}g (dev: ${t0Ext.carbDev.toFixed(1)}g)`);
console.log(`  Fat: ${t0Ext.totalFat.toFixed(1)}g (dev: ${t0Ext.fatDev.toFixed(1)}g)`);
console.log(`  Objective: ${t0Ext.objective.toFixed(6)}`);
console.log(`  Ingredients used: ${t0Ext.usedCount}`);
console.log(`  Portions < 0.5 serv: ${t0Ext.portionsUnderHalf}`);
console.log(`  Portions < 0.25 serv: ${t0Ext.portionsUnderQuarter}`);
console.log(`  Total LOW usage: ${t0Ext.lowServings.toFixed(2)} serv`);
console.log(`  Total LIMITED usage: ${t0Ext.limitedServings.toFixed(2)} serv\n`);


// ═══════════════════════════════════════════════════════════════════
// TEST 1: SYNTHETIC SINGLE-INGREDIENT BEHAVIOR
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 1: Synthetic Single-Ingredient Behavior (100 kcal target) ---');
const t1States = ['normal', 'low', 'limited', 'out'];
t1States.forEach(st => {
  const ing = [{ name: 'SoloFood', servingSize: 100, unit: 'g', calories: 100, protein: 0, carbs: 0, fat: 0, minServings: 0, maxServings: 5, availability: st }];
  const res = buildAndSolveModel({
    targets: { calories: 100, protein: 0, carbs: 0, fat: 0 },
    meals: [{ name: 'SoloMeal', pct: 100 }],
    ingredients: ing,
    formulation: 'current'
  });
  const x = res.raw['x_0_0'] || 0;
  const z = res.raw['z_0_0'] || 0;
  const dP = res.raw['dP_calories'] || 0;
  const dM = res.raw['dM_calories'] || 0;
  console.log(`  State: ${st.padEnd(8)} | x: ${x.toFixed(2)} serv | z: ${z} | dP_cal: ${dP.toFixed(2)} | dM_cal: ${dM.toFixed(2)} | obj: ${res.raw.result.toFixed(6)}`);
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 2: AVAILABILITY AS CAPACITY
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 2: Availability As Capacity (Candidate Caps: LOW=3, LIMITED=2, OUT=0) ---');
const t2Targets = [50, 100, 200, 250, 300, 400]; // 0.5, 1, 2, 2.5, 3, 4 servings needed of 100kcal food
['normal', 'low', 'limited', 'out'].forEach(st => {
  console.log(`Availability State: ${st}`);
  t2Targets.forEach(tgtKcal => {
    const requiredServings = tgtKcal / 100;
    const ing = [{ name: 'TestFood', servingSize: 100, unit: 'g', calories: 100, protein: 0, carbs: 0, fat: 0, minServings: 0, maxServings: 10, availability: st }];
    const res = buildAndSolveModel({
      targets: { calories: tgtKcal, protein: 0, carbs: 0, fat: 0 },
      meals: [{ name: 'Meal', pct: 100 }],
      ingredients: ing,
      formulation: 'capacity'
    });
    const x = res.raw['x_0_0'] || 0;
    const dev = (res.raw['dM_calories'] || 0) + (res.raw['dP_calories'] || 0);
    console.log(`  Target: ${requiredServings} serv (${tgtKcal} kcal) -> Chosen x: ${x.toFixed(2)} serv | Cal Deviation: ${dev.toFixed(1)} | Feasible: ${res.raw.feasible}`);
  });
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 3: PARTIAL-SERVING BEHAVIOR (Micro-portions without penalty)
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 3: Partial-Serving Behavior (Nutritionally useful but not necessary) ---');
// Base food satisfies calories and most macros, Food B (100kcal, 20g protein) is optional
const t3Ingredients = [
  { name: 'BaseFood', servingSize: 100, unit: 'g', calories: 200, protein: 10, carbs: 20, fat: 5, minServings: 0, maxServings: 10, availability: 'normal' },
  { name: 'FoodB', servingSize: 100, unit: 'g', calories: 100, protein: 20, carbs: 0, fat: 1, minServings: 0, maxServings: 5, availability: 'normal' }
];
// Target: 400 kcal, 22g protein, 40g carbs, 10g fat -> BaseFood alone at 2.0 serv gives 400 kcal, 20g protein, 40g carbs, 10g fat (2g protein deficit)
['normal', 'low', 'limited'].forEach(st => {
  t3Ingredients[1].availability = st;
  const res = buildAndSolveModel({
    targets: { calories: 400, protein: 22, carbs: 40, fat: 10 },
    meals: [{ name: 'Meal', pct: 100 }],
    ingredients: t3Ingredients,
    formulation: 'capacity' // Capacity only, minServings = 0
  });
  const xBase = res.raw['x_0_0'] || 0;
  const xB = res.raw['x_1_0'] || 0;
  console.log(`  State of FoodB: ${st.padEnd(8)} -> BaseFood: ${xBase.toFixed(3)} serv, FoodB: ${xB.toFixed(3)} serv (${(xB*100).toFixed(1)}g)`);
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 4: MINSERVINGS INTERACTION
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 4: minServings Interaction (0, 0.25, 0.5, 1.0) ---');
[0, 0.25, 0.5, 1.0].forEach(minS => {
  const ingCopy = [
    { name: 'BaseFood', servingSize: 100, unit: 'g', calories: 200, protein: 10, carbs: 20, fat: 5, minServings: 0, maxServings: 10, availability: 'normal' },
    { name: 'FoodB', servingSize: 100, unit: 'g', calories: 100, protein: 20, carbs: 0, fat: 1, minServings: minS, maxServings: 5, availability: 'normal' }
  ];
  const res = buildAndSolveModel({
    targets: { calories: 400, protein: 22, carbs: 40, fat: 10 },
    meals: [{ name: 'Meal', pct: 100 }],
    ingredients: ingCopy,
    formulation: 'capacity_min'
  });
  const ext = extractResults({ raw: res.raw, targets: { calories: 400, protein: 22, carbs: 40, fat: 10 }, meals: [{ name: 'Meal', pct: 100 }], ingredients: ingCopy, formulation: 'capacity_min' });
  const xBase = res.raw['x_0_0'] || 0;
  const xB = res.raw['x_1_0'] || 0;
  console.log(`  minServings=${minS.toFixed(2)} -> BaseFood: ${xBase.toFixed(3)} serv, FoodB: ${xB.toFixed(3)} serv | Pro Dev: ${ext.proDev.toFixed(2)}g | Obj: ${ext.objective.toFixed(6)} | Used Count: ${ext.usedCount}`);
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 5: BINARY ACTIVATION BEHAVIOR (Activation only vs Activation + Min portion)
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 5: Binary Activation (x <= Mz vs x >= Lz + x <= Mz) ---');
// Case A: minServings = 0 (only x <= Mz, no lower bound)
// Case B: minServings = 0.5 (x >= 0.5z and x <= Mz)
const ingTest5 = [
  { name: 'BaseFood', servingSize: 100, unit: 'g', calories: 200, protein: 10, carbs: 20, fat: 5, minServings: 0, maxServings: 10, availability: 'normal' },
  { name: 'FoodB', servingSize: 100, unit: 'g', calories: 100, protein: 20, carbs: 0, fat: 1, minServings: 0, maxServings: 5, availability: 'normal' }
];

const res5A = buildAndSolveModel({
  targets: { calories: 400, protein: 22, carbs: 40, fat: 10 },
  meals: [{ name: 'Meal', pct: 100 }],
  ingredients: ingTest5,
  mealConstraints: { minIngredients: 1, maxIngredients: 2 }, // triggers binaries z
  formulation: 'capacity'
});
console.log(`  Activation Only (minServings=0, z active): FoodB x=${(res5A.raw['x_1_0']||0).toFixed(3)}, z=${res5A.raw['z_1_0']||0}`);

ingTest5[1].minServings = 0.5;
const res5B = buildAndSolveModel({
  targets: { calories: 400, protein: 22, carbs: 40, fat: 10 },
  meals: [{ name: 'Meal', pct: 100 }],
  ingredients: ingTest5,
  mealConstraints: { minIngredients: 1, maxIngredients: 2 },
  formulation: 'capacity_min'
});
console.log(`  Activation + Min Portion (minServings=0.5, z active): FoodB x=${(res5B.raw['x_1_0']||0).toFixed(3)}, z=${res5B.raw['z_1_0']||0}`);
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 6: COMPETING INGREDIENTS (A=NORMAL, B=LIMITED vs A=LIMITED, B=NORMAL)
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 6: Competing Ingredients ---');
const compIngredientsPair1 = [
  { name: 'ProteinA', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'normal' },
  { name: 'ProteinB', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'limited' }
];
const compIngredientsPair2 = [
  { name: 'ProteinA', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'limited' },
  { name: 'ProteinB', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'normal' }
];

const formulations = ['current', 'capacity', 'capacity_min', 'capacity_min_reward'];
formulations.forEach(form => {
  console.log(`Formulation: ${form}`);
  const r1 = buildAndSolveModel({
    targets: { calories: 300, protein: 60, carbs: 0, fat: 4 }, // Needs 2 total servings
    meals: [{ name: 'Meal', pct: 100 }],
    ingredients: compIngredientsPair1,
    formulation: form
  });
  const r2 = buildAndSolveModel({
    targets: { calories: 300, protein: 60, carbs: 0, fat: 4 },
    meals: [{ name: 'Meal', pct: 100 }],
    ingredients: compIngredientsPair2,
    formulation: form
  });
  console.log(`  Pair 1 (A=Normal, B=Limited): A=${(r1.raw['x_0_0']||0).toFixed(2)}, B=${(r1.raw['x_1_0']||0).toFixed(2)} | Obj=${r1.raw.result.toFixed(6)}`);
  console.log(`  Pair 2 (A=Limited, B=Normal): A=${(r2.raw['x_0_0']||0).toFixed(2)}, B=${(r2.raw['x_1_0']||0).toFixed(2)} | Obj=${r2.raw.result.toFixed(6)}`);
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 7: "FINISH THE DAMN FOOD" SCENARIO
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 7: "Finish the food" Scenario ---');
const finishAvailCaps = [1.5, 2.0, 2.5, 3.0];
finishAvailCaps.forEach(cap => {
  const finishIngredients = [
    { name: 'Chicken_Limited', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'limited' },
    { name: 'Turkey_Normal', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'normal' },
    { name: 'Rice_Normal', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0.5, defaultMinServings: 0.5, maxServings: 5, availability: 'normal' }
  ];
  // Target requires 2 servings of poultry (62g protein) + 2 servings of rice
  console.log(`Inventory Available: Chicken = ${cap} serv`);
  formulations.forEach(form => {
    const res = buildAndSolveModel({
      targets: { calories: 590, protein: 67.4, carbs: 56.4, fat: 7.8 },
      meals: [{ name: 'Meal', pct: 100 }],
      ingredients: finishIngredients,
      customCapacity: { 0: cap },
      formulation: form
    });
    const chk = res.raw['x_0_0'] || 0;
    const turk = res.raw['x_1_0'] || 0;
    console.log(`  [${form.padEnd(19)}] Chicken: ${chk.toFixed(2)} serv, Turkey: ${turk.toFixed(2)} serv | Obj: ${res.raw.result.toFixed(6)}`);
  });
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 8: REAL-WORLD REPLAY (Across 3 real meal plans)
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 8: Real-World Replay (3 Problematic Plans) ---');
const realPlans = [
  {
    name: 'Plan 1: High Protein Cut (2335 kcal, 151P, 291C, 62F)',
    targets: { calories: 2335, protein: 151, carbs: 291, fat: 62 },
    meals: [{ name: 'Breakfast', pct: 30 }, { name: 'Lunch', pct: 40 }, { name: 'Dinner', pct: 30 }],
    ingredients: baselineIngredients
  },
  {
    name: 'Plan 2: Moderate Recomposition (2000 kcal, 160P, 200C, 55F)',
    targets: { calories: 2000, protein: 160, carbs: 200, fat: 55 },
    meals: [{ name: 'Meal 1', pct: 35 }, { name: 'Meal 2', pct: 35 }, { name: 'Meal 3', pct: 30 }],
    ingredients: [
      { name: 'Tyson Chicken Breast', servingSize: 112, unit: 'g', calories: 100, protein: 20, carbs: 0, fat: 2.5, minServings: 0, defaultMinServings: 0.5, maxServings: 5, availability: 'limited' },
      { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 0, defaultMinServings: 1, maxServings: 4, quantityMode: 'discrete', availability: 'low' },
      { name: 'Smoked Herring', servingSize: 100, unit: 'g', calories: 150, protein: 10, carbs: 0, fat: 12, minServings: 0, defaultMinServings: 0.5, maxServings: 3, availability: 'normal' },
      { name: 'Rice', servingSize: 100, unit: 'g', calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, minServings: 0, defaultMinServings: 0.5, maxServings: 4, availability: 'normal' },
      { name: 'Black Beans', servingSize: 100, unit: 'g', calories: 132, protein: 8.9, carbs: 23.7, fat: 0.5, minServings: 0, defaultMinServings: 0.5, maxServings: 4, availability: 'normal' },
      { name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8, minServings: 0, defaultMinServings: 0.5, maxServings: 2, availability: 'normal' }
    ]
  },
  {
    name: 'Plan 3: Low Carb / High Fat (1800 kcal, 140P, 80C, 100F)',
    targets: { calories: 1800, protein: 140, carbs: 80, fat: 100 },
    meals: [{ name: 'Lunch', pct: 50 }, { name: 'Dinner', pct: 50 }],
    ingredients: [
      { name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, minServings: 0, defaultMinServings: 0.5, maxServings: 4, availability: 'normal' },
      { name: 'Titus Sardines', servingSize: 90, unit: 'g', calories: 220, protein: 21, carbs: 0, fat: 14, minServings: 0, defaultMinServings: 1, maxServings: 3, quantityMode: 'discrete', availability: 'limited' },
      { name: 'Eggs', servingSize: 50, unit: 'g', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, minServings: 0, defaultMinServings: 1, maxServings: 6, quantityMode: 'discrete', availability: 'normal' },
      { name: 'Olive Oil', servingSize: 15, unit: 'mL', calories: 120, protein: 0, carbs: 0, fat: 14, minServings: 0, defaultMinServings: 0.5, maxServings: 3, availability: 'low' },
      { name: 'Broccoli', servingSize: 100, unit: 'g', calories: 34, protein: 2.8, carbs: 7, fat: 0.4, minServings: 0, defaultMinServings: 0.5, maxServings: 4, availability: 'normal' }
    ]
  }
];

realPlans.forEach(plan => {
  console.log(`\nReplay for ${plan.name}:`);
  console.log('| Metric | Current | Capacity | Cap + Min | + Preference |');
  console.log('| :--- | :--- | :--- | :--- | :--- |');

  const rows = {
    Calories: [],
    Protein: [],
    Carbs: [],
    Fat: [],
    Objective: [],
    'Ingredients used': [],
    'Tiny portions (<0.5)': [],
    'Tiny portions (<0.25)': [],
    'LOW consumed (serv)': [],
    'LIMITED consumed (serv)': []
  };

  formulations.forEach(f => {
    const res = buildAndSolveModel({
      targets: plan.targets,
      meals: plan.meals,
      ingredients: plan.ingredients,
      formulation: f
    });
    const ext = extractResults({ raw: res.raw, targets: plan.targets, meals: plan.meals, ingredients: plan.ingredients, formulation: f });
    rows.Calories.push(ext.totalCal.toFixed(0));
    rows.Protein.push(ext.totalPro.toFixed(1) + 'g');
    rows.Carbs.push(ext.totalCarb.toFixed(1) + 'g');
    rows.Fat.push(ext.totalFat.toFixed(1) + 'g');
    rows.Objective.push(ext.objective.toFixed(4));
    rows['Ingredients used'].push(ext.usedCount);
    rows['Tiny portions (<0.5)'].push(ext.portionsUnderHalf);
    rows['Tiny portions (<0.25)'].push(ext.portionsUnderQuarter);
    rows['LOW consumed (serv)'].push(ext.lowServings.toFixed(2));
    rows['LIMITED consumed (serv)'].push(ext.limitedServings.toFixed(2));
  });

  Object.entries(rows).forEach(([metric, vals]) => {
    console.log(`| ${metric.padEnd(23)} | ${String(vals[0]).padEnd(7)} | ${String(vals[1]).padEnd(8)} | ${String(vals[2]).padEnd(9)} | ${String(vals[3]).padEnd(12)} |`);
  });
});
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 9: ADVERSARIAL CASES
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 9: Adversarial Cases ---');
// Case A: LIMITED ingredient is nutritionally useless (pure sugar for zero carb keto target)
const advA_ing = [
  { name: 'KetoMeat', servingSize: 100, unit: 'g', calories: 200, protein: 30, carbs: 0, fat: 8, minServings: 0, maxServings: 5, availability: 'normal' },
  { name: 'UselessSugar', servingSize: 50, unit: 'g', calories: 200, protein: 0, carbs: 50, fat: 0, minServings: 0, maxServings: 5, availability: 'limited' }
];
const advA_res = buildAndSolveModel({
  targets: { calories: 400, protein: 60, carbs: 0, fat: 16 },
  meals: [{ name: 'Meal', pct: 100 }],
  ingredients: advA_ing,
  formulation: 'capacity_min'
});
console.log(`Case A (Useless LIMITED Sugar): Sugar servings = ${(advA_res.raw['x_1_0']||0).toFixed(2)} (Expected 0)`);

// Case B: LIMITED ingredient is strictly necessary (only protein source)
const advB_ing = [
  { name: 'OnlyProtein', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0, maxServings: 5, availability: 'limited' },
  { name: 'PureCarb', servingSize: 100, unit: 'g', calories: 150, protein: 0, carbs: 35, fat: 0, minServings: 0, maxServings: 5, availability: 'normal' }
];
const advB_res = buildAndSolveModel({
  targets: { calories: 300, protein: 30, carbs: 35, fat: 2 },
  meals: [{ name: 'Meal', pct: 100 }],
  ingredients: advB_ing,
  formulation: 'capacity_min'
});
console.log(`Case B (Necessary LIMITED): OnlyProtein servings = ${(advB_res.raw['x_0_0']||0).toFixed(2)} (Cap: 2.0)`);

// Case C: LIMITED alone could satisfy target (cap is 2.0 serv, target needs 2.0)
const advC_res = buildAndSolveModel({
  targets: { calories: 300, protein: 60, carbs: 0, fat: 4 },
  meals: [{ name: 'Meal', pct: 100 }],
  ingredients: advB_ing,
  formulation: 'capacity_min'
});
console.log(`Case C (Target needs exactly 2.0 serv): OnlyProtein servings = ${(advC_res.raw['x_0_0']||0).toFixed(2)} (Cap: 2.0)`);

// Case D: Target requires MORE than available inventory (target needs 3.0 serv of protein, cap is 2.0)
const advD_res = buildAndSolveModel({
  targets: { calories: 450, protein: 90, carbs: 0, fat: 6 },
  meals: [{ name: 'Meal', pct: 100 }],
  ingredients: advB_ing,
  formulation: 'capacity_min'
});
console.log(`Case D (Target needs 3.0 serv > cap 2.0): OnlyProtein = ${(advD_res.raw['x_0_0']||0).toFixed(2)}, Feasible=${advD_res.raw.feasible}, Pro Deviation=${(advD_res.raw['dP_protein']||0).toFixed(1)}g short`);

// Case E: LOW ingredient appears in multiple meals (daily sum cap vs per meal)
const advE_ing = [
  { name: 'LowChicken', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0, maxServings: 5, availability: 'low' } // cap is 3.0 daily
];
const advE_res = buildAndSolveModel({
  targets: { calories: 600, protein: 120, carbs: 0, fat: 8 }, // needs 4.0 total servings
  meals: [{ name: 'M1', pct: 50 }, { name: 'M2', pct: 50 }],
  ingredients: advE_ing,
  formulation: 'capacity_min'
});
const eM1 = advE_res.raw['x_0_0'] || 0;
const eM2 = advE_res.raw['x_0_1'] || 0;
console.log(`Case E (Multi-meal LOW cap): M1=${eM1.toFixed(2)}, M2=${eM2.toFixed(2)}, Total Daily=${(eM1+eM2).toFixed(2)} (Cap: 3.0 daily)`);

// Case F: Same ingredient is EATEN (locked portion 1.5 serv, cap is 2.0)
const advF_ing = [
  { name: 'LimitedChicken', servingSize: 100, unit: 'g', calories: 150, protein: 30, carbs: 0, fat: 2, minServings: 0, maxServings: 5, availability: 'limited' }
];
const advF_res = buildAndSolveModel({
  targets: { calories: 300, protein: 60, carbs: 0, fat: 4 },
  meals: [{ name: 'M1 (Eaten)', pct: 50 }, { name: 'M2', pct: 50 }],
  ingredients: advF_ing,
  eatenActuals: { '0_0': 150 }, // 1.5 servings locked in M1
  formulation: 'capacity_min'
});
const fM1 = advF_res.raw['x_0_0'] || 0;
const fM2 = advF_res.raw['x_0_1'] || 0;
console.log(`Case F (EATEN 1.5 serv + remaining): M1=${fM1.toFixed(2)}, M2=${fM2.toFixed(2)}, Total=${(fM1+fM2).toFixed(2)} (Cap: 2.0)`);
console.log('');


// ═══════════════════════════════════════════════════════════════════
// TEST 10: NUMERICAL OBJECTIVE AUDIT
// ═══════════════════════════════════════════════════════════════════
console.log('--- TEST 10: Numerical Objective Audit ---');
// Let's audit for Baseline Plan 1 across formulations
formulations.forEach(form => {
  const { raw } = buildAndSolveModel({
    targets: baselineTargets,
    meals: baselineMeals,
    ingredients: baselineIngredients,
    formulation: form
  });

  // Calculate component contributions
  let calDevCost = ((raw['dP_calories'] || 0) + (raw['dM_calories'] || 0)) * (1.0 / baselineTargets.calories);
  let proDevCost = ((raw['dP_protein'] || 0) + (raw['dM_protein'] || 0)) * (2.0 / baselineTargets.protein);
  let carbDevCost = ((raw['dP_carbs'] || 0) + (raw['dM_carbs'] || 0)) * (1.5 / baselineTargets.carbs);
  let fatDevCost = ((raw['dP_fat'] || 0) + (raw['dM_fat'] || 0)) * (1.5 / baselineTargets.fat);

  let mealAllocCost = 0;
  baselineMeals.forEach((m, j) => {
    mealAllocCost += ((raw[`mdP_${j}`] || 0) + (raw[`mdM_${j}`] || 0)) * (0.1 / baselineTargets.calories);
  });

  let qtyCost = 0;
  let simplicityCost = 0;
  let availPenaltyCost = 0;
  let availRewardBenefit = 0;
  let boundaryCost = 0;

  baselineMeals.forEach((m, j) => {
    baselineIngredients.forEach((ing, i) => {
      const s = raw[`x_${i}_${j}`] || 0;
      const z = raw[`z_${i}_${j}`] || 0;
      const exc = raw[`excess_${i}_${j}`] || 0;

      qtyCost += s * 0.00001;
      boundaryCost += exc * 0.002;

      if (form === 'current') {
        if (ing.availability === 'low') {
          availPenaltyCost += s * 0.0005 + z * 0.00025;
        } else if (ing.availability === 'limited') {
          availPenaltyCost += s * 0.002 + z * 0.001;
        }
      } else if (form === 'capacity_min_reward') {
        if (ing.availability === 'low') availRewardBenefit += s * 0.00005;
        else if (ing.availability === 'limited') availRewardBenefit += s * 0.0001;
      }

      simplicityCost += z * 0.0005;
    });
  });

  console.log(`Formulation: ${form}`);
  console.log(`  CALORIE DEVIATION COST:    ${calDevCost.toFixed(6)}`);
  console.log(`  PROTEIN DEVIATION COST:    ${proDevCost.toFixed(6)}`);
  console.log(`  CARB DEVIATION COST:       ${carbDevCost.toFixed(6)}`);
  console.log(`  FAT DEVIATION COST:        ${fatDevCost.toFixed(6)}`);
  console.log(`  MEAL ALLOCATION COST:      ${mealAllocCost.toFixed(6)}`);
  console.log(`  QUANTITY PENALTY COST:     ${qtyCost.toFixed(6)}`);
  console.log(`  SIMPLICITY PENALTY COST:   ${simplicityCost.toFixed(6)}`);
  console.log(`  AVAILABILITY PENALTY COST: ${availPenaltyCost.toFixed(6)}`);
  console.log(`  AVAILABILITY REWARD BENEFIT:${availRewardBenefit.toFixed(6)}`);
  console.log(`  BOUNDARY EXCESS COST:      ${boundaryCost.toFixed(6)}`);
  console.log(`  TOTAL OBJECTIVE:           ${raw.result.toFixed(6)}\n`);
});
