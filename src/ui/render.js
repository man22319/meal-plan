// ══════════════════════════════════════════
// UI RENDERING & DOM UTILITIES
// ══════════════════════════════════════════

import { resolveAvailability, state, generateId } from '../core/state.js';
import { Persistence } from '../io/persistence.js';
import { Optimization } from '../core/solver.js';
import { bindPressAndHold } from './pressHold.js';
import {
  getLocalDateString,
  calculateCurrentWeight,
  calculateMovingAverage,
  calculateWeightTrend,
  getCombinedHistoryRows
} from '../core/stats.js';
import {
  createIntakeSnapshot,
  recordWeightEntry,
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
  },

  addIngredient() {
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
      if (nameInput) nameInput.focus();
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
      const snapshotBtnText = isSnapshotted ? 'UPDATE INTAKE SNAPSHOT' : 'SNAPSHOT DAY INTAKE';
      const snapshotBadge = isSnapshotted ? `<span class="snapshot-status-badge">Logged: ${Math.round(existingSnapshot.totals.calories)} kcal</span>` : '';

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
          if (snapshot) {
            recordIntakeSnapshot(state.intakeHistory, snapshot);
            Persistence.save();
            UI.renderResults({ scroll: false });
            UI.renderWeightTab();
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

    section.classList.add('visible');
    if (scroll) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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

  hideResults() {
    const section = document.getElementById('results-section');
    if (section) section.classList.remove('visible');
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
  }
};
