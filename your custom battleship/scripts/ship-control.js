'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var ORE_CLAIM_EXTRA_TILES = F.ORE_CLAIM_EXTRA_TILES, REST_DEFAULT_SEC = F.REST_DEFAULT_SEC, REST_MAX_SEC = F.REST_MAX_SEC, TS = F.TS;
var FIT_MIN_SHARE = F.FIT_MIN_SHARE, FIT_WAIT_TICKS = F.FIT_WAIT_TICKS, FIT_MAX_TRIES = F.FIT_MAX_TRIES, FIT_SEARCH_TILES = F.FIT_SEARCH_TILES;
var FIT_HOP_TIMEOUT = F.FIT_HOP_TIMEOUT, FIT_SCAN_CELLS = F.FIT_SCAN_CELLS;
var logErr = F.logErr, say = F.say;
var coverTiles = F.coverTiles, isConstructing = F.isConstructing, isHull = F.isHull, centerOf = F.centerOf;
var shipControl = F.shipControl;

var SHIP_PERIOD = 15;
var HOLD_FREE_TICKS = 600;
var SHIP_DEFAULT_PCT = 50;
var LiquidRouterType = null;
try{ LiquidRouterType = Packages.mindustry.world.blocks.liquid.LiquidRouter; }catch(e){ LiquidRouterType = null; }
if(LiquidRouterType != null && typeof LiquidRouterType !== "function") LiquidRouterType = null;
var SHIP_STOPPED = {unset: 1, joined: 1, full: 1, hold: 1, nopad: 1, nores: 1, noext: 1, ruled: 1, notanks: 1, nocap: 1, nosrc: 1, busy: 1, low: 1, ctrloff: 1};

function isLiquidRes(v){ return v != null && v instanceof Packages.mindustry.type.Liquid; }
function isShipControl(b){ return b != null && b.block === shipControl; }
function controlOn(b){ return isShipControl(b) && !b.dead && b.enabled !== false; }
function isPumpBlock(blk){ return blk != null && typeof blk.pumpAmount === "number"; }
function isTankBlock(blk){
    if(blk == null) return false;
    if(LiquidRouterType != null){
        try{ return blk instanceof LiquidRouterType; }catch(e){ LiquidRouterType = null; }
    }
    return blk.liquidCapacity > 0 && !isPumpBlock(blk);
}

function clampPct(v){
    var n = Math.round(+v);
    if(isNaN(n)) return SHIP_DEFAULT_PCT;
    return Math.max(0, Math.min(100, n));
}

function modRes(res, pct){ return {k: "res", res: res, pct: pct === undefined ? SHIP_DEFAULT_PCT : clampPct(pct), st: "unset", on: false}; }
function modRest(){ return {k: "rest", land: false, side: "def", pts: [], pads: [], list: [], timerOn: false, sec: REST_DEFAULT_SEC, hold: false, st: "unset"}; }
function modLand(){ return {k: "land", side: "def", pads: [], list: [], hold: false, st: "unset"}; }
var LAND_SIDES = ["def", "up", "down", "left", "right", "auto"];
function sideOf(v){ return LAND_SIDES.indexOf(v) >= 0 ? v : "def"; }
function modPreload(){ return {k: "preload", list: []}; }
function modLiqLoad(res, pct){ return {k: "liqload", res: res, pct: pct === undefined ? SHIP_DEFAULT_PCT : clampPct(pct)}; }
function modJoin(){ return {k: "join", pt: null, ang: 0, st: "unset"}; }
function modCraftJoin(){ return {k: "craftjoin"}; }
function modProc(){ return {k: "proc", when: "land", act: "on", list: []}; }
var CENTER_MODES = ["hull", "mean", "block"];
function centerModeOf(v){ return CENTER_MODES.indexOf(v) >= 0 ? v : "mean"; }
function modCenter(){ return {k: "center", mode: "mean", dx: 0, dy: 0}; }
var PROC_WHEN = ["land", "lift", "damage"], PROC_ACT = ["on", "off", "toggle"];
function wholeDeg(v){
    var n = Math.round(+v);
    if(isNaN(n)) return 0;
    n = n % 360;
    return n < 0 ? n + 360 : n;
}
var PRELOAD_MAX = 1000000, PRELOAD_DEFAULT = 100;
function clampAmount(v){
    var n = Math.round(+v);
    if(isNaN(n)) return PRELOAD_DEFAULT;
    return Math.max(1, Math.min(PRELOAD_MAX, n));
}
function isTaskMod(mod){ return mod.k != "rule" && mod.k != "preload" && mod.k != "liqload" && mod.k != "proc" && mod.k != "craftjoin" && mod.k != "center"; }
function clampSec(v){
    var n = Math.round(+v);
    if(isNaN(n)) return REST_DEFAULT_SEC;
    return Math.max(1, Math.min(REST_MAX_SEC, n));
}
function copyPoints(list){
    var out = [];
    (list || []).forEach(p => { if(p != null && p.length >= 2 && !isNaN(+p[0]) && !isNaN(+p[1])) out.push([(+p[0]) | 0, (+p[1]) | 0]); });
    return out;
}
function modRule(){ return {k: "rule", all: true, dx: 0, dy: 0, white: false, list: []}; }

