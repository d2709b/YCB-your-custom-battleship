'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var DIRS = F.DIRS, TS = F.TS;
var onEvent = F.onEvent, say = F.say;
var blockRot = F.blockRot, cellsOf = F.cellsOf, components = F.components, coverTiles = F.coverTiles,
    isConstructing = F.isConstructing, isHull = F.isHull, originShift = F.originShift, sameTeam = F.sameTeam,
    splitGroups = F.splitGroups, turnFront = F.turnFront;
var createMachine = F.createMachine, dropMachine = F.dropMachine, hullBuild = F.hullBuild,
    landedMachines = F.landedMachines, machineAtTile = F.machineAtTile, machineOfBuild = F.machineOfBuild,
    machinePos = F.machinePos, membersOf = F.membersOf, reindexAll = F.reindexAll,
    removeBodyKeepPossession = F.removeBodyKeepPossession;
var applyConfigAbs = F.applyConfigAbs, configToAbs = F.configToAbs, landMachine = F.landMachine,
    placeReal = F.placeReal, takeOff = F.takeOff;
var groundBlast = F.groundBlast;
var hoveredBuilding = F.hoveredBuilding, pickMachine = F.pickMachine;

function refund(b){
    try{
        var core = b.team.core();
        if(core == null) return;
        var mult = Vars.state.rules.deconstructRefundMultiplier;
        var reqs = b.block.requirements;
        for(var i = 0; i < reqs.length; i++){
            var amount = Math.floor(reqs[i].amount * mult);
            var room = core.getMaximumAccepted(reqs[i].item) - core.items.get(reqs[i].item);
            if(amount > 0 && room > 0) core.items.add(reqs[i].item, Math.min(amount, room));
        }
    }catch(e){
        Log.err("[mb] refund failed: " + e);
    }
}

var LOOSE_BASE = 2;

function pidOf(player){ return player != null ? player.id : -1; }

function tell(player, key, a, b, c){
    if(player == null || player === Vars.player || player.con == null || F.netSay == null) say(key, a, b, c);
    else F.netSay(player, key, a, b, c);
}

function isEdited(m){
    if(m.editors != null){
        for(var k in m.editors) return true;
        return false;
    }
    return m.editorIds != null && m.editorIds.length > 0;
}

function markCells(m, b){
    if(isEdited(m)) return;
    if(m.marks == null) m.marks = {};
    coverTiles(b).forEach(p => { m.marks[p] = true; });
    m.markRev = (m.markRev | 0) + 1;
}

function unmarkCells(m, b){
    if(m.marks == null) return;
    coverTiles(b).forEach(p => { delete m.marks[p]; });
    m.markRev = (m.markRev | 0) + 1;
}

function clearMarks(team){
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.marks != null && m.team.id == team.id){ m.marks = null; m.markRev = (m.markRev | 0) + 1; }
    }
}

function marksSignature(m){
    var h = 0;
    if(m.marks != null) for(var k in m.marks) h = (h * 31 + (+k)) | 0;
    return h;
}

function clearEditing(m){
    if(m.editors != null){
        for(var pid in m.editors){
            var ed = S.editing[pid];
            if(ed != null) delete ed.ms[m.id];
        }
    }
    m.editors = null;
    if(m.marks != null){ m.marks = null; m.markRev = (m.markRev | 0) + 1; }
}

function editorIdsOf(m){
    var out = [];
    if(m.editors != null) for(var k in m.editors) out.push(+k);
    return out;
}

function isEditingPlayer(player){ return S.editing[pidOf(player)] != null; }

function addEditor(player, m){
    if(player == null) return;
    var pid = pidOf(player);
    var ed = S.editing[pid];
    if(ed == null) ed = S.editing[pid] = {p: player, ms: {}};
    if(m.editors == null) m.editors = {};
    m.editors[pid] = true;
    ed.ms[m.id] = true;
    if(m.marks != null){ m.marks = null; m.markRev = (m.markRev | 0) + 1; }
}

function machineById(id){
    for(var i = 0; i < S.machines.length; i++) if(S.machines[i].id === id) return S.machines[i];
    return null;
}

