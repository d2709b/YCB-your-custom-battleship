'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var bundle = F.bundle, onEvent = F.onEvent, say = F.say;
var isConstructing = F.isConstructing;
var landingSpot = F.landingSpot;
var SHIP_DEFAULT_PCT = F.SHIP_DEFAULT_PCT, clampPct = F.clampPct, hasExtractor = F.hasExtractor,
    hasTanks = F.hasTanks, isDrillBlock = F.isDrillBlock, isExtractorBlock = F.isExtractorBlock,
    isLiquidRes = F.isLiquidRes, isPumpBlock = F.isPumpBlock, isShipControl = F.isShipControl,
    machineBlocks = F.machineBlocks, modLand = F.modLand, modRest = F.modRest, modRes = F.modRes, clampSec = F.clampSec,
    modRule = F.modRule, modPreload = F.modPreload, modJoin = F.modJoin, modCraftJoin = F.modCraftJoin, modProc = F.modProc,
    PROC_WHEN = F.PROC_WHEN, PROC_ACT = F.PROC_ACT, wholeDeg = F.wholeDeg, isProcessor = F.isProcessor, modLiqLoad = F.modLiqLoad, clampAmount = F.clampAmount, PRELOAD_DEFAULT = F.PRELOAD_DEFAULT,
    modCenter = F.modCenter, CENTER_MODES = F.CENTER_MODES, centerState = F.centerState, centerBlockAt = F.centerBlockAt, hullsOf = F.hullsOf, isHull = F.isHull,
    ruleChanged = F.ruleChanged, shipChanged = F.shipChanged, ruleState = F.ruleState, ruleTarget = F.ruleTarget,
    shipMachineOf = F.shipMachineOf, shipModsOf = F.shipModsOf, shipSourceMap = F.shipSourceMap,
    stockOf = F.stockOf;
var machineOfBuild = F.machineOfBuild;
var partAtWorld = F.partAtWorld;

var MOD_RED = "ff6060", MOD_BLUE = "5aa0ff", MOD_ORANGE = "ffa040", MOD_PURPLE = "b280ff", MOD_GREEN = "5fe070", MOD_TEAL = "40d8d0";
var MOD_COLOR = {res: MOD_RED, land: MOD_RED, join: MOD_RED, rest: MOD_BLUE, preload: MOD_ORANGE, liqload: MOD_ORANGE, craftjoin: MOD_ORANGE,
    rule: MOD_PURPLE, proc: MOD_GREEN, center: MOD_TEAL};
function modColor(k){ return Color.valueOf(MOD_COLOR[k] || "ffffff"); }

function compact(){
    var h = 0;
    try{ h = F.uiHeight(); }catch(e){ h = 0; }
    return screenWidth() < COMPACT_W || (h > 0 && h < COMPACT_H);
}
var COMPACT_W = 720, COMPACT_H = 520, COMPACT_SIDE = 8;

function newDialog(title){
    var style = null;
    try{ style = Styles.fullDialog; }catch(e){ style = null; }
    var d = style != null ? new Packages.mindustry.ui.dialogs.BaseDialog(title, style) : new Packages.mindustry.ui.dialogs.BaseDialog(title);
    if(compact()){
        d.cont.margin(2, COMPACT_SIDE, 2, COMPACT_SIDE);
    }else{
        var side = Math.floor(screenWidth() * SIDE_MARGIN);
        d.cont.margin(8, side, 8, side);
    }
    return d;
}

function addBack(d){
    if(!compact()){ d.addCloseButton(); return; }
    d.buttons.button(Core.bundle.get("back"), Icon.left, run(() => d.hide())).size(150, 44);
    d.closeOnBack();
}

var SIDE_MARGIN = 0.2;

function screenWidth(){
    var w = 0;
    try{ w = F.uiWidth(); }catch(e){ w = 0; }
    if(!(w > 0)) w = Core.graphics.getWidth();
    return w;
}

function shipPanelWidth(){
    if(compact()) return Math.max(240, Math.floor(screenWidth()) - 2 * COMPACT_SIDE - 16);
    return Math.max(240, Math.floor(screenWidth() * (1 - 2 * SIDE_MARGIN)) - 16);
}

function buildShipButton(b, table){
    table.margin(4);
    table.button(Icon.pencil, Styles.cleari, run(() => openShipDialog(b))).size(40);
}

function openShipDialog(b){
    if(Vars.headless || !isShipControl(b) || b.dead) return;
    if(Vars.net.client()){ say("mb.msg.mp"); return; }
    var d = newDialog(bundle("mb.ship.title"));
    if(compact()) d.buttons.button(bundle("mb.ship.addmod"), Icon.add, run(() => openModulePicker(d, b))).size(190, 44).color(Color.valueOf(MOD_GREEN));
    addBack(d);
    S.shipDialog = d;
    fillShipDialog(d, b);
    d.show();
}