function shipCode(v){ return (isLiquidRes(v) ? "l:" : "i:") + v.name; }
function shipFromCode(s){
    if(s == null || s.length < 3) return null;
    return Vars.content.getByName(s.charAt(0) == "l" ? ContentType.liquid : ContentType.item, s.substring(2));
}
function modToData(mod){
    if(mod.k == "res") return {k: "res", r: shipCode(mod.res), p: mod.pct};
    if(mod.k == "rest") return {k: "rest", l: mod.land === true, sd: sideOf(mod.side), pts: copyPoints(mod.pts), pads: copyPoints(mod.pads), r: mod.list.map(e => ({r: shipCode(e.res), p: e.pct})), to: mod.timerOn === true, sec: mod.sec};
    if(mod.k == "preload") return {k: "preload", list: mod.list.map(e => ({r: shipCode(e.res), n: e.amount}))};
    if(mod.k == "liqload") return {k: "liqload", r: shipCode(mod.res), p: mod.pct};
    if(mod.k == "join") return {k: "join", p: mod.pt == null ? null : [mod.pt[0], mod.pt[1]], g: mod.ang};
    if(mod.k == "craftjoin") return {k: "craftjoin"};
    if(mod.k == "proc") return {k: "proc", w: mod.when, a: mod.act, list: copyPoints(mod.list)};
    if(mod.k == "center") return {k: "center", m: centerModeOf(mod.mode), dx: mod.dx | 0, dy: mod.dy | 0};
    if(mod.k == "rule") return {k: "rule", all: mod.all === true, dx: mod.dx, dy: mod.dy, w: mod.white === true, list: mod.list.map(shipCode)};
    return {k: "land", sd: sideOf(mod.side), pads: copyPoints(mod.pads), hold: mod.hold === true, list: mod.list.map(e => ({r: shipCode(e.res), p: e.pct}))};
}
function modFromData(o){
    if(o == null) return null;
    if(o.k == "res"){
        var r = shipFromCode(o.r);
        return r == null ? null : modRes(r, o.p);
    }
    if(o.k == "ready" || o.k == "rest"){
        var rd = modRest();
        if(o.k == "ready"){
            if(o.x != null && o.y != null) rd.pts.push([o.x | 0, o.y | 0]);
            return rd;
        }
        rd.land = o.l === true;
        rd.side = sideOf(o.sd);
        rd.pts = copyPoints(o.pts);
        rd.pads = copyPoints(o.pads);
        (o.r || []).forEach(e => {
            var rr = shipFromCode(e.r);
            if(rr != null) rd.list.push({res: rr, pct: clampPct(e.p)});
        });
        rd.timerOn = o.to === true;
        rd.sec = clampSec(o.sec === undefined ? REST_DEFAULT_SEC : o.sec);
        return rd;
    }
    if(o.k == "preload"){
        var pl = modPreload();
        (o.list || []).forEach(e => {
            var ir = shipFromCode(e.r);
            if(ir != null && !isLiquidRes(ir)) pl.list.push({res: ir, amount: clampAmount(e.n)});
        });
        return pl;
    }
    if(o.k == "liqload"){
        var lr = shipFromCode(o.r);
        return lr == null || !isLiquidRes(lr) ? null : modLiqLoad(lr, o.p);
    }
    if(o.k == "join"){
        var jn = modJoin();
        var jp = copyPoints(o.p == null ? [] : [o.p]);
        jn.pt = jp.length > 0 ? jp[0] : null;
        jn.ang = wholeDeg(o.g);
        return jn;
    }
    if(o.k == "craftjoin") return modCraftJoin();
    if(o.k == "proc"){
        var pr = modProc();
        pr.when = PROC_WHEN.indexOf(o.w) >= 0 ? o.w : "land";
        pr.act = PROC_ACT.indexOf(o.a) >= 0 ? o.a : "on";
        pr.list = copyPoints(o.list);
        return pr;
    }
    if(o.k == "center"){
        var ce = modCenter();
        ce.mode = centerModeOf(o.m);
        ce.dx = (+o.dx) | 0;
        ce.dy = (+o.dy) | 0;
        return ce;
    }
    if(o.k == "rule"){
        var ru = modRule();
        ru.all = o.all !== false;
        ru.dx = (+o.dx) | 0;
        ru.dy = (+o.dy) | 0;
        ru.white = o.w === true;
        (o.list || []).forEach(code => {
            var rr = shipFromCode(code);
            if(rr != null) ru.list.push(rr);
        });
        return ru;
    }
    if(o.k == "land"){
        var ld = modLand();
        ld.pads = copyPoints(o.pads !== undefined ? o.pads : (o.pad == null ? [] : [o.pad]));
        ld.hold = o.hold === true;
        ld.side = sideOf(o.sd);
        (o.list || []).forEach(e => {
            var er = shipFromCode(e.r);
            if(er != null) ld.list.push({res: er, pct: clampPct(e.p)});
        });
        return ld;
    }
    return null;
}
function modsToData(list){ return list.map(modToData); }
function modsFromData(list){
    var out = [];
    (list || []).forEach(o => {
        var mod = modFromData(o);
        if(mod != null) out.push(mod);
    });
    return out;
}
function modsFromJson(s){
    try{ return modsFromData(JSON.parse(s)); }catch(e){ return []; }
}
function legacyMods(code){
    var r = shipFromCode(code);
    return r == null ? [] : [modRes(r, SHIP_DEFAULT_PCT)];
}
function shipModsOf(b){ return S.shipMods[b.id] || (S.shipMods[b.id] = []); }
function shipSetMods(b, list){
    S.shipMods[b.id] = list;
    S.saveDirty = true;
}
function shipSaveList(blds){
    var out = [];
    blds.forEach(b => {
        if(isShipControl(b) && S.shipMods[b.id] != null && S.shipMods[b.id].length > 0) out.push([b.tile.x, b.tile.y, modsToData(S.shipMods[b.id])]);
    });
    return out;
}
function firstResource(b){
    var list = S.shipMods[b.id] || [];
    for(var i = 0; i < list.length; i++){
        if(list[i].k == "res" && list[i].res != null) return list[i].res;
    }
    return null;
}
function shipSourceMap(){
    if(S.shipMap != null) return S.shipMap;
    var map = {items: [], liquids: [], itemTiles: {}, liquidTiles: {}};
    var seenI = {}, seenL = {};
    var w = Vars.world, W = w.width(), H = w.height();
    try{
        for(var x = 0; x < W; x++){
            for(var y = 0; y < H; y++){
                var t = w.tile(x, y);
                if(t == null) continue;
                var d = t.drop();
                if(d != null){
                    if(seenI[d.id] === undefined){
                        seenI[d.id] = true;
                        map.items.push(d);
                        map.itemTiles[d.id] = [];
                    }
                    map.itemTiles[d.id].push(Point2.pack(x, y));
                }
                var f = t.floor();
                var l = f == null ? null : f.liquidDrop;
                if(l != null){
                    if(seenL[l.id] === undefined){
                        seenL[l.id] = true;
                        map.liquids.push(l);
                        map.liquidTiles[l.id] = [];
                    }
                    map.liquidTiles[l.id].push(Point2.pack(x, y));
                }
            }
        }
    }catch(e){
        logErr("ship source map", e);
    }
    map.items.sort((p, q) => p.id - q.id);
    map.liquids.sort((p, q) => p.id - q.id);
    S.shipMap = map;
    return map;
}

function nearestSource(res, wx, wy, claims){
    var map = shipSourceMap();
    var list = isLiquidRes(res) ? map.liquidTiles[res.id] : map.itemTiles[res.id];
    if(list == null || list.length == 0) return null;
    var best = -1, bestD = 1e18, cx = wx / TS, cy = wy / TS;
    for(var i = 0; i < list.length; i++){
        var px = Point2.x(list[i]), py = Point2.y(list[i]);
        var dx = px - cx, dy = py - cy, dd = dx * dx + dy * dy;
        if(dd < bestD){
            if(claims != null && claims.length > 0 && claimedTile(claims, px, py)) continue;
            bestD = dd;
            best = list[i];
        }
    }
    return best < 0 ? null : [Point2.x(best), Point2.y(best)];
}

function claimLive(o){
    return o.mode == "fly" && o.air == null && o.wasPossessed !== true && o.hadOrder !== true && Time.time - (o.shipSeen || 0) < 90;
}
function teamShips(m){
    var out = [];
    for(var i = 0; i < S.machines.length; i++){
        var o = S.machines[i];
        if(o !== m && o.team != null && m.team != null && o.team.id == m.team.id) out.push(o);
    }
    return out;
}

function oreClaims(m, res){
    var out = [], liq = isLiquidRes(res);
    teamShips(m).forEach(o => {
        var g = o.shipGoal;
        if(g == null || g.kind != "res" || g.res == null || isLiquidRes(g.res) != liq || g.res.id != res.id || !claimLive(o)) return;
        out.push({x: g.tx, y: g.ty, d: (m.radius + o.radius) / TS + ORE_CLAIM_EXTRA_TILES});
    });
    return out;
}
function claimedTile(claims, x, y){
    for(var i = 0; i < claims.length; i++){
        var dx = x - claims[i].x, dy = y - claims[i].y;
        if(dx * dx + dy * dy < claims[i].d * claims[i].d) return true;
    }
    return false;
}

function samePoint(a, b){ return a != null && b != null && a[0] == b[0] && a[1] == b[1]; }

function padState(m, pad){
    if(m.pad != null && m.pad.x == pad[0] && m.pad.y == pad[1]) return "mine";
    var ships = teamShips(m);
    for(var i = 0; i < ships.length; i++){
        var o = ships[i], g = o.shipGoal;
        if(o.pad != null && o.pad.x == pad[0] && o.pad.y == pad[1]) return "taken";
        if(g != null && g.kind == "land" && g.tx == pad[0] && g.ty == pad[1] && claimLive(o)) return "taken";
        if(o.air != null && samePoint(o.air.pad, pad)) return "taken";
    }
    return F.padAlive(m, pad) ? "free" : "gone";
}