function touches(m, b){
    if(b.block === F.shipBuilder || b.block === F.landingSpot) return false;
    var cov = coverTiles(b);
    for(var i = 0; i < cov.length; i++){
        var x = Point2.x(cov[i]), y = Point2.y(cov[i]);
        for(var d = 0; d < 4; d++){
            var p = Point2.pack(x + DIRS[d][0], y + DIRS[d][1]);
            if(m.cells[p] || m.pending[p]) return true;
        }
    }
    return false;
}

function mergeTouching(m){
    var merged = false;
    if(m.parked) return false;
    for(var guard = 0; guard < 8; guard++){
        var other = null;
        for(var k in m.cells){
            var x = Point2.x(+k), y = Point2.y(+k);
            for(var d = 0; d < 4 && other == null; d++){
                var o = S.cellIndex[Point2.pack(x + DIRS[d][0], y + DIRS[d][1])];
                if(o != null && o !== m && !o.parked && o.team.id == m.team.id) other = o;
            }
            if(other != null) break;
        }
        if(other == null) break;
        for(var k1 in other.cells) m.cells[k1] = true;
        for(var k2 in other.pending) m.pending[k2] = true;
        for(var eid in (other.editors || {})){
            if(m.editors == null) m.editors = {};
            m.editors[eid] = true;
            if(S.editing[eid] != null){ S.editing[eid].ms[m.id] = true; delete S.editing[eid].ms[other.id]; }
        }
        F.retargetDrivers(other, m);
        var i = S.machines.indexOf(other);
        if(i >= 0) S.machines.splice(i, 1);
        removeBodyKeepPossession(other);
        reindexAll();
        merged = true;
    }
    return merged;
}

function spinOff(m, comp){
    var hull = null;
    comp.forEach(b => { if(isHull(b) && (hull == null || b.block.size > hull.block.size)) hull = b; });
    if(hull == null) return null;
    var made = createMachine(hull);
    made.cells = cellsOf(comp);
    made.pending = {};
    made.front = m.front;
    made.savedAng = m.savedAng || 0;
    made.parked = m.parked;
    if(m.editors != null){
        for(var eid in m.editors){
            if(made.editors == null) made.editors = {};
            made.editors[eid] = true;
            if(S.editing[eid] != null) S.editing[eid].ms[made.id] = true;
        }
    }
    if(m.body != null){
        try{ F.ensureBody(made); F.keepBody(made); }catch(e){ Log.err("[mb] spinOff body: " + e); }
    }
    return made;
}

// Re-checks connectivity of a landed machine; unattached blocks are marked or removed.
function reconcile(m, removeNow){
    if(S.busy || S.machines.indexOf(m) < 0 || m.mode != "land") return 0;
    var cand = {};
    for(var k in m.cells) cand[k] = true;
    for(var k2 in m.pending) cand[k2] = true;
    var blds = membersOf(cand, m.team);
    var comps = components(blds);

    var sp = splitGroups(comps, hullBuild(m));
    var good = sp.good, bad = sp.bad;
    var soft = !isEdited(m) && !removeNow;

    if(good.length == 0){
        if(soft){
            m.pending = {};
            dropMachine(m);
            return 0;
        }
        if(!removeNow){
            m.cells = {};
            m.pending = cellsOf(bad);
            reindexAll();
            return 0;
        }
        var n = 0;
        bad.forEach(b => {
            refund(b);
            S.busy = true;
            try{ b.tile.remove(); }finally{ S.busy = false; }
            n++;
        });
        dropMachine(m);
        return n;
    }

    if(sp.badComps != null && sp.badComps.length > 0){
        var withHull = sp.badComps.filter(c => c.some(isHull));
        if(withHull.length > 0){
            bad = sp.badComps.filter(c => !c.some(isHull)).reduce((acc, c) => acc.concat(c), []);
            withHull.forEach(c => spinOff(m, c));
        }
    }

    m.cells = cellsOf(good);
    if(m.marks != null){
        for(var mk in m.marks) if(!m.cells[mk]) delete m.marks[mk];
    }
    if(hullBuild(m) == null){
        var h = good.filter(isHull)[0];
        m.anchor = h.pos();
    }

    var removed = 0;
    if(!removeNow){
        m.pending = soft ? {} : cellsOf(bad);
    }else{
        m.pending = {};
        bad.forEach(b => {
            refund(b);
            S.busy = true;
            try{ b.tile.remove(); }finally{ S.busy = false; }
            removed++;
        });
    }
    reindexAll();
    mergeTouching(m);
    S.saveDirty = true;
    return removed;
}

