// records/index.js — the list of records the Records panel offers. Each one is a function (state) -> { intro, tables }.
// To add a record: write the function, then add one line here.

import { returnSummary, taxComputation, areaSummaries, documentIndex, payments } from './summary.js';
import { depreciation, fedCaAmt, salesDetail } from './assets.js';
import { booksToTax, rentals, k1Lines, retirementForeign, deductionsCredits } from './income.js';
import { stateSplit, carryovers, basisByYear, priorPreparer } from './history.js';

import { completeness, decisionsLog } from './judgment.js';
import { versionCompare, changedSinceLast } from './change.js';
import { crossCheckList } from './crosschecks.js';
import { reconciliations, incomeSplit } from './reconcile.js';

export const RECORDS = [
  { id: 'summary', group: 'Return', title: 'Return summary against last year', build: returnSummary },
  { id: 'crosschecks', group: 'Return', title: 'Cross-checks against agencies and documents', build: crossCheckList },
  { id: 'reconcile', group: 'Return', title: 'Figures that should agree', build: reconciliations },
  { id: 'incomesplit', group: 'Return', title: 'Income split between states', build: incomeSplit },
  { id: 'computation', group: 'Return', title: 'Tax computation', build: taxComputation },
  { id: 'areas', group: 'Return', title: 'Area summaries', build: areaSummaries },
  { id: 'documents', group: 'Return', title: 'Document index', build: documentIndex },
  { id: 'payments', group: 'Return', title: 'Payments against agency records', build: payments },
  { id: 'depreciation', group: 'Assets and sales', title: 'Depreciation by asset', build: depreciation },
  { id: 'fedcaamt', group: 'Assets and sales', title: 'Federal, California and AMT depreciation', build: fedCaAmt },
  { id: 'sales', group: 'Assets and sales', title: 'Sales detail', build: salesDetail },
  { id: 'books', group: 'Income and deductions', title: 'Books to tax', build: booksToTax },
  { id: 'rentals', group: 'Income and deductions', title: 'Rentals and passive losses', build: rentals },
  { id: 'k1', group: 'Income and deductions', title: 'K-1 lines', build: k1Lines },
  { id: 'retirement', group: 'Income and deductions', title: 'Retirement and foreign items', build: retirementForeign },
  { id: 'deductions', group: 'Income and deductions', title: 'Deductions and credits with limits', build: deductionsCredits },
  { id: 'states', group: 'History', title: 'State split', build: stateSplit },
  { id: 'carryovers', group: 'History', title: 'Carryovers', build: carryovers },
  { id: 'basis', group: 'History', title: 'Basis by year', build: basisByYear },
  { id: 'prior', group: 'History', title: 'Prior preparer against what we changed', build: priorPreparer },
  { id: 'completeness', group: 'Judgment', title: 'Completeness: what might be missing', build: completeness },
  { id: 'decisions', group: 'Judgment', title: 'Judgments and their authority', build: decisionsLog },
  { id: 'changed', group: 'Change', title: 'Changed since the last version', build: changedSinceLast },
  { id: 'compare', group: 'Change', title: 'Compare versions', build: versionCompare },
];

export const recordById = (id) => RECORDS.find((r) => r.id === id) ?? null;
