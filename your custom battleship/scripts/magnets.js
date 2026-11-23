'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var MAGNET_DOCK_ANGLE = F.MAGNET_DOCK_ANGLE, MAGNET_DOCK_DIST = F.MAGNET_DOCK_DIST, MAGNET_HOLD = F.MAGNET_HOLD,
    MAGNET_MAX_SPEED = F.MAGNET_MAX_SPEED, MAGNET_MIN_COS = F.MAGNET_MIN_COS, MAGNET_RANGE_TILES = F.MAGNET_RANGE_TILES,
    MAGNET_RELEASE_TICKS = F.MAGNET_RELEASE_TICKS, MAGNET_THRUST = F.MAGNET_THRUST, MAX_EXTENT = F.MAX_EXTENT,
    POCKET_MARGIN = F.POCKET_MARGIN, SUPER_MAGNET_MAX_SPEED = F.SUPER_MAGNET_MAX_SPEED, SUPER_MAGNET_RANGE_TILES = F.SUPER_MAGNET_RANGE_TILES,
    SUPER_MAGNET_THRUST = F.SUPER_MAGNET_THRUST, TS = F.TS;
var logErr = F.logErr, onEvent = F.onEvent, signedDiff = F.signedDiff;
var blockRot = F.blockRot, centerOf = F.centerOf, coverTiles = F.coverTiles, isHull = F.isHull, originShift = F.originShift;
var makePocket = F.makePocket, partsChanged = F.partsChanged, refreshOre = F.refreshOre, setAng = F.setAng,
    setPartsReal = F.setPartsReal, toLocal = F.toLocal, toWorld = F.toWorld, withPocket = F.withPocket;
var applyConfigAbs = F.applyConfigAbs, configToAbs = F.configToAbs, placeInPocket = F.placeInPocket;
var ensureBody = F.ensureBody, keepBody = F.keepBody, removeBodyKeepPossession = F.removeBodyKeepPossession;
var machineMass = F.machineMass;

var failed = {};

function isSuperMagnet(b){
    return b != null && F.superMagnet != null && b.block === F.superMagnet;
}

function isMagnet(b){
    return b != null && ((F.magnet != null && b.block === F.magnet) || isSuperMagnet(b));
}

function thrustOf(b){ return isSuperMagnet(b) ? SUPER_MAGNET_THRUST : MAGNET_THRUST; }
function rangeOf(b){ return (isSuperMagnet(b) ? SUPER_MAGNET_RANGE_TILES : MAGNET_RANGE_TILES) * TS; }
function speedCapOf(b){ return isSuperMagnet(b) ? SUPER_MAGNET_MAX_SPEED : MAGNET_MAX_SPEED; }
function dockDistOf(a, b){ return (a.block.size + b.block.size) / 2 * TS + (MAGNET_DOCK_DIST - TS); }

function powerOf(b){
    try{
        if(!b.enabled) return 0;
        return Math.max(0, Math.min(1, b.power.status));
    }catch(e){ return 0; }
}

