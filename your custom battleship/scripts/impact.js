'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var AIR_BASE_TICKS = F.AIR_BASE_TICKS, AIR_MAX_TICKS = F.AIR_MAX_TICKS, AIR_MIN_TICKS = F.AIR_MIN_TICKS,
    AIR_SPEED_MUL_MAX = F.AIR_SPEED_MUL_MAX, AIR_SPEED_MUL_MIN = F.AIR_SPEED_MUL_MIN, AIR_SPEED_REF = F.AIR_SPEED_REF,
    AIR_SQRT_TICKS = F.AIR_SQRT_TICKS, DEBRIS_FALL_SPEEDUP = F.DEBRIS_FALL_SPEEDUP, LAND_KILL_LOSS = F.LAND_KILL_LOSS, TS = F.TS;
var logErr = F.logErr, onEvent = F.onEvent;
var blockRot = F.blockRot, centerOf = F.centerOf, components = F.components, coverTiles = F.coverTiles, isTurret = F.isTurret;
var driverType = F.driverType;
var makePocket = F.makePocket, setPartsReal = F.setPartsReal, toLocal = F.toLocal, toWorld = F.toWorld, withPocket = F.withPocket;
var placeInPocket = F.placeInPocket;
var blastOf = F.blastOf, queueBlast = F.queueBlast;

var DEBRIS_MARGIN = 1;

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function ease(p){ return p * p * (3 - 2 * p); }

function resolveCrush(units, loss){
    var order = units.slice().sort((a, b) => a.hp - b.hp);
    var out = [];
    order.forEach(u => {
        if(!(u.hp > 0)) return;
        var live = u.touch.filter(w => !w.broken && w.hp > 0);
        if(live.length == 0) return;
        var sum = 0;
        live.forEach(w => { sum += w.hp; });
        if(sum > u.hp){
            var f = Math.min(1, u.hp * loss / sum);
            live.forEach(w => { w.hp = Math.min(w.hp, Math.max(1, w.hp * (1 - f))); });
            out.push({unit: u, kill: true, dealt: u.hp});
        }else{
            live.forEach(w => { w.hp = 0; w.broken = true; });
            out.push({unit: u, kill: false, dealt: sum});
        }
    });
    return out;
}

function resolveDrop(units){
    units.forEach(u => u.touch.forEach(w => { w.n = (w.n || 0) + 1; }));
    var out = [];
    units.forEach(u => {
        if(!(u.hp > 0)) return;
        var dealt = 0;
        u.touch.forEach(w => { if(w.hp > 0) dealt += w.hp / w.n; });
        if(dealt > 0) out.push({unit: u, kill: dealt >= u.hp, dealt: dealt});
    });
    return out;
}

function isEnemyTeam(team, other){
    return other.id != team.id && other.id != Team.derelict.id;
}

function hittable(u){
    if(u == null || u.type == driverType) return false;
    if(!u.isValid()) return false;
    return !u.isFlying();
}

function unitRadius(u){
    var r = 8;
    try{ r = u.hitSize / 2; }catch(e){ r = 4; }
    return r > 1 ? r : 1;
}

function collectUnits(team, x0, y0, x1, y1){
    var res = {enemies: [], others: []};
    Groups.unit.each(cons(u => {
        try{
            if(!hittable(u)) return;
            var r = unitRadius(u);
            if(u.x < x0 - r || u.x > x1 + r || u.y < y0 - r || u.y > y1 + r) return;
            var rec = {u: u, r: r, hp: u.health + u.shield, touch: []};
            if(isEnemyTeam(team, u.team)) res.enemies.push(rec); else res.others.push(rec);
        }catch(e){
            logErr("impact unit", e);
        }
    }));
    return res;
}

function blockTouches(b, lx, ly, r){
    var cov = coverTiles(b);
    for(var i = 0; i < cov.length; i++){
        var cx = Point2.x(cov[i]) * TS, cy = Point2.y(cov[i]) * TS;
        var dx = Math.max(Math.abs(lx - cx) - TS / 2, 0), dy = Math.max(Math.abs(ly - cy) - TS / 2, 0);
        if(dx * dx + dy * dy < r * r) return true;
    }
    return false;
}

function hitFx(u){
    if(F.netFx != null) F.netFx(1, u.x, u.y, 0, 0);
    if(Vars.headless) return;
    try{ Fx.explosion.at(u.x, u.y); }catch(e){  }
}

