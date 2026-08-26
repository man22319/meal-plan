// ══════════════════════════════════════════
// PERSISTENCE & IMPORT / EXPORT
// ══════════════════════════════════════════

import {
  state,
  ensureId,
  resolveAvailability,
  AVAILABILITY_STATES,
  STORAGE_KEY,
  SETTINGS_KEY,
  TARGETS_KEY,
  MEALS_KEY,
  RESULT_KEY,
  WEIGHT_KEY,
  INTAKE_KEY,
  DEFAULT_INGREDIENTS,
  DEFAULT_TARGETS,
  DEFAULT_MEALS
} from '../core/state.js';

export const Persistence = {
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ingredients));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        mealConstraints: state.mealConstraints,
        weights: state.weights
      }));
      localStorage.setItem(TARGETS_KEY, JSON.stringify(state.targets));
      localStorage.setItem(MEALS_KEY, JSON.stringify(state.meals));
      localStorage.setItem(WEIGHT_KEY, JSON.stringify(state.weightHistory || {}));
      localStorage.setItem(INTAKE_KEY, JSON.stringify(state.intakeHistory || {}));
      if (state.result) {
        localStorage.setItem(RESULT_KEY, JSON.stringify({
          ...state.result,
          actuals: state.actuals || {},
          eatenItems: state.eatenItems || {}
        }));
      } else {
        localStorage.removeItem(RESULT_KEY);
      }
    } catch {
      // quota exceeded or private mode
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validated = parsed.map((ing, idx) => {
            if (!ing || typeof ing.name !== 'string' || ing.name.trim() === '') return null;
            if (typeof ing.unit !== 'string' || ing.unit.trim() === '') return null;

            return {
              id: (typeof ing.id === 'string' && ing.id.trim() !== '') ? ing.id.trim() : ensureId(ing, `ing_${idx}`),
              name: ing.name.trim(),
              servingSize: (ing.servingSize === '' || typeof ing.servingSize === 'undefined') ? '' : (typeof ing.servingSize === 'number' && ing.servingSize > 0 ? ing.servingSize : 100),
              unit: ing.unit.trim(),
              calories: (ing.calories === '' || typeof ing.calories === 'undefined') ? '' : (typeof ing.calories === 'number' && ing.calories >= 0 ? ing.calories : 0),
              protein: (ing.protein === '' || typeof ing.protein === 'undefined') ? '' : (typeof ing.protein === 'number' && ing.protein >= 0 ? ing.protein : 0),
              carbs: (ing.carbs === '' || typeof ing.carbs === 'undefined') ? '' : (typeof ing.carbs === 'number' && ing.carbs >= 0 ? ing.carbs : 0),
              fat: (ing.fat === '' || typeof ing.fat === 'undefined') ? '' : (typeof ing.fat === 'number' && ing.fat >= 0 ? ing.fat : 0),
              minServings: (ing.minServings === '' || typeof ing.minServings === 'undefined') ? '' : (typeof ing.minServings === 'number' && ing.minServings >= 0 ? ing.minServings : 0),
              maxServings: (ing.maxServings === '' || typeof ing.maxServings === 'undefined') ? '' : (typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 5),
              quantityMode: ing.quantityMode === 'discrete' ? 'discrete' : 'continuous',
              availability: resolveAvailability(ing.availability)
            };
          }).filter(Boolean);

          if (validated.length > 0) {
            state.ingredients = validated;
          }
        }
      }

      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const parsedSettings = JSON.parse(rawSettings);
        if (parsedSettings && typeof parsedSettings === 'object') {
          if (parsedSettings.mealConstraints && typeof parsedSettings.mealConstraints === 'object') {
            if (typeof parsedSettings.mealConstraints.minIngredients === 'number') {
              state.mealConstraints.minIngredients = parsedSettings.mealConstraints.minIngredients;
            }
            if (typeof parsedSettings.mealConstraints.maxIngredients === 'number') {
              state.mealConstraints.maxIngredients = parsedSettings.mealConstraints.maxIngredients;
            }
          }
          if (parsedSettings.weights && typeof parsedSettings.weights === 'object') {
            Object.assign(state.weights, parsedSettings.weights);
          }
        }
      }

      const rawTargets = localStorage.getItem(TARGETS_KEY);
      if (rawTargets) {
        const parsedTargets = JSON.parse(rawTargets);
        if (parsedTargets && typeof parsedTargets === 'object') {
          ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
            if (typeof parsedTargets[k] === 'number' && !isNaN(parsedTargets[k]) && parsedTargets[k] >= 0) {
              state.targets[k] = parsedTargets[k];
            }
          });
        }
      }

      const rawMeals = localStorage.getItem(MEALS_KEY);
      if (rawMeals) {
        const parsedMeals = JSON.parse(rawMeals);
        if (Array.isArray(parsedMeals) && parsedMeals.length >= 1 && parsedMeals.length <= 6) {
          const validatedMeals = parsedMeals.map((m, i) => {
            if (!m || typeof m !== 'object') return null;
            const id = (typeof m.id === 'string' && m.id.trim() !== '') ? m.id.trim() : ensureId(m, `meal_${i}`);
            const name = typeof m.name === 'string' ? m.name : `Meal ${i + 1}`;
            const pct = typeof m.pct === 'number' && !isNaN(m.pct) && m.pct >= 0 ? m.pct : 0;
            return { id, name, pct };
          }).filter(Boolean);
          if (validatedMeals.length === parsedMeals.length) {
            state.meals = validatedMeals;
          }
        }
      }

      const rawWeight = localStorage.getItem(WEIGHT_KEY);
      if (rawWeight) {
        const parsedWeight = JSON.parse(rawWeight);
        if (parsedWeight && typeof parsedWeight === 'object' && !Array.isArray(parsedWeight)) {
          state.weightHistory = parsedWeight;
        }
      }

      const rawIntake = localStorage.getItem(INTAKE_KEY);
      if (rawIntake) {
        const parsedIntake = JSON.parse(rawIntake);
        if (parsedIntake && typeof parsedIntake === 'object' && !Array.isArray(parsedIntake)) {
          state.intakeHistory = parsedIntake;
        }
      }

      const rawResult = localStorage.getItem(RESULT_KEY);
      if (rawResult) {
        const parsedResult = JSON.parse(rawResult);
        if (parsedResult && typeof parsedResult === 'object' && Array.isArray(parsedResult.mealResults) && parsedResult.totals && parsedResult.deviations) {
          state.result = parsedResult;
          if (parsedResult.actuals && typeof parsedResult.actuals === 'object') {
            state.actuals = parsedResult.actuals;
          }
          if (parsedResult.eatenItems && typeof parsedResult.eatenItems === 'object') {
            state.eatenItems = parsedResult.eatenItems;
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  },

  resetToDefaults() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(TARGETS_KEY);
      localStorage.removeItem(MEALS_KEY);
      localStorage.removeItem(WEIGHT_KEY);
      localStorage.removeItem(INTAKE_KEY);
      localStorage.removeItem(RESULT_KEY);
    } catch {}
    state.targets = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
    state.meals = JSON.parse(JSON.stringify(DEFAULT_MEALS));
    state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
    state.actuals = {};
    state.eatenItems = {};
    state.weightHistory = {};
    state.intakeHistory = {};
    state.result = null;
  }
};

