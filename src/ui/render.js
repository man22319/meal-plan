import { resolveAvailability, state, generateId, generateStateFingerprint } from '../core/state.js';
import { Persistence } from '../io/persistence.js';
import { Optimization } from '../core/solver.js';
import { bindPressAndHold } from './pressHold.js';
import { getRecommendationsAsync, applyRecommendation } from '../recommendation/recommendation.js';
import {
  getLocalDateString,
  calculateCurrentWeight,
  calculateMovingAverage,
  calculateWeightTrend,
  calculateIntakeStats,
  getCombinedHistoryRows
} from '../core/stats.js';
import {
  createIntakeSnapshot,
  recordIntakeSnapshot
} from '../core/history.js';
import {
  addCustomFood,
  updateCustomFood,
  removeCustomFood,
  aggregateCustomFoods,
  detectInfeasibleDimensions,
  resolveMeal,
  UNIT_OPTIONS
} from '../core/customFoods.js';



const EPSILON = 0.001;
let activeNutritionWindowDays = 7;

export function esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

export function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const UI = {
  // ── TARGETS ──
  renderTargets() {
    const container = document.getElementById('target-fields');
    if (!container) return;
    const fields = [
      { key: 'calories', label: 'Calories', unit: 'kcal' },
      { key: 'protein', label: 'Protein', unit: 'g' },
      { key: 'carbs', label: 'Carbs', unit: 'g' },
      { key: 'fat', label: 'Fat', unit: 'g' }
    ];

    container.innerHTML = fields.map(f => `
      <div class="target-field">
        <label for="target-${f.key}">${f.label} <span class="target-unit">(${f.unit})</span></label>
        <input type="number" id="target-${f.key}"
               value="${state.targets[f.key]}"
               min="0" step="1" inputmode="numeric" />
      </div>
    `).join('');

    fields.forEach(f => {
      const input = document.getElementById(`target-${f.key}`);
      if (input) {
        input.addEventListener('input', function () {
          const val = parseFloat(this.value);
          state.targets[f.key] = isNaN(val) ? 0 : val;
          if (f.key === 'calories') {
            UI.updateMealKcals();
          }
          Persistence.save();
        });
      }
    });
  },

  // ── MEALS ──
  renderMeals() {
    const countDisplay = document.getElementById('meal-count-display');
    if (countDisplay) {
      countDisplay.textContent = state.meals.length;
    }
    const decBtn = document.getElementById('meal-count-dec');
    const incBtn = document.getElementById('meal-count-inc');
    if (decBtn) decBtn.disabled = state.meals.length <= 1;
    if (incBtn) incBtn.disabled = state.meals.length >= 6;

    UI.renderMealRows();
  },

  renderMealRows() {
    const container = document.getElementById('meal-rows');
    if (!container) return;

    const dailyCal = state.targets.calories || 0;

    container.innerHTML = state.meals.map((m, i) => {
      const mealKcal = Math.round(dailyCal * ((m.pct || 0) / 100));
      return `
        <div class="meal-row" data-idx="${i}">
          <input type="text" class="meal-name-input" value="${escAttr(m.name)}" data-idx="${i}" data-f="name"
                 placeholder="Meal name" />
          <div class="meal-pct-wrap">
            <input type="number" class="meal-pct-input" value="${m.pct}" min="0" max="100" step="1"
                   data-idx="${i}" data-f="pct" inputmode="numeric" aria-label="Meal percentage" />
            <span class="pct-suffix">%</span>
          </div>
          <div class="meal-kcal-val" data-idx="${i}">${mealKcal} kcal</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', function () {
        const idx = parseInt(this.dataset.idx, 10);
        if (this.dataset.f === 'name') {
          state.meals[idx].name = this.value;
        } else {
          const val = parseFloat(this.value);
          state.meals[idx].pct = isNaN(val) ? 0 : val;
          UI.updateMealKcals();
          UI.updateMealTotal();
        }
        Persistence.save();
      });
    });

    UI.updateMealTotal();
  },

  updateMealKcals() {
    const dailyCal = state.targets.calories || 0;
    state.meals.forEach((m, i) => {
      const el = document.querySelector(`.meal-kcal-val[data-idx="${i}"]`);
      if (el) {
        const kcal = Math.round(dailyCal * ((m.pct || 0) / 100));
        el.textContent = `${kcal} kcal`;
      }
    });
  },

  updateMealTotal() {
    const total = state.meals.reduce((sum, m) => sum + (m.pct || 0), 0);
    const isValid = Math.abs(total - 100) < EPSILON;
    const el = document.getElementById('meal-total-value');
    if (el) {
      el.textContent = `${total.toFixed(1)}%`;
      el.className = 'meal-total-value ' + (isValid ? 'valid' : 'invalid');
    }

    const solveBtn = document.getElementById('solve-btn');
    if (solveBtn) {
      solveBtn.disabled = !isValid;
      solveBtn.classList.toggle('btn-disabled', !isValid);
      if (!isValid) {
        solveBtn.setAttribute('title', 'Total meal allocation must equal 100%');
      } else {
        solveBtn.removeAttribute('title');
      }
    }
  },

  // ── INGREDIENTS ──
  filterIngredients() {
    const searchInput = document.getElementById('ingredient-search-input');
    const clearBtn = document.getElementById('ingredient-search-clear');
    const emptyNotice = document.getElementById('ingredient-search-empty');
    const container = document.getElementById('ingredient-list');
    if (!container) return;

    const query = (searchInput?.value || '').toLowerCase().trim();
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', query === '');
    }

    if (state.ingredients.length === 0) {
      if (emptyNotice) emptyNotice.classList.add('hidden');
      return;
    }

    const cards = container.querySelectorAll('.ingredient-card');
    let visibleCount = 0;

    cards.forEach(card => {
      const idx = parseInt(card.dataset.i, 10);
      const ingName = (state.ingredients[idx]?.name || card.querySelector('.ing-name-input')?.value || '').toLowerCase();
      const matches = query === '' || ingName.includes(query);
      card.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });

    if (emptyNotice) {
      if (query !== '' && visibleCount === 0) {
        emptyNotice.classList.remove('hidden');
        const querySpan = emptyNotice.querySelector('.search-query-text');
        if (querySpan) querySpan.textContent = searchInput?.value.trim() || '';
      } else {
        emptyNotice.classList.add('hidden');
      }
    }
  },

  renderIngredients() {
    const container = document.getElementById('ingredient-list');
    if (!container) return;

    if (state.ingredients.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No ingredients</div>
          <div class="empty-desc">Add an ingredient or import a JSON database.</div>
        </div>
      `;
      UI.filterIngredients();
      return;
    }

    container.innerHTML = state.ingredients.map((ing, i) => {
      const mode = ing.quantityMode === 'discrete' ? 'discrete' : 'continuous';
      const avail = resolveAvailability(ing.availability);
      const availHint = avail === 'low'
        ? 'Limited supply'
        : avail === 'limited'
          ? 'Very little remaining'
          : avail === 'out'
            ? 'None available — will not be used'
            : 'Fully available';

      return `
      <div class="ingredient-card" data-i="${i}">
        <div class="ing-row ing-name-row">
          <input type="text" class="ing-name-input" value="${escAttr(ing.name)}" data-i="${i}" data-f="name" placeholder="Ingredient name" />
          <button type="button" class="del-btn" data-del="${i}" aria-label="Delete ingredient" title="Delete">×</button>
        </div>

        <div class="ing-grid ing-serving-grid">
          <div class="ing-field">
            <label for="ing-${i}-serv">Serving size</label>
            <input type="number" id="ing-${i}-serv" value="${ing.servingSize !== undefined && ing.servingSize !== null ? ing.servingSize : ''}" min="0" step="1"
                   data-i="${i}" data-f="servingSize" placeholder="100" inputmode="decimal" />
          </div>
          <div class="ing-field">
            <label for="ing-${i}-unit">Unit</label>
            <select id="ing-${i}-unit" class="unit-select" data-i="${i}" data-f="unit">
              <option value="g" ${ing.unit === 'g' ? 'selected' : ''}>g</option>
              <option value="mL" ${ing.unit === 'mL' ? 'selected' : ''}>mL</option>
              ${ing.unit && ing.unit !== 'g' && ing.unit !== 'mL' ? `<option value="${escAttr(ing.unit)}" selected>${esc(ing.unit)}</option>` : ''}
            </select>
          </div>
        </div>

        <div class="ing-macros-wrap">
          <div class="ing-macro-header">
            <span>Calories</span>
            <span>Protein</span>
            <span>Carbs</span>
            <span>Fat</span>
          </div>
          <div class="ing-macro-inputs">
            <input type="number" aria-label="Calories" value="${ing.calories !== undefined && ing.calories !== null ? ing.calories : ''}" min="0" step="1"
                   data-i="${i}" data-f="calories" placeholder="0" inputmode="decimal" />
            <input type="number" aria-label="Protein" value="${ing.protein !== undefined && ing.protein !== null ? ing.protein : ''}" min="0" step="0.1"
                   data-i="${i}" data-f="protein" placeholder="0" inputmode="decimal" />
            <input type="number" aria-label="Carbs" value="${ing.carbs !== undefined && ing.carbs !== null ? ing.carbs : ''}" min="0" step="0.1"
                   data-i="${i}" data-f="carbs" placeholder="0" inputmode="decimal" />
            <input type="number" aria-label="Fat" value="${ing.fat !== undefined && ing.fat !== null ? ing.fat : ''}" min="0" step="0.1"
                   data-i="${i}" data-f="fat" placeholder="0" inputmode="decimal" />
          </div>
        </div>

        <div class="ing-grid ing-bounds-grid">
          <div class="ing-field">
            <label for="ing-${i}-min">Min servings</label>
            <input type="number" id="ing-${i}-min" value="${ing.minServings !== undefined && ing.minServings !== null ? ing.minServings : ''}" min="0" step="0.5"
                   data-i="${i}" data-f="minServings" placeholder="0" inputmode="decimal" />
          </div>
          <div class="ing-field">
            <label for="ing-${i}-max">Max servings</label>
            <input type="number" id="ing-${i}-max" value="${ing.maxServings !== undefined && ing.maxServings !== null ? ing.maxServings : ''}" min="0.1" step="0.5"
                   data-i="${i}" data-f="maxServings" placeholder="5" inputmode="decimal" />
          </div>
        </div>

        <div class="ing-mode-row">
          <div class="ing-mode-header">
            <label>Quantity Mode</label>
            <span class="ing-mode-hint">${mode === 'discrete' ? 'Whole servings only' : 'Fractional servings allowed'}</span>
          </div>
          <div class="segmented-control" role="radiogroup" aria-label="Quantity Mode">
            <button type="button" class="segmented-btn ${mode === 'discrete' ? 'active' : ''}"
                    data-i="${i}" data-mode="discrete" role="radio" aria-checked="${mode === 'discrete'}">
              Discrete
            </button>
            <button type="button" class="segmented-btn ${mode !== 'discrete' ? 'active' : ''}"
                    data-i="${i}" data-mode="continuous" role="radio" aria-checked="${mode !== 'discrete'}">
              Continuous
            </button>
          </div>
        </div>

        <div class="ing-mode-row">
          <div class="ing-mode-header">
            <label>Availability</label>
            <span class="ing-mode-hint">${availHint}</span>
          </div>
          <div class="segmented-control segmented-control-avail" role="radiogroup" aria-label="Availability">
            <button type="button" class="segmented-btn ${avail === 'normal' ? 'active' : ''}"
                    data-i="${i}" data-availability="normal" role="radio" aria-checked="${avail === 'normal'}">
              Normal
            </button>
            <button type="button" class="segmented-btn ${avail === 'low' ? 'active' : ''}"
                    data-i="${i}" data-availability="low" role="radio" aria-checked="${avail === 'low'}">
              Low
            </button>
            <button type="button" class="segmented-btn ${avail === 'limited' ? 'active' : ''}"
                    data-i="${i}" data-availability="limited" role="radio" aria-checked="${avail === 'limited'}">
              Limited
            </button>
            <button type="button" class="segmented-btn ${avail === 'out' ? 'active' : ''}"
                    data-i="${i}" data-availability="out" role="radio" aria-checked="${avail === 'out'}">
              Out
            </button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('input, select').forEach(input => {
      const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(eventName, function () {
        const idx = parseInt(this.dataset.i, 10);
        const field = this.dataset.f;
        if (field === 'name' || field === 'unit') {
          state.ingredients[idx][field] = this.value;
          if (field === 'name') {
            UI.filterIngredients();
          }
        } else {
          const val = this.value.trim();
          state.ingredients[idx][field] = val === '' ? '' : (isNaN(parseFloat(val)) ? '' : parseFloat(val));
        }
        Persistence.save();
      });
    });

    container.querySelectorAll('.segmented-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.i, 10);
        const mode = this.dataset.mode;
        state.ingredients[idx].quantityMode = mode;
        Persistence.save();
        UI.renderIngredients();
      });
    });

    container.querySelectorAll('.segmented-btn[data-availability]').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.i, 10);
        const avail = this.dataset.availability;
        state.ingredients[idx].availability = avail;
        Persistence.save();
        UI.renderIngredients();
      });
    });

    container.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const delIdx = parseInt(this.dataset.del, 10);
        const removed = state.ingredients.splice(delIdx, 1)[0];
        if (removed) {
          const matchKey = (key) =>
            (removed.id && key.endsWith(`_${removed.id}`)) ||
            (removed.name && key.endsWith(`_${removed.name}`));

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
        UI.renderIngredients();
      });
    });

    UI.filterIngredients();
  },

  addIngredient() {
    const searchInput = document.getElementById('ingredient-search-input');
    if (searchInput && searchInput.value) {
      searchInput.value = '';
    }
    state.ingredients.push({
      id: generateId('ing'),
      name: '',
      servingSize: '',
      unit: 'g',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
      minServings: '',
      maxServings: '',
      quantityMode: 'continuous',
      availability: 'normal'
    });
    Persistence.save();
    UI.renderIngredients();
    const cards = document.getElementById('ingredient-list')?.querySelectorAll('.ingredient-card');
    if (cards && cards.length > 0) {
      const last = cards[cards.length - 1];
      const nameInput = last.querySelector('.ing-name-input');
      if (nameInput) {
        nameInput.focus();
        nameInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  },

  // ── WEIGHTS & LIMITS ──
  renderWeights() {
    const fields = [
      { key: 'calories', label: 'Calories Weight', group: 'weights', step: '0.1', min: 0, val: state.weights.calories },
      { key: 'protein', label: 'Protein Weight', group: 'weights', step: '0.1', min: 0, val: state.weights.protein },
      { key: 'carbs', label: 'Carbs Weight', group: 'weights', step: '0.1', min: 0, val: state.weights.carbs },
      { key: 'fat', label: 'Fat Weight', group: 'weights', step: '0.1', min: 0, val: state.weights.fat },
      { key: 'mealAllocation', label: 'Meal Alloc. Weight', group: 'weights', step: '0.1', min: 0, val: state.weights.mealAllocation },
      { key: 'minIngredients', label: 'Min Items / Meal', group: 'mealConstraints', step: '1', min: 0, val: state.mealConstraints?.minIngredients ?? 1 },
      { key: 'maxIngredients', label: 'Max Items / Meal', group: 'mealConstraints', step: '1', min: 1, val: state.mealConstraints?.maxIngredients ?? 4 }
    ];
    const container = document.getElementById('weight-fields');
    if (!container) return;

    container.innerHTML = fields.map(f => `
      <div class="weight-field">
        <label for="setting-${f.key}">${f.label}</label>
        <input type="number" id="setting-${f.key}"
               value="${f.val}"
               data-group="${f.group}"
               data-key="${f.key}"
               min="${f.min}" step="${f.step}" inputmode="decimal" />
      </div>
    `).join('');

    fields.forEach(f => {
      const input = document.getElementById(`setting-${f.key}`);
      if (input) {
        input.addEventListener('input', function () {
          const val = parseFloat(this.value);
          const num = isNaN(val) ? 0 : val;
          if (this.dataset.group === 'weights') {
            state.weights[this.dataset.key] = num;
          } else if (this.dataset.group === 'mealConstraints') {
            if (!state.mealConstraints) state.mealConstraints = {};
            state.mealConstraints[this.dataset.key] = num;
          }
          Persistence.save();
        });
      }
    });
  },

  // ── CUSTOM FOODS & MEALS ──
  renderCustomFoods() {
    const listEl = document.getElementById('custom-foods-list');
    const countBadge = document.getElementById('custom-foods-count');
    const totalsContainer = document.getElementById('custom-foods-totals-container');
    const addBtn = document.getElementById('add-custom-food-btn');
    const removeAllBtn = document.getElementById('remove-all-custom-foods-btn');

    const hasItems = Boolean(state.customFoods && state.customFoods.length > 0);

    if (countBadge) {
      countBadge.textContent = String(state.customFoods ? state.customFoods.length : 0);
    }

    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = 'true';
      addBtn.addEventListener('click', () => {
        UI.openCustomFoodForm();
      });
    }

    if (removeAllBtn) {
      // Toggle visibility
      removeAllBtn.classList.toggle('hidden', !hasItems);

      // Bind once
      if (!removeAllBtn.dataset.bound) {
        removeAllBtn.dataset.bound = 'true';
        removeAllBtn.addEventListener('click', () => {
          if (!state.customFoods || state.customFoods.length === 0) return;
          const count = state.customFoods.length;
          const label = count === 1 ? '1 custom food' : `${count} custom foods`;
          if (!window.confirm(`Remove all ${label}? This cannot be undone.`)) return;
          state.customFoods.length = 0;
          Persistence.save();
          UI.renderCustomFoods();
          UI.markSolutionStale();
        });
      }
    }

    if (!listEl) return;

    if (!state.customFoods || state.customFoods.length === 0) {
      listEl.innerHTML = '<div class="custom-food-empty">No custom foods added.</div>';
      if (totalsContainer) {
        totalsContainer.classList.add('hidden');
        totalsContainer.innerHTML = '';
      }
      return;
    }

    listEl.innerHTML = state.customFoods.map(cf => {
      // Find assigned meal name
      const resolved = resolveMeal(cf.meal, state.meals);
      const mealName = resolved ? resolved.name : 'Unassigned';

      // Format macros
      const isEstCal = cf.confidence?.calories === 'estimated';
      const isEstPro = cf.confidence?.protein === 'estimated';
      const isEstCarb = cf.confidence?.carbs === 'estimated';
      const isEstFat = cf.confidence?.fat === 'estimated';

      const calStr = cf.calories !== null ? `${isEstCal ? '~' : ''}${Math.round(cf.calories)} kcal` : '—';
      const proStr = cf.protein !== null ? `${isEstPro ? '~' : ''}${cf.protein}P` : '—P';
      const carbStr = cf.carbs !== null ? `${isEstCarb ? '~' : ''}${cf.carbs}C` : '—C';
      const fatStr = cf.fat !== null ? `${isEstFat ? '~' : ''}${cf.fat}F` : '—F';

      // Confidence badge text
      const hasEstimated = isEstCal || isEstPro || isEstCarb || isEstFat;
      let confLabel = 'Known';
      if (hasEstimated) {
        confLabel = 'Estimated';
      } else if (cf.calories !== null && cf.protein === null && cf.carbs === null && cf.fat === null) {
        confLabel = 'Calories known';
      }

      return `
        <div class="custom-food-entry" data-id="${escAttr(cf.id)}">
          <div class="custom-food-entry-top">
            <div class="custom-food-title-wrap">
              <span class="custom-food-name">${esc(cf.name)}</span>
              <span class="custom-food-sub">${cf.amount} ${esc(cf.unit)} · ${esc(mealName)}</span>
            </div>
            <span class="custom-food-meal-tag">${esc(mealName)}</span>
          </div>
          <div class="custom-food-macros">
            <span>${calStr}</span>
            <span class="cf-sep">|</span>
            <span>${proStr}</span>
            <span class="cf-sep">|</span>
            <span>${carbStr}</span>
            <span class="cf-sep">|</span>
            <span>${fatStr}</span>
          </div>
          <div class="custom-food-entry-bottom">
            <span class="custom-food-confidence-badge ${hasEstimated ? 'has-estimated' : ''}">${confLabel}</span>
            <div class="custom-food-entry-actions">
              <button type="button" class="btn-cf-action btn-cf-edit" data-id="${escAttr(cf.id)}">Edit</button>
              <button type="button" class="btn-cf-action btn-cf-remove" data-id="${escAttr(cf.id)}">Remove</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire up edit / remove
    listEl.querySelectorAll('.btn-cf-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.openCustomFoodForm(btn.dataset.id);
      });
    });

    listEl.querySelectorAll('.btn-cf-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomFood(btn.dataset.id);
        Persistence.save();
        UI.renderCustomFoods();
        UI.markSolutionStale();
      });
    });

    // Render totals
    if (totalsContainer) {
      const agg = aggregateCustomFoods(null, state.customFoods);
      const calStr = `${Math.round(agg.calories.known)} kcal`;
      const proStr = `${agg.protein.hasUnknown ? '—' : (Math.round(agg.protein.known * 10) / 10).toString()}P`;
      const carbStr = `${agg.carbs.hasUnknown ? '—' : (Math.round(agg.carbs.known * 10) / 10).toString()}C`;
      const fatStr = `${agg.fat.hasUnknown ? '—' : (Math.round(agg.fat.known * 10) / 10).toString()}F`;

      totalsContainer.innerHTML = `
        <span class="cf-totals-label">Custom Food Total</span>
        <span class="cf-totals-values">${calStr} | ${proStr} | ${carbStr} | ${fatStr}</span>
      `;
      totalsContainer.classList.remove('hidden');
    }
  },

  openCustomFoodForm(editId = null) {
    const wrap = document.getElementById('custom-food-form-wrap');
    const mainActions = document.getElementById('custom-food-main-actions');
    if (!wrap) return;

    if (mainActions) mainActions.classList.add('hidden');

    const food = editId ? state.customFoods.find(cf => cf.id === editId) : null;
    const isEdit = Boolean(food);

    const nameVal = isEdit ? food.name : '';
    const amountVal = isEdit ? food.amount : '';
    const unitVal = isEdit ? food.unit : '';
    const calVal = isEdit && food.calories !== null ? food.calories : '';
    const proVal = isEdit && food.protein !== null ? food.protein : '';
    const carbVal = isEdit && food.carbs !== null ? food.carbs : '';
    const fatVal = isEdit && food.fat !== null ? food.fat : '';

    const mealVal = isEdit ? (food.meal || '') : '';

    const confCal = isEdit && food.confidence?.calories ? food.confidence.calories : 'known';
    const confPro = isEdit && food.confidence?.protein ? food.confidence.protein : 'known';
    const confCarb = isEdit && food.confidence?.carbs ? food.confidence.carbs : 'known';
    const confFat = isEdit && food.confidence?.fat ? food.confidence.fat : 'known';

    wrap.innerHTML = `
      <div class="cf-form-title">${isEdit ? 'EDIT CUSTOM FOOD' : 'CUSTOM FOOD'}</div>
      <div class="cf-form-field">
        <label for="cf-input-name">Name</label>
        <input type="text" id="cf-input-name" class="cf-input-text" placeholder="Buffalo Chicken Wrap" value="${escAttr(nameVal)}" />
      </div>

      <div class="cf-amount-unit-row">
        <div class="cf-form-field">
          <label for="cf-input-amount">Amount</label>
          <input type="number" id="cf-input-amount" class="cf-input-num" min="0.01" step="any" placeholder="1" value="${escAttr(String(amountVal))}" inputmode="decimal" />
        </div>
        <div class="cf-form-field">
          <label for="cf-input-unit">Unit</label>
          <input type="text" id="cf-input-unit" list="cf-unit-datalist" class="cf-input-text" placeholder="wrap" value="${escAttr(unitVal)}" />
          <datalist id="cf-unit-datalist">
            ${UNIT_OPTIONS.map(u => `<option value="${u}"></option>`).join('')}
          </datalist>
        </div>
      </div>

      <div class="cf-form-helper">Nutrition values should represent the entire amount entered above.</div>

      <div class="cf-macros-grid">
        <div class="cf-macro-col">
          <label for="cf-macro-cal">Calories</label>
          <input type="number" id="cf-macro-cal" class="cf-input-num" min="0" step="1" placeholder="—" value="${calVal}" inputmode="numeric" />
          <div class="cf-conf-toggle" data-macro="calories">
            <button type="button" class="cf-conf-btn ${confCal !== 'estimated' ? 'active' : ''}" data-val="known">Known</button>
            <button type="button" class="cf-conf-btn est ${confCal === 'estimated' ? 'active' : ''}" data-val="estimated">Est</button>
          </div>
        </div>

        <div class="cf-macro-col">
          <label for="cf-macro-pro">Protein</label>
          <input type="number" id="cf-macro-pro" class="cf-input-num" min="0" step="0.1" placeholder="—" value="${proVal}" inputmode="decimal" />
          <div class="cf-conf-toggle" data-macro="protein">
            <button type="button" class="cf-conf-btn ${confPro !== 'estimated' ? 'active' : ''}" data-val="known">Known</button>
            <button type="button" class="cf-conf-btn est ${confPro === 'estimated' ? 'active' : ''}" data-val="estimated">Est</button>
          </div>
        </div>

        <div class="cf-macro-col">
          <label for="cf-macro-carb">Carbs</label>
          <input type="number" id="cf-macro-carb" class="cf-input-num" min="0" step="0.1" placeholder="—" value="${carbVal}" inputmode="decimal" />
          <div class="cf-conf-toggle" data-macro="carbs">
            <button type="button" class="cf-conf-btn ${confCarb !== 'estimated' ? 'active' : ''}" data-val="known">Known</button>
            <button type="button" class="cf-conf-btn est ${confCarb === 'estimated' ? 'active' : ''}" data-val="estimated">Est</button>
          </div>
        </div>

        <div class="cf-macro-col">
          <label for="cf-macro-fat">Fat</label>
          <input type="number" id="cf-macro-fat" class="cf-input-num" min="0" step="0.1" placeholder="—" value="${fatVal}" inputmode="decimal" />
          <div class="cf-conf-toggle" data-macro="fat">
            <button type="button" class="cf-conf-btn ${confFat !== 'estimated' ? 'active' : ''}" data-val="known">Known</button>
            <button type="button" class="cf-conf-btn est ${confFat === 'estimated' ? 'active' : ''}" data-val="estimated">Est</button>
          </div>
        </div>
      </div>

      <div class="cf-form-field">
        <label for="cf-select-meal">Meal</label>
        <select id="cf-select-meal" class="cf-select">
          <option value="" ${!mealVal ? 'selected' : ''}>Unassigned</option>
          ${state.meals.map(m => `
            <option value="${escAttr(m.id)}" ${mealVal === m.id || mealVal === m.name ? 'selected' : ''}>${esc(m.name)}</option>
          `).join('')}
        </select>
      </div>

      <div class="cf-form-actions">
        <button type="button" class="btn btn-sm" id="cf-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-sm btn-primary" id="cf-save-btn">${isEdit ? 'Save Changes' : 'Add Food'}</button>
      </div>
    `;

    wrap.classList.remove('hidden');

    // Wire confidence buttons
    wrap.querySelectorAll('.cf-conf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const toggle = btn.parentElement;
        toggle.querySelectorAll('.cf-conf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Wire Cancel
    document.getElementById('cf-cancel-btn')?.addEventListener('click', () => {
      UI.closeCustomFoodForm();
    });

    // Wire Save
    document.getElementById('cf-save-btn')?.addEventListener('click', () => {
      const name = (document.getElementById('cf-input-name')?.value || '').trim();
      const amount = parseFloat(document.getElementById('cf-input-amount')?.value);
      const unit = (document.getElementById('cf-input-unit')?.value || '').trim();

      if (!name) {
        document.getElementById('cf-input-name')?.focus();
        return;
      }
      if (isNaN(amount) || amount <= 0) {
        document.getElementById('cf-input-amount')?.focus();
        return;
      }
      if (!unit) {
        document.getElementById('cf-input-unit')?.focus();
        return;
      }

      const parseMacro = (id) => {
        const v = document.getElementById(id)?.value?.trim();
        if (!v && v !== '0') return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : Math.max(0, n);
      };

      const cal = parseMacro('cf-macro-cal');
      const pro = parseMacro('cf-macro-pro');
      const carb = parseMacro('cf-macro-carb');
      const fat = parseMacro('cf-macro-fat');

      const getConf = (macro) => {
        const toggle = wrap.querySelector(`.cf-conf-toggle[data-macro="${macro}"]`);
        const active = toggle?.querySelector('.cf-conf-btn.active');
        return active?.dataset?.val === 'estimated' ? 'estimated' : 'known';
      };

      const mealSelect = document.getElementById('cf-select-meal');
      const meal = mealSelect?.value || null;

      const payload = {
        name,
        amount,
        unit,
        calories: cal,
        protein: pro,
        carbs: carb,
        fat,
        confidence: {
          calories: getConf('calories'),
          protein: getConf('protein'),
          carbs: getConf('carbs'),
          fat: getConf('fat')
        },
        meal
      };

      if (isEdit) {
        updateCustomFood(editId, payload);
      } else {
        addCustomFood(payload);
      }

      Persistence.save();
      UI.closeCustomFoodForm();
      UI.renderCustomFoods();
      UI.markSolutionStale();
    });

    // Focus name
    window.setTimeout(() => {
      document.getElementById('cf-input-name')?.focus();
    }, 40);
  },

  closeCustomFoodForm() {
    const wrap = document.getElementById('custom-food-form-wrap');
    const mainActions = document.getElementById('custom-food-main-actions');
    if (wrap) {
      wrap.innerHTML = '';
      wrap.classList.add('hidden');
    }
    if (mainActions) {
      mainActions.classList.remove('hidden');
    }
  },

  markSolutionStale() {
    if (state.result) {
      UI.renderResults({ scroll: false });
    }
  },

  // ── ACTUAL PORTION MODAL ──
  currentModalContext: null,

  initActualModal() {
    const backdrop = document.getElementById('actual-modal-backdrop');
    if (!backdrop || backdrop.dataset.initialized === 'true') return;
    backdrop.dataset.initialized = 'true';

    const closeBtn = document.getElementById('modal-close-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const applyBtn = document.getElementById('modal-apply-btn');
    const clearBtn = document.getElementById('modal-clear-btn');
    const input = document.getElementById('actual-qty-input');

    const closeModal = () => {
      backdrop.classList.add('hidden');
      UI.currentModalContext = null;
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) {
        closeModal();
      }
    });

    const submitApply = () => {
      if (!UI.currentModalContext) return;
      const valStr = input.value.trim();
      const val = parseFloat(valStr);
      if (isNaN(val) || val < 0) {
        input.focus();
        return;
      }

      const { mealId, ingId, plannedQuantity } = UI.currentModalContext;
      const outcome = Optimization.recordActual(mealId, ingId, val, plannedQuantity);
      if (outcome.errors && outcome.errors.length > 0) {
        UI.showErrors(outcome.errors);
      } else {
        UI.clearErrors();
      }
      Persistence.save();
      UI.renderResults({ scroll: false });
      closeModal();
    };

    applyBtn?.addEventListener('click', submitApply);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitApply();
      }
    });

    clearBtn?.addEventListener('click', () => {
      if (!UI.currentModalContext) return;
      const { mealId, ingId } = UI.currentModalContext;
      const outcome = Optimization.clearActual(mealId, ingId);
      if (outcome.errors && outcome.errors.length > 0) {
        UI.showErrors(outcome.errors);
      } else {
        UI.clearErrors();
      }
      Persistence.save();
      UI.renderResults({ scroll: false });
      closeModal();
    });
  },

  openActualModal(context) {
    UI.initActualModal();
    UI.currentModalContext = context;
    const backdrop = document.getElementById('actual-modal-backdrop');
    if (!backdrop) return;

    const mealTag = document.getElementById('modal-meal-name');
    if (mealTag) mealTag.textContent = context.mealName || 'MEAL';

    const ingTitle = document.getElementById('modal-ingredient-title');
    if (ingTitle) ingTitle.textContent = context.ingName || 'INGREDIENT';

    const plannedDisp = document.getElementById('modal-planned-display');
    if (plannedDisp) plannedDisp.textContent = `${Math.round(context.plannedQuantity)} ${context.unit}`;

    const unitDisp = document.getElementById('modal-unit-display');
    if (unitDisp) unitDisp.textContent = context.unit;

    const input = document.getElementById('actual-qty-input');
    if (input) {
      const defaultVal = context.isActual ? context.actualQuantity : context.plannedQuantity;
      input.value = typeof defaultVal === 'number' && !isNaN(defaultVal) ? Math.round(defaultVal * 10) / 10 : '';
    }

    const clearBtn = document.getElementById('modal-clear-btn');
    if (clearBtn) {
      if (context.isActual) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
    }

    backdrop.classList.remove('hidden');
    window.setTimeout(() => {
      input?.focus();
      input?.select();
    }, 50);
  },

  // ── RESULTS ──
  renderResults({ scroll = true } = {}) {
    const r = state.result;
    if (!r) { UI.hideResults(); return; }

    const section = document.getElementById('results-section');
    if (!section) return;

    UI.initActualModal();

    const uneatenAllBtn = document.getElementById('uneaten-all-btn');
    if (uneatenAllBtn) {
      const hasEaten = Boolean(state.eatenItems && Object.keys(state.eatenItems).length > 0) ||
        Boolean(r.mealResults?.some(m => m.items?.some(it => it.isEaten)));
      uneatenAllBtn.disabled = !hasEaten;
    }

    // ── Plan Adjustment Warning Banner ──
    const infeasibleNotice = document.getElementById('custom-food-infeasible-notice');
    if (infeasibleNotice) {
      const issues = detectInfeasibleDimensions(state.targets, state.customFoods);
      if (issues && issues.length > 0) {
        const issueDetails = issues.map(i => {
          const unit = i.macro === 'calories' ? 'kcal' : 'g';
          const amt = i.macro === 'calories' ? Math.round(i.deficit) : (Math.round(i.deficit * 10) / 10);
          return `${i.macro} target by ${amt} ${unit}`;
        }).join(', ');

        infeasibleNotice.innerHTML = `
          <div class="plan-adjustment-title">PLAN ADJUSTMENT</div>
          <div class="plan-adjustment-body">
            Your custom foods exceed today's ${issueDetails}. An exact match is impossible with the remaining food plan.
          </div>
          <div class="plan-adjustment-note">
            The optimizer will minimize nutritional deviation while respecting the existing food and serving constraints.
          </div>
        `;
        infeasibleNotice.classList.remove('hidden');
      } else {
        infeasibleNotice.classList.add('hidden');
      }
    }

    // Meal cards
    const cardsEl = document.getElementById('meal-result-cards');
    if (cardsEl) {
      cardsEl.innerHTML = r.mealResults.map((meal, mealIdx) => {
        const assignedCustom = (state.customFoods || []).filter(cf => {
          const resolved = resolveMeal(cf.meal, state.meals);
          return resolved && (resolved.id === meal.id || resolved.name === meal.name);
        });
        const hasCustom = assignedCustom.length > 0;

        const optGroupHeader = hasCustom ? '<div class="result-group-header">OPTIMIZED</div>' : '';

        const itemsHTML = meal.items.length > 0
          ? meal.items.map(item => {
              const isEaten = Boolean(item.isEaten);
              const isActual = Boolean(item.isActual);
              const qty = isActual ? item.actualQuantity : item.quantity;
              const badges = [
                isEaten ? '<span class="eaten-badge">EATEN</span>' : '',
                isActual && !isEaten ? '<span class="actual-badge">ACTUAL</span>' : ''
              ].join('');

              return `
                <div class="result-ingredient-row ${isActual ? 'is-actual' : ''} ${isEaten ? 'is-eaten' : ''}"
                     role="button"
                     tabindex="0"
                     data-meal-id="${escAttr(item.mealId || meal.id || mealIdx)}"
                     data-ing-id="${escAttr(item.id || item.name)}"
                     data-meal-name="${escAttr(meal.name)}"
                     data-ing-name="${escAttr(item.name)}"
                     data-unit="${escAttr(item.unit)}"
                     data-planned="${item.plannedQuantity}"
                     data-actual="${isActual ? item.actualQuantity : ''}"
                     data-is-actual="${isActual ? 'true' : 'false'}"
                     data-is-eaten="${isEaten ? 'true' : 'false'}"
                     aria-label="${isEaten ? 'Eaten' : 'Hold to mark eaten'}: ${escAttr(item.name)} in ${escAttr(meal.name)}">
                  <div class="hold-progress" aria-hidden="true">
                    <svg class="hold-progress-svg" preserveAspectRatio="none">
                      <path class="hold-progress-track" fill="none" vector-effect="non-scaling-stroke" />
                      <path class="hold-progress-value" fill="none" vector-effect="non-scaling-stroke" />
                    </svg>
                  </div>
                  <div class="result-ingredient-left">
                    <span class="result-ingredient-name">${esc(item.name)}</span>
                    ${isActual ? `<span class="result-planned-sub">planned ${Math.round(item.plannedQuantity)} ${esc(item.unit)}</span>` : ''}
                  </div>
                  <div class="result-ingredient-right">
                    <div class="result-qty-line">
                      <span class="result-ingredient-qty">${Math.round(qty)} ${esc(item.unit)}</span>
                      ${badges}
                    </div>
                    <span class="result-servings">(${item.servings.toFixed(2)} serv)</span>
                  </div>
                </div>
              `;
            }).join('')
          : '<div class="result-no-items">No ingredients assigned</div>';

        let customGroupHTML = '';
        if (hasCustom) {
          const customRows = assignedCustom.map(cf => {
            const isEstCal = cf.confidence?.calories === 'estimated';
            const isEstPro = cf.confidence?.protein === 'estimated';
            const isEstCarb = cf.confidence?.carbs === 'estimated';
            const isEstFat = cf.confidence?.fat === 'estimated';

            const calStr = cf.calories !== null ? `${isEstCal ? '~' : ''}${Math.round(cf.calories)} kcal` : '—';
            const proStr = cf.protein !== null ? `${isEstPro ? '~' : ''}${cf.protein}P` : '—P';
            const carbStr = cf.carbs !== null ? `${isEstCarb ? '~' : ''}${cf.carbs}C` : '—C';
            const fatStr = cf.fat !== null ? `${isEstFat ? '~' : ''}${cf.fat}F` : '—F';

            return `
              <div class="result-ingredient-row is-custom-consumed">
                <div class="result-ingredient-left">
                  <span class="result-ingredient-name">Custom · ${esc(cf.name)}</span>
                  <span class="result-planned-sub">${cf.amount} ${esc(cf.unit)}</span>
                </div>
                <div class="result-ingredient-right">
                  <div class="result-qty-line">
                    <span class="result-ingredient-qty">${calStr}</span>
                    <span class="custom-badge">CUSTOM</span>
                  </div>
                  <span class="result-servings">${proStr} / ${carbStr} / ${fatStr}</span>
                </div>
              </div>
            `;
          }).join('');

          customGroupHTML = `<div class="result-group-header">CONSUMED</div>${customRows}`;
        }

        return `
          <div class="result-card" data-meal-id="${escAttr(meal.id || mealIdx)}" data-meal-idx="${mealIdx}">
            <div class="result-card-header">
              <span class="result-meal-name">${esc(meal.name)}</span>
              <span class="result-meal-pct">${meal.pct}%</span>
            </div>
            <div class="result-meal-calories">
              <span class="result-cal-actual">${Math.round(meal.calories)}</span>
              <span class="result-cal-target">/ ${Math.round(meal.targetCalories)} kcal</span>
            </div>
            <div class="result-ingredients-list">
              ${optGroupHeader}
              ${itemsHTML}
              ${customGroupHTML}
            </div>
            <div class="result-meal-macros">
              <span class="result-macro-item">
                <span class="lbl">P</span>
                <span class="val">${meal.protein.toFixed(1)}<span class="unit">g</span></span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="lbl">C</span>
                <span class="val">${meal.carbs.toFixed(1)}<span class="unit">g</span></span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="lbl">F</span>
                <span class="val">${meal.fat.toFixed(1)}<span class="unit">g</span></span>
              </span>
            </div>
          </div>
        `;
      }).join('');

      cardsEl.querySelectorAll('.result-ingredient-row:not(.is-custom-consumed)').forEach(row => {
        bindPressAndHold(row, {
          onComplete: () => {
            const outcome = Optimization.toggleIngredientEaten(row.dataset.mealId, row.dataset.ingId);
            if (outcome.errors && outcome.errors.length > 0) {
              UI.showErrors(outcome.errors);
              return;
            }
            Persistence.save();
            UI.renderResults({ scroll: false });
          }
        });

        const handleOpen = () => {
          const mealId = row.dataset.mealId;
          const ingId = row.dataset.ingId;
          const mealName = row.dataset.mealName;
          const ingName = row.dataset.ingName;
          const unit = row.dataset.unit;
          const plannedQuantity = parseFloat(row.dataset.planned) || 0;
          const actualQuantity = row.dataset.actual !== '' ? parseFloat(row.dataset.actual) : null;
          const isActual = row.dataset.isActual === 'true';

          UI.openActualModal({
            mealId,
            ingId,
            mealName,
            ingName,
            unit,
            plannedQuantity,
            actualQuantity,
            isActual
          });
        };

        row.addEventListener('click', (e) => {
          if (row.dataset.holdConsumed === 'true') {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          handleOpen();
        });
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen();
          }
        });
      });
    }

    // ── Unassigned Custom Foods Result Card ──
    const unassignedEl = document.getElementById('unassigned-custom-cards');
    if (unassignedEl) {
      const unassigned = (state.customFoods || []).filter(cf => !resolveMeal(cf.meal, state.meals));
      if (unassigned.length > 0) {
        let unassignedCal = 0, unassignedPro = 0, unassignedCarb = 0, unassignedFat = 0;
        const unassignedRows = unassigned.map(cf => {
          if (cf.calories !== null) unassignedCal += cf.calories;
          if (cf.protein !== null) unassignedPro += cf.protein;
          if (cf.carbs !== null) unassignedCarb += cf.carbs;
          if (cf.fat !== null) unassignedFat += cf.fat;

          const isEstCal = cf.confidence?.calories === 'estimated';
          const isEstPro = cf.confidence?.protein === 'estimated';
          const isEstCarb = cf.confidence?.carbs === 'estimated';
          const isEstFat = cf.confidence?.fat === 'estimated';

          const calStr = cf.calories !== null ? `${isEstCal ? '~' : ''}${Math.round(cf.calories)} kcal` : '—';
          const proStr = cf.protein !== null ? `${isEstPro ? '~' : ''}${cf.protein}P` : '—P';
          const carbStr = cf.carbs !== null ? `${isEstCarb ? '~' : ''}${cf.carbs}C` : '—C';
          const fatStr = cf.fat !== null ? `${isEstFat ? '~' : ''}${cf.fat}F` : '—F';

          return `
            <div class="result-ingredient-row is-custom-consumed">
              <div class="result-ingredient-left">
                <span class="result-ingredient-name">Custom · ${esc(cf.name)}</span>
                <span class="result-planned-sub">${cf.amount} ${esc(cf.unit)}</span>
              </div>
              <div class="result-ingredient-right">
                <div class="result-qty-line">
                  <span class="result-ingredient-qty">${calStr}</span>
                  <span class="custom-badge">CUSTOM</span>
                </div>
                <span class="result-servings">${proStr} / ${carbStr} / ${fatStr}</span>
              </div>
            </div>
          `;
        }).join('');

        unassignedEl.innerHTML = `
          <div class="result-card">
            <div class="result-card-header">
              <span class="result-meal-name">CUSTOM FOODS (UNASSIGNED)</span>
              <span class="result-meal-pct">${unassigned.length} item${unassigned.length > 1 ? 's' : ''}</span>
            </div>
            <div class="result-meal-calories">
              <span class="result-cal-actual">${Math.round(unassignedCal)}</span>
              <span class="result-cal-target">kcal</span>
            </div>
            <div class="result-ingredients-list">
              <div class="result-group-header">CONSUMED</div>
              ${unassignedRows}
            </div>
            <div class="result-meal-macros">
              <span class="result-macro-item">
                <span class="lbl">P</span>
                <span class="val">${unassignedPro.toFixed(1)}<span class="unit">g</span></span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="lbl">C</span>
                <span class="val">${unassignedCarb.toFixed(1)}<span class="unit">g</span></span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="lbl">F</span>
                <span class="val">${unassignedFat.toFixed(1)}<span class="unit">g</span></span>
              </span>
            </div>
          </div>
        `;
      } else {
        unassignedEl.innerHTML = '';
      }
    }

    // Consolidated Daily Summary + Deviation
    const effectiveTotals = r.combinedTotals || r.totals;
    const effectiveDeviations = r.combinedDeviations || r.deviations;

    const macroLabels = [
      { key: 'calories', label: 'Calories', unit: 'kcal', round: true },
      { key: 'protein', label: 'Protein', unit: 'g', round: false },
      { key: 'carbs', label: 'Carbs', unit: 'g', round: false },
      { key: 'fat', label: 'Fat', unit: 'g', round: false }
    ];

    const summaryRows = macroLabels.map(m => {
      const actual = m.round ? Math.round(effectiveTotals[m.key]) : effectiveTotals[m.key].toFixed(1);
      const target = state.targets[m.key];
      const dev = effectiveDeviations[m.key] || { absolute: 0, percentage: 0 };
      const absVal = m.round ? Math.abs(Math.round(dev.absolute)) : Math.abs(dev.absolute).toFixed(1);
      const sign = dev.absolute > 0.001 ? '+' : dev.absolute < -0.001 ? '-' : '';
      const pctVal = Math.abs(dev.percentage).toFixed(1);
      const isZero = Math.abs(dev.absolute) < (m.round ? 1 : 0.05);
      const cls = isZero ? 'deviation-zero' : 'deviation-error';
      const devFormatted = isZero ? `0${m.unit} (0.0%)` : `${sign}${absVal}${m.unit} (${sign}${pctVal}%)`;

      return `
        <div class="consolidated-row">
          <span class="macro-name">${m.label}</span>
          <div class="macro-values">
            <span class="macro-actual">${actual}</span>
            <span class="macro-target">/ ${target}${m.unit}</span>
            <span class="macro-slash">/</span>
            <span class="macro-dev ${cls}">${devFormatted}</span>
          </div>
        </div>
      `;
    }).join('');

    const dailySummaryEl = document.getElementById('daily-summary');
    if (dailySummaryEl) {
      const today = getLocalDateString();
      const existingSnapshot = state.intakeHistory && state.intakeHistory[today];
      const isSnapshotted = Boolean(existingSnapshot);
      const snapshotBtnText = isSnapshotted ? 'UPDATE EATEN SNAPSHOT' : 'SNAPSHOT EATEN ITEMS';
      const snapshotItemCount = existingSnapshot?.eatenItemCount ?? null;

      let snapshotKcalDisplay = '—';
      if (existingSnapshot && existingSnapshot.totals) {
        if (typeof existingSnapshot.totals.calories === 'number') {
          const isCalUnknown = Boolean(existingSnapshot.totals.caloriesUnknown);
          const rounded = Math.round(existingSnapshot.totals.calories);
          snapshotKcalDisplay = isCalUnknown ? `≥${rounded} kcal` : `${rounded} kcal`;
        }
      }

      const snapshotBadge = isSnapshotted
        ? `<span class="snapshot-status-badge"${existingSnapshot?.totals?.caloriesUnknown ? ' title="Known subtotal; contains items with unknown calories"' : ''}>Eaten: ${snapshotItemCount !== null ? `${snapshotItemCount} item${snapshotItemCount !== 1 ? 's' : ''} · ` : ''}${snapshotKcalDisplay}</span>`
        : '';

      let breakdownBoxHTML = '';
      if (state.customFoods && state.customFoods.length > 0 && r.customFoodTotals) {
        const cf = r.customFoodTotals;
        const pStr = cf.proteinUnknown ? '—' : `${cf.protein.toFixed(1)}g`;
        const cStr = cf.carbsUnknown ? '—' : `${cf.carbs.toFixed(1)}g`;
        const fStr = cf.fatUnknown ? '—' : `${cf.fat.toFixed(1)}g`;

        breakdownBoxHTML = `
          <div class="summary-breakdown-box">
            <div class="summary-breakdown-row">
              <span class="summary-breakdown-lbl">TARGET</span>
              <span>${Math.round(state.targets.calories)} kcal | ${Math.round(state.targets.protein)}P | ${Math.round(state.targets.carbs)}C | ${Math.round(state.targets.fat)}F</span>
            </div>
            <div class="summary-breakdown-row">
              <span class="summary-breakdown-lbl">CUSTOM FOODS</span>
              <span>${Math.round(cf.calories)} kcal | ${pStr}P | ${cStr}C | ${fStr}F</span>
            </div>
            <div class="summary-breakdown-row">
              <span class="summary-breakdown-lbl">OPTIMIZED FOODS</span>
              <span>${Math.round(r.totals.calories)} kcal | ${r.totals.protein.toFixed(1)}P | ${r.totals.carbs.toFixed(1)}C | ${r.totals.fat.toFixed(1)}F</span>
            </div>
            <div class="summary-breakdown-row is-total">
              <span class="summary-breakdown-lbl">TOTAL</span>
              <span>${Math.round(effectiveTotals.calories)} kcal | ${effectiveTotals.protein.toFixed(1)}P | ${effectiveTotals.carbs.toFixed(1)}C | ${effectiveTotals.fat.toFixed(1)}F</span>
            </div>
          </div>
        `;
      }

      dailySummaryEl.innerHTML = `
        <div class="summary-card">
          <div class="summary-header-row">
            <div class="summary-title">Daily Summary</div>
            ${snapshotBadge}
          </div>
          ${breakdownBoxHTML}
          <div class="consolidated-summary-list">
            ${summaryRows}
          </div>
          <div class="summary-actions">
            <button type="button" class="btn btn-sm ${isSnapshotted ? 'btn-update-snapshot' : 'btn-snapshot'}" id="snapshot-intake-btn">
              ${snapshotBtnText}
            </button>
          </div>
        </div>
      `;

      const snapshotBtn = document.getElementById('snapshot-intake-btn');
      if (snapshotBtn) {
        snapshotBtn.addEventListener('click', () => {
          const snapshot = createIntakeSnapshot(state, today);

          // No items to record
          if (!snapshot || snapshot.eatenItemCount === 0) {
            UI._showSnapshotHint(snapshotBtn, 'Mark items as EATEN first (hold an ingredient row) or add custom foods.', 'warn');
            return;
          }

          const res = recordIntakeSnapshot(state.intakeHistory, snapshot);
          if (!res.error) {
            state.intakeHistory = res.intakeHistory;
            Persistence.save();
            UI.renderResults({ scroll: false });
            UI.renderWeightTab();
          } else {
            UI._showSnapshotHint(snapshotBtn, `Snapshot failed: ${res.error}`, 'error');
          }
        });
      }
    }

    // Approximate notice
    const notice = document.getElementById('approx-notice');
    if (notice) {
      if (r.approximate) {
        notice.textContent = 'Approximate nutritional solution: Result deviates from target macros due to ingredient bounds or limits.';
        notice.classList.remove('hidden');
      } else {
        notice.classList.add('hidden');
      }
    }

    // Solver Calculation Debug Log
    const debugContainer = document.getElementById('solver-debug-container');
    if (debugContainer) {
      const debugText = UI.generateSolverDebugLog(state);
      debugContainer.innerHTML = `
        <div class="solver-debug-toggle-wrap">
          <button type="button" class="solver-debug-toggle-btn" id="toggle-solver-debug-btn">SHOW CALCULATION DEBUG LOG</button>
          <pre class="solver-debug-log hidden" id="solver-debug-log">${esc(debugText)}</pre>
        </div>
      `;

      const toggleBtn = document.getElementById('toggle-solver-debug-btn');
      const debugLogEl = document.getElementById('solver-debug-log');
      if (toggleBtn && debugLogEl) {
        toggleBtn.addEventListener('click', () => {
          const isHidden = debugLogEl.classList.toggle('hidden');
          toggleBtn.textContent = isHidden ? 'SHOW CALCULATION DEBUG LOG' : 'HIDE CALCULATION DEBUG LOG';
        });
      }
    }

    section.classList.add('visible');
    if (scroll) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  generateSolverDebugLog(state) {
    const r = state.result;
    if (!r) return 'No solver result available.';

    const fp = generateStateFingerprint(state);
    const lines = [];

    lines.push(`State Fingerprint: ${fp}`);
    lines.push(`Solve Feasible: ${r.feasible !== false}, Approximate: ${Boolean(r.approximate)}`);
    if (typeof r.objective === 'number') {
      lines.push(`Objective Value (J): ${r.objective.toFixed(6)}`);
    }

    // Model Dimensions
    const activeIngs = (state.ingredients || []).filter(i => resolveAvailability(i.availability) !== 'out');
    const lockedCount = Object.keys(state.actuals || {}).length;
    const eatenCount = Object.keys(state.eatenItems || {}).length;
    lines.push(`Model Dimensions: ${state.meals?.length || 0} meals, ${activeIngs.length} active ingredients (${(state.ingredients || []).length} total)`);
    lines.push(`Active Locks: ${lockedCount} actual portions locked, ${eatenCount} items marked eaten`);
    lines.push(`Meal Constraints: [${state.mealConstraints?.minIngredients ?? 1}, ${state.mealConstraints?.maxIngredients ?? 4}] ingredients per meal`);

    // Target Deviations
    if (r.totals && r.deviations) {
      lines.push(`---`);
      lines.push(`Target Deviations:`);
      const macros = ['calories', 'protein', 'carbs', 'fat'];
      macros.forEach(m => {
        const tot = r.totals[m];
        const tgt = state.targets[m];
        const dev = r.deviations[m];
        const unit = m === 'calories' ? 'kcal' : 'g';
        const valStr = m === 'calories' ? Math.round(tot) : (tot != null ? tot.toFixed(1) : '0');
        const devAbs = dev?.absolute ?? 0;
        const devStr = m === 'calories' ? Math.round(devAbs) : devAbs.toFixed(1);
        const sign = devAbs > 0 ? '+' : '';
        const pct = dev?.percentage != null ? dev.percentage.toFixed(1) : '0.0';
        lines.push(`  ${m.toUpperCase()}: ${valStr} / ${tgt}${unit} (Δ: ${sign}${devStr}${unit}, ${pct}%)`);
      });
    }

    // Meal Allocation Breakdown
    if (r.mealResults && r.mealResults.length > 0) {
      lines.push(`---`);
      lines.push(`Meal Allocations:`);
      r.mealResults.forEach((m, idx) => {
        const itemNames = (m.items || []).map(it => `${it.name} (${Math.round(it.quantity)}${it.unit})`).join(', ');
        lines.push(`  #${idx + 1} ${m.name} (${m.pct}%): ${Math.round(m.calories)}/${Math.round(m.targetCalories)} kcal [${itemNames || 'None'}]`);
      });
    }

    // Weights & Penalties
    lines.push(`---`);
    lines.push(`Optimization Weights & Penalties:`);
    lines.push(`  Weights: Calories=${state.weights?.calories ?? 1}, Protein=${state.weights?.protein ?? 1}, Carbs=${state.weights?.carbs ?? 0.5}, Fat=${state.weights?.fat ?? 0.5}, MealAllocation=${state.weights?.mealAllocation ?? 0.2}`);
    lines.push(`  Penalties: Simplicity=${state.penalties?.simplicity ?? 0.0005}, Quantity=${state.penalties?.quantity ?? 0.00001}, BoundaryExcess=${state.penalties?.boundaryExcess ?? 0.002}`);

    return lines.join('\n');
  },


  // ── WEIGHT TAB ──
  renderWeightTab() {
    const today = getLocalDateString();
    const todayDateEl = document.getElementById('weight-today-date');
    if (todayDateEl) {
      const d = new Date();
      todayDateEl.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const todayWeightRec = state.weightHistory && state.weightHistory[today];
    const weightInput = document.getElementById('daily-weight-input');
    const recordBtn = document.getElementById('record-weight-btn');
    const statusHint = document.getElementById('weight-status-hint');

    if (weightInput && recordBtn) {
      if (todayWeightRec && typeof todayWeightRec.weight === 'number') {
        weightInput.value = todayWeightRec.weight;
        recordBtn.textContent = 'UPDATE';
        if (statusHint) {
          statusHint.innerHTML = `<span class="recorded-tag">Recorded today: <strong>${todayWeightRec.weight} lb</strong></span>`;
        }
      } else {
        if (!weightInput.value) {
          weightInput.placeholder = '184.3';
        }
        recordBtn.textContent = 'RECORD';
        if (statusHint) {
          statusHint.textContent = 'Enter your morning weigh-in';
        }
      }
    }

    // Stats Grid
    const curW = calculateCurrentWeight(state.weightHistory, today);
    const avg7 = calculateMovingAverage(state.weightHistory, 7, today);
    const avg14 = calculateMovingAverage(state.weightHistory, 14, today);
    const trendRate = calculateWeightTrend(state.weightHistory, { windowDays: 14, minObservations: 3, referenceDate: today });

    const statsGrid = document.getElementById('weight-stats-grid');
    if (statsGrid) {
      const curDisplay = curW !== null ? `${curW.toFixed(1)} <span class="stat-unit">lb</span>` : '<span class="dim-dash">—</span>';
      const avg7Display = avg7 !== null ? `${avg7.toFixed(1)} <span class="stat-unit">lb</span>` : '<span class="dim-dash">—</span>';
      const avg14Display = avg14 !== null ? `${avg14.toFixed(1)} <span class="stat-unit">lb</span>` : '<span class="dim-dash">—</span>';

      let rateDisplay = '<span class="dim-dash">—</span>';
      let rateClass = '';
      if (trendRate !== null) {
        const sign = trendRate > 0.001 ? '+' : '';
        rateDisplay = `${sign}${trendRate.toFixed(2)} <span class="stat-unit">lb/wk</span>`;
        rateClass = trendRate < -0.001 ? 'rate-negative' : trendRate > 0.001 ? 'rate-positive' : '';
      }

      statsGrid.innerHTML = `
        <div class="stat-card">
          <div class="stat-label">CURRENT</div>
          <div class="stat-value">${curDisplay}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">7-DAY AVG</div>
          <div class="stat-value">${avg7Display}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">14-DAY AVG</div>
          <div class="stat-value">${avg14Display}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">RATE</div>
          <div class="stat-value ${rateClass}">${rateDisplay}</div>
        </div>
      `;
    }

    // ── NUTRITIONAL TREND SUMMARY (HERO LAYOUT) ──
    const nutritionHeroContainer = document.getElementById('nutrition-hero-container');
    if (nutritionHeroContainer) {
      const selector = document.getElementById('nutrition-window-selector');
      if (selector && !selector.dataset.bound) {
        selector.dataset.bound = 'true';
        selector.addEventListener('click', (e) => {
          const btn = e.target.closest('.nutrition-window-pill');
          if (!btn) return;
          const days = parseInt(btn.getAttribute('data-days'), 10);
          if (!isNaN(days) && days !== activeNutritionWindowDays) {
            activeNutritionWindowDays = days;
            UI.renderWeightTab();
          }
        });
      }

      const pills = document.querySelectorAll('.nutrition-window-pill');
      pills.forEach(pill => {
        const days = parseInt(pill.getAttribute('data-days'), 10);
        pill.classList.toggle('active', days === activeNutritionWindowDays);
      });

      const intakeStats = calculateIntakeStats(
        state.intakeHistory,
        activeNutritionWindowDays,
        today,
        state.targets
      );

      const formatNutrient = (key, stat, unit) => {
        const isKcal = key === 'calories';
        const fmt = (v) => (v !== null && typeof v === 'number'
          ? (isKcal ? Math.round(v).toLocaleString() : v.toFixed(1))
          : '<span class="dim-dash">—</span>');

        const meanDisplay = stat.mean !== null
          ? `${fmt(stat.mean)} <span class="stat-unit">${unit}</span>`
          : '<span class="dim-dash">—</span>';

        const sdDisplay = stat.sd !== null
          ? `±${isKcal ? Math.round(stat.sd).toLocaleString() : stat.sd.toFixed(1)}`
          : '<span class="dim-dash">—</span>';

        const medianDisplay = stat.median !== null
          ? `${fmt(stat.median)} <span class="stat-unit">${unit}</span>`
          : '<span class="dim-dash">—</span>';

        const minDisplay = stat.min !== null ? fmt(stat.min) : '—';
        const maxDisplay = stat.max !== null ? fmt(stat.max) : '—';
        const rangeDisplay = (stat.min !== null && stat.max !== null)
          ? `${minDisplay}–${maxDisplay} <span class="stat-unit">${unit}</span>`
          : '<span class="dim-dash">—</span>';

        const targetDisplay = stat.target !== null
          ? `${fmt(stat.target)} <span class="stat-unit">${unit}</span>`
          : '<span class="dim-dash">—</span>';

        const diffDisplay = stat.difference !== null
          ? `${stat.difference > 0 ? '+' : ''}${fmt(stat.difference)} <span class="stat-unit">${unit}</span>`
          : '<span class="dim-dash">—</span>';

        const pctDiffDisplay = stat.percentDifference !== null
          ? `${stat.percentDifference > 0 ? '+' : ''}${stat.percentDifference.toFixed(1)}%`
          : '<span class="dim-dash">—</span>';

        return {
          meanDisplay,
          sdDisplay,
          medianDisplay,
          rangeDisplay,
          targetDisplay,
          diffDisplay,
          pctDiffDisplay,
          n: stat.n
        };
      };

      if (!intakeStats || intakeStats.distinctDays === 0) {
        nutritionHeroContainer.innerHTML = `
          <div class="nutrition-hero-card nutrition-empty-card">
            <div class="nutrition-hero-header">
              <span class="nutrition-hero-label">AVERAGE DAILY CALORIES</span>
              <span class="nutrition-days-badge">0 / ${activeNutritionWindowDays} <span class="dim-sub">days logged</span></span>
            </div>
            <div class="nutrition-hero-val"><span class="dim-dash">—</span></div>
            <div class="nutrition-hero-empty-msg">No intake snapshots in this period</div>
            <div class="nutrition-hero-empty-hint">Record a snapshot from the Solver tab.</div>
          </div>
          <div class="nutrition-macro-grid">
            <div class="stat-card nutrition-macro-card">
              <div class="stat-label">CARBS</div>
              <div class="stat-value"><span class="dim-dash">—</span></div>
              <div class="macro-sub-meta"><span class="dim-dash">—</span></div>
              <div class="macro-sub-pct"><span class="dim-dash">—</span></div>
            </div>
            <div class="stat-card nutrition-macro-card">
              <div class="stat-label">FAT</div>
              <div class="stat-value"><span class="dim-dash">—</span></div>
              <div class="macro-sub-meta"><span class="dim-dash">—</span></div>
              <div class="macro-sub-pct"><span class="dim-dash">—</span></div>
            </div>
            <div class="stat-card nutrition-macro-card">
              <div class="stat-label">PROTEIN</div>
              <div class="stat-value"><span class="dim-dash">—</span></div>
              <div class="macro-sub-meta"><span class="dim-dash">—</span></div>
              <div class="macro-sub-pct"><span class="dim-dash">—</span></div>
            </div>
          </div>
        `;
      } else {
        const cal = formatNutrient('calories', intakeStats.calories, 'kcal');
        const carbs = formatNutrient('carbs', intakeStats.carbs, 'g');
        const fat = formatNutrient('fat', intakeStats.fat, 'g');
        const pro = formatNutrient('protein', intakeStats.protein, 'g');

        let targetBadgeHtml = '';
        if (intakeStats.calories.mean !== null && intakeStats.calories.target !== null) {
          const diff = Math.round(intakeStats.calories.difference);
          const targetVal = Math.round(intakeStats.calories.target).toLocaleString();
          const sign = diff > 0 ? '+' : '';
          const diffClass = Math.abs(diff) <= 15 ? 'target-match' : (diff > 0 ? 'target-over' : 'target-under');
          const pctSign = intakeStats.calories.percentDifference > 0 ? '+' : '';
          const pctStr = intakeStats.calories.percentDifference !== null
            ? ` (${pctSign}${intakeStats.calories.percentDifference.toFixed(1)}%)`
            : '';
          const label = diff === 0
            ? `On Target (${targetVal})`
            : `${sign}${diff} kcal${pctStr} vs target (${targetVal})`;
          targetBadgeHtml = `<span class="target-diff-pill ${diffClass}">${label}</span>`;
        }

        const avgCarbs = intakeStats.carbs.mean;
        const avgFat = intakeStats.fat.mean;
        const avgProtein = intakeStats.protein.mean;

        const carbKcal = avgCarbs !== null ? avgCarbs * 4 : null;
        const fatKcal = avgFat !== null ? avgFat * 9 : null;
        const proteinKcal = avgProtein !== null ? avgProtein * 4 : null;

        const carbsKcalDisplay = carbKcal !== null ? `${Math.round(carbKcal).toLocaleString()} <span class="stat-unit">kcal</span>` : '<span class="dim-dash">—</span>';
        const fatKcalDisplay = fatKcal !== null ? `${Math.round(fatKcal).toLocaleString()} <span class="stat-unit">kcal</span>` : '<span class="dim-dash">—</span>';
        const proteinKcalDisplay = proteinKcal !== null ? `${Math.round(proteinKcal).toLocaleString()} <span class="stat-unit">kcal</span>` : '<span class="dim-dash">—</span>';

        let carbsPctDisplay = '<span class="dim-dash">—</span>';
        let fatPctDisplay = '<span class="dim-dash">—</span>';
        let proteinPctDisplay = '<span class="dim-dash">—</span>';
        let macroBarHtml = '';

        const allMacrosKnown = carbKcal !== null && fatKcal !== null && proteinKcal !== null;
        const anyMacroKnown = carbKcal !== null || fatKcal !== null || proteinKcal !== null;

        if (allMacrosKnown) {
          const totalMacroKcal = carbKcal + fatKcal + proteinKcal;
          if (totalMacroKcal > 0) {
            const carbPct = (carbKcal / totalMacroKcal) * 100;
            const fatPct = (fatKcal / totalMacroKcal) * 100;
            const proPct = (proteinKcal / totalMacroKcal) * 100;

            carbsPctDisplay = `${carbPct.toFixed(1)}%`;
            fatPctDisplay = `${fatPct.toFixed(1)}%`;
            proteinPctDisplay = `${proPct.toFixed(1)}%`;

            macroBarHtml = `
              <div class="macro-split-bar" role="progressbar" aria-label="Macro distribution" title="Carbs ${carbPct.toFixed(1)}%, Fat ${fatPct.toFixed(1)}%, Protein ${proPct.toFixed(1)}%">
                <div class="macro-bar-seg seg-carbs" style="width: ${carbPct}%;"></div>
                <div class="macro-bar-seg seg-fat" style="width: ${fatPct}%;"></div>
                <div class="macro-bar-seg seg-protein" style="width: ${proPct}%;"></div>
              </div>
            `;
          }
        } else if (anyMacroKnown) {
          macroBarHtml = `
            <div class="macro-split-incomplete">Macro distribution incomplete (missing nutrient observations)</div>
          `;
        }

        const calSdBadgeHtml = intakeStats.calories.sd !== null
          ? `<span class="stat-sd-tag">SD ${cal.sdDisplay}</span>`
          : '';

        nutritionHeroContainer.innerHTML = `
          <!-- HERO CALORIES CARD -->
          <div class="nutrition-hero-card">
            <div class="nutrition-hero-header">
              <span class="nutrition-hero-label">AVERAGE DAILY CALORIES</span>
              <span class="nutrition-days-badge">${intakeStats.distinctDays} / ${activeNutritionWindowDays} <span class="dim-sub">days logged</span></span>
            </div>
            <div class="nutrition-hero-primary-row">
              <div class="nutrition-hero-val-wrap">
                <div class="nutrition-hero-val">${cal.meanDisplay} <span class="hero-unit">/day</span></div>
                ${calSdBadgeHtml}
              </div>
              ${targetBadgeHtml}
            </div>

            <div class="nutrition-hero-substats">
              <div class="hero-substat">
                <span class="substat-label">MEDIAN</span>
                <span class="substat-val">${cal.medianDisplay}</span>
              </div>
              <div class="hero-substat">
                <span class="substat-label">MIN – MAX</span>
                <span class="substat-val">${cal.rangeDisplay}</span>
              </div>
              <div class="hero-substat">
                <span class="substat-label">AVG % DIFF</span>
                <span class="substat-val">${cal.pctDiffDisplay}</span>
              </div>
              <div class="hero-substat">
                <span class="substat-label">OBS</span>
                <span class="substat-val">n = ${cal.n}</span>
              </div>
            </div>

            ${macroBarHtml}
          </div>

          <!-- 3 MACRO CARDS UNDER HERO (CARBS, FAT, PROTEIN) -->
          <div class="nutrition-macro-grid">
            <!-- 1. CARBS -->
            <div class="stat-card nutrition-macro-card">
              <div class="macro-card-header">
                <span class="stat-label">CARBS</span>
                <span class="macro-sd-tag">${carbs.sdDisplay}</span>
              </div>
              <div class="stat-value">${carbs.meanDisplay}</div>
              <div class="macro-sub-meta">${carbsKcalDisplay}</div>
              <div class="macro-sub-pct">${carbsPctDisplay}</div>
              <div class="macro-card-substats">
                <div class="macro-stat-row">
                  <span class="substat-label">MED</span>
                  <span class="substat-val">${carbs.medianDisplay}</span>
                </div>
                <div class="macro-stat-row">
                  <span class="substat-label">RANGE</span>
                  <span class="substat-val">${carbs.rangeDisplay}</span>
                </div>
                <div class="macro-stat-row">
                  <span class="substat-label">% DIFF</span>
                  <span class="substat-val">${carbs.pctDiffDisplay}</span>
                </div>
              </div>
            </div>

            <!-- 2. FAT -->
            <div class="stat-card nutrition-macro-card">
              <div class="macro-card-header">
                <span class="stat-label">FAT</span>
                <span class="macro-sd-tag">${fat.sdDisplay}</span>
              </div>
              <div class="stat-value">${fat.meanDisplay}</div>
              <div class="macro-sub-meta">${fatKcalDisplay}</div>
              <div class="macro-sub-pct">${fatPctDisplay}</div>
              <div class="macro-card-substats">
                <div class="macro-stat-row">
                  <span class="substat-label">MED</span>
                  <span class="substat-val">${fat.medianDisplay}</span>
                </div>
                <div class="macro-stat-row">
                  <span class="substat-label">RANGE</span>
                  <span class="substat-val">${fat.rangeDisplay}</span>
                </div>
                <div class="macro-stat-row">
                  <span class="substat-label">% DIFF</span>
                  <span class="substat-val">${fat.pctDiffDisplay}</span>
                </div>
              </div>
            </div>

            <!-- 3. PROTEIN -->
            <div class="stat-card nutrition-macro-card">
              <div class="macro-card-header">
                <span class="stat-label">PROTEIN</span>
                <span class="macro-sd-tag">${pro.sdDisplay}</span>
              </div>
              <div class="stat-value">${pro.meanDisplay}</div>
              <div class="macro-sub-meta">${proteinKcalDisplay}</div>
              <div class="macro-sub-pct">${proteinPctDisplay}</div>
              <div class="macro-card-substats">
                <div class="macro-stat-row">
                  <span class="substat-label">MED</span>
                  <span class="substat-val">${pro.medianDisplay}</span>
                </div>
                <div class="macro-stat-row">
                  <span class="substat-label">RANGE</span>
                  <span class="substat-val">${pro.rangeDisplay}</span>
                </div>
                <div class="macro-stat-row">
                  <span class="substat-label">% DIFF</span>
                  <span class="substat-val">${pro.pctDiffDisplay}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- COMPACT LONGITUDINAL STATISTICAL BREAKDOWN TABLE -->
          <div class="card nutrition-breakdown-card">
            <div class="nutrition-breakdown-header">
              <span class="nutrition-breakdown-title">STATISTICAL BREAKDOWN</span>
              <span class="history-count-badge">${intakeStats.distinctDays} / ${activeNutritionWindowDays} days</span>
            </div>
            <div class="table-responsive">
              <table class="history-table nutrition-table">
                <thead>
                  <tr>
                    <th class="col-metric">METRIC</th>
                    <th class="col-mean">MEAN</th>
                    <th class="col-sd">SD (±)</th>
                    <th class="col-median">MEDIAN</th>
                    <th class="col-range">MIN – MAX</th>
                    <th class="col-target">TARGET</th>
                    <th class="col-diff">% DIFF</th>
                    <th class="col-n">N</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="col-metric">CALORIES</td>
                    <td class="col-mean">${cal.meanDisplay}</td>
                    <td class="col-sd">${cal.sdDisplay}</td>
                    <td class="col-median">${cal.medianDisplay}</td>
                    <td class="col-range">${cal.rangeDisplay}</td>
                    <td class="col-target">${cal.targetDisplay}</td>
                    <td class="col-diff">${cal.pctDiffDisplay}</td>
                    <td class="col-n">${cal.n}</td>
                  </tr>
                  <tr>
                    <td class="col-metric">CARBS</td>
                    <td class="col-mean">${carbs.meanDisplay}</td>
                    <td class="col-sd">${carbs.sdDisplay}</td>
                    <td class="col-median">${carbs.medianDisplay}</td>
                    <td class="col-range">${carbs.rangeDisplay}</td>
                    <td class="col-target">${carbs.targetDisplay}</td>
                    <td class="col-diff">${carbs.pctDiffDisplay}</td>
                    <td class="col-n">${carbs.n}</td>
                  </tr>
                  <tr>
                    <td class="col-metric">FAT</td>
                    <td class="col-mean">${fat.meanDisplay}</td>
                    <td class="col-sd">${fat.sdDisplay}</td>
                    <td class="col-median">${fat.medianDisplay}</td>
                    <td class="col-range">${fat.rangeDisplay}</td>
                    <td class="col-target">${fat.targetDisplay}</td>
                    <td class="col-diff">${fat.pctDiffDisplay}</td>
                    <td class="col-n">${fat.n}</td>
                  </tr>
                  <tr>
                    <td class="col-metric">PROTEIN</td>
                    <td class="col-mean">${pro.meanDisplay}</td>
                    <td class="col-sd">${pro.sdDisplay}</td>
                    <td class="col-median">${pro.medianDisplay}</td>
                    <td class="col-range">${pro.rangeDisplay}</td>
                    <td class="col-target">${pro.targetDisplay}</td>
                    <td class="col-diff">${pro.pctDiffDisplay}</td>
                    <td class="col-n">${pro.n}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
    }

    // Longitudinal History Table (Outer Join)
    const rows = getCombinedHistoryRows(state.weightHistory, state.intakeHistory);
    const countBadge = document.getElementById('history-count-badge');
    if (countBadge) {
      countBadge.textContent = `${rows.length} ${rows.length === 1 ? 'day' : 'days'}`;
    }

    const tableContainer = document.getElementById('history-table-container');
    if (tableContainer) {
      if (rows.length === 0) {
        tableContainer.innerHTML = '<div class="history-empty">No historical weight or intake records logged yet.</div>';
      } else {
        const tableRows = rows.map(r => {
          const wStr = r.hasWeight ? `${r.weight.toFixed(1)}` : '<span class="dim-dash">—</span>';
          const calStr = r.hasIntake ? (typeof r.calories === 'number' ? `${Math.round(r.calories)}` : '<span class="dim-dash">—</span>') : '<span class="dim-dash">—</span>';
          const proStr = r.hasIntake ? (typeof r.protein === 'number' ? `${r.protein.toFixed(1)}g` : '<span class="dim-dash">—</span>') : '<span class="dim-dash">—</span>';
          const carbStr = r.hasIntake ? (typeof r.carbs === 'number' ? `${r.carbs.toFixed(1)}g` : '<span class="dim-dash">—</span>') : '<span class="dim-dash">—</span>';
          const fatStr = r.hasIntake ? (typeof r.fat === 'number' ? `${r.fat.toFixed(1)}g` : '<span class="dim-dash">—</span>') : '<span class="dim-dash">—</span>';

          const parts = r.date.split('-');
          const displayDate = parts.length === 3 ? `${parts[1]}/${parts[2]}/${parts[0].slice(2)}` : r.date;

          return `
            <tr>
              <td class="col-date">${esc(displayDate)}</td>
              <td class="col-weight">${wStr}</td>
              <td class="col-kcal">${calStr}</td>
              <td class="col-protein">${proStr}</td>
              <td class="col-carbs">${carbStr}</td>
              <td class="col-fat">${fatStr}</td>
            </tr>
          `;
        }).join('');

        tableContainer.innerHTML = `
          <table class="history-table">
            <thead>
              <tr>
                <th class="col-date">DATE</th>
                <th class="col-weight">WEIGHT (lb)</th>
                <th class="col-kcal">KCAL</th>
                <th class="col-protein">PROTEIN</th>
                <th class="col-carbs">CARBS</th>
                <th class="col-fat">FAT</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        `;
      }
    }
  },
  // ── Snapshot feedback helpers ──


  /**
   * Shows a transient inline hint beneath a button.
   * type: 'error' | 'warn'
   */
  _showSnapshotHint(anchorBtn, message, type = 'warn') {
    // Remove existing hint
    const existing = anchorBtn.parentElement?.querySelector('.snapshot-inline-hint');
    if (existing) existing.remove();

    const hint = document.createElement('div');
    hint.className = `snapshot-inline-hint snapshot-inline-hint--${type}`;
    hint.textContent = message;
    anchorBtn.insertAdjacentElement('afterend', hint);

    setTimeout(() => hint.remove(), 3000);
  },

  hideResults() {
    const section = document.getElementById('results-section');
    if (section) section.classList.remove('visible');
    const uneatenAllBtn = document.getElementById('uneaten-all-btn');
    if (uneatenAllBtn) uneatenAllBtn.disabled = true;
  },

  showErrors(errors) {
    const container = document.getElementById('error-list');
    if (!container) return;
    container.innerHTML = errors.map(e => `<li>${esc(e)}</li>`).join('');
    const errorSection = document.getElementById('error-section');
    if (errorSection) {
      errorSection.classList.remove('hidden');
      errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },

  clearErrors() {
    const container = document.getElementById('error-list');
    if (container) container.innerHTML = '';
    const errorSection = document.getElementById('error-section');
    if (errorSection) errorSection.classList.add('hidden');
  },

  recommendationCache: null,
  recommendationDebugLog: null,
  _analysisRunning: false,

  async runRecommendationAnalysis() {
    if (UI._analysisRunning) return;
    UI._analysisRunning = true;

    const statusBadge = document.getElementById('recommend-status-badge');
    const analyzeBtn = document.getElementById('analyze-recommend-btn');
    if (statusBadge) statusBadge.textContent = 'ANALYZING...';
    if (analyzeBtn) analyzeBtn.disabled = true;

    const logLines = [];
    const t0 = performance.now();

    try {
      const outcome = await getRecommendationsAsync(state, {
        limit: 10,
        groceryLimit: 5,
        onProgress(done, total) {
          if (statusBadge) statusBadge.textContent = `${done}/${total}`;
        }
      });

      const elapsed = (performance.now() - t0).toFixed(1);

      logLines.push(`══════════════════════════════════════════════════════════════`);
      logLines.push(` RECOMMENDATION OPTIMIZATION CASCADE AUDIT TRAIL              `);
      logLines.push(`══════════════════════════════════════════════════════════════\n`);
      logLines.push(`[1] BASELINE STATE & OPTIMIZATION CONTEXT:`);
      logLines.push(`    State Fingerprint: ${outcome.stateFingerprint}`);
      logLines.push(`    Baseline Feasibility: ${outcome.baselineSummary.feasible ? 'FEASIBLE' : 'INFEASIBLE'}`);
      logLines.push(`    Baseline Objective (J_B): ${outcome.baselineSummary.objective?.toFixed(6) ?? 'N/A'}`);
      if (outcome.baselineSummary.totals) {
        const t = outcome.baselineSummary.totals;
        const tgts = state.targets || { calories: 2000, protein: 150, carbs: 200, fat: 60 };
        logLines.push(`    Current Totals:  kcal=${Math.round(t.calories || 0)} | P=${(t.protein || 0).toFixed(1)}g | C=${(t.carbs || 0).toFixed(1)}g | F=${(t.fat || 0).toFixed(1)}g`);
        logLines.push(`    Target Totals:   kcal=${tgts.calories} | P=${tgts.protein}g | C=${tgts.carbs}g | F=${tgts.fat}g`);
      }
      if (outcome.baselineSummary.deviations) {
        const d = outcome.baselineSummary.deviations;
        logLines.push(`    Macro Deviations: kcal=${d.calories?.absolute?.toFixed(1)} | P=${d.protein?.absolute?.toFixed(1)}g | C=${d.carbs?.absolute?.toFixed(1)}g | F=${d.fat?.absolute?.toFixed(1)}g`);
      }

      logLines.push(`\n[2] PIPELINE EXECUTION SUMMARY:`);
      logLines.push(`    Stage 1 Candidates Generated: ${outcome.auditTrail?.stage1Candidates ?? outcome.candidatesEvaluated ?? '0'}`);
      logLines.push(`    Stage 2 Continuous LP Evaluated: ${outcome.auditTrail?.stage2LPEvaluated ?? '0'}`);
      logLines.push(`    Stage 2 Provably Pruned (ΔJ_max < ε): ${outcome.auditTrail?.stage2BoundPruned ?? '0'}`);
      logLines.push(`    Stage 3 Exact MILP Solves: ${outcome.auditTrail?.stage3ExactSolved ?? '0'}`);
      logLines.push(`    Plan Adjustments Found: ${outcome.planAdjustments?.length ?? 0}`);
      logLines.push(`    Grocery Stocking Items: ${outcome.groceryRecommendations?.length ?? 0}`);
      logLines.push(`    Cascade Execution Time: ${elapsed} ms`);

      logLines.push(`\n[3] GROCERY STOCKING RECOMMENDATIONS (Future Flexibility & Store Shopping):`);
      if (outcome.groceryRecommendations && outcome.groceryRecommendations.length > 0) {
        outcome.groceryRecommendations.forEach((g, i) => {
          logLines.push(`    #${i + 1} [${g.roleLabel || g.role}] ${g.ingredientName} (Score: ${g.score}/100, ${g.urgencyLabel})`);
          logLines.push(`        Metrics: Density=${g.metrics?.macroDensity} | Flexibility=${g.metrics?.macroFlexibility} | TargetFit=${g.metrics?.targetCompatibility}`);
          if (g.reasons?.length > 0) {
            logLines.push(`        Reasons: ${g.reasons.join(' | ')}`);
          }
        });
      } else {
        logLines.push(`    (No grocery recommendations generated)`);
      }

      logLines.push(`\n[4] PLAN ADJUSTMENTS (Today's Active Plan Counterfactuals):`);
      if (outcome.planAdjustments && outcome.planAdjustments.length > 0) {
        outcome.planAdjustments.forEach((r, i) => {
          logLines.push(`    #${i + 1} [${r.type}] ${r.label}`);
          logLines.push(`        Raw ΔJ = +${r.objectiveImprovement.toFixed(6)} | Visual Score: ${Math.round(r.normalizedScore * 100)}% (tanh mapped)`);
          if (typeof r.lowerBound === 'number') {
            logLines.push(`        LP Bound (J_LP*): ${r.lowerBound.toFixed(6)} | Integrality Gap: ${(r.integralityGapAbs || 0).toFixed(6)} (${((r.integralityGapRel || 0) * 100).toFixed(2)}%)`);
          }
          logLines.push(`        Macro Deltas: ΔCal=${(r.calorieImprovement || 0).toFixed(1)} kcal, ΔP=${(r.proteinImprovement || 0).toFixed(1)}g, ΔC=${(r.carbImprovement || 0).toFixed(1)}g, ΔF=${(r.fatImprovement || 0).toFixed(1)}g`);
          logLines.push(`        Ingredient Used: ${r.ingredientUsed} | Meals Improved: ${r.mealsImproved}`);
        });
      } else {
        logLines.push(`    (No eligible plan adjustments found for today's solve)`);
      }

      logLines.push(`\n[5] DECISION EXPLANATIONS:`);
      logLines.push(`    WHY DID THE TOP PLAN ADJUSTMENT WIN?`);
      logLines.push(`      ${outcome.auditTrail?.winnerExplanation || 'No winning recommendation.'}`);

      logLines.push(`\n    WHY WERE THE ALTERNATIVES REJECTED / RANKED LOWER?`);
      if (outcome.auditTrail?.rejections && outcome.auditTrail.rejections.length > 0) {
        outcome.auditTrail.rejections.forEach(rej => {
          logLines.push(`      • [${rej.type}] ${rej.label}`);
          logLines.push(`        Stage: ${rej.stage} | Code: ${rej.reasonCode}`);
          logLines.push(`        Details: ${rej.reasonDetails}`);
        });
      } else {
        logLines.push(`      (No alternatives to reject)`);
      }

      UI.recommendationCache = outcome;
      UI.recommendationDebugLog = logLines.join('\n');

      if (statusBadge) statusBadge.textContent = 'Ready';
      UI.renderRecommendationsTab();
    } catch (err) {
      if (statusBadge) statusBadge.textContent = 'ERROR';
      console.error('Recommendation analysis failed:', err);
    } finally {
      UI._analysisRunning = false;
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  },

  renderRecommendationsTab() {
    const container = document.getElementById('recommendation-cards-container');
    const countBadge = document.getElementById('recommend-count-badge');
    const statusBadge = document.getElementById('recommend-status-badge');
    if (!container) return;

    const cache = UI.recommendationCache;
    const currentFp = generateStateFingerprint(state);

    if (!cache) {
      if (countBadge) countBadge.textContent = '0 actions';
      container.innerHTML = `
        <div class="recommend-empty-state">
          <div class="recommend-empty-title">No Analysis Run</div>
          <div class="recommend-empty-desc">Click "ANALYZE OPPORTUNITIES" above to evaluate grocery stocking staples and plan adjustments.</div>
        </div>
      `;
      return;
    }

    const isStale = cache.stateFingerprint !== currentFp;
    if (statusBadge) {
      if (isStale) {
        statusBadge.textContent = 'STALE';
        statusBadge.style.color = '';
      } else {
        statusBadge.textContent = 'Ready';
        statusBadge.style.color = '';
      }
    }

    const planRecs = cache.planAdjustments || cache.recommendations || [];
    const groceryRecs = cache.groceryRecommendations || [];

    if (countBadge) {
      countBadge.textContent = `${groceryRecs.length} grocery • ${planRecs.length} plan`;
    }

    let staleHtml = '';
    if (isStale) {
      staleHtml = `
        <div class="recommend-stale-banner">
          <span>Inputs changed since this analysis. Results may be outdated.</span>
          <button type="button" class="btn btn-sm" id="reanalyze-btn">Re-analyze</button>
        </div>
      `;
    }

    // ── 1. Grocery Recommendations HTML (Monochrome & No Emojis) ──
    let groceryHtml = '';
    if (groceryRecs.length > 0) {
      const groceryCardsHtml = groceryRecs.map((g, idx) => {
        const roleClass = `role-${(g.role || 'balanced_staple').toLowerCase()}`;
        const isUrgent = g.availability !== 'normal';
        const urgencyClass = isUrgent ? '' : 'avail-in_stock';
        const canRestock = isUrgent;

        const reasonsListHtml = (g.reasons || []).map(r => `
          <li class="grocery-reason-item">
            <span class="grocery-reason-bullet">•</span>
            <span>${esc(r)}</span>
          </li>
        `).join('');

        return `
          <div class="recommend-card grocery-card" data-ing-id="${escAttr(g.ingredientId || g.ingredientName)}">
            <div class="recommend-card-header">
              <div class="recommend-badges-wrap">
                <span class="recommend-rank-badge">#${idx + 1}</span>
                <span class="recommend-role-badge ${roleClass}">${esc(g.roleLabel || g.role)}</span>
                <span class="recommend-urgency-badge ${urgencyClass}">${esc(g.urgencyLabel || g.availability)}</span>
              </div>
              <span class="recommend-score-pill" title="Grocery Utility Score">${g.score} / 100</span>
            </div>

            <div class="recommend-card-title">${esc(g.ingredientName)}</div>

            <div class="recommend-transition-row">
              <span>Per serving:</span>
              <span class="recommend-to-val">${Math.round(g.calories || 0)} kcal • P:${(g.protein || 0).toFixed(1)}g • C:${(g.carbs || 0).toFixed(1)}g • F:${(g.fat || 0).toFixed(1)}g (${g.servingSize || 100} ${esc(g.unit || 'g')})</span>
            </div>

            <ul class="grocery-reasons-list">
              ${reasonsListHtml}
            </ul>

            <div class="recommend-card-footer">
              <div class="recommend-summary-hint">
                Density: ${(g.metrics?.macroDensity || 0).toFixed(2)} | Flexibility: ${(g.metrics?.macroFlexibility || 0).toFixed(2)} | Target Fit: ${(g.metrics?.targetCompatibility || 0).toFixed(2)}
              </div>
              ${canRestock ? `
                <button type="button" class="btn btn-sm btn-apply-grocery" data-ing-id="${escAttr(g.ingredientId || '')}" data-ing-name="${escAttr(g.ingredientName)}">
                  RESTOCK
                </button>
              ` : `
                <span class="recommend-metric-val neutral" style="font-size:0.75rem;">IN STOCK</span>
              `}
            </div>
          </div>
        `;
      }).join('');

      groceryHtml = `
        <div class="recommend-section-block">
          <div class="recommend-section-heading-wrap">
            <div class="recommend-section-heading">GROCERY RECOMMENDATIONS</div>
            <div class="recommend-section-desc">High-utility pantry staples to stock up on for future meal plan flexibility and minimal solver error.</div>
          </div>
          <div class="recommendation-cards-container">
            ${groceryCardsHtml}
          </div>
        </div>
      `;
    }

    // ── 2. Plan Adjustments HTML (Explicit Serving Deltas & Monochrome) ──
    let planHtml = '';
    if (planRecs.length > 0) {
      const planCardsHtml = planRecs.map((rec, idx) => {
        const typeClass = `type-${rec.type.toLowerCase()}`;
        const typeLabel = rec.type.replace(/_/g, ' ').toUpperCase();
        const visualScorePct = Math.round((rec.normalizedScore ?? 0) * 100);

        const formatDelta = (val, suffix = '') => {
          if (typeof val !== 'number' || Math.abs(val) < 0.05) return `<span class="recommend-metric-val neutral">0${suffix}</span>`;
          const sign = val > 0 ? '+' : '';
          return `<span class="recommend-metric-val">${sign}${val.toFixed(1)}${suffix}</span>`;
        };

        // Explicit delta servings calculation: Δs = s_recommended - s_current
        const fromNum = typeof rec.from === 'number' ? rec.from : null;
        const toNum = typeof rec.to === 'number' ? rec.to : null;
        let deltaServings = typeof rec.deltaServings === 'number'
          ? rec.deltaServings
          : (toNum !== null && fromNum !== null ? toNum - fromNum : null);

        let actionTitle = esc(rec.label);
        let transitionText = '';

        if (rec.type === 'INCREASE_CAPACITY') {
          const deltaAbs = deltaServings !== null ? Math.abs(deltaServings) : (toNum - fromNum);
          actionTitle = `Increase ${rec.ingredientName} by ${deltaAbs} serving${deltaAbs === 1 ? '' : 's'}`;
          transitionText = `Current: ${fromNum} serv → Recommended: ${toNum} serv (+${deltaAbs} serv)`;
        } else if (rec.type === 'REDUCE_CAPACITY') {
          const deltaAbs = deltaServings !== null ? Math.abs(deltaServings) : (fromNum - toNum);
          actionTitle = `Decrease ${rec.ingredientName} by ${deltaAbs} serving${deltaAbs === 1 ? '' : 's'}`;
          transitionText = `Current: ${fromNum} serv → Recommended: ${toNum} serv (-${deltaAbs} serv)`;
        } else {
          transitionText = `Current: ${rec.from} → Recommended: ${rec.to}`;
        }

        return `
          <div class="recommend-card" data-rec-id="${escAttr(rec.id)}">
            <div class="recommend-card-header">
              <div class="recommend-badges-wrap">
                <span class="recommend-rank-badge">#${idx + 1}</span>
                <span class="recommend-type-badge ${typeClass}">${esc(typeLabel)}</span>
              </div>
              <span class="recommend-score-pill" title="Raw objective improvement: +${rec.objectiveImprovement.toFixed(6)} ΔJ (${visualScorePct}% visual impact score)">${rec.objectiveImprovement >= 0 ? '+' : ''}${rec.objectiveImprovement.toFixed(3)} ΔJ (${visualScorePct}%)</span>
            </div>

            <div class="recommend-card-title">${actionTitle}</div>

            <div class="recommend-transition-row">
              <span class="recommend-to-val">${esc(transitionText)}</span>
            </div>

            <div class="recommend-metrics-grid">
              <div class="recommend-metric-col">
                <span class="recommend-metric-label">Calories</span>
                ${formatDelta(rec.calorieImprovement, ' kcal')}
              </div>
              <div class="recommend-metric-col">
                <span class="recommend-metric-label">Protein</span>
                ${formatDelta(rec.proteinImprovement, 'g')}
              </div>
              <div class="recommend-metric-col">
                <span class="recommend-metric-label">Carbs</span>
                ${formatDelta(rec.carbImprovement, 'g')}
              </div>
              <div class="recommend-metric-col">
                <span class="recommend-metric-label">Fat</span>
                ${formatDelta(rec.fatImprovement, 'g')}
              </div>
            </div>

            <div class="recommend-card-footer">
              <div class="recommend-summary-hint">
                ${rec.mealsImproved > 0 ? `Improves distribution across ${rec.mealsImproved} meal${rec.mealsImproved === 1 ? '' : 's'}` : 'Expands optimization feasible region'}
              </div>
              <button type="button" class="btn btn-sm btn-apply-rec" data-rec-id="${escAttr(rec.id)}">APPLY</button>
            </div>
          </div>
        `;
      }).join('');

      planHtml = `
        <div class="recommend-section-block">
          <div class="recommend-section-heading-wrap">
            <div class="recommend-section-heading">PLAN ADJUSTMENTS (CURRENT PLAN)</div>
            <div class="recommend-section-desc">Tactical parameter changes that directly improve today's active meal plan solution.</div>
          </div>
          <div class="recommendation-cards-container">
            ${planCardsHtml}
          </div>
        </div>
      `;
    } else {
      planHtml = `
        <div class="recommend-section-block">
          <div class="recommend-section-heading-wrap">
            <div class="recommend-section-heading">PLAN ADJUSTMENTS (CURRENT PLAN)</div>
            <div class="recommend-section-desc">Tactical parameter changes that directly improve today's active meal plan solution.</div>
          </div>
          <div class="recommend-optimal-banner">
            <strong>Today's meal plan is optimal (0.0 macro error).</strong> No tactical parameter adjustments are needed for today's solve. Check the grocery stocking list above for forward-looking pantry opportunities.
          </div>
        </div>
      `;
    }

    // Debug log toggle
    let debugHtml = '';
    if (UI.recommendationDebugLog) {
      debugHtml = `
        <div class="recommend-debug-toggle-wrap">
          <button type="button" class="recommend-debug-toggle-btn" id="toggle-debug-log-btn">SHOW CALCULATION DEBUG LOG</button>
          <pre class="recommend-debug-log hidden" id="recommend-debug-log">${esc(UI.recommendationDebugLog)}</pre>
        </div>
      `;
    }

    container.innerHTML = `${staleHtml}${groceryHtml}${planHtml}${debugHtml}`;
    UI._bindRecommendListeners(cache);
  },

  _bindRecommendListeners(cache) {
    const reanalyzeBtn = document.getElementById('reanalyze-btn');
    reanalyzeBtn?.addEventListener('click', () => UI.runRecommendationAnalysis());

    const debugToggle = document.getElementById('toggle-debug-log-btn');
    const debugLog = document.getElementById('recommend-debug-log');
    if (debugToggle && debugLog) {
      debugToggle.addEventListener('click', () => {
        const isHidden = debugLog.classList.toggle('hidden');
        debugToggle.textContent = isHidden ? 'SHOW CALCULATION DEBUG LOG' : 'HIDE CALCULATION DEBUG LOG';
      });
    }

    // Bind Plan Adjustment Apply Buttons
    document.querySelectorAll('.btn-apply-rec').forEach(btn => {
      btn.addEventListener('click', function () {
        const recId = this.dataset.recId;
        const planRecs = cache.planAdjustments || cache.recommendations || [];
        const rec = planRecs.find(r => r.id === recId);
        if (!rec) return;

        const applyOutcome = applyRecommendation(state, rec);
        if (!applyOutcome.success) {
          if (applyOutcome.error === 'STALE_FINGERPRINT') {
            UI.showErrors(['Recommendation is stale. Re-analyzing...']);
            UI.runRecommendationAnalysis();
          } else {
            UI.showErrors([applyOutcome.message || 'Failed to apply recommendation.']);
          }
          return;
        }

        // Applied successfully
        UI.renderIngredients();
        UI.renderMeals();
        UI.renderTargets();
        UI.renderResults({ scroll: false });
        UI.clearErrors();

        // Re-analyze on new state
        UI.runRecommendationAnalysis();
      });
    });

    // Bind Grocery Restock Buttons
    document.querySelectorAll('.btn-apply-grocery').forEach(btn => {
      btn.addEventListener('click', function () {
        const ingId = this.dataset.ingId;
        const ingName = this.dataset.ingName;
        const groceryRecs = cache.groceryRecommendations || [];
        const item = groceryRecs.find(g => (ingId && g.ingredientId === ingId) || g.ingredientName === ingName);

        const recPayload = {
          type: 'GROCERY_RESTOCK',
          ingredientId: ingId || item?.ingredientId,
          ingredientName: ingName || item?.ingredientName,
          to: 'normal',
          stateFingerprint: cache.stateFingerprint,
          candidateData: item ? { ...item, availability: 'normal' } : null,
          isPoolItem: item?.isPoolItem
        };

        const applyOutcome = applyRecommendation(state, recPayload);
        if (!applyOutcome.success) {
          if (applyOutcome.error === 'STALE_FINGERPRINT') {
            UI.showErrors(['Recommendation is stale. Re-analyzing...']);
            UI.runRecommendationAnalysis();
          } else {
            UI.showErrors([applyOutcome.message || 'Failed to restock ingredient.']);
          }
          return;
        }

        // Applied successfully
        UI.renderIngredients();
        UI.renderMeals();
        UI.renderTargets();
        UI.renderResults({ scroll: false });
        UI.clearErrors();

        // Re-analyze on new state
        UI.runRecommendationAnalysis();
      });
    });
  }
};