function padChoice(m, pads){
    var g = m.shipGoal, i, st, taken = false;
    if(g != null && g.kind == "land"){
        for(i = 0; i < pads.length; i++){
            if(pads[i][0] != g.tx || pads[i][1] != g.ty) continue;
            st = padState(m, pads[i]);
            if(st == "mine" || st == "free") return {pad: pads[i], taken: false};
        }
    }
    for(i = 0; i < pads.length; i++){
        if(padState(m, pads[i]) == "mine") return {pad: pads[i], taken: false};
    }
    for(i = 0; i < pads.length; i++){
        st = padState(m, pads[i]);
        if(st == "free") return {pad: pads[i], taken: false};
        if(st == "taken") taken = true;
    }
    return {pad: null, taken: taken};
}

function pointTaken(m, pt){
    var ships = teamShips(m);
    for(var i = 0; i < ships.length; i++){
        var o = ships[i], g = o.shipGoal;
        if(g == null || g.kind != "ready" || !claimLive(o)) continue;
        var d = (m.radius + o.radius) / TS;
        var dx = g.tx - pt[0], dy = g.ty - pt[1];
        if(dx * dx + dy * dy < d * d) return true;
    }
    return false;
}

function pointChoice(m, pts){
    var g = m.shipGoal, i;
    if(g != null && g.kind == "ready"){
        for(i = 0; i < pts.length; i++){
            if(pts[i][0] == g.tx && pts[i][1] == g.ty && !pointTaken(m, pts[i])) return pts[i];
        }
    }
    for(i = 0; i < pts.length; i++){
        if(!pointTaken(m, pts[i])) return pts[i];
    }
    return null;
}

var LogicBlockType = null;
try{ LogicBlockType = Packages.mindustry.world.blocks.logic.LogicBlock; }catch(e){ LogicBlockType = null; }
function isProcessor(b){ return b != null && LogicBlockType != null && b.block instanceof LogicBlockType; }
var PROC_COOLDOWN = 30;

function procApply(m, c, mod){
    var blds = machineBlocks(m);
    mod.list.forEach(p => {
        for(var i = 0; i < blds.length; i++){
            var b = blds[i];
            if(b.dead || !isProcessor(b)) continue;
            if(b.tile.x - c.tile.x != p[0] || b.tile.y - c.tile.y != p[1]) continue;
            try{
                b.enabled = mod.act == "on" ? true : (mod.act == "off" ? false : !b.enabled);
                b.enabledControlTime = 0;
            }catch(e){
                logErr("proc apply", e);
            }
            return;
        }
    });
}

function shipEvent(m, when){
    if(m.ctrlOff === true) return;
    var blds = machineBlocks(m);
    for(var i = 0; i < blds.length; i++){
        var c = blds[i];
        if(!controlOn(c)) continue;
        var list = S.shipMods[c.id];
        if(list == null) continue;
        for(var j = 0; j < list.length; j++){
            var mod = list[j];
            if(mod.k == "proc" && mod.when == when && mod.list.length > 0) procApply(m, c, mod);
        }
    }
}

function procTick(delta){
    S.procWatchTimer = (S.procWatchTimer === undefined ? 0 : S.procWatchTimer) - delta;
    if(S.procWatchTimer <= 0){
        S.procWatchTimer = 30;
        S.procWatch = false;
        for(var id in S.shipMods){
            var ml = S.shipMods[id];
            for(var q = 0; q < ml.length; q++){
                if(ml[q].k == "proc" && ml[q].when == "damage" && ml[q].list.length > 0){ S.procWatch = true; break; }
            }
            if(S.procWatch) break;
        }
    }
    if(S.procWatch !== true) return;
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        m.procTimer = (m.procTimer === undefined ? 0 : m.procTimer) - delta;
        if(m.hpCool !== undefined && m.hpCool > 0) m.hpCool -= delta;
        if(m.procTimer > 0) continue;
        m.procTimer = 10;
        try{
            var blds = machineBlocks(m);
            var watch = false;
            for(var k = 0; k < blds.length && !watch; k++){
                var c = blds[k], list = S.shipMods[c.id];
                if(list == null || !controlOn(c)) continue;
                for(var j = 0; j < list.length; j++){
                    if(list[j].k == "proc" && list[j].when == "damage" && list[j].list.length > 0){ watch = true; break; }
                }
            }
            if(!watch){ m.hpSum = undefined; continue; }
            var sum = 0, cnt = 0;
            for(var n = 0; n < blds.length; n++){
                if(blds[n].dead) continue;
                sum += blds[n].health;
                cnt++;
            }
            var skip = F.isEdited(m) && m.mode == "land";
            if(m.hpSum !== undefined && !skip && (sum < m.hpSum - 0.01 || cnt < m.hpCnt) && !(m.hpCool > 0)){
                m.hpCool = PROC_COOLDOWN;
                shipEvent(m, "damage");
            }
            m.hpSum = sum;
            m.hpCnt = cnt;
        }catch(e){
            logErr("procTick", e);
        }
    }
}

function machineBlocks(m){ return m.mode == "fly" ? m.parts : F.membersOf(m.cells, m.team); }

function shipMachineOf(b){ return F.machineOfBuild(b) || S.partIndex[b.id] || null; }

function stockOf(blds, res){
    var liq = isLiquidRes(res), have = 0, cap = 0;
    blds.forEach(b => {
        if(b.dead || isConstructing(b)) return;
        if(liq){
            if(isTankBlock(b.block) && b.liquids != null){
                have += b.liquids.get(res);
                cap += b.block.liquidCapacity;
            }
        }else if(b.items != null && b.block instanceof StorageBlock){
            have += b.items.get(res);
            cap += b.getMaximumAccepted(res);
        }
    });
    return {have: have, cap: cap};
}
function shipStock(m, res){ return stockOf(machineBlocks(m), res); }

function hasTanks(blds){
    return blds.some(b => !b.dead && !isConstructing(b) && isTankBlock(b.block));
}

function isDrillBlock(blk){ return blk != null && blk instanceof Drill; }
function isExtractorBlock(blk){ return isDrillBlock(blk) || isPumpBlock(blk); }

function rulesOf(blds){
    var out = [];
    for(var i = 0; i < blds.length; i++){
        var c = blds[i];
        if(!controlOn(c)) continue;
        var list = S.shipMods[c.id];
        if(list == null) continue;
        for(var j = 0; j < list.length; j++){
            if(list[j].k == "rule" && list[j].list.length > 0) out.push({c: c, r: list[j]});
        }
    }
    return out;
}

function ruleTarget(c, r, blds){
    for(var i = 0; i < blds.length; i++){
        var b = blds[i];
        if(b.dead || !isExtractorBlock(b.block)) continue;
        if(b.tile.x - c.tile.x == r.dx && b.tile.y - c.tile.y == r.dy) return b;
    }
    return null;
}

// The Center module that decides the pivot of a machine: the first one of the control block with the lowest id.
function centerPick(blds){
    var ctl = blds.filter(b => controlOn(b) && S.shipMods[b.id] != null);
    ctl.sort((p, q) => p.id - q.id);
    for(var i = 0; i < ctl.length; i++){
        var list = S.shipMods[ctl[i].id];
        for(var j = 0; j < list.length; j++){
            if(list[j].k == "center") return {b: ctl[i], mod: list[j]};
        }
    }
    return null;
}

