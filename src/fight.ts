import { PyRandom } from "./random";

const data = (window as unknown as { __KAMI: any }).__KAMI;
const TURNS = 30;
const RUNS = 8;
const ATTACK_POWER_RATE = 1.871;
const DODGE_DAMAGE = 0.75;
const K = 2000;
const CURVE_SPD = 2000;
const f32 = Math.fround;
const BOSS_HP = 27600;
const BASE_CRIT = 0.15;
const BASE_CDMG = 1.3;
const BIG_HIT_RATE = 0.25;
const CONQUER_BIG_HIT = 0.25;
const BIG_HIT_ATTACK = 1.15;
const PINCH_RATE = 0.03;
const CONQUER_CRIT = 0.15;
const CONQUER_DODGE = 0.5;
const BUILTIN_RESIST = 0.1;
const HEAL_HOLD = 0.8;
const ELITE_BASE = { hp: 20250, atk: 2734, defn: 6952, spd: 2700 };
const TRIAL_STACK = 0.15;
const TRIAL_IMMUNE = new Set(["Silence", "Stun", "Taunt", "TargetTaunt", "Sleep", "Poison"]);
const TRIAL_BASE = { hp: 31050, atk: 4050, defn: 10112, spd: 3200 };
const TRIAL_KIT: Record<string, { id: string; stage: number; hp: number; atk: number; defn: number; spd: number }> = {
  Ice: { id: "C01_SSR_002", stage: 47, hp: 1.075, atk: 1.17, defn: 1.06, spd: 1.09 },
  Fire: { id: "C02_SSR_001", stage: 48, hp: 1.025, atk: 0.7, defn: 1.06, spd: 1.23 },
  Earth: { id: "C03_SSR_002", stage: 49, hp: 1.05, atk: 0.81, defn: 0.901, spd: 1.16 },
  Ground: { id: "C04_SSR_002", stage: 50, hp: 1.025, atk: 0.725, defn: 0.85, spd: 1.13 },
};
const UTILITY = new Set(["Immune", "Taunt", "Stealth", "Invincible", "SkillNullifier", "Shield", "Counterattack"]);

type Buff = { fid: string; mag: number; rounds: number; payload: Record<string, any> };
type AnyRec = Record<string, any>;

const EMPTY_STATUS: AnyRec = { buff: false, typed: false, mods: {}, hit: 0, maxStack: 0, resident: false, keep: false, immortal: false, aura: false, inStat: false, rounds: 2, life: [], shown: false };

function statusOf(fid: string): AnyRec {
  return data.statuses[fid] || EMPTY_STATUS;
}

function isDebuff(fid: string): boolean {
  const row = statusOf(fid);
  if (row.buff) return false;
  const mods = row.mods || {};
  if (["atk", "defn", "spd", "crit", "cdmg"].some((key) => (mods[key] || 0) > 0)) return false;
  if (UTILITY.has(fid)) return false;
  return true;
}

function has(buffs: Buff[], fid: string) {
  return buffs.some((b) => b.fid === fid);
}

function buffCount(buffs: Buff[]) {
  return buffs.reduce((n, b) => n + (statusOf(b.fid).buff ? 1 : 0), 0);
}

// Trial/AttackStack are typed buff:false (resident, uncleansable) but live shows them as
// ATK Up and Fearless passive gates AoE basic on "any buffs" — count them for that gate.
function bossSkillBuffed(buffs: Buff[]) {
  if (buffCount(buffs) >= 1) return true;
  return buffs.some((b) => /AttackStack/.test(b.fid));
}

function oldBuffCount(holder: AnyRec) {
  return (holder.buffs as Buff[]).reduce((n, b) => n + (statusOf(b.fid).shown ? 1 : 0), 0);
}

function debuffN(holder: AnyRec) {
  const n = (holder.buffs as Buff[]).reduce((sum, b) => sum + (isDebuff(b.fid) ? 1 : 0), 0);
  return n + (holder.dots?.length || 0);
}

function cmp(op: string, left: number, right: number) {
  if (op === "eq") return left === right;
  if (op === "ne") return left !== right;
  if (op === "lt") return left < right;
  if (op === "lte") return left <= right;
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  return false;
}

function meets(need: AnyRec | null, unit: AnyRec | null) {
  if (!need || !unit) return false;
  if (need.kind === "have") return has(unit.buffs || [], need.fid);
  if (need.kind === "have_any") return (need.fids || []).some((fid: string) => has(unit.buffs || [], fid));
  let n: number;
  if (need.prop === "buff") n = buffCount(unit.buffs || []);
  else if (need.prop === "statuses") n = oldBuffCount(unit);
  else n = debuffN(unit);
  return cmp(need.op, n, need.n);
}

function needOk(need: AnyRec | null, caster: AnyRec, subject: any, allies: AnyRec[]) {
  if (!need) return true;
  const who = need.who;
  if (need.prop === "camp_debuff") {
    let pool: AnyRec[];
    if (who === "any_ally" || who === "caster") pool = allies.filter((a) => (a.hp ?? 1) > 0);
    else if (Array.isArray(subject)) pool = subject.filter(Boolean);
    else pool = subject != null ? [subject] : [];
    return cmp(need.op, pool.reduce((s, u) => s + debuffN(u), 0), need.n);
  }
  if (who === "target" || who === "any_enemy") {
    const pool = Array.isArray(subject) ? subject : subject != null ? [subject] : [];
    return pool.some((one) => meets(need, one));
  }
  if (who === "any_ally") return allies.some((a) => a.hp > 0 && meets(need, a));
  return meets(need, caster);
}

function snapshotNeeds(ally: AnyRec, sk: AnyRec, targets: AnyRec[], allies: AnyRec[]) {
  const snap = new Map<string, boolean>();
  for (const key of ["heals", "shields", "cleanses", "statuses", "pushes"]) {
    (sk[key] || []).forEach((entry: AnyRec, i: number) => {
      if (entry.need && entry.need.who !== "target") snap.set(`${key}:${i}`, needOk(entry.need, ally, targets, allies));
    });
  }
  return snap;
}

function entryOk(snap: Map<string, boolean>, key: string, i: number, entry: AnyRec, ally: AnyRec, subject: any, allies: AnyRec[]) {
  const mark = `${key}:${i}`;
  if (snap.has(mark)) return snap.get(mark);
  return needOk(entry.need, ally, subject, allies);
}

function magSum(list: Buff[], key: string) {
  let total = 0;
  for (const b of list) {
    const spec = statusOf(b.fid).mods || {};
    const stacks = Number((b.payload || {}).stacks || 1);
    if (key in spec) {
      const scale = b.mag <= 1 ? b.mag : 1;
      total += spec[key] * scale * stacks;
    } else if (b.payload && key in b.payload && key !== "stacks") {
      total += b.payload[key];
    }
  }
  return total;
}

function hitMod(buffs: Buff[]) {
  return buffs.reduce((n, b) => n + (statusOf(b.fid).hit || 0), 0);
}

function defnSplit(buffs: Buff[]) {
  let up = 0;
  let down = 0;
  for (const buff of buffs || []) {
    let val = statusOf(buff.fid).mods?.defn || 0;
    if (!val) continue;
    const stacks = Number((buff.payload || {}).stacks || 1);
    const scale = buff.mag <= 1 ? buff.mag : 1;
    val *= scale * stacks;
    if (val >= 0) up += val;
    else down += -val;
  }
  return [up, Math.min(0.75, down)] as const;
}

function roundEven(n: number) {
  if (!Number.isFinite(n)) return 0;
  const lo = Math.floor(n);
  const d = n - lo;
  if (d < 0.5) return lo;
  if (d > 0.5) return lo + 1;
  return lo % 2 === 0 ? lo : lo + 1;
}

function reductionMultiplier(cuts: number[]) {
  const positives = cuts.filter((x) => x >= 0);
  const negatives = cuts.filter((x) => x < 0);
  const positive = Math.max(0, ...positives);
  const negative = negatives.reduce((a, b) => f32(a + b), 0);
  return f32(1 - f32(positive + negative));
}

function defenceRateOf(buffs: Buff[]) {
  const [up, shred] = defnSplit(buffs);
  return (1 + up) * (1 - shred);
}

// Client BattleCalculator order: trunc attack and defense, float32 at each step,
// three pierce remainders with anti-pierce, then half-to-even on the integer.
function rawSkillValue(p: {
  attack: number;
  attRate: number;
  defence: number;
  defenceRate: number;
  penetrations: number[];
  antiPenetrate?: number;
  attackPowerRate: number;
  conditionMultiplier: number;
  conquerMultiplier: number;
}, hit = 1) {
  const anti = Math.max(0, f32(1 - (p.antiPenetrate || 0)));
  const rem = [0, 1, 2].map((i) => Math.max(0, f32(1 - f32(f32(p.penetrations[i] || 0) * anti))));
  let attack = f32(f32(p.attRate || 0) * f32(Math.trunc(p.attack || 0)));
  let defence = f32(f32(p.defenceRate) * f32(Math.trunc(p.defence || 0)));
  defence = f32(defence * rem[0]);
  const pow = f32(f32(p.attackPowerRate) * f32(1));
  attack = f32(attack);
  defence = f32(defence * rem[1]);
  attack = f32(attack * pow);
  attack = f32(f32(p.conditionMultiplier) * attack);
  defence = f32(defence * rem[2]);
  attack = f32(f32(p.conquerMultiplier) * attack);
  const numerator = f32(f32(hit) * attack);
  const denominator = f32(f32(defence / f32(K)) + 1);
  return f32(numerator / denominator);
}

export function directDamage(
  attack: number,
  defense: number,
  mult = 1,
  extra: {
    rate?: number;
    power?: number;
    cond?: number;
    conquer?: number;
    pens?: Record<number, number>;
    buffs?: Buff[];
    cuts?: number[];
    stealth?: boolean;
    antiPenetrate?: number;
  } = {},
) {
  const buffs = extra.buffs || [];
  const vuln = Math.max(0, magSum(buffs, "vuln"));
  const cuts = [...(extra.cuts || [])];
  if (vuln > 0) cuts.push(-vuln);
  const pens = extra.pens || {};
  let value = rawSkillValue({
    attack,
    attRate: extra.rate ?? 1,
    defence: defense,
    defenceRate: defenceRateOf(buffs),
    penetrations: [pens[1] || 0, pens[2] || 0, pens[3] || 0],
    antiPenetrate: extra.antiPenetrate,
    attackPowerRate: extra.power ?? ATTACK_POWER_RATE,
    conditionMultiplier: extra.cond ?? 1,
    conquerMultiplier: extra.conquer ?? 1,
  }, mult);
  value = f32(value * reductionMultiplier(cuts));
  if (extra.stealth) value = f32(value * f32(0.5));
  return Math.max(0, roundEven(value));
}

export function dotDamage(snapshot: number, defense: number, buffs: Buff[] = []) {
  const rate = f32(defenceRateOf(buffs));
  const scaled = f32(f32(f32(Math.trunc(defense)) * rate) * f32(0.3));
  let amount = f32(f32(f32(snapshot) * f32(ATTACK_POWER_RATE)) / f32(1 + f32(scaled / 2000)));
  const vuln = Math.max(0, magSum(buffs, "vuln"));
  amount = f32(amount * reductionMultiplier(vuln > 0 ? [-vuln] : []));
  return Math.max(0, roundEven(amount));
}

function spd(base: number, buffs: Buff[]) {
  return Math.max(200, base * (1 + Math.max(-0.8, magSum(buffs, "spd"))));
}

function clearStat(holder: AnyRec, key: "spd" | "defn") {
  const bonus = holder.clear_bonus;
  if (!bonus || debuffN(holder) > 0) return holder[key];
  return holder[key] * (1 + (bonus[key] || 0));
}

function rollLabel(mult: number) {
  if (mult >= BASE_CDMG - 0.001) return "crit";
  if (Math.abs(mult - BIG_HIT_ATTACK) < 0.001) return "big hit";
  if (Math.abs(mult - DODGE_DAMAGE) < 0.001) return "glancing";
  return "normal";
}

function hitRoll(rng: PyRandom, dodge: number, bonus = 0, critAdd = 0, cdmgAdd = 0, resist = 0, advantage = false) {
  if (rng.random() <= dodge) return { mult: DODGE_DAMAGE, crit: false };
  const cr = Math.min(1, Math.max(0, BASE_CRIT + bonus + critAdd - resist));
  if (rng.random() < cr) return { mult: BASE_CDMG + cdmgAdd, crit: true };
  if (rng.random() < (advantage ? CONQUER_BIG_HIT : BIG_HIT_RATE)) return { mult: BIG_HIT_ATTACK, crit: false };
  return { mult: 1, crit: false };
}

function dodgeChance(attacker: Buff[], target: Buff[]) {
  return magSum(target, "eva") - hitMod(attacker);
}

function effectGate(resist: number, hit = 0) {
  const threshold = f32(f32(1 + f32(hit || 0)) - f32(resist || 0));
  const cap = f32(1 - f32(BUILTIN_RESIST));
  return Math.max(0, Math.min(1, Math.min(threshold, cap)));
}

const BEATS: Record<string, string> = { Fire: "Earth", Earth: "Ground", Ground: "Ice", Ice: "Fire" };

function elementEdge(attacker: string | undefined, target: string | undefined) {
  if (!attacker || !target) return 0;
  if (BEATS[attacker] === target) return 1;
  if (BEATS[target] === attacker) return -1;
  return 0;
}

function upsert(list: Buff[], fid: string, mag: number, rounds: number, payload?: AnyRec) {
  for (const b of list) {
    if (b.fid === fid) {
      b.mag = mag;
      b.rounds = Math.max(b.rounds, rounds);
      b.payload = payload || b.payload;
      return;
    }
  }
  list.push({ fid, mag, rounds, payload: payload || {} });
}

function gainShield(who: AnyRec, amount: number, rounds?: number) {
  if (!(amount > 0)) return 0;
  const lasting = (rounds || 0) > 0 ? Math.round(rounds as number) : 2;
  const gained = f32(amount);
  if (!who.shield_layers) who.shield_layers = [];
  who.shield_hp = (who.shield_hp || 0) + gained;
  who.shield_layers.push({ left: gained, rounds: lasting, fresh: !!who.ending });
  return gained;
}

