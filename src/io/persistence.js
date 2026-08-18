// ══════════════════════════════════════════
// PERSISTENCE & IMPORT / EXPORT
// ══════════════════════════════════════════

import { state, STORAGE_KEY, DEFAULT_INGREDIENTS } from '../core/state.js';

export const Persistence = {
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ingredients));
    } catch (_) {
      // quota exceeded or private mode
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      const validated = parsed.filter(ing =>
        ing && typeof ing.name === 'string' && ing.name.trim() !== '' &&
        typeof ing.servingSize === 'number' && ing.servingSize > 0 &&
        typeof ing.unit === 'string' && ing.unit.trim() !== '' &&
        typeof ing.calories === 'number' && ing.calories >= 0 &&
        typeof ing.protein === 'number' && ing.protein >= 0 &&
        typeof ing.carbs === 'number' && ing.carbs >= 0 &&
        typeof ing.fat === 'number' && ing.fat >= 0
      );
      if (validated.length === 0) return false;
      state.ingredients = validated;
      return true;
    } catch (_) {
      return false;
    }
  },

  resetToDefaults() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    state.ingredients = JSON.parse(JSON.stringify(DEFAULT_INGREDIENTS));
  }
};

export const ImportExport = {
  exportJSON() {
    const data = { ingredients: state.ingredients };
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
        state.ingredients = parsed.ingredients;
        Persistence.save();
        state.result = null;
        if (onSuccess) onSuccess();
      } catch (_) {
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
    });
    return errors;
  }
};
