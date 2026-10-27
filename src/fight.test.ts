import assert from "assert";
import { fightOnce, trialBoss } from "./fight";
import { PyRandom } from "./random";

const data = (globalThis as { __KAMI: any }).__KAMI;
const K = 2000;
const BOSS_DEF = 7680;
const POWER = 1.871;
const CRIT = 0.15 * 1.3 + 0.85 * (1 + 0.25 * (1.15 - 1));

function hit(atk: number, defense = BOSS_DEF, crit = CRIT) {
  return atk * (K / (K + defense)) * crit * POWER;
}

function blank(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    job: "Warrior",
    stars: 5,
    passive_on: false,
    hp: 5_000_000,
    atk: 3000,
    defn: 500_000,
    spd: 2600,
    perm_crit: 0,
    perm_atk: 0,
    hp_mods: [],
    basic_pen_ch: {},
    ult_pen_ch: {},
    basic_procs: [],
    adds: [],
    timed: [],
    life: [],
    start_statuses: [],
    start_pushes: [],
    turn_stacks: [],
    pinch_rate: 0,
    ult: null,
    basic: {
      id: `${id}-basic`,
      rate: 1,
      cd: 0,
      tgt: "One",
      camp: "",
      crit: 0,
      extra_turn: false,
      pens: [],
      conds: [],
      statuses: [],
      heals: [],
      shields: [],
      pushes: [],
      cleanses: [],
      pinches: [],
    },
    ...extra,
  };
}

function fight(units: ReturnType<typeof blank>[], element = "") {
  return fightOnce(units, 1, new PyRandom(1), "plain", false, element);
}

const tests: [string, () => void][] = [];
function test(name: string, fn: () => void) {
  tests.push([name, fn]);
}

test("a plain basic uses defense, the 1.871 multiplier, and the crit and big-hit average", () => {
  const one = fight([blank("solo")]);
  assert.equal(one.units[0].actions, 30);
  assert.equal(one.units[0].ults, 0);
  assert.ok(Math.abs(one.damage - 30 * hit(3000)) < 1e-6);
});

test("full crit replaces the average with 1.3 crit damage", () => {
  const one = fight([blank("crit", { perm_crit: 1 })]);
  assert.ok(Math.abs(one.damage - 30 * hit(3000, BOSS_DEF, 1.3)) < 1e-6);
});

test("element advantage adds 1.1 damage and 15% crit, and the weaker element is dodged", () => {
  const tank = { hp: 5_000_000, defn: 500_000 };
  const stronger = fight([blank("solo", { ...tank, el: "Ice" })], "Fire");
  const even = fight([blank("solo", { ...tank, el: "Ground" })], "Fire");
  assert.ok(stronger.damage > even.damage);
  assert.ok(stronger.taken < even.taken);
  const weaker = fight([blank("solo", { ...tank, el: "Earth" })], "Fire");
  assert.ok(weaker.damage < even.damage);
  assert.ok(weaker.taken > even.taken);
});

test("the boss scores the element it beats 80000 lower and the element that beats it 90000 higher", () => {
  const tank = { hp: 5_000_000, defn: 500_000 };
  const hunted = fight([blank("ice", { ...tank, el: "Ice" }), blank("earth", { ...tank, el: "Earth" })], "Fire");
  assert.ok(hunted.units.find((unit) => unit.id === "earth").taken > hunted.units.find((unit) => unit.id === "ice").taken);
  const avoided = fight([blank("ice", { ...tank, el: "Ice" }), blank("ground", { ...tank, el: "Ground" })], "Fire");
  assert.ok(avoided.units.find((unit) => unit.id === "ground").taken > avoided.units.find((unit) => unit.id === "ice").taken);
  const gap = fight([blank("ice", { ...tank, el: "Ice", hp: 5_000_000 }), blank("earth", { ...tank, el: "Earth", hp: 5_200_000 })], "Fire");
  assert.ok(gap.units.find((unit) => unit.id === "ice").taken > gap.units.find((unit) => unit.id === "earth").taken);
  const plainAim = fight([blank("ice", { el: "Ice", hp: 8_000_000 }), blank("earth", { el: "Earth", hp: 9_000_000 })]);
  assert.ok(plainAim.units.find((unit) => unit.id === "ice").taken > 0);
  assert.equal(plainAim.units.find((unit) => unit.id === "earth").taken, 0);
});