function touchesCells(m, b){
    if(b.block === F.shipBuilder || b.block === F.landingSpot) return false;
    var cov = coverTiles(b);
    for(var i = 0; i < cov.length; i++){
        var x = Point2.x(cov[i]), y = Point2.y(cov[i]);
        for(var d = 0; d < 4; d++){
            if(m.cells[Point2.pack(x + DIRS[d][0], y + DIRS[d][1])]) return true;
        }
    }
    return false;
}

function adoptLoose(){
    var gained = [];
    var landed = landedMachines().filter(x => isEdited(x) || !x.parked);
    var list = [], seen = {};
    for(var k in S.loose){
        var b = Vars.world.build(+k);
        if(b == null || b.tile == null || machineOfBuild(b) != null){ delete S.loose[k]; continue; }
        if(isConstructing(b)) continue;
        if(seen[b.pos()]) continue;
        seen[b.pos()] = true;
        list.push(b);
    }
    if(landed.length == 0 || list.length == 0) return gained;
    var progress = true;
    while(progress && list.length > 0){
        progress = false;
        for(var i = list.length - 1; i >= 0; i--){
            var blk = list[i], owner = null;
            for(var j = 0; j < landed.length && owner == null; j++){
                if(landed[j].team.id == blk.team.id && touchesCells(landed[j], blk)) owner = landed[j];
            }
            if(owner == null) continue;
            coverTiles(blk).forEach(p => { owner.cells[p] = true; delete S.loose[p]; });
            if(gained.indexOf(owner) < 0) gained.push(owner);
            list.splice(i, 1);
            progress = true;
        }
    }
    if(gained.length > 0) reindexAll();
    return gained;
}

function purgeLoose(pid){
    adoptLoose();
    var seen = {}, n = 0;
    for(var k in S.loose){
        if(pid !== undefined && S.loose[k] !== true && S.loose[k] - LOOSE_BASE !== pid) continue;
        var b = Vars.world.build(+k);
        if(b == null || b.tile == null){ delete S.loose[k]; continue; }
        if(isConstructing(b) || seen[b.pos()]) continue;
        if(machineOfBuild(b) != null){ delete S.loose[k]; continue; }
        seen[b.pos()] = true;
        refund(b);
        var wasBusy = S.busy;
        S.busy = true;
        try{ b.tile.remove(); }finally{ S.busy = wasBusy; }
        coverTiles(b).forEach(p => { delete S.loose[p]; });
        n++;
    }
    if(pid === undefined) S.loose = {};
    return n;
}

function planMove(m, dx, dy){
    var blds = membersOf(m.cells, m.team);
    var anchor = hullBuild(m);
    if(anchor == null) return {ok: false, why: "noanchor"};
    var own = {};
    blds.forEach(b => coverTiles(b).forEach(p => { own[p] = true; }));

    var used = {}, plans = [];
    for(var i = 0; i < blds.length; i++){
        var b = blds[i];
        if(isConstructing(b)) return {ok: false, why: "constructing"};
        var s = b.block.size, off = originShift(s);
        for(var ax = 0; ax < s; ax++){
            for(var ay = 0; ay < s; ay++){
                var x = b.tile.x + dx + off + ax, y = b.tile.y + dy + off + ay;
                var t = Vars.world.tile(x, y);
                if(t == null) return {ok: false, why: "edge"};
                var p = t.pos();
                if(used[p]) return {ok: false, why: "overlap"};
                used[p] = true;
                if(!own[p]){
                    var bl = t.block();
                    if(t.build != null) return {ok: false, why: "blocked"};
                    if(bl != Blocks.air && !bl.alwaysReplace) return {ok: false, why: "blocked"};
                }
                var f = t.floor();
                if(f.solid) return {ok: false, why: "blocked"};
                if(f.isDeep() && !(b.block.floating || b.block.placeableLiquid || b.block.requiresWater)) return {ok: false, why: "water"};
                if(Vars.world.getDarkness(x, y) >= 3) return {ok: false, why: "edge"};
            }
        }
        plans.push({x: b.tile.x + dx, y: b.tile.y + dy, rot: blockRot(b)});
    }
    return {ok: true, blds: blds, plans: plans, dx: dx, dy: dy};
}

