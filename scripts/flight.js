'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var TS = F.TS, autoTurn = F.autoTurn;
var logErr = F.logErr, say = F.say, signedDiff = F.signedDiff;
var frontDeg = F.frontDeg;
var bstate = F.bstate, flightSpeed = F.flightSpeed, tickBoosters = F.tickBoosters;
var shipGoal = F.shipGoal, shipTick = F.shipTick, shipWatchCommands = F.shipWatchCommands;
var keepBody = F.keepBody, machineStats = F.machineStats;
var refreshOre = F.refreshOre, setAng = F.setAng, setPartsReal = F.setPartsReal, withPocket = F.withPocket;
var shipPadCheck = F.shipPadCheck;
var fireControl = F.fireControl, flyReconcile = F.flyReconcile, reapDead = F.reapDead,
    stepFires = F.stepFires;
var commandAI = F.commandAI, commandGoal = F.commandGoal;

var TURN_MASS_REF = 60;
var TURN_MIN = 6;
function turnRate(speed, m){
    var base = Mathf.clamp(40 + speed * 45, 40, 270);
    if(m == null) return base;
    return Math.max(TURN_MIN, base / (1 + F.machineMass(m) / TURN_MASS_REF));
}

function thrustToward(m, ux, uy, power, tiles, spd, delta, noTurn){
    m.thrusting = true;
    if(autoTurn() && noTurn !== true){
        var want = Math.atan2(uy, ux) * 180 / Math.PI;
        var diff = signedDiff(want, frontDeg(m) + m.ang);
        var maxTurn = turnRate(tiles, m) / 60 * delta;
        var turn = Math.abs(diff) <= maxTurn ? diff : (diff > 0 ? maxTurn : -maxTurn);
        setAng(m, m.ang + turn);
        var f = Math.max(0, Math.cos((diff - turn) * Math.PI / 180));
        var hr = (frontDeg(m) + m.ang) * Math.PI / 180;
        return [Math.cos(hr) * spd * f * power, Math.sin(hr) * spd * f * power];
    }
    return [ux * spd * power, uy * spd * power];
}

var ARRIVE_DIST = 2;
var LEAVE_DIST = 7;
var ARRIVE_DIST_ENEMY = 6;
var LEAVE_DIST_ENEMY = 24;
var APPROACH_GAIN = 0.025;
var HEADING_FREEZE = 12;

function flyToGoal(m, goal, tiles, spd, delta){
    var gx = goal.x - m.x, gy = goal.y - m.y;
    var dist = Math.sqrt(gx * gx + gy * gy);
    var left = dist - goal.stop;
    var enemy = goal.target != null;
    var arriveD = enemy ? ARRIVE_DIST_ENEMY : ARRIVE_DIST;
    var leaveD = enemy ? LEAVE_DIST_ENEMY : LEAVE_DIST;
    if(m.arrived === true){
        if(left > leaveD) m.arrived = false;
    }else if(left <= arriveD){
        m.arrived = true;
    }
    if(m.arrived === true){
        m.headFrozen = false;
        if(enemy){
            if(autoTurn() && dist > 4){
                var wantA = Math.atan2(gy, gx) * 180 / Math.PI;
                var dA = signedDiff(wantA, frontDeg(m) + m.ang);
                var mt = turnRate(tiles, m) / 60 * delta;
                setAng(m, m.ang + (Math.abs(dA) <= mt ? dA : (dA > 0 ? mt : -mt)));
            }
        }else{
            m.vx = 0; m.vy = 0;
        }
        return [0, 0];
    }
    var freezeD = HEADING_FREEZE + (goal.lever || 0) * 1.5;
    if(m.headFrozen === true){
        if(left > freezeD * 1.6) m.headFrozen = false;
    }else if(left < freezeD){
        m.headFrozen = true;
    }
    var power = Math.min(1, left * APPROACH_GAIN / spd);
    if(power <= 0.001) return [0, 0];
    return thrustToward(m, gx / dist, gy / dist, power, tiles, spd, delta, m.headFrozen === true || goal.noTurn === true);
}

function launchStep(m, l, delta){
    m.thrusting = true;
    m.arrived = false;
    m.headFrozen = false;
    var step = Math.min(l.left, l.v * delta);
    m.vx = l.dx * l.v;
    m.vy = l.dy * l.v;
    m.x += l.dx * step;
    m.y += l.dy * step;
    l.left -= step;
    var maxX = (Vars.world.width() - 1) * TS, maxY = (Vars.world.height() - 1) * TS, edge = false;
    if(m.x < 0){ m.x = 0; edge = true; }
    if(m.y < 0){ m.y = 0; edge = true; }
    if(m.x > maxX){ m.x = maxX; edge = true; }
    if(m.y > maxY){ m.y = maxY; edge = true; }
    if(l.left <= 0.001 || edge){
        m.launch = null;
        if(l.hold != null && l.hold !== undefined) m.craftHold = l.hold;
    }
}