function hullsOf(blds){
    return blds.filter(b => !b.dead && isHull(b) && !isConstructing(b));
}

function centerBlockAt(blds, c, mod){
    for(var i = 0; i < blds.length; i++){
        var x = blds[i];
        if(!x.dead && x.tile.x - c.tile.x == mod.dx && x.tile.y - c.tile.y == mod.dy) return x;
    }
    return null;
}

// The pivot in the tile coordinates of blds (null: no Center module, or it cannot work) and the state to show.
function centerInfo(blds){
    var pick = centerPick(blds);
    if(pick == null) return {pick: null, point: null, state: "centeroff"};
    var mod = pick.mod;
    if(mod.mode == "mean"){
        var sx = 0, sy = 0, n = 0;
        blds.forEach(b => {
            if(b.dead) return;
            coverTiles(b).forEach(p => { sx += Point2.x(p); sy += Point2.y(p); n++; });
        });
        if(n == 0) return {pick: pick, point: null, state: "centernoblock"};
        return {pick: pick, point: [sx / n, sy / n], state: "centeron"};
    }
    if(mod.mode == "hull" && hullsOf(blds).length < 2) return {pick: pick, point: null, state: "centerhulls"};
    var x = centerBlockAt(blds, pick.b, mod);
    if(x == null || isConstructing(x) || (mod.mode == "hull" && !isHull(x))) return {pick: pick, point: null, state: "centernoblock"};
    return {pick: pick, point: centerOf(x), state: "centeron"};
}

function centerPoint(blds){ return centerInfo(blds).point; }

function centerState(b, mod){
    var m = shipMachineOf(b);
    if(m == null) return "centeron";
    var info = centerInfo(machineBlocks(m));
    if(info.pick == null) return "centeroff";
    return info.pick.mod === mod ? info.state : "centerother";
}

function rulesAllow(rules, b, res){
    var liq = isLiquidRes(res);
    for(var i = 0; i < rules.length; i++){
        var c = rules[i].c, r = rules[i].r;
        if(!r.all && !(b.tile.x - c.tile.x == r.dx && b.tile.y - c.tile.y == r.dy)) continue;
        var named = false, has = false;
        for(var j = 0; j < r.list.length; j++){
            if(isLiquidRes(r.list[j]) != liq) continue;
            named = true;
            if(r.list[j].id == res.id) has = true;
        }
        if(!named) continue;
        if(r.white ? !has : has) return false;
    }
    return true;
}

function ruleFilter(m, bd){
    var rc = m.ruleCache;
    if(rc === undefined || rc.stamp !== m.oreStamp || rc.parts !== m.parts) rc = m.ruleCache = {stamp: m.oreStamp, parts: m.parts, list: rulesOf(m.parts)};
    if(rc.list.length == 0) return null;
    return res => rulesAllow(rc.list, bd, res);
}

var RULE_PERIOD = 6;
var PumpType = null, SolidPumpType = null;
try{
    PumpType = Packages.mindustry.world.blocks.production.Pump;
    SolidPumpType = Packages.mindustry.world.blocks.production.SolidPump;
}catch(e){ PumpType = null; SolidPumpType = null; }
var ruleTiles = new Seq();

function isFloorPump(blk){
    return PumpType != null && blk instanceof PumpType && !(SolidPumpType != null && blk instanceof SolidPumpType);
}

function drillChoice(b, allow){
    var blk = b.block, counts = {}, items = {};
    b.tile.getLinkedTilesAs(blk, ruleTiles);
    for(var i = 0; i < ruleTiles.size; i++){
        var t = ruleTiles.get(i);
        if(!blk.canMine(t)) continue;
        var d = blk.getDrop(t);
        if(d == null || (allow != null && !allow(d))) continue;
        counts[d.id] = (counts[d.id] || 0) + 1;
        items[d.id] = d;
    }
    var best = null, bc = 0;
    for(var id in items){
        var it = items[id], c = counts[id];
        var better;
        if(best == null) better = true;
        else if(best.lowPriority != it.lowPriority) better = !it.lowPriority;
        else if(c != bc) better = c > bc;
        else better = it.id > best.id;
        if(better){ best = it; bc = c; }
    }
    return [best, bc];
}

function pumpChoice(b, allow){
    var drop = null, amount = 0;
    b.tile.getLinkedTiles(ruleTiles);
    for(var i = 0; i < ruleTiles.size; i++){
        var t = ruleTiles.get(i);
        if(t == null) continue;
        var f = t.floor();
        if(f == null || f.liquidDrop == null) continue;
        if(allow != null && !allow(f.liquidDrop)) continue;
        drop = f.liquidDrop;
        amount += f.liquidMultiplier;
    }
    return [drop, amount];
}

function applyRulesLanded(m){
    var now = Time.globalTime, c = m.ruleCache;
    if(c === undefined || c.ver !== S.layoutVersion || now < c.at || now - c.at > 30){
        var all = machineBlocks(m);
        c = m.ruleCache = {
            ver: S.layoutVersion, at: now, rules: rulesOf(all),
            ext: all.filter(b => isExtractorBlock(b.block) && !(isPumpBlock(b.block) && !isFloorPump(b.block)))
        };
    }
    var blds = c.ext, rules = c.rules;
    for(var i = 0; i < blds.length; i++){
        var b = blds[i];
        if(b.dead || isConstructing(b)) continue;
        var pump = isPumpBlock(b.block);
        var was = S.ruled[b.id] === true;
        if(rules.length == 0 && !was) continue;
        var allow = rules.length == 0 ? null : (res => rulesAllow(rules, b, res));
        if(pump){
            var pc = pumpChoice(b, allow);
            b.liquidDrop = pc[0];
            b.amount = pc[1];
        }else{
            var dc = drillChoice(b, allow);
            b.dominantItem = dc[0];
            b.dominantItems = dc[1];
        }
        if(rules.length == 0) delete S.ruled[b.id]; else S.ruled[b.id] = true;
    }
}

function enforceRules(m, delta){
    if(m.mode != "land") return;
    m.ruleTimer = (m.ruleTimer === undefined ? 0 : m.ruleTimer) - delta;
    if(m.ruleTimer > 0) return;
    m.ruleTimer = RULE_PERIOD;
    applyRulesLanded(m);
}

function shipChanged(b){
    S.saveDirty = true;
    try{
        var m = shipMachineOf(b);
        if(m != null){
            m.shipTimer = 0;
            m.restHold = false;
            m.pivotDirty = true;
        }
    }catch(e){
        logErr("ship changed", e);
    }
}

function ruleChanged(b){
    S.saveDirty = true;
    try{
        var m = shipMachineOf(b);
        if(m == null) return;
        m.shipTimer = 0;
        m.ruleCache = undefined;
        if(m.mode == "fly") F.refreshOre(m);
        else if(m.mode == "land"){ m.ruleTimer = 0; applyRulesLanded(m); }
    }catch(e){
        logErr("rule changed", e);
    }
}

function ruleState(b, mod){
    if(mod.list.length == 0) return "ruleempty";
    if(!mod.all){
        var m = shipMachineOf(b);
        if(m == null || ruleTarget(b, mod, machineBlocks(m)) == null) return "ruleblock";
    }
    return "ruleon";
}

