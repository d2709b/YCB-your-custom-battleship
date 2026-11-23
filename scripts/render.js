'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var MOD = F.MOD, TS = F.TS;
var logErr = F.logErr, onEvent = F.onEvent, runEvent = F.runEvent;
var frontDeg = F.frontDeg, isConstructing = F.isConstructing, isHull = F.isHull, isTurret = F.isTurret;
var flyingMachines = F.flyingMachines, landedMachines = F.landedMachines, machineOfBuild = F.machineOfBuild,
    membersOf = F.membersOf, restoreBodies = F.restoreBodies, shrinkBodies = F.shrinkBodies;
var isShieldPart = F.isShieldPart, setPartsPocket = F.setPartsPocket, setPartsReal = F.setPartsReal, toWorld = F.toWorld,
    withPocket = F.withPocket;
var buildingsInRect = F.buildingsInRect, layerDirection = F.layerDirection;
var freePlaceOk = F.freePlaceOk, isTerrainBlock = F.isTerrainBlock, placeOrigin = F.placeOrigin;

var GRID = Color.valueOf("7fd0ff");
var BLUE = Color.valueOf("2a5bff");
var PURPLE = Color.valueOf("a64dff");

function layerOr(name, fallback){
    var v = Layer[name];
    return v === undefined || v === null || isNaN(+v) ? fallback : +v;
}
var DARK_Z = layerOr("darkness", -1);
var BODY_Z = DARK_Z >= 0 ? Math.max(Layer.groundUnit + 1, DARK_Z + 1) : Layer.groundUnit + 1;
var SEL_Z = DARK_Z >= 0 ? BODY_Z + 0.4 : Layer.blockOver + 3;

var darkCache = {};
var darkEpoch = 0;
var darkSig = "", darkSigStamp = -1000;

function refreshDarkness(){
    var now = Time.globalTime;
    if(now >= darkSigStamp && now - darkSigStamp < 30) return;
    darkSigStamp = now;
    var r = Vars.state.rules;
    var sig = Vars.world.width() + "x" + Vars.world.height() + ":" + r.borderDarkness + ":" + r.limitMapArea + ":"
        + r.limitX + "," + r.limitY + "," + r.limitWidth + "," + r.limitHeight;
    if(sig !== darkSig){
        darkSig = sig;
        darkCache = {};
        darkEpoch++;
    }
}

function darkAt(x, y){
    var key = (x + 8) * 16384 + (y + 8);
    var v = darkCache[key];
    if(v !== undefined) return v;
    v = false;
    for(var dx = -1; dx <= 1 && !v; dx++){
        for(var dy = -1; dy <= 1; dy++){
            if(Vars.world.getDarkness(x + dx, y + dy) > 0){ v = true; break; }
        }
    }
    darkCache[key] = v;
    return v;
}

function landedLift(m){
    if(DARK_Z < 0) return false;
    if(m.liftVer === S.layoutVersion && m.liftEpoch === darkEpoch) return m.lift === true;
    m.liftVer = S.layoutVersion;
    m.liftEpoch = darkEpoch;
    var lift = false, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for(var k in m.cells){
        var x = Point2.x(+k), y = Point2.y(+k);
        if(x < x0) x0 = x;
        if(x > x1) x1 = x;
        if(y < y0) y0 = y;
        if(y > y1) y1 = y;
        if(!lift && darkAt(x, y)) lift = true;
    }
    m.lift = lift;
    m.bbox = [x0, y0, x1, y1];
    return lift;
}

function landedMembers(m){
    var now = Time.globalTime;
    if(m.memList === undefined || m.memVer !== S.layoutVersion || now < m.memStamp || now - m.memStamp > 20){
        m.memStamp = now;
        m.memVer = S.layoutVersion;
        m.memList = membersOf(m.cells, m.team);
    }
    return m.memList;
}

