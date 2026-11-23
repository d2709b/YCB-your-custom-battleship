'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var TS = F.TS;
var logErr = F.logErr, randRange = F.randRange;
var components = F.components, coverTiles = F.coverTiles, frontDeg = F.frontDeg, isHull = F.isHull,
    splitGroups = F.splitGroups;
var dropMachine = F.dropMachine, flyingMachines = F.flyingMachines;
var partAtWorld = F.partAtWorld, partsChanged = F.partsChanged, toLocal = F.toLocal, toWorld = F.toWorld,
    withPocket = F.withPocket;

function damagePart(m, part, amount){
    if(amount <= 0 || part.dead) return;
    m.hurtDirty = true;
    var dm = Vars.state.rules.blockHealth(part.team);
    var eff = Mathf.zero(dm) ? part.health + 1 : amount / dm;
    if(part.health > eff + 1){
        part.damage(amount);
    }else{
        destroyPart(m, part, true);
        flyReconcile(m);
    }
}

function destroyPart(m, b, fx){
    if(b.dead) return;
    var wp = null, bl = null;
    try{
        wp = toWorld(m, b.tile.drawx(), b.tile.drawy());
        b.set(wp[0], wp[1]);
        if(fx !== false){
            try{ bl = blastOf(b); }catch(e){ logErr("destroyPart blast", e); }
            if(bl != null && F.netFx != null) F.netFx(3, wp[0], wp[1], bl.radius, bl.expl);
            b.onDestroyed();
        }
    }catch(e){
        logErr("destroyPart fx", e);
    }
    b.dead = true;
    withPocket(m, () => { b.tile.setBlock(Blocks.air); }, true);
    var i = m.parts.indexOf(b);
    if(i >= 0) m.parts.splice(i, 1);
    delete S.partIndex[b.id];
    delete S.bstates[b.id];
    if(m.hull === b) m.hull = null;
    if(bl != null && wp != null){
        try{ queueBlast(wp[0], wp[1], bl); }catch(e){ logErr("destroyPart queueBlast", e); }
    }
}

// After a block is lost: the group holding the hull stays, everything else falls as debris.
function flyReconcile(m){
    if(m.mode != "fly" || S.machines.indexOf(m) < 0) return;
    var alive = m.parts.filter(b => !b.dead);
    var comps = components(alive);
    var sp = splitGroups(comps, m.hull != null && !m.hull.dead ? m.hull : null);
    var good = sp.good, bad = sp.bad;
    if(good.length == 0){
        destroyMachine(m, true);
        return;
    }
    try{ F.detachParts(m, bad); }catch(e){ logErr("detachParts", e); }
    bad.forEach(b => { if(!b.dead && m.parts.indexOf(b) >= 0) destroyPart(m, b, true); });
    if(m.hull == null || m.hull.dead){
        m.hull = good.filter(isHull)[0];
    }
    partsChanged(m);
    S.saveDirty = true;
}

function destroyMachine(m, fall){
    if(S.machines.indexOf(m) < 0) return;
    var drivers = F.driversOfMachine(m);
    if(m.mode == "fly"){
        if(fall === true){
            try{ F.detachParts(m, m.parts.slice()); }catch(e){ logErr("detachParts all", e); }
        }
        m.parts.slice().forEach(b => destroyPart(m, b, true));
        m.parts = [];
        clearFires(m);
    }
    dropMachine(m);
    drivers.forEach(d => F.sayToDriver(d, "mb.msg.dead"));
}

function splashParts(m, x, y, radius, damage, skip){
    var l = toLocal(m, x, y);
    m.parts.slice().forEach(b => {
        if(b === skip || b.dead) return;
        var d = Mathf.dst(b.tile.drawx(), b.tile.drawy(), l[0], l[1]) - b.block.size * TS * 0.5;
        if(d > radius) return;
        var scaled = damage * (1 - 0.6 * Math.max(0, d) / radius);
        damagePart(m, b, Damage.applyArmor(scaled, b.block.armor));
    });
}