function fillShipDialog(d, b){
    var W = shipPanelWidth(), small = compact();
    var inShip = shipMachineOf(b) != null;
    var hint = inShip ? bundle("mb.ship.hint") : bundle("mb.ship.nomach");
    d.cont.clear();
    if(!small || !inShip) d.cont.add(hint).width(W).wrap().left().padBottom(small ? 2 : 6).row();
    d.cont.pane(Styles.noBarPane, cons(list => {
        list.top().left();
        if(shipModsOf(b).length == 0) list.add(bundle(small ? "mb.ship.empty.small" : "mb.ship.empty")).wrap().width(W - 30).pad(3).row();
        shipModsOf(b).forEach((mod, i) => shipModCard(list, d, b, i, W - 16));
        if(small && inShip) list.add(hint).wrap().width(W - 16).left().pad(3).padTop(8).row();
    })).grow().row();
    if(!small) addModuleGrid(d, b, W);
}

function moduleAdders(d, b){
    var add = mod => {
        shipModsOf(b).push(mod);
        if(mod.k == "rule") ruleChanged(b); else shipChanged(b);
        fillShipDialog(d, b);
    };
    return [
        ["mb.ship.add.res", "res", () => openResPicker(b, false, res => add(modRes(res)))],
        ["mb.ship.add.land", "land", () => add(modLand())],
        ["mb.ship.add.join", "join", () => add(modJoin())],
        ["mb.ship.add.rest", "rest", () => add(modRest())],
        ["mb.ship.add.pre", "preload", () => add(modPreload())],
        ["mb.ship.add.liq", "liqload", () => openLoadPicker(true, [], res => add(modLiqLoad(res)))],
        ["mb.ship.add.craftjoin", "craftjoin", () => add(modCraftJoin())],
        ["mb.ship.add.rule", "rule", () => add(modRule())],
        ["mb.ship.add.proc", "proc", () => add(modProc())],
        ["mb.ship.add.center", "center", () => add(modCenter())]
    ];
}

function addModuleGrid(d, b, W){
    var perRow = W >= 800 ? 3 : 2, n = 0;
    d.cont.table(cons(row => {
        moduleAdders(d, b).forEach(a => {
            row.button(bundle(a[0]), run(a[2])).height(44).growX().uniformX().color(modColor(a[1]));
            if(++n % perRow == 0) row.row();
        });
    })).width(W).padTop(6);
}

function openModulePicker(d, b){
    var p = newDialog(bundle("mb.ship.addmod.title"));
    addBack(p);
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top();
        moduleAdders(d, b).forEach(a => {
            t.button(bundle(a[0]), run(() => {
                p.hide();
                a[2]();
            })).growX().height(40).pad(2).color(modColor(a[1])).row();
        });
    })).grow();
    p.show();
}

function shipModCard(list, d, b, i, W){
    var mod = shipModsOf(b)[i];
    var narrow = W < 560;
    list.table(Styles.black6, cons(c => {
        c.margin(6).left();
        var col = modColor(mod.k);
        var title = "#" + (i + 1) + "  " + bundle(modTitleKey(mod.k));
        var state = prov(() => bundle("mb.ship.st." + modStateKey(b, mod)));
        c.table(cons(h => {
            h.left();
            if(narrow){
                h.table(cons(tt => {
                    tt.left();
                    tt.add(title).left().color(col).row();
                    tt.label(state).left().wrap().width(Math.max(120, W - 160));
                })).left().growX();
            }else{
                h.add(title).left().growX().color(col);
                h.label(state).padLeft(6).wrap().width(Math.floor(W * 0.4)).get().setAlignment(Align.right);
            }
            h.button(Icon.upOpen, Styles.clearNonei, run(() => moveShipMod(d, b, i, -1))).size(36);
            h.button(Icon.downOpen, Styles.clearNonei, run(() => moveShipMod(d, b, i, 1))).size(36);
            h.button(Icon.trash, Styles.clearNonei, run(() => {
                var gone = shipModsOf(b).splice(i, 1)[0];
                shipChanged(b);
                if(gone != null && gone.k == "rule") ruleChanged(b);
                fillShipDialog(d, b);
            })).size(36);
        })).growX().left().row();
        c.image().color(col).height(2).growX().padBottom(4).row();
        if(mod.k == "res") resBody(c, d, b, mod, W);
        else if(mod.k == "join") joinBody(c, d, b, mod, W);
        else if(mod.k == "craftjoin") craftJoinBody(c, d, b, mod, W);
        else if(mod.k == "proc") procBody(c, d, b, mod, W);
        else if(mod.k == "rest") restBody(c, d, b, mod, W);
        else if(mod.k == "rule") ruleBody(c, d, b, mod, W);
        else if(mod.k == "center") centerBody(c, d, b, mod, W);
        else if(mod.k == "preload") preloadBody(c, d, b, mod, W);
        else if(mod.k == "liqload") liqLoadBody(c, d, b, mod, W);
        else landBody(c, d, b, mod, W);
    })).width(W).pad(3).row();
}

