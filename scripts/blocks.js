'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var ENERGY_LIQUID_CAPACITY = F.ENERGY_LIQUID_CAPACITY, ENERGY_USE = F.ENERGY_USE, MAGNET_USE = F.MAGNET_USE, SUPER_MAGNET_USE = F.SUPER_MAGNET_USE,
    FUEL_ITEM_CAPACITY = F.FUEL_ITEM_CAPACITY, FUEL_LIQUID_CAPACITY = F.FUEL_LIQUID_CAPACITY,
    FUEL_BASE_BONUS = F.FUEL_BASE_BONUS, FUEL_WEAKEN = F.FUEL_WEAKEN, TS = F.TS;
var logErr = F.logErr, onEvent = F.onEvent, runEvent = F.runEvent;
var FUELS = F.FUELS, acceptsBoostLiquid = F.acceptsBoostLiquid, boosterConsumption = F.boosterConsumption,
    drawBooster = F.drawBooster, drawPowerMask = F.drawPowerMask, fuelMult = F.fuelMult, powerMaskOf = F.powerMaskOf;

function defBooster(name, size, health, reqs, buildTypeFn){
    var blk = extend(Block, name, {
        canPlaceOn(tile, team, rotation){
            return true;
        },
        drawPlanRegion(plan, list){
            Draw.rect(this.region, plan.drawx(), plan.drawy(), size * TS, size * TS);
        }
    });
    blk.requirements = reqs;
    blk.category = Category.units;
    blk.buildVisibility = BuildVisibility.shown;
    blk.size = size;
    blk.health = health;
    blk.solid = true;
    blk.update = true;
    blk.noUpdateDisabled = true;
    blk.destructible = true;
    blk.rotate = false;
    blk.alwaysUnlocked = true;
    blk.buildType = prov(buildTypeFn);
    return blk;
}

var rocketBooster = defBooster("rocket-booster", 1, 160,
    ItemStack.with(Items.copper, 20, Items.lead, 10, Items.graphite, 5),
    () => extend(Building, {
        draw(){ drawBooster(this); }
    }));

var energyBooster = defBooster("energy-booster", 2, 640,
    ItemStack.with(Items.copper, 100, Items.lead, 50, Items.silicon, 30, Items.plastanium, 20),
    () => extend(Building, {
        draw(){ drawBooster(this); },
        shouldConsume(){
            var s = S.bstates[this.id];
            return this.enabled && s !== undefined && s.level > 0;
        },
        acceptLiquid(source, liquid){
            return acceptsBoostLiquid(this, liquid);
        },
        displayConsumption(table){
            boosterConsumption(this, table);
        }
    }));
energyBooster.hasPower = true;
try{
    energyBooster.consumePowerDynamic(new Packages.arc.func.Floatf({get: function(b){ return F.energyBoosterPower(b); }}));
}catch(e){
    Log.err("[mb] dynamic power of the energy booster not set, it uses the same power hovering and flying: " + e);
    energyBooster.consumePower(ENERGY_USE);
}
energyBooster.hasLiquids = true;
energyBooster.liquidCapacity = ENERGY_LIQUID_CAPACITY;

var fuelBooster = defBooster("fuel-booster", 3, 1440,
    ItemStack.with(Items.copper, 300, Items.lead, 400, Items.graphite, 100, Items.plastanium, 100, Items.titanium, 200),
    () => extend(Building, {
        draw(){ drawBooster(this); },
        acceptItem(source, item){
            return fuelMult(item) > 0 && this.items.get(item) < FUEL_ITEM_CAPACITY;
        },
        getMaximumAccepted(item){
            return FUEL_ITEM_CAPACITY;
        },
        acceptLiquid(source, liquid){
            return acceptsBoostLiquid(this, liquid);
        },
        displayConsumption(table){
            boosterConsumption(this, table);
        }
    }));