function drawLanded(m){
    var list = landedMembers(m);
    var cam = Core.camera;
    Draw.draw(BODY_Z, () => {
        try{
            var heads = [];
            for(var i = 0; i < list.length; i++){
                var b = list[i];
                if(b.tile == null || b.tile.build !== b || isConstructing(b)) continue;
                var reach = b.block.size * TS + 16;
                if(Math.abs(b.x - cam.position.x) > cam.width / 2 + reach || Math.abs(b.y - cam.position.y) > cam.height / 2 + reach) continue;
                if(isTurret(b)) heads.push(b); else drawPartSafe(b);
            }
            heads.forEach(t => drawPartSafe(t));
        }catch(e){
            logErr("drawLanded", e);
        }finally{
            Draw.reset();
        }
    });
}

function drawMachineMask(m){
    var edited = F.isEdited(m);
    if(!edited && m.marks == null) return;
    var key = S.layoutVersion + ":" + (m.markRev | 0) + ":" + (edited ? 1 : 0);
    if(m.maskKey !== key || m.maskList === undefined){
        m.maskKey = key;
        m.maskList = [];
        for(var k in (edited ? m.cells : m.marks)) m.maskList.push(+k);
    }
    var cam = Core.camera;
    var hw = cam.width / 2 + TS, hh = cam.height / 2 + TS;
    var a = edited ? 0.34 + Mathf.absin(Time.time, 40, 0.1) : 0.3;
    Draw.z(landedLift(m) ? BODY_Z + 0.1 : Layer.blockOver + 1);
    Draw.color(PURPLE, a);
    var list = m.maskList;
    for(var i = 0; i < list.length; i++){
        var x = Point2.x(list[i]) * TS, y = Point2.y(list[i]) * TS;
        if(Math.abs(x - cam.position.x) > hw || Math.abs(y - cam.position.y) > hh) continue;
        Fill.rect(x, y, TS, TS);
    }
    Draw.reset();
}

function drawLiftedGrid(m, x0, y0, x1, y1){
    var bb = m.bbox;
    if(bb == null) return;
    var ax0 = Math.max(bb[0], x0), ay0 = Math.max(bb[1], y0), ax1 = Math.min(bb[2], x1), ay1 = Math.min(bb[3], y1);
    if(ax0 > ax1 || ay0 > ay1) return;
    Draw.z(BODY_Z + 0.2);
    Lines.stroke(1);
    Draw.color(GRID, 0.28);
    for(var gx = ax0; gx <= ax1 + 1; gx++){
        Lines.line(gx * TS - TS / 2, ay0 * TS - TS / 2, gx * TS - TS / 2, (ay1 + 1) * TS - TS / 2);
    }
    for(var gy = ay0; gy <= ay1 + 1; gy++){
        Lines.line(ax0 * TS - TS / 2, gy * TS - TS / 2, (ax1 + 1) * TS - TS / 2, gy * TS - TS / 2);
    }
}

onEvent(WorldLoadEvent, () => { darkCache = {}; darkSig = ""; darkEpoch++; });
onEvent(ResetEvent, () => { darkCache = {}; darkSig = ""; darkEpoch++; });

var SHADOW_X = -12, SHADOW_Y = -13;

function liveMachine(m){
    return m.debris === true ? S.debris.indexOf(m) >= 0 : S.machines.indexOf(m) >= 0;
}

function drawShadows(m){
    if(m.mode != "fly" || !liveMachine(m)) return;
    var alt = m.air != null && m.air.alt !== undefined ? m.air.alt : 1;
    var sx = SHADOW_X * alt, sy = SHADOW_Y * alt;
    var c = Mathf.cosDeg(m.ang), s = Mathf.sinDeg(m.ang);
    var rx = m.ref[0] * TS, ry = m.ref[1] * TS;
    var white = Core.atlas.white();
    Draw.color(Pal.shadow);
    var parts = m.parts;
    for(var i = 0; i < parts.length; i++){
        var b = parts[i];
        if(b.dead) continue;
        var lx = b.tile.drawx() - rx, ly = b.tile.drawy() - ry;
        var size = b.block.size * TS;
        Draw.rect(white, m.x + lx * c - ly * s + sx, m.y + lx * s + ly * c + sy, size, size, m.ang);
    }
    Draw.color();
}