function unitDamageMul(team){
    try{ return Vars.state.rules.unitDamage(team); }catch(e){ return 1; }
}

function wallBounce(b, part, type){
    var blk = part.block;
    var cd = +blk.chanceDeflect, lc = +blk.lightningChance;
    if(!(cd > 0) && !(lc > 0)) return false;
    try{
        if(lc > 0 && Mathf.chance(lc)) Lightning.create(part.team, blk.lightningColor, blk.lightningDamage, part.x, part.y, b.rotation() + 180, blk.lightningLength);
        if(cd > 0 && b.vel.len() > 0.1 && type.reflectable && Mathf.chance(cd / b.damage)){
            b.trns(-b.vel.x, -b.vel.y);
            if(Math.abs(part.x - b.x) > Math.abs(part.y - b.y)) b.vel.x *= -1; else b.vel.y *= -1;
            b.owner = part;
            b.team = part.team;
            b.time += 1;
            return true;
        }
    }catch(e){
        logErr("wall bounce", e);
    }
    return false;
}

// Applies enemy bullets and splash damage to blocks of flying machines.
function scanBullets(){
    var fl = flyingMachines();
    if(fl.length == 0) return;
    Groups.bullet.each(cons(b => {
        var type = b.type;
        for(var i = 0; i < fl.length; i++){
            var m = fl[i];
            if(m.mode != "fly" || b.team.id == m.team.id) continue;
            var reach = m.radius + 16 + (type.splashDamageRadius > 0 ? type.splashDamageRadius : 0);
            if(Mathf.dst2(b.x, b.y, m.x, m.y) > reach * reach) continue;
            // A ship in flight counts as an air target: ground-only shots (artillery, flames) cannot touch it.
            if(!type.collidesAir) continue;

            if(type.splashDamage > 0 && type.despawnHit && b.time + Time.delta >= b.lifetime){
                splashParts(m, b.x, b.y, type.splashDamageRadius, type.splashDamage * type.buildingDamageMultiplier * unitDamageMul(b.team), null);
                try{ bulletFire(type, b.x, b.y); }catch(e){ logErr("bullet fire", e); }
                continue;
            }
            if(type.collides === false && !(type.collidesGround && type.collidesTiles)) continue;

            var part = partAtWorld(m, b.x, b.y);
            if(part == null) part = partAtWorld(m, (b.x + b.lastX) / 2, (b.y + b.lastY) / 2);
            if(part == null || part.dead || part.team.id == b.team.id) continue;
            if(!part.collide(b)) continue;
            if(type.pierceBuilding && b.collided.contains(part.id)) continue;

            var dmg = b.damage * type.buildingDamageMultiplier * unitDamageMul(b.team);
            if(!type.pierceArmor) dmg = Damage.applyArmor(dmg, part.block.armor);
            var hx = b.x, hy = b.y;
            if(wallBounce(b, part, type)){
                damagePart(m, part, dmg);
                break;
            }
            if(type.pierce || type.pierceBuilding){
                b.collided.add(part.id);
            }else{
                b.hit = true;
                b.remove();
            }
            try{ type.hit(b, hx, hy); }catch(e){ logErr("bullet hit", e); }
            try{ bulletFire(type, hx, hy); }catch(e){ logErr("bullet fire", e); }
            damagePart(m, part, dmg);
            if(type.splashDamage > 0 && m.mode == "fly") splashParts(m, hx, hy, type.splashDamageRadius, type.splashDamage * type.buildingDamageMultiplier * unitDamageMul(b.team), part);
            break;
        }
    }));
}