fuelBooster.hasItems = true;
fuelBooster.itemCapacity = FUEL_ITEM_CAPACITY;
fuelBooster.hasLiquids = true;
fuelBooster.liquidCapacity = FUEL_LIQUID_CAPACITY;
fuelBooster.unloadable = true;
try{ fuelBooster.acceptsItems = true; }catch(e){  }

var shipControl = extend(Block, "ship-control", {
    canPlaceOn(tile, team, rotation){
        return true;
    },
    drawPlanRegion(plan, list){
        Draw.rect(this.region, plan.drawx(), plan.drawy(), this.size * TS, this.size * TS);
    }
});
shipControl.requirements = ItemStack.with(Items.copper, 50, Items.lead, 300, Items.silicon, 120);
shipControl.category = Category.logic;
shipControl.buildVisibility = BuildVisibility.shown;
shipControl.size = 2;
shipControl.health = 120;
shipControl.solid = true;
shipControl.destructible = true;
shipControl.update = true;
shipControl.noUpdateDisabled = true;
shipControl.rotate = false;
shipControl.alwaysUnlocked = true;
shipControl.configurable = true;
shipControl.buildType = prov(() => extend(Building, {
    draw(){ drawShipControl(this); },
    buildConfiguration(table){ F.buildShipButton(this, table); },
    config(){
        var list = S.shipMods[this.id];
        if(list == null || list.length == 0) return null;
        return java.lang.String.valueOf(JSON.stringify(F.modsToData(list)));
    }
}));
try{
    shipControl.config(Packages.java.lang.String, (b, v) => F.shipSetMods(b, F.modsFromJson("" + v)));
    shipControl.config(Packages.mindustry.type.Item, (b, v) => F.shipSetMods(b, [F.modRes(v)]));
    shipControl.config(Packages.mindustry.type.Liquid, (b, v) => F.shipSetMods(b, [F.modRes(v)]));
    shipControl.configClear(b => F.shipSetMods(b, []));
}catch(e){
    Log.err("[mb] ship control config not registered: " + e);
}

var magnetPics = {};

function magnetPic(blk, rot){
    rot = (((rot | 0) % 4) + 4) % 4;
    if(rot == 0) return blk.region;
    var list = magnetPics[blk.name];
    if(list === undefined) list = magnetPics[blk.name] = [null, null, null, null];
    var r = list[rot];
    if(r == null){
        var found = Core.atlas.find(blk.name + "-rot" + rot);
        if(found == null || !found.found()) return blk.region;
        list[rot] = r = found;
    }
    return r;
}
function drawMagnet(b){
    var w = b.block.size * TS;
    Draw.rect(magnetPic(b.block, b.rotation), b.x, b.y, w, w);
    var pm = powerMaskOf(b.block);
    if(pm != null) drawPowerMask(b, pm, b.x, b.y, w, w);
}
function defMagnet(name, size, health, use, reqs){
    var blk = extend(Block, name, {
        canPlaceOn(tile, team, rotation){
            return true;
        },
        drawPlanRegion(plan, list){
            Draw.rect(magnetPic(this, plan.rotation), plan.drawx(), plan.drawy(), size * TS, size * TS);
        }
    });
    blk.requirements = reqs;
    blk.category = Category.units;
    blk.buildVisibility = BuildVisibility.shown;
    blk.size = size;
    blk.health = health;
    blk.solid = true;
    blk.update = true;
    blk.noUpdateDisabled = true;
    blk.destructible = true;
    blk.rotate = true;
    blk.alwaysUnlocked = true;
    blk.hasPower = true;
    blk.consumePower(use);
    blk.buildType = prov(() => extend(Building, {
        draw(){ drawMagnet(this); }
    }));
    return blk;
}
var magnet = defMagnet("magnet", 1, 140, MAGNET_USE, ItemStack.with(Items.copper, 40, Items.silicon, 30, Items.titanium, 20));
var superMagnet = defMagnet("super-magnet", 2, 560, SUPER_MAGNET_USE, ItemStack.with(Items.surgeAlloy, 100, Items.graphite, 200, Items.lead, 200));