function drawBlock(b, noShield){
    if(!noShield){
        b.draw();
        return;
    }
    var was = b.broken;
    b.broken = true;
    try{
        b.draw();
    }finally{
        b.broken = was;
    }
}

function drawPart(b){
    var blk = b.block;
    var z = Draw.z();
    if(blk.drawCached === true){
        Draw.z(blk.buildingCacheLayer.layer);
        b.drawCached();
    }
    if(blk.drawDynamic !== false){
        Draw.z(z);
        drawBlock(b, isShieldPart(b));
    }
    if(b.damaged()){
        Draw.z(Layer.blockCracks);
        b.drawCracks();
    }
    Draw.z(z);
}

function drawPartSafe(b){
    try{
        drawPart(b);
    }catch(e){
        logErr("drawPart " + b.block.name, e);
        Draw.color();
    }
}

function drawShields(m){
    var list = m.shields;
    if(list === undefined || list.length == 0) return;
    if(m.mode != "fly" || !liveMachine(m)) return;
    var cam = Core.camera;
    var animated = Vars.renderer.animateShields;
    try{
        for(var i = 0; i < list.length; i++){
            var b = list[i];
            if(b.dead || b.broken || b.tile == null || b.tile.build !== b) continue;
            var r = b.realRadius();
            if(!(r > 1)) continue;
            if(Math.abs(b.x - cam.position.x) > cam.width / 2 + r || Math.abs(b.y - cam.position.y) > cam.height / 2 + r) continue;
            var blk = b.block, hit = b.hit;
            Draw.color(b.team.color, Color.white, Mathf.clamp(hit));
            if(animated){
                Draw.z(Layer.shields + 0.001 * hit);
                Fill.poly(b.x, b.y, blk.sides, r, blk.shieldRotation);
            }else{
                Draw.z(Layer.shields);
                Lines.stroke(1.5);
                Draw.alpha(0.09 + Mathf.clamp(0.08 * hit));
                Fill.poly(b.x, b.y, blk.sides, r, blk.shieldRotation);
                Draw.alpha(1);
                Lines.poly(b.x, b.y, blk.sides, r, blk.shieldRotation);
            }
            Draw.reset();
        }
    }catch(e){
        logErr("drawShields", e);
    }finally{
        Draw.reset();
    }
}

// Shadow first, then the blocks through a rotated batch transform.
function drawFlying(m){
    var cam = Core.camera;
    var reach = m.radius + 30;
    if(Math.abs(m.x - cam.position.x) > cam.width / 2 + reach || Math.abs(m.y - cam.position.y) > cam.height / 2 + reach) return;
    Draw.draw(Layer.groundUnit + 0.5, () => {
        try{
            drawShadows(m);
        }catch(e){
            logErr("drawShadows", e);
            Draw.color();
        }
    });
    Draw.draw(BODY_Z, () => {
        if(m.mode != "fly" || !liveMachine(m)) return;
        var prev = new Mat().set(Draw.trans());
        try{
            withPocket(m, () => {
                setPartsPocket(m);
                Draw.flush();
                var mat = new Mat();
                mat.setToTranslation(m.x, m.y);
                mat.rotate(m.ang);
                mat.translate(-m.ref[0] * TS, -m.ref[1] * TS);
                Draw.trans(mat);
                var dl = m.drawList, df = m.drawFlag, dz = m.drawLayer, z0 = Draw.z();
                for(var di = 0; di < dl.length; di++){
                    var pb = dl[di], fl = df[di];
                    try{
                        if((fl & 1) != 0){ Draw.z(dz[di]); pb.drawCached(); }
                        if((fl & 2) != 0){ Draw.z(z0); drawBlock(pb, (fl & 4) != 0); }
                        if(pb.damaged()){ Draw.z(Layer.blockCracks); pb.drawCracks(); }
                        Draw.z(z0);
                    }catch(e){
                        logErr("drawPart " + pb.block.name, e);
                        Draw.color();
                    }
                }
                var heads = m.turrets;
                heads.forEach(t => {
                    var r = t.rotation;
                    t.rotation = r - m.ang;
                    if(t.recoilOffset) t.recoilOffset.rotate(-m.ang);
                    drawPartSafe(t);
                    if(t.recoilOffset) t.recoilOffset.rotate(m.ang);
                    t.rotation = r;
                });
                Draw.flush();
                setPartsReal(m);
            }, false);
        }catch(e){
            logErr("drawFlying", e);
        }finally{
            Draw.flush();
            Draw.trans(prev);
            Draw.reset();
        }
    });
    if((m.fireCount | 0) > 0){
        Draw.draw(BODY_Z + 0.05, () => {
            try{
                drawShipFires(m);
            }catch(e){
                logErr("drawShipFires", e);
                Draw.color();
            }
        });
    }
}