var FIRE_LIFE = 1000;
var FIRE_DAMAGE_DELAY = 30;
var FIRE_DAMAGE = 2.5;
var FIRE_MAX_INTENSITY = 4;
var FIRE_GROW_PER_SEC = 0.12;
var FIRE_FADE_PER_SEC = 0.05;
var FIRE_SPREAD_DELAY = 22;
var FIRE_SPREAD_BARE = 0.08;
var FIRE_DROP_DELAY = 45;
var FIRE_DROP_CHANCE = 0.2;
var FIRE_MAX_PER_SHIP = 400;
var FIRE_WET_AMOUNT = 10;
var FIRE_WET_RATE = 5;
var BLAST_FALLOFF = 0.4;
var BLAST_FIRE_SPREAD = 6;
var ELECTRIC_MIN_POWER = 50;
var ELECTRIC_POWER_PER_DAMAGE = 25;
var ELECTRIC_DAMAGE_MAX = 600;
var ELECTRIC_POWERBLOCK_MULT = 1.5;
var D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];

var itemListCache = null, liquidListCache = null;
function itemList(){ return itemListCache != null ? itemListCache : (itemListCache = F.allContent(Vars.content.items())); }
function liquidList(){ return liquidListCache != null ? liquidListCache : (liquidListCache = F.allContent(Vars.content.liquids())); }

function later(delay, fn){
    Time.run(delay, () => { try{ fn(); }catch(e){ logErr("later", e); } });
}

function pocketCell(m, x, y){ return m.pocket == null ? null : m.pocket.get(x, y); }

function cellAtWorld(m, wx, wy){
    if(m.mode != "fly" || m.pocket == null) return null;
    var l = toLocal(m, wx, wy);
    var t = m.pocket.get(Math.round(l[0] / TS), Math.round(l[1] / TS));
    return t != null && t.build != null ? t : null;
}

function flammabilityOf(b){
    var blk = b.block, total = 0, i, n;
    if(blk.hasItems && b.items != null && b.items.total() > 0){
        var s = 0, its = itemList();
        for(i = 0; i < its.length; i++){
            if(its[i].flammability > 0){
                n = b.items.get(its[i]);
                if(n > 0) s += its[i].flammability * n;
            }
        }
        total += s / Math.max(blk.itemCapacity, 1) * Mathf.clamp(blk.itemCapacity / 2.4, 1, 3);
    }
    if(blk.hasLiquids && b.liquids != null){
        var ls = 0, lq = liquidList();
        for(i = 0; i < lq.length; i++){
            if(lq[i].flammability > 0){
                n = b.liquids.get(lq[i]);
                if(n > 0) ls += lq[i].flammability * n / 3;
            }
        }
        total += ls / Math.max(blk.liquidCapacity, 1) * Mathf.clamp(blk.liquidCapacity / 30, 1, 2);
    }
    return total;
}

function isWet(b){
    if(!b.block.hasLiquids || b.liquids == null) return false;
    var lq = liquidList();
    for(var i = 0; i < lq.length; i++){
        var ok = false;
        try{ ok = lq[i].canExtinguish(); }catch(e){ ok = lq[i].flammability < 0.1 && lq[i].temperature <= 0.5; }
        if(ok && b.liquids.get(lq[i]) >= FIRE_WET_AMOUNT) return true;
    }
    return false;
}

function putOut(m, key){
    if(m.fires != null && m.fires[key] !== undefined){
        delete m.fires[key];
        m.fireCount = Math.max(0, (m.fireCount | 0) - 1);
    }
}

function clearFires(m){ m.fires = {}; m.fireCount = 0; }

function igniteCell(m, tile, bump, refresh){
    if(m == null || m.mode != "fly" || tile == null || tile.build == null) return false;
    try{ if(Vars.state.rules.fire === false) return false; }catch(e){  }
    var b = tile.build;
    if(b.dead || S.partIndex[b.id] !== m) return false;
    if(m.fires == null){ m.fires = {}; m.fireCount = 0; }
    var key = tile.x + tile.y * 4096;
    var f = m.fires[key];
    if(f !== undefined){
        if(refresh !== false){ f.life = 0; f.max = FIRE_LIFE; }
        f.intensity = Math.min(FIRE_MAX_INTENSITY, f.intensity + (bump === undefined ? 0.25 : bump));
        return true;
    }
    if((m.fireCount | 0) >= FIRE_MAX_PER_SHIP) return false;
    m.fires[key] = {
        x: tile.x, y: tile.y, tile: tile, life: 0, max: FIRE_LIFE, intensity: 1, flam: 0, wet: false, flamT: 0,
        spreadT: Math.random() * FIRE_SPREAD_DELAY, dmgT: Math.random() * FIRE_DAMAGE_DELAY, dropT: Math.random() * FIRE_DROP_DELAY
    };
    m.fireCount = (m.fireCount | 0) + 1;
    return true;
}