test("50% pierce halves defense before the K formula", () => {
  const unit = blank("pierce");
  unit.basic = { ...unit.basic, pens: [{ channel: 1, base: 0.5 }] };
  const one = fight([unit]);
  assert.ok(Math.abs(one.damage - 30 * hit(3000, BOSS_DEF * 0.5)) < 1e-6);
});

test("each other ally flanks a basic at their flank rate", () => {
  const caller = blank("caller");
  const partner = blank("partner", { pinch_rate: 1 });
  const flanked = fight([caller, partner]);
  const plain = fight([blank("a"), blank("b")]);
  assert.equal(flanked.units[0].actions, 30);
  assert.equal(flanked.units[1].actions, 30);
  assert.ok(Math.abs(flanked.damage - plain.damage * 1.5) < 1e-6);
});

test("a 100% skill flank adds one extra basic from the partner", () => {
  const caller = blank("caller");
  caller.basic = {
    ...caller.basic,
    pinches: [{ chance: 1, who: "random", noself: true, gate: null }],
  };
  const pinched = fight([caller, blank("partner")]);
  const plain = fight([blank("a"), blank("b")]);
  assert.equal(pinched.units[0].actions, 30);
  assert.equal(pinched.units[1].actions, 30);
  assert.ok(Math.abs(pinched.damage - plain.damage * 1.5) < 1e-6);
});

test("the plain boss and the level-80 curves match the client tables", () => {
  const boss = data.bosses.plain;
  assert.deepEqual(
    { hp: boss.hp, atk: boss.atk, defn: boss.defn, spd: boss.spd },
    { hp: 27600, atk: 3600, defn: 7680, spd: 2600 },
  );
  const resonance = data.units.C01_SR_001["5"];
  assert.equal(resonance.name, "Heartstring Resonance");
  assert.equal(resonance.hp, 18450);
  assert.equal(resonance.atk, 3375);
  assert.equal(resonance.defn, 2790);
  assert.equal(resonance.spd, 2000);
  const duet = data.units.C02_SSR_006["5"];
  assert.equal(duet.ult.cd, 4);
  assert.equal(duet.basic.rate, 0.4);
});

test("scripted flanks keep the rates written on the skill", () => {
  const byName = Object.fromEntries(data.roster.map((unit: { name: string; id: string }) => [unit.name, unit.id]));
  const years = data.units[byName["Years of Remembrance"]]["5"];
  const rainbound = data.units[byName["Rainbound Kiss"]]["5"];
  assert.deepEqual(years.basic.pinches, [{ chance: 0.3, who: "random", noself: true, gate: null }]);
  assert.equal(rainbound.basic_procs[0].pinches[0].chance, 1);
  assert.equal(rainbound.basic_procs[0].pinches[0].who, "highest");
  const plain = data.units.C01_SR_001["5"];
  assert.equal(plain.basic.pinches, undefined);
  assert.equal((plain.basic_procs || []).length, 0);
});

function ultOf(extra: Record<string, unknown>) {
  return {
    id: "ult",
    rate: 1,
    cd: 4,
    tgt: "One",
    camp: "",
    crit: 0,
    extra_turn: false,
    pens: [] as Record<string, unknown>[],
    conds: [],
    statuses: [],
    heals: [] as Record<string, unknown>[],
    shields: [],
    pushes: [] as Record<string, unknown>[],
    cleanses: [] as Record<string, unknown>[],
    ...extra,
  };
}

test("element bosses are the phantom trial units and neutral stays plain", () => {
  assert.equal(trialBoss(""), null);
  const ice = trialBoss("Ice");
  assert.equal(ice.name, "Lingering Warmth");
  assert.equal(ice.stage, 47);
  assert.equal(ice.hp, 27600 * 1.075);
  assert.equal(ice.atk, 3600 * 1.17);
  assert.equal(trialBoss("Fire").name, "Fearless Protection");
  assert.equal(trialBoss("Earth").name, "Hushaby Kiss");
  assert.equal(trialBoss("Ground").name, "Smoke and Flowers");
  const soft = blank("soft", { hp: 500000, atk: 1, defn: 0, spd: 100 });
  const plain = fight([soft]);
  const iced = fight([soft], "Ice");
  assert.ok(iced.units[0].taken > plain.units[0].taken);
  const glass = { hp: 1, atk: 1, defn: 0, spd: 1 };
  const held = fight([blank("held", glass)], "Ice");
  const marked = fight([blank("marked", { ...glass, start_statuses: [{ fid: "ReduceSpeed", chance: 1, rounds: 5 }] })], "Ice");
  assert.ok(Math.abs(marked.units[0].taken / held.units[0].taken - 1.44) < 0.02);
});

