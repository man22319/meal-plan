// ══════════════════════════════════════════
// UI RENDERING & DOM UTILITIES
// ══════════════════════════════════════════

import { state } from '../core/state.js';
import { Persistence } from '../io/persistence.js';

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
        <label for="target-${f.key}">${f.label}</label>
        <input type="number" id="target-${f.key}"
               value="${state.targets[f.key]}"
               min="0" step="1" inputmode="numeric" />
        <span class="unit-hint">${f.unit}</span>
      </div>
    `).join('');

    fields.forEach(f => {
      const input = document.getElementById(`target-${f.key}`);
      if (input) {
        input.addEventListener('input', function () {
          const val = parseFloat(this.value);
          state.targets[f.key] = isNaN(val) ? 0 : val;
        });
      }
    });
  },

  // ── MEALS ──
  renderMeals() {
    const countInput = document.getElementById('meal-count');
    if (countInput) {
      countInput.value = state.meals.length;
    }
    UI.renderMealRows();
  },

  renderMealRows() {
    const container = document.getElementById('meal-rows');
    if (!container) return;

    container.innerHTML = state.meals.map((m, i) => `
      <div class="meal-row">
        <input type="text" value="${escAttr(m.name)}" data-idx="${i}" data-f="name"
               placeholder="Meal name" />
        <div class="meal-pct-wrap">
          <input type="number" value="${m.pct}" min="0" max="100" step="1"
                 data-idx="${i}" data-f="pct" inputmode="numeric" />
          <span class="pct-suffix">%</span>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', function () {
        const idx = parseInt(this.dataset.idx, 10);
        if (this.dataset.f === 'name') {
          state.meals[idx].name = this.value;
        } else {
          const val = parseFloat(this.value);
          state.meals[idx].pct = isNaN(val) ? 0 : val;
        }
        UI.updateMealTotal();
      });
    });

    UI.updateMealTotal();
  },

  updateMealTotal() {
    const total = state.meals.reduce((sum, m) => sum + (m.pct || 0), 0);
    const el = document.getElementById('meal-total-value');
    if (!el) return;
    el.textContent = `${total.toFixed(1)}%`;
    el.className = 'meal-total-value ' + (Math.abs(total - 100) < 0.01 ? 'valid' : 'invalid');
  },

  // ── INGREDIENTS ──
  renderIngredients() {
    const tbody = document.getElementById('ingredient-tbody');
    if (!tbody) return;

    tbody.innerHTML = state.ingredients.map((ing, i) => `
      <tr>
        <td><input type="text" value="${escAttr(ing.name)}" data-i="${i}" data-f="name" placeholder="Name" /></td>
        <td><input type="number" value="${ing.servingSize}" min="0" step="1"
                   data-i="${i}" data-f="servingSize" inputmode="decimal" /></td>
        <td><input type="text" class="unit-input" value="${escAttr(ing.unit)}"
                   data-i="${i}" data-f="unit" placeholder="g" /></td>
        <td><input type="number" value="${ing.calories}" min="0" step="1"
                   data-i="${i}" data-f="calories" inputmode="decimal" /></td>
        <td><input type="number" value="${ing.protein}" min="0" step="0.1"
                   data-i="${i}" data-f="protein" inputmode="decimal" /></td>
        <td><input type="number" value="${ing.carbs}" min="0" step="0.1"
                   data-i="${i}" data-f="carbs" inputmode="decimal" /></td>
        <td><input type="number" value="${ing.fat}" min="0" step="0.1"
                   data-i="${i}" data-f="fat" inputmode="decimal" /></td>
        <td><input type="number" value="${typeof ing.minServings === 'number' ? ing.minServings : 0}" min="0" step="0.5"
                   data-i="${i}" data-f="minServings" placeholder="0" inputmode="decimal" /></td>
        <td><input type="number" value="${typeof ing.maxServings === 'number' ? ing.maxServings : 5}" min="0.1" step="0.5"
                   data-i="${i}" data-f="maxServings" placeholder="5" inputmode="decimal" /></td>
        <td class="del-cell">
          <button class="del-btn" data-del="${i}" title="Delete">&times;</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('input').forEach(input => {
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

    tbody.querySelectorAll('.del-btn').forEach(btn => {
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
      minServings: 0, maxServings: 5
    });
    Persistence.save();
    UI.renderIngredients();
    const rows = document.getElementById('ingredient-tbody')?.querySelectorAll('tr');
    if (rows && rows.length > 0) {
      const last = rows[rows.length - 1];
      const nameInput = last.querySelector('input[data-f="name"]');
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
              <span class="result-meal-pct">${meal.pct}% (${Math.round(meal.targetCalories)} kcal target)</span>
            </div>
            ${itemsHTML}
            <div class="result-meal-macros">
              <span class="result-macro-item">
                <span class="val">${Math.round(meal.calories)}</span>
                <span class="lbl">kcal</span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="val">${meal.protein.toFixed(1)}</span>
                <span class="lbl">protein</span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="val">${meal.carbs.toFixed(1)}</span>
                <span class="lbl">carbs</span>
              </span>
              <span class="result-macro-divider"></span>
              <span class="result-macro-item">
                <span class="val">${meal.fat.toFixed(1)}</span>
                <span class="lbl">fat</span>
              </span>
            </div>
          </div>
        `;
      }).join('');
    }

    // Daily summary
    const macroLabels = [
      { key: 'calories', label: 'Calories', unit: 'kcal', round: true },
      { key: 'protein', label: 'Protein', unit: 'g', round: false },
      { key: 'carbs', label: 'Carbs', unit: 'g', round: false },
      { key: 'fat', label: 'Fat', unit: 'g', round: false }
    ];

    const totalRows = macroLabels.map(m => {
      const actual = m.round ? Math.round(r.totals[m.key]) : r.totals[m.key].toFixed(1);
      return `
        <div class="summary-row">
          <span class="summary-label">${m.label}</span>
          <span class="summary-value">${actual} <span class="target">/ ${state.targets[m.key]} ${m.unit}</span></span>
        </div>
      `;
    }).join('');

    const devRows = macroLabels.map(m => {
      const dev = r.deviations[m.key];
      const absVal = m.round ? Math.round(dev.absolute) : dev.absolute.toFixed(1);
      const sign = dev.absolute >= 0 ? '+' : '';
      const pct = dev.percentage.toFixed(1);
      const cls = Math.abs(dev.absolute) < 0.05 ? 'deviation-zero'
        : dev.absolute > 0 ? 'deviation-pos' : 'deviation-neg';
      return `
        <div class="summary-row">
          <span class="summary-label">${m.label}</span>
          <span class="summary-value ${cls}">${sign}${absVal} ${m.unit} <span class="target">(${sign}${pct}%)</span></span>
        </div>
      `;
    }).join('');

    const dailySummaryEl = document.getElementById('daily-summary');
    if (dailySummaryEl) {
      dailySummaryEl.innerHTML = `
        <div class="summary-card">
          <div class="summary-title">Daily Total</div>
          ${totalRows}
        </div>
        <div class="summary-card">
          <div class="summary-title">Deviation</div>
          ${devRows}
        </div>
      `;
    }

    // Meal allocation table
    const allocRows = r.mealResults.map(meal => {
      const tgt = Math.round(meal.targetCalories);
      const act = Math.round(meal.calories);
      const dev = Math.round(meal.calDeviation);
      const sign = dev >= 0 ? '+' : '';
      const cls = Math.abs(dev) < 1 ? 'deviation-zero'
        : dev > 0 ? 'deviation-pos' : 'deviation-neg';
      return `
        <tr>
          <td class="meal-name-col">${esc(meal.name)}</td>
          <td class="num-col">${tgt}</td>
          <td class="num-col">${act}</td>
          <td class="num-col ${cls}">${sign}${dev}</td>
        </tr>
      `;
    }).join('');

    const mealAllocEl = document.getElementById('meal-allocation');
    if (mealAllocEl) {
      mealAllocEl.innerHTML = `
        <div class="summary-card">
          <div class="summary-title">Meal Allocation</div>
          <table class="alloc-table">
            <thead>
              <tr>
                <th>Meal</th>
                <th class="num-col">Target</th>
                <th class="num-col">Actual</th>
                <th class="num-col">Dev</th>
              </tr>
            </thead>
            <tbody>${allocRows}</tbody>
          </table>
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