var fireFrames = null;
function fireRegions(){
    if(fireFrames != null) return fireFrames;
    fireFrames = [];
    try{
        var start = Core.atlas.has("fire0") ? 0 : (Core.atlas.has("fire1") ? 1 : -1);
        if(start >= 0){
            for(var i = start; i < start + 60 && Core.atlas.has("fire" + i); i++) fireFrames.push(Core.atlas.find("fire" + i));
        }
    }catch(e){
        fireFrames = [];
    }
    return fireFrames;
}

function drawShipFires(m){
    if(m.mode != "fly" || m.fires == null) return;
    var frames = fireRegions();
    if(frames.length == 0) return;
    for(var key in m.fires){
        var f = m.fires[key];
        var w = toWorld(m, f.x * TS, f.y * TS);
        var seed = f.x * 7 + f.y * 13;
        var idx = Math.floor((Time.time / (90 / 40) + seed) % frames.length);
        Draw.color(Color.white);
        Draw.alpha(Mathf.clamp(f.life / 20) * Mathf.clamp((f.max - f.life) / 60));
        Draw.rect(frames[idx], w[0] + ((seed * 31) % 5) - 2, w[1] + ((seed * 17) % 5) - 2);
    }
    Draw.reset();
}

function drawFreeGhost(){
    var input = Vars.control.input;
    var plans = input.selectPlans;
    for(var i = 0; i < plans.size; i++){
        var pl = plans.get(i);
        if(pl.breaking || pl.block == null || !isTerrainBlock(pl.block)) continue;
        if(freePlaceOk(pl.block, pl.x, pl.y, pl.rotation)) drawFreeGhostAt(pl.block, pl.x, pl.y);
    }
    if(Vars.mobile) return;
    var block = input.block;
    if(block == null || input.commandMode || !isTerrainBlock(block) || Core.scene.hasMouse()) return;
    var o = placeOrigin(block);
    if(!freePlaceOk(block, o[0], o[1], input.rotation)) return;
    drawFreeGhostAt(block, o[0], o[1]);
}

function drawFreeGhostAt(block, x, y){
    var size = block.size * TS;
    var cx = x * TS + block.offset, cy = y * TS + block.offset;
    Draw.z(Layer.overlayUI);
    Draw.color(Color.white, 0.9);
    Draw.rect(block.uiIcon, cx, cy, size, size);
    Lines.stroke(1.5);
    Draw.color(Pal.accent);
    Lines.rect(cx - size / 2, cy - size / 2, size, size);
    Draw.reset();
}