function applyToUnit(r){
    var u = r.unit.u;
    try{
        if(!u.isValid()) return;
        if(r.kill){
            u.damagePierce(r.unit.hp + 1);
            if(u.isValid()) u.kill();
        }else{
            u.damagePierce(Math.min(r.dealt, Math.max(0, r.unit.hp - 0.01)));
        }
        hitFx(u);
    }catch(e){
        logErr("impact damage", e);
    }
}

function blowPart(owner, b, wx, wy){
    if(b.dead) return;
    var bl = null;
    try{
        b.set(wx, wy);
        try{ bl = blastOf(b); }catch(e){ logErr("blowPart blast", e); }
        b.onDestroyed();
    }catch(e){
        logErr("blowPart", e);
    }
    b.dead = true;
    try{ withPocket(owner, () => { if(b.tile != null && b.tile.build === b) b.tile.setBlock(Blocks.air); }, true); }catch(e){ logErr("blowPart clear", e); }
    var i = owner.parts.indexOf(b);
    if(i >= 0) owner.parts.splice(i, 1);
    delete S.partIndex[b.id];
    delete S.bstates[b.id];
    if(owner.hull === b) owner.hull = null;
    if(bl != null){
        try{ queueBlast(wx, wy, bl); }catch(e){ logErr("blowPart queueBlast", e); }
        if(F.netFx != null) F.netFx(3, wx, wy, bl.radius, bl.expl);
    }
}

function footprintTouches(cells, x, y, r){
    var tx0 = Math.round((x - r) / TS) - 1, tx1 = Math.round((x + r) / TS) + 1;
    var ty0 = Math.round((y - r) / TS) - 1, ty1 = Math.round((y + r) / TS) + 1;
    for(var tx = tx0; tx <= tx1; tx++){
        for(var ty = ty0; ty <= ty1; ty++){
            if(!cells[Point2.pack(tx, ty)]) continue;
            var dx = Math.max(Math.abs(x - tx * TS) - TS / 2, 0), dy = Math.max(Math.abs(y - ty * TS) - TS / 2, 0);
            if(dx * dx + dy * dy <= r * r) return true;
        }
    }
    return false;
}

function pushOut(rec, cells){
    var u = rec.u, r = rec.r + 1;
    try{ if(u.type.hovering === true) return; }catch(e){  }
    if(!footprintTouches(cells, u.x, u.y, r)) return;
    var cx = Math.round(u.x / TS), cy = Math.round(u.y / TS);
    for(var rad = 1; rad <= 14; rad++){
        var best = null, bd = 1e9;
        for(var dx = -rad; dx <= rad; dx++){
            for(var dy = -rad; dy <= rad; dy++){
                if(Math.max(Math.abs(dx), Math.abs(dy)) != rad) continue;
                var x = (cx + dx) * TS, y = (cy + dy) * TS;
                if(footprintTouches(cells, x, y, r)) continue;
                var t = Vars.world.tile(cx + dx, cy + dy);
                if(t == null || t.solid()) continue;
                var d = dx * dx + dy * dy;
                if(d < bd){ bd = d; best = [x, y]; }
            }
        }
        if(best != null){
            u.set(best[0], best[1]);
            try{ u.vel.setZero(); }catch(e){  }
            return;
        }
    }
}

// Enemy ground units under landing blocks fight them by health before the blocks are placed.
function landImpact(m, off, q){
    if(m.mode != "fly" || m.parts.length == 0) return;
    q = q | 0;
    var rc = F.landCell(q, off, m.ref[0], m.ref[1]);
    m.x = rc[0] * TS;
    m.y = rc[1] * TS;
    var parts = m.parts.filter(b => !b.dead);
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    parts.forEach(b => coverTiles(b).forEach(p => {
        var gc = F.landCell(q, off, Point2.x(p), Point2.y(p));
        var wx = gc[0] * TS, wy = gc[1] * TS;
        if(wx < x0) x0 = wx;
        if(wx > x1) x1 = wx;
        if(wy < y0) y0 = wy;
        if(wy > y1) y1 = wy;
    }));
    var found = collectUnits(m.team, x0 - TS / 2, y0 - TS / 2, x1 + TS / 2, y1 + TS / 2);
    if(found.enemies.length == 0 && found.others.length == 0) return;

    var list = parts.map(b => ({b: b, hp: b.health, broken: false}));
    found.enemies.forEach(rec => {
        var back = F.rotXY(-q, rec.u.x - off[0] * TS, rec.u.y - off[1] * TS);
        var lx = back[0], ly = back[1];
        list.forEach(w => { if(blockTouches(w.b, lx, ly, rec.r)) rec.touch.push(w); });
    });
    var fighting = found.enemies.filter(rec => rec.touch.length > 0);
    resolveCrush(fighting, LAND_KILL_LOSS).forEach(applyToUnit);
    list.forEach(w => {
        if(w.broken){
            var c = centerOf(w.b);
            var gc2 = F.landCell(q, off, c[0], c[1]);
            blowPart(m, w.b, gc2[0] * TS, gc2[1] * TS);
        }else if(w.hp !== w.b.health){
            w.b.health = w.hp;
        }
    });

    if(found.others.length > 0){
        var cells = {};
        m.parts.forEach(b => { if(!b.dead) coverTiles(b).forEach(p => { var gc3 = F.landCell(q, off, Point2.x(p), Point2.y(p)); cells[Point2.pack(gc3[0], gc3[1])] = true; }); });
        found.others.forEach(rec => { try{ pushOut(rec, cells); }catch(e){ logErr("impact pushOut", e); } });
    }
}