test("trial bosses ignore poison, stun, and taunt, and still take bleed", () => {
  const basicOf = (fid: string) => ({
    ...blank("x").basic,
    statuses: [{ fid, chance: 1, rounds: 2, count: 1, dot_rate: 0.15, is_buff: false, aim: "hit" }],
  });
  const poison = blank("poison", { atk: 0, spd: 8000, basic: basicOf("Poison") });
  assert.ok(fight([poison]).damage > 0);
  assert.equal(fight([poison], "Ice").damage, 0);
  assert.equal(fight([poison], "Fire").damage, 0);
  const stun = blank("stun", { atk: 0, spd: 8000, hp: 5_000_000, defn: 500_000, basic: basicOf("Stun") });
  const open = blank("open", { atk: 0, spd: 8000, hp: 5_000_000, defn: 500_000 });
  assert.ok(fight([stun]).taken < fight([open]).taken);
  assert.equal(fight([stun], "Ground").taken, fight([open], "Ground").taken);
  const tank = blank("tank", { hp: 5_000_000, atk: 0, spd: 8000, defn: 500_000, basic: basicOf("Taunt") });
  const squish = blank("squish", { hp: 4_000_000, atk: 0, spd: 8000, defn: 500_000 });
  const pulled = fight([tank, squish]);
  const ignored = fight([tank, squish], "Ice");
  assert.ok(pulled.units[0].taken > pulled.units[1].taken);
  assert.ok(ignored.units[1].taken > ignored.units[0].taken);
});

test("a pierce ultimate waits until the boss already has a debuff", () => {
  const held = blank("warmth", {
    ult: ultOf({ pens: [{ base: 0.3, per_debuff: 0.05, channel: 1 }] }),
  });
  assert.equal(fight([held]).units[0].ults, 0);
  held.basic = {
    ...held.basic,
    statuses: [{ fid: "Bleed", chance: 1, rounds: 2, count: 1, dot_rate: 0.15, is_buff: false, aim: "hit" }],
  };
  const opened = fight([held]);
  assert.ok(opened.units[0].ults > 0);
  assert.ok(opened.units[0].ults < opened.units[0].actions);
});

test("a heal with an attack buff casts immediately and a plain heal waits for half HP", () => {
  const rain = blank("rain", {
    ult: ultOf({
      rate: 0,
      statuses: [{ fid: "AddAttack", chance: 1, rounds: 2, is_buff: true, aim: "allies" }],
      heals: [{ rate: 0.07, aim: "allies" }],
    }),
  });
  assert.ok(fight([rain]).units[0].ults > 0);
  const heal = blank("heal", {
    ult: ultOf({ rate: 0, heals: [{ rate: 0.12, aim: "allies" }] }),
  });
  assert.equal(fight([heal]).units[0].ults, 0);
  const hurt = blank("hurt", {
    hp: 8000,
    defn: 0,
    ult: ultOf({ rate: 0, heals: [{ rate: 0.12, aim: "allies" }] }),
  });
  assert.ok(fight([hurt]).units[0].ults > 0);
});

test("a cleanse ultimate waits until an ally has a debuff", () => {
  const duet = blank("duet", {
    ult: ultOf({
      rate: 0,
      cleanses: [{ aim: "allies", count: -1 }],
      statuses: [{ fid: "Immune", chance: 1, rounds: 2, is_buff: true, aim: "allies" }],
      pushes: [{ value: 0.2, aim: "allies" }],
    }),
  });
  assert.equal(fight([duet]).units[0].ults, 0);
  duet.start_statuses = [{ fid: "ReduceSpeed", chance: 1, rounds: 2 }];
  assert.ok(fight([duet]).units[0].ults > 0);
});

test("heal over time is 6% of the unit who has it", () => {
  const self = blank("self", {
    hp: 10_000,
    defn: 0,
    spd: 4000,
    basic: { ...blank("self").basic, rate: 0 },
    start_statuses: [{ fid: "ContinuousHeal", rounds: 30, chance: 1 }],
  });
  const bulky = blank("bulky", {
    hp: 40_000,
    defn: 8000,
    spd: 1200,
    basic: { ...blank("bulky").basic, rate: 0 },
  });
  const one = fight([self, bulky]);
  assert.ok(one.units[0].heal > 0);
  assert.equal(one.units[1].heal, 0);
  assert.ok(Math.abs(one.units[0].heal / 600 - Math.round(one.units[0].heal / 600)) < 1e-6);
  assert.ok(one.units[0].heal < 600 * 40);
});