function hasExtractor(blds, res, ignoreRules){
    var liq = isLiquidRes(res);
    var rules = ignoreRules === true ? [] : rulesOf(blds);
    return blds.some(b => {
        if(b.dead || isConstructing(b)) return false;
        var can = liq ? isPumpBlock(b.block) : (b.block instanceof Drill && b.block.tier >= res.hardness);
        return can && rulesAllow(rules, b, res);
    });
}

function shipExtractor(m, res){
    var liq = isLiquidRes(res);
    var rules = rulesOf(m.parts);
    for(var i = 0; i < m.parts.length; i++){
        var b = m.parts[i];
        if(b.dead || isConstructing(b)) continue;
        if(liq){
            if(isPumpBlock(b.block) && rulesAllow(rules, b, res)) return b;
        }else if(b.block instanceof Drill && b.block.tier >= res.hardness && rulesAllow(rules, b, res)){
            return b;
        }
    }
    return null;
}

function shipModuleList(m){
    var blds = machineBlocks(m).filter(b => controlOn(b) && S.shipMods[b.id] != null);
    blds.sort((p, q) => p.id - q.id);
    var out = [];
    blds.forEach(b => S.shipMods[b.id].forEach(mod => { if(isTaskMod(mod)) out.push({b: b, mod: mod}); }));
    return out;
}

function modWant(m, mod){
    if(mod.k == "res") return resWant(m, mod);
    if(mod.k == "rest") return restWant(m, mod);
    if(mod.k == "join") return joinWant(m, mod);
    return landWant(m, mod);
}

function unavailable(mod, st){
    mod.st = st;
    mod.on = false;
    return null;
}

function resWant(m, mod){
    var res = mod.res;
    if(res == null) return unavailable(mod, "unset");
    var blds = machineBlocks(m);
    var liq = isLiquidRes(res);
    if(liq && !hasTanks(blds)) return unavailable(mod, "notanks");
    if(!hasExtractor(blds, res)) return unavailable(mod, hasExtractor(blds, res, true) ? "ruled" : "noext");
    var st = stockOf(blds, res);
    if(st.cap <= 0) return unavailable(mod, liq ? "notanks" : "nocap");
    if(st.have >= st.cap * mod.pct / 100){
        if(mod.on){
            mod.on = false;
            say("mb.msg.shipdone", res.localizedName);
        }
        mod.st = "full";
        return null;
    }
    var key = "r" + (liq ? "l" : "i") + res.id;
    var tile = null, g = m.shipGoal;
    if(!(g != null && g.kind == "res" && g.key == key)){
        tile = shipNearestTile(m, res);
        if(tile == null) return unavailable(mod, nearestSource(res, m.x, m.y) == null ? "nosrc" : "busy");
    }
    mod.st = "need";
    if(!mod.on){
        mod.on = true;
        say("mb.msg.shipgo", res.localizedName);
    }
    return {key: key, kind: "res", mod: mod, res: res, tile: tile};
}

function restLow(blds, mod){
    for(var i = 0; i < mod.list.length; i++){
        var e = mod.list[i], st = stockOf(blds, e.res);
        if(st.cap > 0 && st.have < st.cap * e.pct / 100) return true;
    }
    return false;
}

function restWant(m, mod){
    var land = mod.land === true;
    var points = land ? mod.pads : mod.pts;
    if(points.length == 0){
        mod.resting = false;
        return unavailable(mod, land ? "nopad" : "unset");
    }
    if(mod.hold){
        mod.resting = false;
        mod.st = "hold";
        return null;
    }
    var low = restLow(machineBlocks(m), mod);
    if(mod.resting === true){
        if(low || (mod.timerOn === true && Time.time - mod.since >= mod.sec * 60)){
            mod.resting = false;
            m.restHold = true;
            mod.st = low ? "low" : "full";
            return null;
        }
    }else if(low){
        mod.st = "low";
        return null;
    }
    var tgt = null, key, want;
    if(land){
        var ch = padChoice(m, mod.pads);
        if(ch.pad == null){
            mod.resting = false;
            return unavailable(mod, ch.taken ? "busy" : "nopad");
        }
        tgt = ch.pad;
        key = "l" + tgt[0] + "_" + tgt[1];
        var landed = m.pad != null && m.pad.x == tgt[0] && m.pad.y == tgt[1];
        if(landed && mod.resting !== true){ mod.resting = true; mod.since = Time.time; }
        else if(!landed) mod.resting = false;
        want = {key: key, kind: "land", mod: mod, pad: tgt, landed: landed, side: sideOf(mod.side)};
    }else{
        tgt = pointChoice(m, mod.pts);
        if(tgt == null){
            mod.resting = false;
            return unavailable(mod, "busy");
        }
        key = "p" + tgt[0] + "_" + tgt[1];
        var g = m.shipGoal;
        var there = m.mode == "fly" && g != null && g.key == key && Mathf.dst(m.x, m.y, tgt[0] * TS, tgt[1] * TS) < 4 * TS;
        if(there && m.arrived === true && mod.resting !== true){ mod.resting = true; mod.since = Time.time; }
        else if(!there) mod.resting = false;
        want = {key: key, kind: "ready", mod: mod, tx: tgt[0], ty: tgt[1]};
    }
    mod.st = mod.resting === true ? "rest" : (land ? "fly" : "go");
    return want;
}

function joinWant(m, mod){
    if(mod.pt == null) return unavailable(mod, "unset");
    if(m.bonds != null && m.bonds.length > 0){
        mod.st = "joined";
        mod.on = false;
        return null;
    }
    var key = "j" + mod.pt[0] + "_" + mod.pt[1] + "_" + mod.ang;
    var g = m.shipGoal;
    var there = m.mode == "fly" && g != null && g.key == key && m.arrived === true;
    mod.st = there ? "joinhold" : "joinfly";
    return {key: key, kind: "join", mod: mod, tx: mod.pt[0], ty: mod.pt[1], ang: mod.ang};
}

function landWant(m, mod){
    if(mod.pads.length == 0) return unavailable(mod, "nopad");
    if(mod.hold){ mod.st = "hold"; return null; }
    if(mod.list.length == 0) return unavailable(mod, "nores");
    var blds = machineBlocks(m), full = true;
    for(var i = 0; i < mod.list.length; i++){
        var e = mod.list[i], st = stockOf(blds, e.res);
        if(isLiquidRes(e.res) && !hasTanks(blds)) return unavailable(mod, "notanks");
        if(st.cap <= 0) return unavailable(mod, "nocap");
        if(st.have < st.cap * e.pct / 100) full = false;
    }
    if(full){
        mod.st = "full";
        if(m.pad != null && mod.pads.some(q => q[0] == m.pad.x && q[1] == m.pad.y)) F.liftPad(m);
        return null;
    }
    var ch = padChoice(m, mod.pads);
    if(ch.pad == null) return unavailable(mod, ch.taken ? "busy" : "nopad");
    var landed = m.pad != null && m.pad.x == ch.pad[0] && m.pad.y == ch.pad[1];
    mod.st = landed ? "landed" : "need";
    return {key: "l" + ch.pad[0] + "_" + ch.pad[1], kind: "land", mod: mod, pad: ch.pad, landed: landed, side: sideOf(mod.side)};
}

function modSetUp(mod){
    if(mod.k == "res") return mod.res != null;
    if(mod.k == "rest") return (mod.land === true ? mod.pads : mod.pts).length > 0;
    if(mod.k == "join") return mod.pt != null;
    return mod.pads.length > 0;
}

