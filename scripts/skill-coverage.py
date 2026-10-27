#!/usr/bin/env python3
"""Check every character skill against the catalog.

The rules are effect types, not unit names. A new unit passes when its skills
use effects the fight already runs. A new effect type fails until the fight
learns that type.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "/Users/antho/Desktop/kamikoi-sim")
import sim10

SKILL_BUNDLE = Path(
    "/Users/antho/Desktop/kamikoi-new/files/UnityCache/Shared/"
    "9cf32802ff220f12b19714ff574670a7/bb7bc84c534662547023a5398b905213/__data"
)
CATALOG = Path("/Users/antho/Desktop/kamikoi-calc/public/catalog.js")

# Condition and bookkeeping names. They are not a separate fight action.
CHECKS = {
    "IsMainRound", "IsNormalSkill", "IsDamageSkill", "IsNoDamageSkill",
    "CheckSkillCooldown", "ReSetSkillCoolDown", "HaveBuff", "AnyAllyHaveBuff",
    "SkillID", "FunID", "IsDiffCamp", "IsSameCamp", "IsNoSelf", "IsPinch",
    "TargetIsAll", "TargetIsOne", "CheckSkillNoUse", "No", "MainActionType",
    "Position", "IsCriticalHit",
}

# Effect types the fight has a field for. Anything else is a gap.
EFFECTS = {
    "AddStatus", "AddTime", "AddHP", "AddRound", "RemoveBuf", "RemoveDeBuf",
    "RemoveBufsByID", "AdditionSkill", "AddSkillCoolDown", "AddAllSkillCoolDown",
    "ReplaceSkill", "CounterSkill", "AddPinchSkill", "Revive", "DirectRevive",
    "ImmortalAddHP", "ForceConquer", "RandomAddStatus", "TransferBuff",
    "TransferDeBuff", "TransferBuffFrom", "SplitDamage", "AddAllBuffRound",
    "AddAllDeBuffRound",
}


def catalog():
    raw = CATALOG.read_text()
    return json.loads(raw[raw.index("{"):].rstrip().rstrip(";"))


def skills():
    rows = sim10.rows(str(SKILL_BUNDLE), "ID@NAME")
    return {row["ID"]: row for row in rows if re.match(r"C0[1-4]_(SSR|SR|R)_\d+", row["ID"])}


def unit_id(sid):
    match = re.match(r"(C0[1-4]_(?:SSR|SR|R)_\d+)", sid)
    return match.group(1) if match else ""


def funs(blob):
    return set(re.findall(r'Fun:"([^"]+)"', blob))


def windows(blob, key):
    return sim10.windows(blob, key)


def head(window):
    return sim10.fun_head(window)


def fnum(text, pattern, default=None):
    match = re.search(pattern, text)
    return float(match.group(1)) if match else default


def addition_chance(window):
    text = head(window)
    mark = text.find("RateConvert:")
    if mark >= 0:
        brace = text.find("{", mark)
        depth = 0
        end = len(text)
        for index in range(brace, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    end = index
                    break
        body = text[brace + 1:end]
        base = fnum(body, r"Base:([0-9.]+)", 0.0)
        return base
    return fnum(text, r"(?<![A-Za-z])Rate:([0-9.]+)", 1.0)


def kill_gated(window):
    text = head(window)
    return 'Property:"NowHP"' in text and 'Comparer:"Lt"' in text and re.search(r"Value:0(?![0-9.])", text)


def skill_copies(data, sid):
    found = []
    row = data["skills"].get(sid)
    if isinstance(row, dict):
        found.append(row)
    uid = unit_id(sid)
    for star in (data["units"].get(uid) or {}).values():
        if not isinstance(star, dict):
            continue
        for key in ("basic", "ult", "buff_basic", "pinch_basic"):
            skill = star.get(key)
            if isinstance(skill, dict) and skill.get("id") == sid:
                found.append(skill)
    return found


def star5(data, uid):
    return (data["units"].get(uid) or {}).get("5") or {}


def close(left, right):
    return abs(float(left) - float(right)) < 1e-6


def check(data, table):
    gaps = []
    for sid, row in sorted(table.items()):
        blob = sim10.blob_of(row)
        if not blob:
            continue
        unknown = sorted(funs(blob) - CHECKS - EFFECTS)
        for name in unknown:
            gaps.append(f"{sid} uses {name}, and the fight has no behavior for it")
        unit = star5(data, unit_id(sid))
        copies = skill_copies(data, sid)
        for window in windows(blob, "AdditionSkill"):
            text = head(window)
            fid = re.search(r'FID:"([^"]+)"', text)
            if not fid:
                continue
            chance = addition_chance(window)
            adds = unit.get("adds") or []
            match = next((add for add in adds if add.get("fid") == fid.group(1)), None)
            if match is None or not close(match.get("chance", 1), chance):
                gaps.append(f"{sid} follow-up {fid.group(1)} should happen {chance:g} of the time")
        for window in windows(blob, "AddRound"):
            if not kill_gated(window):
                continue
            if not copies or not all(skill.get("extra_on_kill") for skill in copies):
                gaps.append(f"{sid} extra turn is only when the target is defeated")
        if windows(blob, "ForceConquer") or 'Trigger:"ForceConquer"' in blob:
            if not copies or not all(skill.get("force_advantage") for skill in copies):
                gaps.append(f"{sid} always has an elemental advantage")
        for window in windows(blob, "RandomAddStatus"):
            text = head(window)
            listed = re.search(r"FIDs:\[([^\]]*)\]", text)
            if not listed:
                continue
            expected = re.findall(r'"([^"]+)"', listed.group(1))
            found = []
            for skill in copies:
                for status in skill.get("statuses") or []:
                    if status.get("fids"):
                        found.append(sorted(status["fids"]))
            for timed in unit.get("timed") or []:
                for effect in timed.get("effects") or []:
                    if effect.get("op") == "random" and effect.get("fids"):
                        found.append(sorted(effect["fids"]))
            if sorted(expected) not in found:
                gaps.append(f"{sid} random effect is missing its choices")
        for window in windows(blob, "AddTime"):
            text = head(window)
            if "IsDamageSkill" not in text or 'Target:"Self"' not in text:
                continue
            if "AnyOneAfterSkillHit" in text:
                continue
            value = fnum(text, r"Value:(-?[0-9.]+)")
            if value is None:
                continue
            pushes = unit.get("attack_pushes") or []
            if not any(close(push.get("value", 0), value) for push in pushes):
                gaps.append(f"{sid} should push the action gauge by {value:g} after a damaging skill")
        for name, kind in (("AddAllBuffRound", "buff"), ("AddAllDeBuffRound", "debuff")):
            for window in windows(blob, name):
                text = head(window)
                value = fnum(text, r"Value:(-?[0-9.]+)", 0)
                aim = "allies" if 'TargetCamp:"My"' in text else "enemies"
                if 'Target:"Self"' in text:
                    aim = "self"
                shifts = []
                for skill in copies:
                    shifts.extend(skill.get("round_shifts") or [])
                for proc in unit.get("basic_procs") or []:
                    if proc.get("sid") == sid:
                        shifts.extend(proc.get("round_shifts") or [])
                for timed in unit.get("timed") or []:
                    for effect in timed.get("effects") or []:
                        if effect.get("op") == "extend" and kind == "debuff":
                            shifts.append({"kind": "debuff", "aim": "enemies", "value": effect.get("value")})
                if not any(shift.get("kind") == kind and shift.get("aim") == aim and close(shift.get("value", 0), value) for shift in shifts):
                    gaps.append(f"{sid} should change {kind} duration by {value:g} on {aim}")
        for name, what, source in (("TransferBuff", "buff", "target"), ("TransferDeBuff", "debuff", "self")):
            if not windows(blob, name):
                continue
            moves = []
            for skill in copies:
                moves.extend(skill.get("moves") or [])
            if not any(move.get("what") == what and move.get("from") == source for move in moves):
                gaps.append(f"{sid} should move a {what}")
        dumped = json.dumps(unit)
        cast_blob = sim10.without_held(blob)
        for window in windows(cast_blob, "AddStatus"):
            text = head(window)
            found = re.search(r'FID:"([^"]+)"', text)
            if not found or found.group(1) == "RandomAddStatus":
                continue
            fid = found.group(1)
            if fid == "Shield":
                body = re.search(r"ValueConvert:\{([^{}]*)\}", text)
                rate_m = re.search(r"Rate:([0-9.]+)", body.group(1) if body else text)
                rounds_m = re.search(r"StatusRound:(\d+)", text)
                rate = float(rate_m.group(1)) if rate_m else 0
                rounds = int(rounds_m.group(1)) if rounds_m else 2
                shields = []
                for key in ("basic", "ult", "buff_basic"):
                    shields.extend((unit.get(key) or {}).get("shields") or [])
                for proc in unit.get("basic_procs") or []:
                    if proc.get("sid") == sid:
                        shields.extend(proc.get("shields") or [])
                shields.extend(unit.get("start_shields") or [])
                shields.extend(unit.get("before_shields") or [])
                shields.extend(unit.get("after_shields") or [])
                for timed in unit.get("timed") or []:
                    shields.extend(effect for effect in timed.get("effects") or [] if effect.get("op") == "shield")
                for react in unit.get("reactions") or []:
                    for op in react.get("ops") or []:
                        if op and op[0] == "shield":
                            shields.append({"rate": op[1], "rounds": react.get("shield_rounds") or 2})
                if not any(close(row.get("rate") or 0, rate) and int(row.get("rounds") or 2) == rounds for row in shields):
                    gaps.append(f"{sid} shield of {rate:g} for {rounds} turns is missing")
                continue
            if fid not in dumped:
                gaps.append(f"{sid} status {fid} is missing")
            else:
                chance_text = re.sub(r"StatusValue:\{[^{}]*\}", "", text)
                chance_m = re.search(r"(?<![A-Za-z])Rate:([0-9.]+)", chance_text)
                chance = float(chance_m.group(1)) if chance_m else 1.0
                rounds_m = re.search(r"StatusRound:(\d+)", text)
                stored = []
                for key in ("basic", "ult", "buff_basic"):
                    stored.extend((unit.get(key) or {}).get("statuses") or [])
                for proc in unit.get("basic_procs") or []:
                    stored.extend(proc.get("statuses") or [])
                stored.extend(unit.get("start_statuses") or [])
                for row in unit.get("timed") or []:
                    for effect in row.get("effects") or []:
                        if effect.get("op") == "status" and effect.get("fid"):
                            stored.append(effect)
                same = [row for row in stored if row.get("fid") == fid]
                if same and not any(abs(float(row.get("chance") or 1) - chance) < 1e-6 for row in same):
                    gaps.append(f"{sid} {fid} chance should be {chance:g}")
                if rounds_m and same and not any(int(row.get("rounds") or 0) == int(rounds_m.group(1)) for row in same):
                    gaps.append(f"{sid} {fid} should last {rounds_m.group(1)} turns")
        if "TransferBuffFrom" in blob:
            pulls = []
            for proc in unit.get("basic_procs") or []:
                if proc.get("sid") == sid and proc.get("transfer_from"):
                    pulls.append(proc["transfer_from"])
            if not pulls:
                gaps.append(f"{sid} should move buffs from the target onto the team")
        try:
            import teamfight
            cd = int(sim10.fnum(row.get("CoolDown"), 0))
            for react in teamfight.reactions_from(blob, sid, cd):
                ops = {op for op, _ in (react.get("ops") or [])}
                found = False
                for have in unit.get("reactions") or []:
                    have_ops = {op for op, _ in (have.get("ops") or [])}
                    if ops <= have_ops and have.get("kind") == react.get("kind"):
                        found = True
                if not found:
                    gaps.append(f"{sid} reaction {react.get('kind')} is missing")
            for timed in teamfight.timed_from(blob, sid, cd):
                if not any(item.get("when") == timed["when"] for item in unit.get("timed") or []):
                    gaps.append(f"{sid} {timed['when']} effect is missing")
        except Exception as error:
            gaps.append(f"{sid} reaction check failed: {error}")
        for window in windows(blob, "SplitDamage"):
            value = fnum(head(window), r"Value:([0-9.]+)", 0)
            share = unit.get("share") or {}
            if not close(share.get("rate", 0), value):
                gaps.append(f"{sid} should take {value:g} of an ally's damage")
    for uid, stars in data["units"].items():
        unit = stars.get("5")
        if not isinstance(unit, dict):
            continue
        lists = {
            "start": unit.get("start_shields") or [],
            "before": unit.get("before_shields") or [],
            "after": unit.get("after_shields") or [],
            "basic": (unit.get("basic") or {}).get("shields") or [],
            "ult": (unit.get("ult") or {}).get("shields") or [],
        }
        for proc in unit.get("basic_procs") or []:
            lists[proc.get("sid") or "proc"] = proc.get("shields") or []
        for name, rows in lists.items():
            seen = set()
            for row in rows:
                key = json.dumps(row, sort_keys=True, default=str)
                if key in seen:
                    gaps.append(f"{uid} stores the {name} shield more than once")
                    break
                seen.add(key)
        timed_rates = [effect.get("rate") for timed in unit.get("timed") or [] for effect in timed.get("effects") or [] if effect.get("op") == "shield"]
        after_rates = [shield.get("rate") for shield in unit.get("after_shields") or []]
        if set(timed_rates) & set(after_rates):
            gaps.append(f"{uid} applies an end-of-turn shield twice")
    gaps.extend(invented(data, table))
    gaps.extend(aims(data, table))
    return gaps


def same_aim(stored, expected):
    if stored == expected:
        return True
    return {stored, expected} == {"hit", "select"}


def aims(data, table):
    """A stored heal, shield, or status must name the same recipient as the skill row."""
    gaps = []
    seen = set()
    for sid, row in sorted(table.items()):
        blob = sim10.without_held(sim10.blob_of(row))
        if not blob:
            continue
        uid = unit_id(sid)
        unit = star5(data, uid) or (data["units"].get(uid) or {}).get("3") or {}
        if not isinstance(unit, dict):
            continue
        owners = []
        for key in ("basic", "ult", "buff_basic"):
            skill = unit.get(key) or {}
            if skill.get("id") == sid:
                owners.append(skill)
        for proc in unit.get("basic_procs") or []:
            if proc.get("sid") == sid:
                owners.append(proc)
        if not owners:
            continue
        for window in windows(blob, "AddStatus"):
            text = head(window)
            found = re.search(r'FID:"([^"]+)"', text)
            if not found or found.group(1) in ("Shield", "RandomAddStatus"):
                continue
            expected = sim10.aim_of(text)
            rows = [status for owner in owners for status in (owner.get("statuses") or []) if status.get("fid") == found.group(1)]
            if rows and not any(same_aim(status.get("aim"), expected) for status in rows):
                key = (sid, found.group(1), expected)
                if key not in seen:
                    seen.add(key)
                    gaps.append(f"{sid} {found.group(1)} should land on {expected}")
        for window in windows(blob, "AddHP"):
            text = head(window)
            expected = sim10.aim_of(text)
            rows = [heal for owner in owners for heal in (owner.get("heals") or [])]
            if rows and not any(same_aim(heal.get("aim"), expected) for heal in rows):
                key = (sid, "heal", expected)
                if key not in seen:
                    seen.add(key)
                    gaps.append(f"{sid} heal should land on {expected}")
        for window in windows(blob, "AddStatus"):
            text = head(window)
            if 'FID:"Shield"' not in text:
                continue
            expected = sim10.aim_of(text)
            rows = [shield for owner in owners for shield in (owner.get("shields") or [])]
            if rows and not any(same_aim(shield.get("aim"), expected) for shield in rows):
                key = (sid, "shield", expected)
                if key not in seen:
                    seen.add(key)
                    gaps.append(f"{sid} shield should land on {expected}")
    return gaps


def grants(blob, fid):
    return f'FID:"{fid}"' in blob


def justified(table, uid, sid, fid, own_blob):
    if grants(own_blob, fid):
        return True
    if not sid:
        return False
    mark = f'CheckID:"{sid}"'
    for other, row in table.items():
        if not other.startswith(uid):
            continue
        blob = sim10.blob_of(row)
        if mark in blob and grants(blob, fid):
            return True
    return False


def invented(data, table):
    """A status saved on a unit must be granted by that skill row.

    The other direction catches a skill effect the fight dropped. This one
    catches an effect the fight file added, including one stuck on the wrong skill.
    """
    gaps = []
    seen = set()

    def blob_of(sid):
        row = table.get(sid or "")
        return sim10.blob_of(row) if row else ""

    def flag(name, where, sid, fid):
        key = (name, where, sid, fid)
        if key in seen:
            return
        seen.add(key)
        gaps.append(f"{name} stores {fid} on {where} {sid}, and that skill row does not grant it")

    for uid, stars in data["units"].items():
        if not isinstance(stars, dict):
            continue
        unit_blobs = [sim10.blob_of(row) for sid, row in table.items() if sid.startswith(uid)]
        for unit in stars.values():
            if not isinstance(unit, dict):
                continue
            name = unit.get("name") or uid
            for key in ("basic", "ult", "buff_basic"):
                skill = unit.get(key) or {}
                sid = skill.get("id") or ""
                blob = blob_of(sid)
                for status in skill.get("statuses") or []:
                    fid = status.get("fid")
                    if fid and not justified(table, uid, sid, fid, blob):
                        flag(name, key, sid, fid)
            for proc in unit.get("basic_procs") or []:
                sid = proc.get("sid") or ""
                blob = blob_of(sid)
                for status in proc.get("statuses") or []:
                    fid = status.get("fid")
                    if fid and not justified(table, uid, sid, fid, blob):
                        flag(name, "passive", sid, fid)
            for status in unit.get("start_statuses") or []:
                fid = status.get("fid")
                if not fid:
                    continue
                token = f'FID:"{fid}"'
                if not any(token in blob and "StartBattle" in blob for blob in unit_blobs):
                    flag(name, "battle start", uid, fid)
    return gaps


def main():
    data = catalog()
    table = skills()
    gaps = check(data, table)
    if gaps:
        print(f"{len(gaps)} skill checks failed")
        for gap in gaps:
            print(f"  {gap}")
        return 1
    print(f"skill coverage ok, {len(table)} character skills")
    return 0


if __name__ == "__main__":
    sys.exit(main())