function igniteWorld(wx, wy, bump){
    var fl = flyingMachines();
    for(var i = 0; i < fl.length; i++){
        var t = cellAtWorld(fl[i], wx, wy);
        if(t != null) igniteCell(fl[i], t, bump, true);
    }
}

function igniteNear(x, y, r, bump){
    var fl = flyingMachines();
    for(var i = 0; i < fl.length; i++){
        var m = fl[i];
        if(Mathf.dst(x, y, m.x, m.y) > m.radius + r + 24) continue;
        var l = toLocal(m, x, y), near = [];
        for(var j = 0; j < m.parts.length; j++){
            var b = m.parts[j];
            if(b.dead) continue;
            if(Mathf.dst(b.tile.drawx(), b.tile.drawy(), l[0], l[1]) - b.block.size * TS * 0.5 <= r) near.push(b);
        }
        if(near.length > 0) igniteCell(m, near[Math.floor(Math.random() * near.length)].tile, bump, true);
    }
}

function spreadFire(m, f){
    var d = D4[Math.floor(Math.random() * 4)];
    var t = pocketCell(m, f.x + d[0], f.y + d[1]);
    if(t != null) igniteCell(m, t, 0, false);
}

function dropFire(m, f, b){
    var chance = Math.min(0.9, FIRE_DROP_CHANCE + 0.12 * f.flam + 0.2 * (f.intensity - 1));
    if(Math.random() >= chance) return;
    var w = toWorld(m, f.x * TS, f.y * TS);
    var rt = Vars.world.tileWorld(w[0] + randRange(3), w[1] + randRange(3));
    if(rt != null && rt.build != null) Fires.create(rt);
}

function fireFx(m, f, delta){
    if(Vars.headless) return;
    if(Mathf.chance(0.09 * delta * (0.5 + 0.5 * f.intensity))){
        var w = toWorld(m, f.x * TS, f.y * TS);
        Fx.fire.at(w[0] + randRange(4), w[1] + randRange(4));
    }
    if(Mathf.chance(0.05 * delta)){
        var w2 = toWorld(m, f.x * TS, f.y * TS);
        Fx.fireSmoke.at(w2[0] + randRange(4), w2[1] + randRange(4));
    }
}

function stepFires(m, delta){
    var fires = m.fires;
    if(fires == null || (m.fireCount | 0) <= 0 || m.mode != "fly") return;
    for(var key in fires){
        var f = fires[key];
        var b = f.tile.build;
        if(b == null || b.dead || S.partIndex[b.id] !== m){ putOut(m, key); continue; }
        f.flamT -= delta;
        if(f.flamT <= 0){ f.flamT = 15; f.flam = flammabilityOf(b); f.wet = isWet(b); }
        f.life += delta;
        if(f.flam > 0) f.max += Mathf.clamp(f.flam / 8, 0, 0.6) * delta;
        if(f.wet){
            f.life += FIRE_WET_RATE * delta;
            f.intensity = Math.max(1, f.intensity - delta / 60);
        }
        if(f.life >= f.max){ putOut(m, key); continue; }
        if(f.flam > 0.3){
            if(!f.wet) f.intensity = Math.min(FIRE_MAX_INTENSITY, f.intensity + delta / 60 * FIRE_GROW_PER_SEC * Math.min(f.flam, 2));
        }else{
            f.intensity = Math.max(1, f.intensity - delta / 60 * FIRE_FADE_PER_SEC);
        }
        fireFx(m, f, delta);
        f.spreadT += delta * Mathf.clamp((f.flam + f.intensity) / 5, 0.3, 2);
        if(f.spreadT >= FIRE_SPREAD_DELAY){
            f.spreadT = 0;
            if(f.flam > 1 || Math.random() < FIRE_SPREAD_BARE) spreadFire(m, f);
        }
        f.dmgT += delta;
        if(f.dmgT >= FIRE_DAMAGE_DELAY){
            f.dmgT = 0;
            damagePart(m, b, FIRE_DAMAGE * f.intensity);
            if(S.machines.indexOf(m) < 0 || m.mode != "fly") return;
            if(b.dead) continue;
        }
        f.dropT += delta;
        if(f.dropT >= FIRE_DROP_DELAY){
            f.dropT = 0;
            dropFire(m, f, b);
        }
    }
}