var landingSpot = extend(Block, "landing-spot", {
    canPlaceOn(tile, team, rotation){
        return true;
    }
});
landingSpot.requirements = ItemStack.with(Items.copper, 20, Items.lead, 20);
landingSpot.category = Category.units;
landingSpot.buildVisibility = BuildVisibility.shown;
landingSpot.alwaysUnlocked = true;
landingSpot.size = 1;
landingSpot.health = 60;
landingSpot.solid = false;
landingSpot.hasShadow = false;
landingSpot.underBullets = true;
landingSpot.destructible = true;
landingSpot.rotate = false;
landingSpot.configurable = false;

var PLANET_RECIPES = [
    {name: "rocket",  block: () => rocketBooster, width: 2, amounts: [20, 10, 5],              classic: null},
    {name: "energy",  block: () => energyBooster, width: 3, amounts: [100, 50, 30, 20],        classic: null},
    {name: "fuel",    block: () => fuelBooster,   width: 4, amounts: [300, 400, 100, 200, 100], classic: null},
    {name: "control", block: () => shipControl,   width: 3, amounts: [50, 300, 120],           classic: null},
    {name: "landing", block: () => landingSpot,   width: 2, amounts: [20, 20],                 classic: null},
    {name: "magnet",  block: () => magnet,        width: 3, amounts: [40, 30, 20],             classic: null},
    {name: "supermagnet", block: () => superMagnet, width: 3, amounts: [100, 200, 200],        classic: null}
];
var PLANET_TREE_LIMIT = 5000;
var FUEL_PER_FLAMMABILITY = 10;
var FUEL_MIN_FLAMMABILITY = 0.3;
var FUEL_MIN_VOLATILITY = 0.2;
var FUEL_MULT_MAX = 20;
var recipePlanet = null;
var planetPoll = 0;
var MetaPkg = Packages.mindustry.world.meta;

function newStacks(n){
    return Packages.java.lang.reflect.Array.newInstance(Packages.mindustry.type.ItemStack, n);
}
function copyStacks(src){
    var out = newStacks(src.length);
    for(var i = 0; i < src.length; i++) out[i] = new ItemStack(src[i].item, src[i].amount);
    return out;
}
function stacksText(reqs){
    var parts = [];
    for(var i = 0; i < reqs.length; i++) parts.push(reqs[i].item.name + " " + reqs[i].amount);
    return parts.join(", ");
}

PLANET_RECIPES.forEach(def => {
    try{ def.classic = copyStacks(def.block().requirements); }catch(e){ logErr("classic recipe", e); }
});

function currentPlanet(){
    var p = null;
    try{ p = Vars.state.getPlanet(); }catch(e){ p = null; }
    if(p == null || p == Planets.sun) p = Planets.serpulo;
    return p;
}

function itemOnPlanet(it, planet){
    if(it == null || it.hidden) return false;
    try{
        if(typeof it.isOnPlanet === "function") return it.isOnPlanet(planet);
    }catch(e){  }
    try{
        if(planet.hiddenItems != null) return !planet.hiddenItems.contains(it);
    }catch(e){  }
    return true;
}
function madeForPlanet(it, planet){
    try{ return it.shownPlanets != null && it.shownPlanets.contains(planet); }catch(e){ return false; }
}
function belongsEverywhere(it){
    try{ return it.shownPlanets != null && it.shownPlanets.isEmpty(); }catch(e){ return false; }
}

function planetItems(planet){
    var seen = {}, out = [];
    function take(it){
        if(it == null || seen[it.id] === true) return;
        if(it.buildable === false || !itemOnPlanet(it, planet)) return;
        seen[it.id] = true;
        out.push(it);
    }
    var ItemClass = Packages.mindustry.type.Item;
    try{
        var root = planet.techTree;
        if(root != null){
            var queue = [root], head = 0;
            while(head < queue.length && head < PLANET_TREE_LIMIT){
                var node = queue[head++];
                if(node.content instanceof ItemClass) take(node.content);
                var kids = node.children;
                for(var k = 0; k < kids.size; k++) queue.push(kids.get(k));
            }
        }
    }catch(e){
        logErr("planet tree", e);
    }
    var all = Vars.content.items();
    for(var i = 0; i < all.size; i++){
        if(madeForPlanet(all.get(i), planet)) take(all.get(i));
    }
    if(out.length == 0){
        for(var j = 0; j < all.size; j++){
            if(belongsEverywhere(all.get(j))) take(all.get(j));
        }
    }
    return out;
}

