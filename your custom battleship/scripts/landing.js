'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var MAX_EXTENT = F.MAX_EXTENT, POCKET_MARGIN = F.POCKET_MARGIN, TS = F.TS;
var say = F.say, toPoint2Array = F.toPoint2Array, normAngle = F.normAngle;
var blockRot = F.blockRot, cellsOf = F.cellsOf, centerOf = F.centerOf, coverTiles = F.coverTiles,
    isConstructing = F.isConstructing, landCell = F.landCell, landOrigin = F.landOrigin, rotXY = F.rotXY;
var landingSpot = F.landingSpot;
var isShipControl = F.isShipControl, modsFromData = F.modsFromData, modsToData = F.modsToData,
    shipModuleList = F.shipModuleList, shipSetMods = F.shipSetMods, storageTiles = F.storageTiles;
var ensureBody = F.ensureBody, hullBuild = F.hullBuild, keepBody = F.keepBody, machinePos = F.machinePos,
    membersOf = F.membersOf, reindexAll = F.reindexAll;
var makePocket = F.makePocket, partsChanged = F.partsChanged, refreshOre = F.refreshOre, setAng = F.setAng,
    setPartsReal = F.setPartsReal, withPocket = F.withPocket;

function padAlive(m, pad){
    if(m.pad != null && m.pad.x == pad[0] && m.pad.y == pad[1]) return true;
    var t = Vars.world.tile(pad[0], pad[1]);
    return t != null && t.block() == landingSpot;
}

function takePad(pad){
    var t = Vars.world.tile(pad[0], pad[1]);
    if(t == null || t.block() != landingSpot || t.build == null) return null;
    var info = {x: pad[0], y: pad[1], team: t.build.team};
    t.setBlock(Blocks.air);
    return info;
}

function restorePad(m){
    var p = m.pad;
    m.pad = null;
    if(p == null) return;
    var t = Vars.world.tile(p.x, p.y);
    if(t == null || t.build != null || t.block() != Blocks.air) return;
    t.setBlock(landingSpot, p.team, 0);
}

function padModules(m){
    var out = [];
    if(m.pad == null) return out;
    shipModuleList(m).forEach(e => {
        var mod = e.mod;
        if((mod.k == "land" || (mod.k == "rest" && mod.land === true)) && mod.pads.some(q => q[0] == m.pad.x && q[1] == m.pad.y)) out.push(mod);
    });
    return out;
}

function liftPad(m){
    if(m.mode != "land" || m.pad == null) return false;
    if(!F.startLift(m, true)) return false;
    say("mb.msg.lifted");
    return true;
}

var SIDE_DIR = {right: 0, up: 1, left: 2, down: 3};
var SIDES = ["def", "up", "down", "left", "right", "auto"];

function nearestTurn(m){
    return ((Math.round(m.ang / 90) % 4) + 4) & 3;
}

function sideTurns(m, side){
    if(side == null || side == "near") return [nearestTurn(m)];
    if(side == "def") return [0];
    if(SIDE_DIR[side] !== undefined) return [(SIDE_DIR[side] - F.frontIndex(m) + 4) & 3];
    var qs = [0, 1, 2, 3];
    qs.sort((a, b) => Math.abs(F.signedDiff(a * 90, m.ang)) - Math.abs(F.signedDiff(b * 90, m.ang)));
    return qs;
}

function tryPadLanding(m, g){
    var pad = [g.tx, g.ty];
    var tiles = storageTiles(m);
    var qs = sideTurns(m, g.side);
    for(var k = 0; k < qs.length; k++){
        var q = qs[k];
        for(var i = 0; i < tiles.length; i++){
            var r = rotXY(q, tiles[i][0], tiles[i][1]);
            var off = [pad[0] - r[0], pad[1] - r[1]];
            if(fitsOnGrid(m, off, pad, q)){
                return F.startLanding(m, {off: off, pad: pad, q: q}, "mb.msg.landed");
            }
        }
    }
    if(Time.globalTime - S.lastMsg > 120){
        S.lastMsg = Time.globalTime;
        say("mb.msg.padnofit");
    }
    return false;
}