function absorbShield(who: AnyRec, amount: number) {
  if (!(amount > 0)) return 0;
  const layers = who.shield_layers || [];
  const layer = layers[0];
  if (!layer) return 0;
  let absorbed: number;
  if (layer.left < amount) {
    absorbed = roundEven(layer.left);
    layers.shift();
  } else {
    absorbed = amount;
    layer.left = f32(layer.left - amount);
    if (layer.left <= 0) layers.shift();
  }
  who.shield_layers = layers;
  who.shield_hp = Math.max(0, (who.shield_hp || 0) - absorbed);
  return absorbed;
}

function tickShields(who: AnyRec) {
  const kept: { left: number; rounds: number; fresh: boolean }[] = [];
  let drop = 0;
  for (const layer of who.shield_layers || []) {
    if (layer.fresh) {
      layer.fresh = false;
      kept.push(layer);
      continue;
    }
    layer.rounds -= 1;
    if (layer.rounds > 0) kept.push(layer);
    else drop += layer.left;
  }
  who.shield_layers = kept;
  if (drop > 0) who.shield_hp = Math.max(0, who.shield_hp - drop);
}

function damages(fid: string) {
  return Boolean(statusOf(fid).dot) || fid === "Bomb";
}

function keepOne(buffs: Buff[], fid: string, rounds: number, fresh: Set<string> | null) {
  const existing = buffs.find((buff) => buff.fid === fid);
  if (existing) {
    const raises = existing.rounds >= 0 && (rounds < 0 || rounds > existing.rounds);
    if (raises) {
      existing.rounds = rounds;
      if (fresh) fresh.add(fid);
    }
    return;
  }
  buffs.push({ fid, mag: 1, rounds, payload: {} });
  if (fresh) fresh.add(fid);
}

function give(buffs: Buff[], st: AnyRec, fresh: Set<string> | null) {
  const row = statusOf(st.fid);
  if (row.buff && has(buffs, "CannotBuff")) return;
  if (row === EMPTY_STATUS) return;
  let rounds: number;
  if (st.fid === "SkillNullifier") rounds = 99;
  else if ((st.rounds || 0) > 0) rounds = st.rounds;
  else if ((st.rounds || 0) < 0 || row.resident) rounds = -1;
  else rounds = st.rounds || row.rounds || 2;
  if (damages(st.fid)) {
    buffs.push({ fid: st.fid, mag: 1, rounds, payload: { ...(st.payload || {}), fresh: true } });
    return;
  }
  // ContinuousHeal is a normal buff (maxStack 0): refresh duration, do not pile copies.
  const maxStack = Number(row.maxStack || 0);
  const add = Math.max(1, Number(st.count) || 1);
  if (maxStack > 0) {
    const existing = buffs.find((buff) => buff.fid === st.fid);
    if (existing) {
      const cur = Number((existing.payload || {}).stacks || existing.mag || 1);
      existing.payload = { ...(existing.payload || {}), stacks: Math.min(maxStack, cur + add) };
      existing.mag = 1;
      existing.rounds = rounds;
      if (fresh) fresh.add(st.fid);
      return;
    }
    buffs.push({ fid: st.fid, mag: 1, rounds, payload: { ...(st.payload || {}), stacks: Math.min(maxStack, add) } });
    if (fresh) fresh.add(st.fid);
    return;
  }
  keepOne(buffs, st.fid, rounds, fresh);
}

function stackFidFor(rate: number) {
  if (!(rate > 0)) return "";
  return rate >= 0.14 ? "Trial_AttackStack_2" : "AttackStack";
}

function stripBuffs(holder: AnyRec, count: number) {
  let removed = 0;
  const kept: Buff[] = [];
  const limit = count < 0 ? null : count;
  for (const b of holder.buffs as Buff[]) {
    const row = statusOf(b.fid);
    const removable = row.buff && !row.resident && b.rounds >= 0;
    if (removable && (limit == null || removed < limit)) {
      removed++;
      continue;
    }
    kept.push(b);
  }
  holder.buffs = kept;
}

function wakeSleep(holder: AnyRec) {
  if (!has(holder.buffs, "Sleep")) return;
  holder.buffs = (holder.buffs as Buff[]).filter((b) => b.fid !== "Sleep");
}

function breakStealth(holder: AnyRec) {
  if (!has(holder.buffs, "Stealth")) return;
  holder.buffs = (holder.buffs as Buff[]).filter((b) => b.fid !== "Stealth" || b.rounds < 0);
}

function passRound(holder: AnyRec) {
  const kept: Buff[] = [];
  for (const b of holder.buffs as Buff[]) {
    if (b.fid !== "Stun" && b.fid !== "Sleep") {
      kept.push(b);
      continue;
    }
    b.rounds -= 1;
    if (b.rounds > 0) kept.push(b);
  }
  holder.buffs = kept;
}

function stripDebuffs(holder: AnyRec, count: number) {
  let removed = 0;
  const kept: Buff[] = [];
  const limit = count < 0 ? null : count;
  for (const b of holder.buffs as Buff[]) {
    if (isDebuff(b.fid) && (limit == null || removed < limit)) {
      removed++;
      continue;
    }
    kept.push(b);
  }
  holder.buffs = kept;
  if (holder.dots?.length && (limit == null || removed < (limit || 0))) {
    if (limit == null) {
      removed += holder.dots.length;
      holder.dots = [];
    } else {
      const take = Math.min(holder.dots.length, limit - removed);
      holder.dots.splice(0, take);
      removed += take;
    }
  }
  holder.cleansed = removed;
}

function hpStat(ally: AnyRec, stat: string) {
  const cap = ally.hp_max || 0;
  const rate = cap ? ally.hp / cap : 1;
  let total = 0;
  for (const mod of ally.unit.hp_mods || []) {
    if (mod.stat !== stat) continue;
    const ok = mod.cmp === "gt" ? rate > mod.at : rate <= mod.at;
    if (ok) total += mod.value;
  }
  return total;
}

function allyDef(ally: AnyRec) {
  return ally.unit.defn * (1 + hpStat(ally, "def"));
}

function atkOf(ally: AnyRec) {
  return ally.unit.atk * (1 + ally.unit.perm_atk + hpStat(ally, "atk") + magSum(ally.buffs, "atk"));
}

function debuffed(holder: AnyRec) {
  if (holder.dots?.length) return true;
  return (holder.buffs as Buff[]).some((buff) => {
    const row = statusOf(buff.fid);
    return row.typed && !row.buff;
  });
}

function gateOk(gate: any, selectDied: boolean, hpBefore: number, ally: AnyRec) {
  if (gate == null) return true;
  if (gate === "skip" || gate === "start" || gate === "after_round" || gate === "before_round") return false;
  if (gate === "kill") return selectDied;
  if (Array.isArray(gate) && gate[0] === "nouse") return (ally.used[gate[1]] || 0) === 0;
  if (Array.isArray(gate) && gate[0] === "low") {
    const cap = ally.boss_hp || BOSS_HP;
    return cap > 0 && hpBefore / cap < gate[1];
  }
  if (Array.isArray(gate) && gate[0] === "ally_low") {
    const team = ally.team || [ally];
    return team.some((a: AnyRec) => a.hp > 0 && a.hp_max > 0 && a.hp / a.hp_max < gate[1]);
  }
  return true;
}

function alliesFor(caster: AnyRec, aim: string, allies: AnyRec[]) {
  const living = allies.filter((a) => a.hp > 0);
  if (aim === "self" || !living.length) return [caster];
  if (aim === "lowest") return [living.reduce((best, a) => (a.hp / a.hp_max < best.hp / best.hp_max ? a : best))];
  if (aim === "lowest2") return living.slice().sort((a, b) => a.hp / a.hp_max - b.hp / b.hp_max).slice(0, 2);
  if (aim === "highest") return highestAtk(caster, living, false);
  if (aim === "allies" || aim === "") return living;
  return [];
}

function highestAtk(caster: AnyRec, allies: AnyRec[], noself: boolean) {
  const pool = allies.filter((a) => a.hp > 0 && (!noself || a !== caster));
  if (!pool.length) return [];
  return [pool.reduce((best, a) => (a.unit.atk > best.unit.atk ? a : best))];
}

function dotPlant(enemy: AnyRec, st: AnyRec, atk: number, ally: AnyRec) {
  const spec = statusOf(st.fid);
  const raw = spec.dot === "poison" ? (enemy.hp_max || 0) * 0.05 * st.count : f32(atk * (st.dot_rate ?? 0.15) * st.count);
  enemy.dots.push({ fid: st.fid, raw, rounds: st.rounds || 2, kind: spec.dot, owner: ally.unit.id });
}

function numMap(src: AnyRec | undefined) {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const [ch, val] of Object.entries(src || {})) out[Number(ch)] = (out[Number(ch)] || 0) + Number(val);
  return out;
}

export function trialBoss(element = "") {
  const kit = TRIAL_KIT[element];
  if (!kit) return null;
  const plain = data.bosses.plain;
  const unit = data.units[kit.id]?.["5"];
  return {
    id: kit.id,
    stage: kit.stage,
    name: unit?.name || kit.id,
    hp: TRIAL_BASE.hp * kit.hp,
    atk: TRIAL_BASE.atk * kit.atk,
    defn: TRIAL_BASE.defn * kit.defn,
    spd: TRIAL_BASE.spd * kit.spd,
    stack: TRIAL_STACK,
  };
}

