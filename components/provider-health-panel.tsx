"use client";

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { healthStateLabel, type ProviderHealthSnapshot } from '@/lib/provider-health';

function tone(state: 'up' | 'degraded' | 'down') {
  if (state === 'up') return 'border-[#305f45] bg-[#12261b] text-[#d7f9e3]';
  if (state === 'degraded') return 'border-[#7f6a2f] bg-[#2d2717] text-[#ffecc1]';
  return 'border-[#7b2f35] bg-[#301a1d] text-[#ffd4d8]';
}

export function ProviderHealthPanel() {
  const [snapshot, setSnapshot] = useState<ProviderHealthSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/provider-health', { signal: controller.signal, cache: 'no-store' });
        const body = (await response.json()) as ProviderHealthSnapshot & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Provider health is unavailable right now.');
        if (!cancelled) setSnapshot(body);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <section className="mt-5 rounded-xl border border-[#32453a] bg-[#102015] p-4" aria-live="polite">
      <h3 className="mb-1 text-[1rem] text-[#edfff4]">Provider health snapshot</h3>
      <p className="mb-3 text-[0.85rem] text-[#c2d6ca]">
        This checks connectivity to the route and charger-directory providers right now.
      </p>
      {busy && (
        <p className="flex items-center gap-2 text-[0.85rem] text-[#c2d6ca]">
          <Loader2 size={15} className="animate-spin" /> Checking provider status...
        </p>
      )}
      {!busy && error && (
        <p className="flex items-center gap-2 text-[0.85rem] text-[#ffd4d8]">
          <AlertTriangle size={15} /> {error}
        </p>
      )}
      {!busy && snapshot && (
        <>
          <p className="mb-3 flex items-center gap-2 text-[0.85rem] text-[#d6ebde]">
            {snapshot.overall === 'healthy' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            Overall status: <strong className="font-semibold">{snapshot.overall}</strong>
          </p>
          <div className="grid gap-2">
            {snapshot.checks.map(check => (
              <article key={check.key} className={`rounded-md border px-3 py-2 text-[0.83rem] ${tone(check.state)}`}>
                <p className="font-medium">{check.label}</p>
                <p>{healthStateLabel(check.state)} {check.latencyMs !== null ? `· ${check.latencyMs} ms` : ''}</p>
                <p className="opacity-90">{check.detail}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