function crashImpact(m, off, q){
    if(m.mode != "fly" || m.parts.length == 0) return;
    q = q | 0;
    var list = m.parts.filter(b => !b.dead).map(b => ({b: b, hp: b.health, broken: false}));
    var grounds = {}, order = [];
    list.forEach(w => {
        var hard = false, seen = {};
        var bl = w.b.block;
        coverTiles(w.b).forEach(p => {
            var gc = F.landCell(q, off, Point2.x(p), Point2.y(p));
            var x = gc[0], y = gc[1];
            var t = Vars.world.tile(x, y);
            if(t == null){ hard = true; return; }
            var f = t.floor();
            if(f.solid || (f.isDeep() && !(bl.floating || bl.placeableLiquid || bl.requiresWater)) || Vars.world.getDarkness(x, y) >= 3){ hard = true; return; }
            var gb = t.build;
            if(gb != null){
                var rec = grounds[gb.id];
                if(rec === undefined){
                    rec = {build: gb, hp: gb.health, touch: []};
                    grounds[gb.id] = rec;
                    order.push(rec);
                }
                if(!seen[gb.id]){ seen[gb.id] = true; rec.touch.push(w); }
            }else{
                var ground = t.block();
                if(ground != Blocks.air && !ground.alwaysReplace) hard = true;
            }
        });
        if(hard){ w.broken = true; w.hp = 0; }
    });
    resolveCrush(order, LAND_KILL_LOSS).forEach(r => {
        try{
            if(r.kill) r.unit.build.kill();
            else r.unit.build.damage(r.dealt);
        }catch(e){
            logErr("crash ground", e);
        }
    });
    list.forEach(w => {
        if(w.broken){
            var c = centerOf(w.b);
            var gc4 = F.landCell(q, off, c[0], c[1]);
            blowPart(m, w.b, gc4[0] * TS, gc4[1] * TS);
        }else if(w.hp !== w.b.health){
            w.b.health = w.hp;
        }
    });
}

function detachVelocity(m){
    if(m.air != null && m.mvx !== undefined) return [m.mvx, m.mvy];
    return [m.vx, m.vy];
}

function fallDuration(cells, tiles){
    var speedMul = tiles <= 0.001 ? AIR_SPEED_MUL_MAX : clamp(Math.sqrt(AIR_SPEED_REF / tiles), AIR_SPEED_MUL_MIN, AIR_SPEED_MUL_MAX);
    var normal = clamp(AIR_BASE_TICKS + AIR_SQRT_TICKS * Math.sqrt(Math.max(1, cells)), AIR_MIN_TICKS, AIR_MAX_TICKS) * speedMul;
    return Math.max(4, normal / DEBRIS_FALL_SPEEDUP);
}

function finishDebris(d){
    var parts = d.parts;
    d.turrets = parts.filter(isTurret);
    d.drawList = parts.filter(b => !isTurret(b));
    d.drawFlag = d.drawList.map(b => F.drawFlagOf(b));
    d.drawLayer = d.drawList.map(b => b.block.drawCached === true ? b.block.buildingCacheLayer.layer : 0);
    var r = 8;
    parts.forEach(b => {
        var c = centerOf(b);
        var dd = Math.sqrt(Math.pow((c[0] - d.ref[0]) * TS, 2) + Math.pow((c[1] - d.ref[1]) * TS, 2)) + b.block.size * TS * 0.75;
        if(dd > r) r = dd;
    });
    d.radius = r;
    setPartsReal(d);
}