function applyMove(m, tr){
    var blds = tr.blds, plans = tr.plans;
    var wasBusy = S.busy;
    S.busy = true;
    try{
        var cfgs = blds.map(b => configToAbs(b));
        var memberCover = {};
        blds.forEach(b => coverTiles(b).forEach(p => { memberCover[p] = true; }));
        var anchorIdx = blds.findIndex(b => b.pos() == m.anchor);
        var blocks = blds.map(b => b.block), teams = blds.map(b => b.team);
        blds.forEach(b => b.pickedUp());
        blds.forEach(b => b.tile.setBlock(Blocks.air));
        blds.forEach(b => b.afterPickedUp());

        var mapPos = p => {
            if(!memberCover[p]) return null;
            return Point2.pack(Point2.x(p) + tr.dx, Point2.y(p) + tr.dy);
        };
        for(var i = 0; i < blds.length; i++) placeReal(blocks[i], teams[i], plans[i].rot, blds[i], plans[i].x, plans[i].y);
        for(var j = 0; j < blds.length; j++) applyConfigAbs(blds[j], cfgs[j], mapPos);

        if(anchorIdx >= 0) m.anchor = Point2.pack(plans[anchorIdx].x, plans[anchorIdx].y);
        m.cells = cellsOf(blds);
        reindexAll();
        S.dirty = true;
        S.saveDirty = true;
    }finally{
        S.busy = wasBusy;
    }
}

function stepMachine(m, dir){
    var tr = planMove(m, DIRS[dir][0], DIRS[dir][1]);
    if(!tr.ok) return tr.why;
    applyMove(m, tr);
    return "ok";
}

function setLocalMode(player, on){
    if(player === Vars.player) S.buildMode = on;
    else if(player != null && player.con != null && F.netSendGMode != null) F.netSendGMode(player, on);
}

function enterBuildMode(m, player){
    if(player === undefined) player = Vars.player;
    var pid = pidOf(player);
    if(S.editing[pid] == null) S.editing[pid] = {p: player, ms: {}};
    var ok = true;
    if(m != null && player != null && m.team.id != player.team().id) m = null;
    if(player != null) clearMarks(player.team());
    if(m != null){
        var landing = m.mode == "fly" && m.air != null && m.air.kind == "land" && m.air.keep !== true;
        if(m.mode == "fly" && !landing && !landMachine(m)){ ok = false; m = null; }
        if(m != null) addEditor(player, m);
    }
    setLocalMode(player, true);
    return ok;
}

function finishLanded(m, player){
    var removed = reconcile(m, true);
    if(removed > 0) tell(player, "mb.msg.removed", removed);
    if(S.machines.indexOf(m) < 0) return true;
    return takeOff(m);
}

// Leaves build mode: every edited machine is checked and takes off again.
function exitBuildMode(player){
    if(player === undefined) player = Vars.player;
    var pid = pidOf(player);
    var ed = S.editing[pid];
    if(ed == null){ setLocalMode(player, false); return true; }
    var ok = true;
    var lost = purgeLoose(pid);
    if(lost > 0) tell(player, "mb.msg.removed", lost);
    if(player != null) clearMarks(player.team());
    var handled = {};
    for(var round = 0; round < 16; round++){
        var todo = Object.keys(ed.ms).map(Number).filter(id => !handled[id]);
        if(todo.length == 0) break;
        todo.forEach(id => {
            handled[id] = true;
            var m = machineById(id);
            if(m != null && m.mode != "land" && m.editors != null) delete m.editors[pid];
            if(m == null || m.mode != "land"){ delete ed.ms[id]; return; }
            var others = false;
            if(m.editors != null) for(var ek in m.editors) if(+ek !== pid) others = true;
            if(others){ delete m.editors[pid]; delete ed.ms[id]; return; }
            if(m.parked){
                var cut = reconcile(m, true);
                if(cut > 0) tell(player, "mb.msg.removed", cut);
                if(m.editors != null) delete m.editors[pid];
                delete ed.ms[id];
                return;
            }
            if(finishLanded(m, player)){ m.exitTries = 0; if(m.editors != null) delete m.editors[pid]; delete ed.ms[id]; return; }
            m.exitTries = (m.exitTries || 0) + 1;
            if(m.exitTries >= 2 && S.machines.indexOf(m) >= 0){
                m.parked = true;
                m.exitTries = 0;
                tell(player, "mb.msg.stayparked");
                if(m.editors != null) delete m.editors[pid];
                delete ed.ms[id];
            }else{
                if(S.machines.indexOf(m) >= 0){
                    if(m.editors == null) m.editors = {};
                    m.editors[pid] = true;
                }
                ok = false;
            }
        });
    }
    if(ok) delete S.editing[pid];
    setLocalMode(player, !ok);
    S.saveDirty = true;
    return ok;
}

