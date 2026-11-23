'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var say = F.say;
var ensureBody = F.ensureBody, flyingMachines = F.flyingMachines, hullBuild = F.hullBuild,
    keepBody = F.keepBody, machineAtTile = F.machineAtTile, machinePos = F.machinePos;
var partAtWorld = F.partAtWorld;
var startLift = F.startLift;
var playerWantsFire = F.playerWantsFire;
var cameraGoal = F.cameraGoal;

function readInput(padOnly){
    if(S.testInput != null) return S.testInput;
    var ix = 0, iy = 0;
    if(padOnly !== true && !Vars.headless && Core.input != null && !Core.scene.hasKeyboard() && !Core.scene.hasDialog()){
        ix = Core.input.axis(Binding.moveX);
        iy = Core.input.axis(Binding.moveY);
    }
    return [Mathf.clamp(ix + S.padX, -1, 1), Mathf.clamp(iy + S.padY, -1, 1)];
}

S.drivers = {};

function localInput(){
    var cam = cameraGoal();
    var inp = readInput(cam != null);
    var spin = 0;
    if(!Vars.headless && Core.input != null && !Core.scene.hasKeyboard() && !Core.scene.hasDialog()){
        spin = (Core.input.keyDown(KeyCode.q) ? 1 : 0) - (Core.input.keyDown(KeyCode.e) ? 1 : 0);
    }
    var aim = null;
    if(S.testFire != null) aim = S.testFire;
    else if(!Vars.headless && Vars.player != null && playerWantsFire()) aim = [Vars.player.mouseX, Vars.player.mouseY];
    return {ix: inp[0], iy: inp[1], spin: spin, cam: cam, aim: aim};
}

function driverOf(m){
    if(S.poss != null && S.poss.m === m && !Vars.net.client()) return {local: true, m: m, input: localInput};
    for(var id in S.drivers){
        var d = S.drivers[id];
        if(d.m === m) return {local: false, m: m, p: d.p, input: () => d.stale() ? {ix: 0, iy: 0, spin: 0, cam: null, aim: null} : d.inp};
    }
    return null;
}

function allDrivers(){
    var out = [];
    if(S.poss != null && !Vars.net.client()) out.push(driverOf(S.poss.m));
    for(var id in S.drivers){
        var d = driverOf(S.drivers[id].m);
        if(d != null) out.push(d);
    }
    return out.filter(d => d != null);
}

function driversOfMachine(m){
    var out = [];
    var d = driverOf(m);
    if(d != null) out.push(d);
    return out;
}

function sayToDriver(d, key, a, b, c){
    if(d.local || d.p == null || F.netSay == null) say(key, a, b, c);
    else F.netSay(d.p, key, a, b, c);
}

function retargetDrivers(from, to){
    if(S.poss != null && S.poss.m === from) S.poss.m = to;
    for(var id in S.drivers){
        if(S.drivers[id].m === from) S.drivers[id].m = to;
    }
}

function dropDrivers(m){
    for(var id in S.drivers){
        if(S.drivers[id].m === m) delete S.drivers[id];
    }
}

function isDriven(m){
    return driverOf(m) != null;
}

// Puts the player in control of a machine through its body unit.
function startPossession(m){
    if(Vars.headless || Vars.player == null) return false;
    if(m.mode == "land" && m.pad != null) startLift(m);
    if(S.poss != null) endPossession(false);
    var p = Vars.player;
    var old = p.unit();
    var d = ensureBody(m);
    keepBody(m);
    p.unit(d);
    if(old != null && !old.dead && old.spawnedByCore) old.remove();
    S.poss = {m: m};
    return true;
}

function endPossession(silent, why){
    if(S.poss == null) return;
    Log.info("[mb] possession ends: " + (why || "requested"));
    if(!silent && Vars.player != null && Vars.player.team().core() == null){
        say("mb.msg.nocore");
        return;
    }
    var m = S.poss.m, p = Vars.player, d = m.body;
    S.poss = null;
    try{
        if(p != null && d != null && p.unit() == d) p.clearUnit();
        if(p != null) p.deathTimer = Player.deathDelay + 1;
    }catch(e){
        Log.err("[mb] end possession: " + e);
    }
    if(!silent) say("mb.msg.left");
}

