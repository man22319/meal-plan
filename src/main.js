// ══════════════════════════════════════════
// BOOT — Application Entry Point
// ══════════════════════════════════════════

import { state, generateId } from './core/state.js';
import { Optimization } from './core/solver.js';
import { formatDailySummary } from './core/formatters.js';
import { Persistence, ImportExport } from './io/persistence.js';
import { UI } from './ui/render.js';
import { recordWeightEntry } from './core/history.js';
import { getLocalDateString } from './core/stats.js';

function setupEventListeners() {
  // Copy daily summary
  const copyBtn = document.getElementById('copy-summary-btn');
  copyBtn?.addEventListener('click', async () => {
    if (!state.result) return;
    const summary = formatDailySummary(state.result, state.targets);

    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      UI.showErrors(['Clipboard unavailable. Please allow clipboard permissions.']);
      return;
    }

    try {
      await navigator.clipboard.writeText(summary);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'COPIED';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    } catch {
      UI.showErrors(['Clipboard write failed. Please check clipboard permissions.']);
    }
  });

  // Uneaten all
  document.getElementById('uneaten-all-btn')?.addEventListener('click', () => {
    const hasEaten = Boolean(state.eatenItems && Object.keys(state.eatenItems).length > 0) ||
      Boolean(state.result?.mealResults?.some(m => m.items?.some(it => it.isEaten)));
    if (!hasEaten) return;

    if (window.confirm('Clear all EATEN markers? Recorded actual quantities will be preserved.')) {
      Optimization.unmarkAllIngredientsEaten();
      Persistence.save();
      UI.renderResults({ scroll: false });
    }
  });

  // Solve
  document.getElementById('solve-btn')?.addEventListener('click', () => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const outcome = Optimization.solve({ preserveActuals: false });
    if (outcome.errors && outcome.errors.length > 0) {
      UI.showErrors(outcome.errors);
      // If the solver failed but a previous result still exists (e.g. structural
      // infeasibility with eaten items locked), keep showing the old results so
      // the user can still see and unmark eaten ingredients. Only hide the results
      // section when there is truly nothing to display.
      if (state.result) {
        UI.renderResults({ scroll: false });
      } else {
        UI.hideResults();
      }
    } else {
      UI.clearErrors();
      UI.renderResults();
    }
    Persistence.save();
  });

  // Live Search Ingredients
  const searchInput = document.getElementById('ingredient-search-input');
  const searchClearBtn = document.getElementById('ingredient-search-clear');

  searchInput?.addEventListener('input', () => {
    UI.filterIngredients();
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (searchInput.value) {
        searchInput.value = '';
        UI.filterIngredients();
      }
      searchInput.blur();
    }
  });

  searchClearBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      UI.filterIngredients();
      searchInput.focus();
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
          if (searchInput) searchInput.value = '';
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
    if (searchInput) searchInput.value = '';
    Persistence.resetToDefaults();
    UI.renderTargets();
    UI.renderMeals();
    UI.renderIngredients();
    UI.renderWeights();
    UI.renderWeightTab();
    UI.hideResults();
    UI.clearErrors();
  });

  // Tab Navigation
  const solverTabBtn = document.getElementById('tab-btn-solver');
  const ingredientsTabBtn = document.getElementById('tab-btn-ingredients');
  const weightTabBtn = document.getElementById('tab-btn-weight');
  const recommendTabBtn = document.getElementById('tab-btn-recommend');
  const solverPanel = document.getElementById('tab-solver');
  const ingredientsPanel = document.getElementById('tab-ingredients');
  const weightPanel = document.getElementById('tab-weight');
  const recommendPanel = document.getElementById('tab-recommend');

  function switchTab(target) {
    const isSolver = target === 'solver';
    const isIngredients = target === 'ingredients';
    const isWeight = target === 'weight';
    const isRecommend = target === 'recommend';

    solverTabBtn?.classList.toggle('active', isSolver);
    solverTabBtn?.setAttribute('aria-selected', isSolver ? 'true' : 'false');
    ingredientsTabBtn?.classList.toggle('active', isIngredients);
    ingredientsTabBtn?.setAttribute('aria-selected', isIngredients ? 'true' : 'false');
    weightTabBtn?.classList.toggle('active', isWeight);
    weightTabBtn?.setAttribute('aria-selected', isWeight ? 'true' : 'false');
    recommendTabBtn?.classList.toggle('active', isRecommend);
    recommendTabBtn?.setAttribute('aria-selected', isRecommend ? 'true' : 'false');

    solverPanel?.classList.toggle('hidden', !isSolver);
    solverPanel?.classList.toggle('active', isSolver);
    ingredientsPanel?.classList.toggle('hidden', !isIngredients);
    ingredientsPanel?.classList.toggle('active', isIngredients);
    weightPanel?.classList.toggle('hidden', !isWeight);
    weightPanel?.classList.toggle('active', isWeight);
    recommendPanel?.classList.toggle('hidden', !isRecommend);
    recommendPanel?.classList.toggle('active', isRecommend);

    if (isWeight) {
      UI.renderWeightTab();
    } else if (isRecommend) {
      UI.renderRecommendationsTab();
    }
  }

  solverTabBtn?.addEventListener('click', () => switchTab('solver'));
  ingredientsTabBtn?.addEventListener('click', () => switchTab('ingredients'));
  weightTabBtn?.addEventListener('click', () => switchTab('weight'));
  recommendTabBtn?.addEventListener('click', () => switchTab('recommend'));

  // Recommendation analysis trigger
  document.getElementById('analyze-recommend-btn')?.addEventListener('click', () => {
    UI.runRecommendationAnalysis();
  });


  // Record Weight Action
  const handleRecordWeight = () => {
    const input = document.getElementById('daily-weight-input');
    if (!input) return;
    const val = parseFloat(input.value);
    if (isNaN(val) || val <= 0) {
      input.focus();
      return;
    }
    const today = getLocalDateString();
    const res = recordWeightEntry(state.weightHistory, val, today);
    if (!res.error) {
      state.weightHistory = res.weightHistory;
      Persistence.save();
      UI.renderWeightTab();
    }
  };

  document.getElementById('record-weight-btn')?.addEventListener('click', handleRecordWeight);
  document.getElementById('daily-weight-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRecordWeight();
    }
  });

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
  UI.renderWeightTab();
  if (state.result) {
    UI.renderResults();
  }
  setupEventListeners();
});