function shipPadCheck(m){
    var g = m.shipGoal;
    if(g == null || g.kind != "land" || m.arrived !== true || m.autoFlying !== true || m.air != null) return;
    if(!padAlive(m, [g.tx, g.ty])) return;
    tryPadLanding(m, g);
}

function configToAbs(b){
    if(isShipControl(b)) return S.shipMods[b.id] == null || S.shipMods[b.id].length == 0 ? null : {kind: 3, val: modsToData(S.shipMods[b.id])};
    var cfg = null;
    try{ cfg = b.config(); }catch(e){ return null; }
    if(cfg == null) return null;
    if(cfg instanceof Point2){
        return {kind: 1, abs: [Point2.pack(b.tile.x + cfg.x, b.tile.y + cfg.y)]};
    }
    if(cfg.length !== undefined && cfg.length > 0 && (cfg[0] instanceof Point2)){
        var abs = [];
        for(var i = 0; i < cfg.length; i++) abs.push(Point2.pack(b.tile.x + cfg[i].x, b.tile.y + cfg[i].y));
        return {kind: 2, abs: abs};
    }
    return null;
}

function applyConfigAbs(b, c, mapFn){
    if(c == null) return;
    if(c.kind == 3){
        var have = S.shipMods[b.id];
        if(have == null || have.length == 0) shipSetMods(b, modsFromData(c.val));
        return;
    }
    try{
        var rel = [];
        for(var i = 0; i < c.abs.length; i++){
            var q = mapFn(c.abs[i]);
            if(q == null) continue;
            rel.push(new Point2(Point2.x(q) - b.tile.x, Point2.y(q) - b.tile.y));
        }
        if(rel.length == 0) return;
        if(c.kind == 1) b.configured(null, rel[0]);
        else b.configured(null, toPoint2Array(rel));
    }catch(e){
        Log.err("[mb] config restore failed: " + e);
    }
}

function placeReal(block, team, rot, b, x, y){
    var t = Vars.world.tile(x, y);
    t.setBlock(block, team, rot, prov(() => b));
    b.dropped();
}

function placeInPocket(m, p){
    var t = m.pocket.get(p.px, p.py);
    t.setBlock(p.block, p.team, p.rot, prov(() => p.b));
    p.b.dropped();
}