export function fightOnce(units: AnyRec[], nEnemies: number, rng: PyRandom, bossId = "plain", stopOnDeath = false, element = "", endOnKill = false, turnCap = TURNS, giveUp?: { rounds?: number; taken?: number; actions?: number }, hpScale = 1, trace?: string[], foes?: AnyRec[]) {
  const boss = data.bosses[bossId] || data.bosses.plain;
  const trial = TRIAL_KIT[element];
  const trialUnit = trial ? data.units[trial.id]?.["5"] : null;
  const bossHp = (trial ? TRIAL_BASE.hp * trial.hp : boss.hp) * hpScale;
  const allies = units.map((unit) => ({
    unit,
    hp: unit.hp,
    hp_max: unit.hp,
    g: 0,
    buffs: [] as Buff[],
    cd: 0,
    fresh: new Set<string>(),
    proc_cd: (unit.basic_procs || []).map(() => 0),
    react_cd: {} as Record<string, number>,
    timed_cd: {} as Record<string, number>,
    damage: 0,
    heal: 0,
    shield: 0,
    shield_hp: 0,
    shield_layers: [] as { left: number; rounds: number; fresh: boolean }[],
    ending: false,
    taken: 0,
    dots: [] as AnyRec[],
    actions: 0,
    ults: 0,
    turns: Array(TURNS).fill(0),
    heal_turns: Array(TURNS).fill(0),
    shield_turns: Array(TURNS).fill(0),
    used: {} as Record<string, number>,
    cleansed: 0,
    team: [] as AnyRec[],
    boss_hp: bossHp,
  }));
  for (const ally of allies) ally.g = Math.floor(rng.random() * 5) / 100;
  let lost = false;
  const noteLoss = (ally: AnyRec) => {
    if (stopOnDeath && ally.hp <= 0) lost = true;
    if (endOnKill && allies.every((other) => other.hp <= 0)) lost = true;
  };
  for (const ally of allies) {
    ally.team = allies;
    for (const st of ally.unit.start_statuses || []) {
      if (rng.random() < (st.chance < 0.999 ? st.chance : 1)) give(ally.buffs, st, ally.fresh);
    }
    for (const push of ally.unit.start_pushes || []) {
      if ((push.value || 0) <= 0 || !["self", "hit", "allies"].includes(push.aim || push.side)) continue;
      if (!needOk(push.need, ally, null, allies)) continue;
      ally.g = Math.min(0.99, ally.g + push.value);
    }
  }

  const makeEnemy = (over: AnyRec = {}) => {
    const sheet = over.sheet || null;
    const hp = over.hp != null ? over.hp : bossHp;
    return {
      hp,
      hp_max: hp,
      g: 0,
      buffs: [] as Buff[],
      fresh: new Set<string>(),
      dots: [] as AnyRec[],
      kills: 0,
      atk: over.atk != null ? over.atk : trial ? TRIAL_BASE.atk * trial.atk : boss.atk,
      defn: over.defn != null ? over.defn : trial ? TRIAL_BASE.defn * trial.defn : boss.defn,
      spd: over.spd != null ? over.spd : trial ? TRIAL_BASE.spd * trial.spd : boss.spd,
      hurt: over.hurt != null ? over.hurt : boss.hurt,
      stack_rate: over.stack_rate != null ? over.stack_rate : trial ? TRIAL_STACK : boss.stack_rate,
      stack_fid: over.stack_fid != null ? over.stack_fid : trial ? "Trial_AttackStack_2" : stackFidFor(over.stack_rate != null ? over.stack_rate : boss.stack_rate),
      stacks: 0,
      shield_hp: 0,
      shield_layers: [] as { left: number; rounds: number; fresh: boolean }[],
      ending: false,
      basic: sheet ? sheet.basic : trialUnit?.basic || boss.basic,
      ult: sheet ? sheet.ult || null : trial ? trialUnit?.ult || null : boss.ult,
      cd: over.cd != null ? over.cd : trial || sheet ? 0 : boss.cd,
      buff_basic: sheet ? sheet.buff_basic || null : trialUnit?.buff_basic || null,
      basic_pen_ch: sheet ? sheet.basic_pen_ch || null : trialUnit?.basic_pen_ch || null,
      adds: sheet ? sheet.adds || null : trialUnit?.adds || null,
      procs: sheet ? sheet.basic_procs || null : trialUnit?.basic_procs || null,
      proc_cd: ((sheet ? sheet.basic_procs : trialUnit?.basic_procs) || []).map(() => 0),
      timed: sheet ? sheet.timed || null : trialUnit?.timed || null,
      life: sheet ? sheet.life || null : trialUnit?.life || null,
      timed_cd: {} as Record<string, number>,
      name: over.name || "",
      single_hurt: over.single_hurt || 0,
      clear_bonus: over.clear_bonus || null,
      el: over.el || element,
      immune: over.immune !== undefined ? over.immune : trial ? TRIAL_IMMUNE : null,
      debuff_res: over.debuff_res !== undefined ? over.debuff_res : trial ? 0.1 : null,
      boss: over.boss !== undefined ? over.boss : true,
      front_row: over.front_row !== undefined ? over.front_row : !!trial,
      ult_needs_debuffs: !!over.ult_needs_debuffs,
    };
  };
  const enemies = foes?.length
    ? foes.map((over) => makeEnemy(over))
    : Array.from({ length: nEnemies }, () => makeEnemy(trial && element === "Ice" ? { ult_needs_debuffs: true } : {}));
  if (!foes?.length && trial && element === "Ground" && nEnemies === 1) {
    const add = data.units.C04_SR_003?.["5"];
    if (add) {
      enemies.push(makeEnemy({
        sheet: add,
        hp: ELITE_BASE.hp * 0.615,
        atk: ELITE_BASE.atk * 0.39,
        defn: ELITE_BASE.defn * 0.826,
        spd: ELITE_BASE.spd * 1.06,
        el: "Earth",
        hurt: 0,
        stack_rate: 0,
        stack_fid: "",
        cd: 0,
        immune: new Set(["Stun"]),
        debuff_res: 0.1,
        boss: false,
        front_row: false,
      }));
    }
  }
  for (const enemy of enemies) enemy.g = Math.floor(rng.random() * 5) / 100;
  const bossesDown = () => {
    const bosses = enemies.filter((enemy) => enemy.boss);
    return (bosses.length ? bosses : enemies).every((enemy) => enemy.hp <= 0);
  };
  let primary = 0;
  let steps = 0;
  let clearAt = -1;
  const counterDepth = [0];
  const bucket = () => Math.min(primary, TURNS - 1);
  const markClear = (enemy: AnyRec) => {
    if (enemy.boss === false || clearAt >= 0) return;
    clearAt = bucket();
  };
  const noteDamage = (ally: AnyRec, amount: number) => {
    ally.damage += amount;
    ally.turns[bucket()] += amount;
  };
  const livingAllies = () => allies.filter((a) => a.hp > 0);

  function timedReady(holder: AnyRec, row: AnyRec) {
    if (!row.cd_key) return true;
    const left = holder.timed_cd[row.cd_key] || 0;
    return row.invert ? left >= 1 : left < 1;
  }

  function runRows(holder: AnyRec, when: string, ctx: AnyRec) {
    if (holder.hp <= 0) return;
    for (const row of holder.unit.timed || []) {
      if (row.when !== when) continue;
      if (row.need_damage && !ctx.damage) continue;
      if (row.need_all && ctx.tgt !== "All") continue;
      if (row.need_diff && !ctx.diff) continue;
      if (row.need_same && ctx.diff) continue;
      if (row.need_noself && ctx.noself) continue;
      if (row.need_buff && !has(holder.buffs, row.need_buff)) continue;
      if (row.hp_below != null && holder.hp_max && holder.hp / holder.hp_max >= row.hp_below) continue;
      if (row.debuff) {
        const [who, op, need] = row.debuff;
        const total = who === "enemies" ? enemies.filter((e) => e.hp > 0).reduce((s, e) => s + debuffN(e), 0) : debuffN(holder);
        if (!cmp(op, total, need)) continue;
      }
      if (!timedReady(holder, row)) continue;
      let fired = false;
      for (const effect of row.effects) {
        const op = effect.op;
        if (op === "push") {
          holder.g = Math.min(0.99, holder.g + effect.value);
          fired = true;
        } else if (op === "status") {
          const chosen = effect.fids?.length ? { ...effect, fid: effect.fids[Math.floor(rng.random() * effect.fids.length)] } : effect;
          give(holder.buffs, chosen, holder.fresh);
          fired = true;
        } else if (op === "shield" && effect.rate > 0) {
          const group = effect.aim === "allies"
            ? allies.filter((other) => other.hp > 0)
            : effect.aim === "lowest"
              ? allies.filter((other) => other.hp > 0).sort((a, b) => (a.hp_max ? a.hp / a.hp_max : 1) - (b.hp_max ? b.hp / b.hp_max : 1)).slice(0, 1)
              : [holder];
          for (const who of group) {
            const added = gainShield(who, who.hp_max * effect.rate, effect.rounds);
            who.shield += added;
            who.shield_turns[bucket()] += added;
          }
          fired = group.length > 0;
        } else if (op === "heal" && effect.rate > 0 && !has(holder.buffs, "Unhealable")) {
          const gain = Math.min(holder.hp_max * effect.rate, Math.max(0, holder.hp_max - holder.hp));
          holder.hp += gain;
          holder.heal += gain;
          fired = true;
        } else if (op === "random" && effect.fids?.length) {
          const want = Math.max(1, Number(effect.rand || 1));
          const pool = [...effect.fids];
          for (let n = 0; n < want && pool.length; n++) {
            const at = Math.floor(rng.random() * pool.length);
            give(holder.buffs, { fid: pool.splice(at, 1)[0], rounds: effect.rounds || 1 }, holder.fresh);
          }
          fired = true;
        } else if (op === "extend") {
          for (const enemy of enemies) {
            for (const buff of enemy.buffs) if (isDebuff(buff.fid) && buff.rounds > 0) buff.rounds += effect.value;
            for (const dot of enemy.dots || []) dot.rounds += effect.value;
          }
          fired = true;
        } else if (op === "cd") {
          const step = effect.value;
          holder.cd = Math.max(0, holder.cd + step);
          holder.proc_cd = holder.proc_cd.map((n: number) => Math.max(0, n + step));
          for (const key of Object.keys(holder.react_cd)) holder.react_cd[key] = Math.max(0, holder.react_cd[key] + step);
          for (const key of Object.keys(holder.timed_cd)) holder.timed_cd[key] = Math.max(0, holder.timed_cd[key] + step);
          fired = true;
        } else if (op === "cleanse") {
          stripDebuffs(holder, effect.count);
          fired = true;
        } else if (op === "counter" && !counterDepth[0] && ctx.attacker && holder.unit.basic) {
          if (rng.random() >= (effect.chance ?? 1)) continue;
          counterDepth[0] = 1;
          try { cast(holder, holder.unit.basic, true, 0, undefined, [ctx.attacker]); }
          finally { counterDepth[0] = 0; }
          fired = true;
        }
      }
      if (fired && row.cd_key) holder.timed_cd[row.cd_key] = row.cd_after;
    }
  }

  function onDead() {
    for (const holder of allies) runRows(holder, "dead", { diff: true, damage: false, tgt: "", noself: false });
  }

  function grantSupport(ally: AnyRec, sk: AnyRec, selectDied: boolean, hpBefore: number, snap?: Map<string, boolean>, targets?: AnyRec[]) {
    snap = snap || new Map();
    for (const [kind, key] of [["heal", "heals"], ["shield", "shields"]] as const) {
      (sk[key] || []).forEach((entry: AnyRec, i: number) => {
        if (!gateOk(entry.gate, selectDied, hpBefore, ally)) return;
        if (!entryOk(snap!, key, i, entry, ally, targets, allies)) return;
        let who: AnyRec[];
        if (entry.aim === "select") {
          const chosen = new Set(allies);
          who = (targets || []).filter((t) => chosen.has(t) && t.hp > 0);
        } else who = alliesFor(ally, entry.aim || "allies", allies);
        let amount = 0;
        for (const other of who) {
          const part = entry.prop === "Attack" ? atkOf(ally) * entry.rate : (kind === "heal" ? ally.hp_max : other.hp_max) * entry.rate;
          if (kind === "heal") {
            if (has(other.buffs, "Unhealable")) continue;
            const restored = Math.min(part, Math.max(0, other.hp_max - other.hp));
            other.hp += restored;
            amount += restored;
          } else {
            amount += gainShield(other, part, entry.rounds);
          }
        }
        ally[kind] += amount;
        ally[kind + "_turns"][bucket()] += amount;
      });
    }
  }

  function procOk(chance: number, resist: boolean, target?: AnyRec, hit = 0) {
    let p = Math.max(0, Math.min(1, chance < 0.999 ? chance : 1));
    if (resist) {
      const res = target?.debuff_res != null ? Number(target.debuff_res) : Number(target?.unit?.debuff_res || 0);
      p *= effectGate(res, hit);
    }
    return rng.random() < p;
  }

  function enemyTarget(enemy: AnyRec) {
    const living = livingAllies();
    if (!living.length) return null;
    for (const buff of enemy.buffs as Buff[]) {
      if (buff.fid !== "Taunt") continue;
      const src = buff.payload?.source;
      if (src && src.hp > 0) return src;
    }
    let pool = living.filter((a) => !has(a.buffs, "Stealth"));
    if (!pool.length) pool = living;
    const open = pool.filter((a) => !has(a.buffs, "Invincible"));
    pool = open.length ? open : pool;
    if (enemy.front_row) {
      if (rng.random() < 0.6) {
        const front = pool.filter((a) => allies.indexOf(a) === 0);
        if (front.length) pool = front;
      }
      const beaten = pool.filter((a) => elementEdge(enemy.el, a.unit.el) > 0);
      if (beaten.length) pool = beaten;
      const ratio = (a: AnyRec) => (a.hp_max > 0 ? a.hp / a.hp_max : 1);
      let best = ratio(pool[0]);
      let tied = [pool[0]];
      for (const ally of pool.slice(1)) {
        const rate = ratio(ally);
        if (rate < best - 1e-9) {
          best = rate;
          tied = [ally];
        } else if (Math.abs(rate - best) <= 1e-9) tied.push(ally);
      }
      if (tied.length === 1) return tied[0];
      return rng.choice(tied);
    }
    if (pool.length === 1) return pool[0];
    return rng.choice(pool);
  }

  function pickTargets(sk: AnyRec, fallback?: AnyRec[]) {
    let pool = enemies.filter((e) => e.hp > 0);
    const open = pool.filter((e) => !has(e.buffs, "Stealth"));
    pool = open.length ? open : pool;
    if (!sk || sk.rate <= 0 || sk.camp === "My" || !pool.length) {
      return fallback ? fallback.filter((e) => e.hp > 0) : [];
    }
    if (sk.tgt === "All") return pool.slice();
    if (sk.tgt === "RandomTwo") return rng.sample(pool, Math.min(2, pool.length));
    return [pool[0]];
  }

  function rateOf(ally: AnyRec, sk: AnyRec, enemy: AnyRec, isBasic: boolean, preEnemies: number) {
    const pens = numMap(isBasic ? ally.unit.basic_pen_ch : ally.unit.ult_pen_ch);
    const debuffs = enemy.buffs.length + enemy.dots.length;
    for (const p of sk.pens || []) {
      const ch = p.channel ?? 1;
      pens[ch] = (pens[ch] || 0) + p.base;
      if (p.per_debuff) pens[ch] += p.per_debuff * debuffs;
      if (p.stun_extra && has(enemy.buffs, "Stun")) pens[ch] += p.stun_extra;
    }
    let cond = 0;
    for (const c of sk.conds || []) {
      if (c.gate_need != null) {
        if (needOk(c.gate_need, ally, enemy, allies)) cond += c.base + c.rate;
        continue;
      }
      if (c.prop === "EnemyCount") {
        const n = c.who === "target" ? allies.filter((a) => a.hp > 0).length : enemies.filter((e) => e.hp > 0).length;
        cond += c.base + c.rate * n;
      } else if (c.prop === "FewEnemyCount") cond += c.base + c.rate * Math.max(0, 4 - preEnemies);
      else if (c.prop === "LastHPRate") {
        const src = c.who === "target" ? enemy : ally;
        const cap = src.hp_max || 0;
        const missing = cap ? Math.max(0, ((cap - src.hp) / cap) * 100) : 0;
        cond += c.base + c.rate * missing;
      } else if (c.prop === "DebuffCount") cond += c.rate * debuffs;
      else if (c.needs_target_debuff && has(enemy.buffs, "Target")) cond += c.rate;
      else if (c.prop === "OldBuffCount") {
        const who = c.who === "target" ? enemy : ally;
        cond += c.base + c.rate * oldBuffCount(who);
      } else if (c.prop === "BuffCount") {
        let n = c.who === "target" ? buffCount(enemy.buffs) : buffCount(ally.buffs);
        if (c.max) n = Math.min(n, c.max);
        cond += c.base + c.rate * n;
      } else if (c.needs_enemy_buff && buffCount(enemy.buffs) >= 1) cond += c.base + c.rate;
    }
    return [Math.max(0, sk.rate), pens, 1 + cond] as const;
  }

  function pushAmount(push: AnyRec, who: AnyRec | null, caster: AnyRec) {
    let val = push.value;
    if (push.per_cleanse) {
      let n = who?.cleansed || 0;
      n = Math.min(n, push.cleanse_max || n);
      val = (push.base || 0) + push.per_cleanse * n;
      const cap = push.cap || 0;
      if (cap) val = val >= 0 ? Math.min(val, cap) : Math.max(val, -cap);
    }
    if (push.extra_need) {
      if (needOk(push.extra_need, caster, who, allies)) val += push.extra || 0;
    } else if (push.double_if_buffed && buffCount(caster.buffs) >= 1) val += push.extra || 0;
    return val;
  }

  function shiftRounds(holder: AnyRec, kind: string, delta: number) {
    const keep: Buff[] = [];
    for (const buff of holder.buffs as Buff[]) {
      const debuff = isDebuff(buff.fid);
      if ((kind === "debuff") !== debuff || buff.rounds < 0) {
        keep.push(buff);
        continue;
      }
      buff.rounds += delta;
      if (buff.rounds > 0) keep.push(buff);
    }
    holder.buffs = keep;
    if (kind === "debuff" && holder.dots) {
      holder.dots = holder.dots.filter((dot: AnyRec) => {
        dot.rounds += delta;
        return dot.rounds > 0;
      });
    }
  }

  function takeBuffs(holder: AnyRec, kind: string, count: number) {
    const moved: Buff[] = [];
    const keep: Buff[] = [];
    for (const buff of holder.buffs as Buff[]) {
      const debuff = isDebuff(buff.fid);
      const wanted = kind === "debuff" ? debuff : statusOf(buff.fid).buff && !statusOf(buff.fid).resident && buff.rounds > 0;
      if (wanted && moved.length < count) moved.push(buff);
      else keep.push(buff);
    }
    holder.buffs = keep;
    return moved;
  }

  function applyEffects(ally: AnyRec, sk: AnyRec, targets: AnyRec[], selectDied: boolean, hpBefore: number, snap: Map<string, boolean>) {
    for (const shift of sk.round_shifts || []) {
      const who = shift.aim === "self" ? [ally] : shift.aim === "allies" ? allies.filter((a) => a.hp > 0) : shift.aim === "enemies" ? enemies.filter((e) => e.hp > 0) : targets.filter((e) => e.hp > 0);
      for (const holder of who) shiftRounds(holder, shift.kind, shift.value);
    }
    for (const move of sk.moves || []) {
      if (rng.random() >= (move.chance ?? 1)) continue;
      if (move.from === "self") {
        const moved = takeBuffs(ally, move.what, move.count || 1);
        for (const enemy of targets.filter((e) => e.hp > 0)) {
          for (const buff of moved) if (!enemy.immune?.has(buff.fid)) enemy.buffs.push({ ...buff });
          break;
        }
      } else {
        for (const enemy of targets.filter((e) => e.hp > 0)) {
          for (const buff of takeBuffs(enemy, move.what, move.count || 1)) ally.buffs.push(buff);
        }
      }
    }
    (sk.cleanses || []).forEach((cl: AnyRec, i: number) => {
      if (!gateOk(cl.gate, selectDied, hpBefore, ally)) return;
      if (!entryOk(snap, "cleanses", i, cl, ally, targets, allies)) return;
      if (cl.buff) {
        const chance = cl.chance == null || cl.chance >= 0.999 ? 1 : cl.chance;
        let victims: AnyRec[];
        if (["self", "allies", "lowest", "lowest2", "highest"].includes(cl.aim)) {
          victims = alliesFor(ally, cl.aim, allies);
        } else if (cl.aim === "enemies") {
          victims = enemies.filter((e) => e.hp > 0);
        } else {
          victims = targets.filter((e) => e.hp > 0);
        }
        for (const holder of victims) {
          if (rng.random() >= chance) continue;
          stripBuffs(holder, cl.count ?? 1);
        }
        return;
      }
      const aim = cl.aim || "allies";
      let who: AnyRec[];
      if (aim === "debuffed_one") {
        const pool = allies.filter((a) => a.hp > 0 && debuffed(a));
        who = pool.length ? [rng.choice(pool)] : [];
      } else if (aim === "debuffed") who = allies.filter((a) => a.hp > 0 && debuffed(a));
      else who = alliesFor(ally, aim, allies);
      for (const other of who) stripDebuffs(other, cl.count ?? -1);
    });
    (sk.statuses || []).forEach((st: AnyRec, i: number) => {
      if (!gateOk(st.gate, selectDied, hpBefore, ally)) return;
      if (st.need && st.need.who !== "target" && !entryOk(snap, "statuses", i, st, ally, targets, allies)) return;
      const rolls = (row: AnyRec) => {
        if (!row.fids?.length) return [row];
        const want = Math.max(1, Number(row.rand || 1));
        const pool = [...row.fids];
        const out: AnyRec[] = [];
        for (let n = 0; n < want && pool.length; n++) {
          const at = Math.floor(rng.random() * pool.length);
          out.push({ ...row, fid: pool.splice(at, 1)[0] });
        }
        return out;
      };
      const aim = st.aim || "hit";
      if (["self", "allies", "lowest", "lowest2", "highest"].includes(aim)) {
        if (!procOk(st.chance, false)) return;
        let who = aim === "highest" ? highestAtk(ally, allies, !!st.noself) : alliesFor(ally, aim, allies);
        if (st.noself) who = who.filter((o) => o !== ally);
        for (const other of who) for (const chosen of rolls(st)) give(other.buffs, chosen, other.fresh);
      } else {
        const victims = aim === "enemies" ? enemies.filter((e) => e.hp > 0) : targets.filter((e) => e.hp > 0);
        for (const e of victims) for (const chosen of rolls(st)) {
          if (st.need && st.need.who === "target" && !needOk(st.need, ally, e, allies)) continue;
          if (e.immune?.has(chosen.fid)) continue;
          if (!chosen.is_buff && has(e.buffs, "Immune")) continue;
          if (!procOk(chosen.chance, !chosen.is_buff, e, hitMod(ally.buffs))) continue;
          const spec = statusOf(chosen.fid);
          if (spec.dot) dotPlant(e, chosen, atkOf(ally), ally);
          else {
            give(e.buffs, chosen, null);
            if (chosen.fid === "Taunt") {
              const applied = (e.buffs as Buff[]).filter((buff) => buff.fid === "Taunt").pop();
              if (applied) applied.payload = { ...(applied.payload || {}), source: ally };
            }
          }
        }
      }
    });
    (sk.pushes || []).forEach((push: AnyRec, i: number) => {
      if (!gateOk(push.gate, selectDied, hpBefore, ally)) return;
      const aim = push.aim || push.side;
      const gains = push.value > 0 || (push.per_cleanse || 0) > 0;
      if (gains && (aim === "self" || aim === "hit") && push.side !== "enemy") {
        if (push.noself && aim === "self") return;
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        if (!has(ally.buffs, "Restrict")) ally.g = Math.min(0.99, ally.g + pushAmount(push, ally, ally));
      } else if (gains && aim === "highest") {
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        for (const other of highestAtk(ally, allies, !!push.noself)) {
          if (!has(other.buffs, "Restrict")) other.g = Math.min(0.99, other.g + pushAmount(push, other, ally));
        }
      } else if (gains && (aim === "lowest" || aim === "lowest2")) {
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        for (const other of alliesFor(ally, aim, allies)) {
          if (!has(other.buffs, "Restrict")) other.g = Math.min(0.99, other.g + pushAmount(push, other, ally));
        }
      } else if (gains && aim === "allies") {
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        for (const other of allies) {
          if (other.hp <= 0) continue;
          if (push.noself && other === ally) continue;
          if (has(other.buffs, "Restrict")) continue;
          other.g = Math.min(0.99, other.g + pushAmount(push, other, ally));
        }
      } else if (push.value < 0 && (targets.length || aim === "enemies")) {
        const victims = aim === "enemies" ? enemies.filter((e) => e.hp > 0) : targets.filter((e) => e.hp > 0);
        for (const e of victims) {
          if (!entryOk(snap, "pushes", i, push, ally, e, allies)) continue;
          if (has(e.buffs, "Immune")) continue;
          if (procOk(1, true, e)) e.g = Math.max(0, e.g + pushAmount(push, e, ally));
        }
      }
    });
  }

  function bossAtk(enemy: AnyRec) {
    // Trial / AttackStack stacks live on the buff (payload.stacks) via give()+maxStack.
    return enemy.atk * Math.max(0.2, 1 + magSum(enemy.buffs, "atk"));
  }

  function cooling(holder: AnyRec, sid: string) {
    if (holder.unit.ult && holder.unit.ult.id === sid) return holder.cd > 0;
    return (holder.react_cd[sid] || 0) > 0;
  }

  function reactOk(holder: AnyRec, react: AnyRec, sk: AnyRec | null) {
    if (react.watch) {
      const onCd = cooling(holder, react.watch);
      if (react.invert ? !onCd : onCd) return false;
    }
    if (react.need_no_damage && sk && sk.rate > 0) return false;
    if (react.need_damage && !(sk && sk.rate > 0)) return false;
    if (react.need_all && !(sk && sk.tgt === "All")) return false;
    return true;
  }

  function hurtCut(victim: AnyRec, sk: AnyRec | null) {
    let best = 0;
    for (const holder of allies) {
      if (holder.hp <= 0) continue;
      for (const react of holder.unit.reactions || []) {
        if (react.kind !== "before_hit" || !(react.ops || []).some(([op]: [string, number]) => op === "hurt")) continue;
        if (react.aim === "self" && holder !== victim) continue;
        if (!reactOk(holder, react, sk)) continue;
        for (const [op, n] of react.ops || []) if (op === "hurt") best = Math.max(best, n);
      }
    }
    return best;
  }

  function applyReact(holder: AnyRec, react: AnyRec, targets: AnyRec[], enemy: AnyRec | null) {
    let who: AnyRec | null = null;
    if (react.hp_below != null && react.aim === "lowest_hit") {
      const pool = targets.filter((t) => t.hp > 0);
      if (!pool.length) return false;
      who = pool.reduce((best, a) => ((a.hp_max ? a.hp / a.hp_max : 1) < (best.hp_max ? best.hp / best.hp_max : 1) ? a : best));
      if (who.hp_max && who.hp / who.hp_max > react.hp_below) return false;
    }
    let did = false;
    for (const [op, num] of react.ops || []) {
      if (op === "hurt") continue;
      if (op === "shield") {
        const added = gainShield(holder, holder.hp_max * num, react.shield_rounds);
        holder.shield += added;
        holder.shield_turns[bucket()] += added;
        did = true;
      } else if (op === "null") {
        give(holder.buffs, { fid: "SkillNullifier", rounds: -1 }, holder.fresh);
        did = true;
      } else if (op === "push") {
        holder.g = Math.min(0.99, holder.g + num);
        did = true;
      } else if (op === "cleanse") {
        stripDebuffs(holder, -1);
        did = true;
      } else if (op === "taunt" && enemy && !enemy.immune?.has("Taunt")) {
        upsert(enemy.buffs, "Taunt", 1, 1, { source: holder });
        did = true;
      } else if (op === "heal") {
        const group = react.aim === "lowest_hit" ? (who ? [who] : []) : react.aim === "allies" ? allies.filter((a) => a.hp > 0) : [holder];
        let restored = 0;
        for (const other of group) {
          if (!other || other.hp <= 0 || has(other.buffs, "Unhealable")) continue;
          const gain = Math.min(holder.hp_max * num, Math.max(0, other.hp_max - other.hp));
          other.hp += gain;
          restored += gain;
        }
        if (restored) {
          holder.heal += restored;
          holder.heal_turns[bucket()] += restored;
          did = true;
        }
      }
    }
    if (did && react.arm) holder.react_cd[react.arm] = react.arm_turns || 0;
    return did;
  }

  function fireReactions(kind: string, enemy: AnyRec | null, sk: AnyRec | null, targets: AnyRec[]) {
    for (const holder of allies) {
      if (holder.hp <= 0) continue;
      for (const react of holder.unit.reactions || []) {
        if (react.kind !== kind || !reactOk(holder, react, sk)) continue;
        applyReact(holder, react, targets, enemy);
      }
    }
  }

  function answerHit(attacker: AnyRec, victim: AnyRec, sk: AnyRec) {
    if (counterDepth[0] || !sk || sk.rate <= 0) return;
    counterDepth[0] = 1;
    try {
      for (const holder of allies) {
        if (holder.hp <= 0) continue;
        for (const hit of holder.unit.on_hit || []) {
          if (hit.need_damage && sk.rate <= 0) continue;
          if (hit.need_noself && holder === victim) continue;
          if (hit.need_one && sk.tgt !== "One") continue;
          if (rng.random() >= hit.chance) continue;
          if (hit.kind === "push") holder.g = Math.min(0.99, holder.g + hit.value);
          else if (hit.kind === "counter" && holder.unit.basic) cast(holder, holder.unit.basic, true, 0, undefined, [attacker]);
        }
      }
    } finally {
      counterDepth[0] = 0;
    }
  }

  function immortal(holder: AnyRec) {
    return (holder.buffs as Buff[]).some((b) => statusOf(b.fid).immortal);
  }

  function applyLife(who: AnyRec, row: AnyRec, healer: AnyRec) {
    if (row.need_buff && !has(who.buffs, row.need_buff)) return false;
    if (!timedReady(who, row)) return false;
    let fired = false;
    for (const effect of row.effects) {
      if (effect.op === "immortal") {
        who.hp = 1;
        fired = true;
      } else if (effect.op === "revive" && who.hp <= 0 && effect.rate > 0) {
        const gain = who.hp_max * effect.rate;
        who.hp = gain;
        healer.heal += gain;
        healer.heal_turns[bucket()] += gain;
        fired = true;
      } else if (effect.op === "status") {
        give(who.buffs, effect, who.fresh);
        fired = true;
      } else if (effect.op === "push") {
        who.g = Math.min(0.99, who.g + effect.value);
        fired = true;
      } else if (effect.op === "cleanse") {
        stripDebuffs(who, effect.count);
        fired = true;
      } else if (effect.op === "skill_cd" && who.unit.ult && effect.fid === who.unit.ult.id) {
        who.cd = Math.max(0, who.cd + effect.value);
        fired = true;
      }
    }
    if (fired && row.cd_key) who.timed_cd[row.cd_key] = row.cd_after;
    return fired;
  }

  function afterRevive(caster: AnyRec, revived: AnyRec, funId: string) {
    for (const row of caster.unit.life || []) {
      if (row.when !== "revived") continue;
      if (row.need_fun && row.need_fun !== funId) continue;
      applyLife(row.target === "param" ? revived : caster, row, caster);
    }
  }

  function survive(ally: AnyRec) {
    if (ally.hp > 0) return;
    if (immortal(ally)) {
      ally.hp = 1;
      return;
    }
    for (const row of ally.unit.life || []) if (row.when === "pre") applyLife(ally, row, ally);
    if (ally.hp > 0) return;
    const rows = (ally.unit.life || []).filter((row: AnyRec) => row.when === "selfdead");
    const consumed: [string, AnyRec][] = [];
    for (const buff of ally.buffs as Buff[]) {
      for (const row of statusOf(buff.fid).life || []) {
        if (row.when === "selfdead") {
          rows.push(row);
          consumed.push([buff.fid, row]);
        }
      }
    }
    for (const row of rows.slice().sort((a: AnyRec, b: AnyRec) => (a.order || 0) - (b.order || 0))) {
      if (ally.hp > 0) break;
      if (applyLife(ally, row, ally)) {
        const funId = row.fun_id || "";
        for (const [fid, source] of consumed) {
          if (source === row) ally.buffs = (ally.buffs as Buff[]).filter((b) => b.fid !== fid);
        }
        if (ally.hp > 0 && funId) afterRevive(ally, ally, funId);
      }
    }
  }

  function castRevives(ally: AnyRec, sk: AnyRec) {
    for (const rev of sk.revives || []) {
      const dead = allies.filter((other) => other.hp <= 0);
      let who: AnyRec[];
      if (rev.target === "self") who = ally.hp <= 0 ? [ally] : [];
      else if (rev.target === "dead_one") who = dead.slice(0, 1);
      else who = dead;
      for (const other of who) {
        const gain = other.hp_max * (rev.rate || 0);
        if (gain <= 0 || has(other.buffs, "Unhealable")) continue;
        other.hp = gain;
        ally.heal += gain;
        ally.heal_turns[bucket()] += gain;
        afterRevive(ally, other, rev.fun_id || "");
      }
    }
  }

  function beforeRounds() {
    for (const holder of allies) {
      if (holder.hp <= 0) continue;
      for (const row of holder.unit.life || []) if (row.when === "before") applyLife(holder, row, holder);
    }
  }

  function strikeAlly(enemy: AnyRec, ally: AnyRec, rate: number, sk?: AnyRec, pens?: Record<number, number>) {
    if (ally.hp <= 0) return;
    const edge = elementEdge(enemy.el, ally.unit.el);
    // Boss→ally: evasion only. Ally ACC Down / conquer-dodge do not soften boss swings (live Ice tanks still eat full Fire hits).
    const dodge = Math.max(0, magSum(ally.buffs, "eva"));
    const rolled = hitRoll(rng, dodge, edge > 0 ? CONQUER_CRIT : 0, magSum(enemy.buffs, "crit"), magSum(enemy.buffs, "cdmg"), magSum(ally.buffs, "cres"), edge > 0);
    const mult = rolled.mult;
    const covered = hurtCut(ally, sk || null);
    let raw = directDamage(bossAtk(enemy), allyDef(ally), mult, {
      rate,
      power: ATTACK_POWER_RATE,
      pens: pens || { 1: 0, 2: 0, 3: 0 },
      buffs: ally.buffs,
      conquer: edge > 0 ? 1.1 : 1,
      cuts: covered > 0 ? [covered] : [],
      stealth: !!(has(ally.buffs, "Stealth") && sk && sk.tgt === "All"),
    });
    if (has(ally.buffs, "SkillNullifier")) {
      ally.buffs = (ally.buffs as Buff[]).filter((b) => b.fid !== "SkillNullifier");
      raw = 0;
    } else if (has(ally.buffs, "Invincible")) raw = 0;
    if (!ally.sharing) {
      let shareRate = 0;
      let sharer: AnyRec | null = null;
      const index = allies.indexOf(ally);
      for (const other of allies) {
        const share = other.unit.share;
        if (!share || other === ally || other.hp <= 0) continue;
        if (share.pos != null && index !== share.pos) continue;
        if (share.rate > shareRate) {
          shareRate = share.rate;
          sharer = other;
        }
      }
      if (sharer && shareRate > 0) {
        const moved = Math.min(raw, roundEven(f32(raw * shareRate)));
        raw -= moved;
        const movedAbsorbed = absorbShield(sharer, moved);
        const movedHp = moved - movedAbsorbed;
        sharer.hp = Math.max(0, sharer.hp - movedHp);
        sharer.taken += movedHp;
        if (moved > 0) {
          wakeSleep(sharer);
          breakStealth(sharer);
        }
        survive(sharer);
        noteLoss(sharer);
      }
    }
    const absorbed = absorbShield(ally, raw);
    const hit = raw;
    raw -= absorbed;
    const beforeHp = ally.hp;
    ally.hp = Math.max(0, ally.hp - raw);
    ally.taken += raw;
    const lost = beforeHp - ally.hp;
    const bounce = ally.unit.reflect;
    if (bounce && ally.hp > 0 && lost > 0) {
      const back = Math.min(lost * bounce.rate, ally.hp_max * (bounce.cap ?? 1));
      if (back > 0) {
        const bounced = absorbShield(enemy, back);
        enemy.hp -= back - bounced;
        if (enemy.hp <= 0) bossSurvive(enemy);
        if (immortal(enemy) && enemy.hp < 1) enemy.hp = 1;
        noteDamage(ally, back);
      }
    }
    if (hit > 0) {
      wakeSleep(ally);
      breakStealth(ally);
    }
    survive(ally);
    noteLoss(ally);
    if (trace && hit > 0) trace.push(`turn ${primary}  ${enemy.name || "boss"} hit ${ally.unit.name}  ${Math.round(hit)} damage ${rollLabel(mult)}  ${Math.round(ally.hp)} hp left`);
    if (sk && sk.rate > 0) {
      answerHit(enemy, ally, sk);
      runRows(ally, "targeted", { diff: true, damage: true, tgt: sk.tgt || "One", attacker: enemy, noself: false });
    }
  }

  function giveBossBuff(enemy: AnyRec, fid: string, rounds: number) {
    give(enemy.buffs, { fid, rounds }, enemy.fresh);
  }

  function tickBossStack(enemy: AnyRec) {
    const fid = enemy.stack_fid || stackFidFor(enemy.stack_rate);
    if (!fid) return;
    give(enemy.buffs, { fid, count: 1 }, enemy.fresh);
  }

  function plantOnAlly(enemy: AnyRec, ally: AnyRec, effect: AnyRec) {
    const fid = effect.fid;
    if (isDebuff(fid) && has(ally.buffs, "Immune")) return;
    const chance = Math.max(0, Math.min(1, effect.chance < 0.999 ? effect.chance : 1));
    const land = isDebuff(fid) ? effectGate(Number(ally.unit.debuff_res || 0)) : 1;
    if (rng.random() >= chance * land) return;
    if (fid === "Poison" || fid === "Bleed" || fid === "Burn") {
      const kind = statusOf(fid).dot;
      const raw = kind === "poison" ? ally.hp_max * 0.05 * effect.count : f32(bossAtk(enemy) * effect.rate * effect.count);
      ally.dots.push({ fid, raw, rounds: effect.rounds, kind });
      return;
    }
    if (fid === "Bomb") {
      ally.buffs.push({ fid: "Bomb", mag: 1, rounds: effect.rounds || 2, payload: { atk: bossAtk(enemy), rate: effect.rate, fresh: true } });
      return;
    }
    if (statusOf(fid).inStat) give(ally.buffs, { fid, rounds: effect.rounds }, null);
    else upsert(ally.buffs, fid, 1, effect.rounds || 1);
  }

  function cast(ally: AnyRec, sk: AnyRec | null, isBasic: boolean, depth: number, fallback?: AnyRec[], force?: AnyRec[], fromPinch = false) {
    if (!sk) return [] as AnyRec[];
    const targets = force != null ? force.filter((e) => e.hp > 0) : pickTargets(sk, fallback);
    const hpBefore = targets.length ? targets[0].hp : BOSS_HP;
    const atk = atkOf(ally);
    let critLanded = false;
    if (targets.length && sk.rate > 0) {
      const preEnemies = enemies.filter((e) => e.hp > 0).length;
      for (const e of targets) {
        const [rate, pens, cond] = rateOf(ally, sk, e, isBasic, preEnemies);
        const cuts: number[] = [];
        if (e.hp > e.hp_max * 0.5 && e.hurt > 0) cuts.push(e.hurt);
        if (e.single_hurt > 0 && sk.tgt !== "All" && sk.tgt !== "RandomTwo") cuts.push(e.single_hurt);
        const edge = sk.force_advantage ? 1 : elementEdge(ally.unit.el, e.el);
        const dodge = dodgeChance(ally.buffs, e.buffs) + (edge < 0 ? CONQUER_DODGE : 0);
        const rolled = hitRoll(rng, dodge, ally.unit.perm_crit + (sk.crit || 0) + (edge > 0 ? CONQUER_CRIT : 0), magSum(ally.buffs, "crit"), magSum(ally.buffs, "cdmg"), magSum(e.buffs, "cres"), edge > 0);
        const mult = rolled.mult;
        if (rolled.crit) critLanded = true;
        const dealt = directDamage(atk, clearStat(e, "defn"), mult, {
          rate,
          cond,
          pens,
          buffs: e.buffs,
          conquer: edge > 0 ? 1.1 : 1,
          cuts,
          stealth: !!(has(e.buffs, "Stealth") && sk.tgt === "All"),
        });
        const absorbed = absorbShield(e, dealt);
        e.hp -= dealt - absorbed;
        if (e.hp <= 0) bossSurvive(e);
        if (immortal(e) && e.hp < 1) e.hp = 1;
        noteDamage(ally, dealt);
        if (trace && dealt > 0) trace.push(`turn ${primary}  ${ally.unit.name} ${isBasic ? "basic" : "ultimate"}  ${Math.round(dealt)} damage ${rollLabel(mult)}  ${e.name ? e.name + " " : ""}boss ${Math.max(0, Math.round(e.hp))}`);
        if (dealt > 0) {
          wakeSleep(e);
          breakStealth(e);
          if (e.timed?.length) bossStruck(e);
        }
        if (depth === 0 && has(e.buffs, "Counterattack")) strikeAlly(e, ally, 1);
      }
    } else if (trace && depth === 0) {
      trace.push(`turn ${primary}  ${ally.unit.name} ${isBasic ? "basic" : "ultimate"}`);
    }
    const selectDied = targets.length > 0 && targets[0].hp <= 0;
    const snap = snapshotNeeds(ally, sk, targets, allies);
    applyEffects(ally, sk, targets, selectDied, hpBefore, snap);
    grantSupport(ally, sk, selectDied, hpBefore, snap, targets);
    castRevives(ally, sk);
    ally.used[sk.id] = (ally.used[sk.id] || 0) + 1;
    if (sk.kill_reset && selectDied) ally.cd = 0;
    if (depth === 0) {
      for (const add of ally.unit.adds || []) {
        if (add.check && add.check !== sk.id) continue;
        const killed = targets.some((e) => e.hp <= 0);
        if (!gateOk(add.gate, killed, hpBefore, ally)) continue;
        let chance = add.chance ?? 1;
        if (add.bonus_if === "target_buff" && targets.length && buffCount(targets[0].buffs) >= 1) chance += add.bonus || 0;
        if (rng.random() >= chance) continue;
        const follow = data.skills[add.fid];
        if (follow) cast(ally, follow, false, 1);
      }
    }
    let justKilled = false;
    for (const e of enemies) {
      if (e.hp > 0 || e.dead) continue;
      e.dead = true;
      justKilled = true;
      onDead();
      e.kills += 1;
      markClear(e);
      if (endOnKill) lost = bossesDown();
      else {
        e.hp = e.hp_max;
        e.dead = false;
      }
    }
    ally.just_killed = justKilled;
    if (sk.rate > 0 && !has(ally.buffs, "Restrict")) {
      for (const push of ally.unit.attack_pushes || []) {
        if (push.crit && !critLanded) continue;
        ally.g = Math.min(0.99, ally.g + (push.value || 0));
      }
    }
    if (fromPinch && !has(ally.buffs, "Restrict")) {
      for (const push of ally.unit.pinch_pushes || []) {
        const group = push.aim === "allies" ? allies.filter((a) => a.hp > 0) : [ally];
        for (const other of group) {
          if (push.noself && other === ally) continue;
          if (!has(other.buffs, "Restrict")) other.g = Math.min(0.99, other.g + (push.value || 0));
        }
      }
    }
    if (isBasic && depth === 0 && !fromPinch && targets.length) baseFlanks(ally, targets);
    return targets;
  }

  function baseFlanks(caster: AnyRec, targets: AnyRec[]) {
    for (const mate of allies) {
      if (mate === caster || mate.hp <= 0) continue;
      const chance = mate.unit.pinch_rate ?? PINCH_RATE;
      if (!(chance > 0) || rng.random() >= chance) continue;
      const sk = mate.unit.pinch_basic || mate.unit.basic;
      if (!sk || !(sk.rate > 0)) continue;
      cast(mate, sk, true, 0, undefined, targets, true);
      pinchReact(mate, sk);
    }
  }

  function tickAllyDots(ally: AnyRec) {
    for (const dot of ally.dots) {
      let amount = dot.kind === "poison" ? Math.trunc(dot.raw) : dotDamage(dot.raw, allyDef(ally), ally.buffs);
      const absorbed = absorbShield(ally, amount);
      amount -= absorbed;
      ally.hp = Math.max(0, ally.hp - amount);
      ally.taken += amount;
      if (amount + absorbed > 0) breakStealth(ally);
      survive(ally);
      noteLoss(ally);
      dot.rounds -= 1;
    }
    ally.dots = ally.dots.filter((d: AnyRec) => d.rounds > 0);
  }

  function explodeBomb(ally: AnyRec, bomb: Buff) {
    const payload = bomb.payload || {};
    let raw = Math.max(0, roundEven(f32((payload.atk || 0) * (payload.rate ?? 0.25))));
    const absorbed = absorbShield(ally, raw);
    raw -= absorbed;
    ally.hp = Math.max(0, ally.hp - raw);
    ally.taken += raw;
    survive(ally);
    noteLoss(ally);
    upsert(ally.buffs, "Stun", 1, 1);
  }

  function spendStatus(holder: AnyRec, fid: string) {
    const kept: Buff[] = [];
    for (const b of holder.buffs as Buff[]) {
      if (b.fid !== fid) {
        kept.push(b);
        continue;
      }
      b.mag -= 1;
      if (b.mag > 0) kept.push(b);
    }
    holder.buffs = kept;
  }

  function pinchReact(actor: AnyRec, sk: AnyRec, depth = 0) {
    if (depth > 4 || !sk || sk.rate <= 0) return;
    spendStatus(actor, "PinchEnhance");
    const reactors = allies.filter((a) => a !== actor && a.hp > 0 && has(a.buffs, "PinchEnhance"));
    for (const ally of reactors) {
      spendStatus(ally, "PinchEnhance");
      const extra = ally.unit.pinch_basic || ally.unit.basic;
      if (!extra) continue;
      cast(ally, extra, true, 0);
      pinchReact(ally, extra, depth + 1);
    }
  }

  function noteAllyTurn(actor: AnyRec) {
    for (const ally of allies) {
      if (ally.hp <= 0) continue;
      for (const rule of ally.unit.turn_stacks || []) {
        const cur = (ally.buffs as Buff[]).find((b) => b.fid === rule.counter);
        const n = (cur ? cur.mag : 0) + 1;
        if (n >= rule.need) {
          if (cur) ally.buffs = (ally.buffs as Buff[]).filter((b) => b !== cur);
          give(ally.buffs, { fid: rule.grant, rounds: -1 }, ally.fresh);
        } else if (cur) cur.mag = n;
        else ally.buffs.push({ fid: rule.counter, mag: n, rounds: -1, payload: {} });
      }
    }
    void actor;
  }

  function doPinches(caster: AnyRec, pinches: AnyRec[]) {
    for (const pinch of pinches) {
      if (!gateOk(pinch.gate, false, caster.boss_hp || BOSS_HP, caster)) continue;
      if (rng.random() >= pinch.chance) continue;
      let pool = allies.filter((a) => a.hp > 0 && (a !== caster || !pinch.noself));
      if (pinch.noself) pool = pool.filter((a) => a !== caster);
      if (!pool.length) continue;
      const mate = pinch.who === "highest" ? pool.reduce((best, a) => (atkOf(a) > atkOf(best) ? a : best)) : rng.choice(pool);
      const sk = mate.unit.pinch_basic || mate.unit.basic;
      cast(mate, sk, true, 0, undefined, undefined, true);
      pinchReact(mate, sk);
    }
  }

  function scalesWithDebuffs(sk: AnyRec) {
    if ((sk.pens || []).some((pen: AnyRec) => pen.per_debuff)) return true;
    return (sk.conds || []).some((cond: AnyRec) => cond.prop === "DebuffCount");
  }

  function ultFavored(ult: AnyRec, friendlies: AnyRec[], hostiles: AnyRec[]) {
    if (!ult) return false;
    const damage = ult.rate > 0;
    const cleanses = (ult.cleanses || []).length > 0;
    const heals = (ult.heals || []).length > 0;
    const shields = (ult.shields || []).length > 0;
    const teamBuff = (ult.statuses || []).some((row: AnyRec) => row.is_buff);
    const gauge = (ult.pushes || []).some((push: AnyRec) => push.value > 0);
    const allyDebuff = friendlies.some((a) => a.hp > 0 && debuffN(a) > 0);
    const allyHurt = friendlies.some((a) => a.hp > 0 && a.hp_max > 0 && a.hp / a.hp_max < HEAL_HOLD);
    const enemyDebuff = hostiles.some((a) => a.hp > 0 && debuffN(a) > 0);
    if (scalesWithDebuffs(ult) && !teamBuff && !gauge && !shields && !heals) return enemyDebuff || (cleanses && allyDebuff);
    if (cleanses && !damage) {
      if (allyDebuff) return true;
      if (heals && !teamBuff && !gauge && !shields) return allyHurt;
      return false;
    }
    if (heals && !teamBuff && !gauge && !shields && !damage) return allyHurt;
    return true;
  }

  function tickRegen(holder: AnyRec) {
    if (holder.hp <= 0 || has(holder.buffs, "Unhealable")) return;
    const copies = (holder.buffs as Buff[]).filter((buff) => buff.fid === "ContinuousHeal").length;
    if (!copies) return;
    const rate = Number(statusOf("ContinuousHeal").heal) || 0.06;
    const gain = Math.min(holder.hp_max * rate * copies, Math.max(0, holder.hp_max - holder.hp));
    if (!(gain > 0)) return;
    holder.hp += gain;
    if (holder.heal != null) {
      holder.heal += gain;
      holder.heal_turns[bucket()] += gain;
    }
  }

  function allyAct(ally: AnyRec) {
    beforeRounds();
    tickAllyDots(ally);
    tickRegen(ally);
    if (ally.hp <= 0) {
      ally.g = 0;
      return;
    }
    for (const key of Object.keys(ally.timed_cd)) if (ally.timed_cd[key] > 0) ally.timed_cd[key] -= 1;
    if (has(ally.buffs, "Stun") || has(ally.buffs, "Sleep")) {
      passRound(ally);
      ally.g = 0;
      noteAllyTurn(ally);
      return;
    }
    const unit = ally.unit;
    if (unit.before_heals?.length || unit.before_shields?.length) {
      grantSupport(ally, { heals: unit.before_heals, shields: unit.before_shields }, false, BOSS_HP);
    }
    const useUlt = ally.cd <= 0 && unit.ult && !has(ally.buffs, "Silence") && ultFavored(unit.ult, allies, enemies);
    let sk: AnyRec;
    if (useUlt) {
      sk = unit.ult;
      ally.ults += 1;
      ally.cd = Math.max(1, sk.cd - 1);
    } else {
      sk = unit.buff_basic && buffCount(ally.buffs) >= 1 ? unit.buff_basic : unit.basic;
      if (ally.cd > 0) ally.cd -= 1;
    }
    ally.actions += 1;
    ally.g = 0;
    const hit = cast(ally, sk, !useUlt, 0);
    const runProcs = (onlyDamage: boolean) => {
      (unit.basic_procs || []).forEach((proc: AnyRec, i: number) => {
        if (onlyDamage && !proc.on_damage) return;
        if (proc.cd && ally.proc_cd[i] > 0) {
          ally.proc_cd[i] -= 1;
          return;
        }
        let fired = false;
        if (proc.pinches?.length) {
          doPinches(ally, proc.pinches);
          fired = true;
        }
        if (proc.statuses?.length || proc.pushes?.length || proc.heals?.length || proc.shields?.length) {
          cast(ally, {
            statuses: proc.statuses, pushes: proc.pushes, id: proc.sid || "proc", rate: 0, camp: "My", tgt: "",
            pens: [], conds: [], crit: 0, extra_turn: false, kill_reset: false, heals: proc.heals || [],
            shields: proc.shields || [], cleanses: proc.cleanses || [],
            round_shifts: proc.round_shifts || [], moves: proc.moves || [],
          }, true, 1, hit);
          fired = true;
        }
        const pull = proc.transfer_from;
        if (pull && hit && hit.length) {
          const enemy = hit[0];
          const buffs = (enemy.buffs as Buff[]).filter((buff) => statusOf(buff.fid).buff);
          if (buffs.length > (pull.gt ?? 0)) {
            const moved = takeBuffs(enemy, "buff", pull.count || 1);
            for (const mate of allies) {
              if (mate.hp <= 0) continue;
              for (const buff of moved) mate.buffs.push({ ...buff, payload: { ...(buff.payload || {}) } });
            }
            if (moved.length) fired = true;
          }
        }
        for (const add of unit.adds || []) {
          if (add.check !== proc.sid) continue;
          fired = true;
          let follow = data.skills[add.fid];
          if (!follow) continue;
          const living = enemies.filter((e) => e.hp > 0);
          const hpBefore = living.length ? living[0].hp : BOSS_HP;
          if (!gateOk(add.gate, false, hpBefore, ally)) continue;
          follow = { ...follow, pens: [...(follow.pens || []), ...(proc.pens || [])], conds: [...(follow.conds || []), ...(proc.conds || [])] };
          cast(ally, follow, false, 1);
        }
        if (proc.ult_reset) {
          ally.cd = 0;
          fired = true;
        }
        const cut = proc.cd_cut;
        if (cut && cut.aim === "highest_cd") {
          fired = true;
          let pool = allies.filter((a) => a.hp > 0 && (a !== ally || !cut.noself));
          pool = pool.filter((a) => a.cd > 0 || a.proc_cd.some((n: number) => n > 0) || Object.values(a.react_cd).some((n) => (n as number) > 0));
          if (pool.length) {
            const mate = pool.reduce((best, a) => (a.cd > best.cd ? a : best));
            const step = Math.abs(cut.value ?? -1);
            mate.cd = Math.max(0, mate.cd - step);
            mate.proc_cd = mate.proc_cd.map((n: number) => Math.max(0, n - step));
            for (const key of Object.keys(mate.react_cd)) mate.react_cd[key] = Math.max(0, mate.react_cd[key] - step);
          }
        }
        if (proc.extra) {
          fired = true;
          ally.actions += 1;
          const follow = unit.buff_basic && buffCount(ally.buffs) >= 1 ? unit.buff_basic : unit.basic;
          cast(ally, follow, true, 0);
          ally.g = 0;
        }
        if (fired && proc.cd) ally.proc_cd[i] = proc.cd;
      });
    };
    if (useUlt) runProcs(true);
    if (useUlt && sk?.extra_turn && (!sk.extra_on_kill || ally.just_killed)) {
      const basic = unit.buff_basic && buffCount(ally.buffs) >= 1 ? unit.buff_basic : unit.basic;
      ally.actions += 1;
      if (ally.cd > 0) ally.cd -= 1;
      cast(ally, basic, true, 0);
    }
    if (!useUlt) {
      for (const sid of Object.keys(ally.react_cd)) if (ally.react_cd[sid] > 0) ally.react_cd[sid] -= 1;
      doPinches(ally, sk?.pinches || []);
      runProcs(false);
    }
    noteAllyTurn(ally);
    ally.ending = true;
    runRows(ally, "turn", { diff: false, damage: false, tgt: "", noself: false });
    if (unit.after_heals?.length || unit.after_shields?.length) {
      grantSupport(ally, { heals: unit.after_heals, shields: unit.after_shields }, false, BOSS_HP);
    }
    ally.ending = false;
    const kept: Buff[] = [];
    for (const b of ally.buffs as Buff[]) {
      if (b.payload?.fresh) {
        b.payload.fresh = false;
        kept.push(b);
        continue;
      }
      if (ally.fresh.has(b.fid) || b.rounds < 0) {
        kept.push(b);
        continue;
      }
      if (b.fid === "Bomb") {
        b.rounds -= 1;
        if (b.rounds <= 0) {
          explodeBomb(ally, b);
          continue;
        }
      } else b.rounds -= 1;
      if (b.rounds > 0) kept.push(b);
    }
    ally.buffs = kept;
    ally.fresh.clear();
    tickShields(ally);
    noteGauges();
  }

  function bossTargets(enemy: AnyRec, sk: AnyRec) {
    if (!sk || sk.rate <= 0 || sk.camp === "My") return [];
    const living = livingAllies();
    if (!living.length) return [];
    if (sk.tgt === "All") return living;
    if (sk.tgt === "RandomTwo") return rng.sample(living, Math.min(2, living.length));
    const one = enemyTarget(enemy);
    return one ? [one] : [];
  }

  function bossRate(enemy: AnyRec, sk: AnyRec, ally: AnyRec, isBasic: boolean) {
    const pens: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    if (isBasic && enemy.basic_pen_ch) {
      for (const ch of [1, 2, 3]) pens[ch] = Number(enemy.basic_pen_ch[ch] || enemy.basic_pen_ch[String(ch)] || 0);
    }
    const debuffs = debuffN(ally);
    for (const pen of sk.pens || []) {
      const ch = pen.channel ?? 1;
      pens[ch] = (pens[ch] || 0) + (pen.base || 0);
      if (pen.per_debuff) pens[ch] += pen.per_debuff * debuffs;
      if (pen.stun_extra && has(ally.buffs, "Stun")) pens[ch] += pen.stun_extra;
    }
    let cond = 0;
    for (const row of sk.conds || []) {
      if (row.gate_need != null) {
        if (needOk(row.gate_need, enemy, ally, allies)) cond += (row.base || 0) + row.rate;
        continue;
      }
      if (row.prop === "LastHPRate") {
        const src = row.who === "target" ? ally : enemy;
        const cap = src.hp_max || 0;
        const missing = cap ? Math.max(0, ((cap - src.hp) / cap) * 100) : 0;
        cond += (row.base || 0) + row.rate * missing;
      } else if (row.prop === "DebuffCount") cond += row.rate * debuffs;
      else if (row.needs_enemy_buff && buffCount(ally.buffs) >= 1) cond += (row.base || 0) + row.rate;
    }
    return [Math.max(0, sk.rate || 0), pens, 1 + cond] as const;
  }

  function bossEffects(sk: AnyRec) {
    if (sk.effects?.length) return sk.effects;
    return (sk.statuses || []).map((row: AnyRec) => ({ ...row, rate: row.rate ?? row.dot_rate ?? 0.15 }));
  }

  function bossSurvive(enemy: AnyRec) {
    if (enemy.hp > 0 || !enemy.life) return;
    for (const row of enemy.life) {
      if (row.when !== "pre") continue;
      if (row.cd_key && (enemy.timed_cd[row.cd_key] || 0) >= 1) continue;
      let fired = false;
      for (const effect of row.effects || []) {
        if (effect.op === "immortal") {
          enemy.hp = 1;
          fired = true;
        } else if (effect.op === "status") {
          give(enemy.buffs, effect, enemy.fresh);
          fired = true;
        } else if (effect.op === "skill_cd") {
          enemy.cd = Math.max(0, enemy.cd + effect.value);
          fired = true;
        }
      }
      if (fired && row.cd_key) enemy.timed_cd[row.cd_key] = row.cd_after;
      if (enemy.hp > 0) {
        // Paired Endure: life "before"/timed rows that need Immortal_Mark (Fearless once-per-battle).
        for (const follow of enemy.life || []) {
          if (follow.when !== "before" || !follow.need_buff || !has(enemy.buffs, follow.need_buff)) continue;
          for (const effect of follow.effects || []) {
            if (effect.op === "status") give(enemy.buffs, effect, enemy.fresh);
          }
        }
        for (const follow of enemy.timed || []) {
          if (follow.when !== "targeted" || !follow.need_buff || !has(enemy.buffs, follow.need_buff)) continue;
          for (const effect of follow.effects || []) {
            if (effect.op === "status") give(enemy.buffs, effect, enemy.fresh);
          }
        }
        return;
      }
    }
  }

  function bossStruck(enemy: AnyRec) {
    for (const row of enemy.timed || []) {
      if (row.when !== "targeted") continue;
      // Hit reactions: need_damage basics, or need_buff followups (Immortal_Mark → Immortal).
      if (!row.need_damage && !row.need_buff) continue;
      if (row.cd_key && (enemy.timed_cd[row.cd_key] || 0) >= 1) continue;
      if (row.need_buff && !has(enemy.buffs, row.need_buff)) continue;
      let fired = false;
      for (const effect of row.effects || []) {
        if (effect.op === "status") {
          give(enemy.buffs, effect, enemy.fresh);
          fired = true;
        } else if (effect.op === "push") {
          enemy.g = Math.min(0.99, enemy.g + effect.value);
          fired = true;
        }
      }
      if (fired && row.cd_key) enemy.timed_cd[row.cd_key] = row.cd_after;
    }
  }

  function lowTarget(add: AnyRec, ally: AnyRec, hpBefore: number) {
    if (!Array.isArray(add.gate) || add.gate[0] !== "low") return true;
    return ally.hp_max > 0 && hpBefore / ally.hp_max < add.gate[1];
  }

  function useBossSkill(enemy: AnyRec, sk: AnyRec, follow = true) {
    const targets = bossTargets(enemy, sk);
    const before = new Map(targets.map((ally) => [ally, ally.hp]));
    const isBasic = sk === enemy.basic || sk === enemy.buff_basic;
    for (const ally of targets) {
      const [rate, pens, cond] = bossRate(enemy, sk, ally, isBasic);
      strikeAlly(enemy, ally, rate * cond, sk, pens);
    }
    fireReactions("after_skill", enemy, sk, targets);
    // Fearless ult: extend existing self buffs by 1 before granting the new ATK Up.
    if (sk === enemy.ult && (sk.statuses || []).some((row: AnyRec) => row.fid === "AddAttack" && row.aim === "self")) {
      for (const buff of enemy.buffs as Buff[]) {
        if (buff.rounds > 0 && statusOf(buff.fid).buff) buff.rounds += 1;
      }
    }
    for (const effect of bossEffects(sk)) {
      const aim = effect.aim;
      if (["self", "allies", "lowest", "lowest2", "other"].includes(aim)) {
        if (["Poison", "Bleed", "Burn", "Bomb", "ReduceAttack", "Stun", "Target"].includes(effect.fid)) continue;
        if (rng.random() >= (effect.chance < 0.999 ? effect.chance : 1)) continue;
        if (aim === "other") {
          const others = enemies.filter((e) => e !== enemy && e.hp > 0);
          if (others.length) giveBossBuff(rng.choice(others), effect.fid, effect.rounds);
        } else if (aim === "self") giveBossBuff(enemy, effect.fid, effect.rounds);
        else {
          const group = aim === "allies" ? enemies : [enemy];
          for (const other of alliesFor(enemy, aim === "allies" ? "allies" : aim, group)) giveBossBuff(other, effect.fid, effect.rounds);
        }
      } else {
        for (const ally of targets) plantOnAlly(enemy, ally, effect);
      }
    }
    for (const entry of sk.heals || []) {
      for (const other of alliesFor(enemy, entry.aim || "self", enemies)) {
        if (!has(other.buffs, "Unhealable")) other.hp = Math.min(other.hp_max, other.hp + enemy.hp_max * entry.rate);
      }
    }
    for (const entry of sk.shields || []) {
      for (const other of alliesFor(enemy, entry.aim || "self", enemies)) gainShield(other, other.hp_max * entry.rate, entry.rounds);
    }
    for (const push of sk.pushes || []) {
      if (push.value > 0 && (push.aim === "self" || push.aim === "hit")) enemy.g = Math.min(0.99, enemy.g + push.value);
      else if (push.value > 0 && push.aim === "allies") {
        for (const other of enemies) other.g = Math.min(0.99, other.g + push.value);
      } else if (push.value < 0) {
        for (const ally of targets) {
          if (has(ally.buffs, "Immune")) continue;
          ally.g = Math.max(0, ally.g + push.value);
        }
      }
    }
    if (follow && sk.extra_turn && enemy.basic) useBossSkill(enemy, enemy.basic, false);
    if (!follow || !enemy.adds || !targets.length) return;
    for (const add of enemy.adds) {
      if (add.check !== sk.id) continue;
      const ally = targets[0];
      if (!lowTarget(add, ally, before.get(ally) ?? ally.hp)) continue;
      if ((add.chance ?? 1) < 1 && rng.random() >= add.chance) continue;
      const next = data.skills[add.fid];
      if (next) useBossSkill(enemy, next, false);
    }
  }

  function bossProcs(enemy: AnyRec, targets: AnyRec[], before: Map<AnyRec, number>) {
    if (!enemy.procs) return;
    enemy.procs.forEach((proc: AnyRec, i: number) => {
      if (proc.cd && enemy.proc_cd[i] > 0) {
        enemy.proc_cd[i] -= 1;
        return;
      }
      let fired = false;
      for (const add of enemy.adds || []) {
        if (add.check !== proc.sid) continue;
        fired = true;
        const ally = targets[0];
        if (!ally || !lowTarget(add, ally, before.get(ally) ?? ally.hp)) continue;
        let next = data.skills[add.fid];
        if (!next) continue;
        next = { ...next, pens: [...(next.pens || []), ...(proc.pens || [])] };
        useBossSkill(enemy, next, false);
      }
      if (fired && proc.cd) enemy.proc_cd[i] = proc.cd;
    });
  }

  function enemyAct(enemy: AnyRec, idx: number) {
    beforeRounds();
    for (const dot of enemy.dots) {
      let amount = dot.kind === "poison" ? Math.trunc(dot.raw) : dotDamage(dot.raw, clearStat(enemy, "defn"), enemy.buffs);
      const absorbed = absorbShield(enemy, amount);
      amount -= absorbed;
      enemy.hp -= amount;
      if (amount + absorbed > 0) breakStealth(enemy);
      const owner = allies.find((a) => a.unit.id === dot.owner);
      if (owner) noteDamage(owner, amount);
      if (trace && amount > 0) trace.push(`turn ${primary}  ${dot.fid}  ${Math.round(amount)} damage  boss ${Math.max(0, Math.round(enemy.hp))}`);
      dot.rounds -= 1;
    }
    enemy.dots = enemy.dots.filter((d: AnyRec) => d.rounds > 0);
    tickRegen(enemy);
    if (enemy.hp <= 0 && !enemy.dead) {
      bossSurvive(enemy);
      if (enemy.hp <= 0) {
        enemy.dead = true;
        onDead();
        enemy.kills += 1;
        markClear(enemy);
        enemy.g = 0;
        if (endOnKill) {
          lost = bossesDown();
          return;
        }
        enemy.hp = enemy.hp_max;
        enemy.dead = false;
      }
    }
    if (has(enemy.buffs, "Stun") || has(enemy.buffs, "Sleep")) {
      passRound(enemy);
      enemy.g = 0;
      if (idx === 0) primary += 1;
      fireReactions("after_round", enemy, null, []);
      return;
    }
    // Stack only when the boss actually swings (not while slept/stunned).
    tickBossStack(enemy);
    let useUlt = enemy.cd <= 0 && enemy.ult && !has(enemy.buffs, "Silence") && ultFavored(enemy.ult, enemies, allies);
    if (useUlt && enemy.ult_needs_debuffs) {
      const debuffs = allies.reduce((sum, ally) => sum + (ally.hp > 0 ? debuffN(ally) : 0), 0);
      if (!(debuffs > 1)) useUlt = false;
    }
    let sk: AnyRec | null;
    if (useUlt) {
      sk = enemy.ult;
      enemy.cd = Math.max(1, sk.cd - 1);
    } else {
      sk = enemy.buff_basic && bossSkillBuffed(enemy.buffs) ? enemy.buff_basic : enemy.basic;
      if (enemy.cd > 0) enemy.cd -= 1;
    }
    enemy.g = 0;
    if (sk) {
      const targets = bossTargets(enemy, sk);
      const before = new Map(targets.map((ally) => [ally, ally.hp]));
      useBossSkill(enemy, sk);
      if (!useUlt) bossProcs(enemy, targets, before);
    }
    const kept: Buff[] = [];
    for (const b of enemy.buffs as Buff[]) {
      if (b.payload?.fresh) {
        b.payload.fresh = false;
        kept.push(b);
        continue;
      }
      if (enemy.fresh.has(b.fid) || b.rounds < 0) {
        kept.push(b);
        continue;
      }
      b.rounds -= 1;
      if (b.rounds > 0) kept.push(b);
    }
    enemy.buffs = kept;
    enemy.fresh.clear();
    tickShields(enemy);
    if (idx === 0) primary += 1;
    fireReactions("after_round", enemy, sk, []);
    noteGauges();
  }

  function noteGauges() {
    if (!trace) return;
    const bar = (name: string, g: number) => `${name} ${Math.round(g * 100)}%`;
    const parts = [
      ...allies.filter((a) => a.hp > 0).map((a) => bar(a.unit.name, a.g)),
      ...enemies.filter((e) => e.hp > 0).map((e) => bar(e.name || "enemy", e.g)),
    ];
    trace.push(`gauges  ${parts.join("  ")}`);
  }

  for (const ally of allies) {
    if (ally.unit.start_heals?.length || ally.unit.start_shields?.length) {
      grantSupport(ally, { heals: ally.unit.start_heals, shields: ally.unit.start_shields }, false, BOSS_HP);
    }
  }

  let pruned = false;
  const takenNow = () => allies.reduce((sum, ally) => sum + ally.taken, 0);
  const actionsNow = () => allies.reduce((sum, ally) => sum + ally.actions, 0);
  const pastGiveUp = () => {
    if (!giveUp) return false;
    const taken = giveUp.taken == null ? 0 : takenNow();
    if (giveUp.rounds == null) return giveUp.taken != null && taken > giveUp.taken;
    if (primary > giveUp.rounds) return true;
    if (primary < giveUp.rounds) return false;
    const actions = actionsNow();
    if (giveUp.actions != null && actions > giveUp.actions) return true;
    if (giveUp.actions != null && actions < giveUp.actions) return false;
    return giveUp.taken != null && taken > giveUp.taken;
  };
  noteGauges();
  while (primary < turnCap && steps < 8000 && !lost) {
    if (pastGiveUp()) {
      pruned = true;
      break;
    }
    steps += 1;
    let actor: AnyRec | null = null;
    for (const a of allies) if (a.hp > 0 && a.g >= 1 - 1e-7) { actor = a; break; }
    if (actor) {
      allyAct(actor);
      continue;
    }
    let enemy: AnyRec | null = null;
    let enemyIndex = 0;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].hp > 0 && enemies[i].g >= 1 - 1e-7) { enemy = enemies[i]; enemyIndex = i; break; }
    if (enemy) {
      enemyAct(enemy, enemyIndex);
      continue;
    }
    let dt = Infinity;
    let waiting = false;
    for (const a of allies) if (a.hp > 0) {
      waiting = true;
      const t = (1 - a.g) / (spd(a.unit.spd, a.buffs) / CURVE_SPD);
      if (t < dt) dt = t;
    }
    for (const e of enemies) if (e.hp > 0) {
      waiting = true;
      const t = (1 - e.g) / (spd(clearStat(e, "spd"), e.buffs) / CURVE_SPD);
      if (t < dt) dt = t;
    }
    if (!waiting) break;
    dt = Math.max(0, dt);
    for (const a of allies) if (a.hp > 0) a.g += dt * (spd(a.unit.spd, a.buffs) / CURVE_SPD);
    for (const e of enemies) if (e.hp > 0) e.g += dt * (spd(clearStat(e, "spd"), e.buffs) / CURVE_SPD);
  }

  return {
    damage: allies.reduce((s, a) => s + a.damage, 0),
    heal: allies.reduce((s, a) => s + a.heal, 0),
    shield: allies.reduce((s, a) => s + a.shield, 0),
    taken: allies.reduce((s, a) => s + a.taken, 0),
    rounds: primary,
    clearAt,
    actions: allies.reduce((sum, ally) => sum + ally.actions, 0),
    pruned,
    kills: enemies.reduce((s, e) => s + e.kills, 0),
    bossKills: enemies.filter((e) => e.boss !== false).reduce((s, e) => s + e.kills, 0),
    turns: Array.from({ length: TURNS }, (_, i) => allies.reduce((s, a) => s + a.turns[i], 0)),
    heal_turns: Array.from({ length: TURNS }, (_, i) => allies.reduce((s, a) => s + a.heal_turns[i], 0)),
    shield_turns: Array.from({ length: TURNS }, (_, i) => allies.reduce((s, a) => s + a.shield_turns[i], 0)),
    units: allies.map((a) => ({
      id: a.unit.id,
      name: a.unit.name,
      job: a.unit.job,
      stars: a.unit.stars,
      passive: a.unit.passive_on,
      hp: a.unit.hp,
      atk: Math.round(a.unit.atk),
      defn: a.unit.defn,
      spd: Math.round(a.unit.spd),
      damage: a.damage,
      heal: a.heal,
      shield: a.shield,
      shield_left: a.shield_hp,
      taken: a.taken,
      actions: a.actions,
      ults: a.ults,
      hp_left: a.hp,
      turns: a.turns,
      heal_turns: a.heal_turns,
      shield_turns: a.shield_turns,
    })),
  };
}

