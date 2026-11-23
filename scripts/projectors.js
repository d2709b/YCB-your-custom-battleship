'use strict';

var F = require("your-custom-battleship/hub");

var onEvent = F.onEvent, TS = F.TS;

function gameClass(get){
    try{
        var c = get();
        return typeof c === "function" ? c : null;
    }catch(e){
        return null;
    }
}
var MendType = gameClass(() => Packages.mindustry.world.blocks.defense.MendProjector);
var OverdriveType = gameClass(() => Packages.mindustry.world.blocks.defense.OverdriveProjector);
var RegenType = gameClass(() => Packages.mindustry.world.blocks.defense.RegenProjector);

var FAR = -1000000;

var counters = {};

function num(v, d){
    var n = +v;
    return isNaN(n) ? d : n;
}

function read(o, name, d){
    var v;
    try{ v = o[name]; }catch(e){ return d; }
    if(typeof v === "function"){
        try{ v = v.call(o); }catch(e2){ return d; }
    }
    return num(v, d);
}

function isInst(obj, type){
    if(type == null) return false;
    try{ return obj instanceof type; }catch(e){ return false; }
}

function kindOf(p){
    var blk = p.block;
    if(isInst(blk, MendType)) return "mend";
    if(isInst(blk, OverdriveType)) return "over";
    if(isInst(blk, RegenType)) return "regen";
    return null;
}

function isProjector(p){
    try{ return kindOf(p) != null; }catch(e){ return false; }
}

// The game finds the blocks a regen projector heals through the block indexer, which does not know ship blocks:
// without targets it never consumes anything. So its target list is filled here and the game itself does the healing.
function regenTargets(m, p){
    var half = num(p.block.range, 28) * 4;
    var list = p.targets;
    list.clear();
    for(var i = 0; i < m.parts.length; i++){
        var o = m.parts[i];
        if(o.dead) continue;
        var reach = half + o.block.size * TS / 2;
        if(Math.abs(o.x - p.x) <= reach && Math.abs(o.y - p.y) <= reach) list.add(o);
    }
    p.lastChange = Vars.world.tileChanges;
}

function projBefore(m, p){
    var kind = null;
    try{ kind = kindOf(p); }catch(e){ kind = null; }
    if(kind == null) return null;
    if(kind == "regen"){
        regenTargets(m, p);
        return {kind: kind};
    }
    var tok = {kind: kind, x: p.x, y: p.y};
    p.x = FAR;
    p.y = FAR;
    return tok;
}

function inRange(p, o, range){
    var dx = o.x - p.x, dy = o.y - p.y;
    var r = range + o.block.size * TS / 2;
    return dx * dx + dy * dy <= r * r;
}

function counterOf(p, reload){
    var c = counters[p.id];
    if(c === undefined){
        c = {charge: Math.random() * reload};
        counters[p.id] = c;
    }
    return c;
}

function mendFire(m, p){
    var blk = p.block;
    var phaseHeat = num(p.phaseHeat, 0);
    var range = num(blk.range, 12) + phaseHeat * num(blk.phaseRangeBoost, 0);
    var amount = (num(blk.healPercent, 12) + phaseHeat * num(blk.phaseBoost, 0)) / 100 * num(p.efficiency, 0);
    if(!(amount > 0)) return;
    m.parts.forEach(o => {
        if(o.dead || !o.damaged()) return;
        try{ if(o.isHealSuppressed()) return; }catch(e){  }
        if(!inRange(p, o, range)) return;
        o.heal(read(o, "maxHealth", o.block.health) * amount);
        try{ o.recentlyHealed(); }catch(e){  }
        if(F.netFx != null) F.netFx(4, o.x, o.y, o.block.size, o.block.id);
        if(!Vars.headless){
            try{ Fx.healBlockFull.at(o.x, o.y, o.block.size, blk.baseColor, o.block); }catch(e){  }
        }
    });
}

function overFire(m, p){
    var blk = p.block;
    var phaseHeat = num(p.phaseHeat, 0);
    var range = num(blk.range, 80) + phaseHeat * num(blk.phaseRangeBoost, 0);
    var boost = (num(blk.speedBoost, 1.5) + phaseHeat * num(blk.speedBoostPhase, 0)) * num(p.efficiency, 0);
    if(!(boost > 0)) return;
    var duration = num(blk.reload, 60) + 1;
    m.parts.forEach(o => {
        if(o.dead || !o.block.canOverdrive) return;
        if(!inRange(p, o, range)) return;
        o.applyBoost(boost, duration);
    });
}

function projAfter(m, p, tok, delta){
    if(tok.kind == "regen") return;
    p.x = tok.x;
    p.y = tok.y;
    var d = num(delta, 1);
    var blk = p.block;
    var eff = num(p.efficiency, 0);
    var reload = num(blk.reload, tok.kind == "mend" ? 200 : 60);
    var c = counterOf(p, reload);
    var heat = num(p.heat, eff > 0 ? 1 : 0);
    if(tok.kind == "mend") c.charge += heat * d * read(p, "timeScale", 1);
    else c.charge += heat * d;
    if(c.charge < reload) return;
    c.charge = 0;
    if(tok.kind == "mend") mendFire(m, p);
    else overFire(m, p);
}

function forgetCounters(){ counters = {}; }
onEvent(ResetEvent, () => { forgetCounters(); });

F.projBefore = projBefore;
F.projAfter = projAfter;
F.isProjector = isProjector;
