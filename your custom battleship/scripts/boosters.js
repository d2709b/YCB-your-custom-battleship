'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var ENERGY_CRYO_MULT = F.ENERGY_CRYO_MULT, ENERGY_LIQUID_USE = F.ENERGY_LIQUID_USE,
    ENERGY_USE = F.ENERGY_USE, ENGINE_HOVER_EFFECT = F.ENGINE_HOVER_EFFECT, ENGINE_HOVER_PULSE = F.ENGINE_HOVER_PULSE,
    ENGINE_HOVER_USE = F.ENGINE_HOVER_USE, ENGINE_LIFT_EFFECT = F.ENGINE_LIFT_EFFECT,
    ENERGY_THRUST = F.ENERGY_THRUST, ENERGY_WATER_MULT = F.ENERGY_WATER_MULT,
    FUEL_BASE_BONUS = F.FUEL_BASE_BONUS, FUEL_BURN_TICKS = F.FUEL_BURN_TICKS, FUEL_CRYO_MULT = F.FUEL_CRYO_MULT,
    FUEL_LIQUID_USE = F.FUEL_LIQUID_USE, FUEL_WATER_MULT = F.FUEL_WATER_MULT, FUEL_WEAKEN = F.FUEL_WEAKEN,
    GLOW_IN_TICKS = F.GLOW_IN_TICKS, GLOW_OUT_TICKS = F.GLOW_OUT_TICKS, MOD = F.MOD,
    PULSE_ALPHA_MIN = F.PULSE_ALPHA_MIN, PULSE_TICKS = F.PULSE_TICKS,
    POWER_LIGHT_EMPTY = F.POWER_LIGHT_EMPTY, POWER_LIGHT_FULL = F.POWER_LIGHT_FULL,
    SMOKE_ENERGY_PER_SEC = F.SMOKE_ENERGY_PER_SEC, SMOKE_FUEL_PER_SEC = F.SMOKE_FUEL_PER_SEC,
    SMOKE_ROCKET_PER_SEC = F.SMOKE_ROCKET_PER_SEC, TS = F.TS, boosterPower = F.boosterPower;
var bundle = F.bundle, fmtNum = F.fmtNum, logErr = F.logErr, randRange = F.randRange;

function bstate(b){
    var s = S.bstates[b.id];
    if(s === undefined){
        s = {thrusting: false, working: false, level: 0, glow: 0, pulseT: 0, stamp: Time.time, burn: 0, item: null, phase: (b.id % 17) * 2, smoke: -1, liqFrac: 1, water: 0, wstamp: Time.time, waterColor: null};
        S.bstates[b.id] = s;
    }
    return s;
}

var FUELS = [
    {item: Items.coal, mult: 30 / FUEL_WEAKEN + FUEL_BASE_BONUS},
    {item: Items.sporePod, mult: 33 / FUEL_WEAKEN + FUEL_BASE_BONUS},
    {item: Items.pyratite, mult: 40 / FUEL_WEAKEN + FUEL_BASE_BONUS}
];

function fuelMult(item){
    for(var i = 0; i < FUELS.length; i++){
        if(FUELS[i].item.id == item.id) return FUELS[i].mult;
    }
    return 0;
}

function nextFuel(b){
    for(var i = 0; i < FUELS.length; i++){
        if(b.items.get(FUELS[i].item) > 0) return FUELS[i].item;
    }
    return null;
}

function boostMultFor(blk, liquid){
    if(liquid == null) return 1;
    var water = liquid.id == Liquids.water.id, cryo = liquid.id == Liquids.cryofluid.id;
    if(blk === F.energyBooster) return water ? ENERGY_WATER_MULT : (cryo ? ENERGY_CRYO_MULT : 1);
    if(blk === F.fuelBooster) return water ? FUEL_WATER_MULT : (cryo ? FUEL_CRYO_MULT : 1);
    return 1;
}

function liquidUse(blk){
    return blk === F.fuelBooster ? FUEL_LIQUID_USE : ENERGY_LIQUID_USE;
}

function acceptsBoostLiquid(b, liquid){
    if(b.liquids == null || boostMultFor(b.block, liquid) <= 1) return false;
    var l = b.liquids;
    return l.current().id == liquid.id || l.currentAmount() < 0.2;
}

