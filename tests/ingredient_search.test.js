// ══════════════════════════════════════════
// INGREDIENT LIVE SEARCH UNIT TESTS
// ══════════════════════════════════════════

import { state } from '../src/core/state.js';
import { Persistence } from '../src/io/persistence.js';
import { UI } from '../src/ui/render.js';

let failed = 0;
function assert(name, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name} ${details ? `— ${details}` : ''}`);
    failed++;
  }
}

export function runIngredientSearchTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' RUNNING INGREDIENT LIVE SEARCH TEST SUITE                         ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Set up mock DOM elements
  const mockCards = [];
  const searchInput = {
    value: '',
    focusCallCount: 0,
    focus() { this.focusCallCount++; },
    blur() {}
  };
  const searchClearBtn = {
    classList: {
      classes: new Set(['hidden']),
      toggle(cls, force) {
        if (force) this.classes.add(cls);
        else this.classes.delete(cls);
      },
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      contains(cls) { return this.classes.has(cls); }
    }
  };
  const querySpan = { textContent: '' };
  const emptyNotice = {
    classList: {
      classes: new Set(['hidden']),
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      contains(cls) { return this.classes.has(cls); }
    },
    querySelector(sel) {
      if (sel === '.search-query-text') return querySpan;
      return null;
    }
  };

  const container = {
    innerHTML: '',
    querySelectorAll(sel) {
      if (sel === '.ingredient-card') return mockCards;
      if (sel === 'input, select' || sel.startsWith('.segmented-btn') || sel === '.del-btn') return [];
      return [];
    }
  };

  global.document = {
    getElementById(id) {
      if (id === 'ingredient-search-input') return searchInput;
      if (id === 'ingredient-search-clear') return searchClearBtn;
      if (id === 'ingredient-search-empty') return emptyNotice;
      if (id === 'ingredient-list') return container;
      return null;
    }
  };

  // Setup test ingredients
  state.ingredients = [
    { id: 'ing_1', name: 'Chicken Breast', servingSize: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    { id: 'ing_2', name: 'Whole Milk', servingSize: 240, unit: 'mL', calories: 150, protein: 8, carbs: 12, fat: 8 },
    { id: 'ing_3', name: 'Almond Butter', servingSize: 32, unit: 'g', calories: 190, protein: 7, carbs: 6, fat: 18 }
  ];

  mockCards.length = 0;
  state.ingredients.forEach((ing, i) => {
    mockCards.push({
      dataset: { i: String(i) },
      style: { display: '' },
      querySelector(sel) {
        if (sel === '.ing-name-input') return { value: ing.name, focus() {}, scrollIntoView() {} };
        return null;
      }
    });
  });

  // [IS-1] Empty search query shows all cards and hides clear button
  searchInput.value = '';
  UI.filterIngredients();
  assert('[IS-1] Empty search query: all cards visible', mockCards.every(c => c.style.display === ''));
  assert('[IS-1] Empty search query: clear button hidden', searchClearBtn.classList.contains('hidden'));
  assert('[IS-1] Empty search query: empty notice hidden', emptyNotice.classList.contains('hidden'));

  // [IS-2] Query matching subset of ingredients
  searchInput.value = 'milk';
  UI.filterIngredients();
  assert('[IS-2] "milk" query: card 0 hidden', mockCards[0].style.display === 'none');
  assert('[IS-2] "milk" query: card 1 visible', mockCards[1].style.display === '');
  assert('[IS-2] "milk" query: card 2 hidden', mockCards[2].style.display === 'none');
  assert('[IS-2] "milk" query: clear button shown', !searchClearBtn.classList.contains('hidden'));
  assert('[IS-2] "milk" query: empty notice hidden', emptyNotice.classList.contains('hidden'));

  // [IS-3] Case-insensitive substring matching
  searchInput.value = 'CHICK';
  UI.filterIngredients();
  assert('[IS-3] "CHICK" query matches "Chicken Breast"', mockCards[0].style.display === '' && mockCards[1].style.display === 'none');

  // [IS-4] Query with no matches displays empty notice with query text
  searchInput.value = 'avocado';
  UI.filterIngredients();
  assert('[IS-4] "avocado" query: all cards hidden', mockCards.every(c => c.style.display === 'none'));
  assert('[IS-4] "avocado" query: empty notice visible', !emptyNotice.classList.contains('hidden'));
  assert('[IS-4] "avocado" query: search query text set in notice', querySpan.textContent === 'avocado');

  // [IS-5] Clearing search query restores cards and hides empty notice
  searchInput.value = '';
  UI.filterIngredients();
  assert('[IS-5] Reset query: all cards visible', mockCards.every(c => c.style.display === ''));
  assert('[IS-5] Reset query: empty notice hidden', emptyNotice.classList.contains('hidden'));
  assert('[IS-5] Reset query: clear button hidden', searchClearBtn.classList.contains('hidden'));

  console.log(`\nIngredient Search Tests: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
  return failed === 0;
}

if (process.argv[1] && process.argv[1].endsWith('ingredient_search.test.js')) {
  const ok = runIngredientSearchTestSuite();
  if (!ok) process.exit(1);
}