function modTitleKey(k){
    if(k == "join") return "mb.ship.mod.join";
    if(k == "craftjoin") return "mb.ship.mod.craftjoin";
    if(k == "proc") return "mb.ship.mod.proc";
    if(k == "center") return "mb.ship.mod.center";
    return k == "res" ? "mb.ship.mod.res" : (k == "rest" ? "mb.ship.mod.rest" : (k == "rule" ? "mb.ship.mod.rule" :
        (k == "preload" ? "mb.ship.mod.pre" : (k == "liqload" ? "mb.ship.mod.liq" : "mb.ship.mod.land"))));
}

function modStateKey(b, mod){
    if(mod.k == "rule") return ruleState(b, mod);
    if(mod.k == "center") return centerState(b, mod);
    if(mod.k == "preload") return mod.list.length == 0 ? "ruleempty" : "preon";
    if(mod.k == "liqload") return "liqon";
    if(mod.k == "craftjoin") return "craftjoinon";
    if(mod.k == "proc") return mod.list.length == 0 ? "procempty" : "procon";
    return mod.st || "unset";
}

function angField(r, value, onChange){
    var f = null;
    f = r.field("" + value, cons(s => {
        var v = parseInt(s, 10);
        if(isNaN(v)) return;
        var n = wholeDeg(v);
        onChange(n);
        if(n != v && f != null) f.setText("" + n);
    })).width(90).get();
    r.add("\u00b0").padLeft(4);
}

function joinBody(c, d, b, mod, W){
    c.table(cons(r => {
        r.left();
        r.add(mod.pt == null ? bundle("mb.ship.place.none") : bundle("mb.ship.xy", mod.pt[0], mod.pt[1])).left().growX();
        r.button(bundle("mb.ship.join.pick"), run(() => startShipPick(b, d, mod, "joinpt"))).height(34).padLeft(6);
    })).growX().left().row();
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.join.ang")).padRight(6);
        angField(r, mod.ang, n => { mod.ang = n; shipChanged(b); });
    })).left().row();
    c.add(bundle("mb.ship.join.hint")).wrap().width(W - 20).left().row();
}

function craftJoinBody(c, d, b, mod, W){
    c.add(bundle("mb.ship.craftjoin.hint")).wrap().width(W - 20).left().row();
}

function procsOfShip(b){
    var m = shipMachineOf(b);
    var out = m == null ? [] : machineBlocks(m).filter(x => !x.dead && isProcessor(x));
    out.sort((p, q) => (q.tile.y - p.tile.y) || (p.tile.x - q.tile.x));
    return out;
}
function procAt(b, p){
    var list = procsOfShip(b);
    for(var i = 0; i < list.length; i++){
        if(list[i].tile.x - b.tile.x == p[0] && list[i].tile.y - b.tile.y == p[1]) return list[i];
    }
    return null;
}

function procBody(c, d, b, mod, W){
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.proc.when")).padRight(6);
        r.button(bundle("mb.ship.proc.when." + mod.when), run(() => {
            mod.when = PROC_WHEN[(PROC_WHEN.indexOf(mod.when) + 1) % PROC_WHEN.length];
            shipChanged(b);
            fillShipDialog(d, b);
        })).height(34).growX();
    })).growX().left().row();
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.proc.act")).padRight(6);
        r.button(bundle("mb.ship.proc.act." + mod.act), run(() => {
            mod.act = PROC_ACT[(PROC_ACT.indexOf(mod.act) + 1) % PROC_ACT.length];
            shipChanged(b);
            fillShipDialog(d, b);
        })).height(34).growX();
    })).growX().left().row();
    mod.list.forEach((p, j) => {
        var tgt = procAt(b, p);
        c.table(cons(r => {
            r.left();
            if(tgt != null){
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(tgt.block.uiIcon)).size(24);
                r.add(rulePlace(b, tgt)).padLeft(6).left().growX();
            }else{
                r.add(bundle("mb.ship.rule.nobuild", p[0], p[1])).left().growX();
            }
            r.button(Icon.trash, Styles.clearNonei, run(() => {
                mod.list.splice(j, 1);
                shipChanged(b);
                fillShipDialog(d, b);
            })).size(32).padLeft(6);
        })).growX().row();
    });
    c.button(bundle("mb.ship.proc.add"), run(() => openProcPicker(b, d, mod))).height(34).growX().row();
    c.add(bundle("mb.ship.proc.hint")).wrap().width(W - 20).left().row();
}

function openProcPicker(b, d, mod){
    var p = newDialog(bundle("mb.ship.proc.pick"));
    addBack(p);
    var list = procsOfShip(b).filter(x => !mod.list.some(q => q[0] == x.tile.x - b.tile.x && q[1] == x.tile.y - b.tile.y));
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top().left();
        if(list.length == 0) t.add(bundle("mb.ship.proc.none")).row();
        list.forEach(x => {
            t.button(cons(r => {
                r.left();
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(x.block.uiIcon)).size(28);
                r.add(rulePlace(b, x)).padLeft(8).left().growX();
            }), run(() => {
                p.hide();
                mod.list.push([x.tile.x - b.tile.x, x.tile.y - b.tile.y]);
                shipChanged(b);
                fillShipDialog(d, b);
            })).growX().height(44).pad(2);
            t.row();
        });
    })).grow();
    p.show();
}