function drawBuildOverlay(){
    var landed = landedMachines();
    var cam = Core.camera;
    var w = cam.width, h = cam.height;
    var x0 = Math.max(0, Math.floor((cam.position.x - w / 2) / TS)), x1 = Math.min(Vars.world.width() - 1, Math.ceil((cam.position.x + w / 2) / TS));
    var y0 = Math.max(0, Math.floor((cam.position.y - h / 2) / TS)), y1 = Math.min(Vars.world.height() - 1, Math.ceil((cam.position.y + h / 2) / TS));

    var radius = Math.sqrt(w * w + h * h) / 2 + 24;
    Draw.z(Layer.blockOver);
    Vars.indexer.eachBlock(null, cam.position.x, cam.position.y, radius, boolf(b => true), cons(b => {
        var pos = b.tile.pos();
        for(var i = 0; i < landed.length; i++){
            if(landed[i].cells[pos] || landed[i].pending[pos]) return;
        }
        if(S.loose[pos]) return;
        if(isConstructing(b)) return;
        Draw.color(BLUE, 0.38);
        Fill.rect(b.x, b.y, b.block.size * TS, b.block.size * TS);
    }));

    landed.forEach(m => {
        Draw.z(landedLift(m) ? BODY_Z + 0.1 : Layer.blockOver + 1);
        for(var k in m.pending){
            var x = Point2.x(+k), y = Point2.y(+k);
            Draw.color(Pal.remove, 0.45 + Mathf.absin(Time.time, 6, 0.2));
            Fill.rect(x * TS, y * TS, TS, TS);
        }
    });

    Draw.z(Layer.blockOver + 1);
    for(var kl in S.loose){
        var lx = Point2.x(+kl), ly = Point2.y(+kl);
        Draw.color(Pal.remove, 0.45 + Mathf.absin(Time.time, 6, 0.2));
        Fill.rect(lx * TS, ly * TS, TS, TS);
    }

    Draw.z(Layer.blockOver + 2);
    Lines.stroke(1);
    Draw.color(GRID, 0.28);
    for(var gx = x0; gx <= x1 + 1; gx++){
        Lines.line(gx * TS - TS / 2, y0 * TS - TS / 2, gx * TS - TS / 2, (y1 + 1) * TS - TS / 2);
    }
    for(var gy = y0; gy <= y1 + 1; gy++){
        Lines.line(x0 * TS - TS / 2, gy * TS - TS / 2, (x1 + 1) * TS - TS / 2, gy * TS - TS / 2);
    }
    landed.forEach(m => { if(landedLift(m)) drawLiftedGrid(m, x0, y0, x1, y1); });
    Draw.reset();

    try{
        landed.forEach(m => {
            Draw.z(landedLift(m) ? BODY_Z + 0.3 : Layer.blockOver + 3);
            drawFrontArrows(m);
        });
        Draw.z(SEL_Z);
        drawLayerSelection();
    }catch(e){
        logErr("build overlay extras", e);
    }
    Draw.reset();
}

var ARROW_GREEN = Color.valueOf("3df25a");
var ARROW_DARK = Color.valueOf("0b3d17");

function fillArrow(cx, cy, deg, len, grow){
    var c = Mathf.cosDeg(deg), s = Mathf.sinDeg(deg);
    var half = len / 2 + grow;
    var head = len * 0.46 + grow;
    var headW = len * 0.30 + grow;
    var shaftW = len * 0.09 + grow;
    var base = half - head;
    var px = (u, v) => cx + u * c - v * s;
    var py = (u, v) => cy + u * s + v * c;
    Fill.tri(px(half, 0), py(half, 0), px(base, headW), py(base, headW), px(base, -headW), py(base, -headW));
    Fill.quad(px(-half, shaftW), py(-half, shaftW), px(-half, -shaftW), py(-half, -shaftW),
        px(base, -shaftW), py(base, -shaftW), px(base, shaftW), py(base, shaftW));
}

function machineHulls(m){
    var now = Time.globalTime;
    if(m.hullList === undefined || m.hullVer !== S.layoutVersion || now < m.hullStamp || now - m.hullStamp > 30){
        m.hullStamp = now;
        m.hullVer = S.layoutVersion;
        m.hullList = membersOf(m.cells, m.team).filter(isHull);
    }
    return m.hullList;
}