function toggleBuild(){
    if(Vars.net.client()){
        if(S.buildMode){ F.netRequest({t: "g", on: false}); return; }
        var cm = pickMachine();
        S.buildMode = true;
        F.netRequest({t: "g", on: true, m: cm != null ? cm.id : -1});
        return;
    }
    var p = Vars.player;
    if(p == null) return;
    if(isEditingPlayer(p)) exitBuildMode(p);
    else enterBuildMode(pickMachine(), p);
}

S.netHandlers.g = function(player, msg){
    if(msg.on === true){
        var m = msg.m >= 0 ? machineById(msg.m) : null;
        if(!enterBuildMode(m, player)) tell(player, "mb.msg.noroom");
    }else{
        exitBuildMode(player);
    }
    F.netSendGMode(player, isEditingPlayer(player));
};

function editorLeft(player){
    try{ exitBuildMode(player); }catch(e){ F.logErr("editor left", e); }
    delete S.editing[pidOf(player)];
}

function toggleLayer(b, player){
    if(player === undefined) player = Vars.player;
    if(b == null){ tell(player, "mb.msg.nolayerblock"); return; }
    if(isConstructing(b)){ return; }
    if(player != null && !sameTeam(b, player.team())) return;
    var m = machineOfBuild(b);
    if(m != null){
        unmarkCells(m, b);
        coverTiles(b).forEach(p => { delete m.cells[p]; delete m.pending[p]; });
        reindexAll();
        reconcile(m, false);
        tell(player, "mb.msg.toworld");
        return;
    }
    var team = b.team;
    var landed = landedMachines().filter(x => x.team.id == team.id);
    var touch = null;
    for(var i = 0; i < landed.length && touch == null; i++) if(touches(landed[i], b)) touch = landed[i];
    if(touch != null){
        coverTiles(b).forEach(p => { touch.cells[p] = true; });
        markCells(touch, b);
        reindexAll();
        reconcile(touch, false);
        tell(player, "mb.msg.tomachine");
        return;
    }
    if(isHull(b)){
        var made = createMachine(b);
        if(isEditingPlayer(player)) addEditor(player, made); else markCells(made, b);
        tell(player, "mb.msg.created");
        return;
    }
    tell(player, "mb.msg.notouch");
}

function screenTile(sx, sy){
    var v = Core.input.mouseWorld(sx, sy);
    var x = Math.round(v.x / TS), y = Math.round(v.y / TS);
    return [Math.max(0, Math.min(Vars.world.width() - 1, x)), Math.max(0, Math.min(Vars.world.height() - 1, y))];
}

function mouseTile(){
    return screenTile(Core.input.mouseX(), Core.input.mouseY());
}