// Moves the blocks of a landed machine from the world into a new pocket and switches it to flight.
function takeOff(m, auto){
    if(m.mode == "fly") return true;
    var padMods = m.pad != null && auto !== true ? padModules(m) : [];
    var parts = membersOf(m.cells, m.team);
    var hull = hullBuild(m);
    if(parts.length == 0 || hull == null) return false;
    for(var i = 0; i < parts.length; i++){
        if(isConstructing(parts[i])){ say("mb.msg.constructing2"); return false; }
    }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    parts.forEach(b => coverTiles(b).forEach(p => {
        var x = Point2.x(p), y = Point2.y(p);
        if(x < minX) minX = x;
        if(x > maxX) maxX = x;
        if(y < minY) minY = y;
        if(y > maxY) maxY = y;
    }));
    if(maxX - minX + 1 > MAX_EXTENT || maxY - minY + 1 > MAX_EXTENT){ say("mb.msg.toolarge2", MAX_EXTENT); return false; }

    m.off = [minX - POCKET_MARGIN, minY - POCKET_MARGIN];
    var cp = F.centerPoint(parts);
    var hc = cp != null ? cp : centerOf(hull);
    m.ref = [hc[0] - m.off[0], hc[1] - m.off[1]];
    m.x = cp != null ? cp[0] * TS : hull.x; m.y = cp != null ? cp[1] * TS : hull.y;
    m.ang = 0; m.vx = 0; m.vy = 0;
    m.pivotCustom = cp != null;
    m.mode = "fly";
    m.parked = false;
    F.clearEditing(m);
    m.oreCache = {}; m.oreStamp = 0;
    makePocket(m, maxX - minX + 1 + 2 * POCKET_MARGIN, maxY - minY + 1 + 2 * POCKET_MARGIN);

    var memberCover = {};
    parts.forEach(b => coverTiles(b).forEach(p => { memberCover[p] = true; }));
    var plans = parts.map(b => ({
        block: b.block, team: b.team, rot: blockRot(b), b: b,
        px: b.tile.x - m.off[0], py: b.tile.y - m.off[1], cfg: configToAbs(b)
    }));

    var burning = F.groundFiresUnder(parts, m.off);
    var wasBusy = S.busy;
    S.busy = true;
    try{
        parts.forEach(b => b.pickedUp());
        parts.forEach(b => b.tile.setBlock(Blocks.air));
        restorePad(m);
        parts.forEach(b => b.afterPickedUp());
        withPocket(m, () => {
            plans.forEach(p => placeInPocket(m, p));
            var mapPos = q => memberCover[q] ? Point2.pack(Point2.x(q) - m.off[0], Point2.y(q) - m.off[1]) : null;
            plans.forEach(p => applyConfigAbs(p.b, p.cfg, mapPos));
        }, true);
    }finally{
        S.busy = wasBusy;
    }
    m.parts = parts;
    m.hull = hull;
    m.cells = {}; m.pending = {};
    refreshOre(m);
    partsChanged(m);
    F.clearFires(m);
    F.takeOverGroundFires(m, burning);
    setAng(m, m.savedAng || 0);
    setPartsReal(m);
    ensureBody(m);
    keepBody(m);
    padMods.forEach(mod => { mod.hold = true; });
    m.shipGoal = null;
    m.arrived = false;
    S.saveDirty = true;
    try{ F.shipEvent(m, "lift"); }catch(e){ F.logErr("lift event", e); }
    return true;
}

var spiral = null;
function spiralOffsets(r){
    if(spiral != null && spiral.r == r) return spiral.list;
    var list = [];
    for(var x = -r; x <= r; x++) for(var y = -r; y <= r; y++) list.push([x, y]);
    list.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
    spiral = {r: r, list: list};
    return list;
}

function fitsOnGrid(m, off, pad, q){
    q = q | 0;
    for(var i = 0; i < m.parts.length; i++){
        var b = m.parts[i];
        var cov = coverTiles(b);
        for(var j = 0; j < cov.length; j++){
            var c = landCell(q, off, Point2.x(cov[j]), Point2.y(cov[j]));
            var x = c[0], y = c[1];
            var t = Vars.world.tile(x, y);
            if(t == null) return false;
            var onPad = pad != null && x == pad[0] && y == pad[1];
            if(!onPad && t.build != null) return false;
            var bl = t.block();
            if(!onPad && bl != Blocks.air && !bl.alwaysReplace) return false;
            var f = t.floor();
            if(f.solid) return false;
            if(f.isDeep() && !(b.block.floating || b.block.placeableLiquid || b.block.requiresWater)) return false;
            if(Vars.world.getDarkness(x, y) >= 3) return false;
        }
    }
    return true;
}

function findLanding(m, q){
    q = q | 0;
    var r = rotXY(q, m.ref[0], m.ref[1]);
    var bx = Math.round(m.x / TS - r[0]), by = Math.round(m.y / TS - r[1]);
    var list = spiralOffsets(8);
    for(var i = 0; i < list.length; i++){
        var off = [bx + list[i][0], by + list[i][1]];
        if(fitsOnGrid(m, off, null, q)) return off;
    }
    return null;
}

function findLandingSide(m, side){
    var qs = sideTurns(m, side);
    for(var k = 0; k < qs.length; k++){
        var off = findLanding(m, qs[k]);
        if(off != null) return {off: off, q: qs[k]};
    }
    return null;
}

