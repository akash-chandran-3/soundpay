import { useEffect, useState } from 'react';

// Steps where the simulated transfer stopped with an error.
const FAILURE_STEPS = ['VPA_NOT_FOUND', 'DEBIT_DECLINED'];
const REVEAL_MS = 250;

// Shows the hops of a SIMULATED UPI transfer, as recorded by the server:
// payer's app -> NPCI -> payer's bank -> payee's bank -> confirmation.
// The steps are revealed one by one so the flow is easy to follow on screen;
// the "+0.3s" times are the real moments the server recorded each hop.
export default function UpiTimeline({ steps }) {
  const [shown, setShown] = useState(0);

  // Start again from the first step whenever a new list arrives.
  useEffect(() => setShown(0), [steps]);

  // Reveal the next step after a short pause, until all are visible.
  useEffect(() => {
    if (shown >= steps.length) return;
    const id = setTimeout(() => setShown(shown + 1), REVEAL_MS);
    return () => clearTimeout(id);
  }, [shown, steps]);

  return (
    <ol className="timeline">
      {steps.slice(0, shown).map((s) => {
        const failed = FAILURE_STEPS.includes(s.step);
        return (
          <li key={s.step} className={failed ? 'failed' : 'ok'}>
            <span className="icon">{failed ? '✕' : '✓'}</span>
            <span className="text">{s.message}</span>
            <span className="time">+{(s.atMs / 1000).toFixed(1)}s</span>
          </li>
        );
      })}
    </ol>
  );
}