function buildingsInRect(tx0, ty0, tx1, ty1, team){
    var minX = Math.min(tx0, tx1), maxX = Math.max(tx0, tx1), minY = Math.min(ty0, ty1), maxY = Math.max(ty0, ty1);
    var out = [];
    if(minX == maxX && minY == maxY){
        var t = Vars.world.tile(minX, minY);
        if(t != null && t.build != null && (team == null || sameTeam(t.build, team))) out.push(t.build);
        return out;
    }
    var cx = (minX + maxX) / 2 * TS, cy = (minY + maxY) / 2 * TS;
    var radius = Math.sqrt(Math.pow((maxX - minX + 1) * TS, 2) + Math.pow((maxY - minY + 1) * TS, 2)) / 2 + 8;
    var seen = {};
    Vars.indexer.eachBlock(null, cx, cy, radius, boolf(b => true), cons(b => {
        if(b.tile == null || (team != null && !sameTeam(b, team))) return;
        var key = b.pos();
        if(seen[key]) return;
        var s = b.block.size, off = originShift(s);
        var bx = b.tile.x + off, by = b.tile.y + off;
        if(bx > maxX || bx + s - 1 < minX || by > maxY || by + s - 1 < minY) return;
        seen[key] = true;
        out.push(b);
    }));
    return out;
}

function curTeam(player){
    var p = player !== undefined && player !== null ? player : Vars.player;
    return p != null ? p.team() : Team.sharded;
}

function layerDirection(blds, startBuild, team){
    team = team || curTeam();
    if(startBuild != null && sameTeam(startBuild, team) && !isConstructing(startBuild)){
        return machineOfBuild(startBuild) != null ? "leave" : "join";
    }
    for(var i = 0; i < blds.length; i++){
        if(!isConstructing(blds[i]) && machineOfBuild(blds[i]) == null) return "join";
    }
    return "leave";
}

function toggleLayerArea(blds, dir, team, player){
    team = team || curTeam();
    if(player === undefined) player = Vars.player;
    var own = blds.filter(b => !isConstructing(b));
    var touched = [];
    var mark = m => { if(touched.indexOf(m) < 0) touched.push(m); };
    var moved = 0;

    if(dir == "leave"){
        var inMachine = own.filter(b => machineOfBuild(b) != null);
        var owners = inMachine.map(b => machineOfBuild(b));
        inMachine.forEach((b, i) => {
            unmarkCells(owners[i], b);
            coverTiles(b).forEach(p => { delete owners[i].cells[p]; delete owners[i].pending[p]; });
            mark(owners[i]);
            moved++;
        });
    }else{
        var landed = landedMachines().filter(x => x.team.id == team.id);
        var left = own.filter(b => machineOfBuild(b) == null);
        while(left.length > 0){
            var progress = true;
            while(progress){
                progress = false;
                for(var i = left.length - 1; i >= 0; i--){
                    var b = left[i], touch = null;
                    for(var j = 0; j < landed.length && touch == null; j++){
                        if(touches(landed[j], b)) touch = landed[j];
                    }
                    if(touch == null) continue;
                    coverTiles(b).forEach(p => { touch.cells[p] = true; });
                    markCells(touch, b);
                    mark(touch);
                    left.splice(i, 1);
                    moved++;
                    progress = true;
                }
            }
            var hi = -1;
            for(var k = 0; k < left.length && hi < 0; k++) if(isHull(left[k])) hi = k;
            if(hi < 0) break;
            var hull = left.splice(hi, 1)[0];
            var made = createMachine(hull);
            if(isEditingPlayer(player)) addEditor(player, made); else markCells(made, hull);
            landed.push(made);
            mark(made);
            moved++;
        }
    }

    reindexAll();
    touched.forEach(m => { if(S.machines.indexOf(m) >= 0) reconcile(m, false); });
    S.saveDirty = true;

    if(moved == 0) tell(player, dir == "join" ? "mb.msg.areanotouch" : "mb.msg.areaempty");
    else tell(player, dir == "join" ? "mb.msg.areajoin" : "mb.msg.arealeave", moved);
}

function finishLayerSelection(x0, y0, x1, y1, startBuild){
    if(Vars.net.client()){
        F.netRequest({t: "layer", x0: x0, y0: y0, x1: x1, y1: y1, sp: startBuild != null && startBuild.tile != null ? startBuild.pos() : -1});
        return;
    }
    applyLayerSelection(Vars.player, x0, y0, x1, y1, startBuild);
}

function applyLayerSelection(player, x0, y0, x1, y1, startBuild){
    var team = player != null ? player.team() : Team.sharded;
    if(x0 == x1 && y0 == y1){
        var t = Vars.world.tile(x0, y0);
        toggleLayer(t == null ? null : t.build, player);
        return;
    }
    var blds = buildingsInRect(x0, y0, x1, y1, team);
    if(blds.length == 0){ tell(player, "mb.msg.areaempty"); return; }
    if(blds.length == 1) toggleLayer(blds[0], player);
    else toggleLayerArea(blds, layerDirection(blds, startBuild, team), team, player);
}

