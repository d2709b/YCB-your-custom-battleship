'use strict';

var F = require("your-custom-battleship/hub");

var bundle = F.bundle, logErr = F.logErr, onEvent = F.onEvent, safe = F.safe;

var MOD = "your-custom-battleship";
var BUTTON_NAME = "ycb-guide-button";
var BUTTON_SPRITE = MOD + "-guide-button";
var BUTTON_FRAME_GAP = 0;
var BUTTON_ICON_SIZE = 38;

var THEMES = [
    {id: "start", color: "5aa0ff", topics: ["idea", "first", "layers"]},
    {id: "controls", color: "5fe070", topics: ["pc", "phone", "build", "landing"]},
    {id: "blocks", color: "ffa040", topics: ["thrust", "rocket", "energy", "fuel", "control", "spot", "magnet", "supermagnet", "builder"]},
    {id: "autopilot", color: "b280ff", topics: ["mods", "modres", "modrest", "modrule", "modcenter", "modjoin", "modmisc"]},
    {id: "flight", color: "ff6060", topics: ["fly", "collide", "damage", "fire", "units"]},
    {id: "world", color: "40d0c0", topics: ["planets", "multi", "settings"]}
];

function pageWidth(){
    var w = 0;
    try{ w = F.uiWidth(); }catch(e){ w = 0; }
    if(!(w > 0)) w = Core.graphics.getWidth();
    return Math.max(240, Math.min(760, Math.floor(w * (w < 720 ? 0.92 : 0.7))));
}

function newDialog(title){
    var style = null;
    try{ style = Styles.fullDialog; }catch(e){ style = null; }
    var d = style != null ? new Packages.mindustry.ui.dialogs.BaseDialog(title, style) : new Packages.mindustry.ui.dialogs.BaseDialog(title);
    d.cont.margin(8, 8, 8, 8);
    d.addCloseButton();
    return d;
}

function themeOf(id){
    for(var i = 0; i < THEMES.length; i++) if(THEMES[i].topics.indexOf(id) >= 0) return THEMES[i];
    return THEMES[0];
}

function openTopic(id){
    var th = themeOf(id);
    var c = Color.valueOf(th.color);
    var W = pageWidth();
    var d = newDialog(bundle("ycb.guide." + id + ".title"));
    d.cont.pane(Styles.noBarPane, cons(t => {
        t.top();
        t.add(bundle("ycb.guide.theme." + th.id)).color(c).left().padBottom(2).row();
        t.image().color(c).height(3).width(W).padBottom(10).row();
        t.add(bundle("ycb.guide." + id + ".text")).width(W).wrap().left().padBottom(16).row();
    })).grow().row();
    d.show();
}

var guideDialog = null;

function buildGuide(){
    var W = pageWidth();
    var d = newDialog(bundle("ycb.guide.title"));
    d.cont.add(bundle("ycb.guide.intro")).width(W).wrap().left().color(Color.lightGray).padBottom(10).row();
    d.cont.pane(Styles.noBarPane, cons(list => {
        list.top();
        THEMES.forEach((th, ti) => {
            var c = Color.valueOf(th.color);
            var head = list.add(bundle("ycb.guide.theme." + th.id));
            head.color(c).left().padTop(ti == 0 ? 0 : 26).padBottom(2);
            try{ head.get().setFontScale(1.1); }catch(e){  }
            list.row();
            list.image().color(c).height(2).width(W).padBottom(6).row();
            th.topics.forEach(id => {
                var strip = list.button(bundle("ycb.guide." + id + ".title"), run(safe("guide topic " + id, () => { openTopic(id); })));
                strip.height(54).width(W).padBottom(4).color(c);
                try{
                    strip.get().getLabel().setAlignment(Align.left);
                    strip.get().getLabelCell().padLeft(16);
                }catch(e){  }
                list.row();
            });
        });
    })).grow().row();
    return d;
}

function openGuide(){
    if(Vars.headless) return;
    try{
        if(guideDialog == null) guideDialog = buildGuide();
        guideDialog.show();
    }catch(e){
        guideDialog = null;
        logErr("open guide", e);
    }
}

function guideIcon(){
    var region = Core.atlas.find(BUTTON_SPRITE);
    if(region == null || !region.found()) return Icon.book;
    var dr = new Packages.arc.scene.style.TextureRegionDrawable(region);
    try{
        dr.setMinWidth(BUTTON_ICON_SIZE);
        dr.setMinHeight(BUTTON_ICON_SIZE);
    }catch(e){  }
    return dr;
}

function addGuideButton(table){
    var cell = table.button(guideIcon(), Styles.clearNonei, run(safe("guide button", () => { openGuide(); })));
    cell.size(48);
    try{ cell.get().name = BUTTON_NAME; }catch(e){ logErr("guide button name", e); }
    try{ cell.get().resizeImage(BUTTON_ICON_SIZE); }catch(e){
        try{ cell.get().getImageCell().size(BUTTON_ICON_SIZE); }catch(e2){  }
    }
    try{ cell.tooltip("@ycb.guide.title"); }catch(e){  }
    return cell;
}

var frame = null;
var frameOk = false;

var menuRow = null;
var menuLooked = -1000;
var frameTick = 0;

function menuWindow(){
    if(Core.scene == null) return null;
    if(menuRow == null || menuRow.getScene() == null){
        menuRow = null;
        if(frameTick - menuLooked < 30) return null;
        menuLooked = frameTick;
        menuRow = Core.scene.find("inputTable");
        if(menuRow == null) return null;
    }
    var row = menuRow;
    var win = row.parent != null ? row.parent : row;
    for(var e = win; e != null; e = e.parent){
        if(e.visible === false) return null;
    }
    return win;
}

var frameSized = false;

function placeFrame(){
    frameTick++;
    frameOk = false;
    if(!Vars.state.isGame() || !Vars.ui.hudfrag.shown) return;
    var win = menuWindow();
    if(win == null) return;
    var v = win.localToStageCoordinates(Tmp.v1.set(0, 0));
    if(!frameSized){ frame.pack(); frameSized = true; }
    frame.setPosition(v.x - BUTTON_FRAME_GAP, v.y, Align.bottomRight);
    frameOk = true;
}

function buildFrame(){
    frame = new Table();
    frame.name = "ycb-guide-frame";
    frame.background(Tex.pane);
    frame.margin(4);
    frame.touchable = Touchable.enabled;
    addGuideButton(frame);
    frame.pack();
    frame.visibility = boolp(() => frameOk);
    Vars.ui.hudGroup.addChild(frame);
    var ticker = new Packages.arc.scene.Element();
    ticker.touchable = Touchable.disabled;
    ticker.update(run(safe("guide frame", () => { placeFrame(); })));
    Vars.ui.hudGroup.addChild(ticker);
}

onEvent(ClientLoadEvent, () => { buildFrame(); });

F.openGuide = openGuide;