function averageFights(units: AnyRec[], enemies: number, boss: AnyRec, seedAt: (run: number) => number, element = "") {
  const started = performance.now();
  let acc: any = null;
  const clearAts: number[] = [];
  const covered = Array(TURNS).fill(0);
  const addSeries = (one: AnyRec) => {
    const end = one.clearAt < 0 ? TURNS : Math.min(TURNS, one.clearAt + 1);
    for (let t = 0; t < end; t++) {
      covered[t] += 1;
      acc.turns[t] += one.turns[t];
      acc.heal_turns[t] += one.heal_turns[t];
      acc.shield_turns[t] += one.shield_turns[t];
      for (let u = 0; u < acc.units.length; u++) {
        acc.units[u].turns[t] += one.units[u].turns[t];
        acc.units[u].heal_turns[t] += one.units[u].heal_turns[t];
        acc.units[u].shield_turns[t] += one.units[u].shield_turns[t];
      }
    }
  };
  for (let i = 0; i < RUNS; i++) {
    const fought = fightOnce(units, enemies, new PyRandom(seedAt(i)), boss.id, false, element);
    const one = {
      ...fought,
      turns: fought.turns.slice(),
      heal_turns: fought.heal_turns.slice(),
      shield_turns: fought.shield_turns.slice(),
      units: fought.units.map((unit: AnyRec) => ({
        ...unit,
        turns: unit.turns.slice(),
        heal_turns: unit.heal_turns.slice(),
        shield_turns: unit.shield_turns.slice(),
      })),
    };
    clearAts.push(one.clearAt);
    if (!acc) {
      acc = fought;
      acc.turns = Array(TURNS).fill(0);
      acc.heal_turns = Array(TURNS).fill(0);
      acc.shield_turns = Array(TURNS).fill(0);
      for (const unit of acc.units) {
        unit.turns = Array(TURNS).fill(0);
        unit.heal_turns = Array(TURNS).fill(0);
        unit.shield_turns = Array(TURNS).fill(0);
      }
      addSeries(one);
      continue;
    }
    acc.damage += one.damage;
    acc.heal += one.heal;
    acc.shield += one.shield;
    acc.taken += one.taken;
    acc.kills += one.kills;
    addSeries(one);
    for (let u = 0; u < acc.units.length; u++) {
      const a = acc.units[u];
      const b = one.units[u];
      a.damage += b.damage;
      a.heal += b.heal;
      a.shield += b.shield;
      a.taken += b.taken;
      a.actions += b.actions;
      a.ults += b.ults;
    }
  }
  const killed = clearAts.filter((turn) => turn >= 0).sort((a, b) => a - b);
  const span = killed.length ? killed[Math.floor(killed.length / 2)] + 1 : TURNS;
  const round = (n: number) => Math.round(n / RUNS);
  const roundTurn = (values: number[]) => values.slice(0, span).map((value, turn) => covered[turn] ? Math.round(value / covered[turn]) : 0);
  for (const a of acc.units) {
    a.damage = round(a.damage);
    a.heal = round(a.heal);
    a.shield = round(a.shield);
    a.taken = round(a.taken);
    a.actions = round(a.actions);
    a.ults = round(a.ults);
    a.turns = roundTurn(a.turns);
    a.heal_turns = roundTurn(a.heal_turns);
    a.shield_turns = roundTurn(a.shield_turns);
  }
  return {
    runs: RUNS,
    ms: Math.round(performance.now() - started),
    enemies,
    boss: { id: boss.id, name: boss.name, tags: boss.tags, atk: boss.atk, actions: TURNS },
    team_damage: round(acc.damage),
    team_heal: round(acc.heal),
    team_shield: round(acc.shield),
    taken: round(acc.taken),
    kills: Math.round((acc.kills / RUNS) * 10) / 10,
    turns: roundTurn(acc.turns),
    units: acc.units,
  };
}

