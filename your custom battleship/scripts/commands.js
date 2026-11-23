'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var MOD = F.MOD, TS = F.TS;
var logErr = F.logErr;
var driverType = F.driverType;
var shipRefresh = F.shipRefresh, hasExtractor = F.hasExtractor, isDrillBlock = F.isDrillBlock, machineBlocks = F.machineBlocks,
    shipSourceMap = F.shipSourceMap;
var ensureBody = F.ensureBody;
var startLanding = F.startLanding, startLift = F.startLift;

var landCmd = null, takeoffCmd = null, mineCmd = null, ctrlOffStance = null;
try{
    landCmd = new UnitCommand("mb-land", MOD + "-cmd-land", null);
    takeoffCmd = new UnitCommand("mb-takeoff", MOD + "-cmd-takeoff", null);
}catch(e){
    Log.err("[mb] land / take off commands not created: " + e);
}

var StanceType = null, ItemStanceType = null;
try{
    StanceType = Packages.mindustry.ai.UnitStance;
    if(typeof StanceType !== "function" || StanceType.stop == null || StanceType.mineAuto == null) StanceType = null;
    ItemStanceType = Packages.mindustry.ai.ItemUnitStance;
    if(typeof ItemStanceType !== "function") ItemStanceType = null;
}catch(e){
    StanceType = null;
    ItemStanceType = null;
}
try{
    mineCmd = new UnitCommand("mb-mine", "production", null);
}catch(e){
    mineCmd = null;
    Log.err("[mb] mine command not created: " + e);
}
try{
    if(StanceType != null) ctrlOffStance = new StanceType("mb-ctrloff", MOD + "-stance-ctrloff", null);
}catch(e){
    ctrlOffStance = null;
    Log.err("[mb] stance 'disable the control block' not created (this game version has no stances?): " + e);
}

function bodyAI(d){
    try{ return d != null && d.isValid() && d.isCommandable() ? d.command() : null; }catch(e){ return null; }
}

var setCommandMethod = null;
try{
    setCommandMethod = java.lang.Class.forName("mindustry.ai.types.CommandAI").getMethod("command", java.lang.Class.forName("mindustry.ai.UnitCommand"));
}catch(e){
    setCommandMethod = null;
}

function setUnitCommand(d, cmd){
    var ai = bodyAI(d);
    if(ai == null) return;
    try{
        if(setCommandMethod != null) setCommandMethod.invoke(ai, cmd);
        else ai.command = cmd;
    }catch(e){ logErr("set command", e); }
}

var cmdIconsDone = false;
var CMD_ICON_SCALE = 0.5;
function registerCommandIcons(){
    if(cmdIconsDone) return;
    cmdIconsDone = true;
    if(Vars.headless) return;
    try{
        var pics = [landCmd, takeoffCmd];
        if(ctrlOffStance != null) pics.push(ctrlOffStance);
        pics.forEach(c => {
            if(c == null) return;
            var region = new Packages.arc.graphics.g2d.TextureRegion(Core.atlas.find(c.icon));
            region.width = Math.max(1, Math.round(region.width * CMD_ICON_SCALE));
            region.height = Math.max(1, Math.round(region.height * CMD_ICON_SCALE));
            var dr = new Packages.arc.scene.style.TextureRegionDrawable(region);
            Icon.icons.put(c.icon, dr);
            var name = c.localized();
            if(name.indexOf("???") >= 0) Log.warn("[mb] no name in the bundle for the order " + c.name + " (got " + name + ")");
        });
        if(mineCmd != null && mineCmd.localized().indexOf("???") >= 0) Log.warn("[mb] no name in the bundle for the order " + mineCmd.name);
    }catch(e){ logErr("command icons", e); }
}