function moveShipMod(d, b, i, dir){
    var mods = shipModsOf(b), j = i + dir;
    if(j < 0 || j >= mods.length) return;
    var t = mods[i];
    mods[i] = mods[j];
    mods[j] = t;
    shipChanged(b);
    fillShipDialog(d, b);
}

function pctField(r, value, onChange){
    var f = null;
    f = r.field("" + value, cons(s => {
        var v = parseInt(s, 10);
        if(isNaN(v)) return;
        var n = clampPct(v);
        onChange(n);
        if(n != v && f != null) f.setText("" + n);
    })).width(90).get();
    r.add("%").padLeft(4);
}

function secField(r, value, onChange){
    var f = null;
    f = r.field("" + value, cons(s => {
        var v = parseInt(s, 10);
        if(isNaN(v)) return;
        var n = clampSec(v);
        onChange(n);
        if(n != v && f != null) f.setText("" + n);
    })).width(90).padLeft(6).get();
    r.add(bundle("mb.ship.rest.sec")).padLeft(4);
}

function amountField(r, value, onChange){
    var f = null;
    f = r.field("" + value, cons(s => {
        var v = parseInt(s, 10);
        if(isNaN(v)) return;
        var n = clampAmount(v);
        onChange(n);
        if(n != v && f != null) f.setText("" + n);
    })).width(110).padLeft(6).get();
    r.add(bundle("mb.ship.pre.pcs")).padLeft(4);
}

function preloadBody(c, d, b, mod, W){
    mod.list.forEach((e, j) => {
        c.table(cons(r => {
            r.image(new Packages.arc.scene.style.TextureRegionDrawable(e.res.uiIcon)).size(24);
            r.add(e.res.localizedName).padLeft(6).left().growX();
            amountField(r, e.amount, n => { e.amount = n; shipChanged(b); });
            r.button(Icon.trash, Styles.clearNonei, run(() => {
                mod.list.splice(j, 1);
                shipChanged(b);
                fillShipDialog(d, b);
            })).size(32).padLeft(6);
        })).growX().row();
    });
    c.button(bundle("mb.ship.pre.additem"), run(() => openLoadPicker(false, mod.list.map(e => e.res), res => {
        mod.list.push({res: res, amount: PRELOAD_DEFAULT});
        shipChanged(b);
        fillShipDialog(d, b);
    }))).height(34).growX().row();
    c.add(bundle("mb.ship.pre.hint")).wrap().width(W - 20).left().row();
}

function liqLoadBody(c, d, b, mod, W){
    c.table(cons(r => {
        r.left();
        r.image(new Packages.arc.scene.style.TextureRegionDrawable(mod.res.uiIcon)).size(28);
        r.add(mod.res.localizedName).padLeft(6).left().growX();
        r.button(bundle("mb.ship.change"), run(() => openLoadPicker(true, [], res => {
            mod.res = res;
            shipChanged(b);
            fillShipDialog(d, b);
        }))).height(34).padLeft(6);
    })).growX().left().row();
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.fill")).padRight(6);
        pctField(r, mod.pct, n => { mod.pct = n; shipChanged(b); });
    })).left().row();
    c.add(bundle("mb.ship.liq.hint")).wrap().width(W - 20).left().row();
}

function openLoadPicker(liquid, taken, onPick){
    var p = newDialog(bundle(liquid ? "mb.ship.pick.preliq" : "mb.ship.pick.preitem"));
    addBack(p);
    var all = allContent(liquid ? Vars.content.liquids() : Vars.content.items());
    var choices = all.filter(res => !(res.isHidden != null && res.isHidden()) && !taken.some(x => x.id == res.id));
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top().left();
        if(choices.length == 0) t.add(bundle("mb.ship.rule.nores")).row();
        choices.forEach(res => {
            t.button(cons(r => {
                r.left();
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(res.uiIcon)).size(28);
                r.add(res.localizedName).padLeft(8).left().growX();
            }), run(() => {
                p.hide();
                onPick(res);
            })).growX().height(44).pad(2);
            t.row();
        });
    })).grow();
    p.show();
}

function resBody(c, d, b, mod, W){
    c.table(cons(r => {
        r.left();
        r.image(new Packages.arc.scene.style.TextureRegionDrawable(mod.res.uiIcon)).size(28);
        r.add(mod.res.localizedName).padLeft(6).left().growX();
        r.button(bundle("mb.ship.change"), run(() => openResPicker(b, false, res => {
            mod.res = res;
            mod.on = false;
            shipChanged(b);
            fillShipDialog(d, b);
        }))).height(34).padLeft(6);
    })).growX().left().row();
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.fill")).padRight(6);
        pctField(r, mod.pct, n => { mod.pct = n; shipChanged(b); });
    })).left().row();
}

