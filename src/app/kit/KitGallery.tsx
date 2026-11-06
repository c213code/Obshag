"use client";

import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Bar } from "@/components/ui/Bar";
import { BottomActions } from "@/components/ui/BottomActions";
import { CardStack } from "@/components/ui/CardStack";
import type { BalanceCardData } from "@/components/ui/BalanceCard";
import { Card } from "@/components/ui/Card";
import { Fab } from "@/components/ui/Fab";
import { Netting } from "@/components/ui/Netting";
import { ReceivedRow } from "@/components/ui/ReceivedRow";
import { Header } from "@/components/ui/Header";
import { icons, BellIcon, CheckIcon, ExternalIcon, PlusIcon, type IconName } from "@/components/ui/icons";
import { ListRow } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { Pill } from "@/components/ui/Pill";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonAmount, SkeletonCard, SkeletonRow } from "@/components/ui/Skeleton";
import { TabBar, type TabId } from "@/components/ui/TabBar";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";

const k = ru.kit;

type Split = "equal" | "custom";
type Payer = "me" | "aidos" | "danya" | "nurik";

const splitOptions = [
  { value: "equal", label: k.split.equal },
  { value: "custom", label: k.split.custom },
] as const satisfies ReadonlyArray<{ value: Split; label: string }>;

const payerOptions = [
  { value: "me", label: k.payer.me },
  { value: "aidos", label: k.payer.aidos },
  { value: "danya", label: k.payer.danya },
  { value: "nurik", label: k.payer.nurik },
] as const satisfies ReadonlyArray<{ value: Payer; label: string }>;