function bulletFire(type, hx, hy){
    var burns = false;
    try{ burns = type.makeFire === true || type.status === StatusEffects.burning; }catch(e){ burns = false; }
    if(burns) igniteWorld(hx, hy, 0.5);
    var amount = type.incendAmount | 0;
    if(amount > 0 && type.incendChance > 0 && Mathf.chance(type.incendChance)){
        for(var i = 0; i < amount; i++) igniteWorld(hx + randRange(type.incendSpread), hy + randRange(type.incendSpread), 0.5);
    }
}

function takeOverGroundFires(m, cells){
    cells.forEach(c => { igniteCell(m, pocketCell(m, c[0], c[1]), 0.5, true); });
}

function groundFiresUnder(parts, off){
    var cells = [];
    parts.forEach(b => coverTiles(b).forEach(p => {
        var tx = Point2.x(p), ty = Point2.y(p);
        try{
            if(Fires.has(tx, ty)){
                cells.push([tx - off[0], ty - off[1]]);
                Fires.remove(Vars.world.tile(tx, ty));
            }
        }catch(e){ logErr("fire pick up", e); }
    }));
    return cells;
}

function shipFiresToGround(m, off, q){
    var out = [];
    if(m.fires == null) return out;
    for(var k in m.fires) out.push(F.landCell(q | 0, off, m.fires[k].x, m.fires[k].y));
    return out;
}

function groundFiresStart(cells){
    cells.forEach(c => {
        try{
            var t = Vars.world.tile(c[0], c[1]);
            if(t != null && t.build != null) Fires.create(t);
        }catch(e){ logErr("fire put down", e); }
    });
}

function explosionCap(b){
    try{
        var c = b.explosionItemCap();
        if(typeof c === "number") return c;
    }catch(e){  }
    return b.block.itemCapacity;
}

function isReactorClass(blk, cls){
    try{ return blk instanceof cls; }catch(e){ return false; }
}

function reactorOf(b){
    var blk = b.block;
    try{
        if(Vars.state.rules.reactorExplosions === false) return null;
        var rad = blk.explosionRadius, dmg = blk.explosionDamage;
        if(typeof rad !== "number" || typeof dmg !== "number" || rad <= 0 || dmg <= 0) return null;
        var armed = false;
        if(isReactorClass(blk, Packages.mindustry.world.blocks.power.NuclearReactor)){
            armed = b.items.get(blk.fuelItem) >= 5 || b.heat >= 0.5;
        }else if(isReactorClass(blk, Packages.mindustry.world.blocks.power.ImpactReactor)){
            armed = b.warmup >= 0.4;
        }
        return armed ? {radius: rad * TS, damage: dmg * 4} : null;
    }catch(e){
        logErr("reactorOf", e);
        return null;
    }
}

