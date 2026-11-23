'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var BASE_BOOSTER_POWER = F.BASE_BOOSTER_POWER;
var bundle = F.bundle, logErr = F.logErr, onEvent = F.onEvent, safe = F.safe;
var isBooster = F.isBooster;
var flyingMachines = F.flyingMachines, landedMachines = F.landedMachines, machineStats = F.machineStats;
var partAtWorld = F.partAtWorld;
var parkTarget = F.parkTarget, togglePark = F.togglePark;
var togglePossess = F.togglePossess;
var toggleBuild = F.toggleBuild;
var buildShipPickHud = F.buildShipPickHud;
var addPhoneButtons = F.addPhoneButtons, addTouchPad = F.addTouchPad, buildMoveOverlay = F.buildMoveOverlay, phoneButton = F.phoneButton;

onEvent(ClientLoadEvent, () => { buildShipPickHud(); });
onEvent(ClientLoadEvent, () => { if(Vars.mobile) buildMoveOverlay(); });

onEvent(ClientLoadEvent, () => {
    Vars.ui.settings.addCategory("mb", cons(t => {
        t.sliderPref("mb-booster-power", BASE_BOOSTER_POWER, 1, 180, 1, i => "" + i);
        t.checkPref("mb-autoturn", true);
        t.row();
        t.button(bundle("ycb.guide.title"), run(safe("guide settings button", () => { F.openGuide(); }))).height(48).width(260).pad(6);
        t.row();
    }));

    Vars.ui.hudGroup.fill(cons(root => {
        root.name = "mb-booster-hint";
        try{ root.touchable = Touchable.disabled; }catch(e){  }
        root.top();
        root.table(Styles.black6, cons(t => {
            t.margin(4);
            t.label(prov(() => bundle("mb.hud.noboosters"))).pad(2).update(cons(l => {
                l.color.set(Color.orange).lerp(Color.scarlet, Mathf.absin(Time.time, 2, 1));
            }));
        })).padTop(64).visible(boolp(() => needBoostersHint()));
    }));

    if(Vars.mobile) buildPhonePanel();

    var hoverTable = new Table();
    hoverTable.name = "mb-hover";
    hoverTable.background(Styles.black6);
    hoverTable.margin(6);
    hoverTable.touchable = Touchable.disabled;
    hoverTable.visibility = boolp(() => hoverShown);
    hoverTable.update(run(() => {
        try{ updateHover(hoverTable); }catch(e){ logErr("hover panel", e); }
    }));
    Vars.ui.hudGroup.addChild(hoverTable);
});

var hoverShown = false, hoverBuild = null;

function hoveredFlyingBooster(){
    if(Vars.mobile || Vars.player == null || !Vars.state.isGame() || Core.scene.hasMouse() || Core.scene.hasDialog()) return null;
    var wx = Core.input.mouseWorldX(), wy = Core.input.mouseWorldY();
    var team = Vars.player.team();
    var fl = flyingMachines();
    for(var i = 0; i < fl.length; i++){
        var m = fl[i];
        if(m.team.id != team.id || m.pocket == null) continue;
        var reach = m.radius + 8;
        if(Mathf.dst2(wx, wy, m.x, m.y) > reach * reach) continue;
        var p = partAtWorld(m, wx, wy);
        if(p != null && !p.dead && isBooster(p)) return p;
    }
    return null;
}

function updateHover(table){
    var want = hoveredFlyingBooster();
    if(want == null){
        hoverShown = false;
        hoverBuild = null;
        return;
    }
    if(hoverBuild == null || hoverBuild.id != want.id){
        hoverBuild = want;
        table.clearChildren();
        want.display(table);
        table.pack();
    }
    hoverShown = true;
    var v = Core.scene.screenToStageCoordinates(Tmp.v1.set(Core.input.mouseX(), Core.input.mouseY()));
    var w = table.getWidth(), h = table.getHeight();
    var x = Math.max(4, Math.min(v.x + 20, Core.graphics.getWidth() - w - 4));
    var y = Math.max(h + 4, Math.min(v.y - 20, Core.graphics.getHeight() - 4));
    table.setPosition(x, y, Align.topLeft);
}

var panelOpen = true;
try{ panelOpen = Core.settings.getBool("mb-panel-open", true); }catch(e){ panelOpen = true; }
function setPanelOpen(v){
    panelOpen = !!v;
    try{ Core.settings.put("mb-panel-open", panelOpen); }catch(e){  }
}

function buildPhonePanel(){
    Vars.ui.hudGroup.fill(cons(root => {
        root.name = "mb-hud";
        root.left();
        root.table(cons(col => {
            col.left().defaults().left().pad(2);
            col.button("", Styles.defaultt, safe("button panel", () => { setPanelOpen(!panelOpen); })).update(b => {
                b.setText(panelOpen ? "<" : ">");
            }).size(40, 38);
            col.row();
            col.table(Styles.black6, cons(c => {
                c.margin(4);
                c.defaults().pad(2).growX();
                phoneButton(c, Styles.defaultt, () => S.buildMode ? bundle("mb.btn.exitbuild") : bundle("mb.btn.build"), toggleBuild, "button build");
                c.row();
                phoneButton(c, Styles.defaultt, () => S.poss != null ? bundle("mb.btn.leave") : bundle("mb.btn.enter"), togglePossess, "button possess");
                c.row();
                phoneButton(c, Styles.defaultt, () => {
                    var pm = parkTarget();
                    return pm != null && pm.mode == "land" && pm.parked ? bundle("mb.btn.unpark") : bundle("mb.btn.park");
                }, togglePark, "button park");
                c.row();
                addPhoneButtons(c);
                c.row();
                addTouchPad(c);
            })).visible(boolp(() => panelOpen)).left();
        })).visible(boolp(() => Vars.state.isGame() && Vars.ui.hudfrag.shown));
    }));
}

var hintValue = false, hintStamp = -1000;
function needBoostersHint(){
    if(!Vars.state.isGame() || Vars.player == null) return false;
    var now = Time.globalTime;
    if(now - hintStamp < 8 && now >= hintStamp) return hintValue;
    hintStamp = now;
    hintValue = false;
    try{
        var team = Vars.player.team();
        if(S.buildMode){
            var landed = landedMachines();
            for(var i = 0; i < landed.length && !hintValue; i++){
                if(landed[i].team.id == team.id && machineStats(landed[i]).boosters == 0) hintValue = true;
            }
        }else if(S.poss != null && S.poss.m.mode == "fly" && S.poss.m.stats != null){
            hintValue = S.poss.m.stats.boosters == 0;
        }
    }catch(e){
        logErr("needBoostersHint", e);
    }
    return hintValue;
}