function driveLanded(m, delta){
    var drv = driverOf(m);
    var inp = drv == null ? [0, 0] : [drv.input().ix, drv.input().iy];
    var ix = inp[0], iy = inp[1];
    if(ix == 0 && iy == 0){
        m.progress = Math.min(m.progress, 1);
        return;
    }
    var dir;
    if(ix != 0 && iy != 0){
        m.flip = 1 - m.flip;
        dir = m.flip == 0 ? (ix > 0 ? 0 : 2) : (iy > 0 ? 1 : 3);
    }else if(ix != 0){
        dir = ix > 0 ? 0 : 2;
    }else{
        dir = iy > 0 ? 1 : 3;
    }
    m.progress += 8 * delta / 60;
    if(m.progress < 1) return;
    m.progress = 1;
    var res = F.stepMachine(m, dir);
    if(res == "ok"){
        m.progress = 0;
        keepBody(m);
    }else if(Time.globalTime - S.lastMsg > 120){
        S.lastMsg = Time.globalTime;
        say(res == "constructing" ? "mb.msg.constructing" : "mb.msg.blocked");
    }
}

function checkPossession(){
    if(S.poss == null || Vars.headless) return;
    var m = S.poss.m, p = Vars.player;
    if(S.machines.indexOf(m) < 0 || hullBuild(m) == null || m.body == null || !m.body.isValid()){
        endPossession(true, "machine=" + (S.machines.indexOf(m) >= 0) + " hull=" + (hullBuild(m) != null) + " body=" + (m.body != null && m.body.isValid()));
        say("mb.msg.dead");
        return;
    }
    if(p.unit() != m.body){
        endPossession(true, "player unit changed to " + p.unit());
    }
}
function hoveredBuilding(){
    if(Vars.headless || Core.input == null) return null;
    var t = Vars.world.tileWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY());
    return t == null ? null : t.build;
}

function machineUnderPoint(wx, wy, team){
    var fl = flyingMachines();
    for(var i = 0; i < fl.length; i++){
        var m = fl[i];
        if(team != null && m.team.id != team.id) continue;
        if(partAtWorld(m, wx, wy) != null) return m;
    }
    var t = Vars.world.tileWorld(wx, wy);
    if(t != null){
        var lm = machineAtTile(t);
        if(lm != null && (team == null || lm.team.id == team.id)) return lm;
    }
    return null;
}

function nearestMachine(x, y, team){
    var best = null, bd = 1e12;
    S.machines.forEach(m => {
        if(team != null && m.team.id != team.id) return;
        var pos = machinePos(m);
        var d = Mathf.dst2(pos[0], pos[1], x, y);
        if(d < bd){ bd = d; best = m; }
    });
    return best;
}

function pickMachine(){
    var p = Vars.player;
    if(S.poss != null) return S.poss.m;
    var m = null;
    if(!Vars.headless && Core.input != null) m = machineUnderPoint(Core.input.mouseWorldX(), Core.input.mouseWorldY(), p.team());
    if(m == null) m = nearestMachine(p.x, p.y, p.team());
    return m;
}

function togglePossess(){
    if(Vars.net.client()){
        if(S.poss != null){ Call.unitClear(Vars.player); S.poss = null; say("mb.msg.left"); return; }
        var cm = pickMachine();
        if(cm == null){ say("mb.msg.nomachine"); return; }
        var cb = F.clientBody(cm);
        if(cb == null){ say("mb.msg.nomachine"); return; }
        Call.unitControl(Vars.player, cb);
        return;
    }
    if(S.poss != null){ endPossession(false); return; }
    if(Vars.player == null || Vars.player.team() == null) return;
    var m = pickMachine();
    if(m == null){ say("mb.msg.nomachine"); return; }
    if(startPossession(m)) say("mb.msg.entered");
}

function adoptPlayerUnit(){
    var p = Vars.player;
    if(Vars.headless || p == null) return;
    var u = p.unit();
    if(Vars.net.client()){
        var cur = null;
        if(u != null && u.type == F.driverType){
            for(var ci = 0; ci < S.machines.length; ci++){
                if(S.machines[ci].bodyId === u.id){ cur = S.machines[ci]; break; }
            }
        }
        if(cur != null && (S.poss == null || S.poss.m !== cur)){ S.poss = {m: cur}; say("mb.msg.entered"); }
        else if(cur == null && S.poss != null) S.poss = null;
        return;
    }
    if(S.poss != null || u == null) return;
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.body != null && m.body == u){
            if(m.mode == "land" && m.pad != null) startLift(m);
            S.poss = {m: m};
            say("mb.msg.entered");
            return;
        }
    }
}

F.driverOf = driverOf;
F.driversOfMachine = driversOfMachine;
F.sayToDriver = sayToDriver;
F.retargetDrivers = retargetDrivers;
F.dropDrivers = dropDrivers;
F.allDrivers = allDrivers;
F.isDriven = isDriven;
F.localInput = localInput;
F.readInput = readInput;
F.startPossession = startPossession;
F.endPossession = endPossession;
F.driveLanded = driveLanded;
F.checkPossession = checkPossession;
F.hoveredBuilding = hoveredBuilding;
F.nearestMachine = nearestMachine;
F.pickMachine = pickMachine;
F.togglePossess = togglePossess;
F.adoptPlayerUnit = adoptPlayerUnit;
