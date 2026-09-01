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
  getCombinedHistoryRows
} from '../core/stats.js';
import {
  createIntakeSnapshot,
  recordIntakeSnapshot
} from '../core/history.js';



const EPSILON = 0.001;

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

    // Meal cards
    const cardsEl = document.getElementById('meal-result-cards');
    if (cardsEl) {
      cardsEl.innerHTML = r.mealResults.map((meal, mealIdx) => {
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
              ${itemsHTML}
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

      cardsEl.querySelectorAll('.result-ingredient-row').forEach(row => {
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

    // Consolidated Daily Summary + Deviation
    const macroLabels = [
      { key: 'calories', label: 'Calories', unit: 'kcal', round: true },
      { key: 'protein', label: 'Protein', unit: 'g', round: false },
      { key: 'carbs', label: 'Carbs', unit: 'g', round: false },
      { key: 'fat', label: 'Fat', unit: 'g', round: false }
    ];

    const summaryRows = macroLabels.map(m => {
      const actual = m.round ? Math.round(r.totals[m.key]) : r.totals[m.key].toFixed(1);
      const target = state.targets[m.key];
      const dev = r.deviations[m.key];
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
      const snapshotKcal = existingSnapshot ? Math.round(existingSnapshot.totals.calories) : null;
      const snapshotBadge = isSnapshotted
        ? `<span class="snapshot-status-badge">Eaten: ${snapshotItemCount !== null ? `${snapshotItemCount} item${snapshotItemCount !== 1 ? 's' : ''} · ` : ''}${snapshotKcal} kcal</span>`
        : '';

      dailySummaryEl.innerHTML = `
        <div class="summary-card">
          <div class="summary-header-row">
            <div class="summary-title">Daily Summary</div>
            ${snapshotBadge}
          </div>
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

          // No solver result at all
          if (!snapshot) {
            UI._showSnapshotHint(snapshotBtn, 'No solver result — press SOLVE first.', 'error');
            return;
          }

          // No EATEN items — nothing to record
          if (snapshot.eatenItemCount === 0) {
            UI._showSnapshotHint(snapshotBtn, 'Mark items as EATEN first (hold an ingredient row).', 'warn');
            return;
          }

          const res = recordIntakeSnapshot(state.intakeHistory, snapshot);
          if (!res.error) {
            state.intakeHistory = res.intakeHistory;
            Persistence.save();
            UI.renderResults({ scroll: false });
            UI.renderWeightTab();
            UI._showSnapshotToast(
              `Logged ${snapshot.eatenItemCount} item${snapshot.eatenItemCount !== 1 ? 's' : ''} · ${Math.round(snapshot.totals.calories)} kcal`
            );
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
          const calStr = r.hasIntake ? `${Math.round(r.calories)}` : '<span class="dim-dash">—</span>';
          const proStr = r.hasIntake ? `${r.protein.toFixed(1)}g` : '<span class="dim-dash">—</span>';
          const carbStr = r.hasIntake ? `${r.carbs.toFixed(1)}g` : '<span class="dim-dash">—</span>';
          const fatStr = r.hasIntake ? `${r.fat.toFixed(1)}g` : '<span class="dim-dash">—</span>';

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

  /** Fixed-position toast that slides up, stays 3 s, then fades out. */
  _showSnapshotToast(message) {
    // Remove any existing toast first
    const old = document.getElementById('snapshot-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'snapshot-toast';
    toast.className = 'snapshot-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `<span class="snapshot-toast-icon">✓</span> ${esc(message)}`;
    document.body.appendChild(toast);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => toast.classList.add('snapshot-toast--visible'));

    const DISPLAY_MS = 2800;
    const FADE_MS = 350;
    setTimeout(() => {
      toast.classList.remove('snapshot-toast--visible');
      setTimeout(() => toast.remove(), FADE_MS);
    }, DISPLAY_MS);
  },

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
      logLines.push(`    Eligible Recommendations: ${outcome.auditTrail?.eligibleRecommendations ?? outcome.recommendations.length}`);
      logLines.push(`    Cascade Execution Time: ${elapsed} ms`);

      logLines.push(`\n[3] RANKED RECOMMENDATIONS:`);
      if (outcome.recommendations.length > 0) {
        outcome.recommendations.forEach((r, i) => {
          logLines.push(`    #${i + 1} [${r.type}] ${r.label}`);
          logLines.push(`        Raw ΔJ = +${r.objectiveImprovement.toFixed(6)} | Visual Score: ${Math.round(r.normalizedScore * 100)}% (tanh mapped)`);
          if (typeof r.lowerBound === 'number') {
            logLines.push(`        LP Bound (J_LP*): ${r.lowerBound.toFixed(6)} | Integrality Gap: ${(r.integralityGapAbs || 0).toFixed(6)} (${((r.integralityGapRel || 0) * 100).toFixed(2)}%)`);
          }
          if (r.stage1?.geometricScore) {
            logLines.push(`        Stage 1 Geometry: DirMag=${r.stage1.directionalMagnitude.toFixed(4)}, Alignment=${r.stage1.cosineAlignment.toFixed(4)}, Score=${r.stage1.geometricScore.toFixed(4)}`);
          }
          logLines.push(`        Macro Deltas: ΔCal=${(r.calorieImprovement || 0).toFixed(1)} kcal, ΔP=${(r.proteinImprovement || 0).toFixed(1)}g, ΔC=${(r.carbImprovement || 0).toFixed(1)}g, ΔF=${(r.fatImprovement || 0).toFixed(1)}g`);
          logLines.push(`        Ingredient Used: ${r.ingredientUsed} | Meals Improved: ${r.mealsImproved}`);
        });
      } else {
        logLines.push(`    (No eligible recommendations found)`);
      }

      logLines.push(`\n[4] DECISION EXPLANATIONS:`);
      logLines.push(`    ★ WHY DID THE TOP RECOMMENDATION WIN?`);
      logLines.push(`      ${outcome.auditTrail?.winnerExplanation || 'No winning recommendation.'}`);

      logLines.push(`\n    ✗ WHY WERE THE ALTERNATIVES REJECTED / RANKED LOWER?`);
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
          <div class="recommend-empty-desc">Click "ANALYZE OPPORTUNITIES" above to simulate counterfactual food changes.</div>
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

    const recs = cache.recommendations || [];
    if (countBadge) {
      countBadge.textContent = `${recs.length} action${recs.length === 1 ? '' : 's'}`;
    }

    let staleHtml = '';
    if (isStale) {
      staleHtml = `
        <div class="recommend-stale-banner">
          <span>⚠ Inputs changed since this analysis. Results may be outdated.</span>
          <button type="button" class="btn btn-sm" id="reanalyze-btn">Re-analyze</button>
        </div>
      `;
    }

    // Debug log toggle (always available if we have a log)
    let debugHtml = '';
    if (UI.recommendationDebugLog) {
      debugHtml = `
        <div class="recommend-debug-toggle-wrap">
          <button type="button" class="recommend-debug-toggle-btn" id="toggle-debug-log-btn">SHOW CALCULATION DEBUG LOG</button>
          <pre class="recommend-debug-log hidden" id="recommend-debug-log">${esc(UI.recommendationDebugLog)}</pre>
        </div>
      `;
    }

    if (recs.length === 0) {
      container.innerHTML = `
        ${staleHtml}
        <div class="recommend-empty-state">
          <div class="recommend-empty-title">Optimal Macro Landscape</div>
          <div class="recommend-empty-desc">
            No single ingredient change provides a meaningful improvement to your current solution.
          </div>
        </div>
        ${debugHtml}
      `;
      UI._bindRecommendListeners(cache);
      return;
    }

    const cardsHtml = recs.map((rec, idx) => {
      const typeClass = `type-${rec.type.toLowerCase()}`;
      const typeLabel = rec.type.replace(/_/g, ' ').toUpperCase();
      const visualScorePct = Math.round((rec.normalizedScore ?? 0) * 100);

      const formatDelta = (val, suffix = '') => {
        if (typeof val !== 'number' || Math.abs(val) < 0.05) return `<span class="recommend-metric-val neutral">0${suffix}</span>`;
        const sign = val > 0 ? '+' : '';
        return `<span class="recommend-metric-val">${sign}${val.toFixed(1)}${suffix}</span>`;
      };

      let fromDisplay = rec.from !== null ? String(rec.from) : '—';
      let toDisplay = rec.to !== null ? String(rec.to) : '—';
      if (rec.type === 'INCREASE_CAPACITY' || rec.type === 'REDUCE_CAPACITY') {
        fromDisplay = `${rec.from} serv`;
        toDisplay = `${rec.to} serv`;
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

          <div class="recommend-card-title">${esc(rec.ingredientName || rec.label)}</div>

          <div class="recommend-transition-row">
            <span>Transition:</span>
            <span class="recommend-from-val">${esc(fromDisplay)}</span>
            <span class="recommend-arrow">→</span>
            <span class="recommend-to-val">${esc(toDisplay)}</span>
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

    container.innerHTML = `${staleHtml}${cardsHtml}${debugHtml}`;
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

    document.querySelectorAll('.btn-apply-rec').forEach(btn => {
      btn.addEventListener('click', function () {
        const recId = this.dataset.recId;
        const rec = (cache.recommendations || []).find(r => r.id === recId);
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
  }
};