function blastOf(b){
    var blk = b.block, i, n;
    var expl = blk.baseExplosiveness || 0, flam = 0, power = 0;
    if(blk.hasItems && b.items != null && b.items.total() > 0){
        var cap = explosionCap(b), its = itemList();
        for(i = 0; i < its.length; i++){
            n = Math.min(b.items.get(its[i]), cap);
            if(n <= 0) continue;
            expl += its[i].explosiveness * n;
            flam += its[i].flammability * n;
            power += its[i].charge * Math.pow(n, 1.1) * 150;
        }
    }
    if(blk.hasLiquids && b.liquids != null){
        var lq = liquidList();
        for(i = 0; i < lq.length; i++){
            n = b.liquids.get(lq[i]);
            if(n <= 0) continue;
            flam += lq[i].flammability * n / 2;
            expl += lq[i].explosiveness * n / 2;
        }
    }
    try{
        if(blk.consPower != null && blk.consPower.buffered && b.power != null) power += b.power.status * blk.consPower.capacity;
    }catch(e){  }
    var damaging = true;
    try{ damaging = Vars.state.rules.damageExplosions !== false; }catch(e){ damaging = true; }
    if(!damaging){ expl = 0; flam = 0; power = 0; }
    return {flam: flam, expl: expl * 3.5, power: power, radius: TS * blk.size / 2, reactor: reactorOf(b)};
}

function blastMatters(bl){
    return bl != null && (bl.expl > 2 || bl.power >= ELECTRIC_MIN_POWER || bl.flam >= 4 || bl.reactor != null);
}

function blastParts(m, x, y, radius, damage, falloff, electric){
    if(m.mode != "fly" || S.machines.indexOf(m) < 0 || radius <= 0) return;
    if(Mathf.dst(x, y, m.x, m.y) > m.radius + radius + 24) return;
    var l = toLocal(m, x, y);
    m.parts.slice().forEach(b => {
        if(b.dead) return;
        var d = Mathf.dst(b.tile.drawx(), b.tile.drawy(), l[0], l[1]) - b.block.size * TS * 0.5;
        if(d > radius) return;
        var amount = damage * Mathf.lerp(1 - Math.max(0, d) / radius, 1, falloff);
        if(electric && b.block.hasPower) amount *= ELECTRIC_POWERBLOCK_MULT;
        damagePart(m, b, Damage.applyArmor(amount, b.block.armor));
    });
}

function blastShips(x, y, radius, damage, falloff, electric){
    flyingMachines().forEach(m => { blastParts(m, x, y, radius, damage, falloff, electric); });
}

function waveLater(delay, x, y, radius, damage){ later(delay, () => { blastShips(x, y, radius, damage, BLAST_FALLOFF, false); }); }
function fireLater(delay, x, y, r){ later(delay, () => { igniteNear(x, y, r, 0.5); }); }

function queueBlast(x, y, bl){
    if(!blastMatters(bl) || flyingMachines().length == 0) return;
    var i;
    if(bl.reactor != null) later(0, () => { blastShips(x, y, bl.reactor.radius, bl.reactor.damage, BLAST_FALLOFF, false); });
    var waves = bl.expl <= 2 ? 0 : Mathf.clamp(Math.floor(bl.expl / 11), 1, 25);
    for(i = 0; i < waves; i++){
        waveLater(i * 2, x, y, Mathf.clamp(bl.radius + bl.expl, 0, 50) * ((i + 1) / waves), bl.expl / 2);
    }
    if(bl.power >= ELECTRIC_MIN_POWER){
        var shock = Mathf.clamp(bl.power / ELECTRIC_POWER_PER_DAMAGE, 0, ELECTRIC_DAMAGE_MAX);
        var reach = (5 + Mathf.clamp(Math.floor(bl.power / 500), 1, 20)) * 7.5;
        later(Mathf.random(4), () => { blastShips(x, y, reach, shock, 0.25, true); });
    }
    var fires = Mathf.clamp(bl.flam / 4, 0, 30);
    var spread = bl.radius + BLAST_FIRE_SPREAD + Math.min(bl.flam, 40);
    for(i = 0; i < fires; i++) fireLater(i / 2, x, y, spread);
}