export function catalogUnit(id: string, star: number) {
  const row = data.units[id];
  if (!row) return null;
  if (star !== 0) return row[String(star)] || null;
  const one = row["1"];
  if (!one) return null;
  const scale = 1 / 1.15;
  return { ...one, stars: 0, passive_on: false, hp: one.hp * scale, atk: one.atk * scale, defn: one.defn * scale };
}

export function simulate(ids: string[], stars: number[], nEnemies: number, bossId = "plain", element = "") {
  const units = ids.map((id, i) => (id ? catalogUnit(id, stars[i] == null ? 5 : stars[i]) : null)).filter(Boolean);
  if (!units.length) return null;
  const boss = data.bosses[bossId] || data.bosses.plain;
  const enemies = nEnemies === 3 ? 3 : 1;
  const seed = units.reduce((s: number, u: AnyRec) => s + [...u.id].reduce((n, c) => n + c.charCodeAt(0), 0), 0) + enemies * 17 + [...boss.id].reduce((n: number, c: string) => n + c.charCodeAt(0), 0);
  return averageFights(units, enemies, boss, (run) => seed + run * 97, element);
}

export function rankedRuns(ids: string[], nEnemies: number, stars = 5, element = "") {
  const units = ids.map((id) => catalogUnit(id, stars)).filter(Boolean);
  if (units.length !== ids.length) return null;
  const boss = data.bosses.plain;
  const enemies = nEnemies === 3 ? 3 : 1;
  const seed = ids.reduce((sum, id) => sum + [...id].reduce((n, c) => n + c.charCodeAt(0), 0), 0) + 500;
  return averageFights(units, enemies, boss, (run) => seed + enemies * 100 + run * 97, element);
}