function craftHoldGoal(m){
    var h = m.craftHold;
    if(h == null) return null;
    if(m.ctrlOff === true) return null;
    if(m.bonds != null && m.bonds.length > 0){ m.craftHold = null; return null; }
    return {x: h.x, y: h.y, stop: 0, target: null, lever: 0, ang: h.ang, holdJoin: true};
}

function turnToAngle(m, ang, tiles, delta){
    var diff = signedDiff(ang, m.ang);
    if(Math.abs(diff) < 0.05) return;
    var maxTurn = turnRate(Math.max(tiles, 1), m) / 60 * delta;
    setAng(m, m.ang + (Math.abs(diff) <= maxTurn ? diff : (diff > 0 ? maxTurn : -maxTurn)));
}

function wantsToMove(m){
    var drv = F.driverOf(m);
    if(drv != null){
        var di = drv.input();
        if(di.ix != 0 || di.iy != 0) return true;
        return di.cam != null && Mathf.dst(m.x, m.y, di.cam.x, di.cam.y) > 24;
    }
    var goal = null;
    try{
        var ai = commandAI(m);
        if(ai != null) goal = commandGoal(m, ai);
        if(goal == null) goal = craftHoldGoal(m);
        if(goal == null) goal = shipGoal(m);
    }catch(e){
        logErr("wantsToMove", e);
        goal = null;
    }
    if(goal == null) return false;
    var left = Mathf.dst(m.x, m.y, goal.x, goal.y) - (goal.stop || 0);
    return left > (goal.target != null ? ARRIVE_DIST_ENEMY : ARRIVE_DIST);
}

// Picks the goal (player, order, autopilot), applies thrust and magnet pull, moves the machine.
function moveFlying(m, delta){
    m.autoFlying = false;
    if(m.air != null){
        if(m.air.kind == "pull") m.air.want = wantsToMove(m);
        F.airStep(m, delta);
        return;
    }
    var st = m.stats || machineStats(m);
    var drv = F.driverOf(m);
    var possessed = drv != null;
    var orderAI = possessed ? null : commandAI(m);
    var orderGoal = orderAI == null ? null : commandGoal(m, orderAI);
    if(orderGoal != null) m.launch = null;
    if(orderGoal != null || possessed) m.craftHold = null;
    var pulledNow = (m.magVx || 0) != 0 || (m.magVy || 0) != 0;
    shipWatchCommands(m, possessed, orderGoal != null);
    shipTick(m, delta);
    var tiles = flightSpeed(m);
    var spd = tiles * TS / 60;
    var tvx = 0, tvy = 0;
    m.thrusting = false;
    if(possessed) m.launch = null;
    var leg = m.launch;
    if(leg != null && leg.fixed === true){
        launchStep(m, leg, delta);
        return;
    }
    if(possessed){
        var di = drv.input();
        var cam = di.cam;
        if(cam == null){
            m.arrived = false;
            m.headFrozen = false;
        }
        if(di.spin != 0) setAng(m, m.ang + di.spin * turnRate(tiles, m) / 60 * delta);
        var ix = di.ix, iy = di.iy;
        if(ix != 0 || iy != 0){
            m.arrived = false;
            m.headFrozen = false;
            if(st.boosters == 0){
                if(Time.globalTime - S.lastMsg > 120){ S.lastMsg = Time.globalTime; say("mb.msg.nowheels"); }
            }else{
                if(tiles <= 0.001 && Time.globalTime - S.lastMsg > 120){ S.lastMsg = Time.globalTime; say("mb.msg.nothrust"); }
                var len = Math.sqrt(ix * ix + iy * iy);
                var tv = thrustToward(m, ix / len, iy / len, 1, tiles, spd, delta);
                tvx = tv[0]; tvy = tv[1];
            }
        }else if(cam != null){
            var far = Mathf.dst(m.x, m.y, cam.x, cam.y) > 24;
            if(st.boosters == 0){
                if(far && Time.globalTime - S.lastMsg > 120){ S.lastMsg = Time.globalTime; say("mb.msg.nowheels"); }
            }else{
                if(far && tiles <= 0.001 && Time.globalTime - S.lastMsg > 120){ S.lastMsg = Time.globalTime; say("mb.msg.nothrust"); }
                if(tiles > 0.001){
                    var tv3 = flyToGoal(m, cam, tiles, spd, delta);
                    tvx = tv3[0]; tvy = tv3[1];
                }
            }
        }
    }else if(st.boosters > 0 && tiles > 0.001){
        var goal = orderGoal;
        if(goal == null) goal = craftHoldGoal(m);
        if(goal == null){ goal = shipGoal(m); m.autoFlying = goal != null; }
        if(goal != null && goal.holdJoin === true && pulledNow){
            goal = null;
            m.arrived = false;
            m.headFrozen = false;
        }
        if(goal != null){
            var tv2 = flyToGoal(m, goal, tiles, spd, delta);
            tvx = tv2[0]; tvy = tv2[1];
            if(goal.ang !== undefined && m.arrived === true) turnToAngle(m, goal.ang, tiles, delta);
        }else{
            m.arrived = false;
            m.headFrozen = false;
        }
    }else{
        m.arrived = false;
        m.headFrozen = false;
    }
    var pulled = (m.magVx || 0) != 0 || (m.magVy || 0) != 0;
    tvx += m.magVx || 0;
    tvy += m.magVy || 0;
    var k = 1 - Math.exp(-delta * 0.12);
    if(!pulled && !F.engineWorking(m)) k = 0;
    m.vx += (tvx - m.vx) * k;
    m.vy += (tvy - m.vy) * k;
    m.x += m.vx * delta;
    m.y += m.vy * delta;
    var maxX = (Vars.world.width() - 1) * TS, maxY = (Vars.world.height() - 1) * TS;
    if(m.x < 0){ m.x = 0; m.vx = 0; }
    if(m.y < 0){ m.y = 0; m.vy = 0; }
    if(m.x > maxX){ m.x = maxX; m.vx = 0; }
    if(m.y > maxY){ m.y = maxY; m.vy = 0; }
}