function releaseHolds(m, list, someoneHasShip){
    var held = false;
    for(var i = 0; i < list.length; i++) if(list[i].mod.hold === true){ held = true; break; }
    if(!held){ m.holdFree = 0; return; }
    var free = m.mode == "fly" && m.wasPossessed !== true && m.hadOrder !== true;
    m.holdFree = free ? (m.holdFree | 0) + SHIP_PERIOD : 0;
    if(!(someoneHasShip && free) && m.holdFree < HOLD_FREE_TICKS) return;
    for(var j = 0; j < list.length; j++){
        if(list[j].mod.hold === true){ list[j].mod.hold = false; list[j].mod.st = "wait"; }
    }
    m.holdFree = 0;
    S.saveDirty = true;
}

// Autopilot: the modules of the control block take turns steering the machine.
function shipTick(m, delta){
    var onPad = m.mode == "land" && m.pad != null;
    if(m.mode != "fly" && !onPad) return;
    if(m.air != null) return;
    m.shipTimer = (m.shipTimer === undefined ? 0 : m.shipTimer) - delta;
    if(m.shipTimer > 0) return;
    m.shipTimer = SHIP_PERIOD;
    if(m.rtsMine != null){ rtsMineTick(m); return; }
    if(m.rtsOn === true) rtsMineEnd(m);
    if(m.ctrlOff === true){ ctrlOffTick(m); return; }
    var list = shipModuleList(m), n = list.length, cur = 0, pick = null, at = -1, i;
    for(i = 0; i < n; i++){
        if(list[i].mod === m.shipCur){ cur = i; break; }
    }
    for(var s = 0; s < n; s++){
        i = (cur + s) % n;
        pick = modWant(m, list[i].mod);
        if(pick != null){ at = i; break; }
    }
    releaseHolds(m, list, pick != null);
    var reach = at < 0 ? n : (at - cur + n) % n;
    for(var j = 0; j < n; j++){
        if(j == at) continue;
        if(((j - cur + n) % n) < reach) continue;
        var other = list[j].mod;
        if(!SHIP_STOPPED[other.st] || (other.st == "unset" && modSetUp(other))) other.st = "wait";
    }
    if(pick == null){
        if(m.restHold === true) return;
        m.shipGoal = null;
        m.fit = null;
        if(m.pad != null) F.liftPad(m);
        return;
    }
    m.shipCur = pick.mod;
    m.restHold = false;
    if(pick.kind == "res") pick.mod.st = "work";
    else if(pick.mod.k == "rest") pick.mod.st = pick.mod.resting === true ? "rest" : (pick.kind == "land" ? "fly" : "go");
    else if(pick.mod.k == "join"){  }
    else pick.mod.st = pick.landed ? "landed" : "fly";
    if(pick.landed){ m.fit = null; return; }
    if(m.pad != null) F.liftPad(m);
    if(m.mode != "fly") return;
    if(m.shipGoal == null || m.shipGoal.key != pick.key) m.shipGoal = goalFor(m, pick);
    if(m.shipGoal != null && m.shipGoal.kind == "land") m.shipGoal.side = pick.side;
    fitStep(m);
}

function ctrlOffTick(m){
    m.shipGoal = null;
    m.shipCur = null;
    m.fit = null;
    m.restHold = false;
    shipModuleList(m).forEach(e => {
        e.mod.st = "ctrloff";
        e.mod.on = false;
        e.mod.resting = false;
    });
}

function ctrlOffNow(m){
    m.shipTimer = 0;
    if(m.ctrlOff === true){
        m.shipGoal = null;
        m.shipCur = null;
        m.fit = null;
        m.restHold = false;
        return;
    }
    try{
        shipModuleList(m).forEach(e => { if(e.mod.st == "ctrloff") e.mod.st = "wait"; });
    }catch(e){
        logErr("ctrl off now", e);
    }
}

var RTS_REPICK_TICKS = 240;

function rtsMineWant(m){
    var o = m.rtsMine, blds = machineBlocks(m), items = shipSourceMap().items, cands = [], i;
    for(i = 0; i < items.length; i++){
        var it = items[i];
        if(o.auto){
            if(it.lowPriority) continue;
        }else if(!o.items.some(q => q.id == it.id)){
            continue;
        }
        if(!hasExtractor(blds, it)) continue;
        var st = stockOf(blds, it);
        if(st.cap <= 0 || st.have >= st.cap) continue;
        cands.push({it: it, have: st.have, cap: st.cap});
    }
    if(cands.length == 0) return null;
    cands.sort((p, q) => (p.have - q.have) || (p.it.id - q.it.id));
    var g = m.shipGoal, now = Time.time, keepFirst = null;
    if(g != null && g.kind == "res" && !isLiquidRes(g.res)){
        for(i = 0; i < cands.length; i++) if(cands[i].it.id == g.res.id) keepFirst = cands[i];
    }
    var order = cands;
    if(keepFirst != null){
        var young = now >= (m.rtsPickAt || 0) && now - (m.rtsPickAt || 0) < RTS_REPICK_TICKS;
        var clear = cands[0].have + Math.max(10, keepFirst.cap * 0.1) < keepFirst.have;
        if(!young) m.rtsPickAt = now;
        if(young || cands[0] === keepFirst || !clear) order = [keepFirst].concat(cands.filter(c => c !== keepFirst));
    }
    for(i = 0; i < order.length; i++){
        var c = order[i], key = "ri" + c.it.id;
        var tile = null;
        if(!(g != null && g.kind == "res" && g.key == key)){
            tile = shipNearestTile(m, c.it);
            if(tile == null) continue;
            m.rtsPickAt = now;
        }
        return {key: key, kind: "res", mod: null, res: c.it, tile: tile};
    }
    return null;
}

function rtsMineTick(m){
    if(m.mode != "fly") return;
    var pick = rtsMineWant(m);
    m.rtsOn = true;
    m.shipCur = null;
    m.restHold = false;
    if(pick == null){
        m.shipGoal = null;
        m.fit = null;
        if(m.rtsItem != null){
            m.rtsItem = null;
            say("mb.msg.rtsidle");
        }
        return;
    }
    if(m.rtsItem !== pick.res.id){
        m.rtsItem = pick.res.id;
        say("mb.msg.shipgo", pick.res.localizedName);
    }
    if(m.pad != null) F.liftPad(m);
    if(m.shipGoal == null || m.shipGoal.key != pick.key) m.shipGoal = goalFor(m, pick);
    fitStep(m);
}

function rtsMineEnd(m){
    m.rtsOn = false;
    m.rtsItem = null;
    m.shipGoal = null;
    m.shipCur = null;
    m.fit = null;
    m.restHold = false;
}

var FIT_MIN_SEP = TS;

function fitExtractors(m, res){
    var liq = isLiquidRes(res), rules = rulesOf(m.parts), out = [];
    for(var i = 0; i < m.parts.length; i++){
        var b = m.parts[i];
        if(b.dead || isConstructing(b)) continue;
        var pump = isPumpBlock(b.block);
        var can = liq ? pump : (b.block instanceof Drill && b.block.tier >= res.hardness);
        if(!can || !rulesAllow(rules, b, res)) continue;
        out.push({b: b, pump: pump, cells: coverTiles(b).map(p => [Point2.x(p), Point2.y(p)]), allow: ruleFilter(m, b)});
    }
    return out;
}

function dominantOf(counts, items){
    var best = null, bc = 0;
    for(var id in items){
        var it = items[id], c = counts[id], better;
        if(best == null) better = true;
        else if(best.lowPriority != it.lowPriority) better = !it.lowPriority;
        else if(c != bc) better = c > bc;
        else better = it.id > best.id;
        if(better){ best = it; bc = c; }
    }
    return best;
}

