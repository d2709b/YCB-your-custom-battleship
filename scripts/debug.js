'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var countKeys = F.countKeys;
var frontIndex = F.frontIndex, turnFront = F.turnFront;
var FUELS = F.FUELS, flightSpeed = F.flightSpeed;
var PLANET_RECIPES = F.PLANET_RECIPES, applyPlanet = F.applyPlanet, currentPlanet = F.currentPlanet,
    driverType = F.driverType, energyBooster = F.energyBooster, fuelBooster = F.fuelBooster,
    planetItems = F.planetItems, rocketBooster = F.rocketBooster, stacksText = F.stacksText;
var shipGoal = F.shipGoal, shipModuleList = F.shipModuleList, shipStock = F.shipStock;
var createMachine = F.createMachine, machineStats = F.machineStats;
var partAtWorld = F.partAtWorld, refreshOre = F.refreshOre, setAng = F.setAng;
var landMachine = F.landMachine, takeOff = F.takeOff;
var dustScale = F.dustScale, startLanding = F.startLanding, startLift = F.startLift;
var blastOf = F.blastOf, damagePart = F.damagePart, destroyMachine = F.destroyMachine,
    flyReconcile = F.flyReconcile, igniteCell = F.igniteCell, pocketCell = F.pocketCell,
    queueBlast = F.queueBlast;
var turnRate = F.turnRate;
var collideMachines = F.collideMachines, machineEnergy = F.machineEnergy, machineMass = F.machineMass,
    machineMomentum = F.machineMomentum;
var buildingsInRect = F.buildingsInRect, enterBuildMode = F.enterBuildMode, exitBuildMode = F.exitBuildMode,
    layerDirection = F.layerDirection, planMove = F.planMove, processDirty = F.processDirty,
    reconcile = F.reconcile, stepMachine = F.stepMachine, toggleLayer = F.toggleLayer,
    toggleLayerArea = F.toggleLayerArea;
var loadRegistry = F.loadRegistry, saveRegistry = F.saveRegistry;

var MB = {
    machines: () => S.machines,
    net: () => F.NET,
    F: F,
    state: () => S,
    create: b => { var m = createMachine(b); F.addEditor(Vars.player, m); return m; },
    takeOff: m => takeOff(m),
    land: m => landMachine(m),
    softLand: m => startLanding(m),
    softLift: m => startLift(m),
    air: m => m.air == null ? null : {kind: m.air.kind, t: m.air.t | 0, dur: m.air.dur | 0, alt: Math.round(m.air.alt * 100) / 100},
    dust: m => dustScale(m, m.parts.length > 0 ? m.parts.map(b => [b.tile.x, b.tile.y]) : [[0, 0]]),
    enterBuild: m => enterBuildMode(m),
    exitBuild: () => exitBuildMode(),
    toggleLayer: (b, player) => { toggleLayer(b, player === undefined ? Vars.player : player); },
    toggleLayerArea: (blds, dir, team, player) => { toggleLayerArea(blds, dir || layerDirection(blds, null, team), team, player); },
    buildingsInRect: (x0, y0, x1, y1, team) => buildingsInRect(x0, y0, x1, y1, team == undefined ? null : team),
    front: (m, f) => { if(f !== undefined){ m.front = f & 3; S.saveDirty = true; } return frontIndex(m); },
    turnFront: (m, steps) => turnFront(m, steps),
    step: (m, d) => stepMachine(m, d),
    plan: (m, dx, dy) => planMove(m, dx, dy),
    stats: m => machineStats(m),
    reconcile: (m, r) => reconcile(m, r),
    flyReconcile: m => flyReconcile(m),
    refreshOre: m => refreshOre(m),
    damagePart: (m, p, a) => damagePart(m, p, a),
    partAtWorld: (m, x, y) => partAtWorld(m, x, y),
    destroyMachine: m => destroyMachine(m),
    debris: () => S.debris,
    bonds: m => ({bonds: m.bonds, gid: m.gid}),
    detach: (m, list) => { F.detachParts(m, list || m.parts.filter(b => b !== m.hull)); F.partsChanged(m); },
    setAng: (m, a) => setAng(m, a),
    fire: p => { S.testFire = p; },
    possess: m => { if(m == null) F.endPossession(true); else F.startPossession(m); },
    input: v => { S.testInput = v; },
    save: () => saveRegistry(),
    load: () => loadRegistry(),
    rocketBooster: rocketBooster,
    energyBooster: energyBooster,
    fuelBooster: fuelBooster,
    speed: m => flightSpeed(m),
    turnRate: m => turnRate(flightSpeed(m), m),
    mass: m => machineMass(m),
    ignite: (m, x, y) => igniteCell(m, pocketCell(m, x, y), 1, true),
    fires: m => m.fireCount | 0,
    blastOf: b => blastOf(b),
    blast: (x, y, bl) => queueBlast(x, y, bl),
    energy: m => machineEnergy(m),
    momentum: m => machineMomentum(m),
    collide: () => collideMachines(),
    ship: m => ({modules: shipModuleList(m).map(e => ({k: e.mod.k, st: e.mod.st, current: e.mod === m.shipCur})), goal: shipGoal(m), key: m.shipGoal == null ? null : m.shipGoal.key, hold: m.restHold === true, pad: m.pad == null ? null : [m.pad.x, m.pad.y]}),
    stock: (m, r) => shipStock(m, r),
    boosterStates: () => S.bstates,
    driver: driverType,
    recipes: () => PLANET_RECIPES.map(def => def.block().name + ": " + stacksText(def.block().requirements)).join("\n"),
    planetItems: p => planetItems(p == null ? currentPlanet() : p).map(it => it.name),
    fuels: () => FUELS.map(f => f.item.name + " x" + f.mult).join(", "),
    applyPlanet: p => applyPlanet(p),
    buildMode: () => S.buildMode,
    tick: () => { processDirty(); },
    status: () => S.machines.map(m => "#" + m.id + " " + m.mode + " ang=" + (m.ang | 0) + " pos=" + (m.x | 0) + "," + (m.y | 0) + " cells=" + countKeys(m.cells) + " parts=" + m.parts.length + " pending=" + countKeys(m.pending) + " loose=" + countKeys(S.loose) + " " + JSON.stringify(machineStats(m))).join("\n")
};
try{
    Packages.rhino.ScriptableObject.putProperty(Vars.mods.scripts.scope, "MB", MB);
}catch(e){
    Log.err("[mb] debug api not exposed: " + e);
}