function placeRows(c, d, b, mod, places, onChanged){
    places.forEach((p, j) => {
        c.table(cons(r => {
            r.left();
            r.add((j + 1) + ".  " + bundle("mb.ship.xy", p[0], p[1])).left().growX();
            r.button(Icon.upOpen, Styles.clearNonei, run(() => movePlace(d, b, mod, places, j, -1, onChanged))).size(32);
            r.button(Icon.downOpen, Styles.clearNonei, run(() => movePlace(d, b, mod, places, j, 1, onChanged))).size(32);
            r.button(Icon.trash, Styles.clearNonei, run(() => {
                places.splice(j, 1);
                mod.hold = false;
                if(onChanged != null) onChanged();
                shipChanged(b);
                fillShipDialog(d, b);
            })).size(32).padLeft(4);
        })).growX().row();
    });
}

function movePlace(d, b, mod, places, j, dir, onChanged){
    var k = j + dir;
    if(k < 0 || k >= places.length) return;
    var t = places[j];
    places[j] = places[k];
    places[k] = t;
    mod.hold = false;
    if(onChanged != null) onChanged();
    shipChanged(b);
    fillShipDialog(d, b);
}

function resourceRows(c, d, b, mod, W){
    mod.list.forEach((e, j) => {
        c.table(cons(r => {
            r.image(new Packages.arc.scene.style.TextureRegionDrawable(e.res.uiIcon)).size(24);
            r.add(e.res.localizedName).padLeft(6).left().growX();
            pctField(r, e.pct, n => { e.pct = n; mod.hold = false; shipChanged(b); });
            r.button(Icon.trash, Styles.clearNonei, run(() => {
                mod.list.splice(j, 1);
                mod.hold = false;
                shipChanged(b);
                fillShipDialog(d, b);
            })).size(32).padLeft(6);
        })).growX().row();
    });
}

function restBody(c, d, b, mod, W){
    var land = mod.land === true;
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.rest.mode")).padRight(6);
        r.button(bundle(land ? "mb.ship.rest.mode.land" : "mb.ship.rest.mode.fly"), run(() => {
            mod.land = !land;
            mod.hold = false;
            mod.resting = false;
            shipChanged(b);
            fillShipDialog(d, b);
        })).height(34).growX();
    })).growX().left().row();
    if(land) sideRow(c, d, b, mod);
    var places = land ? mod.pads : mod.pts;
    c.add(bundle(land ? "mb.ship.rest.pads" : "mb.ship.rest.pts")).wrap().width(W - 20).left().padTop(4).row();
    if(places.length == 0) c.add(bundle(land ? "mb.ship.pad.none" : "mb.ship.place.none")).left().row();
    placeRows(c, d, b, mod, places, () => { mod.resting = false; });
    c.button(bundle(land ? "mb.ship.pad.add" : "mb.ship.place.add"), run(() => startShipPick(b, d, mod, land ? "pad" : "place"))).height(34).growX().row();
    c.add(bundle("mb.ship.rest.while")).wrap().width(W - 20).left().padTop(6).row();
    resourceRows(c, d, b, mod, W);
    c.button(bundle("mb.ship.res.add"), run(() => openResPicker(b, true, res => {
        mod.list.push({res: res, pct: SHIP_DEFAULT_PCT});
        mod.hold = false;
        shipChanged(b);
        fillShipDialog(d, b);
    }))).height(34).growX().row();
    c.table(cons(r => {
        r.left();
        r.button(bundle(mod.timerOn ? "mb.ship.rest.timeron" : "mb.ship.rest.timeroff"), run(() => {
            mod.timerOn = !mod.timerOn;
            shipChanged(b);
            fillShipDialog(d, b);
        })).height(34);
        if(mod.timerOn) secField(r, mod.sec, n => { mod.sec = n; shipChanged(b); });
    })).left().padTop(6).row();
    c.add(bundle("mb.ship.rest.hint")).wrap().width(W - 20).left().row();
    if(mod.hold) c.add(bundle("mb.ship.hold")).wrap().growX().row();
}

function sideRow(c, d, b, mod){
    var sides = F.LAND_SIDES;
    var cur = sides.indexOf(mod.side);
    if(cur < 0) cur = 0;
    var stack = shipPanelWidth() < 640;
    c.table(cons(r => {
        r.left();
        if(stack) r.add(bundle("mb.ship.side")).left().row();
        else r.add(bundle("mb.ship.side")).padRight(6);
        r.button(bundle("mb.ship.side." + sides[cur]), run(() => {
            mod.side = sides[(cur + 1) % sides.length];
            shipChanged(b);
            fillShipDialog(d, b);
        })).height(34).growX();
    })).growX().left().padTop(4).row();
}

function landBody(c, d, b, mod, W){
    sideRow(c, d, b, mod);
    c.add(bundle("mb.ship.pads")).wrap().width(W - 20).left().row();
    if(mod.pads.length == 0) c.add(bundle("mb.ship.pad.none")).left().row();
    placeRows(c, d, b, mod, mod.pads, null);
    c.button(bundle("mb.ship.pad.add"), run(() => startShipPick(b, d, mod, "pad"))).height(34).growX().row();
    resourceRows(c, d, b, mod, W);
    c.button(bundle("mb.ship.res.add"), run(() => openResPicker(b, true, res => {
        mod.list.push({res: res, pct: SHIP_DEFAULT_PCT});
        mod.hold = false;
        shipChanged(b);
        fillShipDialog(d, b);
    }))).height(34).growX().row();
    if(mod.hold) c.add(bundle("mb.ship.hold")).wrap().growX().row();
}

