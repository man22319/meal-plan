// ══════════════════════════════════════════
// PERSISTENCE & IMPORT / EXPORT
// ══════════════════════════════════════════

import { state, STORAGE_KEY, SETTINGS_KEY, DEFAULT_INGREDIENTS } from '../core/state.js';

export const Persistence = {
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ingredients));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        mealConstraints: state.mealConstraints,
        weights: state.weights
      }));
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
          const validated = parsed.map(ing => {
            if (!ing || typeof ing.name !== 'string' || ing.name.trim() === '') return null;
            if (typeof ing.unit !== 'string' || ing.unit.trim() === '') return null;

            return {
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
              availability: (ing.availability === 'low' || ing.availability === 'running_low') ? 'low' : (ing.availability === 'out' || ing.availability === 'almost_out') ? 'out' : 'normal'
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

      return true;
    } catch {
      return false;
    }
  },

  resetToDefaults() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
    state.mealConstraints = { minIngredients: 1, maxIngredients: 4 };
    state.weights = { calories: 1.0, protein: 1.0, carbs: 0.5, fat: 0.5, mealAllocation: 0.2 };
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
        availability: (ing.availability === 'low' || ing.availability === 'running_low') ? 'low' : (ing.availability === 'out' || ing.availability === 'almost_out') ? 'out' : 'normal'
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
      }
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
        state.ingredients = parsed.ingredients.map(ing => ({
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
          availability: (ing.availability === 'low' || ing.availability === 'running_low') ? 'low' : (ing.availability === 'out' || ing.availability === 'almost_out') ? 'out' : 'normal'
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

        Persistence.save();
        state.result = null;
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
      if (typeof ing.availability !== 'undefined' && !['normal', 'low', 'running_low', 'out', 'almost_out'].includes(ing.availability)) {
        errors.push(`"${label}": availability must be "normal", "low", or "out".`);
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

    return errors;
  }
};
