'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var AIR_BASE_TICKS = F.AIR_BASE_TICKS, AIR_CARRY_TICKS = F.AIR_CARRY_TICKS, AIR_LIMIT_TICKS = F.AIR_LIMIT_TICKS,
    AIR_MAX_TICKS = F.AIR_MAX_TICKS, AIR_MIN_SPEED = F.AIR_MIN_SPEED, AIR_MIN_TICKS = F.AIR_MIN_TICKS,
    AIR_MOVE_MUL = F.AIR_MOVE_MUL, AIR_SPEED_MUL_MAX = F.AIR_SPEED_MUL_MAX, AIR_SPEED_MUL_MIN = F.AIR_SPEED_MUL_MIN,
    AIR_SPEED_REF = F.AIR_SPEED_REF, AIR_SQRT_TICKS = F.AIR_SQRT_TICKS, AIR_TURN_MUL = F.AIR_TURN_MUL, DUST_LANDING_TICKS = F.DUST_LANDING_TICKS, DUST_MAX_COUNT = F.DUST_MAX_COUNT,
    DUST_MIN_COUNT = F.DUST_MIN_COUNT, DUST_PER_CELL = F.DUST_PER_CELL, DUST_RANGE = F.DUST_RANGE,
    DUST_RANGE_MAX_MUL = F.DUST_RANGE_MAX_MUL, DUST_RANGE_MIN_MUL = F.DUST_RANGE_MIN_MUL, DUST_REF_CELLS = F.DUST_REF_CELLS,
    DUST_SIZE = F.DUST_SIZE, DUST_SIZE_MAX_MUL = F.DUST_SIZE_MAX_MUL, DUST_SIZE_MIN_MUL = F.DUST_SIZE_MIN_MUL, NO_ENGINE_TICKS = F.NO_ENGINE_TICKS, TS = F.TS,
    MAGNET_PULL_MAX_MUL = F.MAGNET_PULL_MAX_MUL, MAGNET_PULL_MIN_MUL = F.MAGNET_PULL_MIN_MUL, MAGNET_PULL_MSG_TICKS = F.MAGNET_PULL_MSG_TICKS,
    MAGNET_PULL_RELEASE_MUL = F.MAGNET_PULL_RELEASE_MUL;
var logErr = F.logErr, say = F.say, signedDiff = F.signedDiff;
var coverTiles = F.coverTiles;
var setAng = F.setAng, toWorld = F.toWorld;
var findLanding = F.findLanding, fitsOnGrid = F.fitsOnGrid, landMachine = F.landMachine, takeOff = F.takeOff;
var landCell = F.landCell, rotXY = F.rotXY, normAngle = F.normAngle;

