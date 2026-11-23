'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var logErr = F.logErr, runEvent = F.runEvent;
var enforceRules = F.enforceRules, shipTick = F.shipTick;
var flyingMachines = F.flyingMachines, keepBody = F.keepBody, restoreBodies = F.restoreBodies;
var inheritMachineVelocity = F.inheritMachineVelocity, scanBullets = F.scanBullets;
var processOrders = F.processOrders;
var adoptPlayerUnit = F.adoptPlayerUnit, checkPossession = F.checkPossession, driveLanded = F.driveLanded;
var airTick = F.airTick;
var debrisTick = F.debrisTick;
var procTick = F.procTick;
var magnetCouple = F.magnetCouple, magnetPass = F.magnetPass;
var flyLogic = F.flyLogic, flyStep = F.flyStep;
var collideMachines = F.collideMachines;
var processDirty = F.processDirty, rotateFrontKey = F.rotateFrontKey, startLayerDrag = F.startLayerDrag,
    toggleBuild = F.toggleBuild, updateLayerDrag = F.updateLayerDrag;
var trackSchematic = F.trackSchematic;
var saveRegistry = F.saveRegistry;
var netClientTick = F.netClientTick, netServerTick = F.netServerTick;

// Per-tick order: input and orders, magnets, flight, collisions, block logic, network, falling debris.
runEvent(Trigger.update, () => {
    restoreBodies();
    if(!Vars.state.isGame()) return;
    if(Vars.net.client()){
        if(!Vars.state.isPaused()){
            var ctyping = Core.scene.hasKeyboard() || Core.scene.hasDialog();
            var ckeys = !ctyping && !Vars.control.input.commandMode;
            if(ckeys){
                if(Core.input.keyTap(KeyCode.g)) toggleBuild();
                else if(Core.input.keyTap(KeyCode.y)){
                    if(S.buildMode) startLayerDrag();
                    else F.yOutside();
                }
                else if(S.buildMode && Core.input.keyTap(KeyCode.r)) rotateFrontKey();
            }
            updateLayerDrag(!ckeys);
            try{ trackSchematic(); }catch(e){ logErr("trackSchematic", e); }
            try{ adoptPlayerUnit(); }catch(e){ logErr("adoptPlayerUnit", e); }
            try{ F.registerCommandIcons(); }catch(e){ logErr("command icons", e); }
            try{ netClientTick(Time.delta); }catch(e){ logErr("client tick", e); }
        }else if(S.layerDrag != null){
            S.layerDrag = null;
        }
        S.padX = 0; S.padY = 0;
        if(!S.buildMode) S.moveMode = false;
        return;
    }
    if(S.netWorld === true) return;
    if(!Vars.headless && !Vars.state.isPaused()){
        var typing = Core.scene.hasKeyboard() || Core.scene.hasDialog();
        var keysFree = !typing && !Vars.control.input.commandMode;
        if(keysFree){
            if(Core.input.keyTap(KeyCode.g)) toggleBuild();
            else if(Core.input.keyTap(KeyCode.y)){
                if(S.buildMode) startLayerDrag();
                else F.yOutside();
            }
            else if(S.buildMode && Core.input.keyTap(KeyCode.r)) rotateFrontKey();
        }
        updateLayerDrag(!keysFree);
        try{ trackSchematic(); }catch(e){ logErr("trackSchematic", e); }
    }else if(S.layerDrag != null){
        S.layerDrag = null;
    }
    if(!Vars.state.isPaused()){
        try{ adoptPlayerUnit(); }catch(e){ logErr("adoptPlayerUnit", e); }
        try{ F.netSyncDrivers(); }catch(e){ logErr("remote drivers", e); }
        checkPossession();
        try{ processOrders(); }catch(e){ logErr("processOrders", e); }
        F.allDrivers().forEach(d => { if(d.m.mode == "land") driveLanded(d.m, Time.delta); });
        try{ S.machines.slice().forEach(m => { if(m.mode == "land" && m.pad != null) shipTick(m, Time.delta); }); }catch(e){ logErr("ship tick", e); }
        try{ S.machines.slice().forEach(m => { if(m.mode == "land") enforceRules(m, Time.delta); }); }catch(e){ logErr("rules of landed machines", e); }
        try{ magnetPass(Time.delta); }catch(e){ logErr("magnetPass", e); }
        var fl = flyingMachines();
        fl.forEach(m => { if(S.machines.indexOf(m) >= 0) flyStep(m, Time.delta); });
        try{ collideMachines(); }catch(e){ logErr("collideMachines", e); }
        fl.forEach(m => { if(S.machines.indexOf(m) >= 0) flyLogic(m, Time.delta); });
        try{ procTick(Time.delta); }catch(e){ logErr("procTick", e); }
        try{ magnetCouple(); }catch(e){ logErr("magnetCouple", e); }
        try{ netServerTick(Time.delta); }catch(e){ logErr("net tick", e); }
        try{ airTick(Time.delta); }catch(e){ logErr("airTick", e); }
        try{ debrisTick(Time.delta); }catch(e){ logErr("debrisTick", e); }
        inheritMachineVelocity();
        scanBullets();
    }
    S.padX = 0; S.padY = 0;
    if(!S.buildMode) S.moveMode = false;
    processDirty();
    if(S.saveDirty) saveRegistry();
});

runEvent(Trigger.afterGameUpdate, () => {
    var phase = Math.floor(Time.globalTime), client = Vars.net.client();
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.mode == "land" && (phase + m.id) % 3 != 0) continue;
        if(m.body != null || client) keepBody(m);
    }
    if(Vars.state.isGame() && !Vars.state.isPaused() && !Vars.net.client()) inheritMachineVelocity();
});