// Turns a group of detached blocks into a falling piece of debris with its own pocket.
function makeDebris(m, comp, v, tiles){
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, cells = 0, sx = 0, sy = 0;
    comp.forEach(b => {
        coverTiles(b).forEach(p => {
            var x = Point2.x(p), y = Point2.y(p);
            if(x < minX) minX = x;
            if(x > maxX) maxX = x;
            if(y < minY) minY = y;
            if(y > maxY) maxY = y;
        });
        var a = b.block.size * b.block.size, c = centerOf(b);
        cells += a;
        sx += c[0] * a;
        sy += c[1] * a;
    });
    var cx = sx / cells, cy = sy / cells;
    var wp = toWorld(m, cx * TS, cy * TS);
    var d = {
        debris: true, id: S.nextId++, team: comp[0].team, mode: "fly",
        pocket: null, parts: [], hull: null, off: [0, 0], realTiles: Vars.world.tiles,
        ref: [cx - minX + DEBRIS_MARGIN, cy - minY + DEBRIS_MARGIN],
        x: wp[0], y: wp[1], ang: m.ang, vx: v[0], vy: v[1], radius: 8,
        oreCache: {}, oreStamp: 0, lastOre: [0, 0, 0], fires: {}, fireCount: 0, turrets: [], boosters: [], front: 1,
        air: {kind: "fall", t: 0, dur: fallDuration(cells, tiles), alt: 1}
    };
    makePocket(d, maxX - minX + 1 + 2 * DEBRIS_MARGIN, maxY - minY + 1 + 2 * DEBRIS_MARGIN);

    var plans = comp.map(b => ({
        block: b.block, team: b.team, rot: blockRot(b), b: b,
        px: b.tile.x - minX + DEBRIS_MARGIN, py: b.tile.y - minY + DEBRIS_MARGIN
    }));
    var wasBusy = S.busy;
    S.busy = true;
    try{
        withPocket(m, () => {
            comp.forEach(b => b.pickedUp());
            comp.forEach(b => b.tile.setBlock(Blocks.air));
        }, true);
        comp.forEach(b => b.afterPickedUp());
        withPocket(d, () => { plans.forEach(p => placeInPocket(d, p)); }, true);
    }finally{
        S.busy = wasBusy;
    }
    var gone = {};
    comp.forEach(b => { gone[b.id] = true; delete S.partIndex[b.id]; });
    m.parts = m.parts.filter(b => !gone[b.id]);
    d.parts = comp;
    finishDebris(d);
    S.debris.push(d);
    if(F.netDebris != null) F.netDebris(d);
    return d;
}

// Detaches blocks from a flying machine; they fall as debris.
function detachParts(m, list){
    if(m.mode != "fly" || m.pocket == null) return;
    list = list.filter(b => !b.dead && m.parts.indexOf(b) >= 0);
    if(list.length == 0) return;
    var v = detachVelocity(m);
    var tiles = 0;
    try{ tiles = F.flightSpeed(m); }catch(e){ tiles = 0; }
    components(list).forEach(comp => {
        try{
            makeDebris(m, comp, v, tiles);
        }catch(e){
            logErr("makeDebris", e);
        }
    });
}

// Ids of blocks that have a tile inside the drop-zone radius of any ground spawn.
function zoneHits(blocks, spawns, radius){
    var out = [];
    if(!(radius > 0) || spawns.length == 0) return out;
    var r2 = radius * radius;
    blocks.forEach(bl => {
        var hit = false;
        for(var i = 0; i < bl.pts.length && !hit; i++){
            for(var j = 0; j < spawns.length && !hit; j++){
                var dx = bl.pts[i][0] - spawns[j][0], dy = bl.pts[i][1] - spawns[j][1];
                if(dx * dx + dy * dy <= r2) hit = true;
            }
        }
        if(hit) out.push(bl.id);
    });
    return out;
}

function groundSpawns(){
    var out = [];
    try{
        var list = Vars.spawner.getSpawns();
        for(var i = 0; i < list.size; i++){
            var t = list.get(i);
            out.push([t.worldx(), t.worldy()]);
        }
    }catch(e){
        logErr("groundSpawns", e);
    }
    return out;
}