function findPadLanding(m, side){
    var tiles = storageTiles(m);
    m.parts.forEach(b => {
        if(b.dead) return;
        coverTiles(b).forEach(p => tiles.push([Point2.x(p), Point2.y(p)]));
    });
    var list = spiralOffsets(8);
    var qs = sideTurns(m, side);
    for(var k = 0; k < qs.length; k++){
        var q = qs[k];
        var r = rotXY(q, m.ref[0], m.ref[1]);
        var bx = Math.round(m.x / TS - r[0]), by = Math.round(m.y / TS - r[1]);
        for(var i = 0; i < list.length; i++){
            if(list[i][0] * list[i][0] + list[i][1] * list[i][1] > 8) break;
            var off = [bx + list[i][0], by + list[i][1]];
            for(var j = 0; j < tiles.length; j++){
                var c = landCell(q, off, tiles[j][0], tiles[j][1]);
                var x = c[0], y = c[1];
                var t = Vars.world.tile(x, y);
                if(t == null || t.block() != landingSpot || t.build == null || t.build.team != m.team) continue;
                if(fitsOnGrid(m, off, [x, y], q)) return {off: off, pad: [x, y], q: q};
            }
        }
    }
    return null;
}

function turnShipOffsets(plans, q, off){
    var byOrigin = {};
    plans.forEach(p => { byOrigin[Point2.pack(p.ox, p.oy)] = p; });
    plans.forEach(p => {
        if(!isShipControl(p.b)) return;
        var mods = S.shipMods[p.b.id];
        if(mods == null) return;
        var turn = (dx, dy) => {
            var t = byOrigin[Point2.pack(p.ox + dx, p.oy + dy)];
            if(t !== undefined) return [t.x - p.x, t.y - p.y];
            return rotXY(q, dx, dy);
        };
        mods.forEach(mod => {
            if((mod.k == "rule" && mod.all !== true) || (mod.k == "center" && mod.mode != "mean")){
                var r = turn(mod.dx | 0, mod.dy | 0);
                mod.dx = r[0];
                mod.dy = r[1];
            }else if(mod.k == "proc" && mod.list != null){
                mod.list = mod.list.map(e => turn(e[0] | 0, e[1] | 0));
            }
        });
    });
}

