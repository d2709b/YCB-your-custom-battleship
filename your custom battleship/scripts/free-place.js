'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var TS = F.TS;
var logErr = F.logErr, onEvent = F.onEvent, say = F.say;
var isConstructing = F.isConstructing;

var TERRAIN_CLASSES = [];
[() => Drill, () => BeamDrill, () => WallCrafter, () => Pump, () => ThermalGenerator, () => AttributeCrafter].forEach(get => {
    try{ TERRAIN_CLASSES.push(get()); }catch(e){ logErr("terrain class", e); }
});
var surrogates = {};

function isTerrainBlock(block){
    if(block == null) return false;
    for(var i = 0; i < TERRAIN_CLASSES.length; i++){
        if(block instanceof TERRAIN_CLASSES[i]) return true;
    }
    return false;
}

function surrogateFor(size){
    if(surrogates[size] !== undefined) return surrogates[size];
    var pref = [Blocks.copperWall, Blocks.copperWallLarge, Blocks.vault, Blocks.spectre, Blocks.meltdown];
    var pick = null;
    for(var i = 0; i < pref.length && pick == null; i++){
        if(pref[i] != null && pref[i].size == size) pick = pref[i];
    }
    surrogates[size] = pick;
    return pick;
}

function freePlaceOk(block, x, y, rot, player){
    if(player === undefined) player = Vars.player;
    if(player == null) return false;
    var editing = player === Vars.player ? S.buildMode : F.isEditingPlayer(player);
    if(!editing || !isTerrainBlock(block)) return false;
    var team = player.team();
    var tile = Vars.world.tile(x, y);
    if(tile == null) return false;
    if(Build.validPlace(block, team, x, y, rot)) return false;
    if(block.canPlaceOn(tile, team, rot)) return false;
    if(!(block.isPlaceable() && block.environmentBuildable()) || block.isOverPlacementLimit(team)) return false;
    var sur = surrogateFor(block.size);
    return sur != null && Build.validPlace(sur, team, x, y, rot, false);
}

function hasStartResources(block, team){
    var rules = Vars.state.rules;
    if(rules.infiniteResources || team.rules().infiniteResources) return true;
    var core = team.core();
    if(core == null) return false;
    var reqs = block.requirements;
    for(var i = 0; i < reqs.length; i++){
        if(!core.items.has(reqs[i].item, Math.min(Math.round(reqs[i].amount * rules.buildCostMultiplier), 1))) return false;
    }
    return true;
}

function placeOrigin(block){
    return [Math.round((Core.input.mouseWorldX() - block.offset) / TS), Math.round((Core.input.mouseWorldY() - block.offset) / TS)];
}

function beginFreePlace(block, x, y, rot, config, player){
    if(player === undefined || player === null) player = Vars.player;
    var team = player.team(), unit = player.unit();
    var tile = Vars.world.tile(x, y);
    if(tile == null) return false;
    tile.getLinkedTilesAs(block, cons(t => {
        if(t.block() != Blocks.air && t.block().alwaysReplace) t.remove();
    }));
    var previous = tile.block();
    var sub = ConstructBlock.get(block.size);
    block.beforePlaceBegan(tile, previous);
    tile.setBlock(sub, team, rot);
    var site = tile.build;
    if(site == null || !isConstructing(site)) return false;
    site.setConstruct(previous.size == sub.size ? previous : Blocks.air, block);
    site.prevBuild = new Seq();
    Events.fire(new BlockBuildBeginEvent(tile, team, unit, false));
    block.placeBegan(tile, previous, unit);
    if(unit != null && unit.canBuild()){
        var plan = new BuildPlan(x, y, rot, block);
        if(config !== undefined && config !== null) plan.config = config;
        unit.addBuild(plan);
    }
    return true;
}

var schemSnapshot = [];

function planList(seq){
    var out = [];
    for(var i = 0; i < seq.size; i++) out.push(seq.get(i));
    return out;
}

function freePlacePlans(plans){
    var team = Vars.player.team(), started = 0, noRes = false;
    for(var i = 0; i < plans.length; i++){
        var pl = plans[i];
        if(pl.breaking || pl.block == null || !isTerrainBlock(pl.block)) continue;
        if(!freePlaceOk(pl.block, pl.x, pl.y, pl.rotation)) continue;
        if(!hasStartResources(pl.block, team)){ noRes = true; continue; }
        if(Vars.net.client()){
            var cfg = typeof pl.config === "number" ? pl.config : null;
            F.netRequest({t: "free", b: pl.block.id, x: pl.x, y: pl.y, r: pl.rotation, c: cfg});
            started++;
        }else if(beginFreePlace(pl.block, pl.x, pl.y, pl.rotation, pl.config)) started++;
    }
    if(noRes) say("mb.msg.freeres");
    return started;
}

function trackSchematic(){
    var input = Vars.control.input;
    if(!S.buildMode || Vars.player == null || Vars.player.dead() || input == null){
        schemSnapshot = [];
        return;
    }
    var plans = input.selectPlans;
    if(!Vars.mobile){
        if(plans.size > 0 && Core.input.keyTap(Binding.select) && !Core.scene.hasMouse() && !Core.input.keyDown(Binding.breakBlock)){
            freePlacePlans(planList(plans));
        }
        return;
    }
    if(plans.size > 0){
        schemSnapshot = planList(plans);
        return;
    }
    if(schemSnapshot.length == 0) return;
    var snap = schemSnapshot;
    schemSnapshot = [];
    var rem = input.removals;
    if(rem === undefined || rem === null) return;
    var confirmed = false;
    for(var i = 0; i < snap.length && !confirmed; i++){
        if(!snap[i].breaking && rem.contains(snap[i], true)) confirmed = true;
    }
    if(confirmed) freePlacePlans(snap);
}

onEvent(TapEvent, e => {
    if(Vars.headless || !S.buildMode || e.player != Vars.player || S.shipPick != null) return;
    var input = Vars.control.input;
    var block = input.block;
    if(block == null || input.commandMode || !isTerrainBlock(block)) return;
    var x, y;
    if(Vars.mobile){
        x = e.tile.x; y = e.tile.y;
    }else{
        var o = placeOrigin(block);
        x = o[0]; y = o[1];
    }
    var rot = input.rotation;
    if(!freePlaceOk(block, x, y, rot)) return;
    if(!hasStartResources(block, Vars.player.team())){ say("mb.msg.freeres"); return; }
    if(Vars.net.client()) F.netRequest({t: "free", b: block.id, x: x, y: y, r: rot, c: null});
    else beginFreePlace(block, x, y, rot);
});

S.netHandlers.free = function(player, msg){
    var block = Vars.content.block(msg.b);
    if(block == null || !freePlaceOk(block, msg.x, msg.y, msg.r, player)) return;
    if(!hasStartResources(block, player.team())){ F.tell(player, "mb.msg.freeres"); return; }
    beginFreePlace(block, msg.x, msg.y, msg.r, msg.c === null || msg.c === undefined ? undefined : msg.c, player);
};

F.isTerrainBlock = isTerrainBlock;
F.freePlaceOk = freePlaceOk;
F.placeOrigin = placeOrigin;
F.trackSchematic = trackSchematic;
