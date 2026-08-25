// ══════════════════════════════════════════
// BOOT — Application Entry Point
// ══════════════════════════════════════════

import { state, generateId } from './core/state.js';
import { Optimization } from './core/solver.js';
import { Persistence, ImportExport } from './io/persistence.js';
import { UI } from './ui/render.js';

function setupEventListeners() {
  // Solve
  document.getElementById('solve-btn')?.addEventListener('click', () => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const outcome = Optimization.solve({ preserveActuals: false });
    if (outcome.errors && outcome.errors.length > 0) {
      UI.showErrors(outcome.errors);
      if (!outcome.result) {
        UI.hideResults();
      } else {
        UI.renderResults();
      }
    } else {
      UI.clearErrors();
      UI.renderResults();
    }
    Persistence.save();
  });

  // Add ingredient
  document.getElementById('add-ingredient-btn')?.addEventListener('click', () => {
    UI.addIngredient();
  });

  // Import
  const fileInput = document.getElementById('import-file-input');
  document.getElementById('import-btn')?.addEventListener('click', () => {
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  fileInput?.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      ImportExport.importJSON(
        fileInput.files[0],
        () => {
          UI.renderIngredients();
          UI.renderWeights();
          UI.hideResults();
          UI.clearErrors();
        },
        (errors) => {
          UI.showErrors(errors);
        }
      );
    }
  });

  // Export
  document.getElementById('export-btn')?.addEventListener('click', () => {
    ImportExport.exportJSON();
  });

  // Reset Data
  document.getElementById('clear-data-btn')?.addEventListener('click', () => {
    Persistence.resetToDefaults();
    UI.renderTargets();
    UI.renderMeals();
    UI.renderIngredients();
    UI.renderWeights();
    UI.hideResults();
    UI.clearErrors();
  });

  // Tab Navigation
  const solverTabBtn = document.getElementById('tab-btn-solver');
  const ingredientsTabBtn = document.getElementById('tab-btn-ingredients');
  const solverPanel = document.getElementById('tab-solver');
  const ingredientsPanel = document.getElementById('tab-ingredients');

  function switchTab(target) {
    const isSolver = target === 'solver';
    solverTabBtn?.classList.toggle('active', isSolver);
    solverTabBtn?.setAttribute('aria-selected', isSolver ? 'true' : 'false');
    ingredientsTabBtn?.classList.toggle('active', !isSolver);
    ingredientsTabBtn?.setAttribute('aria-selected', !isSolver ? 'true' : 'false');

    solverPanel?.classList.toggle('hidden', !isSolver);
    solverPanel?.classList.toggle('active', isSolver);
    ingredientsPanel?.classList.toggle('hidden', isSolver);
    ingredientsPanel?.classList.toggle('active', !isSolver);
  }

  solverTabBtn?.addEventListener('click', () => switchTab('solver'));
  ingredientsTabBtn?.addEventListener('click', () => switchTab('ingredients'));

  // Meal count stepper
  document.getElementById('meal-count-dec')?.addEventListener('click', () => {
    if (state.meals.length > 1) {
      const removed = state.meals.pop();
      if (removed) {
        const matchKey = (key) =>
          (removed.id && key.startsWith(`${removed.id}_`)) ||
          (removed.name && key.startsWith(`${removed.name}_`)) ||
          key.startsWith(`${state.meals.length}_`);

        if (state.eatenItems) {
          Object.keys(state.eatenItems).forEach(key => {
            if (matchKey(key)) delete state.eatenItems[key];
          });
        }
        if (state.actuals) {
          Object.keys(state.actuals).forEach(key => {
            if (matchKey(key)) delete state.actuals[key];
          });
        }
      }
      Persistence.save();
      UI.renderMeals();
    }
  });

  document.getElementById('meal-count-inc')?.addEventListener('click', () => {
    if (state.meals.length < 6) {
      const id = generateId('meal');
      state.meals.push({ id, name: `Meal ${state.meals.length + 1}`, pct: 0 });
      Persistence.save();
      UI.renderMeals();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  Persistence.load();
  UI.renderTargets();
  UI.renderMeals();
  UI.renderIngredients();
  UI.renderWeights();
  if (state.result) {
    UI.renderResults();
  }
  setupEventListeners();
});
