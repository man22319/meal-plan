// ══════════════════════════════════════════
// UI RENDERING & DOM UTILITIES
// ══════════════════════════════════════════

import { state } from '../core/state.js';
import { Persistence } from '../io/persistence.js';

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
      return `
      <div class="ingredient-card" data-i="${i}">
        <div class="ing-row ing-name-row">
          <input type="text" class="ing-name-input" value="${escAttr(ing.name)}" data-i="${i}" data-f="name" placeholder="Ingredient name" />
          <button type="button" class="del-btn" data-del="${i}" aria-label="Delete ingredient" title="Delete">×</button>
        </div>

        <div class="ing-grid ing-serving-grid">
          <div class="ing-field">
            <label for="ing-${i}-serv">Serving size</label>
            <input type="number" id="ing-${i}-serv" value="${ing.servingSize}" min="0" step="1"
                   data-i="${i}" data-f="servingSize" inputmode="decimal" />
          </div>
          <div class="ing-field">
            <label for="ing-${i}-unit">Unit</label>
            <input type="text" id="ing-${i}-unit" class="unit-input" value="${escAttr(ing.unit)}"
                   data-i="${i}" data-f="unit" placeholder="g" />
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
            <input type="number" aria-label="Calories" value="${ing.calories}" min="0" step="1"
                   data-i="${i}" data-f="calories" inputmode="decimal" />
            <input type="number" aria-label="Protein" value="${ing.protein}" min="0" step="0.1"
                   data-i="${i}" data-f="protein" inputmode="decimal" />
            <input type="number" aria-label="Carbs" value="${ing.carbs}" min="0" step="0.1"
                   data-i="${i}" data-f="carbs" inputmode="decimal" />
            <input type="number" aria-label="Fat" value="${ing.fat}" min="0" step="0.1"
                   data-i="${i}" data-f="fat" inputmode="decimal" />
          </div>
        </div>

        <div class="ing-grid ing-bounds-grid">
          <div class="ing-field">
            <label for="ing-${i}-min">Min servings</label>
            <input type="number" id="ing-${i}-min" value="${typeof ing.minServings === 'number' ? ing.minServings : 0}" min="0" step="0.5"
                   data-i="${i}" data-f="minServings" placeholder="0" inputmode="decimal" />
          </div>
          <div class="ing-field">
            <label for="ing-${i}-max">Max servings</label>
            <input type="number" id="ing-${i}-max" value="${typeof ing.maxServings === 'number' ? ing.maxServings : 5}" min="0.1" step="0.5"
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
      </div>
    `;
    }).join('');

    container.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', function () {
        const idx = parseInt(this.dataset.i, 10);
        const field = this.dataset.f;
        if (field === 'name' || field === 'unit') {
          state.ingredients[idx][field] = this.value;
        } else {
          const val = parseFloat(this.value);
          state.ingredients[idx][field] = isNaN(val) ? 0 : val;
        }
        Persistence.save();
      });
    });

    container.querySelectorAll('.segmented-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.i, 10);
        const mode = this.dataset.mode;
        state.ingredients[idx].quantityMode = mode;
        Persistence.save();
        UI.renderIngredients();
      });
    });

    container.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        state.ingredients.splice(parseInt(this.dataset.del, 10), 1);
        Persistence.save();
        UI.renderIngredients();
      });
    });
  },

  addIngredient() {
    state.ingredients.push({
      name: '', servingSize: 100, unit: 'g',
      calories: 0, protein: 0, carbs: 0, fat: 0,
      minServings: 0, maxServings: 5,
      quantityMode: 'continuous'
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

  // ── RESULTS ──
  renderResults() {
    const r = state.result;
    if (!r) { UI.hideResults(); return; }

    const section = document.getElementById('results-section');
    if (!section) return;

    // Meal cards
    const cardsEl = document.getElementById('meal-result-cards');
    if (cardsEl) {
      cardsEl.innerHTML = r.mealResults.map(meal => {
        const itemsHTML = meal.items.length > 0
          ? meal.items.map(item => `
              <div class="result-ingredient-row">
                <span class="result-ingredient-name">${esc(item.name)}</span>
                <span class="result-ingredient-qty">${Math.round(item.quantity)} ${esc(item.unit)} <span class="result-servings">(${item.servings.toFixed(2)} serv)</span></span>
              </div>
            `).join('')
          : '<div class="result-no-items">No ingredients assigned</div>';

        return `
          <div class="result-card">
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
      dailySummaryEl.innerHTML = `
        <div class="summary-card">
          <div class="summary-title">Daily Summary</div>
          <div class="consolidated-summary-list">
            ${summaryRows}
          </div>
        </div>
      `;
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
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