function groundBlast(tile){
    if(tile == null || Vars.net.client()) return;
    var b = tile.build;
    if(b == null || S.partIndex[b.id] !== undefined) return;
    if(flyingMachines().length == 0) return;
    queueBlast(b.x, b.y, blastOf(b));
}

function reapDead(m){
    if(m.mode != "fly") return;
    if((Math.floor(Time.globalTime) + m.id) % 4 != 0) return;
    var gone = null, i;
    for(i = 0; i < m.parts.length; i++){
        var p = m.parts[i];
        if(p.dead || p.tile == null || p.tile.build !== p) (gone || (gone = [])).push(p);
    }
    if(gone == null) return;
    gone.forEach(p => {
        try{
            var w = toWorld(m, p.tile.drawx(), p.tile.drawy());
            queueBlast(w[0], w[1], blastOf(p));
        }catch(e){ logErr("reapDead blast", e); }
        p.dead = true;
        try{ withPocket(m, () => { if(p.tile != null && p.tile.build === p) p.tile.setBlock(Blocks.air); }, true); }catch(e){ logErr("reapDead clear", e); }
        var k = m.parts.indexOf(p);
        if(k >= 0) m.parts.splice(k, 1);
        delete S.partIndex[p.id];
        delete S.bstates[p.id];
        if(m.hull === p) m.hull = null;
    });
    flyReconcile(m);
}

function playerWantsFire(){
    var p = Vars.player;
    if(p == null) return false;
    return p.shooting && !Core.scene.hasMouse();
}

function leadPoint(sx, sy, svx, svy, tx, ty, tvx, tvy, speed){
    var rvx = tvx - svx, rvy = tvy - svy;
    var ox = tx - sx, oy = ty - sy;
    var a = rvx * rvx + rvy * rvy - speed * speed;
    var b = 2 * (ox * rvx + oy * rvy);
    var c = ox * ox + oy * oy;
    var time = 0;
    if(Math.abs(a) < 1e-6){
        if(Math.abs(b) > 1e-6) time = -c / b;
    }else{
        var disc = b * b - 4 * a * c;
        if(disc >= 0){
            var sq = Math.sqrt(disc);
            var t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
            var lo = Math.min(t1, t2), hi = Math.max(t1, t2);
            time = lo > 0 ? lo : hi;
        }
    }
    if(!(time > 0)) time = 0;
    return [tx + rvx * time, ty + rvy * time];
}

function targetVel(target){
    if(target instanceof Unit){
        try{ return [target.deltaX(), target.deltaY()]; }catch(e){  }
        try{ return [target.vel.x, target.vel.y]; }catch(e2){  }
    }
    return [0, 0];
}

function aimPoint(m, t, target){
    try{
        var bt = t.peekAmmo();
        if(bt != null && bt.speed > 0.01){
            var tv = targetVel(target);
            var keep = bt.keepVelocity !== false;
            return leadPoint(t.x, t.y, keep ? m.vx : 0, keep ? m.vy : 0, target.x, target.y, tv[0], tv[1], bt.speed);
        }
    }catch(e){  }
    return [target.x, target.y];
}

