#!/usr/bin/env python3
"""Write the browser catalog. The Unity bundles stay on this machine."""
import json
import os
import sys

sys.path[:0] = ["/Users/antho/Desktop/kamikoi-sim"]
import sim10
import teamfight


def conv(value):
    if isinstance(value, tuple):
        return [conv(item) for item in value]
    if isinstance(value, dict):
        return {str(key): conv(item) for key, item in value.items()}
    if isinstance(value, list):
        return [conv(item) for item in value]
    if isinstance(value, set):
        return [conv(item) for item in value]
    return value


units = {}
if not teamfight.ascend_blobs():
    raise SystemExit(
        "refusing to write the catalog: the star-upgrade table loaded 0 rows, "
        "so a rebuild would drop those effects"
    )
for role_id in teamfight.ROLES:
    units[role_id] = {str(stars): conv(teamfight.unit_for(role_id, stars)) for stars in range(1, 6)}

skills = {}
for sid, sk in sim10.skills.items():
    if not sid.startswith("C0"):
        continue
    packed = teamfight.pack_skill(sk)
    if packed:
        skills[sid] = conv(packed)

statuses = {}
for fid, row in sim10.status_rows.items():
    mods = {key: value for key, value in sim10.status_mods(fid).items() if isinstance(value, (int, float))}
    statuses[fid] = {
        "buff": row.get("IsBuffType") == "Buff",
        "typed": bool(row.get("IsBuffType")),
        "mods": mods,
        "hit": teamfight._hit_value(fid),
        "maxStack": int(float(row.get("MaxStack") or 0) or 0),
        "resident": str(row.get("IsResident")).lower() in ("true", "1"),
        "keep": teamfight._keep_buff(fid),
        "immortal": teamfight._immortal_row(fid),
        "aura": "AddPinchSkill" in (row.get("DynamicField1") or ""),
        "inStat": fid in sim10.STAT,
        "dot": (sim10.STAT.get(fid) or {}).get("dot"),
        "rounds": int((sim10.STAT.get(fid) or {}).get("rounds") or 2),
        "life": conv(teamfight.status_life(fid)),
        "shown": teamfight._shown_buff(fid),
    }

with open("/Users/antho/Desktop/kamikoi-sim/leaders.json", encoding="utf-8") as handle:
    leaders = json.load(handle)

catalog = {
    "roster": conv(teamfight.roster()),
    "units": units,
    "skills": skills,
    "statuses": statuses,
    "bosses": {bid: conv(boss) for bid, boss in teamfight.BOSS_BY_ID.items()},
    "bossList": conv(teamfight.bosses()),
    "leaders": {
        "all": leaders.get("pools", {}).get("all") or leaders.get("boards"),
        "released": leaders.get("pools", {}).get("released") or {"1": [], "3": []},
    },
}
path = "/Users/antho/Desktop/kamikoi-calc/public/catalog.js"
with open(path, "w", encoding="utf-8") as handle:
    handle.write("/* Generated from the local fight. Loaded as a plain script. */\n")
    handle.write("window.__KAMI = ")
    json.dump(catalog, handle, ensure_ascii=False, separators=(",", ":"))
    handle.write(";\n")
print("wrote", path, os.path.getsize(path))