function boostLiquidOf(b){
    if(b.liquids == null) return null;
    var liq = b.liquids.current();
    if(liq == null || b.liquids.get(liq) <= 0.0001) return null;
    return boostMultFor(b.block, liq) > 1 ? liq : null;
}

function liquidMult(b){
    var liq = boostLiquidOf(b);
    if(liq == null) return 1;
    var full = boostMultFor(b.block, liq);
    var s = S.bstates[b.id];
    var frac = (s !== undefined && s.working) ? s.liqFrac : 1;
    return 1 + (full - 1) * frac;
}

function stepLiquid(b, s, delta){
    var liq = boostLiquidOf(b);
    if(liq == null){
        s.liqFrac = 1;
        return;
    }
    var need = liquidUse(b.block) * delta;
    var take = Math.min(need, b.liquids.get(liq));
    b.liquids.remove(liq, take);
    s.liqFrac = need > 0 ? take / need : 1;
}

function boosterConsumption(b, table){
    try{
        table.left();
        if(b.block === F.fuelBooster){
            var fuels = new MultiReqImage();
            FUELS.forEach(f => fuels.add(new ReqImage(f.item.uiIcon, boolp(() => b.items.get(f.item) > 0))));
            table.add(fuels).size(32).padRight(14);
        }
        [Liquids.water, Liquids.cryofluid].forEach(liq => {
            table.add(new ReqImage(liq.uiIcon, boolp(() => b.liquids != null && b.liquids.get(liq) > 0.01))).size(32);
            table.add("x" + fmtNum(boostMultFor(b.block, liq))).color(Color.lightGray).padLeft(3).padRight(10);
        });
        table.row();
        table.label(prov(() => bundle("mb.booster.thrust", fmtNum(boosterThrust(b))))).color(Color.lightGray).colspan(5).left().padTop(2);
    }catch(e){
        logErr("boosterConsumption", e);
    }
}

var pulseSmall = null, pulseBig = null;

function stepGlow(s, working){
    var now = Time.time;
    var dt = now - s.stamp;
    s.stamp = now;
    if(dt <= 0) return;
    if(working) s.glow = Math.min(1, s.glow + dt / GLOW_IN_TICKS);
    else s.glow = Math.max(0, s.glow - dt / GLOW_OUT_TICKS);
    s.pulseT += dt * pulseRate(s.level);
}

function pulseRate(level){
    return level > 0 && level < 1 ? ENGINE_HOVER_PULSE : 1;
}

function engineLevel(m, thrusting){
    if(m == null || m.mode != "fly" || m.fallOnly === true) return 0;
    var a = m.air;
    if(a != null){
        if(a.crash === true) return 0;
        if(a.kind == "pull") return (a.rate || 0) >= 0 ? ENGINE_HOVER_EFFECT : ENGINE_LIFT_EFFECT;
        return a.kind == "land" ? ENGINE_HOVER_EFFECT : ENGINE_LIFT_EFFECT;
    }
    var th = thrusting === undefined ? m.thrusting === true : thrusting === true;
    return th ? 1 : ENGINE_HOVER_EFFECT;
}

function useShare(level){
    if(!(level > 0)) return 0;
    return level < 1 ? ENGINE_HOVER_USE : 1;
}

function energyBoosterPower(b){
    var s = S.bstates[b.id];
    if(!b.enabled || s === undefined) return 0;
    return ENERGY_USE * useShare(s.level);
}

function drawPulse(b, st, big){
    var reg;
    if(big){
        if(pulseBig == null) pulseBig = Core.atlas.find(MOD + "-pulse-big");
        reg = pulseBig;
    }else{
        if(pulseSmall == null) pulseSmall = Core.atlas.find(MOD + "-pulse");
        reg = pulseSmall;
    }
    var wave = 0.5 + 0.5 * Math.sin((st.pulseT + st.phase) / PULSE_TICKS * 2 * Math.PI);
    var blink = PULSE_ALPHA_MIN + (1 - PULSE_ALPHA_MIN) * wave;
    var g = st.glow;
    g = g * g * (3 - 2 * g);
    Draw.color(Color.white);
    Draw.alpha(blink * g);
    Draw.rect(reg, b.x, b.y, reg.width * TS / 32, reg.height * TS / 32);
    Draw.color();
}

var waterMasks = {};