function fireControl(m){
    var ts = m.turrets;
    if(ts.length == 0) return;
    var manual = null;
    if(S.testFire != null) manual = S.testFire;
    else{
        var drv = F.driverOf(m);
        if(drv != null) manual = drv.input().aim;
    }

    var target = null;
    if(manual == null){
        var maxR = 0, anyAir = false, anyGround = false;
        ts.forEach(t => {
            if(!t.hasAmmo()) return;
            var r = t.range();
            if(r > maxR) maxR = r;
            if(t.block.targetAir) anyAir = true;
            if(t.block.targetGround) anyGround = true;
        });
        var reach = maxR + m.radius;
        if(m.target != null && (m.target.dead || Units.invalidateTarget(m.target, m.team, m.x, m.y, reach))) m.target = null;
        m.targetTimer -= Time.delta;
        var ordered = null;
        if(maxR > 0){
            var cmd = F.commandAI(m);
            if(cmd != null){
                try{
                    var ct = cmd.attackTarget;
                    if(ct != null && !ct.dead && !Units.invalidateTarget(ct, m.team, m.x, m.y, reach)) ordered = ct;
                }catch(e){ logErr("ordered target", e); }
            }
        }
        if(ordered != null){
            m.target = ordered;
        }else if(maxR > 0 && (m.target == null || m.targetTimer <= 0)){
            m.targetTimer = 12;
            var cand = Units.closestTarget(m.team, m.x, m.y, reach, boolf(u => u.checkTarget(anyAir, anyGround)), boolf(b => anyGround));
            m.target = cand;
        }
        if(maxR == 0) m.target = null;
        target = m.target;
    }
    var hr = (frontDeg(m) + m.ang) * Mathf.degRad;
    var fx = m.x + Math.cos(hr) * 100, fy = m.y + Math.sin(hr) * 100;
    for(var i = 0; i < ts.length; i++){
        var t = ts[i];
        var ax = fx, ay = fy, shoot = 0;
        if(manual != null){
            ax = manual[0]; ay = manual[1]; shoot = 1;
        }else if(target != null){
            var ap = aimPoint(m, t, target);
            ax = ap[0]; ay = ap[1];
            var air = (target instanceof Unit) && target.isFlying();
            var typeOk = air ? t.block.targetAir : t.block.targetGround;
            var inRange = Mathf.dst(t.x, t.y, target.x, target.y) <= t.range() + (target instanceof Unit ? target.hitSize / 2 : 0);
            shoot = (typeOk && inRange && t.hasAmmo()) ? 1 : 0;
        }
        t.control(LAccess.shoot, ax / TS, ay / TS, shoot, 0);
    }
}

function machineOfBullet(b){
    var o = b.owner;
    if(o == null || !(o instanceof Building)) return null;
    var m = S.partIndex[o.id];
    return (m === undefined || m.mode != "fly") ? null : m;
}

function inheritMachineVelocity(){
    var armed = false, fl = flyingMachines();
    for(var i = 0; i < fl.length; i++){
        if(fl[i].turrets.length > 0){ armed = true; break; }
    }
    if(!armed){
        if(!S.inheritedBullets.isEmpty()) S.inheritedBullets = new java.util.IdentityHashMap();
        return;
    }
    var fresh = Time.delta * 2 + 1;
    var done = new java.util.IdentityHashMap();
    Groups.bullet.each(cons(b => {
        try{
            var m = machineOfBullet(b);
            if(m == null) return;
            done.put(b, true);
            if(S.inheritedBullets.containsKey(b)) return;
            if(b.time > fresh) return;
            if(!(b.type.keepVelocity === false || b.type.speed <= 0.01) && (m.vx != 0 || m.vy != 0)) b.vel.add(m.vx, m.vy);
            if(F.netBullet != null) F.netBullet(b);
        }catch(e){
            logErr("inheritMachineVelocity", e);
        }
    }));
    S.inheritedBullets = done;
}

F.damagePart = damagePart;
F.flyReconcile = flyReconcile;
F.destroyMachine = destroyMachine;
F.scanBullets = scanBullets;
F.pocketCell = pocketCell;
F.clearFires = clearFires;
F.igniteCell = igniteCell;
F.stepFires = stepFires;
F.takeOverGroundFires = takeOverGroundFires;
F.groundFiresUnder = groundFiresUnder;
F.shipFiresToGround = shipFiresToGround;
F.groundFiresStart = groundFiresStart;
F.blastOf = blastOf;
F.queueBlast = queueBlast;
F.groundBlast = groundBlast;
F.reapDead = reapDead;
F.fireControl = fireControl;
F.playerWantsFire = playerWantsFire;
F.inheritMachineVelocity = inheritMachineVelocity;
F.fireFx = fireFx;