function syncCtrlOff(m, ai){
    if(ctrlOffStance == null) return;
    var d = m.body, id = d == null ? -1 : d.id;
    var has = ai.hasStance(ctrlOffStance);
    if(m.ctrlOffBody !== id){
        m.ctrlOffBody = id;
        if(m.ctrlOff === true && !has) ai.setStance(ctrlOffStance, true);
        return;
    }
    if(has !== (m.ctrlOff === true)){
        m.ctrlOff = has;
        S.saveDirty = true;
        m.shipTimer = 0;
        F.ctrlOffNow(m);
    }
}

function readMineOrder(m, ai, cmd){
    if(mineCmd == null || StanceType == null || cmd !== mineCmd){
        m.rtsMine = null;
        m.mineLift = false;
        return;
    }
    var items = [];
    if(ItemStanceType != null){
        var all = ItemStanceType.all();
        for(var i = 0; i < all.size; i++){
            var st = all.get(i);
            if(ai.hasStance(st)) items.push(st.item);
        }
    }
    var auto = ai.hasStance(StanceType.mineAuto);
    if(!auto && items.length == 0){
        ai.setStance(StanceType.mineAuto, true);
        auto = true;
    }
    m.rtsMine = {auto: auto, items: items};
    if(m.mode == "land" && !F.isEdited(m) && m.mineLift !== true){
        m.mineLift = true;
        if(startLift(m)) shipRefresh(m);
    }
}

var ORDER_EVERY = 3;
// Handles the RTS Land and Take off orders (each machine every third tick).
function processOrders(){
    registerCommandIcons();
    var phase = Math.floor(Time.globalTime);
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if((phase + m.id) % ORDER_EVERY != 0) continue;
        if(m.mode == "land") ensureBody(m);
        var d = m.body;
        if(d == null || !d.isValid() || F.isDriven(m)){ m.rtsMine = null; continue; }
        var ai = bodyAI(d);
        if(ai == null){ m.rtsMine = null; continue; }
        if(m.mode == "land" && !F.isEdited(m)){
            var og = null;
            try{ og = commandGoal(m, ai); }catch(e){ og = null; }
            var okey = og == null ? "" : Math.round(og.x) + "," + Math.round(og.y);
            if(m.orderSeen === undefined){
                m.orderSeen = okey;
            }else if(okey !== m.orderSeen){
                m.orderSeen = okey;
                if(okey !== "" && startLift(m)) shipRefresh(m);
            }
        }
        var cmd = ai.currentCommand();
        try{ syncCtrlOff(m, ai); }catch(e){ logErr("ctrl off stance", e); }
        try{ readMineOrder(m, ai, cmd); }catch(e){ logErr("mine order", e); m.rtsMine = null; }
        if(cmd == null || cmd === UnitCommand.moveCommand) continue;
        if(landCmd != null && cmd === landCmd){
            setUnitCommand(d, UnitCommand.moveCommand);
            if(m.mode == "fly" && !F.isEdited(m)) startLanding(m);
        }else if(takeoffCmd != null && cmd === takeoffCmd){
            setUnitCommand(d, UnitCommand.moveCommand);
            if(m.mode == "land"){
                if(startLift(m)) shipRefresh(m);
            }
        }
    }
}
try{
    var driverCommands = new Seq();
    driverCommands.add(UnitCommand.moveCommand);
    if(landCmd != null) driverCommands.add(landCmd);
    if(takeoffCmd != null) driverCommands.add(takeoffCmd);
    if(mineCmd != null) driverCommands.add(mineCmd);
    driverType.commands = driverCommands;
    if(ctrlOffStance != null){
        var driverStances = new Seq();
        driverStances.add(StanceType.stop);
        driverStances.add(ctrlOffStance);
        driverType.stances = driverStances;
    }
}catch(e){
    Log.err("[mb] driver commands not restricted: " + e);
}

var CommandAIClass = null;
try{ CommandAIClass = Packages.mindustry.ai.types.CommandAI; }catch(e){ CommandAIClass = null; }