const stackCards: ReadonlyArray<BalanceCardData> = [
  { id: "kv", name: "Квартира 42", paid: 2, total: 4, balance: 7550, tone: "lime" },
  { id: "dacha", name: "Дача", paid: 1, total: 3, balance: -1200, tone: "orange" },
  { id: "trip", name: "Поездка", paid: 3, total: 5, balance: 3400, tone: "periwinkle" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function KitGallery() {
  const [tab, setTab] = useState<TabId>("home");
  const [split, setSplit] = useState<Split>("equal");
  const [payer, setPayer] = useState<Payer>("me");
  const [amount, setAmount] = useState(2000);
  const [sheet, setSheet] = useState(false);
  const [sheetOutcome, setSheetOutcome] = useState<"done" | "dismissed">("dismissed");
  const [received, setReceived] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <main className="mx-auto flex w-[390px] max-w-full flex-col gap-8 px-4 pt-6 pb-40">
      <div>
        <h1 className="text-title">{k.title}</h1>
        <p className="text-caption">{k.subtitle}</p>
      </div>

      <Section title={k.sections.tabbar}>
        <p className="text-caption">
          {k.demo.tabHint} <span data-testid="last-action">{lastAction ?? "–"}</span>
        </p>
      </Section>

      <Section title={k.sections.segmented}>
        <Segmented label={k.split.label} options={splitOptions} value={split} onChange={setSplit} />
        <Segmented label={k.payer.label} options={payerOptions} value={payer} onChange={setPayer} activeVariant="lime" />
      </Section>

      <Section title={k.sections.pills}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill variant="ghost">{k.pills.ghost}</Pill>
          <Pill variant="on">{k.pills.on}</Pill>
          <Pill variant="lime">{k.pills.lime}</Pill>
          <Pill variant="on" size="sm">{k.pills.sm}</Pill>
          <Pill variant="lime">{k.pills.md}</Pill>
        </div>
        <div className="flex items-center gap-3">
          <Bar>
            <Pill variant="on">{ru.nav.home}</Pill>
            <Pill>{ru.nav.purchases}</Pill>
          </Bar>
          <Fab aria-label={k.demo.fab}>
            <PlusIcon size={26} />
          </Fab>
        </div>
      </Section>

      <Section title={k.sections.header}>
        <Header title={k.header.newPurchase} />
        <Header title={k.header.settle} trailing={{ label: k.demo.bell, icon: <BellIcon /> }} />
      </Section>

      <Section title={k.sections.rows}>
        <ListRow
          name="Айдос"
          avatarColor="blue"
          title="Айдос"
          caption={k.rows.received}
          trailing={
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-lime text-on-lime">
              <CheckIcon size={18} />
            </span>
          }
        />
        <ListRow
          name="Даня"
          avatarColor="brown"
          title="Даня"
          caption={k.rows.waiting}
          trailing={<Pill variant="on" size="sm">{k.rows.remind}</Pill>}
        />
        <ListRow name="Нурик" avatarColor="purple" title="Нурик" caption={k.rows.missing} captionTone="orange" />
        <div className="flex items-center gap-3">
          {([26, 40, 44, 52] as const).map((s) => (
            <Avatar key={s} name="Ерасыл" color="me" size={s} />
          ))}
        </div>
      </Section>

      <Section title={k.sections.stack}>
        <CardStack cards={stackCards} />
      </Section>

      <Section title={k.sections.money}>
        <Card className="flex items-center justify-between">
          <Money value={amount} data-testid="money-demo" className="text-display" />
          <Pill variant="lime" onClick={() => setAmount((a) => (a === 2000 ? 200 : 2000))}>
            {k.money.recalc}
          </Pill>
        </Card>
        <p className="text-caption">{k.money.caption}</p>
      </Section>

      <Section title={k.sections.sheet}>
        <Pill
          variant="on"
          className="self-start"
          onClick={() => {
            setSheetOutcome("dismissed");
            setSheet(true);
          }}
        >
          {k.sheet.open}
        </Pill>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          label={k.sheet.label}
          outcome={sheetOutcome}
          doneLabel={k.sheet.done}
        >
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold">{k.sheet.merchant}</span>
              <span className="text-[17px] font-bold">{formatTenge(k.sheet.amount)}</span>
            </div>
            <div className="flex gap-[6px]">
              <button
                type="button"
                className="flex-1 rounded-pill bg-lime p-[9px] text-[13px] font-semibold text-on-lime"
                onClick={() => {
                  setSheetOutcome("done");
                  setSheet(false);
                }}
              >
                {k.sheet.shared}
              </button>
              <button
                type="button"
                className="rounded-pill bg-card-2 px-[14px] py-[9px] text-[13px]"
                onClick={() => setSheet(false)}
              >
                {k.sheet.mine}
              </button>
            </div>
          </div>
        </Sheet>
      </Section>

      <Section title={k.sections.netting}>
        <Netting />
      </Section>

      <Section title={k.sections.received}>
        <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card p-4">
          <ReceivedRow
            name={k.receivedDemo.name}
            avatarColor="brown"
            paid={received ? 3 : 2}
            total={3}
            received={received}
            onReceive={() => setReceived(true)}
            pendingLabel={k.receivedDemo.marked}
            receivedLabel={k.receivedDemo.got}
            buttonLabel={k.receivedDemo.button}
          />
          <Pill variant="on" size="sm" className="self-start" onClick={() => setReceived(false)}>
            {k.receivedDemo.reset}
          </Pill>
        </div>
      </Section>

      <Section title={k.sections.skeleton}>
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonRow />
          <SkeletonAmount />
        </div>
      </Section>

      <Section title={k.sections.actions}>
        <BottomActions
          position="static"
          trailing={
            <Pill variant="lime">
              {k.actions.transfer}
              <ExternalIcon size={18} />
            </Pill>
          }
        >
          <Pill variant="on">{k.actions.paid}</Pill>
        </BottomActions>
      </Section>

      <Section title={k.sections.icons}>
        <div className="flex flex-wrap gap-4 text-text">
          {(Object.keys(icons) as IconName[]).map((name) => {
            const Icon = icons[name];
            return (
              <span key={name} className="flex flex-col items-center gap-1">
                <Icon />
                <span className="text-caption">{k.iconNames[name]}</span>
              </span>
            );
          })}
        </div>
      </Section>

      <TabBar
        value={tab}
        onChange={setTab}
        onAction={(a) => setLastAction(a === "purchase" ? ru.nav.addPurchase : ru.nav.addMonthly)}
      />
    </main>
  );
}
