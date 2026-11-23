'use strict';

var F = require("your-custom-battleship/hub");

var errCount = {};
function logErr(where, e){
    var key = where + ":" + e;
    errCount[key] = (errCount[key] || 0) + 1;
    if(errCount[key] <= 3) Log.err("[mb] error in " + where + ": " + e + (e && e.stack ? "\n" + e.stack : ""));
}
function safe(where, fn){
    return function(){
        try{
            return fn.apply(this, arguments);
        }catch(e){
            logErr(where, e);
        }
    };
}
function onEvent(type, fn){ Events.on(type, safe("event " + type, fn)); }
function runEvent(trigger, fn){ Events.run(trigger, safe("trigger " + trigger, fn)); }

function bundle(key, a, b, c){
    try{
        if(a === undefined) return Core.bundle.get(key);
        return Core.bundle.format(key, a, b === undefined ? "" : b, c === undefined ? "" : c);
    }catch(e){
        return key;
    }
}

var lastToast = null;

function showToast(text, secs){
    if(!(secs > 0)) secs = 2.5;
    try{
        if(lastToast != null && lastToast.parent != null) lastToast.remove();
    }catch(e){  }
    lastToast = null;
    try{
        var t = new Table();
        t.setFillParent(true);
        t.touchable = Touchable.disabled;
        t.update(run(() => { if(Vars.state.isMenu() && t.parent != null) t.remove(); }));
        t.actions(Actions.delay(secs * 0.9), Actions.fadeOut(secs * 0.1, Interp.fade), Actions.remove());
        var w = Math.max(120, Math.min(480, uiWidth() - 56));
        try{
            var lay = new Packages.arc.graphics.g2d.GlyphLayout();
            lay.setText(Packages.mindustry.ui.Fonts.outline, text);
            if(lay.width > 0) w = Math.min(w, Math.ceil(lay.width) + 4);
        }catch(e){  }
        t.top().table(Styles.black3, cons(c => {
            c.margin(6);
            var cell = c.add(text).style(Styles.outlineLabel).width(w).wrap();
            cell.get().setAlignment(Align.center);
        })).padTop(56);
        Core.scene.add(t);
        lastToast = t;
    }catch(e){
        logErr("toast", e);
        Vars.ui.showInfoToast(text, secs);
    }
}

function say(key, a, b, c){
    var text = "" + bundle(key, a === undefined ? a : "" + a, b === undefined ? b : "" + b, c === undefined ? c : "" + c);
    if(Vars.headless){
        Log.info("[mb] " + text);
    }else{
        showToast(text, Math.min(6, 2.5 + Math.max(0, text.length - 40) * 0.04));
    }
}

function fmtNum(v){
    return "" + Math.round(v * 100) / 100;
}

function randRange(r){ return (Math.random() * 2 - 1) * r; }

function uiScale(){
    try{
        var s = +Packages.arc.scene.ui.layout.Scl.scl(1);
        return s > 0.25 ? s : 1;
    }catch(e){
        return 1;
    }
}
function uiWidth(){ return Core.graphics.getWidth() / uiScale(); }
function uiHeight(){ return Core.graphics.getHeight() / uiScale(); }

function countKeys(o){
    var n = 0;
    for(var k in o) n++;
    return n;
}

function normAngle(a){
    a = a % 360;
    return a < 0 ? a + 360 : a;
}

function signedDiff(to, from){
    var d = ((to - from) % 360 + 540) % 360 - 180;
    return d;
}

function toPoint2Array(list){
    var arr = Packages.java.lang.reflect.Array.newInstance(Packages.arc.math.geom.Point2, list.length);
    for(var i = 0; i < list.length; i++) arr[i] = list[i];
    return arr;
}

F.logErr = logErr;
F.uiWidth = uiWidth;
F.uiHeight = uiHeight;
F.safe = safe;
F.onEvent = onEvent;
F.runEvent = runEvent;
F.bundle = bundle;
F.say = say;
F.showToast = showToast;
F.fmtNum = fmtNum;
F.randRange = randRange;
F.countKeys = countKeys;
F.normAngle = normAngle;
F.signedDiff = signedDiff;
F.toPoint2Array = toPoint2Array;
F.uiScale = uiScale;