// On wave start, tears off flying blocks inside the drop zone; they fall like any detached block.
function dropZoneStrike(){
    if(Vars.net.client() || Vars.state.rules == null) return 0;
    var radius = Vars.state.rules.dropZoneRadius;
    var spawns = groundSpawns();
    if(!(radius > 0) || spawns.length == 0) return 0;
    var waveTeam = Vars.state.rules.waveTeam, total = 0;
    F.flyingMachines().forEach(m => {
        if(m.pocket == null || m.team === waveTeam) return;
        try{
            var byId = {};
            var blocks = m.parts.filter(b => !b.dead).map(b => {
                byId[b.id] = b;
                return {id: b.id, pts: coverTiles(b).map(q => toWorld(m, Point2.x(q) * TS, Point2.y(q) * TS))};
            });
            var ids = zoneHits(blocks, spawns, radius);
            if(ids.length == 0) return;
            var hit = ids.map(id => byId[id]);
            if(hit.some(b => b === m.hull)) m.hull = null;
            detachParts(m, hit);
            hit.forEach(b => { if(!b.dead && m.parts.indexOf(b) >= 0) F.damagePart(m, b, 1e9); });
            total += hit.length;
            var drivers = F.driversOfMachine(m);
            F.flyReconcile(m);
            drivers.forEach(d => F.sayToDriver(d, "mb.msg.dropzone", hit.length));
        }catch(e){
            logErr("dropZoneStrike", e);
        }
    });
    return total;
}

onEvent(WaveEvent, () => { dropZoneStrike(); });

function debrisHit(d, parts){
    var reach = d.radius + 16;
    var found = collectUnits(d.team, d.x - reach, d.y - reach, d.x + reach, d.y + reach);
    if(found.enemies.length == 0) return;
    var list = parts.map(b => ({b: b, hp: b.health, broken: false}));
    found.enemies.forEach(rec => {
        var l = toLocal(d, rec.u.x, rec.u.y);
        list.forEach(w => { if(blockTouches(w.b, l[0], l[1], rec.r)) rec.touch.push(w); });
    });
    resolveDrop(found.enemies.filter(rec => rec.touch.length > 0)).forEach(applyToUnit);
}

function landDebris(d){
    var i = S.debris.indexOf(d);
    if(i < 0) return;
    S.debris.splice(i, 1);
    var parts = d.parts.filter(b => !b.dead);
    setPartsReal(d);
    try{ debrisHit(d, parts); }catch(e){ logErr("debrisHit", e); }
    parts.forEach(b => {
        var w = toWorld(d, b.tile.drawx(), b.tile.drawy());
        blowPart(d, b, w[0], w[1]);
    });
    d.parts = [];
}

function debrisTick(delta){
    if(S.debris.length == 0) return;
    var maxX = (Vars.world.width() - 1) * TS, maxY = (Vars.world.height() - 1) * TS;
    S.debris.slice().forEach(d => {
        try{
            var a = d.air;
            a.t += delta;
            var p = Math.min(1, a.t / a.dur);
            a.alt = 1 - ease(p);
            d.x = clamp(d.x + d.vx * delta, 0, maxX);
            d.y = clamp(d.y + d.vy * delta, 0, maxY);
            setPartsReal(d);
            if(p >= 1) landDebris(d);
        }catch(e){
            logErr("debris", e);
            var k = S.debris.indexOf(d);
            if(k >= 0) S.debris.splice(k, 1);
        }
    });
}

function clientDebrisTick(delta){
    if(S.debris.length == 0) return;
    var maxX = (Vars.world.width() - 1) * TS, maxY = (Vars.world.height() - 1) * TS;
    S.debris.slice().forEach(d => {
        var k = S.debris.indexOf(d);
        try{
            var a = d.air;
            a.t += delta;
            var p = Math.min(1, a.t / a.dur);
            a.alt = 1 - ease(p);
            d.x = clamp(d.x + d.vx * delta, 0, maxX);
            d.y = clamp(d.y + d.vy * delta, 0, maxY);
            setPartsReal(d);
            if(p >= 1 && k >= 0) S.debris.splice(k, 1);
        }catch(e){
            logErr("client debris", e);
            if(k >= 0) S.debris.splice(k, 1);
        }
    });
}

onEvent(WorldLoadEvent, () => { S.debris = []; });
onEvent(ResetEvent, () => { S.debris = []; });

F.landImpact = landImpact;
F.resolveCrush = resolveCrush;
F.resolveDrop = resolveDrop;
F.fallDuration = fallDuration;
F.crashImpact = crashImpact;
F.detachParts = detachParts;
F.zoneHits = zoneHits;
F.dropZoneStrike = dropZoneStrike;
F.debrisTick = debrisTick;
F.clientDebrisTick = clientDebrisTick;
F.finishDebris = finishDebris;