var frontArrowRegion = null;
function frontArrowPicture(){
    if(frontArrowRegion === null){
        try{
            frontArrowRegion = Core.atlas.has(MOD + "-front-arrow") ? Core.atlas.find(MOD + "-front-arrow") : false;
        }catch(e){
            logErr("front arrow sprite", e);
            frontArrowRegion = false;
        }
    }
    return frontArrowRegion;
}

function drawFrontArrows(m){
    var deg = frontDeg(m);
    var hulls = machineHulls(m);
    var pic = frontArrowPicture();
    for(var i = 0; i < hulls.length; i++){
        var h = hulls[i];
        if(h.tile == null || h.tile.build !== h) continue;
        if(pic){
            var side = Math.max(12, h.block.size * TS);
            Draw.color();
            Draw.rect(pic, h.x, h.y, side, side, deg - 90);
        }else{
            var len = Math.max(12, h.block.size * TS * 0.85);
            Draw.color(ARROW_DARK, 0.9);
            fillArrow(h.x, h.y, deg, len, 1.2);
            Draw.color(ARROW_GREEN);
            fillArrow(h.x, h.y, deg, len, 0);
        }
    }
}

function drawLayerSelection(){
    var d = S.layerDrag;
    if(d == null) return;
    var minX = Math.min(d.sx, d.cx), maxX = Math.max(d.sx, d.cx), minY = Math.min(d.sy, d.cy), maxY = Math.max(d.sy, d.cy);
    var single = minX == maxX && minY == maxY;
    var key = minX + "," + minY + "," + maxX + "," + maxY;
    if(d.list == null || d.key != key || Time.globalTime < d.stamp || Time.globalTime - d.stamp > 15){
        d.list = buildingsInRect(minX, minY, maxX, maxY, single ? null : Vars.player.team());
        d.key = key;
        d.stamp = Time.globalTime;
    }
    var list = d.list;
    var dir = single ? null : layerDirection(list, d.start);
    for(var i = 0; i < list.length; i++){
        var b = list[i];
        if(b.tile == null || isConstructing(b)) continue;
        var inMachine = machineOfBuild(b) != null;
        if(dir != null && inMachine != (dir == "leave")) continue;
        Draw.color(inMachine ? GRID : Pal.accent, 0.5);
        Fill.rect(b.x, b.y, b.block.size * TS, b.block.size * TS);
    }
    var rx = (minX - 0.5) * TS, ry = (minY - 0.5) * TS, rw = (maxX - minX + 1) * TS, rh = (maxY - minY + 1) * TS;
    Draw.z(SEL_Z + 1);
    Draw.color(Pal.accent, 0.1);
    Fill.rect(rx + rw / 2, ry + rh / 2, rw, rh);
    Lines.stroke(2);
    Draw.color(Pal.accentBack);
    Lines.rect(rx, ry - 1, rw, rh);
    Draw.color(Pal.accent);
    Lines.rect(rx, ry, rw, rh);
    Draw.reset();
}

runEvent(Trigger.preDraw, () => { restoreBodies(); });
runEvent(Trigger.postDraw, () => { restoreBodies(); });

runEvent(Trigger.draw, () => {
    shrinkBodies();
    if(!Vars.state.isGame()) return;
    refreshDarkness();
    flyingMachines().forEach(m => { drawFlying(m); drawShields(m); });
    S.debris.slice().forEach(d => drawFlying(d));
    landedMachines().forEach(m => { if(landedLift(m)) drawLanded(m); });
    landedMachines().forEach(m => {
        try{ drawMachineMask(m); }catch(e){ logErr("machine mask", e); }
    });
    if(S.buildMode){
        drawBuildOverlay();
        try{ drawFreeGhost(); }catch(e){ logErr("free placement ghost", e); }
    }else if(S.layerDrag != null){
        try{
            Draw.z(SEL_Z);
            drawLayerSelection();
        }catch(e){ logErr("layer square", e); }
    }
});