function liquidOfCell(m, cx, cy, allow){
    var areas = {}, floors = {}, best = null, bestA = 0;
    F.cellOverlaps(m, cx, cy).forEach(o => {
        var f = o.t.floor();
        if(f == null || f.liquidDrop == null) return;
        if(allow != null && !allow(f.liquidDrop)) return;
        areas[f.id] = (areas[f.id] || 0) + o.a;
        floors[f.id] = f;
    });
    for(var id in areas){
        if(areas[id] > bestA){ bestA = areas[id]; best = floors[id]; }
    }
    return best == null ? null : best.liquidDrop;
}

function fitMeasure(m, res, exts){
    F.refreshOre(m);
    var useful = 0;
    for(var i = 0; i < exts.length; i++){
        var e = exts[i], b = e.b;
        if(b.dead) continue;
        if(e.pump){
            if(b.liquidDrop == null || b.liquidDrop.id != res.id) continue;
            for(var k = 0; k < e.cells.length; k++){
                var t = m.pocket.get(e.cells[k][0], e.cells[k][1]);
                var f = t == null ? null : t.floor();
                if(f != null && f.liquidDrop != null && f.liquidDrop.id == res.id) useful++;
            }
        }else if(b.dominantItem != null && b.dominantItem.id == res.id){
            useful += b.dominantItems;
        }
    }
    return useful;
}

function fitScoreAt(m, res, exts, wx, wy){
    var ox = m.x, oy = m.y, useful = 0;
    m.x = wx;
    m.y = wy;
    try{
        for(var i = 0; i < exts.length; i++){
            var e = exts[i], k;
            if(e.pump){
                for(k = 0; k < e.cells.length; k++){
                    var lq = liquidOfCell(m, e.cells[k][0], e.cells[k][1], e.allow);
                    if(lq != null && lq.id == res.id) useful++;
                }
            }else{
                var counts = {}, items = {};
                for(k = 0; k < e.cells.length; k++){
                    var it = F.sampleOre(m, e.cells[k][0], e.cells[k][1], e.allow);
                    if(it == null) continue;
                    counts[it.id] = (counts[it.id] || 0) + 1;
                    items[it.id] = it;
                }
                var dom = dominantOf(counts, items);
                if(dom != null && dom.id == res.id) useful += counts[dom.id];
            }
        }
    }finally{
        m.x = ox;
        m.y = oy;
    }
    return useful;
}

function veinSize(res, tx, ty, cap){
    var liq = isLiquidRes(res), w = Vars.world;
    function match(t){
        if(t == null) return false;
        if(liq){
            var f = t.floor();
            return f != null && f.liquidDrop != null && f.liquidDrop.id == res.id;
        }
        var d = t.drop();
        return d != null && d.id == res.id;
    }
    if(!match(w.tile(tx, ty))) return 0;
    var seen = {}, queue = [[tx, ty]], head = 0;
    seen[Point2.pack(tx, ty)] = true;
    while(head < queue.length && queue.length < cap){
        var c = queue[head++];
        for(var dx = -1; dx <= 1; dx++){
            for(var dy = -1; dy <= 1; dy++){
                if(dx == 0 && dy == 0) continue;
                var nx = c[0] + dx, ny = c[1] + dy, key = Point2.pack(nx, ny);
                if(seen[key] === true) continue;
                seen[key] = true;
                if(match(w.tile(nx, ny)) && queue.length < cap) queue.push([nx, ny]);
            }
        }
    }
    return Math.min(queue.length, cap);
}

function fitScan(m, f, res){
    var map = Vars.world;
    if(f.cands == null){
        f.cands = [];
        f.grid = [];
        f.scan = 0;
        var R = FIT_SEARCH_TILES, maxX = (map.width() - 1) * TS, maxY = (map.height() - 1) * TS;
        for(var i = -R; i <= R; i++){
            for(var j = -R; j <= R; j++){
                if(i * i + j * j > R * R) continue;
                var px = m.x + i * TS, py = m.y + j * TS;
                if(px < 0 || py < 0 || px > maxX || py > maxY) continue;
                f.grid.push({x: px, y: py, d: i * i + j * j});
            }
        }
        f.grid.sort((p, q) => p.d - q.d);
    }
    if(f.scan >= f.grid.length) return;
    var per = Math.max(1, Math.floor(FIT_SCAN_CELLS / Math.max(1, f.cellCount)));
    var end = Math.min(f.grid.length, f.scan + per);
    for(; f.scan < end; f.scan++){
        var p = f.grid[f.scan];
        f.cands.push({x: p.x, y: p.y, score: fitScoreAt(m, res, f.exts, p.x, p.y)});
    }
}

function fitNext(m, f){
    var best = null, bd = 0;
    for(var i = 0; i < (f.cands || []).length; i++){
        var c = f.cands[i];
        if(c.score <= f.best.score) continue;
        var tried = false;
        for(var j = 0; j < f.tried.length; j++){
            if(Mathf.dst(c.x, c.y, f.tried[j].x, f.tried[j].y) < FIT_MIN_SEP){ tried = true; break; }
        }
        if(tried) continue;
        var d = Mathf.dst(c.x, c.y, m.x, m.y);
        if(best == null || c.score > best.score || (c.score == best.score && d < bd)){ best = c; bd = d; }
    }
    return best == null ? null : {x: best.x, y: best.y};
}

function fitStep(m){
    var g = m.shipGoal;
    if(g == null || g.kind != "res" || g.res == null || m.mode != "fly"){ m.fit = null; return; }
    var f = m.fit, now = Time.time;
    if(f == null || f.key !== g.key || f.tx !== g.tx || f.ty !== g.ty || f.parts !== m.parts){
        var exts = fitExtractors(m, g.res), cells = 0;
        exts.forEach(e => { cells += e.cells.length; });
        f = m.fit = {key: g.key, tx: g.tx, ty: g.ty, parts: m.parts, exts: exts, cellCount: cells, stage: "go", since: now, hopSince: now, force: false,
            tried: [], best: null, hop: null, cands: null, grid: null, scan: 0, possible: -1};
    }
    if(f.stage == "done" || f.exts.length == 0) return;
    var arrived = m.arrived === true;
    if(f.stage == "go"){
        if(arrived){ f.stage = "stand"; f.since = now; f.cands = null; }
        return;
    }
    if(f.stage == "hop" || f.stage == "settle"){
        if(arrived || now - f.hopSince > FIT_HOP_TIMEOUT){
            if(f.stage == "settle"){ f.stage = "done"; return; }
            f.stage = "stand";
            f.force = !arrived;
            f.since = arrived ? now : now - FIT_WAIT_TICKS;
        }
        return;
    }
    if(!arrived && f.force !== true){
        f.stage = f.hop != null ? "hop" : "go";
        f.hopSince = now;
        return;
    }
    fitScan(m, f, g.res);
    if(now - f.since < FIT_WAIT_TICKS) return;
    fitDecide(m, f, g);
}

