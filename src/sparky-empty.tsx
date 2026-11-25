import type { ReactNode } from 'react';

/** An empty screen is a chance for Sparky to point at the next step instead of grey text. */
export function SparkyEmpty({ line, children }: { line: string; children?: ReactNode }) {
  return <div className="panel sparky-empty">
    <span className="sparky-empty-face" aria-hidden="true" />
    <div><p>{line}</p>{children}</div>
  </div>;
}