function hash01(n){
    var x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

var dustFx = null;
if(!Vars.headless){
    try{
        dustFx = new Packages.mindustry.entities.Effect(100, 300, cons(e => {
            try{
                var range = DUST_RANGE, size = DUST_SIZE, d = e.data;
                if(d != null && d.length !== undefined && d.length >= 2){ range = +d[0]; size = +d[1]; }
                else if(d != null && typeof d.get === "function"){ range = +d.get(0); size = +d.get(1); }
                var r1 = hash01(e.id), r2 = hash01(e.id + 77.7);
                Draw.color(e.color, e.fout(0.1));
                Tmp.v1.trns(e.rotation, e.finpow() * range * (0.2 + 0.8 * r1));
                Fill.circle(e.x + Tmp.v1.x, e.y + Tmp.v1.y, size * (0.6 + 0.4 * r2) * e.fout(0.2));
            }catch(err){
                logErr("dust effect draw", err);
            }
        }));
        dustFx.layer = Layer.blockUnder;
    }catch(e){
        dustFx = null;
        logErr("dust effect", e);
    }
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function footprint(m){
    var out = [];
    for(var i = 0; i < m.parts.length; i++){
        var b = m.parts[i];
        if(b.dead) continue;
        var cov = coverTiles(b);
        for(var j = 0; j < cov.length; j++) out.push([Point2.x(cov[j]), Point2.y(cov[j])]);
    }
    return out;
}

function dustScale(m, cells){
    var w = Math.max(1, cells.length), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(var i = 0; i < cells.length; i++){
        if(cells[i][0] < x0) x0 = cells[i][0];
        if(cells[i][0] > x1) x1 = cells[i][0];
        if(cells[i][1] < y0) y0 = cells[i][1];
        if(cells[i][1] > y1) y1 = cells[i][1];
    }
    var width = cells.length == 0 ? 1 : Math.max(x1 - x0, y1 - y0) + 1;
    return {
        count: clamp(Math.round(w * DUST_PER_CELL), DUST_MIN_COUNT, DUST_MAX_COUNT),
        range: DUST_RANGE * clamp(0.5 + width / 6, DUST_RANGE_MIN_MUL, DUST_RANGE_MAX_MUL),
        size: DUST_SIZE * clamp(0.6 + 0.4 * Math.sqrt(w / DUST_REF_CELLS), DUST_SIZE_MIN_MUL, DUST_SIZE_MAX_MUL),
        weight: w, width: width
    };
}

function spawnDust(wx, wy, cx, cy, sc){
    if(Vars.headless) return;
    var fx = dustFx != null ? dustFx : Fx.coreLandDust;
    var dx = wx - cx, dy = wy - cy;
    var ang = (dx * dx + dy * dy < 1 ? Math.random() * 360 : Math.atan2(dy, dx) * 180 / Math.PI) + (Math.random() * 60 - 30);
    var col = Tmp.c1;
    var t = Vars.world.tileWorld(wx, wy);
    var fl = t == null ? null : t.floor();
    if(fl != null) col.set(fl.mapColor); else col.set(Color.gray);
    col.mul(1.5 + (Math.random() * 0.3 - 0.15));
    fx.at(wx, wy, ang, col, [sc.range, sc.size]);
}

function airDuration(m, dist, turn){
    var w = F.machineMass(m);
    var tiles = F.flightSpeed(m);
    var speedMul = tiles <= 0.001 ? AIR_SPEED_MUL_MAX : clamp(Math.sqrt(AIR_SPEED_REF / tiles), AIR_SPEED_MUL_MIN, AIR_SPEED_MUL_MAX);
    var byWeight = clamp(AIR_BASE_TICKS + AIR_SQRT_TICKS * Math.sqrt(w), AIR_MIN_TICKS, AIR_MAX_TICKS) * speedMul;
    var sp = Math.max(tiles, AIR_MIN_SPEED);
    var vmax = sp * TS / 60;
    var byMove = dist > 0 ? AIR_MOVE_MUL * dist / vmax : 0;
    var rate = F.turnRate(sp, m) / 60;
    var byTurn = turn > 0 ? AIR_TURN_MUL * turn / rate : 0;
    return clamp(Math.max(byWeight, byMove, byTurn), AIR_MIN_TICKS, AIR_LIMIT_TICKS);
}

function ease(p){ return p * p * (3 - 2 * p); }

function inAir(m){ return m != null && m.air != null; }

// Starts the slow landing animation toward a free spot; touchDown finishes it.
function startLanding(m, at, msg, side){
    if(m == null || m.mode != "fly" || m.air != null) return false;
    if(at == null) at = F.findPadLanding(m, side);
    if(at == null) at = F.findLandingSide(m, side);
    if(at == null){ say("mb.msg.noroom"); return false; }
    var off = at.off, q = at.q & 3;
    var cells = footprint(m);
    m.launch = null;
    var rc = landCell(q, off, m.ref[0], m.ref[1]);
    var tx = rc[0] * TS, ty = rc[1] * TS;
    var dist = Math.sqrt((tx - m.x) * (tx - m.x) + (ty - m.y) * (ty - m.y));
    var turn = Math.abs(signedDiff(q * 90, m.ang));
    m.air = {
        kind: "land", t: 0, dur: airDuration(m, dist, turn), from: 1, to: 0, alt: 1,
        off: off, q: q, pad: at.pad != null ? at.pad : null, msg: msg || null,
        sx: m.x, sy: m.y, sa: m.ang, vx0: m.vx, vy0: m.vy,
        tx: tx, ty: ty,
        cells: cells, sc: dustScale(m, cells)
    };
    return true;
}

function insideMap(m, off, q){
    for(var i = 0; i < m.parts.length; i++){
        var cov = coverTiles(m.parts[i]);
        for(var j = 0; j < cov.length; j++){
            var c = landCell(q | 0, off, Point2.x(cov[j]), Point2.y(cov[j]));
            if(Vars.world.tile(c[0], c[1]) == null) return false;
        }
    }
    return true;
}

// Emergency descent that keeps the current velocity; crashes onto the ground if no engine works.
function startFall(m, dropAfter){
    if(m == null || m.mode != "fly" || m.air != null) return false;
    var turn = Math.abs(signedDiff(0, m.ang));
    var dur = airDuration(m, 0, turn);
    var sx = m.x, sy = m.y, off = null;
    var q = F.nearestTurn(m);
    var crash = !F.engineWorking(m);
    var tries = [1, 0.5, 0.2, 0];
    for(var i = 0; i < tries.length && off == null; i++){
        m.x = sx + m.vx * dur * tries[i];
        m.y = sy + m.vy * dur * tries[i];
        if(crash){
            var rr = rotXY(q, m.ref[0], m.ref[1]);
            var o = [Math.round(m.x / TS - rr[0]), Math.round(m.y / TS - rr[1])];
            if(insideMap(m, o, q)) off = o;
        }else{
            var pick = F.findLandingSide(m, "auto");
            if(pick != null){ off = pick.off; q = pick.q; }
        }
    }
    m.x = sx; m.y = sy;
    if(off == null) return false;
    var cells = footprint(m);
    m.launch = null;
    var rc = landCell(q, off, m.ref[0], m.ref[1]);
    var tx = rc[0] * TS, ty = rc[1] * TS;
    m.air = {
        kind: "land", keep: true, crash: crash, dropAfter: dropAfter === true, t: 0, dur: dur, from: 1, to: 0, alt: 1,
        off: off, q: q, pad: null, msg: null,
        sx: m.x, sy: m.y, sa: m.ang, vx0: m.vx, vy0: m.vy, tx: tx, ty: ty,
        cells: cells, sc: dustScale(m, cells)
    };
    return true;
}

function engineCheck(m, delta){
    if(m.air != null || m.fallOnly === true) return;
    if(F.engineWorking(m)){ m.noEngine = 0; return; }
    m.noEngine = (m.noEngine || 0) + delta;
    if(m.noEngine < NO_ENGINE_TICKS) return;
    if(startFall(m, false)){
        m.noEngine = 0;
        if(Time.globalTime - S.lastMsg > 120){ S.lastMsg = Time.globalTime; say("mb.msg.noengine"); }
    }else{
        m.noEngine = -120;
    }
}

function fallAgain(m){
    if(m.air != null) return;
    if(startFall(m, true)) return;
    F.destroyMachine(m, true);
}

function abortLanding(m, a){
    m.air = {kind: "up", t: 0, dur: Math.max(24, a.dur * 0.5), from: a.alt, to: 1, alt: a.alt};
}

function touchDown(m, a){
    var off = a.off, q = (a.q | 0) & 3;
    if(a.crash !== true && !fitsOnGrid(m, off, a.pad, q)){
        off = a.pad == null ? findLanding(m, q) : null;
        if(off == null){
            say(a.pad == null ? "mb.msg.noroom" : "mb.msg.padnofit");
            abortLanding(m, a);
            return;
        }
    }
    if(!landMachine(m, true, {off: off, q: q, pad: a.pad, crash: a.crash === true})){
        abortLanding(m, a);
        return;
    }
    m.savedAng = normAngle(a.sa - q * 90);
    m.air = null;
    if(a.dropAfter === true){
        F.dropMachine(m);
        S.dirty = true;
        return;
    }
    var cx = 0, cy = 0;
    for(var i = 0; i < a.cells.length; i++){
        var gc = landCell(q, off, a.cells[i][0], a.cells[i][1]);
        cx += gc[0] * TS;
        cy += gc[1] * TS;
    }
    var n = Math.max(1, a.cells.length);
    m.dust = {cells: a.cells, ox: off[0], oy: off[1], q: q, cx: cx / n, cy: cy / n, sc: a.sc, left: a.sc.count, acc: 0,
              perTick: a.sc.count / DUST_LANDING_TICKS};
    if(a.msg) say(a.msg);
}

// Takes off at once, then rises with a slow animation.
function startLift(m, auto){
    if(m == null) return false;
    if(m.mode == "fly") return m.air == null || m.air.kind != "land";
    if(F.isEdited(m)) return false;
    if(heldByMagnets(m)){
        magnetHeldMsg();
        return false;
    }
    if(!takeOff(m, auto)) return false;
    m.pullPairs = null;
    m.dust = null;
    var cells = footprint(m);
    var endAng = m.ang;
    setAng(m, 0);
    m.air = {
        kind: "lift", t: 0, dur: airDuration(m, 0, Math.abs(signedDiff(endAng, 0))), from: 0, to: 1, alt: 0,
        sa: 0, ea: endAng, cells: cells, sc: dustScale(m, cells), left: 0, acc: 0
    };
    m.air.left = m.air.sc.count;
    return true;
}

// Advances landing, lift and magnet-pull animations; nobody steers the machine meanwhile.
function airStep(m, delta){
    var a = m.air;
    if(a.kind == "pull"){ pullStep(m, a, delta); return; }
    a.t += delta;
    var p = Math.min(1, a.t / a.dur), e = ease(p);
    var ox = m.x, oy = m.y;
    a.alt = a.from + (a.to - a.from) * e;
    m.thrusting = false;
    m.autoFlying = false;
    if(a.kind == "land"){
        if(a.keep === true){
            var tt = Math.min(a.t, a.dur);
            m.x = a.sx + a.vx0 * tt + (a.tx - a.sx - a.vx0 * a.dur) * e;
            m.y = a.sy + a.vy0 * tt + (a.ty - a.sy - a.vy0 * a.dur) * e;
        }else{
            var tau = Math.min(a.dur * 0.25, AIR_CARRY_TICKS);
            var k = tau * (1 - Math.exp(-a.t / tau)) * (1 - e);
            m.x = a.sx + (a.tx - a.sx) * e + a.vx0 * k;
            m.y = a.sy + (a.ty - a.sy) * e + a.vy0 * k;
        }
        setAng(m, a.sa + signedDiff((a.q | 0) * 90, a.sa) * e);
    }else if(a.kind == "lift"){
        if(a.ea !== undefined) setAng(m, a.sa + signedDiff(a.ea, a.sa) * e);
        liftDust(m, a, p, delta);
    }
    m.mvx = delta > 0 ? (m.x - ox) / delta : 0;
    m.mvy = delta > 0 ? (m.y - oy) / delta : 0;
    m.vx = 0;
    m.vy = 0;
    if(p >= 1){
        if(Vars.net.client()){ a.t = a.dur; return; }
        if(a.kind == "land") touchDown(m, a);
        else m.air = null;
    }
}

function pullOf(m){ return m.pullF || 0; }

function heldByMagnets(m){
    var f = pullOf(m);
    return f > 0.0001 && !(F.shipThrust(m) > f);
}

function magnetHeldMsg(){
    if(Vars.headless) return;
    if(Time.globalTime - S.lastMsg > MAGNET_PULL_MSG_TICKS){
        S.lastMsg = Time.globalTime;
        say("mb.msg.magnetheld");
    }
}

function startMagnetPull(m, pairs, f0){
    if(m == null || m.mode != "fly" || m.air != null || F.isEdited(m)) return false;
    if(m.pullRetry !== undefined && m.pullRetry > Time.globalTime) return false;
    var list = pairs.slice().sort((x, y) => y.T - x.T);
    var at = null, pr = null;
    for(var i = 0; i < list.length && at == null; i++){
        at = F.dockPose(m, list[i].a, list[i].g);
        if(at != null) pr = list[i];
    }
    if(at == null){
        m.pullRetry = Time.globalTime + 60;
        if((m.pullMsgAt === undefined || Time.globalTime - m.pullMsgAt > 900) && Time.globalTime - S.lastMsg > 120){
            m.pullMsgAt = Time.globalTime;
            S.lastMsg = Time.globalTime;
            say("mb.msg.noroom");
        }
        return false;
    }
    var off = at.off, q = at.q & 3;
    var cells = footprint(m);
    m.launch = null;
    var rc = landCell(q, off, m.ref[0], m.ref[1]);
    var tx = rc[0] * TS, ty = rc[1] * TS;
    var dist = Math.sqrt((tx - m.x) * (tx - m.x) + (ty - m.y) * (ty - m.y));
    var turn = Math.abs(signedDiff(q * 90, m.ang));
    var vt = Math.min(pr.cap, f0 * F.boosterPower() / Math.max(1, F.machineMass(m)));
    var byMove = vt > 0.01 ? AIR_MOVE_MUL * dist / (vt * TS / 60) : AIR_LIMIT_TICKS;
    var dur = clamp(Math.max(airDuration(m, 0, turn), byMove), AIR_MIN_TICKS, AIR_LIMIT_TICKS);
    m.vx = 0; m.vy = 0;
    m.air = {
        kind: "pull", p: 0, t: 0, rate: 0, dur: dur, from: 1, to: 0, alt: 1, f0: Math.max(0.0001, f0),
        off: off, q: q, pad: null, msg: null, want: false,
        sx: m.x, sy: m.y, sa: m.ang, vx0: 0, vy0: 0, tx: tx, ty: ty,
        cells: cells, sc: dustScale(m, cells)
    };
    return true;
}

function pullPose(m, a){
    var p = clamp(a.p, 0, 1), e = ease(p);
    a.alt = a.from + (a.to - a.from) * e;
    m.x = a.sx + (a.tx - a.sx) * e;
    m.y = a.sy + (a.ty - a.sy) * e;
    setAng(m, a.sa + signedDiff((a.q | 0) * 90, a.sa) * e);
    a.t = p * a.dur;
}

function pullStep(m, a, delta){
    m.thrusting = false;
    m.autoFlying = false;
    m.vx = 0;
    m.vy = 0;
    if(Vars.net.client()){
        a.p = clamp(a.p + (a.rate || 0) * delta, 0, 1);
        pullPose(m, a);
        return;
    }
    var ox = m.x, oy = m.y;
    var f = pullOf(m), leave = f <= 0.0001;
    if(!leave && a.want === true){
        if(F.shipThrust(m) > f) leave = true;
        else if(F.driverOf(m) != null) magnetHeldMsg();
    }
    var rate;
    if(leave) rate = -MAGNET_PULL_RELEASE_MUL / a.dur;
    else rate = clamp(f / (a.f0 > 0 ? a.f0 : f), MAGNET_PULL_MIN_MUL, MAGNET_PULL_MAX_MUL) / a.dur;
    a.rate = rate;
    a.p += rate * delta;
    if(a.p <= 0){
        a.p = 0;
        pullPose(m, a);
        m.mvx = 0; m.mvy = 0;
        m.air = null;
        m.pullPairs = null;
        return;
    }
    pullPose(m, a);
    m.mvx = delta > 0 ? (m.x - ox) / delta : 0;
    m.mvy = delta > 0 ? (m.y - oy) / delta : 0;
    if(a.p >= 1){
        a.p = 1;
        a.rate = 0;
        touchDown(m, a);
    }
}

function liftDust(m, a, p, delta){
    if(a.left <= 0 || Vars.headless) return;
    a.acc += a.sc.count * (Math.PI / 2) * Math.sin(Math.PI * p) / a.dur * delta;
    var n = Math.min(Math.floor(a.acc), a.left);
    if(p >= 1) n = a.left;
    if(n <= 0) return;
    a.acc -= n;
    a.left -= n;
    for(var i = 0; i < n; i++){
        var c = a.cells[Math.floor(Math.random() * a.cells.length)];
        if(c === undefined) break;
        var w = toWorld(m, c[0] * TS, c[1] * TS);
        spawnDust(w[0], w[1], m.x, m.y, a.sc);
    }
}

function dustStep(m, delta){
    var d = m.dust;
    if(d == null) return;
    if(Vars.headless){ m.dust = null; return; }
    d.acc += d.perTick * delta;
    var n = Math.min(Math.floor(d.acc), d.left);
    d.acc -= n;
    for(var i = 0; i < n; i++){
        var c = d.cells[Math.floor(Math.random() * d.cells.length)];
        if(c === undefined) break;
        var gc = landCell(d.q | 0, [d.ox, d.oy], c[0], c[1]);
        spawnDust(gc[0] * TS, gc[1] * TS, d.cx, d.cy, d.sc);
    }
    d.left -= n;
    if(d.left <= 0) m.dust = null;
}

function airTick(delta){
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.air != null && m.mode != "fly") m.air = null;
        if(m.dust != null) dustStep(m, delta);
    }
}

F.startLanding = startLanding;
F.startFall = startFall;
F.engineCheck = engineCheck;
F.fallAgain = fallAgain;
F.startLift = startLift;
F.startMagnetPull = startMagnetPull;
F.heldByMagnets = heldByMagnets;
F.pullOf = pullOf;
F.airStep = airStep;
F.airTick = airTick;
F.dustScale = dustScale;
F.inAir = inAir;
F.airDuration = airDuration;