S.netHandlers.layer = function(player, msg){
    var sb = msg.sp >= 0 ? Vars.world.build(msg.sp) : null;
    applyLayerSelection(player, msg.x0, msg.y0, msg.x1, msg.y1, sb);
};

function startLayerDrag(touch, sx, sy, free){
    var isTouch = touch === true;
    var exact = isTouch && sx !== undefined && sy !== undefined;
    var px = isTouch ? (exact ? sx : Core.input.mouseX()) : 0, py = isTouch ? (exact ? sy : Core.input.mouseY()) : 0;
    var t = isTouch ? screenTile(px, py) : mouseTile();
    var tile = Vars.world.tile(t[0], t[1]);
    S.layerDrag = {sx: t[0], sy: t[1], cx: t[0], cy: t[1], start: tile == null ? null : tile.build, list: null, key: "", stamp: -1000, touch: isTouch, free: free === true,
        px: px, py: py, fx: null, fy: null, moved: false, up: false};
}

var TAP_SLOP = 28;

function updateLayerDrag(blocked){
    if(S.layerDrag == null) return;
    var d = S.layerDrag;
    var touch = d.touch === true;
    if((!S.buildMode && d.free !== true) || (blocked && !touch) || Vars.state.isPaused()){ S.layerDrag = null; return; }
    var held = touch ? (!d.up && Core.input.isTouched()) : Core.input.keyDown(KeyCode.y);
    if(touch){
        var fx = d.fx, fy = d.fy;
        if(fx == null){ fx = Core.input.mouseX(); fy = Core.input.mouseY(); }
        if(held || d.fx != null){
            if(!d.moved){
                var dx = fx - d.px, dy = fy - d.py;
                if(dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) d.moved = true;
            }
            if(d.moved){
                var ft = screenTile(fx, fy);
                d.cx = ft[0];
                d.cy = ft[1];
            }
        }
    }else{
        var t = mouseTile();
        d.cx = t[0];
        d.cy = t[1];
    }
    if(held) return;
    S.layerDrag = null;
    finishLayerSelection(d.sx, d.sy, d.cx, d.cy, d.start);
}

function yOutside(){
    var p = Vars.player;
    if(p == null) return;
    if(Core.input.keyDown(KeyCode.shiftLeft) || Core.input.keyDown(KeyCode.shiftRight)){
        F.togglePark();
        return;
    }
    var wx = Core.input.mouseWorldX(), wy = Core.input.mouseWorldY();
    var flying = null;
    var fl = F.flyingMachines();
    for(var i = 0; i < fl.length && flying == null; i++){
        if(fl[i].team.id == p.team().id && F.partAtWorld(fl[i], wx, wy) != null) flying = fl[i];
    }
    var t = Vars.world.tileWorld(wx, wy);
    var b = t == null ? null : t.build;
    if(flying == null && b != null && sameTeam(b, p.team()) && !isConstructing(b)){
        startLayerDrag(false, undefined, undefined, true);
        return;
    }
    F.togglePossess();
}

function frontMachine(wx, wy){
    var team = Vars.player.team();
    var m = machineAtTile(Vars.world.tileWorld(wx, wy));
    if(m != null && m.team.id == team.id) return m;
    if(S.poss != null && S.poss.m.mode == "land") return S.poss.m;
    var best = null, bd = 1e12;
    landedMachines().forEach(x => {
        if(x.team.id != team.id) return;
        var pos = machinePos(x);
        var d = Mathf.dst2(pos[0], pos[1], wx, wy);
        if(d < bd){ bd = d; best = x; }
    });
    return best;
}

function rotateFrontKey(){
    var hb = hoveredBuilding();
    if(hb != null && hb.block.rotate && hb.interactable(Vars.player.team())) return;
    var m = frontMachine(Core.input.mouseWorldX(), Core.input.mouseWorldY());
    if(m == null) return;
    var back = Core.input.keyDown(KeyCode.shiftLeft) || Core.input.keyDown(KeyCode.shiftRight);
    requestFront(m, back ? -1 : 1);
}