const STATUS_NAMES: Record<string, string> = {
  Bleed: "Bleed",
  Bomb: "Bomb",
  Brand: "Disrupt",
  Burn: "Burn",
  CannotBuff: "Buff Block",
  Curse: "Curse",
  DecreaseHitChance: "ACC Down",
  Hypertoxic: "Toxic",
  Poison: "Poison",
  ReduceAttack: "ATK Down",
  ReduceDef: "DEF Down",
  ReduceSpeed: "SPD Down",
  Restrict: "Shackled",
  Silence: "Silence",
  Sleep: "Slumber",
  Stun: "Stun",
  Target: "Suffocate",
  TargetTaunt: "Provoke",
  Taunt: "Taunt",
  Unhealable: "Heal Block",
};

function percentLabel(rate: number) {
  const n = Math.round(rate * 1000) / 10;
  return Number.isInteger(n) ? `${n}%` : `${n}%`;
}

function aimPhrase(aim: string) {
  if (aim === "self") return "the user";
  if (aim === "lowest") return "the lowest ally";
  if (aim === "lowest2") return "the 2 lowest allies";
  if (aim === "allies") return "all allies";
  return "";
}

function supportLabel(items: { rate: number; aim: string }[]) {
  const aims = new Set(items.map((item) => item.aim));
  if (items.length === 1 || aims.size <= 1) {
    return items.map((item) => `${percentLabel(item.rate)} max HP`).join(items.length === 2 ? " and " : ", ");
  }
  return items
    .map((item) => {
      const who = aimPhrase(item.aim);
      return who ? `${percentLabel(item.rate)} max HP to ${who}` : `${percentLabel(item.rate)} max HP`;
    })
    .join(", ");
}

