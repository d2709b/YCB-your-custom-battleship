'use strict';

var F = require("your-custom-battleship/hub");

var TS = F.TS;
var logErr = F.logErr;
var flyingMachines = F.flyingMachines;

var COLLIDE_RESTITUTION = 0.25;
var IMPACT_FX_SPEED = 0.45;
var impactStamp = {};

function machineMass(m){
    var c = m.stats != null ? m.stats.cells : 0;
    return Math.max(1, c > 0 ? c : m.parts.length);
}

function machineEnergy(m){
    return 0.5 * machineMass(m) * (m.vx * m.vx + m.vy * m.vy);
}

function machineMomentum(m){
    var mass = machineMass(m);
    return [mass * m.vx, mass * m.vy];
}

function worldCircles(m){
    var n = m.parts.length, xs = new Array(n), ys = new Array(n), rs = new Array(n);
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    var rx = m.ref[0] * TS, ry = m.ref[1] * TS;
    for(var i = 0; i < n; i++){
        var p = m.parts[i];
        var lx = p.tile.drawx() - rx, ly = p.tile.drawy() - ry;
        xs[i] = m.x + lx * c - ly * s;
        ys[i] = m.y + lx * s + ly * c;
        rs[i] = p.block.size * TS * 0.5;
    }
    return {xs: xs, ys: ys, rs: rs, n: n};
}

function nearCircles(c, mx, my, mr){
    var out = [];
    for(var i = 0; i < c.n; i++){
        var reach = mr + c.rs[i];
        var dx = c.xs[i] - mx, dy = c.ys[i] - my;
        if(dx * dx + dy * dy <= reach * reach) out.push(i);
    }
    return out;
}

function collidePair(a, b, ca, cb){
    var la = nearCircles(ca, b.x, b.y, b.radius);
    var lb = nearCircles(cb, a.x, a.y, a.radius);
    if(la.length == 0 || lb.length == 0) return false;

    var sumNx = 0, sumNy = 0, sumW = 0, cx = 0, cy = 0;
    var maxPen = 0, bestNx = 1, bestNy = 0;
    for(var ii = 0; ii < la.length; ii++){
        var i = la[ii];
        var ax = ca.xs[i], ay = ca.ys[i], ar = ca.rs[i];
        for(var jj = 0; jj < lb.length; jj++){
            var j = lb[jj];
            var dx = cb.xs[j] - ax, dy = cb.ys[j] - ay;
            var rr = ar + cb.rs[j];
            var d2 = dx * dx + dy * dy;
            if(d2 >= rr * rr) continue;
            var d = Math.sqrt(d2);
            var nx, ny;
            if(d > 0.001){ nx = dx / d; ny = dy / d; }
            else{
                var ex = b.x - a.x, ey = b.y - a.y, el = Math.sqrt(ex * ex + ey * ey);
                if(el > 0.001){ nx = ex / el; ny = ey / el; }else{ nx = 1; ny = 0; }
            }
            var pen = rr - d;
            sumNx += nx * pen; sumNy += ny * pen; sumW += pen;
            cx += (ax + cb.xs[j]) / 2 * pen; cy += (ay + cb.ys[j]) / 2 * pen;
            if(pen > maxPen){ maxPen = pen; bestNx = nx; bestNy = ny; }
        }
    }
    if(maxPen <= 0) return false;
    var nl = Math.sqrt(sumNx * sumNx + sumNy * sumNy);
    var gx = bestNx, gy = bestNy;
    if(nl > 0.25 * sumW){ gx = sumNx / nl; gy = sumNy / nl; }

    var ma = machineMass(a), mb = machineMass(b);
    var ia = 1 / ma, ib = 1 / mb, isum = ia + ib;

    a.x -= gx * maxPen * (ia / isum); a.y -= gy * maxPen * (ia / isum);
    b.x += gx * maxPen * (ib / isum); b.y += gy * maxPen * (ib / isum);

    var rel = (b.vx - a.vx) * gx + (b.vy - a.vy) * gy;
    if(rel < 0){
        var jImp = -(1 + COLLIDE_RESTITUTION) * rel / isum;
        a.vx -= jImp * ia * gx; a.vy -= jImp * ia * gy;
        b.vx += jImp * ib * gx; b.vy += jImp * ib * gy;
        if(-rel > IMPACT_FX_SPEED && !Vars.headless) impactSparks(a, b, cx / sumW, cy / sumW, -rel);
    }
    return true;
}

function impactSparks(a, b, x, y, speed){
    try{
        var key = a.id < b.id ? a.id + ":" + b.id : b.id + ":" + a.id;
        var last = impactStamp[key];
        if(last !== undefined && Time.globalTime >= last && Time.globalTime - last < 20) return;
        impactStamp[key] = Time.globalTime;
        if(F.netFx != null) F.netFx(2, x, y, 0, 0);
        if(!Vars.headless) Fx.hitBulletSmall.at(x, y);
    }catch(e){
        logErr("impactSparks", e);
    }
}

// Sort-and-sweep broad phase, then momentum exchange for overlapping machines.
function collideMachines(){
    var fl = flyingMachines();
    if(fl.length < 2) return;
    var list = [];
    for(var k = 0; k < fl.length; k++){
        var f = fl[k];
        if(f.parts.length == 0 || f.air != null) continue;
        list.push(f);
    }
    var n = list.length;
    if(n < 2) return;
    list.sort((p, q) => (p.x - p.radius) - (q.x - q.radius));
    var circles = {};
    var get = m => {
        var c = circles[m.id];
        if(c === undefined){ c = worldCircles(m); circles[m.id] = c; }
        return c;
    };
    for(var i = 0; i < n; i++){
        var a = list[i];
        for(var j = i + 1; j < n; j++){
            var b = list[j];
            var reach = a.radius + b.radius;
            var dx = b.x - a.x;
            if(b.x - b.radius > a.x + a.radius) break;
            var dy = b.y - a.y;
            if(dx * dx + dy * dy > reach * reach) continue;
            var ax0 = a.x, ay0 = a.y, bx0 = b.x, by0 = b.y;
            if(collidePair(a, b, get(a), get(b))){
                if(a.x != ax0 || a.y != ay0) delete circles[a.id];
                if(b.x != bx0 || b.y != by0) delete circles[b.id];
            }
        }
    }
}

F.machineMass = machineMass;
F.machineEnergy = machineEnergy;
F.machineMomentum = machineMomentum;
F.collideMachines = collideMachines;