function recipeOf(def, items){
    var n = Math.min(def.width, items.length, def.amounts.length);
    if(n <= 0) return null;
    var list = [];
    for(var i = 0; i < n; i++) list.push({item: items[i], amount: def.amounts[i]});
    list.sort((a, b) => a.item.id - b.item.id);
    var out = newStacks(n);
    for(var j = 0; j < n; j++) out[j] = new ItemStack(list[j].item, list[j].amount);
    return out;
}

function setRecipe(blk, reqs, fixedTicks){
    blk.requirements = reqs;
    var sum = 0;
    for(var i = 0; i < reqs.length; i++) sum += reqs[i].amount * reqs[i].item.cost;
    try{
        var ticks = fixedTicks === undefined || fixedTicks === null ? sum * blk.buildCostMultiplier : fixedTicks;
        if(typeof blk.buildTime === "number") blk.buildTime = ticks;
        else if(typeof blk.buildCost === "number") blk.buildCost = fixedTicks === undefined || fixedTicks === null ? (20 + sum) * blk.buildCostMultiplier : fixedTicks;
    }catch(e){
        logErr("build time", e);
    }
    try{
        var st = blk.stats;
        if(st != null){
            st.remove(MetaPkg.Stat.buildCost);
            st.add(MetaPkg.Stat.buildCost, MetaPkg.StatValues.items(false, reqs));
            if(typeof blk.buildTime === "number"){
                st.remove(MetaPkg.Stat.buildTime);
                st.add(MetaPkg.Stat.buildTime, blk.buildTime / 60, MetaPkg.StatUnit.seconds);
            }
        }
    }catch(e){
        logErr("recipe stats", e);
    }
}

function rebuildFuels(planet, classic){
    var list = [], seen = {};
    function add(it, mult){
        if(it == null || seen[it.id] === true) return;
        seen[it.id] = true;
        list.push({item: it, mult: Math.round(Math.min(FUEL_MULT_MAX, mult + FUEL_BASE_BONUS) * 100) / 100});
    }
    var legacy = [[Items.coal, 30 / FUEL_WEAKEN], [Items.sporePod, 33 / FUEL_WEAKEN], [Items.pyratite, 40 / FUEL_WEAKEN]];
    legacy.forEach(e => { if(classic || itemOnPlanet(e[0], planet)) add(e[0], e[1]); });
    var all = Vars.content.items();
    for(var i = 0; i < all.size; i++){
        var it = all.get(i);
        var modded = false;
        try{ modded = it.minfo != null && it.minfo.mod != null; }catch(e){ modded = false; }
        if(modded && it.flammability >= FUEL_MIN_FLAMMABILITY && itemOnPlanet(it, planet)) add(it, FUEL_PER_FLAMMABILITY * it.flammability);
    }
    if(list.length == 0){
        for(var j = 0; j < all.size; j++){
            var v = all.get(j);
            if(!itemOnPlanet(v, planet)) continue;
            var vol = v.flammability + 0.5 * (v.explosiveness + v.radioactivity + v.charge);
            if(vol >= FUEL_MIN_VOLATILITY) add(v, FUEL_PER_FLAMMABILITY * vol);
        }
    }
    list.sort((a, b) => a.mult - b.mult);
    FUELS.length = 0;
    list.forEach(e => FUELS.push(e));
}