function skillNumbers(skill: AnyRec | undefined) {
  const debuffs = ((skill?.statuses || []) as AnyRec[]).filter((row) => !row.is_buff && Number(row.chance) < 0.995);
  return {
    heals: [...((skill?.heals || []) as { rate: number; aim: string }[])],
    shields: [...((skill?.shields || []) as { rate: number; aim: string }[])],
    debuffs,
  };
}

function numbersFor(unit: AnyRec, skillName: string) {
  const empty = { heals: [] as { rate: number; aim: string }[], shields: [] as { rate: number; aim: string }[], startShields: [] as { rate: number; aim: string }[], turnShields: [] as { rate: number; aim: string }[], debuffs: [] as AnyRec[] };
  if (skillName === "Basic" || skillName === "Ultimate") return { ...empty, ...skillNumbers(unit[skillName === "Basic" ? "basic" : "ult"]) };
  if (skillName !== "Passive") return empty;
  const heals: { rate: number; aim: string }[] = [];
  const shields: { rate: number; aim: string }[] = [];
  const debuffs: AnyRec[] = [];
  for (const proc of unit.basic_procs || []) {
    const row = skillNumbers(proc);
    heals.push(...row.heals);
    shields.push(...row.shields);
    debuffs.push(...row.debuffs);
  }
  heals.push(...(unit.before_heals || []), ...(unit.after_heals || []), ...(unit.start_heals || []));
  shields.push(...(unit.before_shields || []), ...(unit.after_shields || []));
  const turnShields = ((unit.timed || []) as AnyRec[]).flatMap((row) => (
    (row.effects || []).filter((effect: AnyRec) => effect.op === "shield" && effect.rate > 0).map((effect: AnyRec) => ({ rate: effect.rate, aim: "" }))
  ));
  for (const row of unit.start_statuses || []) {
    if (!row.is_buff && Number(row.chance) < 0.995) debuffs.push(row);
  }
  return { heals, shields, startShields: [...(unit.start_shields || [])], turnShields, debuffs };
}