function extractorsOfShip(b){
    var m = shipMachineOf(b);
    var out = m == null ? [] : machineBlocks(m).filter(x => !x.dead && !isConstructing(x) && isExtractorBlock(x.block));
    out.sort((p, q) => (q.tile.y - p.tile.y) || (p.tile.x - q.tile.x));
    return out;
}

function rulePlace(b, x){ return x.block.localizedName + " (" + (x.tile.x - b.tile.x) + ", " + (x.tile.y - b.tile.y) + ")"; }

function ruleSetTarget(b, mod, x){
    if(x == null){
        mod.all = true;
    }else{
        mod.all = false;
        mod.dx = x.tile.x - b.tile.x;
        mod.dy = x.tile.y - b.tile.y;
        var liqTarget = isPumpBlock(x.block);
        mod.list = mod.list.filter(res => isLiquidRes(res) == liqTarget);
    }
    ruleChanged(b);
}

function ruleBody(c, d, b, mod, W){
    var m = shipMachineOf(b);
    var tgt = mod.all || m == null ? null : ruleTarget(b, mod, machineBlocks(m));
    c.table(cons(r => {
        r.left();
        if(mod.all){
            r.add(bundle("mb.ship.rule.all")).left().growX();
        }else if(tgt != null){
            r.image(new Packages.arc.scene.style.TextureRegionDrawable(tgt.block.uiIcon)).size(28);
            r.add(rulePlace(b, tgt)).padLeft(6).left().growX();
        }else{
            r.add(bundle("mb.ship.rule.nobuild", mod.dx, mod.dy)).left().growX();
        }
        r.button(bundle("mb.ship.change"), run(() => openRuleTargetPicker(b, d, mod))).height(34).padLeft(6);
        r.button(bundle("mb.ship.pick.map"), run(() => startShipPick(b, d, mod, "block"))).height(34).padLeft(6);
    })).growX().left().row();
    c.table(cons(r => {
        r.left();
        r.add(bundle("mb.ship.rule.mode")).padRight(6);
        r.button(bundle(mod.white ? "mb.ship.rule.white" : "mb.ship.rule.black"), run(() => {
            mod.white = !mod.white;
            ruleChanged(b);
            fillShipDialog(d, b);
        })).height(34).growX();
    })).growX().left().row();
    mod.list.forEach((res, j) => {
        c.table(cons(r => {
            r.image(new Packages.arc.scene.style.TextureRegionDrawable(res.uiIcon)).size(24);
            r.add(res.localizedName).padLeft(6).left().growX();
            r.button(Icon.trash, Styles.clearNonei, run(() => {
                mod.list.splice(j, 1);
                ruleChanged(b);
                fillShipDialog(d, b);
            })).size(32).padLeft(6);
        })).growX().row();
    });
    c.button(bundle("mb.ship.rule.add"), run(() => openRulePicker(b, mod, res => {
        mod.list.push(res);
        ruleChanged(b);
        fillShipDialog(d, b);
    }))).height(34).growX().row();
    c.add(bundle(mod.white ? "mb.ship.rule.hintwhite" : "mb.ship.rule.hintblack")).wrap().width(W - 20).left().row();
}

function openRuleTargetPicker(b, d, mod){
    var p = newDialog(bundle("mb.ship.rule.pickblock"));
    addBack(p);
    var list = extractorsOfShip(b);
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top().left();
        t.button(cons(r => {
            r.left();
            r.add(bundle("mb.ship.rule.all")).padLeft(8).left().growX();
        }), run(() => {
            p.hide();
            ruleSetTarget(b, mod, null);
            fillShipDialog(d, b);
        })).growX().height(44).pad(2);
        t.row();
        if(list.length == 0) t.add(bundle("mb.ship.rule.nothing")).row();
        list.forEach(x => {
            t.button(cons(r => {
                r.left();
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(x.block.uiIcon)).size(28);
                r.add(rulePlace(b, x)).padLeft(8).left().growX();
            }), run(() => {
                p.hide();
                ruleSetTarget(b, mod, x);
                fillShipDialog(d, b);
            })).growX().height(44).pad(2);
            t.row();
        });
    })).grow();
    p.show();
}

function centerSet(b, mod, mode){
    var m = shipMachineOf(b);
    var blds = m == null ? [] : machineBlocks(m);
    mod.mode = mode;
    if(mode == "hull"){
        var cur = centerBlockAt(blds, b, mod);
        if(cur == null || !isHull(cur)){
            var hs = hullsOf(blds);
            var pick = hs.filter(x => m != null && x === m.hull)[0] || hs[0];
            if(pick != null){
                mod.dx = pick.tile.x - b.tile.x;
                mod.dy = pick.tile.y - b.tile.y;
            }
        }
    }
    shipChanged(b);
}

