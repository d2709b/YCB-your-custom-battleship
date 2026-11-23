'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var TS = F.TS;
var normAngle = F.normAngle;
var centerOf = F.centerOf, coverTiles = F.coverTiles, isTurret = F.isTurret;
var isBooster = F.isBooster;
var isDrillBlock = F.isDrillBlock, isPumpBlock = F.isPumpBlock, ruleFilter = F.ruleFilter;
var machineStats = F.machineStats, reindexAll = F.reindexAll;

function mkPocketTile(m, x, y){
    return extend(Tile, x, y, {
        fireChanged(){},
        firePreChanged(){},
        recache(){},
        recacheWall(){},
        changeBuild(team, prov, rot){
            this.build = null;
            if(this.block.hasBuilding()) this.build = prov.get().init(this, team, false, rot);
        },
        // Blocks measure angles and distances to a tile through getX / getY; for a block in the pocket that must be its real position.
        getX(){ var b = this.build; return b != null && b.tile === this ? b.x : this.drawx(); },
        getY(){ var b = this.build; return b != null && b.tile === this ? b.y : this.drawy(); },
        drop(){ return oreAt(m, this); },
        floor(){
            var f = liquidFloorAt(m, this);
            return f != null ? f : Blocks.stone;
        }
    });
}

// The pocket is a private tile array that holds the blocks of one flying machine.
function makePocket(m, w, h){
    m.pocket = new Tiles(w, h);
    for(var x = 0; x < w; x++){
        for(var y = 0; y < h; y++) m.pocket.set(x, y, mkPocketTile(m, x, y));
    }
    m.pw = w;
    m.ph = h;
}

// Runs fn with world.tiles swapped to the pocket, so block logic only sees the machine's own blocks.
function withPocket(m, fn, structural){
    var w = Vars.world, old = w.tiles, hd = Vars.headless;
    if(old === m.pocket) return fn();
    m.realTiles = old;
    w.tiles = m.pocket;
    S.inPocketOp++;
    if(structural) Vars.headless = true;
    try{
        return fn();
    }finally{
        if(structural) Vars.headless = hd;
        S.inPocketOp--;
        w.tiles = old;
    }
}

function toWorld(m, px, py){
    var lx = px - m.ref[0] * TS, ly = py - m.ref[1] * TS;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    return [m.x + lx * c - ly * s, m.y + lx * s + ly * c];
}

function toLocal(m, wx, wy){
    var dx = wx - m.x, dy = wy - m.y;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    return [m.ref[0] * TS + dx * c + dy * s, m.ref[1] * TS - dx * s + dy * c];
}

function setAng(m, ang){
    var delta = ang - m.ang;
    if(delta != 0 && m.mode == "fly"){
        for(var i = 0; i < m.parts.length; i++){
            var b = m.parts[i];
            if(isTurret(b)) b.rotation = b.rotation + delta;
        }
    }
    m.ang = normAngle(ang);
}

function oreAt(m, tile){
    var key = tile.x * 1024 + tile.y;
    var bd = tile.build, bid = bd == null ? 0 : bd.id;
    var c = m.oreCache[key];
    if(c !== undefined && c.stamp == m.oreStamp && c.bid === bid) return c.item;
    var allow = bd != null && isDrillBlock(bd.block) ? ruleFilter(m, bd) : null;
    var item = sampleOre(m, tile.x, tile.y, allow);
    m.oreCache[key] = {stamp: m.oreStamp, item: item, bid: bid};
    return item;
}