function maskOf(blk){
    var r = waterMasks[blk.name];
    if(r === undefined){
        var found = Core.atlas.find(blk.name + "-watermask");
        if(found == null || !found.found()) return null;
        waterMasks[blk.name] = r = found;
    }
    return r;
}

function drawWater(b, mask){
    if(b.liquids == null) return;
    var st = bstate(b);
    var liq = b.liquids.current();
    var target = (liq == null || b.block.liquidCapacity <= 0) ? 0 : b.liquids.get(liq) / b.block.liquidCapacity;
    var now = Time.time, dt = now - st.wstamp;
    st.wstamp = now;
    if(dt > 0) st.water += (target - st.water) * Math.min(1, 0.05 * dt);
    if(liq != null) st.waterColor = liq.color;
    if(st.water > 0.002 && st.waterColor != null){
        Draw.color(st.waterColor, Mathf.clamp(st.water));
        Draw.rect(mask, b.x, b.y, b.block.size * TS, b.block.size * TS);
        Draw.color();
    }
}

var powerMasks = {};
var powerEmpty = null, powerFull = null;

function powerMaskOf(blk){
    var r = powerMasks[blk.name];
    if(r === undefined){
        var found = Core.atlas.find(blk.name + "-power");
        if(found == null || !found.found()) return null;
        powerMasks[blk.name] = r = found;
    }
    return r;
}

function drawPowerMask(b, mask, x, y, w, h, rot){
    var st = 0;
    try{ st = (b.power == null || !b.enabled) ? 0 : Mathf.clamp(b.power.status); }catch(e){ st = 0; }
    if(!(st > 0.01)) return;
    if(powerEmpty == null){
        powerEmpty = Color.valueOf(POWER_LIGHT_EMPTY);
        powerFull = Color.valueOf(POWER_LIGHT_FULL);
    }
    Draw.color(powerEmpty, powerFull, st);
    Draw.alpha(st);
    if(rot) Draw.rect(mask, x, y, w, h, rot);
    else Draw.rect(mask, x, y, w, h);
    Draw.color();
}

function drawBooster(b){
    var s = b.block.size;
    Draw.rect(b.block.region, b.x, b.y, s * TS, s * TS);
    if(b.block !== F.rocketBooster){
        var mask = maskOf(b.block);
        if(mask != null) drawWater(b, mask);
    }
    if(b.power != null){
        var pmask = powerMaskOf(b.block);
        if(pmask != null) drawPowerMask(b, pmask, b.x, b.y, s * TS, s * TS);
    }
    var st = S.bstates[b.id];
    if(st === undefined) return;
    stepGlow(st, st.working);
    if(st.glow > 0.01) drawPulse(b, st, s >= 3);
}

function isBooster(b){
    return b != null && (b.block === F.rocketBooster || b.block === F.energyBooster || b.block === F.fuelBooster);
}

function boosterThrust(b){
    if(!b.enabled) return 0;
    var blk = b.block;
    if(blk === F.rocketBooster) return 1;
    if(blk === F.energyBooster) return ENERGY_THRUST * Mathf.clamp(b.power.status) * liquidMult(b);
    if(blk === F.fuelBooster){
        var s = bstate(b);
        var base;
        if(s.burn > 0 && s.item != null) base = fuelMult(s.item);
        else{
            var nf = nextFuel(b);
            base = nf == null ? 0 : fuelMult(nf);
        }
        return base * liquidMult(b);
    }
    return 0;
}

// Tiles per second: total thrust x booster power / machine cells.
function flightSpeed(m){
    var cells = m.stats == null ? 0 : m.stats.cells;
    if(cells <= 0) return 0;
    var th = 0, list = m.boosters;
    for(var i = 0; i < list.length; i++){
        if(!list[i].dead) th += boosterThrust(list[i]);
    }
    return th * boosterPower() / cells;
}

// True if any booster can produce thrust (fuel or power available).
function engineWorking(m){
    var list = m.boosters;
    if(list == null) return false;
    for(var i = 0; i < list.length; i++){
        var b = list[i];
        if(b.dead || !b.enabled) continue;
        if(b.block === F.rocketBooster) return true;
        if(b.block === F.fuelBooster){
            if(boosterThrust(b) > 0) return true;
            continue;
        }
        if(b.block === F.energyBooster){
            if(liquidMult(b) <= 0 || b.power == null) continue;
            if(b.power.status > 0.05) return true;
            try{
                var g = b.power.graph;
                if(g != null && (g.getBatteryStored() > 1 || g.getLastPowerProduced() > 0.001)) return true;
            }catch(e){  }
        }
    }
    return false;
}