function centerBody(c, d, b, mod, W){
    var m = shipMachineOf(b);
    var blds = m == null ? [] : machineBlocks(m);
    var oneHull = hullsOf(blds).length < 2;
    c.table(cons(r => {
        r.left();
        CENTER_MODES.forEach(k => {
            var cell = r.button(bundle("mb.ship.center.m." + k), run(() => {
                centerSet(b, mod, k);
                fillShipDialog(d, b);
            })).height(34).growX().uniformX();
            if(mod.mode == k) cell.color(modColor("center"));
            if(k == "hull" && oneHull) cell.get().setDisabled(true);
        });
    })).growX().left().row();
    if(mod.mode == "mean"){
        c.add(bundle("mb.ship.center.hint.mean")).wrap().width(W - 20).left().padTop(4).row();
        return;
    }
    var hull = mod.mode == "hull";
    var tgt = centerBlockAt(blds, b, mod);
    c.table(cons(r => {
        r.left();
        if(tgt != null){
            r.image(new Packages.arc.scene.style.TextureRegionDrawable(tgt.block.uiIcon)).size(28);
            r.add(rulePlace(b, tgt)).padLeft(6).left().growX();
        }else{
            r.add(bundle("mb.ship.center.nobuild", mod.dx, mod.dy)).left().growX();
        }
        if(hull) r.button(bundle("mb.ship.change"), run(() => openCenterPicker(b, d, mod))).height(34).padLeft(6);
        r.button(bundle("mb.ship.pick.map"), run(() => startShipPick(b, d, mod, hull ? "centerhull" : "centerblock"))).height(34).padLeft(6);
    })).growX().left().padTop(4).row();
    c.add(bundle(hull ? "mb.ship.center.hint.hull" : "mb.ship.center.hint.block")).wrap().width(W - 20).left().padTop(4).row();
}

function openCenterPicker(b, d, mod){
    var p = newDialog(bundle("mb.ship.center.pickhull"));
    addBack(p);
    var m = shipMachineOf(b);
    var list = hullsOf(m == null ? [] : machineBlocks(m));
    list.sort((p1, q) => (q.tile.y - p1.tile.y) || (p1.tile.x - q.tile.x));
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top().left();
        if(list.length == 0) t.add(bundle("mb.ship.center.nohulls")).row();
        list.forEach(x => {
            t.button(cons(r => {
                r.left();
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(x.block.uiIcon)).size(28);
                r.add(rulePlace(b, x)).padLeft(8).left().growX();
            }), run(() => {
                p.hide();
                mod.dx = x.tile.x - b.tile.x;
                mod.dy = x.tile.y - b.tile.y;
                shipChanged(b);
                fillShipDialog(d, b);
            })).growX().height(44).pad(2);
            t.row();
        });
    })).grow();
    p.show();
}

function ruleChoices(b, mod){
    var m = shipMachineOf(b);
    var blds = m == null ? [] : machineBlocks(m);
    var tgt = mod.all || m == null ? null : ruleTarget(b, mod, blds);
    var ex = extractorsOfShip(b).filter(x => mod.all || (tgt != null && x.id == tgt.id));
    var map = shipSourceMap();
    var items = mod.all || (tgt != null && isDrillBlock(tgt.block));
    var liquids = mod.all || (tgt != null && isPumpBlock(tgt.block));
    var list = (items ? map.items : []).concat(liquids ? map.liquids : []);
    return list.filter(res => !mod.list.some(x => x.id == res.id && isLiquidRes(x) == isLiquidRes(res))).map(res => {
        var liq = isLiquidRes(res), why = "";
        if(m == null) why = "mb.ship.nomach";
        else if(!ex.some(x => liq ? isPumpBlock(x.block) : (isDrillBlock(x.block) && x.block.tier >= res.hardness))) why = "mb.ship.st.noext";
        return {res: res, why: why};
    });
}

function openRulePicker(b, mod, onPick){
    var p = newDialog(bundle("mb.ship.rule.pickres"));
    addBack(p);
    var choices = ruleChoices(b, mod);
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top().left();
        if(choices.length == 0) t.add(bundle("mb.ship.rule.nores")).row();
        choices.forEach(ch => {
            var btn = t.button(cons(r => {
                r.left();
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(ch.res.uiIcon)).size(28);
                r.add(ch.res.localizedName).padLeft(8).left().growX();
                r.add(ch.why == "" ? "" : bundle(ch.why)).right().padLeft(8);
            }), run(() => {
                p.hide();
                onPick(ch.res);
            })).growX().height(44).pad(2).get();
            btn.setDisabled(ch.why != "");
            t.row();
        });
    })).grow();
    p.show();
}

function blockAtCursor(ctrl){
    var m = shipMachineOf(ctrl);
    if(m == null) return null;
    var wx = Core.input.mouseWorldX(), wy = Core.input.mouseWorldY();
    var bd = null;
    if(m.mode == "fly"){
        bd = partAtWorld(m, wx, wy);
    }else{
        var t = Vars.world.tileWorld(wx, wy);
        bd = t == null ? null : t.build;
        if(bd != null && machineOfBuild(bd) !== m) bd = null;
    }
    return bd;
}

