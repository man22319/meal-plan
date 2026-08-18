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
            if (typeof ing.servingSize !== 'number' || ing.servingSize <= 0) return null;
            if (typeof ing.unit !== 'string' || ing.unit.trim() === '') return null;
            if (typeof ing.calories !== 'number' || ing.calories < 0) return null;
            if (typeof ing.protein !== 'number' || ing.protein < 0) return null;
            if (typeof ing.carbs !== 'number' || ing.carbs < 0) return null;
            if (typeof ing.fat !== 'number' || ing.fat < 0) return null;

            return {
              name: ing.name.trim(),
              servingSize: ing.servingSize,
              unit: ing.unit.trim(),
              calories: ing.calories,
              protein: ing.protein,
              carbs: ing.carbs,
              fat: ing.fat,
              minServings: typeof ing.minServings === 'number' && ing.minServings >= 0 ? ing.minServings : 0,
              maxServings: typeof ing.maxServings === 'number' && ing.maxServings > 0 ? ing.maxServings : 5,
              quantityMode: ing.quantityMode === 'discrete' ? 'discrete' : 'continuous'
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
      ingredients: state.ingredients,
      mealConstraints: state.mealConstraints
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
          quantityMode: ing.quantityMode === 'discrete' ? 'discrete' : 'continuous'
        }));

        if (parsed.mealConstraints && typeof parsed.mealConstraints === 'object') {
          if (typeof parsed.mealConstraints.minIngredients === 'number') {
            state.mealConstraints.minIngredients = parsed.mealConstraints.minIngredients;
          }
          if (typeof parsed.mealConstraints.maxIngredients === 'number') {
            state.mealConstraints.maxIngredients = parsed.mealConstraints.maxIngredients;
          }
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
    });
    return errors;
  }
};