test("a heal is a percent of the caster's max HP", () => {
  const healer = blank("healer", {
    hp: 10000,
    atk: 1,
    defn: 8000,
    spd: 3500,
    basic: {
      id: "heal",
      rate: 0,
      cd: 1,
      tgt: "One",
      camp: "My",
      crit: 0,
      extra_turn: false,
      pens: [],
      conds: [],
      statuses: [],
      heals: [{ rate: 0.1, prop: "MaxHP", aim: "allies" }],
      shields: [],
      pushes: [],
      cleanses: [],
    },
  });
  const bulky = blank("bulky", { hp: 40000, atk: 1, defn: 500, spd: 1500 });
  const one = fightOnce([healer, bulky], 1, new PyRandom(1), "plain", false, "Fire");
  const casts = one.units[0].actions;
  assert.ok(one.heal > 0);
  assert.ok(one.heal < casts * 2000);
});

test("shackled blocks a skill's action gauge push", () => {
  const open = blank("open", { spd: 2200, attack_pushes: [{ value: 0.5 }] });
  const held = blank("held", {
    spd: 2200,
    attack_pushes: [{ value: 0.5 }],
    start_statuses: [{ fid: "Restrict", chance: 1, rounds: 99 }],
  });
  const openActs = fightOnce([open], 1, new PyRandom(2), "plain", false, "Fire").units[0].actions;
  const heldActs = fightOnce([held], 1, new PyRandom(2), "plain", false, "Fire").units[0].actions;
  assert.ok(heldActs < openActs);
});

test("accuracy down makes that unit's hits land for less", () => {
  const clear = blank("clear", { atk: 5000, spd: 2800, el: "Fire" });
  const blurred = blank("blurred", {
    atk: 5000,
    spd: 2800,
    el: "Fire",
    start_statuses: [{ fid: "DecreaseHitChance", chance: 1, rounds: 99 }],
  });
  const clearDmg = fightOnce([clear], 1, new PyRandom(4), "plain", false, "Fire").damage;
  const blurredDmg = fightOnce([blurred], 1, new PyRandom(4), "plain", false, "Fire").damage;
  assert.ok(blurredDmg < clearDmg);
});

test("an extra turn that requires a kill does not fire when the target lives", () => {
  const held = blank("held", { ult: ultOf({ rate: 0, extra_turn: true, extra_on_kill: true }) });
  const free = blank("free", { ult: ultOf({ rate: 0, extra_turn: true }) });
  const heldActs = fightOnce([held], 1, new PyRandom(1), "plain", false, "Fire", true).units[0].actions;
  const freeActs = fightOnce([free], 1, new PyRandom(1), "plain", false, "Fire", true).units[0].actions;
  assert.ok(heldActs < freeActs);
});

test("a forced elemental advantage hits harder than a disadvantage", () => {
  const plain = blank("plain", { el: "Earth", atk: 8000, spd: 3000 });
  const forced = blank("forced", {
    el: "Earth",
    atk: 8000,
    spd: 3000,
    basic: { ...plain.basic, force_advantage: true },
  });
  const weak = fightOnce([plain], 1, new PyRandom(3), "plain", false, "Fire").damage;
  const strong = fightOnce([forced], 1, new PyRandom(3), "plain", false, "Fire").damage;
  assert.ok(strong > weak);
});

test("a longer buff raises the turns left and does not stack", () => {
  const atkBuff = (rounds: number) => blank(`atk-${rounds}`, {
    atk: 8000,
    spd: 3000,
    perm_crit: 1,
    basic: {
      ...blank(`atk-${rounds}`).basic,
      statuses: [{ fid: "AddAttack", rounds, chance: 1, is_buff: true, aim: "self" }],
    },
  });
  const short = fight([atkBuff(1)]).damage;
  const longer = fight([atkBuff(2)]).damage;
  const permanent = fight([blank("perm", { atk: 8000, spd: 3000, perm_crit: 1, perm_atk: 0.2 })]).damage;
  assert.ok(longer > short * 1.05);
  assert.ok(longer < permanent * 1.05);
  const guard = (rounds: number) => blank(`def-${rounds}`, {
    hp: 500_000,
    defn: 3000,
    spd: 3000,
    basic: {
      ...blank(`def-${rounds}`).basic,
      rate: 0,
      statuses: [{ fid: "AddDefence", rounds, chance: 1, is_buff: true, aim: "self" }],
    },
  });
  assert.ok(fight([guard(2)]).taken < fight([guard(1)]).taken);
});

