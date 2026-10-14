import { PyRandom } from "./random";

const data = (window as unknown as { __KAMI: any }).__KAMI;
const TURNS = 30;
const RUNS = 8;
const ATTACK_POWER_RATE = 1.871;
const DODGE_DAMAGE = 0.75;
const K = 2000;
const CURVE_SPD = 2000;
const BOSS_HP = 27600;
const LAND = 0.8;
const BASE_CRIT = 0.15;
const BASE_CDMG = 1.3;
const UTILITY = new Set(["Immune", "Taunt", "Stealth", "Invincible", "SkillNullifier", "Shield", "Counterattack"]);

type Buff = { fid: string; mag: number; rounds: number; payload: Record<string, any> };
type AnyRec = Record<string, any>;

function statusOf(fid: string): AnyRec {
  return data.statuses[fid] || { buff: false, typed: false, mods: {}, hit: 0, maxStack: 0, resident: false, keep: false, immortal: false, aura: false, inStat: false, rounds: 2, life: [], shown: false };
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

function defFactor(defense: number, buffs: Buff[], pens: Record<number, number>) {
  const [up, shred] = defnSplit(buffs);
  const vuln = Math.max(0, magSum(buffs, "vuln"));
  let penMult = 1;
  for (const ch of [1, 2, 3]) penMult *= Math.max(0, 1 - Math.min(0.95, pens[ch] || 0));
  defense = defense * (1 + up) * (1 - shred) * penMult;
  return (K / (K + defense)) * (1 + vuln);
}

function spd(base: number, buffs: Buff[]) {
  return Math.max(200, base * (1 + Math.max(-0.8, magSum(buffs, "spd"))));
}

function critMult(bonus = 0, critAdd = 0, cdmgAdd = 0) {
  const cr = Math.min(1, BASE_CRIT + bonus + critAdd);
  const cd = BASE_CDMG + cdmgAdd;
  return 1 + cr * (cd - 1);
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

function give(buffs: Buff[], st: AnyRec, fresh: Set<string> | null) {
  const row = statusOf(st.fid);
  const mods = row.mods || {};
  const hasMods = ["atk", "defn", "spd", "crit", "cdmg"].some((key) => mods[key]);
  if (!row.inStat && !row.aura && !row.hit && !hasMods && !row.keep) return;
  let rounds: number;
  if (st.fid === "SkillNullifier") rounds = 99;
  else if ((st.rounds || 0) > 0) rounds = st.rounds;
  else if ((st.rounds || 0) < 0 || row.resident) rounds = -1;
  else rounds = st.rounds || row.rounds || 2;
  const cap = row.maxStack || 0;
  upsert(buffs, st.fid, 1, rounds);
  if (cap > 1) {
    for (const buff of buffs) {
      if (buff.fid !== st.fid) continue;
      const have = Number(buff.payload.stacks || 0);
      buff.payload.stacks = have <= 0 ? 1 : Math.min(cap, have + 1);
      break;
    }
  }
  if (fresh) fresh.add(st.fid);
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
  return living;
}

function dotPlant(enemy: AnyRec, st: AnyRec, atk: number, ally: AnyRec) {
  const spec = statusOf(st.fid);
  const raw = spec.dot === "poison" ? BOSS_HP * 0.05 * st.count : atk * (st.dot_rate ?? 0.15) * st.count;
  for (const dot of enemy.dots) {
    if (dot.fid === st.fid && dot.owner === ally.unit.id) {
      dot.raw = raw;
      dot.rounds = Math.max(dot.rounds, st.rounds || 2);
      return;
    }
  }
  enemy.dots.push({ fid: st.fid, raw, rounds: st.rounds || 2, kind: spec.dot, owner: ally.unit.id });
}

function numMap(src: AnyRec | undefined) {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const [ch, val] of Object.entries(src || {})) out[Number(ch)] = (out[Number(ch)] || 0) + Number(val);
  return out;
}

export function fightOnce(units: AnyRec[], nEnemies: number, rng: PyRandom, bossId = "plain", stopOnDeath = false) {
  const boss = data.bosses[bossId] || data.bosses.plain;
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
    boss_hp: boss.hp,
  }));
  let lost = false;
  const noteLoss = (ally: AnyRec) => {
    if (stopOnDeath && ally.hp <= 0) lost = true;
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

  const makeEnemy = () => ({
    hp: boss.hp,
    hp_max: boss.hp,
    g: 0,
    buffs: [] as Buff[],
    fresh: new Set<string>(),
    dots: [] as AnyRec[],
    kills: 0,
    atk: boss.atk,
    defn: boss.defn,
    spd: boss.spd,
    hurt: boss.hurt,
    stack_rate: boss.stack_rate,
    stacks: 0,
    shield_hp: 0,
    basic: boss.basic,
    ult: boss.ult,
    cd: boss.cd,
  });
  const enemies = Array.from({ length: nEnemies }, makeEnemy);
  let primary = 0;
  let steps = 0;
  const counterDepth = [0];
  const bucket = () => Math.min(primary, TURNS - 1);
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
          give(holder.buffs, effect, holder.fresh);
          fired = true;
        } else if (op === "shield" && effect.rate > 0) {
          const gain = holder.hp_max * effect.rate;
          holder.shield_hp += gain;
          holder.shield += gain;
          holder.shield_turns[bucket()] += gain;
          fired = true;
        } else if (op === "heal" && effect.rate > 0) {
          const gain = Math.min(holder.hp_max * effect.rate, Math.max(0, holder.hp_max - holder.hp));
          holder.hp += gain;
          holder.heal += gain;
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
          const part = entry.prop === "Attack" ? atkOf(ally) * entry.rate : other.hp_max * entry.rate;
          if (kind === "heal") {
            const restored = Math.min(part, Math.max(0, other.hp_max - other.hp));
            other.hp += restored;
            amount += restored;
          } else {
            other.shield_hp += part;
            amount += part;
          }
        }
        ally[kind] += amount;
        ally[kind + "_turns"][bucket()] += amount;
      });
    }
  }

  function procOk(chance: number, resist: boolean) {
    let p = chance < 0.999 ? chance : 1;
    if (resist) p *= LAND;
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
    return pool.reduce((best, a) => (a.hp < best.hp ? a : best));
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

  function applyEffects(ally: AnyRec, sk: AnyRec, targets: AnyRec[], selectDied: boolean, hpBefore: number, snap: Map<string, boolean>) {
    (sk.cleanses || []).forEach((cl: AnyRec, i: number) => {
      if (!gateOk(cl.gate, selectDied, hpBefore, ally)) return;
      if (!entryOk(snap, "cleanses", i, cl, ally, targets, allies)) return;
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
      const aim = st.aim || "hit";
      if (["self", "allies", "lowest", "lowest2"].includes(aim)) {
        if (!procOk(st.chance, false)) return;
        let who = alliesFor(ally, aim, allies);
        if (st.noself) who = who.filter((o) => o !== ally);
        for (const other of who) give(other.buffs, st, other.fresh);
      } else {
        const victims = aim === "enemies" ? enemies.filter((e) => e.hp > 0) : targets.filter((e) => e.hp > 0);
        for (const e of victims) {
          if (st.need && st.need.who === "target" && !needOk(st.need, ally, e, allies)) continue;
          if (!st.is_buff && has(e.buffs, "Immune")) continue;
          if (!procOk(st.chance, !st.is_buff)) continue;
          const spec = statusOf(st.fid);
          if (spec.dot) dotPlant(e, st, atkOf(ally), ally);
          else {
            give(e.buffs, st, null);
            if (st.fid === "Taunt") {
              for (const buff of e.buffs as Buff[]) if (buff.fid === "Taunt") buff.payload = { source: ally };
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
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        ally.g = Math.min(0.99, ally.g + pushAmount(push, ally, ally));
      } else if (gains && (aim === "lowest" || aim === "lowest2")) {
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        for (const other of alliesFor(ally, aim, allies)) other.g = Math.min(0.99, other.g + pushAmount(push, other, ally));
      } else if (gains && aim === "allies") {
        if (!entryOk(snap, "pushes", i, push, ally, targets, allies)) return;
        for (const other of allies) {
          if (other.hp <= 0) continue;
          if (push.noself && other === ally) continue;
          other.g = Math.min(0.99, other.g + pushAmount(push, other, ally));
        }
      } else if (push.value < 0 && (targets.length || aim === "enemies")) {
        const victims = aim === "enemies" ? enemies.filter((e) => e.hp > 0) : targets.filter((e) => e.hp > 0);
        for (const e of victims) {
          if (!entryOk(snap, "pushes", i, push, ally, e, allies)) continue;
          if (has(e.buffs, "Immune")) continue;
          if (procOk(1, true)) e.g = Math.max(0, e.g + pushAmount(push, e, ally));
        }
      }
    });
  }

  function bossAtk(enemy: AnyRec) {
    const bonus = magSum(enemy.buffs, "atk") + enemy.stacks * enemy.stack_rate;
    return enemy.atk * Math.max(0.2, 1 + bonus);
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
    let total = 0;
    for (const holder of allies) {
      if (holder.hp <= 0) continue;
      for (const react of holder.unit.reactions || []) {
        if (react.kind !== "before_hit" || !(react.ops || []).some(([op]: [string, number]) => op === "hurt")) continue;
        if (react.aim === "self" && holder !== victim) continue;
        if (!reactOk(holder, react, sk)) continue;
        total += (react.ops || []).reduce((s: number, [op, n]: [string, number]) => s + (op === "hurt" ? n : 0), 0);
      }
    }
    return total;
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
        holder.shield_hp += holder.hp_max * num;
        holder.shield += holder.hp_max * num;
        holder.shield_turns[bucket()] += holder.hp_max * num;
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
      } else if (op === "taunt" && enemy) {
        upsert(enemy.buffs, "Taunt", 1, 1, { source: holder });
        did = true;
      } else if (op === "heal") {
        const group = react.aim === "lowest_hit" ? (who ? [who] : []) : react.aim === "allies" ? allies.filter((a) => a.hp > 0) : [holder];
        let restored = 0;
        for (const other of group) {
          if (!other || other.hp <= 0) continue;
          const gain = Math.min(other.hp_max * num, Math.max(0, other.hp_max - other.hp));
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
        if (gain <= 0) continue;
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

  function strikeAlly(enemy: AnyRec, ally: AnyRec, rate: number, sk?: AnyRec) {
    if (ally.hp <= 0) return;
    const mult = rng.random() <= -hitMod(enemy.buffs) ? DODGE_DAMAGE : critMult();
    let raw = bossAtk(enemy) * rate * mult * defFactor(allyDef(ally), ally.buffs, { 1: 0, 2: 0, 3: 0 });
    raw *= Math.max(0, 1 - hurtCut(ally, sk || null)) * ATTACK_POWER_RATE;
    if (has(ally.buffs, "SkillNullifier")) {
      ally.buffs = (ally.buffs as Buff[]).filter((b) => b.fid !== "SkillNullifier");
      raw = 0;
    } else if (has(ally.buffs, "Invincible")) raw = 0;
    const absorbed = Math.min(ally.shield_hp, raw);
    ally.shield_hp -= absorbed;
    raw -= absorbed;
    ally.hp = Math.max(0, ally.hp - raw);
    ally.taken += raw;
    survive(ally);
    noteLoss(ally);
    if (sk && sk.rate > 0) {
      answerHit(enemy, ally, sk);
      runRows(ally, "targeted", { diff: true, damage: true, tgt: sk.tgt || "One", attacker: enemy, noself: false });
    }
  }

  function giveBossBuff(enemy: AnyRec, fid: string, rounds: number) {
    if (statusOf(fid).inStat) give(enemy.buffs, { fid, rounds }, enemy.fresh);
    else {
      upsert(enemy.buffs, fid, 1, rounds || 2);
      enemy.fresh.add(fid);
    }
  }

  function plantOnAlly(enemy: AnyRec, ally: AnyRec, effect: AnyRec) {
    const fid = effect.fid;
    if (isDebuff(fid) && has(ally.buffs, "Immune")) return;
    const chance = effect.chance < 0.999 ? effect.chance : 1;
    if (rng.random() >= chance * Math.min(0.85, 1)) return;
    if (fid === "Poison" || fid === "Bleed" || fid === "Burn") {
      const kind = statusOf(fid).dot;
      const raw = kind === "poison" ? ally.hp_max * 0.05 * effect.count : bossAtk(enemy) * effect.rate * effect.count;
      for (const dot of ally.dots) {
        if (dot.fid === fid) {
          dot.raw = raw;
          dot.rounds = Math.max(dot.rounds, effect.rounds);
          return;
        }
      }
      ally.dots.push({ fid, raw, rounds: effect.rounds, kind });
      return;
    }
    if (fid === "Bomb") {
      upsert(ally.buffs, "Bomb", 1, effect.rounds, { atk: bossAtk(enemy), rate: effect.rate });
      return;
    }
    if (statusOf(fid).inStat) give(ally.buffs, { fid, rounds: effect.rounds }, null);
    else upsert(ally.buffs, fid, 1, effect.rounds || 1);
  }

  function cast(ally: AnyRec, sk: AnyRec | null, isBasic: boolean, depth: number, fallback?: AnyRec[], force?: AnyRec[]) {
    if (!sk) return [] as AnyRec[];
    const targets = force != null ? force.filter((e) => e.hp > 0) : pickTargets(sk, fallback);
    const hpBefore = targets.length ? targets[0].hp : BOSS_HP;
    const atk = atkOf(ally);
    const crit = critMult(ally.unit.perm_crit + (sk.crit || 0), magSum(ally.buffs, "crit"), magSum(ally.buffs, "cdmg"));
    if (targets.length && sk.rate > 0) {
      const preEnemies = enemies.filter((e) => e.hp > 0).length;
      for (const e of targets) {
        const [rate, pens, cond] = rateOf(ally, sk, e, isBasic, preEnemies);
        const cut = e.hp > e.hp_max * 0.5 ? e.hurt : 0;
        const mult = rng.random() <= -hitMod(ally.buffs) ? DODGE_DAMAGE : crit;
        const dealt = atk * rate * cond * defFactor(e.defn, e.buffs, pens) * mult * (1 - cut) * ATTACK_POWER_RATE;
        const absorbed = Math.min(e.shield_hp, dealt);
        e.shield_hp -= absorbed;
        e.hp -= dealt - absorbed;
        noteDamage(ally, dealt);
        if (depth === 0 && has(e.buffs, "Counterattack")) strikeAlly(e, ally, 1);
      }
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
    for (const e of enemies) {
      if (e.hp <= 0) {
        onDead();
        e.hp = e.hp_max;
        e.kills += 1;
      }
    }
    return targets;
  }

  function tickAllyDots(ally: AnyRec) {
    const factor = defFactor(allyDef(ally), ally.buffs, { 1: 0, 2: 0, 3: 0 });
    for (const dot of ally.dots) {
      let amount = dot.kind === "poison" ? dot.raw : dot.raw * factor;
      const absorbed = Math.min(ally.shield_hp, amount);
      ally.shield_hp -= absorbed;
      amount -= absorbed;
      ally.hp = Math.max(0, ally.hp - amount);
      ally.taken += amount;
      survive(ally);
      noteLoss(ally);
      dot.rounds -= 1;
    }
    ally.dots = ally.dots.filter((d: AnyRec) => d.rounds > 0);
  }

  function explodeBomb(ally: AnyRec, bomb: Buff) {
    const payload = bomb.payload || {};
    let raw = (payload.atk || 0) * (payload.rate ?? 0.25);
    const absorbed = Math.min(ally.shield_hp, raw);
    ally.shield_hp -= absorbed;
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
      cast(mate, sk, true, 0);
      pinchReact(mate, sk);
    }
  }

  function allyAct(ally: AnyRec) {
    beforeRounds();
    tickAllyDots(ally);
    if (ally.hp <= 0) {
      ally.g = 0;
      return;
    }
    for (const key of Object.keys(ally.timed_cd)) if (ally.timed_cd[key] > 0) ally.timed_cd[key] -= 1;
    if (has(ally.buffs, "Stun")) {
      const kept: Buff[] = [];
      for (const b of ally.buffs as Buff[]) {
        if (b.fid !== "Stun") {
          kept.push(b);
          continue;
        }
        b.rounds -= 1;
        if (b.rounds > 0) kept.push(b);
      }
      ally.buffs = kept;
      ally.g = 0;
      noteAllyTurn(ally);
      return;
    }
    const unit = ally.unit;
    if (unit.before_heals?.length || unit.before_shields?.length) {
      grantSupport(ally, { heals: unit.before_heals, shields: unit.before_shields }, false, BOSS_HP);
    }
    const useUlt = ally.cd <= 0 && unit.ult;
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
    if (useUlt && sk?.extra_turn) {
      const basic = unit.buff_basic && buffCount(ally.buffs) >= 1 ? unit.buff_basic : unit.basic;
      ally.actions += 1;
      if (ally.cd > 0) ally.cd -= 1;
      cast(ally, basic, true, 0);
    }
    if (!useUlt) {
      for (const sid of Object.keys(ally.react_cd)) if (ally.react_cd[sid] > 0) ally.react_cd[sid] -= 1;
      doPinches(ally, sk?.pinches || []);
      (unit.basic_procs || []).forEach((proc: AnyRec, i: number) => {
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
          }, true, 1, hit);
          fired = true;
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
          cast(ally, ally.cd <= 0 && unit.ult ? unit.ult : unit.basic, ally.cd > 0 || !unit.ult, 0);
          if (unit.ult && ally.cd <= 0) ally.cd = Math.max(1, unit.ult.cd - 1);
          ally.g = 0;
        }
        if (fired && proc.cd) ally.proc_cd[i] = proc.cd;
      });
    }
    noteAllyTurn(ally);
    runRows(ally, "turn", { diff: false, damage: false, tgt: "", noself: false });
    if (unit.after_heals?.length || unit.after_shields?.length) {
      grantSupport(ally, { heals: unit.after_heals, shields: unit.after_shields }, false, BOSS_HP);
    }
    const kept: Buff[] = [];
    for (const b of ally.buffs as Buff[]) {
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

  function useBossSkill(enemy: AnyRec, sk: AnyRec, follow = true) {
    const targets = bossTargets(enemy, sk);
    for (const ally of targets) strikeAlly(enemy, ally, sk.rate, sk);
    fireReactions("after_skill", enemy, sk, targets);
    for (const effect of sk.effects || []) {
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
        other.hp = Math.min(other.hp_max, other.hp + other.hp_max * entry.rate);
      }
    }
    for (const entry of sk.shields || []) {
      for (const other of alliesFor(enemy, entry.aim || "self", enemies)) other.shield_hp += other.hp_max * entry.rate;
    }
    for (const push of sk.pushes || []) {
      if (push.value > 0 && (push.aim === "self" || push.aim === "hit")) enemy.g = Math.min(0.99, enemy.g + push.value);
      else if (push.value > 0 && push.aim === "allies") {
        for (const other of enemies) other.g = Math.min(0.99, other.g + push.value);
      } else if (push.value < 0) {
        for (const ally of targets) {
          if (has(ally.buffs, "Immune")) continue;
          if (rng.random() < Math.min(0.85, 1)) ally.g = Math.max(0, ally.g + push.value);
        }
      }
    }
    if (follow && sk.extra_turn && enemy.basic) useBossSkill(enemy, enemy.basic, false);
  }

  function enemyAct(enemy: AnyRec, idx: number) {
    beforeRounds();
    if (enemy.stack_rate) enemy.stacks += 1;
    const factor = defFactor(enemy.defn, enemy.buffs, { 1: 0, 2: 0, 3: 0 });
    for (const dot of enemy.dots) {
      let amount = dot.kind === "poison" ? dot.raw : dot.raw * factor;
      const absorbed = Math.min(enemy.shield_hp, amount);
      enemy.shield_hp -= absorbed;
      amount -= absorbed;
      enemy.hp -= amount;
      const owner = allies.find((a) => a.unit.id === dot.owner);
      if (owner) noteDamage(owner, amount);
      dot.rounds -= 1;
    }
    enemy.dots = enemy.dots.filter((d: AnyRec) => d.rounds > 0);
    if (enemy.hp <= 0) {
      onDead();
      enemy.hp = enemy.hp_max;
      enemy.kills += 1;
    }
    if (has(enemy.buffs, "Stun")) {
      const kept: Buff[] = [];
      for (const b of enemy.buffs as Buff[]) {
        if (b.fid !== "Stun") {
          kept.push(b);
          continue;
        }
        b.rounds -= 1;
        if (b.rounds > 0) kept.push(b);
      }
      enemy.buffs = kept;
      enemy.g = 0;
      if (idx === 0) primary += 1;
      fireReactions("after_round", enemy, null, []);
      return;
    }
    const useUlt = enemy.cd <= 0 && enemy.ult;
    let sk: AnyRec | null;
    if (useUlt) {
      sk = enemy.ult;
      enemy.cd = Math.max(1, sk.cd - 1);
    } else {
      sk = enemy.basic;
      if (enemy.cd > 0) enemy.cd -= 1;
    }
    enemy.g = 0;
    if (sk) useBossSkill(enemy, sk);
    const kept: Buff[] = [];
    for (const b of enemy.buffs as Buff[]) {
      if (enemy.fresh.has(b.fid)) {
        kept.push(b);
        continue;
      }
      b.rounds -= 1;
      if (b.rounds > 0) kept.push(b);
    }
    enemy.buffs = kept;
    enemy.fresh.clear();
    if (idx === 0) primary += 1;
    fireReactions("after_round", enemy, sk, []);
  }

  for (const ally of allies) {
    if (ally.unit.start_heals?.length || ally.unit.start_shields?.length) {
      grantSupport(ally, { heals: ally.unit.start_heals, shields: ally.unit.start_shields }, false, BOSS_HP);
    }
  }

  while (primary < TURNS && steps < 8000 && !lost) {
    steps += 1;
    const readyA = allies.filter((a) => a.hp > 0 && a.g >= 1 - 1e-7);
    const readyE = enemies.filter((e) => e.g >= 1 - 1e-7);
    if (readyA.length) {
      allyAct(readyA[0]);
      continue;
    }
    if (readyE.length) {
      enemyAct(readyE[0], enemies.indexOf(readyE[0]));
      continue;
    }
    const times: number[] = [];
    for (const a of allies) if (a.hp > 0) times.push((1 - a.g) / (spd(a.unit.spd, a.buffs) / CURVE_SPD));
    for (const e of enemies) times.push((1 - e.g) / (spd(e.spd, e.buffs) / CURVE_SPD));
    if (!times.length) break;
    const dt = Math.max(0, Math.min(...times));
    for (const a of allies) if (a.hp > 0) a.g += dt * (spd(a.unit.spd, a.buffs) / CURVE_SPD);
    for (const e of enemies) e.g += dt * (spd(e.spd, e.buffs) / CURVE_SPD);
  }

  return {
    damage: allies.reduce((s, a) => s + a.damage, 0),
    heal: allies.reduce((s, a) => s + a.heal, 0),
    shield: allies.reduce((s, a) => s + a.shield, 0),
    taken: allies.reduce((s, a) => s + a.taken, 0),
    kills: enemies.reduce((s, e) => s + e.kills, 0),
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

export function simulate(ids: string[], stars: number[], nEnemies: number, bossId = "plain") {
  const units = ids.map((id, i) => (id ? data.units[id]?.[String(stars[i] || 5)] : null)).filter(Boolean);
  if (!units.length) return null;
  const boss = data.bosses[bossId] || data.bosses.plain;
  const enemies = nEnemies === 3 ? 3 : 1;
  const seed = units.reduce((s: number, u: AnyRec) => s + [...u.id].reduce((n, c) => n + c.charCodeAt(0), 0), 0) + enemies * 17 + [...boss.id].reduce((n: number, c: string) => n + c.charCodeAt(0), 0);
  const started = performance.now();
  let acc: any = null;
  for (let i = 0; i < RUNS; i++) {
    const one = fightOnce(units, enemies, new PyRandom(seed + i * 97), boss.id);
    if (!acc) {
      acc = one;
      continue;
    }
    acc.damage += one.damage;
    acc.heal += one.heal;
    acc.shield += one.shield;
    acc.taken += one.taken;
    acc.kills += one.kills;
    for (let t = 0; t < TURNS; t++) {
      acc.turns[t] += one.turns[t];
      acc.heal_turns[t] += one.heal_turns[t];
      acc.shield_turns[t] += one.shield_turns[t];
      for (let u = 0; u < acc.units.length; u++) {
        acc.units[u].turns[t] += one.units[u].turns[t];
        acc.units[u].heal_turns[t] += one.units[u].heal_turns[t];
        acc.units[u].shield_turns[t] += one.units[u].shield_turns[t];
      }
    }
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
  const round = (n: number) => Math.round(n / RUNS);
  for (const a of acc.units) {
    a.damage = round(a.damage);
    a.heal = round(a.heal);
    a.shield = round(a.shield);
    a.taken = round(a.taken);
    a.actions = round(a.actions);
    a.ults = round(a.ults);
    a.turns = a.turns.map((v: number) => round(v));
    a.heal_turns = a.heal_turns.map((v: number) => round(v));
    a.shield_turns = a.shield_turns.map((v: number) => round(v));
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
    turns: acc.turns.map((v: number) => round(v)),
    units: acc.units,
  };
}

export const roster = data.roster as any[];
export const bossList = data.bossList as any[];
export const bosses = data.bosses as Record<string, { hp: number; atk: number; defn: number; spd: number; tags?: { text: string; kind: string }[] }>;
export const leaders = data.leaders as any;
