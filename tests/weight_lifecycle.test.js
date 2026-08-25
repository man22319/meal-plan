// ══════════════════════════════════════════
// WEIGHT LIFECYCLE & PERSISTENCE TESTS
// ══════════════════════════════════════════

import { state } from '../src/core/state.js';
import { Persistence } from '../src/io/persistence.js';
import { recordWeightEntry } from '../src/core/history.js';

// Setup mock localStorage
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); }
};

let failed = 0;
function assert(name, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name} ${details ? `— ${details}` : ''}`);
    failed++;
  }
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log(' RUNNING WEIGHT LIFECYCLE & CANONICAL INVARIANTS TEST SUITE         ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ── TEST 1: Exactly One Record Per Date (Insert vs Update) ──
{
  Persistence.resetToDefaults();
  const date = '2026-08-25';

  // First record
  const res1 = recordWeightEntry(state.weightHistory, 185.0, date, '2026-08-25T07:00:00Z');
  state.weightHistory = res1.weightHistory;
  assert('Weight recorded for date', state.weightHistory[date]?.weight === 185.0);
  assert('Exactly one date key exists', Object.keys(state.weightHistory).length === 1);

  // Update on the same date (e.g. user re-weighed or corrected typo)
  const res2 = recordWeightEntry(state.weightHistory, 184.3, date, '2026-08-25T07:15:00Z');
  state.weightHistory = res2.weightHistory;
  assert('Weight updated to new value', state.weightHistory[date]?.weight === 184.3);
  assert('Still exactly one date key exists (no duplicates)', Object.keys(state.weightHistory).length === 1);
  assert('Timestamp updated', state.weightHistory[date]?.recordedAt === '2026-08-25T07:15:00Z');
}

// ── TEST 2: Multiple Dates Independence ──
{
  const res3 = recordWeightEntry(state.weightHistory, 185.2, '2026-08-26', '2026-08-26T07:00:00Z');
  state.weightHistory = res3.weightHistory;

  assert('Two distinct dates recorded', Object.keys(state.weightHistory).length === 2);
  assert('First date preserved intact', state.weightHistory['2026-08-25']?.weight === 184.3);
  assert('Second date recorded correctly', state.weightHistory['2026-08-26']?.weight === 185.2);
}

// ── TEST 3: Persistence and Restoration ──
{
  Persistence.save();
  assert('Weights stored in localStorage', !!store['macroSolver_weights']);

  // Reset in-memory state and reload from storage
  state.weightHistory = {};
  Persistence.load();

  assert('Weights successfully restored from storage', Object.keys(state.weightHistory).length === 2);
  assert('Restored weight for 2026-08-25', state.weightHistory['2026-08-25']?.weight === 184.3);
  assert('Restored weight for 2026-08-26', state.weightHistory['2026-08-26']?.weight === 185.2);
}

// ── TEST 4: Invalid Input Rejection ──
{
  const bad1 = recordWeightEntry(state.weightHistory, -50, '2026-08-27');
  assert('Negative weight rejected', !!bad1.error);

  const bad2 = recordWeightEntry(state.weightHistory, 'invalid', '2026-08-27');
  assert('Non-numeric weight rejected', !!bad2.error);

  assert('No corrupt entries added', !state.weightHistory['2026-08-27']);
}

console.log(`\nWeight Lifecycle Tests Completed: ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}\n`);
if (failed > 0) process.exit(1);
