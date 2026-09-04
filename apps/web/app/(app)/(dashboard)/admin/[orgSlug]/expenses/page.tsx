'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Trash2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, Expense, ExpenseSummary } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * What the co-op spent (IMP-16).
 *
 * Four fields, and the restraint is the design: D-021 makes bookkeeping an
 * explicit non-goal, so there is no vendor, no invoice number, no payment
 * status and no reconciliation here. A co-op's books stay in its accounting
 * software; this exists so that "what did that outcome cost" and "how much of
 * our spend served our goals" have a denominator.
 *
 * Organiser-only, with no member-facing counterpart anywhere: members see
 * aggregate impact, not the co-op's spending.
 */
export default function AdminExpensesPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgId = currentOrgId ?? user?.orgs?.[0]?.orgId;

  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState('');
  const [category, setCategory] = useState('');
  const [goalKey, setGoalKey] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const [rows, sum] = await Promise.all([
        api.impact.listExpenses(orgId, token),
        api.impact.expenseSummary(orgId, token),
      ]);
      setExpenses(rows);
      setSummary(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load expenses');
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!token || !orgId) return;
    setError('');

    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      return setError('Give it an amount.');
    }
    if (!incurredOn) return setError('Say when it was spent.');
    if (!category.trim()) return setError('Give it a category.');

    setBusy(true);
    try {
      await api.impact.createExpense(
        orgId,
        {
          amountCents: cents,
          incurredOn: new Date(incurredOn).toISOString(),
          category: category.trim(),
          ...(goalKey.trim() ? { goalKey: goalKey.trim() } : {}),
        },
        token,
      );
      setAmount('');
      setIncurredOn('');
      setCategory('');
      setGoalKey('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!token || !orgId) return;
    setError('');
    try {
      await api.impact.deleteExpense(orgId, id, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that');
    }
  }

  return (
    <div className="space-y-6">
      {/* The icon is gone with the hand-written heading: page titles are the
          display serif and nothing else, or "sometimes with an icon" becomes
          the next inconsistency (UI-02). */}
      <PageHeader
        title="Spending"
        description="Enough to answer what your work costs and how much of your spending serves your goals. Not an accounting system — your books stay where they are."
      />

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      )}

      {summary && summary.expenseCount > 0 && (
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Recorded</p>
            <p className="mt-1 text-lg font-semibold">{money(summary.totalCents)}</p>
            <p className="text-xs text-gray-400">across {summary.expenseCount} entries</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Serving a goal</p>
            <p className="mt-1 text-lg font-semibold">
              {summary.attributedShare === null
                ? '—'
                : `${Math.round(summary.attributedShare * 100)}%`}
            </p>
            <p className="text-xs text-gray-400">of what you have recorded</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Biggest category</p>
            <p className="mt-1 text-lg font-semibold">
              {summary.byCategory[0]?.category ?? '—'}
            </p>
            <p className="text-xs text-gray-400">
              {summary.byCategory[0] ? money(summary.byCategory[0].totalCents) : ''}
            </p>
          </div>
        </section>
      )}

      <form onSubmit={add} className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-900">Amount</span>
            <input
              id="expense-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="input mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-900">Date</span>
            <input
              id="expense-date"
              type="date"
              value={incurredOn}
              onChange={(e) => setIncurredOn(e.target.value)}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-900">Category</span>
            <input
              id="expense-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Programs"
              className="input mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-900">
              Goal <span className="font-normal text-gray-400">(optional)</span>
            </span>
            <input
              id="expense-goal"
              value={goalKey}
              onChange={(e) => setGoalKey(e.target.value)}
              placeholder="belonging"
              className="input mt-1 w-full"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Leave the goal blank when spending does not serve one. Unattributed spending
          is counted, not hidden — otherwise the percentage above would always be 100%.
        </p>
        <div className="mt-3 flex justify-end">
          <button type="submit" className="btn-primary text-sm" disabled={busy}>
            {busy ? 'Recording...' : 'Record'}
          </button>
        </div>
      </form>

      <section className="rounded-xl border border-gray-200 bg-white">
        {expenses === null ? (
          <p className="p-6 text-center text-sm text-gray-400">Loading...</p>
        ) : expenses.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {expenses.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {money(x.amountCents)}
                    <span className="ml-2 font-normal text-gray-500">{x.category}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(x.incurredOn).toLocaleDateString()}
                    {x.goalKey ? ` · serves ${x.goalKey}` : ' · no goal'}
                  </p>
                </div>
                <button
                  onClick={() => remove(x.id)}
                  aria-label="Delete"
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