// Movement and checks of one flying machine for this tick.
function flyStep(m, delta){
    if(m.mode != "fly") return;
    if(m.parts.length == 0 || (m.fallOnly !== true && (m.hull == null || m.hull.dead))){
        flyReconcile(m);
        return;
    }
    if(m.fallOnly === true){
        if(m.air == null){
            F.fallAgain(m);
            if(S.machines.indexOf(m) < 0) return;
        }
    }else{
        if(!(m.launch != null && m.launch.fixed === true)){
            try{ F.engineCheck(m, delta); }catch(e){ logErr("engineCheck", e); }
        }
    }
    if(m.pivotDirty === true && m.air == null){
        m.pivotDirty = false;
        try{ F.applyPivot(m); }catch(e){ logErr("pivot", e); }
    }
    moveFlying(m, delta);
    try{ shipPadCheck(m); }catch(e){ logErr("pad landing", e); }
}

// Runs the vanilla update() of every block in the pocket once the final position is known.
function flyLogic(m, delta){
    if(m.mode != "fly") return;
    m.oreTimer -= delta;
    if(m.oreTimer <= 0){
        m.oreTimer = 20;
        var moved = Math.abs(m.x - m.lastOre[0]) + Math.abs(m.y - m.lastOre[1]) + Math.abs(signedDiff(m.ang, m.lastOre[2]));
        if(moved > 1.5) refreshOre(m);
        else F.refreshAttributes(m);
    }
    setPartsReal(m);
    var list = m.updList, isProj = m.updProj, isPay = m.updPay, isReal = m.updReal || [];
    var released = [];
    var level = F.engineLevel(m);
    for(var bi = 0; bi < m.boosters.length; bi++){
        if(m.boosters[bi].dead) continue;
        var bs0 = bstate(m.boosters[bi]);
        bs0.thrusting = m.thrusting;
        bs0.level = level;
    }
    withPocket(m, () => {
        try{ fireControl(m); }catch(e){ logErr("fireControl", e); }
        for(var j = 0; j < list.length; j++){
            var p = list[j];
            if(p.dead || isReal[j]) continue;
            var proj = isProj[j] ? F.projBefore(m, p) : null;
            if(isPay[j]){
                try{
                    var rel = F.payloadCheck(m, p, delta);
                    if(rel != null) released.push(rel);
                }catch(e){ logErr("payload check " + p.block.name, e); }
            }
            try{ p.update(); }catch(e){ logErr("update " + p.block.name, e); }
            if(proj != null){
                try{ F.projAfter(m, p, proj, delta); }catch(e){ logErr("projector " + p.block.name, e); }
            }
        }
    }, false);
    for(var wi = 0; wi < list.length; wi++){
        if(!isReal[wi] || list[wi].dead) continue;
        try{ list[wi].update(); }catch(e){ logErr("update " + list[wi].block.name, e); }
    }
    try{ F.relocatePuddles(m); }catch(e){ logErr("puddles", e); }
    for(var ri = 0; ri < released.length; ri++){
        try{ F.payloadRelease(m, released[ri]); }catch(e){ logErr("payload release", e); }
    }
    try{ tickBoosters(m, delta); }catch(e){ logErr("tickBoosters", e); }
    try{ reapDead(m); }catch(e){ logErr("reapDead", e); }
    if(S.machines.indexOf(m) < 0 || m.mode != "fly") return;
    try{ stepFires(m, delta); }catch(e){ logErr("stepFires", e); }
    if(S.machines.indexOf(m) < 0 || m.mode != "fly") return;
    keepBody(m);
}

F.turnRate = turnRate;
F.flyStep = flyStep;
F.wantsToMove = wantsToMove;
F.flyLogic = flyLogic;