test("attack down and defense down keep one copy and take the longer duration", () => {
  const debuff = (fid: string, rounds: number) => ({ fid, rounds, chance: 1, is_buff: false, aim: "hit" });
  const caster = (fid: string, rounds: number) => blank(`${fid}-${rounds}`, {
    atk: 8000,
    spd: 3000,
    perm_crit: 1,
    basic: { ...blank(fid).basic, statuses: [debuff(fid, rounds)] },
  });
  const open = fight([blank("open", { atk: 8000, spd: 3000, perm_crit: 1 })]).damage;
  const defense = fight([caster("ReduceDef", 30)]).damage / open;
  const oneShred = hit(8000, BOSS_DEF * 0.8, 1.3) / hit(8000, BOSS_DEF, 1.3);
  const capShred = hit(8000, BOSS_DEF * 0.25, 1.3) / hit(8000, BOSS_DEF, 1.3);
  assert.ok(defense < (oneShred + capShred) / 2);
  assert.ok(fight([caster("ReduceDef", 2)]).damage > fight([caster("ReduceDef", 1)]).damage);
  const bleed = (id: string, rounds: number, every: boolean) => blank(id, {
    atk: 8000,
    spd: 3000,
    perm_crit: 1,
    ult: every ? null : ultOf({ cd: 30, statuses: [{ fid: "Bleed", rounds, chance: 1, is_buff: false, aim: "hit", count: 1, dot_rate: 0.15 }] }),
    basic: {
      ...blank(id).basic,
      statuses: every ? [{ fid: "Bleed", rounds, chance: 1, is_buff: false, aim: "hit", count: 1, dot_rate: 0.15 }] : [],
    },
  });
  assert.ok(fight([bleed("often", 2, true)]).damage > fight([bleed("once", 2, false)]).damage * 1.08);
});

test("a shield lasts its turn count and a hit can break it early", () => {
  const wall = blank("wall", {
    hp: 5_000_000,
    defn: 500_000,
    spd: 4000,
    basic: { ...blank("wall").basic, rate: 0 },
    start_shields: [{ rate: 0.5, prop: "MaxHP", aim: "self", rounds: 2 }],
  });
  const once = fight([wall]);
  assert.ok(once.units[0].shield > once.units[0].taken);
  assert.equal(once.units[0].shield_left, 0);
  const refreshed = blank("refreshed", {
    hp: 5_000_000,
    defn: 500_000,
    spd: 4000,
    basic: {
      ...blank("refreshed").basic,
      rate: 0,
      shields: [{ rate: 0.5, prop: "MaxHP", aim: "self", rounds: 2 }],
    },
  });
  assert.ok(fight([refreshed]).units[0].shield_left > 0);
  const kept = blank("kept", {
    hp: 5_000_000,
    defn: 500_000,
    spd: 4000,
    basic: {
      ...blank("kept").basic,
      rate: 0,
      shields: [{ rate: 0.5, prop: "MaxHP", aim: "self", rounds: 2 }],
    },
    start_shields: [{ rate: 0.1, prop: "MaxHP", aim: "self", rounds: 1 }],
  });
  const renewed = fight([kept]);
  assert.equal(renewed.units[0].shield, 500_000);
  assert.ok(renewed.units[0].shield_left > 400_000 && renewed.units[0].shield_left < 500_000);
  const cracked = blank("cracked", {
    hp: 20_000,
    defn: 0,
    spd: 100,
    basic: { ...blank("cracked").basic, rate: 0 },
    start_shields: [{ rate: 0.01, prop: "MaxHP", aim: "self", rounds: 2 }],
  });
  const broken = fight([cracked]);
  assert.ok(broken.units[0].taken > 0);
  assert.equal(broken.units[0].shield_left, 0);
});

test("a trial clear ends when the boss dies instead of refilling the boss", () => {
  const killer = blank("killer", { hp: 500000, atk: 8000, defn: 5000, spd: 3000 });
  const once = fightOnce([killer], 1, new PyRandom(1), "plain", false, "Fire", true);
  assert.equal(once.kills, 1);
  assert.ok(once.units[0].hp_left > 0);
  assert.ok(fight([killer], "Fire").kills > 1);
  const glass = blank("glass", { hp: 500, atk: 1, defn: 0, spd: 100 });
  const wiped = fightOnce([glass], 1, new PyRandom(1), "plain", false, "Fire", true);
  assert.equal(wiped.kills, 0);
  assert.ok(wiped.units[0].hp_left <= 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${tests.length} passed`);
