// ══════════════════════════════════════════
// BOOT — Application Entry Point
// ══════════════════════════════════════════

import { state } from './core/state.js';
import { Optimization } from './core/solver.js';
import { Persistence, ImportExport } from './io/persistence.js';
import { UI } from './ui/render.js';

function setupEventListeners() {
  // Solve
  document.getElementById('solve-btn')?.addEventListener('click', () => {
    const outcome = Optimization.solve();
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
    state.result = null;
    UI.renderIngredients();
    UI.renderWeights();
    UI.hideResults();
    UI.clearErrors();
  });

  // Advanced toggle
  const toggle = document.getElementById('advanced-toggle');
  const body = document.getElementById('advanced-body');
  toggle?.addEventListener('click', () => {
    const isOpen = body?.classList.toggle('open');
    toggle.classList.toggle('open', !!isOpen);
  });

  // Meal count stepper
  document.getElementById('meal-count-dec')?.addEventListener('click', () => {
    if (state.meals.length > 1) {
      state.meals.pop();
      UI.renderMeals();
    }
  });

  document.getElementById('meal-count-inc')?.addEventListener('click', () => {
    if (state.meals.length < 6) {
      state.meals.push({ name: `Meal ${state.meals.length + 1}`, pct: 0 });
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
  setupEventListeners();
});
