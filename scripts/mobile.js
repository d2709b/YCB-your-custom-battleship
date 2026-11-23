'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var bundle = F.bundle, logErr = F.logErr, safe = F.safe;

function isPhone(){
    return Vars.mobile && !Vars.headless;
}

function cameraGoal(){
    if(!isPhone() || Core.camera == null) return null;
    return {x: Core.camera.position.x, y: Core.camera.position.y, stop: 0, target: null, lever: 0};
}

function padShown(){
    return isPhone() && S.poss != null && S.poss.m.mode == "land";
}

function toggleMoveMode(){
    if(!S.buildMode) return;
    S.moveMode = !S.moveMode;
    if(!S.moveMode){ S.layerDrag = null; touchPtr = -1; }
    else if(touchProc != null) installTouchProcessor();
}

function rotateFront(){
    if(Core.camera == null) return;
    F.rotateFrontAt(Core.camera.position.x, Core.camera.position.y, 1);
}

var PHONE_BTN_W = 150, PHONE_BTN_H = 38;

function phoneButton(t, style, text, onClick, tag){
    var cell = t.button("", style, safe(tag, onClick));
    cell.update(b => { b.setText(text()); });
    cell.size(PHONE_BTN_W, PHONE_BTN_H);
    try{
        var lab = cell.get().getLabel();
        lab.setWrap(true);
        lab.setAlignment(Align.center);
        lab.setFontScale(0.8);
    }catch(e){
        logErr("phone button label", e);
    }
    return cell;
}

function addPhoneButtons(t){
    var moveStyle = Styles.togglet != null ? Styles.togglet : Styles.defaultt;
    t.collapser(cons(c => {
        c.defaults().pad(2).growX();
        phoneButton(c, moveStyle, () => bundle(S.moveMode ? "mb.btn.moveoff" : "mb.btn.move"), toggleMoveMode, "button move blocks").update(b => {
            b.setText(bundle(S.moveMode ? "mb.btn.moveoff" : "mb.btn.move"));
            try{ b.setChecked(S.moveMode); }catch(e){  }
        });
        c.row();
        phoneButton(c, Styles.defaultt, () => bundle("mb.btn.rotate"), rotateFront, "button rotate front");
    }), boolp(() => isPhone() && S.buildMode)).growX();
    t.row();
}

function addTouchPad(t){
    t.collapser(cons(c => {
        c.table(cons(pad => {
            var mk = (icon, dx, dy) => pad.button(icon, Styles.clearNonei, () => {}).size(44).update(b => {
                if(b.isPressed()){ S.padX += dx; S.padY += dy; }
            });
            pad.add();
            mk(Icon.up, 0, 1);
            pad.add();
            pad.row();
            mk(Icon.left, -1, 0);
            pad.add();
            mk(Icon.right, 1, 0);
            pad.row();
            pad.add();
            mk(Icon.down, 0, -1);
            pad.add();
        }));
    }), boolp(() => padShown())).growX();
}

function moveActive(){
    return isPhone() && S.moveMode && S.buildMode && Vars.state.isGame() && !Vars.state.isPaused();
}

var overlay = null;
var touchProc = null;
var touchPtr = -1;

function overInterface(sx, sy){
    var hit = Core.scene.hit(sx, sy, true);
    return hit != null && hit !== overlay;
}

function fingerDown(sx, sy, pointer){
    if(!moveActive() || touchPtr >= 0) return false;
    if(Core.scene.hasDialog() || overInterface(sx, sy)) return false;
    touchPtr = pointer;
    if(S.layerDrag == null || S.layerDrag.touch === true) F.startLayerDrag(true, sx, sy);
    return true;
}

function fingerMove(sx, sy, pointer){
    if(pointer != touchPtr) return false;
    var d = S.layerDrag;
    if(d != null && d.touch === true){ d.fx = sx; d.fy = sy; }
    return true;
}

function fingerUp(sx, sy, pointer){
    if(pointer != touchPtr) return false;
    touchPtr = -1;
    var d = S.layerDrag;
    if(d != null && d.touch === true){ d.fx = sx; d.fy = sy; d.up = true; }
    return true;
}

function installTouchProcessor(){
    try{
        if(touchProc == null){
            touchProc = extend(Packages.arc.input.InputProcessor, {
                touchDown: function(sx, sy, pointer, button){ return !!safe("touch down", fingerDown)(sx, sy, pointer); },
                touchUp: function(sx, sy, pointer, button){ return !!safe("touch up", fingerUp)(sx, sy, pointer); },
                touchDragged: function(sx, sy, pointer){ return !!safe("touch drag", fingerMove)(sx, sy, pointer); },
                mouseMoved: function(sx, sy){ return false; },
                keyDown: function(code){ return false; },
                keyUp: function(code){ return false; },
                keyTyped: function(ch){ return false; },
                scrolled: function(ax, ay){ return false; }
            });
        }
        var list = Core.input.getInputProcessors();
        var at = list.indexOf(touchProc, true);
        var sceneAt = list.indexOf(Core.scene, true);
        var want = sceneAt + 1;
        if(at == want) return true;
        if(at >= 0) list.remove(at);
        want = Math.max(0, list.indexOf(Core.scene, true) + 1);
        list.insert(Math.min(want, list.size), touchProc);
        return true;
    }catch(e){
        F.logErr("touch processor", e);
        touchProc = null;
        return false;
    }
}

function buildMoveOverlay(){
    overlay = new Table();
    overlay.name = "mb-move-overlay";
    overlay.setFillParent(true);
    overlay.touchable = Touchable.enabled;
    overlay.visibility = boolp(() => moveActive());
    var viaProcessor = installTouchProcessor();
    if(!viaProcessor){
        overlay.tapped(run(safe("move overlay touch down", () => {
            if(!S.moveMode || !S.buildMode) return;
            if(S.layerDrag == null || S.layerDrag.touch === true) F.startLayerDrag(true);
        })));
        try{
            overlay.released(run(safe("move overlay touch up", () => {
                var d = S.layerDrag;
                if(d != null && d.touch === true) d.up = true;
            })));
        }catch(e){
            F.logErr("move overlay touch up listener", e);
        }
    }
    Vars.ui.hudGroup.addChild(overlay);
    overlay.toBack();
}

F.cameraGoal = cameraGoal;
F.isPhone = isPhone;
F.toggleMoveMode = toggleMoveMode;
F.phoneButton = phoneButton;
F.addPhoneButtons = addPhoneButtons;
F.addTouchPad = addTouchPad;
F.buildMoveOverlay = buildMoveOverlay;
