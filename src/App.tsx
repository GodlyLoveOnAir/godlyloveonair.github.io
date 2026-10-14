import { useEffect, useMemo, useRef, useState } from "react";
import { bosses, leaders, roster, simulate } from "./fight";

type Unit = {
  id: string;
  name: string;
  job: string;
  element: string;
  portrait: boolean;
  hp: number;
  atk: number;
  defn: number;
  spd: number;
  skills: { name: string; meta: string; lines: string[] }[];
};

const units = roster as Unit[];
const byId = new Map(units.map((unit) => [unit.id, unit]));

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function asset(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

function bossLabel(name: string) {
  return name === "Plain" || name === "plain" ? "Neutral" : name;
}

const LINE_COLORS = ["#e8a06a", "#7dcea0", "#8eb4e8", "#e2b0ea"];

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

function UnitFace({ id }: { id: string }) {
  if (!UNIT_ART.has(id)) return null;
  return (
    <img
      src={asset(`units/${id}.jpg`)}
      alt=""
      className="h-11 w-11 shrink-0 rounded-lg object-cover object-top"
    />
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-black/40 p-1 ring-1 ring-white/15">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-full px-3.5 py-1.5 text-sm transition ${
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
    const hay = `${unit.name} ${unit.job} ${unit.element} ${unit.id}`.toLowerCase();
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
            <span className="block text-sm">{selected ? selected.name : "Pick a unit"}</span>
            <span className="block text-xs text-white/60">{selected ? `${selected.job} · ${selected.element}` : "None yet"}</span>
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
                  <span className="block text-sm">{unit.name}</span>
                  <span className="block text-xs text-white/50">{unit.job} · {unit.element}</span>
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
  const [view, setView] = useState<"build" | "leaders" | "units">("build");
  const [pool, setPool] = useState<"all" | "released">("released");
  const [leaderN, setLeaderN] = useState<"1" | "3">("1");
  const [enemyN, setEnemyN] = useState(1);
  const bossId = "plain";
  const [slots, setSlots] = useState(["", "", "", ""]);
  const [stars, setStars] = useState([5, 5, 5, 5]);
  const [unitId, setUnitId] = useState(units.find((unit) => unit.portrait)?.id || units[0]?.id || "");
  const [search, setSearch] = useState("");

  const page = view === "leaders" || view === "units" ? view : "build";
  useEffect(() => {
    document.title = "Godly Love: On Air";
  }, []);
  const visible = useMemo(
    () => (pool === "released" ? units.filter((unit) => unit.portrait) : units),
    [pool],
  );
  const board = (leaders as any)[pool]?.[leaderN] || [];
  const result = useMemo(() => {
    if (!slots.some(Boolean)) return null;
    return simulate(slots, stars, enemyN, bossId);
  }, [slots, stars, enemyN, bossId]);

  const selectedUnit = units.find((unit) => unit.id === unitId);
  const filteredUnits = visible.filter((unit) =>
    `${unit.name} ${unit.job} ${unit.element} ${unit.id}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function loadTeam(row: any) {
    const next = ["", "", "", ""];
    const nextStars = [5, 5, 5, 5];
    row.units.forEach((unit: { id: string }, index: number) => {
      next[index] = unit.id;
    });
    setSlots(next);
    setStars(nextStars);
    setEnemyN(Number(leaderN));
    setView("build");
  }

  return (
    <div className="relative min-h-screen">
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${asset("fireflies.jpg")})` }}
        aria-hidden
      />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-black/45 px-5 py-4 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl">
          <div>
            <h1 className="font-display text-3xl font-medium text-ember">Godly Love: On Air</h1>
            {page === "build" && (
              <p className="mt-1 max-w-xl text-sm text-white/60">
                Level 80 units. The boss is the level 100 {bossLabel(bossId).toLowerCase()} one: {fmt((bosses[bossId] || bosses.plain).hp)} HP, {fmt((bosses[bossId] || bosses.plain).atk)} attack, {fmt((bosses[bossId] || bosses.plain).defn)} defense, {fmt((bosses[bossId] || bosses.plain).spd)} speed.
              </p>
            )}
            {page === "leaders" && (
              <p className="mt-1 max-w-xl text-sm text-white/60">
                Neutral boss, but every unit is 5 stars and the fight lasts 30 of the boss's turns. The number is average damage over 8 tries, and a team only shows up if nobody died. Fastest unit is in the first slot. One enemy and three enemies are separate lists.
              </p>
            )}
          </div>
          <Segmented
            value={page}
            onChange={(id) => setView(id as "build" | "leaders" | "units")}
            options={[
              { id: "build", label: "Damage calculator" },
              { id: "leaders", label: "Top teams" },
              { id: "units", label: "Characters" },
            ]}
          />
        </header>

        {page === "leaders" && (
            <section className="rounded-3xl bg-black/50 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-2xl">Top teams</h2>
                <div className="flex flex-wrap gap-2">
                  <Segmented
                    value={pool}
                    onChange={(id) => setPool(id as "all" | "released")}
                    options={[
                      { id: "released", label: "Released" },
                      { id: "all", label: "All units" },
                    ]}
                  />
                  <Segmented
                    value={leaderN}
                    onChange={(id) => setLeaderN(id as "1" | "3")}
                    options={[
                      { id: "1", label: "1 enemy" },
                      { id: "3", label: "3 enemies" },
                    ]}
                  />
                </div>
              </div>
              <ol className="mt-4 grid gap-2">
                {board.map((row: any) => (
                  <li key={row.rank}>
                    <button
                      type="button"
                      onClick={() => loadTeam(row)}
                      className="grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-2xl bg-white/8 px-3 py-3 text-left ring-1 ring-white/10 transition hover:bg-white/15"
                    >
                      <span className="font-display text-lg text-ember">{row.rank}</span>
                      <span className="text-sm">
                        {row.units.map((unit: { name: string; job: string }) => unit.name).join("  ·  ")}
                      </span>
                      <span className="text-right">
                        <span className="block font-medium tabular-nums">{fmt(row.damage)}</span>
                        <span className="block text-xs text-white/55">took {fmt(row.taken)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
        )}

        {page === "build" && (
            <section className="rounded-3xl bg-black/50 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-2">
                  <Segmented
                    value={pool}
                    onChange={(id) => setPool(id as "all" | "released")}
                    options={[
                      { id: "released", label: "Released" },
                      { id: "all", label: "All units" },
                    ]}
                  />
                  <Segmented
                    value={String(enemyN)}
                    onChange={(id) => setEnemyN(Number(id))}
                    options={[
                      { id: "1", label: "1 enemy" },
                      { id: "3", label: "3 enemies" },
                    ]}
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
                      {[1, 2, 3, 4, 5].map((star) => (
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
                    {result.enemies > 1
                      ? `Three ${bossLabel(result.boss.name).toLowerCase()} bosses`
                      : `${bossLabel(result.boss.name)} boss`}
                    , {fmt(result.boss.atk)} attack. Your team took {fmt(result.taken)}.
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
          <section className="grid gap-4 rounded-3xl bg-black/50 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl md:grid-cols-[18rem_1fr]">
            <div>
              <div className="mb-3">
                <Segmented
                  value={pool}
                  onChange={(id) => setPool(id as "all" | "released")}
                  options={[
                    { id: "released", label: "Released" },
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
                {filteredUnits.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setUnitId(unit.id)}
                    className={`block w-full rounded-2xl px-3 py-2 text-left ${
                      unit.id === unitId ? "bg-ember text-ink" : "hover:bg-white/10"
                    }`}
                  >
                    <span className="block text-sm">{unit.name}</span>
                    <span className={`block text-xs ${unit.id === unitId ? "text-ink/70" : "text-white/50"}`}>
                      {unit.job} · {unit.element}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {selectedUnit && (
              <div>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <img
                    key={selectedUnit.id}
                    src={asset(`units/${selectedUnit.id}.jpg`)}
                    alt={selectedUnit.name}
                    className="w-full rounded-2xl object-contain sm:w-72"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-3xl">{selectedUnit.name}</h2>
                    <p className="text-sm text-white/65">{selectedUnit.job} · {selectedUnit.element}</p>
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
                  {selectedUnit.skills.map((skill) => (
                    <article key={skill.name} className="rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
                      <h3 className="font-display text-xl">{skill.name}</h3>
                      {skill.meta && <p className="text-sm text-white/60">{skill.meta}</p>}
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/85">
                        {skill.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