function commandAI(m){
    var d = m.body;
    if(d == null) return null;
    try{
        if(!d.isValid()) return null;
        var c = d.controller();
        if(c == null) return null;
        if(CommandAIClass != null) return (c instanceof CommandAIClass) ? c : null;
        return c.targetPos !== undefined ? c : null;
    }catch(e){
        logErr("commandAI", e);
        return null;
    }
}

function engageDistance(m, target){
    var r = 0;
    for(var i = 0; i < m.turrets.length; i++){
        var t = m.turrets[i];
        if(t.dead || !t.hasAmmo()) continue;
        var tr = t.range();
        if(r == 0 || tr < r) r = tr;
    }
    var size = 0;
    try{ if(target instanceof Unit) size = target.hitSize / 2; else if(target instanceof Building) size = target.block.size * TS / 2; }catch(e){  }
    if(r > 0) return Math.max(m.radius * 0.5, r * 0.8 - size * 0.5);
    return m.radius + size + 8;
}

function commandGoal(m, ai){
    var at = null;
    try{ at = ai.attackTarget; }catch(e){ at = null; }
    if(at != null){
        try{
            if(at.isValid && !at.isValid()) at = null;
        }catch(e2){ at = null; }
    }
    if(at != null){
        return {x: at.getX(), y: at.getY(), stop: engageDistance(m, at), target: at};
    }
    var tp = ai.targetPos;
    if(tp == null) return null;
    var x = tp.x, y = tp.y;
    try{
        var g = ai.group;
        if(g !== undefined && g != null && g.valid && g.positions != null && ai.groupIndex >= 0 && ai.groupIndex * 2 + 1 < g.positions.length){
            x += g.positions[ai.groupIndex * 2];
            y += g.positions[ai.groupIndex * 2 + 1];
        }
    }catch(e3){  }
    return {x: x, y: y, stop: 0, target: null};
}

function machineOfBody(u){
    if(u == null) return null;
    for(var i = 0; i < S.machines.length; i++){
        var b = S.machines[i].body;
        if(b != null && b.id == u.id) return S.machines[i];
    }
    return null;
}

function hasDrill(m){
    var blds = machineBlocks(m);
    for(var i = 0; i < blds.length; i++){
        var b = blds[i];
        if(!b.dead && isDrillBlock(b.block) && !F.isConstructing(b)) return true;
    }
    return false;
}

function mineItemsOf(m){
    var c = m.mineItemsCache;
    if(c !== undefined && c.ver === S.layoutVersion && Time.globalTime - c.at < 60 && c.at <= Time.globalTime) return c.list;
    var list = [];
    try{
        var blds = machineBlocks(m), items = shipSourceMap().items;
        for(var i = 0; i < items.length; i++){
            if(hasExtractor(blds, items[i])) list.push(items[i]);
        }
    }catch(e){
        logErr("mine items", e);
    }
    m.mineItemsCache = {ver: S.layoutVersion, at: Time.globalTime, list: list};
    return list;
}

function driverStances(unit, out){
    if(mineCmd == null || StanceType == null || ctrlOffStance == null) return false;
    var ai = bodyAI(unit);
    if(ai == null || ai.currentCommand() !== mineCmd) return false;
    out.add(StanceType.mineAuto);
    var m = machineOfBody(unit);
    if(m != null && ItemStanceType != null){
        var list = mineItemsOf(m);
        for(var i = 0; i < list.length; i++){
            var st = ItemStanceType.getByItem(list[i]);
            if(st != null) out.add(st);
        }
    }
    out.add(ctrlOffStance);
    return true;
}

function driverAllowsCommand(unit, command){
    if(mineCmd != null && command === mineCmd){
        var m = machineOfBody(unit);
        return m != null && hasDrill(m);
    }
    return null;
}

F.mineCmd = mineCmd;
F.ctrlOffStance = ctrlOffStance;
F.machineOfBody = machineOfBody;
F.driverStances = driverStances;
F.driverAllowsCommand = driverAllowsCommand;
F.processOrders = processOrders;
F.registerCommandIcons = registerCommandIcons;
F.commandAI = commandAI;
F.commandGoal = commandGoal;
