import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EFFECTS, type Effect } from "./effects";
import { annotateSkill, attackPercent, leaders, rankedRuns, roster, simulate, skillCooldown, trialBoss } from "./fight";
import { UNIT_ICONS } from "./unit-icons";

type Unit = {
  id: string;
  name: string;
  job: string;
  element: string;
  portrait: boolean;
  rarity?: string;
  hp: number;
  atk: number;
  defn: number;
  spd: number;
  skills: { name: string; meta: string; lines: string[] }[];
};

const units = roster as Unit[];
const byId = new Map(units.map((unit) => [unit.id, unit]));

function leaderBoard(rarity: "ssr" | "sr", release: "all" | "released", stars: "0" | "3" | "5", n: "1" | "3", element = "") {
  const key = rarity === "sr" ? (release === "released" ? "srReleased" : "sr") : release;
  if (element) return (((leaders as any).byElement?.[element]?.[stars]?.[key])?.[n] ?? null) as any[] | null;
  const starred = (leaders as any).byStar?.[stars]?.[key];
  const legacy = stars === "5" ? (leaders as any)[key] : undefined;
  return ((starred ?? legacy)?.[n] ?? null) as any[] | null;
}

function boardHasTeams(list: any[] | null) {
  return Array.isArray(list) && list.length > 0;
}
const SSR_STAR_CHOICES = ["3", "0"] as const;
const SR_STAR_CHOICES = ["3", "5"] as const;
const ELEMENT_CHOICES = ["Fire", "Ice", "Earth", "Ground"] as const;
const ELEMENT_LABEL: Record<string, string> = { Earth: "Wind" };

