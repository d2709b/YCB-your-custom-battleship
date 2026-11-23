'use strict';

var F = require("your-custom-battleship/hub");

var TS = F.TS;

var UnitBlockClass = Packages.mindustry.world.blocks.units.UnitBlock;
var PayloadBlockClass = Packages.mindustry.world.blocks.payloads.PayloadBlock;
var ReconstructorClass = Packages.mindustry.world.blocks.units.Reconstructor;
var UnitPayloadClass = Packages.mindustry.world.blocks.payloads.UnitPayload;
var UnitsClass = Packages.mindustry.entities.Units;

var DROP_SEARCH_TILES = 5;
var DROP_DUST_COLOR_MUL = 1.3;
var DROP_CARRY = 0.5;

function instanceOf(o, cls){
    try{ return o instanceof cls; }catch(e){ return false; }
}

function frontTakes(p, type){
    var f = null;
    try{ f = p.front(); }catch(e){ f = null; }
    if(f == null) return false;
    var blk = f.block;
    if(instanceOf(blk, ReconstructorClass)){
        if(f.relativeTo(p) == f.rotation) return false;
        return type != null && !!f.hasUpgrade(type);
    }
    if(instanceOf(blk, UnitBlockClass)) return false;
    return blk.acceptsPayload === true || blk.outputsPayload === true;
}

// A unit that reached the exit of a payload block with nothing in front would be put on the map by the game itself;
// in the pocket that fails, so the unit is handed to the real world here. A block payload is never dumped onto the
// ground by the game (Payload.dump() is false for it), so it simply stays inside, exactly as it does on land.
function payloadCheck(m, p, delta){
    var blk = p.block;
    if(!instanceOf(blk, PayloadBlockClass)) return null;
    var pl = p.payload;
    if(pl == null) return null;
    if(!instanceOf(pl, UnitPayloadClass)) return null;
    var unit = pl.unit;
    if(unit == null || unit.type == null) return null;
    if(instanceOf(blk, ReconstructorClass) && p.hasUpgrade(unit.type)) return null;
    if(frontTakes(p, unit.type)) return null;
    var dest = Tmp.v1.trns(p.rotdeg(), p.block.size * TS / 2);
    var speed = typeof blk.payloadSpeed === "number" ? blk.payloadSpeed : 0.7;
    var step = speed * p.delta();
    if(p.payVector.dst(dest) > step + 0.01) return null;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    var rec = {
        p: p, unit: unit,
        x: p.x + dest.x * c - dest.y * s,
        y: p.y + dest.x * s + dest.y * c,
        rot: pl.rotation() + m.ang
    };
    if(!UnitsClass.canCreate(unit.team, unit.type)) return null;
    p.payload = null;
    return rec;
}

function dropSpot(unit, x, y){
    var tx = Math.round(x / TS), ty = Math.round(y / TS);
    if(unit.canPass(tx, ty)) return [x, y];
    var best = null, bestD = 1e9;
    for(var dx = -DROP_SEARCH_TILES; dx <= DROP_SEARCH_TILES; dx++){
        for(var dy = -DROP_SEARCH_TILES; dy <= DROP_SEARCH_TILES; dy++){
            var d = dx * dx + dy * dy;
            if(d >= bestD || d > DROP_SEARCH_TILES * DROP_SEARCH_TILES) continue;
            if(Vars.world.tile(tx + dx, ty + dy) == null) continue;
            if(!unit.canPass(tx + dx, ty + dy)) continue;
            bestD = d;
            best = [(tx + dx) * TS, (ty + dy) * TS];
        }
    }
    return best;
}

function payloadRelease(m, r){
    var unit = r.unit, type = unit.type;
    var x = r.x, y = r.y;
    unit.rotation = r.rot;
    var flying = !!type.flying;
    if(!flying){
        var spot = dropSpot(unit, x, y);
        if(spot != null){ x = spot[0]; y = spot[1]; }
    }
    unit.set(x, y);
    unit.vel.set(0, 0);
    if(flying){
        unit.vel.set(m.vx || 0, m.vy || 0);
        unit.vel.add(Mathf.range(0.5), Mathf.range(0.5));
    }else{
        unit.vel.set((m.vx || 0) * DROP_CARRY, (m.vy || 0) * DROP_CARRY);
    }
    unit.add();
    try{ unit.unloaded(); }catch(e){  }
    try{ Events.fire(new Packages.mindustry.game.EventType.UnitUnloadEvent(unit)); }catch(e){  }
    try{ UnitsClass.notifyUnitSpawn(unit); }catch(e){  }
    if(!flying){
        try{
            var t = Vars.world.tileWorld(x, y);
            var col = Tmp.c1.set(t != null ? t.floor().mapColor : Color.gray).mul(DROP_DUST_COLOR_MUL);
            if(Vars.net.server()) Call.effect(Fx.unitLand, x, y, 0, col);
            else if(!Vars.headless) Fx.unitLand.at(x, y, 0, col);
        }catch(e){  }
    }
    try{ r.p.spawned(); }catch(e){ r.p.payload = null; }
}

function isPayloadBlock(p){
    return instanceOf(p.block, PayloadBlockClass);
}

F.isPayloadBlock = isPayloadBlock;
F.payloadCheck = payloadCheck;
F.payloadRelease = payloadRelease;
