'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var boosterPower = F.boosterPower;
var logErr = F.logErr;
var cellsOf = F.cellsOf, isConstructing = F.isConstructing, isHull = F.isHull, sameTeam = F.sameTeam;
var boosterThrust = F.boosterThrust, isBooster = F.isBooster;
var driverType = F.driverType;

function reindexAll(){
    S.layoutVersion++;
    S.cellIndex = {};
    S.partIndex = {};
    S.machines.forEach(m => {
        if(m.mode == "land"){
            for(var k in m.cells) S.cellIndex[k] = m;
        }else{
            m.parts.forEach(b => { S.partIndex[b.id] = m; });
        }
    });
}

function machineOfBuild(b){
    if(b == null || b.tile == null) return null;
    return S.cellIndex[Point2.pack(b.tile.x, b.tile.y)] || null;
}

function machineAtTile(tile){
    if(tile == null) return null;
    return S.cellIndex[tile.pos()] || null;
}

function landedMachines(){
    return S.machines.filter(m => m.mode == "land");
}

function flyingMachines(){
    return S.machines.filter(m => m.mode == "fly");
}

function hullBuild(m){
    if(m.mode == "fly"){
        var h = m.hull;
        return h != null && !h.dead && S.partIndex[h.id] === m ? h : null;
    }
    var b = Vars.world.build(m.anchor);
    return isHull(b) && sameTeam(b, m.team) ? b : null;
}

function machinePos(m){
    if(m.mode == "fly") return [m.x, m.y];
    var h = hullBuild(m);
    return h == null ? [m.x, m.y] : [h.x, h.y];
}

function membersOf(cells, team){
    var seen = {}, out = [];
    for(var k in cells){
        var b = Vars.world.build(+k);
        if(b != null && sameTeam(b, team)){
            var key = b.pos();
            if(!seen[key]){
                seen[key] = true;
                out.push(b);
            }
        }
    }
    return out;
}

// Registers a new landed machine around a hull block (core or storage).
function createMachine(hull){
    var m = {
        id: S.nextId++, team: hull.team, mode: "land",
        anchor: hull.pos(), cells: cellsOf([hull]), pending: {},
        parts: [], hull: null, pocket: null, off: [0, 0], ref: [0, 0], realTiles: null,
        x: hull.x, y: hull.y, ang: 0, savedAng: 0, vx: 0, vy: 0, radius: 12,
        body: null, stats: null, oreCache: {}, oreStamp: 0, oreTimer: 0, lastOre: [0, 0, 0],
        target: null, targetTimer: 0, turrets: [], boosters: [], thrusting: false, flip: 0, progress: 0,
        front: 1, parked: false, bonds: [], gid: null, gnext: 1
    };
    S.machines.push(m);
    reindexAll();
    S.saveDirty = true;
    S.dirty = true;
    return m;
}

function dropMachine(m){
    var i = S.machines.indexOf(m);
    if(i >= 0) S.machines.splice(i, 1);
    removeBody(m);
    if(S.poss != null && S.poss.m === m) F.endPossession(true, "machine dropped");
    F.dropDrivers(m);
    reindexAll();
    S.saveDirty = true;
}

function machineStats(m){
    var blds = m.mode == "fly" ? m.parts : membersOf(m.cells, m.team);
    var boosters = 0, cells = 0, thrust = 0;
    blds.forEach(b => {
        if(isBooster(b)){
            boosters++;
            if(!isConstructing(b)) thrust += boosterThrust(b);
        }
        cells += b.block.size * b.block.size;
    });
    var speed = cells > 0 ? thrust * boosterPower() / cells : 0;
    return {blocks: blds.length, boosters: boosters, cells: cells, speed: speed};
}

function clientBody(m){
    if(m.body != null && m.body.isValid()) return m.body;
    m.body = null;
    if(m.bodyId === undefined || m.bodyId === null || m.bodyId < 0) return null;
    var u = Groups.unit.getByID(m.bodyId);
    if(u != null && u.isValid() && u.type == driverType) m.body = u;
    return m.body;
}

function ensureBody(m){
    if(Vars.net.client()) return clientBody(m);
    if(m.body != null && m.body.isValid()) return m.body;
    var pos = machinePos(m);
    var d = driverType.spawn(m.team, pos[0], pos[1]);
    d.hitSize = Math.max(8, m.radius * 2);
    m.body = d;
    return d;
}

function removeBody(m){
    if(Vars.net.client()){ m.body = null; return; }
    if(m.body != null){
        try{ if(m.body.isValid()) m.body.remove(); }catch(e){ logErr("removeBody", e); }
        m.body = null;
    }
}

function removeBodyKeepPossession(m){
    if(m.body != null){
        for(var id in S.drivers){
            var rd = S.drivers[id];
            try{
                if(rd.p != null && rd.p.unit() == m.body){
                    var nb = ensureBody(rd.m);
                    if(nb != null) Call.unitControl(rd.p, nb);
                }
            }catch(e){ logErr("body of a driver", e); }
        }
    }
    if(S.poss != null && m.body != null && Vars.player != null && Vars.player.unit() == m.body){
        var survivor = S.poss.m;
        var d = ensureBody(survivor);
        Vars.player.unit(d);
    }
    removeBody(m);
}

var HIT_DRAW_SCALE = 0.5;
var shrunkBodies = [];

function shrinkBodies(){
    if(shrunkBodies.length > 0) return;
    for(var i = 0; i < S.machines.length; i++){
        var d = S.machines[i].body;
        try{
            if(d == null || !d.isValid()) continue;
            var full = d.hitSize;
            shrunkBodies.push([d, full]);
            d.hitSize = full * HIT_DRAW_SCALE;
        }catch(e){
            logErr("shrinkBodies", e);
        }
    }
}

function restoreBodies(){
    for(var i = 0; i < shrunkBodies.length; i++){
        try{
            shrunkBodies[i][0].hitSize = shrunkBodies[i][1];
        }catch(e){
            logErr("restoreBodies", e);
        }
    }
    shrunkBodies = [];
}

// The body unit follows the machine so players and enemies can interact with it.
function keepBody(m){
    if(Vars.net.client()){
        var cd = clientBody(m);
        if(cd == null) return;
        var cp = machinePos(m);
        cd.set(cp[0], cp[1]);
        cd.vel.setZero();
        cd.hitSize = Math.max(8, m.radius * 2);
        return;
    }
    var d = m.body;
    if(d == null) return;
    if(!d.isValid()){ m.body = null; return; }
    var pos = machinePos(m);
    d.set(pos[0], pos[1]);
    d.vel.setZero();
    d.health = d.maxHealth;
}

F.reindexAll = reindexAll;
F.machineOfBuild = machineOfBuild;
F.machineAtTile = machineAtTile;
F.landedMachines = landedMachines;
F.flyingMachines = flyingMachines;
F.hullBuild = hullBuild;
F.machinePos = machinePos;
F.membersOf = membersOf;
F.createMachine = createMachine;
F.dropMachine = dropMachine;
F.machineStats = machineStats;
F.ensureBody = ensureBody;
F.clientBody = clientBody;
F.removeBodyKeepPossession = removeBodyKeepPossession;
F.shrinkBodies = shrinkBodies;
F.restoreBodies = restoreBodies;
F.keepBody = keepBody;