function fitDecide(m, f, g){
    f.force = false;
    var useful = fitMeasure(m, g.res, f.exts);
    if(f.possible < 0) f.possible = Math.min(f.cellCount, veinSize(g.res, g.tx, g.ty, f.cellCount));
    f.tried.push({x: m.x, y: m.y, score: useful});
    if(f.best == null || useful > f.best.score) f.best = {x: m.x, y: m.y, score: useful};
    var enough = f.possible <= 0 || useful >= FIT_MIN_SHARE * f.possible - 1e-9;
    if(enough){
        f.stage = "done";
        return;
    }
    var next = f.tried.length < FIT_MAX_TRIES ? fitNext(m, f) : null;
    if(next != null){
        f.hop = {x: next.x, y: next.y};
        f.stage = "hop";
        f.hopSince = Time.time;
        f.force = false;
        m.arrived = false;
        m.headFrozen = false;
        return;
    }
    say("mb.msg.fitbest", Math.round(f.best.score * 100 / f.possible), f.tried.length);
    f.hop = {x: f.best.x, y: f.best.y};
    if(Mathf.dst(f.best.x, f.best.y, m.x, m.y) < FIT_MIN_SEP){
        f.stage = "done";
    }else{
        f.stage = "settle";
        f.hopSince = Time.time;
        m.arrived = false;
        m.headFrozen = false;
    }
}

function goalFor(m, pick){
    if(pick.kind == "res"){
        var tile = pick.tile != null ? pick.tile : shipNearestTile(m, pick.res);
        return tile == null ? null : {key: pick.key, kind: "res", res: pick.res, tx: tile[0], ty: tile[1]};
    }
    if(pick.kind == "ready") return {key: pick.key, kind: "ready", tx: pick.tx, ty: pick.ty};
    if(pick.kind == "join") return {key: pick.key, kind: "join", tx: pick.tx, ty: pick.ty, ang: pick.ang};
    var anchor = storageTiles(m)[0];
    if(anchor == null) return null;
    return {key: pick.key, kind: "land", tx: pick.pad[0], ty: pick.pad[1], ax: anchor[0], ay: anchor[1]};
}

function shipNearestTile(m, res){
    var px = m.x, py = m.y;
    var ext = shipExtractor(m, res);
    if(ext != null){
        var wp = extractorOffset(m, ext);
        px = m.x + wp[0];
        py = m.y + wp[1];
    }
    return nearestSource(res, px, py, oreClaims(m, res));
}

function shipRefresh(m){
    if(m.mode != "fly") return;
    try{
        m.shipTimer = 0;
        var g = m.shipGoal;
        if(g == null || g.kind != "res") return;
        var tile = shipNearestTile(m, g.res);
        m.shipGoal = tile == null ? null : {key: g.key, kind: "res", res: g.res, tx: tile[0], ty: tile[1]};
    }catch(e){
        logErr("ship refresh", e);
    }
}

function shipWatchCommands(m, possessed, hasOrder){
    m.shipSeen = Time.time;
    var done = (m.hadOrder === true && !hasOrder && !possessed) || (m.wasPossessed === true && !possessed);
    m.hadOrder = hasOrder;
    m.wasPossessed = possessed;
    if(done) shipRefresh(m);
}

function extractorOffset(m, b){
    var lx = b.tile.drawx() - m.ref[0] * TS, ly = b.tile.drawy() - m.ref[1] * TS;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    return [lx * c - ly * s, lx * s + ly * c, Math.sqrt(lx * lx + ly * ly)];
}

function tileOffset(m, px, py){
    var lx = px * TS - m.ref[0] * TS, ly = py * TS - m.ref[1] * TS;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    return [lx * c - ly * s, lx * s + ly * c, Math.sqrt(lx * lx + ly * ly)];
}

function shipGoal(m){
    var g = m.shipGoal;
    if(g == null || m.mode != "fly") return null;
    if(g.kind == "ready") return {x: g.tx * TS, y: g.ty * TS, stop: 0, target: null, lever: 0};
    if(g.kind == "join") return {x: g.tx * TS, y: g.ty * TS, stop: 0, target: null, lever: 0, ang: g.ang, holdJoin: true};
    if(g.kind == "land"){
        var o = tileOffset(m, g.ax, g.ay);
        return {x: g.tx * TS - o[0], y: g.ty * TS - o[1], stop: 0, target: null, lever: o[2]};
    }
    var f = m.fit;
    if(f != null && f.hop != null && f.key === g.key) return {x: f.hop.x, y: f.hop.y, stop: 0, target: null, lever: 0, noTurn: true};
    var ext = shipExtractor(m, g.res);
    if(ext == null) return null;
    var off = extractorOffset(m, ext);
    return {x: g.tx * TS - off[0], y: g.ty * TS - off[1], stop: 0, target: null, lever: off[2]};
}

function storageTiles(m){
    var out = [];
    m.parts.forEach(b => {
        if(b.dead || isConstructing(b) || !(b.block instanceof StorageBlock)) return;
        coverTiles(b).forEach(p => out.push([Point2.x(p), Point2.y(p)]));
    });
    out.sort((p, q) => refDist2(m, p) - refDist2(m, q));
    return out;
}
function refDist2(m, t){
    var dx = t[0] - m.ref[0], dy = t[1] - m.ref[1];
    return dx * dx + dy * dy;
}

F.SHIP_DEFAULT_PCT = SHIP_DEFAULT_PCT;
F.isLiquidRes = isLiquidRes;
F.isShipControl = isShipControl;
F.isProcessor = isProcessor;
F.shipEvent = shipEvent;
F.procTick = procTick;
F.modJoin = modJoin;
F.modCraftJoin = modCraftJoin;
F.modProc = modProc;
F.PROC_WHEN = PROC_WHEN;
F.PROC_ACT = PROC_ACT;
F.wholeDeg = wholeDeg;
F.isPumpBlock = isPumpBlock;
F.clampPct = clampPct;
F.modRes = modRes;
F.firstResource = firstResource;
F.modRest = modRest;
F.clampSec = clampSec;
F.modLand = modLand;
F.LAND_SIDES = LAND_SIDES;
F.modRule = modRule;
F.modCenter = modCenter;
F.CENTER_MODES = CENTER_MODES;
F.centerPoint = centerPoint;
F.centerState = centerState;
F.centerBlockAt = centerBlockAt;
F.hullsOf = hullsOf;
F.modPreload = modPreload;
F.modLiqLoad = modLiqLoad;
F.clampAmount = clampAmount;
F.PRELOAD_DEFAULT = PRELOAD_DEFAULT;
F.isTankBlock = isTankBlock;
F.modsToData = modsToData;
F.modsFromData = modsFromData;
F.modsFromJson = modsFromJson;
F.legacyMods = legacyMods;
F.shipModsOf = shipModsOf;
F.shipSetMods = shipSetMods;
F.shipSaveList = shipSaveList;
F.shipSourceMap = shipSourceMap;
F.machineBlocks = machineBlocks;
F.shipMachineOf = shipMachineOf;
F.stockOf = stockOf;
F.shipStock = shipStock;
F.hasTanks = hasTanks;
F.isDrillBlock = isDrillBlock;
F.isExtractorBlock = isExtractorBlock;
F.ruleTarget = ruleTarget;
F.ruleFilter = ruleFilter;
F.ruleChanged = ruleChanged;
F.shipChanged = shipChanged;
F.enforceRules = enforceRules;
F.ruleState = ruleState;
F.hasExtractor = hasExtractor;
F.shipModuleList = shipModuleList;
F.shipTick = shipTick;
F.ctrlOffNow = ctrlOffNow;
F.shipRefresh = shipRefresh;
F.controlOn = controlOn;
F.procApply = procApply;
F.applyRulesLanded = applyRulesLanded;
F.shipWatchCommands = shipWatchCommands;
F.shipGoal = shipGoal;
F.storageTiles = storageTiles;