function withSupport(
  line: string,
  pattern: RegExp,
  items: { rate: number; aim: string }[],
  wrap: (match: string, label: string) => string,
) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const found = line.match(new RegExp(pattern.source, flags));
  if (!found?.length || !items.length) return line;
  const groups = found.length === 1
    ? [items.splice(0)]
    : found.map(() => items.splice(0, 1)).filter((group) => group.length);
  let index = 0;
  return line.replace(new RegExp(pattern.source, flags), (match) => {
    const group = groups[index];
    index += 1;
    return group?.length ? wrap(match, supportLabel(group)) : match;
  });
}

export function annotateSkill(id: string, skillName: string, lines: string[]) {
  const unit = data.units[id]?.["5"];
  if (!unit) return lines;
  const pack = numbersFor(unit, skillName);
  return lines.map((line) => {
    let next = withSupport(line, /restores?\s+(?:their\s+|the user's\s+)?HP/i, pack.heals, (match, label) => `${match} (${label})`);
    const shieldRe = /\bShield\b(?:\s*\()?/gi;
    const shieldHits = [...next.matchAll(shieldRe)];
    const poolFor = (offset: number) => {
      const before = next.slice(0, offset);
      if (/end of (?:the |each )?turn/i.test(before)) return pack.turnShields;
      if (/start of battle/i.test(before)) return pack.startShields;
      return pack.shields;
    };
    if (shieldHits.length) {
      const groups = shieldHits.map((hit) => {
        const pool = poolFor(hit.index ?? 0);
        const sharing = shieldHits.filter((other) => poolFor(other.index ?? 0) === pool);
        if (!pool.length) return [];
        return sharing.length === 1 ? pool.splice(0) : pool.splice(0, 1);
      });
      let index = 0;
      shieldRe.lastIndex = 0;
      next = next.replace(shieldRe, (match) => {
        const group = groups[index];
        index += 1;
        if (!group?.length) return match;
        const label = supportLabel(group);
        return match.endsWith("(") ? `Shield (${label}, ` : `Shield (${label})`;
      });
    }
    for (let i = 0; i < pack.debuffs.length; i += 1) {
      const row = pack.debuffs[i];
      const name = STATUS_NAMES[row.fid];
      if (!name || !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(next)) continue;
      const at = next.search(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
      const before = next.slice(Math.max(0, at - 56), at);
      pack.debuffs.splice(i, 1);
      i -= 1;
      if (/\d+(?:\.\d+)?%/.test(before)) continue;
      const after = next.slice(at + name.length);
      const turn = after.match(/^\s*\((\d+\s+turns?)\)/i);
      const chance = `${percentLabel(Number(row.chance))} chance`;
      next = turn
        ? `${next.slice(0, at)}${name} (${chance}, ${turn[1]})${after.slice(turn[0].length)}`
        : `${next.slice(0, at)}${name} (${chance})${after}`;
    }
    return next;
  });
}

export function attackPercent(id: string, skillName: string) {
  if (skillName !== "Basic" && skillName !== "Ultimate") return "";
  const skill = data.units[id]?.["5"]?.[skillName === "Basic" ? "basic" : "ult"];
  const rate = Number(skill?.rate || 0);
  if (!(rate > 0)) return "";
  return `${Math.round(rate * 100)}%`;
}

function cooldownPhrase(turns: number) {
  return turns === 1 ? "Cooldown: 1 turn." : `Cooldown: ${turns} turns.`;
}

export function skillCooldown(id: string, skillName: string, lines: string[], meta = "") {
  const blob = `${meta}\n${lines.join("\n")}`;
  if (/cooldown\s*:?\s*\d+/i.test(blob) || /every\s*\d+\s*turns?/i.test(blob) || /once per battle/i.test(blob)) return "";
  const unit = data.units[id]?.["5"];
  if (!unit) return "";
  if (skillName === "Basic") return Number(unit.basic?.cd) > 0 ? cooldownPhrase(Number(unit.basic.cd)) : "";
  if (skillName === "Ultimate") return Number(unit.ult?.cd) > 0 ? cooldownPhrase(Number(unit.ult.cd)) : "";
  if (skillName === "Alternate") {
    const cd = Number(unit.buff_basic?.cd || unit.basic?.cd || 0);
    return cd > 0 ? cooldownPhrase(cd) : "";
  }
  if (skillName !== "Passive") return "";
  const found = new Set<number>();
  for (const proc of unit.basic_procs || []) if (Number(proc.cd) > 0) found.add(Number(proc.cd));
  for (const row of unit.timed || []) if (Number(row.cd_after) > 0) found.add(Number(row.cd_after));
  if (found.size !== 1) return "";
  const turns = [...found][0];
  if (turns >= 100) return "Once per battle.";
  return `Once every ${turns} turns.`;
}

export const roster = data.roster as any[];
export const bossList = data.bossList as any[];
export const bosses = data.bosses as Record<string, { hp: number; atk: number; defn: number; spd: number; tags?: { text: string; kind: string }[] }>;
export const leaders = data.leaders as any;