function requestFront(m, steps){
    if(Vars.net.client()){ F.netRequest({t: "front", m: m.id, s: steps}); return; }
    turnFront(m, steps);
}

S.netHandlers.front = function(player, msg){
    var m = machineById(msg.m);
    if(m == null || m.mode != "land" || m.team.id != player.team().id) return;
    turnFront(m, msg.s < 0 ? -1 : 1);
};

function rotateFrontAt(wx, wy, steps){
    if(!S.buildMode || Vars.player == null) return;
    var m = frontMachine(wx, wy);
    if(m == null){ say("mb.msg.norotate"); return; }
    requestFront(m, steps);
}

onEvent(BlockBuildEndEvent, e => {
    if(S.busy || S.inPocketOp > 0 || e.breaking) return;
    if(Vars.net.client()) return;
    var tile = e.tile;
    if(tile == null || tile.build == null) return;
    var b = tile.build;
    if(b.block === F.shipBuilder || b.block === F.landingSpot) return;
    var own = machineAtTile(tile);
    if(own != null){
        coverTiles(b).forEach(p => { own.cells[p] = true; });
        reindexAll();
        S.dirty = true;
        return;
    }
    var player = null;
    try{ player = e.unit != null ? e.unit.getPlayer() : null; }catch(err){ player = null; }
    if(!isEditingPlayer(player)) return;
    var landed = landedMachines().filter(m => m.team.id == e.team.id && (isEdited(m) || !m.parked));
    var touch = null;
    for(var i = 0; i < landed.length && touch == null; i++) if(touches(landed[i], b)) touch = landed[i];
    if(touch != null){
        coverTiles(b).forEach(p => { touch.cells[p] = true; });
        reindexAll();
        S.dirty = true;
        return;
    }
    if(isHull(b)){
        var made = createMachine(b);
        addEditor(player, made);
        S.dirty = true;
        return;
    }
    coverTiles(b).forEach(p => { S.loose[p] = pidOf(player) + LOOSE_BASE; });
    S.dirty = true;
});

function landedTouched(pos){
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.mode == "land" && (m.cells[pos] || m.pending[pos])) return true;
    }
    return false;
}

onEvent(TileChangeEvent, e => {
    if(S.busy || S.inPocketOp > 0) return;
    var t = e.tile;
    if(t == null) return;
    if(landedTouched(t.pos()) || S.loose[t.pos()]) S.dirty = true;
});

onEvent(BlockDestroyEvent, e => {
    if(S.busy || S.inPocketOp > 0) return;
    if(landedTouched(e.tile.pos()) || S.loose[e.tile.pos()]) S.dirty = true;
});

onEvent(BlockDestroyEvent, e => {
    if(S.busy || S.inPocketOp > 0) return;
    groundBlast(e.tile);
});

function processDirty(){
    if(!S.dirty || S.busy) return;
    S.dirty = false;
    adoptLoose();
    landedMachines().forEach(m => {
        if(S.machines.indexOf(m) < 0) return;
        reconcile(m, false);
    });
}

F.reconcile = reconcile;
F.isEdited = isEdited;
F.isEditingPlayer = isEditingPlayer;
F.addEditor = addEditor;
F.clearEditing = clearEditing;
F.marksSignature = marksSignature;
F.machineById = machineById;
F.netEditorIds = editorIdsOf;
F.netEditorLeft = editorLeft;
F.yOutside = yOutside;
F.tell = tell;
F.planMove = planMove;
F.stepMachine = stepMachine;
F.enterBuildMode = enterBuildMode;
F.exitBuildMode = exitBuildMode;
F.toggleBuild = toggleBuild;
F.toggleLayer = toggleLayer;
F.buildingsInRect = buildingsInRect;
F.layerDirection = layerDirection;
F.toggleLayerArea = toggleLayerArea;
F.startLayerDrag = startLayerDrag;
F.updateLayerDrag = updateLayerDrag;
F.rotateFrontKey = rotateFrontKey;
F.rotateFrontAt = rotateFrontAt;
F.processDirty = processDirty;
F.applyLayerSelection = applyLayerSelection;
F.screenTile = screenTile;
