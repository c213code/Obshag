import type { ReactNode } from "react";
import { ru } from "@/lib/i18n/ru";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-[2px] grid size-[30px] shrink-0 place-items-center rounded-full bg-lime font-rounded text-[14px] font-bold text-on-lime"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-[3px]">{children}</div>
    </li>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-pill bg-card-2 px-2 py-[2px] font-mono text-[13px] text-text">{children}</code>
);

/** The Shortcuts recipe as numbered capsule steps. */
export function Steps({ urlField }: { urlField: ReactNode }) {
  const s = ru.shortcut.steps;
  return (
    <ol className="flex flex-col gap-4" data-testid="shortcut-steps">
      <Step n={1}>
        <p className="text-body">{s.one}</p>
      </Step>
      <Step n={2}>
        <p className="text-body">{s.two}</p>
        {urlField}
        <dl className="flex flex-col gap-2 rounded-md bg-card p-3 text-[14px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{s.twoMethod}</dt>
            <dd>
              <Code>{s.twoMethodValue}</Code>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">{s.twoBody}</dt>
            <dd>
              <Code>{s.twoBodyValue}</Code>
            </dd>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <dt className="text-muted">{s.twoKeys}</dt>
            <dd className="flex flex-col gap-2">
              <span>
                <Code>{s.keyToken}</Code> <span className="text-muted">→</span> {s.keyTokenValue}
              </span>
              <span>
                <Code>{s.keyAmount}</Code> <span className="text-muted">→</span> {s.keyAmountValue}
              </span>
              <span>
                <Code>{s.keyMerchant}</Code> <span className="text-muted">→</span> {s.keyMerchantValue}
              </span>
            </dd>
          </div>
        </dl>
      </Step>
      <Step n={3}>
        <p className="text-body">{s.three}</p>
      </Step>
    </ol>
  );
}