function shipThrust(m){
    var list = m.mode == "fly" ? m.boosters : (F.membersOf == null ? [] : F.membersOf(m.cells, m.team).filter(isBooster)), sum = 0;
    if(list == null) return 0;
    for(var i = 0; i < list.length; i++){
        var b = list[i];
        if(b.dead || !b.enabled) continue;
        if(b.block === F.energyBooster){
            if(b.power == null) continue;
            var st = Mathf.clamp(b.power.status);
            if(st < 1){
                try{
                    var g = b.power.graph;
                    if(g != null && (g.getBatteryStored() > 1 || g.getLastPowerProduced() > 0.001)) st = 1;
                }catch(e){  }
            }
            sum += ENERGY_THRUST * st * liquidMult(b);
        }else{
            sum += boosterThrust(b);
        }
    }
    return sum;
}

function startBurn(b, s){
    var it = nextFuel(b);
    if(it == null) return;
    b.items.remove(it, 1);
    s.item = it;
    s.burn = FUEL_BURN_TICKS;
}

function smokeInterval(b){
    var rate = b.block === F.fuelBooster ? SMOKE_FUEL_PER_SEC : (b.block === F.energyBooster ? SMOKE_ENERGY_PER_SEC : SMOKE_ROCKET_PER_SEC);
    return rate > 0 ? 60 / rate : 0;
}

function emitSmoke(b, s){
    if(Vars.headless) return;
    var size = b.block.size, r = size * 2;
    if(b.block === F.energyBooster){
        Fx.pulverizeMedium.at(b.x + randRange(r), b.y + randRange(r));
        return;
    }
    Fx.pulverizeSmall.at(b.x + randRange(r), b.y + randRange(r));
    if(b.block === F.fuelBooster){
        var col = s.item != null ? s.item.color : Items.coal.color;
        Fx.mine.at(b.x + randRange(size), b.y + randRange(size), 0, col);
    }
}

function stepSmoke(b, s, delta){
    var iv = smokeInterval(b);
    if(iv <= 0) return;
    if(s.smoke < 0) s.smoke = Math.random() * iv;
    s.smoke += delta;
    if(s.smoke >= iv){
        s.smoke -= iv;
        if(s.smoke > iv) s.smoke = 0;
        emitSmoke(b, s);
    }
}

function tickBoosters(m, delta){
    var list = m.boosters;
    var level = engineLevel(m);
    var use = useShare(level);
    for(var i = 0; i < list.length; i++){
        var b = list[i];
        if(b.dead) continue;
        var s = bstate(b);
        s.level = level;
        var working = false;
        if(level > 0 && b.enabled){
            if(b.block === F.rocketBooster){
                working = true;
            }else if(b.block === F.energyBooster){
                working = b.power.status > 0.05;
            }else if(b.block === F.fuelBooster){
                if(s.burn <= 0) startBurn(b, s);
                if(s.burn > 0){
                    working = true;
                    s.burn -= delta * use;
                    if(s.burn < 0) s.burn = 0;
                }
            }
        }
        s.working = working;
        stepGlow(s, working);
        if(working){
            stepSmoke(b, s, delta * level);
            if(b.block !== F.rocketBooster) stepLiquid(b, s, delta * use);
        }
    }
}

F.bstate = bstate;
F.FUELS = FUELS;
F.fuelMult = fuelMult;
F.acceptsBoostLiquid = acceptsBoostLiquid;
F.boosterConsumption = boosterConsumption;
F.drawBooster = drawBooster;
F.powerMaskOf = powerMaskOf;
F.drawPowerMask = drawPowerMask;
F.isBooster = isBooster;
F.boosterThrust = boosterThrust;
F.flightSpeed = flightSpeed;
F.engineWorking = engineWorking;
F.shipThrust = shipThrust;
F.tickBoosters = tickBoosters;
F.stepSmoke = stepSmoke;
F.engineLevel = engineLevel;
F.energyBoosterPower = energyBoosterPower;