function clippedArea(poly, bx0, by0, bx1, by1){
    var edges = [[0, bx0, 1], [0, bx1, -1], [1, by0, 1], [1, by1, -1]];
    var pts = [];
    for(var i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
    for(var e = 0; e < 4; e++){
        var ax = edges[e][0], lim = edges[e][1], sg = edges[e][2];
        var out = [];
        for(var k = 0; k < pts.length; k++){
            var p = pts[k], q = pts[(k + 1) % pts.length];
            var pin = (p[ax] - lim) * sg >= 0, qin = (q[ax] - lim) * sg >= 0;
            if(pin) out.push(p);
            if(pin != qin){
                var t = (lim - p[ax]) / (q[ax] - p[ax]);
                out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            }
        }
        pts = out;
        if(pts.length < 3) return 0;
    }
    var area = 0;
    for(var j = 0; j < pts.length; j++){
        var u = pts[j], v = pts[(j + 1) % pts.length];
        area += u[0] * v[1] - v[0] * u[1];
    }
    return Math.abs(area) / 2;
}

function cellOverlaps(m, tx, ty){
    var rt = m.realTiles, out = [];
    if(rt == null || m.mode != "fly") return out;
    var poly = [], minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    var cs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for(var i = 0; i < 4; i++){
        var w = toWorld(m, (tx + cs[i][0]) * TS, (ty + cs[i][1]) * TS);
        var wx = w[0] / TS, wy = w[1] / TS;
        poly.push(wx, wy);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
    for(var kx = Math.round(minX); kx <= Math.round(maxX); kx++){
        for(var ky = Math.round(minY); ky <= Math.round(maxY); ky++){
            var t = rt.get(kx, ky);
            if(t == null) continue;
            var ar = clippedArea(poly, kx - 0.5, ky - 0.5, kx + 0.5, ky + 0.5);
            if(ar >= 0.001) out.push({t: t, a: ar});
        }
    }
    return out;
}

function liquidFloorAt(m, tile){
    var key = "L" + (tile.x * 1024 + tile.y);
    var bd = tile.build, bid = bd == null ? 0 : bd.id;
    var c = m.oreCache[key];
    if(c !== undefined && c.stamp == m.oreStamp && c.bid === bid) return c.floor;
    var allow = bd != null && isPumpBlock(bd.block) ? ruleFilter(m, bd) : null;
    var areas = {}, floors = {}, best = null, bestA = 0;
    cellOverlaps(m, tile.x, tile.y).forEach(o => {
        var f = o.t.floor();
        if(f == null || f.liquidDrop == null) return;
        if(allow != null && !allow(f.liquidDrop)) return;
        areas[f.id] = (areas[f.id] || 0) + o.a;
        floors[f.id] = f;
    });
    for(var id in areas){
        if(areas[id] > bestA){ bestA = areas[id]; best = floors[id]; }
    }
    m.oreCache[key] = {stamp: m.oreStamp, floor: best, bid: bid};
    return best;
}

function sampleOre(m, tx, ty, allow){
    var areas = {}, items = {};
    cellOverlaps(m, tx, ty).forEach(o => {
        var d = o.t.drop();
        if(d == null) return;
        if(allow != null && !allow(d)) return;
        areas[d.id] = (areas[d.id] || 0) + o.a;
        items[d.id] = d;
    });
    var best = null, bestA = 0;
    for(var id in areas){
        var it = items[id], a = areas[id];
        var better = best == null
            || (best.lowPriority && !it.lowPriority)
            || (best.lowPriority == it.lowPriority && (a > bestA + 1e-6 || (Math.abs(a - bestA) <= 1e-6 && it.id < best.id)));
        if(better){ best = it; bestA = a; }
    }
    return best;
}

function refreshOre(m){
    m.oreStamp++;
    withPocket(m, () => {
        m.parts.forEach(b => {
            if(b.block instanceof Drill || isPumpBlock(b.block)) b.onProximityUpdate();
        });
    }, false);
    refreshAttributes(m);
    m.lastOre = [m.x, m.y, m.ang];
}

function gameClassOf(get){
    try{
        var c = get();
        return typeof c === "function" ? c : null;
    }catch(e){
        return null;
    }
}
var ThermalType = gameClassOf(() => Packages.mindustry.world.blocks.power.ThermalGenerator);
var AttrCrafterType = gameClassOf(() => Packages.mindustry.world.blocks.production.AttributeCrafter);
var SolidPumpType = gameClassOf(() => Packages.mindustry.world.blocks.production.SolidPump);

function isInstOf(obj, type){
    if(type == null) return false;
    try{ return obj instanceof type; }catch(e){ return false; }
}

function attrField(blk){
    if(isInstOf(blk, ThermalType)) return "sum";
    if(isInstOf(blk, AttrCrafterType)) return "attrsum";
    if(isInstOf(blk, SolidPumpType)) return "boost";
    return null;
}

function attrSumFor(m, b, attr){
    var blk = b.block, total = 0;
    var deepZero = !blk.floating && !blk.placeableLiquid;
    var cov = coverTiles(b);
    for(var i = 0; i < cov.length; i++){
        var ov = cellOverlaps(m, Point2.x(cov[i]), Point2.y(cov[i]));
        for(var j = 0; j < ov.length; j++){
            var f = ov[j].t.floor();
            if(f == null || (deepZero && f.isDeep())) continue;
            total += ov[j].a * f.attributes.get(attr);
        }
    }
    return total;
}

function refreshAttributes(m){
    if(m.mode != "fly" || m.realTiles == null) return;
    for(var i = 0; i < m.parts.length; i++){
        var b = m.parts[i];
        if(b.dead) continue;
        var field = attrField(b.block);
        if(field == null) continue;
        try{
            var attr = b.block.attribute;
            if(attr == null) continue;
            var sum = attrSumFor(m, b, attr);
            b[field] = field == "boost" ? sum / (b.block.size * b.block.size) : sum;
        }catch(e){
            F.logErr("attribute sum " + b.block.name, e);
        }
    }
}

var ConduitType = gameClassOf(() => Packages.mindustry.world.blocks.liquid.Conduit);
var BuildTurretType = gameClassOf(() => Packages.mindustry.world.blocks.defense.BuildTurret);
var D4X = [1, 0, -1, 0], D4Y = [0, 1, 0, -1];

// A build tower rebuilds blocks of the real map, so it has to update outside the pocket.
function updatesInWorld(b){ return BuildTurretType != null && isInstOf(b.block, BuildTurretType); }

function isLeakConduit(b){
    return b.block.size == 1 && isInstOf(b.block, ConduitType);
}

// A conduit that ends in empty space spills its liquid on the tile in front of it. Inside the pocket that tile is a pocket
// tile, so the puddle would appear at the pocket's own coordinates; this moves it to the ground below the ship.
function relocatePuddles(m){
    var list = m.leakParts;
    if(list == null || list.length == 0 || m.mode != "fly" || m.pocket == null) return;
    var found = null;
    withPocket(m, () => {
        for(var i = 0; i < list.length; i++){
            var b = list[i];
            if(b.dead) continue;
            var t = m.pocket.get(b.tile.x + D4X[b.rotation & 3], b.tile.y + D4Y[b.rotation & 3]);
            if(t == null || t.build != null) continue;
            var p = Puddles.get(t);
            if(p == null) continue;
            Puddles.remove(t);
            if(found == null) found = [];
            found.push([t, p]);
        }
    }, false);
    if(found == null) return;
    for(var k = 0; k < found.length; k++){
        var tile = found[k][0], pud = found[k][1];
        var w = toWorld(m, tile.x * TS, tile.y * TS);
        var rt = Vars.world.tileWorld(w[0], w[1]);
        var ex = rt == null ? null : Puddles.get(rt);
        if(rt != null && ex == null){
            pud.tile = rt;
            pud.set(w[0], w[1]);
            Puddles.register(pud);
        }else{
            if(ex != null && ex.liquid === pud.liquid) ex.amount = Math.min(Puddles.maxLiquid, ex.amount + pud.amount);
            withPocket(m, () => { pud.remove(); }, false);
        }
    }
}

var ForceType = (function(){
    try{
        var c = Packages.mindustry.world.blocks.defense.ForceProjector;
        return typeof c === "function" ? c : null;
    }catch(e){
        return null;
    }
})();

function isShieldPart(b){
    try{ return ForceType != null && b.block instanceof ForceType; }catch(e){ return false; }
}

function drawFlagOf(b){
    return (b.block.drawCached === true ? 1 : 0) | (b.block.drawDynamic !== false ? 2 : 0) | (isShieldPart(b) ? 4 : 0);
}

function partsChanged(m){
    m.pivotDirty = true;
    m.netRev = (m.netRev | 0) + 1;
    m.turrets = m.parts.filter(isTurret);
    m.boosters = m.parts.filter(isBooster);
    m.magnets = F.isMagnet == null ? [] : m.parts.filter(F.isMagnet);
    m.updList = m.parts.filter(b => b.block.update === true);
    m.updProj = m.updList.map(b => F.isProjector(b));
    m.updPay = m.updList.map(b => F.isPayloadBlock(b));
    m.updReal = m.updList.map(updatesInWorld);
    partsOffsets(m);
    m.realKey = null;
    m.stats = machineStats(m);
    m.drawList = m.parts.filter(b => !isTurret(b));
    m.drawFlag = m.drawList.map(drawFlagOf);
    m.shields = m.parts.filter(isShieldPart);
    m.leakParts = ConduitType == null ? [] : m.parts.filter(isLeakConduit);
    m.drawLayer = m.drawList.map(b => b.block.drawCached === true ? b.block.buildingCacheLayer.layer : 0);
    m.pidx = {};
    m.parts.forEach((b, i) => { m.pidx[b.id] = i; });
    m.hurtDirty = true;
    var r = 8;
    m.parts.forEach(b => {
        var c = centerOf(b);
        var d = Math.sqrt(Math.pow((c[0] - m.ref[0]) * TS, 2) + Math.pow((c[1] - m.ref[1]) * TS, 2)) + b.block.size * TS * 0.75;
        if(d > r) r = d;
    });
    m.radius = r;
    if(m.body != null && m.body.isValid()) m.body.hitSize = Math.max(8, r * 2);
    reindexAll();
}

// Moves the pivot (m.ref) to the point the Center module asks for; no block moves, the machine position follows the pivot.
function applyPivot(m){
    if(m.mode != "fly" || m.pocket == null || m.air != null || Vars.net.client()) return;
    var cp = F.centerPoint(m.parts);
    if(cp != null){
        m.pivotCustom = true;
    }else if(m.pivotCustom === true && m.hull != null && !m.hull.dead){
        cp = centerOf(m.hull);
        m.pivotCustom = false;
    }else{
        return;
    }
    if(Math.abs(cp[0] - m.ref[0]) < 1e-6 && Math.abs(cp[1] - m.ref[1]) < 1e-6) return;
    var w = toWorld(m, cp[0] * TS, cp[1] * TS);
    m.x = w[0];
    m.y = w[1];
    m.ref = cp;
    partsChanged(m);
    m.pivotDirty = false;
}

// Puts every pocket block at its real world position from the machine pose.
function setPartsReal(m){
    var plx = m.plx, ply = m.ply, parts = m.parts;
    if(plx === undefined || plx.length != parts.length){ partsOffsets(m); plx = m.plx; ply = m.ply; }
    if(m.realKey !== null && m.realX === m.x && m.realY === m.y && m.realA === m.ang && m.realKey === parts.length) return;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    for(var i = 0; i < parts.length; i++){
        var lx = plx[i], ly = ply[i];
        parts[i].set(m.x + lx * c - ly * s, m.y + lx * s + ly * c);
    }
    m.realX = m.x; m.realY = m.y; m.realA = m.ang; m.realKey = parts.length;
}

function partsOffsets(m){
    var rx = m.ref[0] * TS, ry = m.ref[1] * TS;
    m.plx = m.parts.map(b => b.tile.drawx() - rx);
    m.ply = m.parts.map(b => b.tile.drawy() - ry);
}

function setPartsPocket(m){
    m.realKey = null;
    for(var i = 0; i < m.parts.length; i++){
        var b = m.parts[i];
        b.set(b.tile.drawx(), b.tile.drawy());
    }
}

function partAtWorld(m, wx, wy){
    var l = toLocal(m, wx, wy);
    var t = m.pocket.get(Math.round(l[0] / TS), Math.round(l[1] / TS));
    if(t == null || t.build == null) return null;
    return t.build;
}

F.makePocket = makePocket;
F.isShieldPart = isShieldPart;
F.drawFlagOf = drawFlagOf;
F.withPocket = withPocket;
F.toWorld = toWorld;
F.toLocal = toLocal;
F.setAng = setAng;
F.refreshOre = refreshOre;
F.cellOverlaps = cellOverlaps;
F.sampleOre = sampleOre;
F.refreshAttributes = refreshAttributes;
F.relocatePuddles = relocatePuddles;
F.partsChanged = partsChanged;
F.setPartsReal = setPartsReal;
F.applyPivot = applyPivot;
F.setPartsPocket = setPartsPocket;
F.partAtWorld = partAtWorld;