function applyPlanet(planet){
    if(planet == null) planet = currentPlanet();
    var classic = planet == Planets.serpulo;
    var items = [];
    if(!classic){
        try{ items = planetItems(planet); }catch(e){ logErr("planet items", e); items = []; }
    }
    PLANET_RECIPES.forEach(def => {
        var blk = def.block();
        if(blk == null) return;
        if(def.classic == null) def.classic = copyStacks(blk.requirements);
        var reqs = classic ? null : (typeof def.make === "function" ? def.make(items, planet) : recipeOf(def, items));
        if(reqs == null) reqs = copyStacks(def.classic);
        setRecipe(blk, reqs, def.buildTicks);
    });
    try{ rebuildFuels(planet, classic); }catch(e){ logErr("fuels", e); }
    var changed = recipePlanet != planet;
    recipePlanet = planet;
    if(changed && !classic){
        Log.info("[mb] planet " + planet.name + ": resources " + items.map(it => it.name).join(", "));
        PLANET_RECIPES.forEach(def => Log.info("[mb]   " + def.block().name + ": " + stacksText(def.block().requirements)));
    }
}

function openEverywhere(blk){
    if(blk == null) return;
    try{
        var planets = Vars.content.planets();
        for(var i = 0; i < planets.size; i++) blk.shownPlanets.add(planets.get(i));
    }catch(e){
        logErr("shown planets", e);
    }
    try{ blk.allDatabaseTabs = true; }catch(e){  }
    try{ blk.envEnabled = MetaPkg.Env.any; }catch(e){ logErr("environment", e); }
}

onEvent(ContentInitEvent, () => {
    PLANET_RECIPES.forEach(def => openEverywhere(def.block()));
    applyPlanet(currentPlanet());
});
onEvent(WorldLoadEvent, () => { applyPlanet(currentPlanet()); });
runEvent(Trigger.update, () => {
    if(++planetPoll < 30) return;
    planetPoll = 0;
    var p = currentPlanet();
    if(p != recipePlanet) applyPlanet(p);
});

function drawShipControl(b){
    var s = b.block.size * TS;
    Draw.rect(b.block.region, b.x, b.y, s, s);
}

var driverType = extend(UnitType, "driver", {
    draw(unit){  },
    getUnitStances(unit, out){
        var handled = false;
        try{
            handled = F.driverStances != null && F.driverStances(unit, out) === true;
        }catch(e){
            logErr("driver stances", e);
        }
        if(!handled) this.super$getUnitStances(unit, out);
    },
    allowCommand(unit, command){
        var r = null;
        try{
            r = F.driverAllowsCommand == null ? null : F.driverAllowsCommand(unit, command);
        }catch(e){
            logErr("driver command", e);
        }
        if(r === null || r === undefined) return this.super$allowCommand(unit, command);
        return r === true;
    }
});
driverType.constructor = prov(() => UnitEntity.create());
driverType.flying = true;
driverType.speed = 0;
driverType.accel = 0;
driverType.health = 1000000;
driverType.hitSize = 8;
driverType.hidden = true;
driverType.internal = false;
driverType.targetable = true;
driverType.hittable = false;
driverType.physics = false;
driverType.isEnemy = false;
driverType.useUnitCap = false;
driverType.allowedInPayloads = false;
driverType.bounded = false;
driverType.createWreck = false;
driverType.createScorch = false;
driverType.drawCell = false;
driverType.drawBody = false;
driverType.drawItems = false;
driverType.drawShields = false;
driverType.drawSoftShadow = false;
driverType.drawMinimap = false;
driverType.hoverable = false;
driverType.logicControllable = false;
driverType.canAttack = false;
driverType.itemCapacity = 0;
driverType.buildSpeed = 1;
driverType.envDisabled = 0;

F.rocketBooster = rocketBooster;
F.energyBooster = energyBooster;
F.fuelBooster = fuelBooster;
F.shipControl = shipControl;
F.landingSpot = landingSpot;
F.magnet = magnet;
F.superMagnet = superMagnet;
F.PLANET_RECIPES = PLANET_RECIPES;
F.stacksText = stacksText;
F.currentPlanet = currentPlanet;
F.planetItems = planetItems;
F.applyPlanet = applyPlanet;
F.driverType = driverType;