// Moves the blocks back from the pocket onto the grid at the chosen offset and rotation.
function landMachine(m, parked, at){
    if(m.mode != "fly") return true;
    m.air = null;
    var pick = at != null ? {off: at.off, q: at.q | 0} : findLandingSide(m, "auto");
    var padInfo = null;
    if(pick == null){ say("mb.msg.noroom"); return false; }
    var off = pick.off, q = pick.q & 3;
    var parts = m.parts.slice();
    var hull = m.hull;
    var carry = F.shipFiresToGround(m, off, q);
    var heading = m.ang;
    setAng(m, q * 90);
    m.savedAng = normAngle(heading - q * 90);
    try{ F.landImpact(m, off, q); }catch(e){ F.logErr("landImpact", e); }
    if(at != null && at.crash === true){
        try{ F.crashImpact(m, off, q); }catch(e){ F.logErr("crashImpact", e); }
    }
    parts = m.parts.slice();
    hull = m.hull != null && !m.hull.dead ? m.hull : null;
    if(hull == null) hull = parts.filter(F.isHull)[0] || null;

    var memberCover = {};
    parts.forEach(b => coverTiles(b).forEach(p => { memberCover[p] = true; }));
    var plans = [];
    withPocket(m, () => {
        parts.forEach(b => {
            var o = landOrigin(q, off, b);
            plans.push({block: b.block, team: b.team, rot: b.block.rotate ? (blockRot(b) + q) & 3 : 0, b: b, x: o[0], y: o[1],
                        ox: b.tile.x, oy: b.tile.y, cfg: configToAbs(b)});
        });
        parts.forEach(b => b.pickedUp());
        parts.forEach(b => b.tile.setBlock(Blocks.air));
    }, true);

    var wasBusy = S.busy;
    S.busy = true;
    try{
        parts.forEach(b => b.afterPickedUp());
        padInfo = at != null && at.pad != null ? takePad(at.pad) : null;
        plans.forEach(p => placeReal(p.block, p.team, p.rot, p.b, p.x, p.y));
        var mapPos = pos => {
            if(!memberCover[pos]) return null;
            var c = landCell(q, off, Point2.x(pos), Point2.y(pos));
            return Point2.pack(c[0], c[1]);
        };
        plans.forEach(p => applyConfigAbs(p.b, p.cfg, mapPos));
    }finally{
        S.busy = wasBusy;
    }
    if(q != 0){
        try{ turnShipOffsets(plans, q, off); }catch(e){ F.logErr("turn offsets", e); }
        F.turnFront(m, q);
    }
    m.mode = "land";
    m.marks = null;
    F.clearFires(m);
    F.groundFiresStart(carry);
    m.pad = padInfo;
    m.parked = parked === true || padInfo != null;
    m.shipGoal = null;
    m.arrived = false;
    m.headFrozen = false;
    m.cells = cellsOf(parts);
    m.orderSeen = undefined;
    m.bonds = []; m.gid = null; m.gnext = 1;
    m.pending = {};
    m.anchor = hull != null ? hull.pos() : 0;
    parts.forEach(b => {
        var bs = S.bstates[b.id];
        if(bs !== undefined){ bs.thrusting = false; bs.working = false; bs.level = 0; }
    });
    m.parts = []; m.hull = null; m.pocket = null; m.turrets = []; m.boosters = []; m.target = null;
    m.thrusting = false;
    m.vx = 0; m.vy = 0;
    reindexAll();
    if(hull == null){
        F.dropMachine(m);
        S.dirty = true;
        return true;
    }
    var pos = machinePos(m);
    m.x = pos[0]; m.y = pos[1];
    try{ F.shipEvent(m, "land"); }catch(e){ F.logErr("land event", e); }
    ensureBody(m);
    keepBody(m);
    S.saveDirty = true;
    return true;
}

function parkTarget(){
    var p = Vars.player;
    if(S.poss != null) return S.poss.m;
    if(p == null || p.team() == null) return null;
    return F.nearestMachine(p.x, p.y, p.team());
}

function togglePark(){
    if(Vars.player == null || Vars.player.team() == null) return;
    var m = parkTarget();
    if(m == null){ say("mb.msg.nomachine"); return; }
    if(Vars.net.client()){ F.netRequest({t: "park", m: m.id}); return; }
    parkMachine(m, Vars.player);
}

function parkMachine(m, player){
    if(m.team.id != player.team().id) return;
    if(m.mode == "fly"){
        F.startLanding(m, null, "mb.msg.parked");
    }else if(F.isEdited(m)){
        F.tell(player, "mb.msg.beingedited");
    }else if(m.parked){
        if(F.startLift(m)) F.tell(player, "mb.msg.unparked");
    }else{
        F.tell(player, "mb.msg.parkbuild");
    }
}

S.netHandlers.park = function(player, msg){
    var m = F.machineById(msg.m);
    if(m != null) parkMachine(m, player);
};

F.padAlive = padAlive;
F.liftPad = liftPad;
F.shipPadCheck = shipPadCheck;
F.configToAbs = configToAbs;
F.applyConfigAbs = applyConfigAbs;
F.placeReal = placeReal;
F.placeInPocket = placeInPocket;
F.fitsOnGrid = fitsOnGrid;
F.findLanding = findLanding;
F.findLandingSide = findLandingSide;
F.nearestTurn = nearestTurn;
F.findPadLanding = findPadLanding;
F.takeOff = takeOff;
F.landMachine = landMachine;
F.parkTarget = parkTarget;
F.togglePark = togglePark;
F.sideTurns = sideTurns;
F.SIDES = SIDES;