function bondPowerOf(m, b){
    var p = powerOf(b);
    if(p <= 0 || m.gid == null) return p;
    var g = m.gid[b.id] || 0, graph = null;
    try{ graph = b.power.graph; }catch(e){ graph = null; }
    if(graph == null) return p;
    var own = false;
    var scan = (list, battery) => {
        for(var i = 0; i < list.size && !own; i++){
            var o = list.get(i);
            if(o == null || o.dead || (m.gid[o.id] || 0) !== g) continue;
            try{
                if(battery){ if(o.power.status > 0.01) own = true; }
                else if(o.enabled && o.getPowerProduction() > 0.0001) own = true;
            }catch(e){ own = true; }
        }
    };
    scan(graph.producers, false);
    scan(graph.batteries, true);
    return own ? p : 0;
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function turnCell(k, x, y){
    switch(k & 3){
        case 0: return [x, y];
        case 1: return [-y, x];
        case 2: return [-x, -y];
        default: return [y, -x];
    }
}

function movedOrigin(b, f){
    var minX = 1e9, minY = 1e9;
    coverTiles(b).forEach(p => {
        var q = f(Point2.x(p), Point2.y(p));
        if(q[0] < minX) minX = q[0];
        if(q[1] < minY) minY = q[1];
    });
    var off = originShift(b.block.size);
    return [minX - off, minY - off];
}

function relocate(dest, w, h, sets){
    var plans = [];
    sets.forEach(set => {
        var cellMap = {};
        set.blocks.forEach(b => coverTiles(b).forEach(p => {
            var q = set.f(Point2.x(p), Point2.y(p));
            cellMap[p] = Point2.pack(q[0], q[1]);
        }));
        set.blocks.forEach(b => {
            var o = movedOrigin(b, set.f);
            plans.push({
                block: b.block, team: b.team, b: b, px: o[0], py: o[1],
                rot: b.block.rotate ? ((blockRot(b) + set.k) & 3) : blockRot(b),
                cfg: configToAbs(b), map: cellMap
            });
        });
    });
    var wasBusy = S.busy;
    S.busy = true;
    try{
        sets.forEach(set => {
            withPocket(set.owner, () => {
                set.blocks.forEach(b => b.pickedUp());
                set.blocks.forEach(b => b.tile.setBlock(Blocks.air));
            }, true);
            set.blocks.forEach(b => b.afterPickedUp());
        });
        makePocket(dest, w, h);
        withPocket(dest, () => {
            plans.forEach(p => placeInPocket(dest, p));
            plans.forEach(p => applyConfigAbs(p.b, p.cfg, q => p.map[q] === undefined ? null : p.map[q]));
        }, true);
    }finally{
        S.busy = wasBusy;
    }
}

function boundsOf(cells){
    var b = {minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9};
    cells.forEach(c => {
        if(c[0] < b.minX) b.minX = c[0];
        if(c[0] > b.maxX) b.maxX = c[0];
        if(c[1] < b.minY) b.minY = c[1];
        if(c[1] > b.maxY) b.maxY = c[1];
    });
    return b;
}

function cellsOfBlocks(blocks){
    var out = [];
    blocks.forEach(b => coverTiles(b).forEach(p => out.push([Point2.x(p), Point2.y(p)])));
    return out;
}

// Joins two machines whose magnets meet face to face; the lighter one merges into the heavier.
function couple(m, o, a, b){
    var wm = machineMass(m), wo = machineMass(o);
    var A = wm > wo || (wm == wo && m.id < o.id) ? m : o;
    var B = A === m ? o : m;
    var magA = A === m ? a : b, magB = A === m ? b : a;
    var rotA = blockRot(magA), rotB = blockRot(magB);
    var k = (rotA - rotB) & 3;
    var pa = toWorld(A, magA.tile.drawx(), magA.tile.drawy()), pb = toWorld(B, magB.tile.drawx(), magB.tile.drawy());
    var la = toLocal(A, pa[0], pa[1]), lb = toLocal(A, pb[0], pb[1]);
    var fx = Math.round(Mathf.cosDeg(rotA * 90)), fy = Math.round(Mathf.sinDeg(rotA * 90));
    var proj = (lb[0] - la[0]) * fx + (lb[1] - la[1]) * fy;
    var sign = proj >= 0 ? 1 : -1;
    var cA = centerOf(magA), cB = centerOf(magB);
    var reach = (magA.block.size + magB.block.size) / 2;
    var ideal = [cA[0] + fx * sign * reach, cA[1] + fy * sign * reach];
    var rb = turnCell(k, cB[0], cB[1]);
    var t = [ideal[0] - rb[0], ideal[1] - rb[1]];
    for(var ti = 0; ti < 2; ti++){
        if(Math.abs(t[ti] - Math.round(t[ti])) > 0.25){
            var want = lb[ti] / TS - rb[ti];
            t[ti] = want >= t[ti] ? t[ti] + 0.5 : t[ti] - 0.5;
        }
        t[ti] = Math.round(t[ti]);
    }
    var at = [rb[0] + t[0], rb[1] + t[1]];
    if(Math.abs(lb[0] - at[0] * TS) > TS * 1.2 || Math.abs(lb[1] - at[1] * TS) > TS * 1.2) return false;
    var fB0 = (x, y) => { var q = turnCell(k, x, y); return [q[0] + t[0], q[1] + t[1]]; };

    var aCells = cellsOfBlocks(A.parts), taken = {};
    aCells.forEach(c => { taken[c[0] + "," + c[1]] = true; });
    var bCells = cellsOfBlocks(B.parts).map(c => fB0(c[0], c[1]));
    for(var i = 0; i < bCells.length; i++){
        if(taken[bCells[i][0] + "," + bCells[i][1]]) return false;
    }
    var bd = boundsOf(aCells.concat(bCells));
    if(bd.maxX - bd.minX + 1 > MAX_EXTENT || bd.maxY - bd.minY + 1 > MAX_EXTENT) return false;
    var sx = POCKET_MARGIN - bd.minX, sy = POCKET_MARGIN - bd.minY;
    var w = bd.maxX - bd.minX + 1 + 2 * POCKET_MARGIN, h = bd.maxY - bd.minY + 1 + 2 * POCKET_MARGIN;

    var wA = A === m ? wm : wo, wB = B === m ? wm : wo;
    var vx = (A.vx * wA + B.vx * wB) / Math.max(1, wA + wB);
    var vy = (A.vy * wA + B.vy * wB) / Math.max(1, wA + wB);

    var bParts = B.parts.slice(), aParts = A.parts.slice();
    var bGid = {};
    bParts.forEach(p => { bGid[p.id] = (B.gid != null && B.gid[p.id]) || 0; });
    var oldBonds = (A.bonds || []).concat(B.bonds || []);

    relocate(A, w, h, [
        {owner: A, blocks: aParts, f: (x, y) => [x + sx, y + sy], k: 0},
        {owner: B, blocks: bParts, f: (x, y) => { var q = fB0(x, y); return [q[0] + sx, q[1] + sy]; }, k: k}
    ]);

    A.parts = aParts.concat(bParts);
    A.ref = [A.ref[0] + sx, A.ref[1] + sy];
    if(A.gid == null) A.gid = {};
    var base = A.gnext || 1;
    bParts.forEach(p => { A.gid[p.id] = base + bGid[p.id]; });
    A.gnext = base + (B.gnext || 1);
    A.bonds = oldBonds;
    A.vx = vx; A.vy = vy;
    A.craftHold = null;
    F.clearFires(A);
    F.clearFires(B);
    A.oreCache = {}; A.oreStamp = 0;
    A.shipGoal = null;
    F.retargetDrivers(B, A);
    var bi = S.machines.indexOf(B);
    if(bi >= 0) S.machines.splice(bi, 1);
    removeBodyKeepPossession(B);
    B.parts = [];
    partsChanged(A);
    refreshOre(A);
    setPartsReal(A);
    keepBody(A);
    A.magnets.forEach(p => {
        if(A.gid[p.id] >= base) return;
        A.magnets.forEach(q => {
            if(!(A.gid[q.id] >= base)) return;
            if(blockRot(p) != blockRot(q)) return;
            var cp = centerOf(p), cq = centerOf(q);
            var dx = cq[0] - cp[0], dy = cq[1] - cp[1];
            var ax = Math.round(Mathf.cosDeg(blockRot(p) * 90)), ay = Math.round(Mathf.sinDeg(blockRot(p) * 90));
            var along = dx * ax + dy * ay, across = -dx * ay + dy * ax;
            var rch = (p.block.size + q.block.size) / 2;
            if(Math.abs(Math.abs(along) - rch) < 0.01 && Math.abs(across) < rch - 0.01) A.bonds.push({a: p.id, b: q.id, off: 0});
        });
    });
    S.saveDirty = true;
    return true;
}

function pickHull(blocks){
    var best = null;
    blocks.forEach(b => {
        if(b.dead || !isHull(b)) return;
        if(best == null || b.block.size > best.block.size) best = b;
    });
    return best;
}

function splitOff(m, blocks, gidOf, bonds){
    var cells = cellsOfBlocks(blocks);
    var bd = boundsOf(cells);
    var sx = POCKET_MARGIN - bd.minX, sy = POCKET_MARGIN - bd.minY;
    var w = bd.maxX - bd.minX + 1 + 2 * POCKET_MARGIN, h = bd.maxY - bd.minY + 1 + 2 * POCKET_MARGIN;
    var hull = pickHull(blocks);
    var c0;
    if(hull != null){
        c0 = centerOf(hull);
    }else{
        var ax = 0, ay = 0, n = 0;
        blocks.forEach(b => { var c = centerOf(b), s = b.block.size * b.block.size; ax += c[0] * s; ay += c[1] * s; n += s; });
        c0 = [ax / n, ay / n];
    }
    var wp = toWorld(m, c0[0] * TS, c0[1] * TS);
    var n2 = F.newMachineObj(m.team);
    n2.mode = "fly";
    n2.front = m.front;
    n2.ctrlOff = m.ctrlOff === true;
    n2.ang = m.ang; n2.savedAng = m.savedAng;
    n2.x = wp[0]; n2.y = wp[1]; n2.vx = m.vx; n2.vy = m.vy;
    n2.off = [0, 0];
    n2.ref = [c0[0] + sx, c0[1] + sy];
    n2.oreCache = {}; n2.oreStamp = 0;
    relocate(n2, w, h, [{owner: m, blocks: blocks, f: (x, y) => [x + sx, y + sy], k: 0}]);
    var gone = {};
    blocks.forEach(b => { gone[b.id] = true; });
    m.parts = m.parts.filter(b => !gone[b.id]);
    n2.parts = blocks;
    n2.hull = hull;
    if(bonds.length > 0){
        n2.bonds = bonds;
        n2.gid = {};
        var low = 1e9;
        blocks.forEach(b => { var g = gidOf(b); if(g < low) low = g; });
        blocks.forEach(b => { n2.gid[b.id] = gidOf(b) - low; });
        n2.gnext = 1;
        blocks.forEach(b => { n2.gnext = Math.max(n2.gnext, n2.gid[b.id] + 1); });
        if(m.gid != null) blocks.forEach(b => { delete m.gid[b.id]; });
    }else if(m.gid != null){
        blocks.forEach(b => { delete m.gid[b.id]; });
    }
    partsChanged(m);
    S.machines.push(n2);
    partsChanged(n2);
    refreshOre(n2);
    setPartsReal(n2);
    ensureBody(n2);
    keepBody(n2);
    S.saveDirty = true;
    if(n2.boosters.length == 0 || hull == null){
        n2.fallOnly = true;
        if(!F.startFall(n2, true)) F.destroyMachine(n2, true);
    }
    return n2;
}

function bondStep(m, delta){
    var byId = {};
    m.parts.forEach(b => { byId[b.id] = b; });
    var keep = [];
    m.bonds.forEach(bd => {
        var a = byId[bd.a], b = byId[bd.b];
        if(a == null || b == null || a.dead || b.dead) return;
        if(Math.min(bondPowerOf(m, a), bondPowerOf(m, b)) < MAGNET_HOLD) bd.off = (bd.off || 0) + delta; else bd.off = 0;
        if(bd.off > MAGNET_RELEASE_TICKS) return;
        keep.push(bd);
    });
    if(keep.length == m.bonds.length) return;
    m.bonds = keep;
    var gidOf = b => (m.gid != null && m.gid[b.id]) || 0;
    var links = {};
    keep.forEach(bd => {
        var ga = gidOf(byId[bd.a]), gb = gidOf(byId[bd.b]);
        (links[ga] = links[ga] || {})[gb] = true;
        (links[gb] = links[gb] || {})[ga] = true;
    });
    var all = {};
    m.parts.forEach(b => { all[gidOf(b)] = true; });
    var main = m.hull != null ? gidOf(m.hull) : 0;
    var reached = {};
    var queue = [main];
    reached[main] = true;
    while(queue.length > 0){
        var g = queue.shift();
        var nb = links[g];
        if(nb == null) continue;
        for(var k in nb){
            if(!reached[k]){ reached[k] = true; queue.push(+k); }
        }
    }
    var lost = Object.keys(all).filter(g => !reached[g]).map(Number);
    if(lost.length == 0){
        if(keep.length == 0){ m.gid = null; m.gnext = 1; }
        return;
    }
    var comp = {};
    lost.forEach(g => { comp[g] = g; });
    function find(g){ while(comp[g] != g) g = comp[g]; return g; }
    keep.forEach(bd => {
        var ga = gidOf(byId[bd.a]), gb = gidOf(byId[bd.b]);
        if(comp[ga] === undefined || comp[gb] === undefined) return;
        comp[find(ga)] = find(gb);
    });
    var parts = {}, bondsOf = {};
    m.parts.forEach(b => {
        var g = gidOf(b);
        if(comp[g] === undefined) return;
        var r = find(g);
        (parts[r] = parts[r] || []).push(b);
    });
    keep.forEach(bd => {
        var ga = gidOf(byId[bd.a]);
        if(comp[ga] === undefined) return;
        var r = find(ga);
        (bondsOf[r] = bondsOf[r] || []).push(bd);
    });
    Object.keys(parts).forEach(r => {
        try{
            splitOff(m, parts[r], gidOf, bondsOf[r] || []);
        }catch(e){
            logErr("splitOff", e);
        }
    });
    m.bonds = m.bonds.filter(bd => byId[bd.a] != null && m.parts.indexOf(byId[bd.a]) >= 0 && m.parts.indexOf(byId[bd.b]) >= 0);
    if(m.bonds.length == 0){ m.gid = null; m.gnext = 1; }
}

function pairOf(a, thA, sa, b, thB, sb){
    var R = Math.max(rangeOf(a), rangeOf(b));
    var dx = b.x - a.x, dy = b.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if(dist > R || dist < 0.01) return null;
    var ca = (Mathf.cosDeg(thA) * dx + Mathf.sinDeg(thA) * dy) / dist;
    var cb = (Mathf.cosDeg(thB) * dx + Mathf.sinDeg(thB) * dy) / dist;
    if(ca * cb == 0 || Math.min(Math.abs(ca), Math.abs(cb)) < MAGNET_MIN_COS) return null;
    var s = (1 - dist / R) * Math.min(sa, sb);
    return {s: s, dx: dx, dy: dy, dist: dist, R: R, push: ca * cb < 0,
            thr: Math.max(thrustOf(a), thrustOf(b)), T: Math.max(thrustOf(a), thrustOf(b)) * s, cap: Math.max(speedCapOf(a), speedCapOf(b))};
}

function dockPose(m, a, g){
    var ra = blockRot(a), rg = blockRot(g);
    var q = (rg - ra) & 3;
    var d = [Math.round(Mathf.cosDeg(rg * 90)), Math.round(Mathf.sinDeg(rg * 90))];
    var u = [-d[1], d[0]];
    var reach = (a.block.size + g.block.size) / 2;
    var cg = centerOf(g), ca = centerOf(a);
    var pw = toWorld(m, a.tile.drawx(), a.tile.drawy());
    var px = pw[0] / TS, py = pw[1] / TS;
    var sign = ((px - cg[0]) * d[0] + (py - cg[1]) * d[1]) >= 0 ? 1 : -1;
    var ideal = [cg[0] + d[0] * sign * reach, cg[1] + d[1] * sign * reach];
    var rc = F.rotXY(q, ca[0], ca[1]);
    var base = [ideal[0] - rc[0], ideal[1] - rc[1]];
    var opts = base.map(v => Math.abs(v - Math.round(v)) > 0.25 ? [Math.floor(v), Math.ceil(v)] : [Math.round(v)]);
    var list = [];
    for(var sh = -2; sh <= 2; sh++){
        for(var i = 0; i < opts[0].length; i++){
            for(var j = 0; j < opts[1].length; j++){
                var off = [opts[0][i] + u[0] * sh, opts[1][j] + u[1] * sh];
                var cx = rc[0] + off[0], cy = rc[1] + off[1];
                var along = (cx - cg[0]) * d[0] + (cy - cg[1]) * d[1];
                var across = (cx - cg[0]) * u[0] + (cy - cg[1]) * u[1];
                if(Math.abs(along - sign * reach) > 0.01 || Math.abs(across) > reach - 0.01) continue;
                list.push({off: off, key: Math.round(Math.abs(across) * 2), dist: Math.sqrt((cx - px) * (cx - px) + (cy - py) * (cy - py))});
            }
        }
    }
    list.sort((x, y) => x.key != y.key ? x.key - y.key : x.dist - y.dist);
    for(var k = 0; k < list.length; k++){
        if(F.fitsOnGrid(m, list[k].off, null, q)) return {off: list[k].off, q: q};
    }
    return null;
}

function groundMagnets(team){
    var out = [];
    var td = team.data();
    [F.magnet, F.superMagnet].forEach(blk => {
        if(blk == null) return;
        var seq = td.getBuildings(blk);
        if(seq == null) return;
        for(var i = 0; i < seq.size; i++){
            var g = seq.get(i);
            if(g != null && !g.dead) out.push(g);
        }
    });
    return out;
}

function pairsPull(m, ground){
    var list = m.pullPairs;
    if(list == null) return 0;
    var live = {};
    for(var i = 0; i < ground.length; i++) live[ground[i].id] = true;
    var keep = [], sum = 0;
    list.forEach(pr => {
        if(pr.a.dead || pr.g.dead || live[pr.g.id] !== true) return;
        keep.push(pr);
        var st = Math.min(powerOf(pr.a), powerOf(pr.g));
        if(st < MAGNET_HOLD) return;
        sum += pr.thr * Math.max(0, 1 - pr.d0 / pr.R) * st;
    });
    m.pullPairs = keep.length > 0 ? keep : null;
    return sum;
}

function freeToBePulled(m, moved){
    if(m.mode != "fly" || m.air != null || m.fallOnly === true || m.launch != null) return false;
    if(moved) return false;
    var still = F.MAGNET_STILL_SPEED * TS / 60;
    if(m.vx * m.vx + m.vy * m.vy > still * still) return false;
    if(!F.engineWorking(m)) return false;
    if(F.wantsToMove(m)) return false;
    return true;
}

// Per tick: forces between magnets, bonds, and the pull of magnets on the ground.
function magnetPass(delta){
    S.magDock = [];
    var all = S.machines;
    if(all.length == 0) return;
    var flying = [];
    for(var i = 0; i < all.length; i++){
        var m = all[i];
        m.pullF = 0;
        if(m.mode == "fly"){ m.magVx = 0; m.magVy = 0; flying.push(m); }
    }
    for(var fi = 0; fi < flying.length; fi++){
        var fm = flying[fi];
        if(fm.air == null && fm.bonds != null && fm.bonds.length > 0){
            try{ bondStep(fm, delta); }catch(e){ logErr("bondStep", e); }
        }
    }
    var gcache = {};
    var groundOf = team => { var l = gcache[team.id]; if(l === undefined) l = gcache[team.id] = groundMagnets(team); return l; };
    var ships = [], gm = [];
    for(var k = 0; k < all.length; k++){
        var a = all[k];
        if(a.mode == "fly"){
            if(a.magnets == null || a.magnets.length == 0) continue;
            if(a.air == null) ships.push(a);
            if(a.air == null || a.air.kind == "pull") gm.push(a);
        }else if(a.mode == "land"){
            if(groundOf(a.team).length == 0){ a.pullPairs = null; continue; }
            gm.push(a);
        }
    }
    for(var gi = 0; gi < gm.length; gi++){
        var g = gm[gi];
        try{
            magnetOne(g, ships, groundOf(g.team), delta);
        }catch(e){
            logErr("magnetOne", e);
        }
    }
}

function magnetOne(m, ships, ground, delta){
    var flyingNow = m.mode == "fly";
    var free = flyingNow && m.air == null;
    var kept = 0;
    if(free) m.pullPairs = null;
    else kept = pairsPull(m, ground);
    if(flyingNow && m.air != null){
        m.pullF = kept;
        return;
    }
    var mags = m.magnets, own = null;
    if(!flyingNow){
        if(ground.length == 0){ m.pullPairs = null; return; }
        if(m.gmList === undefined || m.gmStamp === undefined || Time.globalTime - m.gmStamp > 30 || m.gmStamp > Time.globalTime){
            m.gmList = F.membersOf(m.cells, m.team).filter(isMagnet);
            m.gmStamp = Time.globalTime;
        }
        mags = m.gmList;
        own = {};
        mags.forEach(b => { own[b.id] = true; });
    }
    if(mags == null || mags.length == 0){ if(!flyingNow) m.pullPairs = null; return; }
    var ang = flyingNow ? m.ang : 0;
    var fx = 0, fy = 0, tw = 0, tt = 0, pushed = false, cap = MAGNET_MAX_SPEED;
    var pull = 0, pairs = [];
    var rm = 0;
    mags.forEach(a => { rm = Math.max(rm, rangeOf(a)); });
    mags.forEach(a => {
        if(a.dead) return;
        var sa = powerOf(a);
        if(sa < MAGNET_HOLD) return;
        var thA = ang + blockRot(a) * 90;
        var pick = null;
        if(free){
            ships.forEach(o => {
                if(o === m || o.team.id != m.team.id) return;
                var ro = 0;
                o.magnets.forEach(b => { ro = Math.max(ro, rangeOf(b)); });
                if(Mathf.dst(m.x, m.y, o.x, o.y) > m.radius + o.radius + Math.max(rm, ro) + TS) return;
                o.magnets.forEach(b => {
                    if(b.dead) return;
                    var sb = powerOf(b);
                    if(sb < MAGNET_HOLD) return;
                    var pr = pairOf(a, thA, sa, b, o.ang + blockRot(b) * 90, sb);
                    if(pr != null && (pick == null || pr.s > pick.s)){ pr.b = b; pr.o = o; pr.thA = thA; pr.thB = o.ang + blockRot(b) * 90; pick = pr; }
                });
            });
        }
        for(var gi = 0; gi < ground.length; gi++){
            var g = ground[gi];
            if(g.dead || (own != null && own[g.id] === true)) continue;
            if(Mathf.dst(a.x, a.y, g.x, g.y) > Math.max(rangeOf(a), rangeOf(g))) continue;
            var sg = powerOf(g);
            if(sg < MAGNET_HOLD) continue;
            var pg = pairOf(a, thA, sa, g, blockRot(g) * 90, sg);
            if(pg != null && (pick == null || pg.s > pick.s)){ pg.g = g; pg.ground = true; pick = pg; }
        }
        if(pick == null) return;
        if(pick.ground === true){
            if(pick.push){
                if(free){
                    pushed = true;
                    fx -= pick.dx / pick.dist * pick.T;
                    fy -= pick.dy / pick.dist * pick.T;
                    cap = Math.max(cap, pick.cap);
                }
            }else{
                pull += pick.T;
                pairs.push({a: a, g: pick.g, d0: pick.dist, R: pick.R, thr: pick.thr, T: pick.T, cap: pick.cap});
            }
            return;
        }
        if(!free) return;
        pushed = true;
        cap = Math.max(cap, pick.cap);
        if(pick.push){
            fx -= pick.dx / pick.dist * pick.T;
            fy -= pick.dy / pick.dist * pick.T;
            return;
        }
        fx += pick.dx / pick.dist * pick.T;
        fy += pick.dy / pick.dist * pick.T;
        tw += pick.s;
        tt += signedDiff(pick.thB, pick.thA) * pick.s;
        if(pick.dist <= dockDistOf(a, pick.b) && Math.abs(signedDiff(pick.thA, pick.thB)) <= MAGNET_DOCK_ANGLE){
            S.magDock.push({m: m, o: pick.o, a: a, b: pick.b});
        }
    });
    var moved = false;
    if(free && pushed){
        var cells = Math.max(1, machineMass(m));
        var k = F.boosterPower() / cells;
        var vx = fx * k, vy = fy * k;
        var len = Math.sqrt(vx * vx + vy * vy);
        if(len > cap){ vx *= cap / len; vy *= cap / len; len = cap; }
        m.magVx = vx * TS / 60;
        m.magVy = vy * TS / 60;
        moved = len > 0.0001;
        if(tw > 0){
            var err = tt / tw;
            var rate = F.turnRate(len, m) / 60 * delta * Math.min(1, tw);
            var step = clamp(err, -rate, rate);
            if(Math.abs(step) > 0.001) setAng(m, m.ang + step);
        }
    }
    m.pullF = Math.max(pull, kept);
    if(free && pull > 0 && freeToBePulled(m, moved)){
        m.pullPairs = pairs;
        if(!F.startMagnetPull(m, pairs, pull)) m.pullPairs = null;
    }
}

function magnetCouple(){
    var list = S.magDock || [];
    S.magDock = [];
    var now = Time.globalTime;
    for(var i = 0; i < list.length; i++){
        var d = list[i];
        if(S.machines.indexOf(d.m) < 0 || S.machines.indexOf(d.o) < 0) continue;
        if(d.m.air != null || d.o.air != null || d.a.dead || d.b.dead) continue;
        var key = d.a.id < d.b.id ? d.a.id + ":" + d.b.id : d.b.id + ":" + d.a.id;
        if(failed[key] !== undefined && failed[key] > now) continue;
        var ok = false;
        try{
            ok = couple(d.m, d.o, d.a, d.b);
        }catch(e){
            logErr("couple", e);
        }
        if(!ok) failed[key] = now + 60;
    }
}

onEvent(WorldLoadEvent, () => { failed = {}; S.magDock = []; });
onEvent(ResetEvent, () => { failed = {}; S.magDock = []; });

F.isMagnet = isMagnet;
F.isSuperMagnet = isSuperMagnet;
F.magnetSpec = b => ({thrust: thrustOf(b), range: rangeOf(b), cap: speedCapOf(b)});
F.magnetPass = magnetPass;
F.dockPose = dockPose;
F.magnetCouple = magnetCouple;
F.couple = couple;
F.bondStep = bondStep;
F.splitOff = splitOff;
F.turnCell = turnCell;