function elementName(element: string) {
  return ELEMENT_LABEL[element] || element;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function asset(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

function Num({ children }: { children: string }) {
  return <span className="font-medium text-ember tabular-nums">{children}</span>;
}

function Rank({ rows }: { rows: { key: string; name: ReactNode; value: string }[] }) {
  return (
    <ol className="mt-3 grid gap-2">
      {rows.map((row, index) => (
        <li key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
          <span className="w-5 shrink-0 font-display text-lg text-ember">{index + 1}</span>
          <span className="text-sm text-white/85">{row.name}</span>
          <span className="min-w-0 flex-1 text-right text-sm font-medium text-ember tabular-nums">{row.value}</span>
        </li>
      ))}
    </ol>
  );
}

function Tip({ name }: { name: string }) {
  const effect = EFFECT_BY_NAME.get(name);
  if (!effect) return <>{name}</>;
  return <EffectWord effect={effect} text={name} />;
}

function Flow({ steps }: { steps: { name: string; value: ReactNode }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-stretch gap-2">
      {steps.map((step, index) => (
        <div key={step.name} className="contents">
          {index > 0 && <span className="self-center text-white/35">×</span>}
          <div className="min-w-[7.5rem] flex-1 rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">{step.name}</p>
            <p className="mt-1 text-sm text-white/90">{step.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const LINE_COLORS = ["#e8a06a", "#7dcea0", "#8eb4e8", "#e2b0ea"];
const EFFECT_PATTERN = new RegExp(
  [...EFFECTS]
    .sort((a, b) => b.name.length - a.name.length)
    .map((effect) => `\\b${effect.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    .join("|"),
  "g",
);
const EFFECT_BY_NAME = new Map(EFFECTS.map((effect) => [effect.name, effect]));

function EffectWord({ effect, text }: { effect: Effect; text: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const pointer = useRef("mouse");
  const touch = useRef(false);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const tone = effect.label ? "text-ember" : effect.buff ? "text-[#9ddeb8]" : "text-[#f0a3a3]";
  const heading = effect.label ?? (effect.buff ? "Buff" : "Debuff");

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      const tipEl = tip.current;
      if (!el || !tipEl) return;
      const rect = el.getBoundingClientRect();
      const tipRect = tipEl.getBoundingClientRect();
      const margin = 8;
      const left = Math.min(
        Math.max(margin, rect.left + rect.width / 2 - tipRect.width / 2),
        Math.max(margin, window.innerWidth - tipRect.width - margin),
      );
      let top = rect.top - tipRect.height - 8;
      if (top < margin) top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - tipRect.height - margin);
      }
      setBox({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (anchor.current?.contains(event.target as Node)) return;
      touch.current = false;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <button
      type="button"
      ref={anchor}
      className={`inline cursor-pointer border-0 bg-transparent p-0 font-[inherit] underline decoration-dotted underline-offset-2 ${tone}`}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse") touch.current = true;
      }}
      onPointerEnter={(event) => {
        pointer.current = event.pointerType;
        if (event.pointerType === "mouse" && !touch.current) setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !touch.current) setOpen(false);
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) setOpen(true);
      }}
      onBlur={() => {
        if (!touch.current) setOpen(false);
      }}
      onClick={() => {
        if (pointer.current !== "mouse" || touch.current) setOpen(true);
      }}
    >
      {text}
      {open && createPortal(
        <span
          ref={tip}
          role="tooltip"
          className="pointer-events-none fixed z-30 w-[min(16rem,calc(100vw-1rem))] rounded-xl bg-[#1c1412]/95 px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-white shadow-2xl ring-1 ring-white/15"
          style={box ? { top: box.top, left: box.left } : { top: 0, left: 8, visibility: "hidden" }}
        >
          <span className={`mb-1 block text-[10px] uppercase tracking-[0.14em] ${tone}`}>{heading}</span>
          {effect.description}
        </span>,
        document.body,
      )}
    </button>
  );
}

function SkillLine({ line }: { line: string }) {
  const parts: { text: string; name?: string }[] = [];
  let last = 0;
  for (const match of line.matchAll(EFFECT_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: line.slice(last, start) });
    parts.push({ text: match[0], name: match[0] });
    last = start + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return (
    <>
      {parts.map((part, index) => {
        const effect = part.name ? EFFECT_BY_NAME.get(part.name) : undefined;
        if (!effect) return <span key={index}>{part.text}</span>;
        return <EffectWord key={index} effect={effect} text={part.text} />;
      })}
    </>
  );
}

function TurnChart({ units }: { units: { id: string; name: string; turns: number[]; heal_turns: number[]; shield_turns: number[] }[] }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const width = 1000;
  const height = 320;
  const left = 72;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const turnCount = units[0]?.turns.length || 30;
  const shown = units.filter((unit) => !hidden[unit.id]);
  let max = 1;
  for (const unit of shown) {
    for (const value of [...unit.turns, ...unit.heal_turns, ...unit.shield_turns]) {
      if (value > max) max = value;
    }
  }
  const plotH = height - top - bottom;
  const plotW = width - left - right;
  const slot = plotW / turnCount;
  const xAt = (index: number) => left + (index + 0.5) * slot;
  const yAt = (value: number) => top + (1 - value / max) * plotH;
  const series = [
    { key: "turns" as const, dash: undefined },
    { key: "heal_turns" as const, dash: "7 5" },
    { key: "shield_turns" as const, dash: "1.5 4" },
  ];
  const hoverTurn = hover == null ? null : units.map((unit, index) => ({
    name: unit.name,
    color: LINE_COLORS[index % LINE_COLORS.length],
    hidden: hidden[unit.id],
    damage: unit.turns[hover] || 0,
    heal: unit.heal_turns[hover] || 0,
    shield: unit.shield_turns[hover] || 0,
  }));

  return (
    <div className="mt-5">
      <h3 className="font-display text-xl">Each turn</h3>
      <p className="mt-1 text-sm text-white/60">Solid line is damage, dashed is healing, dotted is shield. Hover a turn to see the breakdown. Click a name to hide that unit.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {units.map((unit, index) => (
          <button
            key={unit.id}
            type="button"
            onClick={() => setHidden((current) => ({ ...current, [unit.id]: !current[unit.id] }))}
            onMouseEnter={() => setFocus(index)}
            onMouseLeave={() => setFocus(null)}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ring-1 ring-white/15 ${hidden[unit.id] ? "text-white/35" : "bg-white/10"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />
            {unit.name}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img" aria-label="Damage, healing, and shield on each enemy turn">
        {[0, 1, 2, 3, 4].map((step) => {
          const value = max * step / 4;
          const y = yAt(value);
          return (
            <g key={step}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="rgba(255,255,255,0.12)" />
              <text x={left - 8} y={y + 4} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.55)">{fmt(value)}</text>
            </g>
          );
        })}
        {units.map((unit, index) => series.map((metric) => {
          const dim = hidden[unit.id] || (focus != null && focus !== index);
          const points = unit[metric.key].map((value, turn) => `${xAt(turn)},${yAt(value || 0)}`).join(" ");
          return (
            <polyline
              key={`${unit.id}-${metric.key}`}
              points={points}
              fill="none"
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={metric.dash}
              opacity={dim ? 0.12 : 1}
            />
          );
        }))}
        {hover != null && (
          <line x1={xAt(hover)} y1={top} x2={xAt(hover)} y2={top + plotH} stroke="rgba(255,255,255,0.7)" />
        )}
        <rect
          x={left}
          y={top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={(event) => {
            const svg = event.currentTarget.ownerSVGElement;
            const matrix = svg?.getScreenCTM();
            if (!svg || !matrix) return;
            const point = svg.createSVGPoint();
            point.x = event.clientX;
            point.y = event.clientY;
            const local = point.matrixTransform(matrix.inverse());
            const index = Math.floor((local.x - left) / slot);
            setHover(index >= 0 && index < turnCount ? index : null);
          }}
          onMouseLeave={() => setHover(null)}
        />
        {Array.from({ length: turnCount }, (_, index) => (
          (turnCount <= 12 || (index + 1) % 5 === 0 || index === turnCount - 1) ? (
            <text key={index} x={xAt(index)} y={height - 10} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.55)">{index + 1}</text>
          ) : null
        ))}
      </svg>
      <div className="mt-2 text-sm text-white/75">
        {hoverTurn ? (
          <>
            <p className="font-medium text-white">Turn {hover! + 1}</p>
            {hoverTurn.filter((part) => !part.hidden).map((part) => (
              <p key={part.name} className="flex justify-between gap-3">
                <span style={{ color: part.color }}>{part.name}</span>
                <span className="tabular-nums">{fmt(part.damage)} damage · {fmt(part.heal)} healing · {fmt(part.shield)} shield</span>
              </p>
            ))}
          </>
        ) : focus != null && units[focus] ? (
          <p>
            <span style={{ color: LINE_COLORS[focus % LINE_COLORS.length] }}>{units[focus].name}</span>
            {" "}
            {fmt(units[focus].turns.reduce((sum, value) => sum + value, 0))} damage,{" "}
            {fmt(units[focus].heal_turns.reduce((sum, value) => sum + value, 0))} healing,{" "}
            {fmt(units[focus].shield_turns.reduce((sum, value) => sum + value, 0))} shield
          </p>
        ) : (
          <p>Hover a turn.</p>
        )}
      </div>
    </div>
  );
}

const UNIT_ART = new Set([
  "C01_SR_001", "C01_SR_002", "C01_SR_003", "C01_SR_005",
  "C01_SSR_001", "C01_SSR_002", "C01_SSR_003",
  "C02_SR_001", "C02_SR_002", "C02_SR_003",
  "C02_SSR_001", "C02_SSR_002", "C02_SSR_004", "C02_SSR_006",
  "C03_SR_001", "C03_SR_002", "C03_SR_003",
  "C03_SSR_001", "C03_SSR_002", "C03_SSR_004", "C03_SSR_006",
  "C04_SR_001", "C04_SR_002", "C04_SR_003", "C04_SR_004",
  "C04_SSR_001", "C04_SSR_002", "C04_SSR_005", "C04_SSR_006",
]);

function UnitFace({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  const icon = UNIT_ICONS.has(id);
  if (!icon && !UNIT_ART.has(id)) return null;
  return (
    <img
      src={asset(icon ? `units/icons/${id}.png` : `units/${id}.jpg`)}
      alt=""
      className={
        size === "sm"
          ? "h-7 w-7 shrink-0 rounded-full object-cover"
          : "h-11 w-11 shrink-0 rounded-lg object-cover"
      }
    />
  );
}

function RarityMark({ rarity, onEmber = false }: { rarity?: string; onEmber?: boolean }) {
  const label = rarity === "SR" || rarity === "R" ? rarity : "SSR";
  const tone = onEmber
    ? "bg-ink/15 text-ink"
    : label === "SSR"
      ? "bg-ember text-ink"
      : label === "SR"
        ? "bg-ember/25 text-ember"
        : "bg-white/15 text-white/80";
  return <span className={`mr-1 inline-block align-middle rounded px-1.5 py-0.5 text-xs font-medium leading-none ${tone}`}>{label}</span>;
}

function Segmented({
  value,
  options,
  onChange,
  wrap = false,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  wrap?: boolean;
}) {
  return (
    <div className={`${wrap ? "flex max-w-full flex-wrap overflow-hidden rounded-2xl" : "inline-flex rounded-full"} bg-black/40 p-1 ring-1 ring-white/15`}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-full px-3 py-1.5 text-sm transition sm:px-3.5 ${
            value === option.id ? "bg-ember text-ink shadow" : "text-white/80 hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function UnitPicker({
  value,
  pool,
  onChange,
}: {
  value: string;
  pool: Unit[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const selected = byId.get(value);
  const matches = pool.filter((unit) => {
    const hay = `${unit.name} ${unit.rarity || ""} ${unit.job} ${unit.element} ${elementName(unit.element)} ${unit.id}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl bg-white/10 px-3 py-2.5 text-left ring-1 ring-white/15 hover:bg-white/15"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && <UnitFace id={selected.id} />}
          <span className="min-w-0">
            <span className="block text-sm">
              {selected && <RarityMark rarity={selected.rarity} />}
              {selected ? selected.name : "Pick a unit"}
            </span>
            <span className="block text-xs text-white/60">{selected ? `${selected.job} · ${elementName(selected.element)}` : "None yet"}</span>
          </span>
        </span>
        <span className="text-white/50">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl bg-[#1c1412]/95 shadow-2xl ring-1 ring-white/15">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="w-full border-b border-white/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/40"
          />
          <div className="max-h-64 overflow-auto">
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-white/60 hover:bg-white/10"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              None
            </button>
            {matches.map((unit) => (
              <button
                key={unit.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/10"
                onClick={() => {
                  onChange(unit.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <UnitFace id={unit.id} />
                <span className="min-w-0">
                  <span className="block text-sm">
                    <RarityMark rarity={unit.rarity} />
                    {unit.name}
                  </span>
                  <span className="block text-xs text-white/50">{unit.job} · {elementName(unit.element)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"build" | "leaders" | "units" | "mechanics">("build");
  const [pool, setPool] = useState<"all" | "released">("released");
  const [leaderRarity, setLeaderRarity] = useState<"ssr" | "sr">("ssr");
  const [leaderRelease, setLeaderRelease] = useState<"all" | "released">("released");
  const [leaderStars, setLeaderStars] = useState<"0" | "3" | "5">("5");
  const leaderN = "1";
  const [leaderElement, setLeaderElement] = useState("Fire");
  const [enemyN, setEnemyN] = useState(1);
  const bossId = "plain";
  const [slots, setSlots] = useState(["", "", "", ""]);
  const [stars, setStars] = useState([5, 5, 5, 5]);
  const [ranked, setRanked] = useState<{ ids: string[]; n: number; stars: number; element: string } | null>(null);
  const [unitId, setUnitId] = useState(units.find((unit) => unit.portrait)?.id || units[0]?.id || "");
  const [showCharacter, setShowCharacter] = useState(false);
  const [unitOrigin, setUnitOrigin] = useState<"leaders" | "list">("list");
  const [search, setSearch] = useState("");
  const characterRef = useRef<HTMLDivElement>(null);

  const page = view === "leaders" || view === "units" || view === "mechanics" ? view : "build";
  useEffect(() => {
    document.title = "Godly Love: On Air";
  }, []);
  const visible = useMemo(
    () => (pool === "released" ? units.filter((unit) => unit.portrait || UNIT_ICONS.has(unit.id)) : units),
    [pool],
  );
  const bossKit = trialBoss(leaderElement)!;
  const starChoices = leaderRarity === "sr" ? SR_STAR_CHOICES : SSR_STAR_CHOICES;
  const activeStar = (starChoices as readonly string[]).includes(leaderStars) ? leaderStars : starChoices[0];
  const board = leaderBoard(leaderRarity, leaderRelease, activeStar, leaderN, leaderElement);
  const rows = board ?? [];
  const releaseChoices = (["released", "all"] as const).filter((release) =>
    boardHasTeams(leaderBoard(leaderRarity, release, activeStar, "1", leaderElement)),
  );
  useEffect(() => {
    if ((starChoices as readonly string[]).includes(leaderStars)) return;
    if (starChoices[0]) setLeaderStars(starChoices[0]);
  }, [starChoices, leaderStars]);
  useEffect(() => {
    if (releaseChoices.includes(leaderRelease)) return;
    if (releaseChoices[0]) setLeaderRelease(releaseChoices[0]);
  }, [releaseChoices, leaderRelease]);
  const tally = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const row of rows) {
      for (const unit of row.units as { id: string; name: string }[]) {
        const current = counts.get(unit.id) || { id: unit.id, name: unit.name, count: 0 };
        current.count += 1;
        counts.set(unit.id, current);
      }
    }
    return [...counts.values()]
      .filter((unit) => unit.count >= 3)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [rows]);
  const result = useMemo(() => {
    const listed = ranked && ranked.element === leaderElement && ranked.n === enemyN && stars.every((star) => star === ranked.stars) && slots.every((id, index) => id === (ranked.ids[index] || ""));
    if (listed) return rankedRuns(ranked.ids, ranked.n, ranked.stars, leaderElement);
    if (!slots.some(Boolean)) return null;
    return simulate(slots, stars, enemyN, bossId, leaderElement);
  }, [slots, stars, enemyN, bossId, ranked, leaderElement]);

  const selectedUnit = units.find((unit) => unit.id === unitId);
  const characterUnits = visible.filter((unit) =>
    `${unit.name} ${unit.rarity || "SSR"} ${unit.job} ${unit.element} ${elementName(unit.element)} ${unit.id}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function openUnit(id: string) {
    const unit = byId.get(id);
    if (unit && !unit.portrait && !UNIT_ICONS.has(unit.id)) setPool("all");
    setUnitId(id);
    setSearch("");
    setShowCharacter(true);
    setUnitOrigin("leaders");
    setView("units");
    window.setTimeout(() => characterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function leaveUnit() {
    if (unitOrigin === "leaders") {
      setView("leaders");
      return;
    }
    setShowCharacter(false);
  }

  function loadTeam(row: any) {
    const next = ["", "", "", ""];
    const star = Number(activeStar);
    const nextStars = [star, star, star, star];
    row.units.forEach((unit: { id: string }, index: number) => {
      next[index] = unit.id;
    });
    setSlots(next);
    setStars(nextStars);
    setEnemyN(Number(leaderN));
    setPool(next.every((id) => {
      const unit = byId.get(id);
      return !unit || unit.portrait || UNIT_ICONS.has(unit.id);
    }) ? "released" : "all");
    setRanked({ ids: row.units.map((unit: { id: string }) => unit.id), n: Number(leaderN), stars: star, element: leaderElement });
    setView("build");
  }

  return (
    <div className="relative min-h-screen">
      <div
        className="fixed inset-x-0 top-0 h-screen bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${asset("fireflies.jpg")})`, height: "100lvh" }}
        aria-hidden
      />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-black/35 px-5 py-4 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm">
          <div>
            <h1 className="font-display text-2xl font-medium text-ember sm:text-3xl">Godly Love: On Air</h1>
            {page === "build" && (
              <p className="mt-1 max-w-xl text-sm text-white/60">
                Level 80 units. Damage here is the total across 30 of the boss's turns, and the boss returns at full HP after each defeat. SSR top teams use that same fight, and leave a team off the list if anyone dies. SR & R top teams end the fight when the boss dies, and keep a team when someone is still standing. The {elementName(leaderElement)} boss is {bossKit.name}: {fmt(bossKit.hp)} HP, {fmt(bossKit.atk)} attack, {fmt(bossKit.defn)} defense, {fmt(bossKit.spd)} speed, with that unit's basic, ultimate, and passive.
                {visible.some((unit) => unit.rarity === "SR" || unit.rarity === "R") ? " SR starts from 9,000 HP, 1,350 attack, and 1,125 defense. R starts from 8,000, 1,200, and 1,000. Each unit still multiplies that by its own coefficients." : ""}
              </p>
            )}
            {page === "mechanics" && (
              <p className="mt-1 max-w-xl text-sm text-white/60">
                How battles work, including the rules the skill text leaves out.
              </p>
            )}
          </div>
          <Segmented
            wrap
            value={page}
            onChange={(id) => {
              const next = id as "build" | "leaders" | "units" | "mechanics";
              if (next !== "units") {
                setShowCharacter(false);
                setUnitOrigin("list");
              }
              setView(next);
            }}
            options={[
              { id: "build", label: "Damage calc" },
              { id: "leaders", label: "Top teams" },
              { id: "units", label: "Characters" },
              { id: "mechanics", label: "Mechanics" },
            ]}
          />
        </header>

        {page === "leaders" && (
            <section className="rounded-3xl bg-black/35 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-2xl">Top teams</h2>
                <div className="flex flex-wrap gap-2">
                  <Segmented
                    value={leaderRarity}
                    onChange={(id) => setLeaderRarity(id as "ssr" | "sr")}
                    options={[
                      { id: "ssr", label: "SSR" },
                      { id: "sr", label: "SR & R" },
                    ]}
                  />
                  {releaseChoices.length > 1 && (
                  <Segmented
                    value={leaderRelease}
                    onChange={(id) => setLeaderRelease(id as "all" | "released")}
                    options={releaseChoices.map((id) => ({
                      id,
                      label: id === "released" ? "Currently Released" : "All units",
                    }))}
                  />
                  )}
                  <Segmented
                    value={activeStar}
                    onChange={(id) => setLeaderStars(id as "0" | "3" | "5")}
                    options={starChoices.map((id) => ({
                      id,
                      label: id === "0" ? "Base" : id === "3" ? "3★ passive" : "5★",
                    }))}
                  />
                  <Segmented
                    value={leaderElement}
                    onChange={setLeaderElement}
                    options={ELEMENT_CHOICES.map((id) => ({
                      id,
                      label: elementName(id),
                    }))}
                  />
                </div>
              </div>
              <p className="mt-4 text-sm text-white/65">
                {activeStar === "0" && "Base is 0★. The passive is off, and HP, attack, and defense have no ascension bonus. "}
                {activeStar === "3" && "3★ turns the passive on. HP, attack, and defense are ×1.35. "}
                {activeStar === "5" && "5★ is the full ascension. The passive is on, and HP, attack, and defense are ×2. "}
                {`The ${elementName(leaderElement)} boss is ${bossKit.name} from Phantom Trial stage ${bossKit.stage}: ${fmt(bossKit.hp)} HP, ${fmt(bossKit.atk)} attack, ${fmt(bossKit.defn)} defense, ${fmt(bossKit.spd)} speed. The boss uses that unit's basic, ultimate, and passive, and gains 15% attack at the start of each turn.`}
              </p>
              <div className="mt-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-ember">
                {leaderRarity === "ssr" ? (
                  <>
                    <p className="text-xs uppercase tracking-[0.16em] text-ember">This list · SSR</p>
                    <p className="mt-1 text-sm text-white/80">The fight ends when the boss dies. The team has to clear twice in a row, with someone still standing each time. The slower clear sets the order: boss turns, then ally actions, then damage taken. If nobody does that within 15 boss turns, the list is the teams that dealt the most damage instead.</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs uppercase tracking-[0.16em] text-ember">This list · SR & R</p>
                    <p className="mt-1 text-sm text-white/80">The fight ends when the boss dies. The team has to clear twice in a row, with someone still standing each time. The list is ordered by the higher damage taken of those two clears. A full wipe, or no kill within 15 boss turns, leaves the team off the list.</p>
                  </>
                )}
              </div>
              {tally.length > 0 && (
              <>
              <h3 className="mt-5 font-display text-xl">Core units</h3>
              <p className="mt-1 text-sm text-white/65">The units who show up most, up to 10. A unit needs at least 3 of these teams.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {tally.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => openUnit(unit.id)}
                    className="inline-flex items-center gap-2 rounded-full bg-white/8 py-1 pl-1 pr-3 text-left text-sm ring-1 ring-white/10 transition hover:bg-white/15"
                  >
                    <UnitFace id={unit.id} size="sm" />
                    <RarityMark rarity={byId.get(unit.id)?.rarity} />
                    <span>{unit.name}</span>
                    <span className="font-medium tabular-nums text-ember">{unit.count} teams</span>
                  </button>
                ))}
              </div>
              </>
              )}
              {rows.length > 0 && (
              <ol className="mt-4 grid gap-2">
                {rows.map((row: any) => (
                  <li key={row.rank}>
                    <button
                      type="button"
                      onClick={() => loadTeam(row)}
                      className="flex w-full flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl bg-white/8 px-3 py-3 text-left ring-1 ring-white/10 transition hover:bg-white/15"
                    >
                      <span className="font-display text-lg leading-7 text-ember">{row.rank}</span>
                      <span className="flex min-w-48 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                        {row.units.map((unit: { id: string; name: string }) => (
                          <span key={unit.id} className="inline-flex items-center gap-1.5">
                            <UnitFace id={unit.id} size="sm" />
                            <RarityMark rarity={byId.get(unit.id)?.rarity} />
                            <span>{unit.name}</span>
                          </span>
                        ))}
                      </span>
                      <span className="ml-auto shrink-0 self-start whitespace-nowrap text-right leading-tight">
                        {row.clears > 0 && row.rounds > 0 && (
                          <>
                            <span className="block font-medium tabular-nums">{fmt(row.rounds)}</span>
                            <span className="block text-xs text-white/55">turns to clear</span>
                            <span className="mt-1 block font-medium tabular-nums">{fmt(row.actions)}</span>
                            <span className="block text-xs text-white/55">ally actions</span>
                          </>
                        )}
                        <span className={`block font-medium tabular-nums ${row.clears > 0 && row.rounds > 0 ? "mt-1" : ""}`}>{fmt(row.damage)}</span>
                        <span className="block text-xs text-white/55">damage</span>
                        <span className="mt-1 block font-medium tabular-nums">{fmt(row.taken)}</span>
                        <span className="block text-xs text-white/55">damage taken</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              )}
              {board == null && (
                <p className="mt-4 text-sm text-white/65">This ranking is still running. These 20 teams show up here when it finishes.</p>
              )}
            </section>
        )}

        {page === "mechanics" && (
          <section className="space-y-8 rounded-3xl bg-black/35 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm">
            <div>
              <h2 className="font-display text-2xl">Action Gauge</h2>
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>A unit takes a turn when their Action Gauge is full. Speed fills it. After the turn, the gauge is empty.</p>
                <p>A skill can also move the gauge right away, by the percent written on that skill. Increasing it by <Num>20%</Num> moves that unit <Num>20%</Num> of the way to their next turn. Decreasing it by <Num>20%</Num> pushes the next turn back by the same amount. It cannot go above full, and it cannot go below empty. It is not a buff that stays, the way <Tip name="ATK Up" /> does.</p>
                <p><Tip name="SPD Up" /> and <Tip name="SPD Down" /> are different. They change how fast the gauge fills for as long as they last. <Tip name="SPD Up" /> fills it <Num>30%</Num> faster. <Tip name="SPD Down" /> fills it <Num>30%</Num> slower, so everyone else acts about <Num>43%</Num> more often during those 2 turns.</p>
                <p><Tip name="Shackled" /> blocks gauge increases from skills. Speed still fills the gauge. <Tip name="Disrupt" /> cuts healing in half, and cuts those gauge increases in half.</p>
                <p><Tip name="Immunity" /> blocks a gauge decrease. A decrease still has to pass debuff resistance. Bosses can have their gauge decreased, and they can receive <Tip name="SPD Down" />.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Enemy targeting</h2>
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>An enemy with <Tip name="Taunt" /> attacks the ally who applied it.</p>
                <p>Otherwise the enemy attacks the ally with the lowest current HP. Element changes that comparison. An ally the enemy's element beats counts as <Num>80,000</Num> HP lower, so they are more likely to be chosen. An ally whose element beats the enemy counts as <Num>90,000</Num> HP higher, so they are less likely to be chosen. If those totals match, the ally in the earlier team slot is attacked.</p>
                <p><Tip name="Stealth" /> and <Tip name="Invincible" /> are skipped while another ally can still be hit.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Element</h2>
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>Fire beats Wind. Wind beats Ground. Ground beats Ice. Ice beats Fire.</p>
                <p>An attacker with the advantage deals <Num>1.1×</Num> damage and gains <Num>15%</Num> crit rate. The <Tip name="Big Hit" /> chance stays <Num>25%</Num>.</p>
                <p>An attacker at a disadvantage deals normal damage, with no bonus crit. The target's <Tip name="Dodge" /> chance rises by <Num>50%</Num>. A dodged hit deals <Num>75%</Num> damage.</p>
                <p>Element does not change damage over time, or the chance for a debuff to land.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Bosses</h2>
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>Bosses are immune to Silence, <Tip name="Stun" />, <Tip name="Taunt" />, <Tip name="Provoke" />, <Tip name="Slumber" />, and <Tip name="Poison" />. <Tip name="Bleed" />, <Tip name="Burn" />, and debuffs such as ATK Down, DEF Down, and SPD Down can still land.</p>
                <p>Elite enemies are immune to <Tip name="Stun" /> only.</p>
                <p>Because bosses cannot be taunted, they always use the HP comparison above.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Debuff resistance</h2>
              <p className="mt-3 text-sm text-white/80">A debuff has to pass two checks. The first is the chance written on the skill. The second is the target's resistance.</p>
              <Flow steps={[
                { name: "Skill chance", value: <>The percent on the skill, such as <Num>75%</Num></> },
                { name: "Resistance", value: <><Num>100%</Num> + Effect Hit − Debuff RES, capped at <Num>85%</Num></> },
              ]} />
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>When the resistance check is <Num>0%</Num> or lower, the debuff misses.</p>
                <p>For example, a <Num>75%</Num> debuff against <Num>20%</Num> resistance has a second check of <Num>80%</Num>. Both checks have to succeed, so the debuff lands <Num>60%</Num> of the time.</p>
                <p>Against <Num>0%</Num> resistance, the second check is <Num>85%</Num>.</p>
                <p>A skill that says Action Debuff means <Tip name="Stun" /> or <Tip name="Slumber" />.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Flanking</h2>
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>After a basic attack, each other ally can <Tip name="Flank" />. At level 80 the chance is <Num>3%</Num> for SSR, SR, and R. A flank uses that ally's basic attack on the same target. A counterattack does not cause a flank, and a flank does not cause another one.</p>
                <p>A skill can call a flank at the chance written on that skill. <Tip name="Flanking+" /> also calls in every other ally who has it.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Damage</h2>
              <p className="mt-3 text-sm text-white/80">A skill hit multiplies these steps together. Heals, shields, and damage over time leave out the final <Num>1.871</Num> multiplier.</p>
              <Flow steps={[
                { name: "Attack", value: "Unit attack" },
                { name: "Skill", value: "Skill percent" },
                { name: "Element", value: <><Num>1.1</Num> with advantage, or <Num>1</Num></> },
                { name: "Hit type", value: <>Crit damage, <Num>1.15×</Num> on a <Tip name="Big Hit" />, or <Num>75%</Num> on a <Tip name="Dodge" /></> },
                { name: "Defense", value: <><Num>2,000</Num> / (<Num>2,000</Num> + defense)</> },
                { name: "DMG RED", value: "Highest one only" },
                { name: "Final", value: <Num>1.871</Num> },
              ]} />
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>DEF Up increases the defense used in that formula. DEF Down can remove at most <Num>75%</Num> of defense. Each DEF Pierce on the skill removes more defense, up to <Num>95%</Num>. <Tip name="Suffocate" /> multiplies the hit by <Num>1.1</Num> after defense.</p>
                <p>Crit rate and crit damage come from the unit. A shield takes the damage before HP does. Skill Nullifier blocks one skill hit and is then removed. Status damage, such as <Tip name="Poison" />, still gets through.</p>
                <p>Dodge is checked before crit. The base chance is <Num>0%</Num>. <Tip name="ACC Down" /> raises it to <Num>35%</Num>, and fighting at an element disadvantage adds another <Num>50%</Num>. A dodged hit deals <Num>75%</Num> damage and cannot crit or be a Big Hit.</p>
                <p>A hit that neither dodges nor crits has a <Num>25%</Num> chance to be a <Tip name="Big Hit" /> and deal <Num>1.15×</Num> damage. Element advantage uses that same <Num>25%</Num>. At <Num>15%</Num> crit and <Num>130%</Num> crit damage, Big Hit adds about <Num>3%</Num> to an average hit. At <Num>100%</Num> crit, every hit is already a crit, so Big Hit cannot occur.</p>
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl">Strongest to weakest</h2>
              <p className="mt-3 text-sm text-white/80">Each row is one effect by itself, on a unit with <Num>15%</Num> crit rate and <Num>130%</Num> crit damage. The biggest gain is first. Pierce and DEF Down are worth more when the target's defense is high.</p>
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-white/45">Damage dealt, per hit</p>
              <Rank rows={[
                { key: "pierce", name: "DEF Pierce 30%", value: "+32% around 8,000 defense" },
                { key: "atkbig", name: <Tip name="ATK Up+" />, value: "+30%" },
                { key: "atk", name: <Tip name="ATK Up" />, value: "+20%" },
                { key: "defdown", name: <Tip name="DEF Down" />, value: "+19% around 8,000 defense" },
                { key: "crit", name: <Tip name="Crit Rate Up" />, value: "+14%" },
                { key: "suffocate", name: <Tip name="Suffocate" />, value: "+10% damage taken" },
                { key: "cdmg", name: <Tip name="Crit DMG Up" />, value: "+7%" },
              ]} />
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p>DEF Pierce is part of the skill, not a status you can apply. Ultimates that pierce use <Num>30%</Num>. At <Num>2,500</Num> defense, that is about <Num>+20%</Num> damage, equal to ATK Up. DEF Down is about <Num>+13%</Num> there, and approaches <Num>+25%</Num> as defense gets very high.</p>
                <p>Suffocate makes the target take <Num>10%</Num> more damage and lowers evasion by <Num>30%</Num>.</p>
                <p>Crit Rate Up and Crit DMG Up together are worth <Num>+45%</Num>. As crit rate rises, Crit Rate Up is worth less, and at <Num>100%</Num> crit it adds nothing further. Crit DMG Up is worth more at high crit: about <Num>+27%</Num> alongside Crit Rate Up, and about <Num>+38%</Num> at <Num>100%</Num> crit, which is more than <Num>30%</Num> DEF Pierce.</p>
                <p><Tip name="SPD Up" /> is worth as much as ATK Up+ while it lasts, because <Num>+30%</Num> speed gives <Num>+30%</Num> more turns. Those turns still benefit from attack buffs. It lasts 2 turns and does not increase the damage of a single hit.</p>
                <p className="mt-3 text-xs uppercase tracking-[0.16em] text-white/45">Added damage, strongest to weakest</p>
              </div>
              <Rank rows={[
                { key: "spddown", name: <Tip name="SPD Down" />, value: "everyone else acts 43% more often" },
                { key: "poison", name: <Tip name="Poison" />, value: "10% of max HP over 2 turns" },
                { key: "dot", name: <><Tip name="Burn" /> / <Tip name="Bleed" /></>, value: "15% of attack each turn" },
                { key: "stun", name: <Tip name="Stun" />, value: "skips the action, other debuffs stay" },
                { key: "slumber", name: <Tip name="Slumber" />, value: "skips the action until the first hit" },
              ]} />
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p><Tip name="SPD Down" /> lowers speed by <Num>30%</Num>, so everyone else acts about <Num>43%</Num> more often during those 2 turns.</p>
                <p><Tip name="Poison" /> deals <Num>5%</Num> of the target's max HP at the start of each turn and ignores defense, for <Num>10%</Num> over 2 turns. Each application is separate. Bosses are immune to it.</p>
                <p><Tip name="Burn" /> and <Tip name="Bleed" /> each deal <Num>15%</Num> of the applier's attack per turn. Defense applies, and the <Num>1.871</Num> multiplier does not. A second copy deals that amount again.</p>
                <p><Tip name="Stun" /> skips the target's action, and other debuffs on that target do not lose a turn. <Tip name="Slumber" /> does the same until the target takes a damaging hit, which removes it. Bosses are immune to both.</p>
                <p className="text-xs uppercase tracking-[0.16em] text-white/45">Damage taken, strongest to weakest</p>
              </div>
              <Rank rows={[
                { key: "atkdown", name: <Tip name="ATK Down" />, value: "that attacker's hits deal 20% less" },
                { key: "red", name: <Tip name="DMG RED" />, value: "15% less when the skill says 15%" },
                { key: "defup", name: <Tip name="DEF Up" />, value: "about 13% less at 6,000 defense" },
              ]} />
              <div className="mt-3 space-y-3 text-sm text-white/80">
                <p><Tip name="ATK Down" /> lowers that attacker's attack by <Num>20%</Num>, so each of their hits deals <Num>20%</Num> less.</p>
                <p><Tip name="DMG RED" /> cuts the hit by the percent written on the skill. <Num>15%</Num> means the hit deals <Num>85%</Num>. One that only applies to an attack on the whole team is often <Num>12%</Num>. If more than one is active, only the highest percent is used.</p>
                <p><Tip name="DEF Up" /> is not that kind of cut. It raises defense by <Num>20%</Num>, and how much damage that removes depends on the defense you already have. At about <Num>6,000</Num> defense, hits deal about <Num>13%</Num> less. At about <Num>15,000</Num> defense, they deal about <Num>15%</Num> less, the same as <Num>15%</Num> <Tip name="DMG RED" />. Above that, <Tip name="DEF Up" /> blocks more.</p>
                <p>Both can be active together. <Tip name="DEF Up" /> changes defense, and <Tip name="DMG RED" /> cuts the hit afterward.</p>
                <p><Tip name="Invincible" /> and <Tip name="Skill Nullifier" /> stop that skill hit. <Tip name="Stun" /> and <Tip name="Slumber" /> skip the action. Any of those prevents more damage than the percents above.</p>
              </div>
            </div>
          </section>
        )}

        {page === "build" && (
            <section className="rounded-3xl bg-black/35 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-2">
                  <Segmented
                    wrap
                    value={pool}
                    onChange={(id) => setPool(id as "all" | "released")}
                    options={[
                      { id: "released", label: "Currently Released" },
                      { id: "all", label: "All units" },
                    ]}
                  />
                  <Segmented
                    wrap
                    value={leaderElement}
                    onChange={setLeaderElement}
                    options={ELEMENT_CHOICES.map((id) => ({
                      id,
                      label: elementName(id),
                    }))}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {slots.map((id, index) => (
                  <div key={index} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-white/55">Slot {index + 1}</p>
                    <UnitPicker
                      value={id}
                      pool={visible}
                      onChange={(next) => setSlots((current) => current.map((item, i) => (i === index ? next : item)))}
                    />
                    <div className="mt-3 flex gap-1">
                      {[0, 1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setStars((current) => current.map((item, i) => (i === index ? star : item)))}
                          className={`h-8 flex-1 rounded-full text-xs ${
                            stars[index] === star ? "bg-ember text-ink" : "bg-white/10 text-white/70"
                          }`}
                        >
                          {star}★
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {result && (
                <div className="mt-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["Damage", result.team_damage],
                      ["Healing", result.team_heal],
                      ["Shield", result.team_shield],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-2xl bg-white/8 px-4 py-3 ring-1 ring-white/10">
                        <p className="text-xs uppercase tracking-[0.16em] text-white/55">{label}</p>
                        <p className="font-display text-3xl tabular-nums">{fmt(Number(value))}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-white/70">
                    {bossKit.name}, {fmt(bossKit.atk)} attack. Your team took {fmt(result.taken)}.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm tabular-nums">
                      <thead className="text-left text-xs uppercase tracking-wider text-white/50">
                        <tr>
                          {["Unit", "Stars", "HP", "ATK", "DEF", "SPD", "Actions", "Ults", "Damage", "Healing", "Shield"].map((head) => (
                            <th key={head} className="px-2 py-2 font-medium">{head}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.units.map((unit: any, index: number) => (
                          <tr key={unit.id} className="border-t border-white/10">
                            <td className="px-2 py-2">
                              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />
                              {unit.name}
                            </td>
                            <td className="px-2 py-2">{unit.stars}★{unit.passive ? "" : " · no passive"}</td>
                            <td className="px-2 py-2">{fmt(unit.hp)}</td>
                            <td className="px-2 py-2">{fmt(unit.atk)}</td>
                            <td className="px-2 py-2">{fmt(unit.defn)}</td>
                            <td className="px-2 py-2">{fmt(unit.spd)}</td>
                            <td className="px-2 py-2">{unit.actions}</td>
                            <td className="px-2 py-2">{unit.ults}</td>
                            <td className="px-2 py-2">{fmt(unit.damage)}</td>
                            <td className="px-2 py-2">{fmt(unit.heal)}</td>
                            <td className="px-2 py-2">{fmt(unit.shield)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <TurnChart units={result.units} />
                </div>
              )}
            </section>
        )}

        {page === "units" && (
          <section className="grid gap-4 rounded-3xl bg-black/35 p-4 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm sm:p-5 md:grid-cols-[18rem_1fr]">
            <div className={showCharacter ? "hidden md:block" : "block"}>
              <div className="mb-3 flex flex-wrap gap-2">
                <Segmented
                  wrap
                  value={pool}
                  onChange={(id) => setPool(id as "all" | "released")}
                  options={[
                    { id: "released", label: "Currently Released" },
                    { id: "all", label: "All units" },
                  ]}
                />
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search units"
                className="mb-3 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/15 placeholder:text-white/40"
              />
              <div className="max-h-[70vh] space-y-1 overflow-auto">
                {characterUnits.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => {
                      setUnitId(unit.id);
                      setUnitOrigin("list");
                      setShowCharacter(true);
                      window.setTimeout(() => characterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                    }}
                    className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left ${
                      unit.id === unitId ? "bg-ember text-ink" : "hover:bg-white/10"
                    }`}
                  >
                    <UnitFace id={unit.id} />
                    <span className="min-w-0">
                      <span className="block text-sm">
                        <RarityMark rarity={unit.rarity} onEmber={unit.id === unitId} />
                        {unit.name}
                      </span>
                      <span className={`block text-xs ${unit.id === unitId ? "text-ink/70" : "text-white/50"}`}>
                        {unit.job} · {elementName(unit.element)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {selectedUnit && (
              <div ref={characterRef} className={showCharacter ? "scroll-mt-4 block" : "hidden md:block"}>
                <button
                  type="button"
                  onClick={leaveUnit}
                  className={`mb-3 rounded-full bg-white/10 px-3 py-1.5 text-sm ring-1 ring-white/15 ${unitOrigin === "leaders" ? "" : "md:hidden"}`}
                >
                  {unitOrigin === "leaders" ? "Back to top teams" : "Back to the list"}
                </button>
                <div className="flex flex-col gap-4 sm:flex-row">
                  {(UNIT_ART.has(selectedUnit.id) || UNIT_ICONS.has(selectedUnit.id)) && (
                  <img
                    key={selectedUnit.id}
                    src={asset(UNIT_ART.has(selectedUnit.id) ? `units/${selectedUnit.id}.jpg` : `units/icons/${selectedUnit.id}.png`)}
                    alt={selectedUnit.name}
                    className={UNIT_ART.has(selectedUnit.id) ? "w-full rounded-2xl object-contain sm:w-72" : "h-40 w-40 rounded-2xl object-cover"}
                  />
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="flex items-center gap-2 font-display text-3xl">
                      <RarityMark rarity={selectedUnit.rarity} />
                      {selectedUnit.name}
                    </h2>
                    <p className="text-sm text-white/65">{selectedUnit.job} · {elementName(selectedUnit.element)}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {[
                        ["HP", selectedUnit.hp],
                        ["Attack", selectedUnit.atk],
                        ["Defense", selectedUnit.defn],
                        ["Speed", selectedUnit.spd],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-2xl bg-white/8 px-3 py-3 ring-1 ring-white/10">
                          <p className="text-xs uppercase tracking-[0.16em] text-white/55">{label}</p>
                          <p className="font-display text-2xl tabular-nums">{fmt(Number(value))}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {selectedUnit.skills.map((skill) => {
                    const attack = attackPercent(selectedUnit.id, skill.name);
                    const cooldown = skillCooldown(selectedUnit.id, skill.name, skill.lines, skill.meta);
                    return (
                    <article key={skill.name} className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
                      <h3 className="font-display text-xl">
                        {skill.name}
                        {attack && <span className="text-white/65"> ({attack})</span>}
                      </h3>
                      {skill.meta && <p className="text-sm text-white/60">{skill.meta}</p>}
                      {cooldown && <p className="text-sm text-white/60">{cooldown}</p>}
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/85">
                        {annotateSkill(
                          selectedUnit.id,
                          skill.name,
                          skill.lines.filter((line) => !(attack && /^\d+(\.\d+)?% attack\b/.test(line))),
                        ).map((line) => (
                          <li key={line}><SkillLine line={line.replace(/every(\d+)/g, "every $1")} /></li>
                        ))}
                      </ul>
                    </article>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