export const ImportExport = {
  exportJSON() {
    const data = {
      ingredients: state.ingredients.map(ing => ({
        name: ing.name,
        servingSize: (ing.servingSize === '' || typeof ing.servingSize === 'undefined') ? 100 : Number(ing.servingSize),
        unit: ing.unit,
        calories: (ing.calories === '' || typeof ing.calories === 'undefined') ? 0 : Number(ing.calories),
        protein: (ing.protein === '' || typeof ing.protein === 'undefined') ? 0 : Number(ing.protein),
        carbs: (ing.carbs === '' || typeof ing.carbs === 'undefined') ? 0 : Number(ing.carbs),
        fat: (ing.fat === '' || typeof ing.fat === 'undefined') ? 0 : Number(ing.fat),
        minServings: (ing.minServings === '' || typeof ing.minServings === 'undefined') ? 0 : (typeof ing.minServings === 'number' && ing.minServings >= 0 ? ing.minServings : 0),
        maxServings: (ing.maxServings === '' || typeof ing.maxServings === 'undefined') ? 5 : (typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 5),
        quantityMode: ing.quantityMode === 'discrete' ? 'discrete' : 'continuous',
        availability: resolveAvailability(ing.availability)
      })),
      mealConstraints: {
        minIngredients: state.mealConstraints?.minIngredients ?? 1,
        maxIngredients: state.mealConstraints?.maxIngredients ?? 4
      },
      weights: {
        calories: state.weights?.calories ?? 1.0,
        protein: state.weights?.protein ?? 1.0,
        carbs: state.weights?.carbs ?? 0.5,
        fat: state.weights?.fat ?? 0.5,
        mealAllocation: state.weights?.mealAllocation ?? 0.2
      },
      weightHistory: state.weightHistory || {},
      intakeHistory: state.intakeHistory || {}
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ingredients.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  importJSON(file, onSuccess, onError) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        const errors = ImportExport._validate(parsed);
        if (errors.length > 0) {
          if (onError) onError(errors);
          return;
        }
        state.ingredients = parsed.ingredients.map((ing, idx) => ({
          id: (typeof ing.id === 'string' && ing.id.trim() !== '') ? ing.id.trim() : ensureId(ing, `ing_${idx}`),
          name: ing.name.trim(),
          servingSize: ing.servingSize,
          unit: ing.unit.trim(),
          calories: ing.calories,
          protein: ing.protein,
          carbs: ing.carbs,
          fat: ing.fat,
          minServings: typeof ing.minServings === 'number' && ing.minServings >= 0 ? ing.minServings : 0,
          maxServings: typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 5,
          quantityMode: ing.quantityMode === 'discrete' ? 'discrete' : 'continuous',
          availability: resolveAvailability(ing.availability)
        }));

        if (parsed.mealConstraints && typeof parsed.mealConstraints === 'object') {
          if (!state.mealConstraints) state.mealConstraints = {};
          if (typeof parsed.mealConstraints.minIngredients === 'number') {
            state.mealConstraints.minIngredients = parsed.mealConstraints.minIngredients;
          }
          if (typeof parsed.mealConstraints.maxIngredients === 'number') {
            state.mealConstraints.maxIngredients = parsed.mealConstraints.maxIngredients;
          }
        }

        if (parsed.weights && typeof parsed.weights === 'object') {
          if (!state.weights) state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
          ['calories', 'protein', 'carbs', 'fat', 'mealAllocation'].forEach(k => {
            if (typeof parsed.weights[k] === 'number') {
              state.weights[k] = parsed.weights[k];
            }
          });
        }

        if (parsed.weightHistory && typeof parsed.weightHistory === 'object' && !Array.isArray(parsed.weightHistory)) {
          state.weightHistory = parsed.weightHistory;
        }

        if (parsed.intakeHistory && typeof parsed.intakeHistory === 'object' && !Array.isArray(parsed.intakeHistory)) {
          state.intakeHistory = parsed.intakeHistory;
        }

        state.eatenItems = {};
        state.result = null;
        Persistence.save();
        if (onSuccess) onSuccess();
      } catch {
        if (onError) onError(['Import failed: file is not valid JSON.']);
      }
    };
    reader.onerror = () => {
      if (onError) onError(['Import failed: could not read file.']);
    };
    reader.readAsText(file);
  },

  _validate(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
      errors.push('Import failed: expected a JSON object.');
      return errors;
    }
    if (!Array.isArray(data.ingredients)) {
      errors.push('Import failed: missing "ingredients" array.');
      return errors;
    }
    if (data.ingredients.length === 0) {
      errors.push('Import failed: "ingredients" array is empty.');
      return errors;
    }
    const fields = [
      { key: 'name', type: 'string' },
      { key: 'servingSize', type: 'number' },
      { key: 'unit', type: 'string' },
      { key: 'calories', type: 'number' },
      { key: 'protein', type: 'number' },
      { key: 'carbs', type: 'number' },
      { key: 'fat', type: 'number' }
    ];
    data.ingredients.forEach((ing, idx) => {
      if (!ing || typeof ing !== 'object') {
        errors.push(`Ingredient [${idx}]: not a valid object.`);
        return;
      }
      const label = ing.name || `#${idx}`;
      fields.forEach(f => {
        if (typeof ing[f.key] !== f.type) {
          errors.push(`"${label}": "${f.key}" must be a ${f.type}.`);
        }
      });
      if (typeof ing.servingSize === 'number' && ing.servingSize <= 0) {
        errors.push(`"${label}": servingSize must be positive.`);
      }
      if (typeof ing.name === 'string' && ing.name.trim() === '') {
        errors.push(`Ingredient [${idx}]: name is empty.`);
      }
      ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
        if (typeof ing[k] === 'number' && ing[k] < 0) {
          errors.push(`"${label}": "${k}" cannot be negative.`);
        }
      });
      if (typeof ing.minServings !== 'undefined') {
        if (typeof ing.minServings !== 'number' || ing.minServings < 0) {
          errors.push(`"${label}": minServings must be a non-negative number.`);
        }
      }
      if (typeof ing.maxServings !== 'undefined') {
        if (typeof ing.maxServings !== 'number' || ing.maxServings <= 0) {
          errors.push(`"${label}": maxServings must be a positive number.`);
        }
      }
      if (typeof ing.minServings === 'number' && typeof ing.maxServings === 'number' && ing.minServings > ing.maxServings) {
        errors.push(`"${label}": minServings cannot exceed maxServings.`);
      }
      if (typeof ing.quantityMode !== 'undefined' && ing.quantityMode !== 'continuous' && ing.quantityMode !== 'discrete') {
        errors.push(`"${label}": quantityMode must be "continuous" or "discrete".`);
      }
      if (typeof ing.availability !== 'undefined' && !AVAILABILITY_STATES.includes(ing.availability)) {
        errors.push(`"${label}": availability must be "normal", "low", "limited", or "out".`);
      }
    });

    if (typeof data.mealConstraints !== 'undefined') {
      if (!data.mealConstraints || typeof data.mealConstraints !== 'object' || Array.isArray(data.mealConstraints)) {
        errors.push('mealConstraints must be an object.');
      } else {
        const mc = data.mealConstraints;
        if (typeof mc.minIngredients !== 'undefined') {
          if (typeof mc.minIngredients !== 'number' || isNaN(mc.minIngredients) || mc.minIngredients < 0) {
            errors.push('mealConstraints.minIngredients must be a non-negative number.');
          }
        }
        if (typeof mc.maxIngredients !== 'undefined') {
          if (typeof mc.maxIngredients !== 'number' || isNaN(mc.maxIngredients) || mc.maxIngredients < 1) {
            errors.push('mealConstraints.maxIngredients must be a positive number.');
          }
        }
        if (typeof mc.minIngredients === 'number' && typeof mc.maxIngredients === 'number' && mc.minIngredients > mc.maxIngredients) {
          errors.push('mealConstraints.minIngredients cannot exceed mealConstraints.maxIngredients.');
        }
      }
    }

    if (typeof data.weights !== 'undefined') {
      if (!data.weights || typeof data.weights !== 'object' || Array.isArray(data.weights)) {
        errors.push('weights must be an object.');
      } else {
        const w = data.weights;
        ['calories', 'protein', 'carbs', 'fat', 'mealAllocation'].forEach(k => {
          if (typeof w[k] !== 'undefined') {
            if (typeof w[k] !== 'number' || isNaN(w[k]) || w[k] < 0) {
              errors.push(`weights.${k} must be a non-negative number.`);
            }
          }
        });
      }
    }

    if (typeof data.weightHistory !== 'undefined') {
      if (!data.weightHistory || typeof data.weightHistory !== 'object' || Array.isArray(data.weightHistory)) {
        errors.push('weightHistory must be an object.');
      } else {
        Object.entries(data.weightHistory).forEach(([date, rec]) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            errors.push(`weightHistory key "${date}" is not a valid YYYY-MM-DD date.`);
            return;
          }
          const weight = typeof rec === 'number' ? rec : rec?.weight;
          if (typeof weight !== 'number' || isNaN(weight) || weight <= 0) {
            errors.push(`weightHistory["${date}"]: weight must be a positive number.`);
          }
        });
      }
    }

    if (typeof data.intakeHistory !== 'undefined') {
      if (!data.intakeHistory || typeof data.intakeHistory !== 'object' || Array.isArray(data.intakeHistory)) {
        errors.push('intakeHistory must be an object.');
      } else {
        Object.entries(data.intakeHistory).forEach(([date, rec]) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            errors.push(`intakeHistory key "${date}" is not a valid YYYY-MM-DD date.`);
            return;
          }
          if (!rec || typeof rec !== 'object') {
            errors.push(`intakeHistory["${date}"]: must be an object.`);
            return;
          }
          if (!rec.totals || typeof rec.totals !== 'object') {
            errors.push(`intakeHistory["${date}"]: missing "totals" object.`);
            return;
          }
          ['calories', 'protein', 'carbs', 'fat'].forEach(k => {
            if (typeof rec.totals[k] !== 'undefined' && (typeof rec.totals[k] !== 'number' || rec.totals[k] < 0)) {
              errors.push(`intakeHistory["${date}"].totals.${k} must be a non-negative number.`);
            }
          });
        });
      }
    }

    return errors;
  }
};