function ruleBlockAt(ctrl){
    var bd = blockAtCursor(ctrl);
    return bd != null && isExtractorBlock(bd.block) ? bd : null;
}

function allContent(seq){
    var out = [];
    for(var i = 0; i < seq.size; i++) out.push(seq.get(i));
    return out;
}

function resourceChoices(b, landing){
    var m = shipMachineOf(b);
    var blds = m == null ? [] : machineBlocks(m);
    var list = landing
        ? allContent(Vars.content.items()).concat(allContent(Vars.content.liquids()))
        : shipSourceMap().items.concat(shipSourceMap().liquids);
    return list.map(res => {
        var why = "";
        if(m == null) why = "mb.ship.nomach";
        else if(isLiquidRes(res) && !hasTanks(blds)) why = "mb.ship.st.notanks";
        else if(!landing && !hasExtractor(blds, res, true)) why = "mb.ship.st.noext";
        else if(stockOf(blds, res).cap <= 0) why = isLiquidRes(res) ? "mb.ship.st.notanks" : "mb.ship.st.nocap";
        return {res: res, why: why};
    });
}

function openResPicker(b, landing, onPick){
    var p = newDialog(bundle(landing ? "mb.ship.pick.landres" : "mb.ship.pick.res"));
    addBack(p);
    var choices = resourceChoices(b, landing);
    p.cont.pane(Styles.noBarPane, cons(t => {
        t.top().left();
        if(choices.length == 0) t.add(bundle("mb.ship.nothing")).row();
        choices.forEach(ch => {
            var btn = t.button(cons(r => {
                r.left();
                r.image(new Packages.arc.scene.style.TextureRegionDrawable(ch.res.uiIcon)).size(28);
                r.add(ch.res.localizedName).padLeft(8).left().growX();
                r.add(ch.why == "" ? "" : bundle(ch.why)).right().padLeft(8);
            }), run(() => {
                p.hide();
                onPick(ch.res);
            })).growX().height(44).pad(2).get();
            btn.setDisabled(ch.why != "");
            t.row();
        });
    })).grow();
    p.show();
}

function startShipPick(b, d, mod, kind){
    S.shipPick = {b: b, mod: mod, kind: kind};
    if(d != null) d.hide();
}
function endShipPick(){ S.shipPick = null; }
function cancelShipPick(){
    var pk = S.shipPick;
    endShipPick();
    if(pk != null && pk.b != null && !pk.b.dead) openShipDialog(pk.b);
}

var PICK_HINT = {pad: "mb.ship.pickpad", block: "mb.ship.rule.tapblock", centerhull: "mb.ship.center.taphull", centerblock: "mb.ship.center.tapblock"};

function buildShipPickHud(){
    if(Vars.headless) return;
    Vars.ui.hudGroup.fill(cons(root => {
        root.name = "mb-ship-pick";
        root.top();
        root.table(Styles.black6, cons(t => {
            t.margin(6);
            t.label(prov(() => S.shipPick == null ? "" : bundle(PICK_HINT[S.shipPick.kind] || "mb.ship.pickplace"))).pad(4);
            t.button(bundle("mb.ship.pick.cancel"), Styles.defaultt, run(() => cancelShipPick())).height(36).padLeft(8);
        })).visible(boolp(() => S.shipPick != null)).padTop(64);
    }));
}
onEvent(TapEvent, e => {
    if(Vars.headless || S.shipPick == null || e.player != Vars.player) return;
    var pk = S.shipPick;
    if(pk.b == null || pk.b.dead){ endShipPick(); return; }
    var t = e.tile;
    if(t == null) return;
    if(pk.kind == "pad"){
        if(t.block() != landingSpot){ say("mb.ship.nopad"); return; }
        if(!pk.mod.pads.some(q => q[0] == t.x && q[1] == t.y)) pk.mod.pads.push([t.x, t.y]);
        pk.mod.hold = false;
    }else if(pk.kind == "joinpt"){
        pk.mod.pt = [t.x, t.y];
    }else if(pk.kind == "block"){
        var tb = ruleBlockAt(pk.b);
        if(tb == null){ say("mb.ship.rule.notblock"); return; }
        ruleSetTarget(pk.b, pk.mod, tb);
    }else if(pk.kind == "centerhull" || pk.kind == "centerblock"){
        var cb = blockAtCursor(pk.b);
        var hullPick = pk.kind == "centerhull";
        if(cb == null || isConstructing(cb) || (hullPick && !isHull(cb))){ say(hullPick ? "mb.ship.center.nothull" : "mb.ship.center.notblock"); return; }
        pk.mod.dx = cb.tile.x - pk.b.tile.x;
        pk.mod.dy = cb.tile.y - pk.b.tile.y;
    }else{
        if(!pk.mod.pts.some(q => q[0] == t.x && q[1] == t.y)) pk.mod.pts.push([t.x, t.y]);
        pk.mod.hold = false;
    }
    shipChanged(pk.b);
    endShipPick();
    openShipDialog(pk.b);
});

F.buildShipButton = buildShipButton;
F.openShipDialog = openShipDialog;
F.allContent = allContent;
F.buildShipPickHud = buildShipPickHud;
