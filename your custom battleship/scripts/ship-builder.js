'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var BUILDER_BUILD_SECONDS = F.BUILDER_BUILD_SECONDS, BUILDER_CHIMNEYS = F.BUILDER_CHIMNEYS,
    BUILDER_COST_GRAPHITE = F.BUILDER_COST_GRAPHITE, BUILDER_COST_PLASTANIUM = F.BUILDER_COST_PLASTANIUM,
    BUILDER_COST_SURGE = F.BUILDER_COST_SURGE, BUILDER_CRYO_PER_SEC = F.BUILDER_CRYO_PER_SEC,
    BUILDER_FIRESMOKE_PER_SEC = F.BUILDER_FIRESMOKE_PER_SEC, BUILDER_FIRE_PER_SEC = F.BUILDER_FIRE_PER_SEC,
    BUILDER_GLASS_ALPHA = F.BUILDER_GLASS_ALPHA,
    BUILDER_ITEM_STOCK_MULT = F.BUILDER_ITEM_STOCK_MULT, BUILDER_LAUNCH_BLOCKS_DEFAULT = F.BUILDER_LAUNCH_BLOCKS_DEFAULT,
    BUILDER_LAUNCH_BLOCKS_MAX = F.BUILDER_LAUNCH_BLOCKS_MAX, BUILDER_LAUNCH_SPEED_DEFAULT = F.BUILDER_LAUNCH_SPEED_DEFAULT,
    BUILDER_LAUNCH_SPEED_MAX = F.BUILDER_LAUNCH_SPEED_MAX, BUILDER_LAUNCH_SPEED_MIN = F.BUILDER_LAUNCH_SPEED_MIN,
    BUILDER_LIQUID_CAPACITY = F.BUILDER_LIQUID_CAPACITY,
    BUILDER_MAX_SCHEM = F.BUILDER_MAX_SCHEM, BUILDER_PHASE_COST = F.BUILDER_PHASE_COST,
    BUILDER_POWER_PER_SEC = F.BUILDER_POWER_PER_SEC, BUILDER_PRINT_TIME_MULT = F.BUILDER_PRINT_TIME_MULT,
    BUILDER_SIZE = F.BUILDER_SIZE, BUILDER_SMOKE_PER_SEC = F.BUILDER_SMOKE_PER_SEC, BUILDER_TEX_SIZE = F.BUILDER_TEX_SIZE,
    DIRS = F.DIRS, MOD = F.MOD, POCKET_MARGIN = F.POCKET_MARGIN, PULSE_ALPHA_MIN = F.PULSE_ALPHA_MIN,
    PULSE_TICKS = F.PULSE_TICKS, TS = F.TS;
var bundle = F.bundle, logErr = F.logErr, normAngle = F.normAngle, onEvent = F.onEvent, randRange = F.randRange, safe = F.safe, say = F.say;
var centerOf = F.centerOf, frontDeg = F.frontDeg, originShift = F.originShift;
var PLANET_RECIPES = F.PLANET_RECIPES, currentPlanet = F.currentPlanet, planetItems = F.planetItems;
var ensureBody = F.ensureBody, keepBody = F.keepBody;
var makePocket = F.makePocket, partsChanged = F.partsChanged, refreshOre = F.refreshOre, setAng = F.setAng,
    setPartsReal = F.setPartsReal, withPocket = F.withPocket;
var placeInPocket = F.placeInPocket;
var clearFires = F.clearFires;
var newMachineObj = F.newMachineObj;

var SCHEM_PAD = 2;
var CONFIG_MAX_CHARS = 30000;

function lastItemOf(items){
    var best = null;
    for(var i = 0; i < items.length; i++){
        if(best == null || items[i].id > best.id) best = items[i];
    }
    return best;
}

function stacksOf(pairs){
    var map = {};
    pairs.forEach(p => {
        var e = map[p[0].id];
        if(e === undefined) map[p[0].id] = {item: p[0], amount: p[1]};
        else e.amount += p[1];
    });
    var list = [];
    for(var k in map) list.push(map[k]);
    list.sort((a, b) => a.item.id - b.item.id);
    var out = Packages.java.lang.reflect.Array.newInstance(Packages.mindustry.type.ItemStack, list.length);
    for(var i = 0; i < list.length; i++) out[i] = new ItemStack(list[i].item, list[i].amount);
    return out;
}

function builderRecipe(items, planet){
    if(items.length == 0) return null;
    return stacksOf([
        [lastItemOf(items), BUILDER_COST_SURGE],
        [items[0], BUILDER_COST_GRAPHITE],
        [items[Math.min(1, items.length - 1)], BUILDER_COST_PLASTANIUM]
    ]);
}

var extraCache = {};
function extraItem(planet){
    if(planet == Planets.serpulo) return Items.phaseFabric;
    var key = "" + planet.name;
    if(extraCache[key] === undefined){
        var it = null;
        try{ it = lastItemOf(planetItems(planet)); }catch(e){ logErr("builder extra item", e); }
        extraCache[key] = it == null ? Items.phaseFabric : it;
    }
    return extraCache[key];
}

var speedCache = {};
function speedItem(planet){
    if(planet == Planets.serpulo) return Items.pyratite;
    var key = "" + planet.name;
    if(speedCache[key] === undefined){
        var it = null;
        try{
            var list = planetItems(planet).slice().sort((a, b) => a.id - b.id);
            it = list.length >= 2 ? list[list.length - 2] : (list.length == 1 ? list[0] : null);
        }catch(e){ logErr("builder speed item", e); }
        speedCache[key] = it == null ? Items.pyratite : it;
    }
    return speedCache[key];
}

function analyze(schem){
    var info = {ok: false, why: "empty", name: "" + schem.name(), w: schem.width, h: schem.height, tiles: [], counts: [],
        minX: 0, minY: 0, maxX: 0, maxY: 0, blocks: 0};
    var tl = schem.tiles;
    if(tl == null || tl.size == 0) return info;
    var cover = {}, list = [], hasHull = false;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for(var i = 0; i < tl.size; i++){
        var st = tl.get(i), blk = st.block;
        if(blk === shipBuilder){ info.why = "builder"; return info; }
        if(blk instanceof StorageBlock) hasHull = true;
        var size = blk.size, off = originShift(size);
        list.push({block: blk, x: st.x, y: st.y, rot: st.rotation, config: st.config});
        for(var dx = 0; dx < size; dx++){
            for(var dy = 0; dy < size; dy++){
                var x = st.x + off + dx, y = st.y + off + dy;
                cover[Point2.pack(x, y)] = i;
                if(x < minX) minX = x;
                if(x > maxX) maxX = x;
                if(y < minY) minY = y;
                if(y > maxY) maxY = y;
            }
        }
    }
    info.tiles = list;
    info.minX = minX; info.minY = minY; info.maxX = maxX; info.maxY = maxY;
    info.blocks = list.length;
    if(!hasHull){ info.why = "nohull"; return info; }
    if(maxX - minX + 1 > BUILDER_MAX_SCHEM || maxY - minY + 1 > BUILDER_MAX_SCHEM){ info.why = "toolarge"; return info; }
    var seen = {}, stack = [0], reached = 0;
    seen[0] = true;
    while(stack.length > 0){
        var n = stack.pop(), t = list[n], sz = t.block.size, of = originShift(sz);
        reached++;
        for(var ax = 0; ax < sz; ax++){
            for(var ay = 0; ay < sz; ay++){
                var px = t.x + of + ax, py = t.y + of + ay;
                for(var d = 0; d < 4; d++){
                    var o = cover[Point2.pack(px + DIRS[d][0], py + DIRS[d][1])];
                    if(o !== undefined && !seen[o]){
                        seen[o] = true;
                        stack.push(o);
                    }
                }
            }
        }
    }
    if(reached != list.length){ info.why = "loose"; return info; }
    var counts = {};
    list.forEach(t => {
        var c = counts[t.block.id];
        if(c === undefined) counts[t.block.id] = {block: t.block, n: 1};
        else c.n++;
    });
    for(var k in counts) info.counts.push(counts[k]);
    info.pre = preloadOf(info);
    info.ok = true;
    info.why = null;
    return info;
}

function preloadOf(info){
    var items = {}, specs = [];
    info.tiles.forEach(t => {
        if(t.block !== F.shipControl || t.config == null) return;
        F.modsFromJson("" + t.config).forEach(mod => {
            if(mod.k == "preload"){
                mod.list.forEach(e => {
                    if(e.res == null || !(e.amount > 0)) return;
                    var c = items[e.res.id];
                    if(c === undefined) items[e.res.id] = {item: e.res, amount: e.amount};
                    else c.amount += e.amount;
                });
            }else if(mod.k == "liqload" && mod.res != null && mod.pct > 0){
                specs.push({liquid: mod.res, pct: mod.pct});
            }
        });
    });
    var out = {items: [], liquids: [], fills: []};
    var room = 0, tanks = [], cap = 0;
    info.tiles.forEach((t, i) => {
        if(t.block instanceof StorageBlock) room += t.block.itemCapacity;
        if(F.isTankBlock(t.block) && t.block.liquidCapacity > 0){
            tanks.push({i: i, cap: t.block.liquidCapacity});
            cap += t.block.liquidCapacity;
        }
    });
    for(var k in items){
        var amount = Math.min(items[k].amount, room);
        if(amount > 0) out.items.push({item: items[k].item, amount: amount});
    }
    out.items.sort((a, b) => a.item.id - b.item.id);
    var ptr = 0, total = {};
    specs.forEach(sp => {
        var want = Math.min(cap * sp.pct / 100, BUILDER_LIQUID_CAPACITY - 1 - (total[sp.liquid.id] || 0));
        while(want > 0.001 && ptr < tanks.length){
            var fill = Math.min(tanks[ptr].cap, want);
            out.fills.push({liquid: sp.liquid, i: tanks[ptr].i, amount: fill});
            total[sp.liquid.id] = (total[sp.liquid.id] || 0) + fill;
            want -= fill;
            ptr++;
        }
    });
    var seen = {};
    out.fills.forEach(f => {
        if(seen[f.liquid.id] === undefined){
            seen[f.liquid.id] = true;
            out.liquids.push({liquid: f.liquid, amount: total[f.liquid.id]});
        }
    });
    return out;
}

function buildTicksOf(blk){
    if(typeof blk.buildTime === "number") return blk.buildTime;
    if(typeof blk.buildCost === "number") return blk.buildCost;
    return 0;
}

function costOf(info, st){
    var mult = Vars.state.rules.buildCostMultiplier;
    var pairs = [];
    info.counts.forEach(c => {
        var reqs = c.block.requirements;
        for(var i = 0; i < reqs.length; i++) pairs.push([reqs[i].item, Math.round(mult * reqs[i].amount) * c.n]);
    });
    pairs.push([extraItem(currentPlanet()), BUILDER_PHASE_COST]);
    if(st != null){
        var fly = launchCost(st);
        if(fly > 0) pairs.push([speedItem(currentPlanet()), fly]);
    }
    if(info.pre != null) info.pre.items.forEach(e => pairs.push([e.item, e.amount]));
    var map = {};
    pairs.forEach(p => {
        var e = map[p[0].id];
        if(e === undefined) map[p[0].id] = {item: p[0], amount: p[1]};
        else e.amount += p[1];
    });
    var out = [];
    for(var k in map) out.push(map[k]);
    out.sort((a, b) => a.item.id - b.item.id);
    return out;
}

function timeOf(info){
    var t = 0;
    info.counts.forEach(c => { t += buildTicksOf(c.block) * c.n; });
    return t * Vars.state.rules.buildCostMultiplier * BUILDER_PRINT_TIME_MULT;
}

function fmtTime(ticks){
    var s = Math.max(0, Math.round(ticks / 60)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var two = v => (v < 10 ? "0" : "") + v;
    return h > 0 ? h + ":" + two(m) + ":" + two(r) : m + ":" + two(r);
}

function scanSchematics(){
    var ships = [], others = [], all = null;
    try{
        all = Vars.schematics.all();
    }catch(e){
        logErr("schematic library", e);
    }
    var total = all == null ? 0 : all.size;
    for(var i = 0; i < total; i++){
        var s = all.get(i);
        try{
            var info = analyze(s);
            (info.ok ? ships : others).push({schem: s, info: info});
        }catch(e){
            logErr("schematic scan", e);
            var nm = "?";
            try{ nm = "" + s.name(); }catch(e2){  }
            others.push({schem: s, info: {ok: false, why: "error", err: "" + e, name: nm, w: 0, h: 0, blocks: 0}});
        }
    }
    var byName = (p, q) => {
        var a = p.info.name.toLowerCase(), b = q.info.name.toLowerCase();
        return a < b ? -1 : (a > b ? 1 : 0);
    };
    ships.sort(byName);
    others.sort(byName);
    return {ships: ships, others: others, total: total};
}

var DIR_BLOCK = -1;

function newState(){
    return {text: null, schem: null, info: null, reqs: [], total: 0, planKey: "", progress: 0, speed: 0, time: 0, rev: 0,
        region: null, regionTex: null, puffs: [], dir: DIR_BLOCK, blocks: BUILDER_LAUNCH_BLOCKS_DEFAULT, fly: BUILDER_LAUNCH_SPEED_DEFAULT};
}
function clampBlocks(v){
    var n = Math.round(+v);
    if(isNaN(n)) return BUILDER_LAUNCH_BLOCKS_DEFAULT;
    return Math.max(0, Math.min(BUILDER_LAUNCH_BLOCKS_MAX, n));
}
function clampFly(v){
    var n = Math.round(+v);
    if(isNaN(n)) return BUILDER_LAUNCH_SPEED_DEFAULT;
    return Math.max(BUILDER_LAUNCH_SPEED_MIN, Math.min(BUILDER_LAUNCH_SPEED_MAX, n));
}
function launchSpeed(st){ return st.blocks > 0 ? st.fly : 0; }
function launchCost(st){ return st.blocks * launchSpeed(st); }
function setLaunch(b, blocks, fly){
    var st = stOf(b), nb = clampBlocks(blocks), nf = clampFly(fly);
    if(st.blocks === nb && st.fly === nf) return false;
    st.blocks = nb;
    st.fly = nf;
    st.planKey = "";
    st.rev++;
    return true;
}
function stOf(b){
    var s = S.builders[b.id];
    if(s === undefined){
        s = newState();
        S.builders[b.id] = s;
    }
    return s;
}

function refreshPlan(st){
    if(st.info == null) return;
    var key = currentPlanet().name + ":" + Vars.state.rules.buildCostMultiplier + ":" + st.blocks + "x" + launchSpeed(st);
    if(st.planKey === key) return;
    st.planKey = key;
    st.reqs = costOf(st.info, st);
    st.total = Math.max(1, timeOf(st.info));
    st.progress = Math.min(st.progress, st.total);
}

function setSchematic(st, schem, text){
    st.rev++;
    st.progress = 0;
    st.planKey = "";
    st.reqs = [];
    st.total = 0;
    st.region = null;
    st.regionTex = null;
    st.schem = null;
    st.text = null;
    st.info = null;
    st.why = null;
    if(schem == null) return true;
    var info = analyze(schem);
    if(!info.ok){
        st.why = info.why;
        return false;
    }
    st.schem = schem;
    st.text = text;
    st.info = info;
    refreshPlan(st);
    return true;
}

function setFromText(b, text){
    var st = stOf(b);
    if(text == null || text.length == 0){ setSchematic(st, null, null); return; }
    var pick = S.builderPick;
    var schem = null;
    if(pick != null && pick.text === text) schem = pick.schem;
    S.builderPick = null;
    try{
        if(schem == null) schem = Schematics.readBase64(text);
    }catch(e){
        logErr("builder schematic", e);
        setSchematic(st, null, null);
        return;
    }
    if(!setSchematic(st, schem, text)) say(st.why == "toolarge" ? "mb.builder.toolarge" : "mb.builder.notship", BUILDER_MAX_SCHEM);
}

function liquidNeeds(st){
    return st.info == null || st.info.pre == null ? [] : st.info.pre.liquids;
}

function hasAllItems(b, st){
    if(st.reqs.length == 0) return false;
    for(var i = 0; i < st.reqs.length; i++){
        if(!b.items.has(st.reqs[i].item, st.reqs[i].amount)) return false;
    }
    var liqs = liquidNeeds(st);
    for(var j = 0; j < liqs.length; j++){
        if(b.liquids == null || b.liquids.get(liqs[j].liquid) < liqs[j].amount - 0.5) return false;
    }
    return true;
}

function needOf(st, item){
    for(var i = 0; i < st.reqs.length; i++){
        if(st.reqs[i].item.id == item.id) return st.reqs[i].amount;
    }
    return 0;
}

function fraction(b){
    var st = stOf(b);
    return st.info == null || st.total <= 0 ? 0 : Mathf.clamp(st.progress / st.total);
}

function rotOf(b){
    return (((b.rotation | 0) % 4) + 4) % 4;
}

function shipAngleOf(rot){
    return normAngle(rot * 90 - frontDeg({}));
}

function dirIndexOf(b, st){
    var d = st.dir;
    return d === undefined || d === null || d < 0 || d > 3 ? rotOf(b) : d | 0;
}

function setDir(b, d){
    var st = stOf(b);
    d = d === DIR_BLOCK ? DIR_BLOCK : Math.max(0, Math.min(3, d | 0));
    if(st.dir === d) return false;
    st.dir = d;
    return true;
}

function pickHull(parts){
    var best = null;
    parts.forEach(b => {
        if(!(b.block instanceof StorageBlock)) return;
        var core = b.block instanceof CoreBlock;
        if(best == null) best = b;
        else{
            var bestCore = best.block instanceof CoreBlock;
            if((core && !bestCore) || (core == bestCore && b.block.size > best.block.size)) best = b;
        }
    });
    return best;
}

function preloadShip(info, made, hull){
    var inserted = {};
    if(info.pre == null) return inserted;
    var stores = [];
    if(hull.items != null) stores.push(hull);
    made.forEach(bd => { if(bd !== hull && bd.items != null && bd.block instanceof StorageBlock) stores.push(bd); });
    info.pre.items.forEach(e => {
        var left = e.amount;
        for(var i = 0; i < stores.length && left > 0; i++){
            var bd = stores[i];
            var room = Math.max(bd.getMaximumAccepted(e.item), bd.block.itemCapacity) - bd.items.get(e.item);
            var n = Math.min(left, room);
            if(n > 0){
                bd.items.add(e.item, n);
                left -= n;
            }
        }
        inserted[e.item.id] = e.amount - left;
    });
    info.pre.fills.forEach(f => {
        var bd = made[f.i];
        if(bd != null && bd.liquids != null) bd.liquids.add(f.liquid, f.amount);
    });
    return inserted;
}

// Creates the flying machine of the printed ship over the builder.
function spawnShip(b, st){
    var info = st.info, team = b.team;
    var m = newMachineObj(team);
    m.mode = "fly";
    var off0 = info.minX - POCKET_MARGIN, off1 = info.minY - POCKET_MARGIN;
    m.off = [off0, off1];
    makePocket(m, info.maxX - info.minX + 1 + 2 * POCKET_MARGIN, info.maxY - info.minY + 1 + 2 * POCKET_MARGIN);
    var made = [];
    withPocket(m, () => {
        info.tiles.forEach(t => {
            var blk = t.block;
            var bd = blk.newBuilding().create(blk, team);
            placeInPocket(m, {px: t.x - off0, py: t.y - off1, block: blk, team: team, rot: t.rot, b: bd});
            made.push(bd);
        });
        made.forEach((bd, i) => {
            var cfg = info.tiles[i].config;
            if(cfg == null) return;
            try{ bd.configured(null, cfg); }catch(e){ logErr("printed block setting", e); }
        });
        made.forEach(bd => { bd.updateProximity(); });
    }, true);
    var hull = pickHull(made);
    if(hull == null) return null;
    st.inserted = preloadShip(info, made, hull);
    var hc = centerOf(hull);
    m.ref = [hc[0], hc[1]];
    m.parts = made;
    m.hull = hull;
    setAng(m, shipAngleOf(dirIndexOf(b, st)));
    m.savedAng = m.ang;
    var bx = ((info.minX + info.maxX) / 2) - off0, by = ((info.minY + info.maxY) / 2) - off1;
    var lx = (bx - m.ref[0]) * TS, ly = (by - m.ref[1]) * TS;
    var ca = Mathf.cosDeg(m.ang), sa = Mathf.sinDeg(m.ang);
    m.x = b.x - (lx * ca - ly * sa);
    m.y = b.y - (lx * sa + ly * ca);
    S.machines.push(m);
    clearFires(m);
    setPartsReal(m);
    partsChanged(m);
    refreshOre(m);
    ensureBody(m);
    keepBody(m);
    var a = rotOf(b) * Math.PI / 2;
    var dx = Math.cos(a), dy = Math.sin(a);
    var blocks = st.blocks, fly = launchSpeed(st);
    var legOn = blocks > 0 && fly > 0;
    if(legOn){
        var v = fly * TS / 60;
        m.launch = {fixed: true, dx: dx, dy: dy, v: v, left: blocks * TS, hold: null};
        m.vx = dx * v;
        m.vy = dy * v;
    }else{
        m.launch = null;
    }
    var joinAtCraft = made.some(bd => F.isShipControl(bd) && (S.shipMods[bd.id] || []).some(md => md.k == "craftjoin"));
    if(joinAtCraft){
        var hold = {x: m.x + dx * blocks * TS, y: m.y + dy * blocks * TS, ang: m.ang};
        if(legOn) m.launch.hold = hold;
        else m.craftHold = hold;
    }
    S.saveDirty = true;
    return m;
}

function finishPrint(b, st){
    if(Vars.net.client()) return false;
    var m = null;
    try{
        m = spawnShip(b, st);
    }catch(e){
        logErr("print ship", e);
    }
    if(m == null) return false;
    for(var i = 0; i < st.reqs.length; i++) b.items.remove(st.reqs[i].item, st.reqs[i].amount);
    if(st.info.pre != null){
        st.info.pre.items.forEach(e => {
            var lost = e.amount - (st.inserted != null && st.inserted[e.item.id] !== undefined ? st.inserted[e.item.id] : e.amount);
            if(lost > 0) b.items.add(e.item, lost);
        });
        liquidNeeds(st).forEach(l => { if(b.liquids != null) b.liquids.remove(l.liquid, Math.min(l.amount, b.liquids.get(l.liquid))); });
    }
    st.inserted = null;
    try{
        if(!Vars.headless){
            Fx.spawn.at(b.x - BUILDER_SIZE * TS / 4, b.y);
            Fx.spawn.at(b.x + BUILDER_SIZE * TS / 4, b.y);
        }
    }catch(e){  }
    say("mb.msg.builder.done", st.info.name);
    return true;
}

var shipBuilder = extend(Block, "ship-builder", {
    canPlaceOn(tile, team, rotation){
        return true;
    },
    drawPlanRegion(plan, list){
        var s = this.size * TS, pic = regions(), r = (((plan.rotation | 0) % 4) + 4) % 4;
        Draw.rect(this.region, plan.drawx(), plan.drawy(), s, s);
        drawTurned(pic.arrow, r, plan.drawx(), plan.drawy(), s);
        Draw.rect(pic.top, plan.drawx(), plan.drawy(), s, s);
        drawTurned(pic.sbup, r, plan.drawx(), plan.drawy(), s);
    },
    icons(){
        var T = Packages.arc.graphics.g2d.TextureRegion;
        try{
            var pic = regions(true);
            if(pic.top.found()){
                var list = [this.region, pic.arrow[0], pic.top, pic.sbup[0]];
                var out = Packages.java.lang.reflect.Array.newInstance(T, list.length);
                for(var i = 0; i < list.length; i++) out[i] = list[i];
                return out;
            }
        }catch(e){  }
        var one = Packages.java.lang.reflect.Array.newInstance(T, 1);
        one[0] = this.region;
        return one;
    }
});
shipBuilder.requirements = ItemStack.with(Items.graphite, BUILDER_COST_GRAPHITE, Items.plastanium, BUILDER_COST_PLASTANIUM,
    Items.surgeAlloy, BUILDER_COST_SURGE);
shipBuilder.category = Category.units;
shipBuilder.buildVisibility = BuildVisibility.shown;
shipBuilder.alwaysUnlocked = true;
shipBuilder.size = BUILDER_SIZE;
shipBuilder.health = 20000;
shipBuilder.solid = true;
shipBuilder.update = true;
shipBuilder.destructible = true;
shipBuilder.rotate = true;
shipBuilder.configurable = true;
shipBuilder.saveConfig = true;
shipBuilder.hasItems = true;
shipBuilder.itemCapacity = 20000;
shipBuilder.hasPower = true;
shipBuilder.consumePower(BUILDER_POWER_PER_SEC / 60);
shipBuilder.hasLiquids = true;
shipBuilder.liquidCapacity = BUILDER_LIQUID_CAPACITY;
shipBuilder.consumeLiquid(Liquids.cryofluid, BUILDER_CRYO_PER_SEC / 60);
if(typeof shipBuilder.buildTime === "number") shipBuilder.buildTime = BUILDER_BUILD_SECONDS * 60;
else if(typeof shipBuilder.buildCost === "number") shipBuilder.buildCost = BUILDER_BUILD_SECONDS * 60;

try{
    shipBuilder.addBar("mb-print", func(b => new Bar(prov(() => bundle("mb.builder.bar")), prov(() => Pal.accent), floatp(() => fraction(b)))));
}catch(e){
    logErr("builder bar", e);
}

shipBuilder.buildType = prov(() => extend(Building, {
    created: safe("builder created", function(){
        S.builders[this.id] = newState();
    }),
    onRemoved: safe("builder removed", function(){
        delete S.builders[this.id];
        this.super$onRemoved();
    }),
    buildConfiguration: safe("builder config ui", function(table){
        var b = this;
        table.margin(4);
        table.button(Icon.pencil, Styles.cleari, run(() => openSchemDialog(b))).size(40);
        table.button(dirIcon(dirIndexOf(b, stOf(b))), Styles.cleari, run(() => openDirDialog(b))).size(40).update(cons(btn => {
            try{ btn.getStyle().imageUp = dirIcon(dirIndexOf(b, stOf(b))); }catch(e){  }
        })).tooltip(bundle("mb.builder.dir.title"));
        var launchIcon = launchDrawable();
        if(launchIcon != null){
            table.button(launchIcon, Styles.cleari, run(() => openLaunchDialog(b))).size(40).tooltip(bundle("mb.builder.launch.title"));
        }else{
            table.button("[accent]>>", Styles.cleart, run(() => openLaunchDialog(b))).size(40).tooltip(bundle("mb.builder.launch.title"));
        }
    }),
    config: safe("builder config", function(){
        var st = stOf(this);
        if(st.text == null || st.text.length > CONFIG_MAX_CHARS) return null;
        return java.lang.String.valueOf(st.text);
    }),
    shouldConsume: safe("builder consume", function(){
        var st = stOf(this);
        refreshPlan(st);
        return st.info != null && this.enabled && hasAllItems(this, st);
    }),
    getMaximumAccepted: safe("builder capacity", function(item){
        return needOf(stOf(this), item) * BUILDER_ITEM_STOCK_MULT;
    }),
    acceptLiquid: safe("builder accept liquid", function(source, liquid){
        return this.liquids != null && this.liquids.get(liquid) < this.block.liquidCapacity - 0.01;
    }),
    acceptItem: safe("builder accept", function(source, item){
        var st = stOf(this), n = needOf(st, item);
        return st.info != null && n > 0 && this.items.get(item) < n * BUILDER_ITEM_STOCK_MULT;
    }),
    updateTile: safe("builder update", function(){
        var st = stOf(this);
        if(!this.enabled){
            st.speed = Mathf.lerpDelta(st.speed, 0, 0.05);
            return;
        }
        if(st.info == null){
            st.progress = 0;
            st.speed = Mathf.lerpDelta(st.speed, 0, 0.05);
            return;
        }
        refreshPlan(st);
        var ready = hasAllItems(this, st);
        if(this.efficiency > 0 && ready){
            var d = this.edelta();
            st.progress += d;
            st.time += d;
            st.speed = Mathf.lerpDelta(st.speed, 1, 0.05);
            puffChimneys(this, st, this.delta());
        }else{
            st.speed = Mathf.lerpDelta(st.speed, 0, 0.05);
        }
        if(ready && st.progress >= st.total){
            if(finishPrint(this, st)) st.progress = 0;
            else st.progress = st.total;
        }
        st.progress = Mathf.clamp(st.progress, 0, st.total);
    }),
    display: safe("builder display", function(table){
        this.super$display(table);
        var b = this;
        table.row();
        table.table(cons(t => {
            t.left();
            t.label(prov(() => builderInfoText(b))).wrap().width(230).color(Color.lightGray).left();
        })).left();
        table.row();
        table.table(cons(t => {
            t.left();
            var shown = {key: null};
            t.update(run(() => {
                var st = stOf(b);
                refreshPlan(st);
                var key = st.planKey + ":" + (st.info == null ? 0 : 1) + ":" + st.rev;
                if(shown.key === key) return;
                shown.key = key;
                t.clearChildren();
                t.left();
                var rows = [];
                st.reqs.forEach(r => rows.push({icon: r.item.uiIcon, have: () => b.items.get(r.item), need: r.amount}));
                liquidNeeds(st).forEach(l => rows.push({icon: l.liquid.uiIcon, have: () => Math.floor(b.liquids.get(l.liquid)), need: Math.ceil(l.amount)}));
                rows.forEach((r, i) => {
                    if(i > 0 && i % 3 == 0) t.row();
                    t.image(new Packages.arc.scene.style.TextureRegionDrawable(r.icon)).size(24).left();
                    t.label(prov(() => {
                        var have = r.have();
                        return (have >= r.need ? "[lightgray]" : "[scarlet]") + have + "[lightgray]/" + r.need;
                    })).padLeft(3).padRight(10).left();
                });
            }));
        })).left();
    }),
    version: function(){
        return 2;
    },
    write: safe("builder write", function(w){
        this.super$write(w);
        var st = stOf(this);
        if(st.text == null){
            w.i(0);
        }else{
            var bytes = new java.lang.String(st.text).getBytes("UTF-8");
            w.i(bytes.length);
            w.b(bytes);
        }
        w.f(st.progress);
        w.b(st.dir === undefined ? DIR_BLOCK : st.dir);
        w.b(st.blocks);
        w.b(st.fly);
    }),
    read: safe("builder read", function(r, revision){
        this.super$read(r, revision);
        var st = newState();
        S.builders[this.id] = st;
        var n = r.i();
        var text = null;
        if(n > 0) text = "" + new java.lang.String(r.b(n), "UTF-8");
        var progress = r.f();
        if(revision >= 1){
            var dir = r.b();
            st.dir = dir >= 0 && dir <= 3 ? dir : DIR_BLOCK;
        }
        if(revision >= 2){
            st.blocks = clampBlocks(r.b());
            st.fly = clampFly(r.b());
        }
        if(text != null){
            try{
                setSchematic(st, Schematics.readBase64(text), text);
                st.progress = Math.min(progress, st.total);
            }catch(e){
                logErr("builder schematic load", e);
            }
        }
    }),
    draw: safe("builder draw", function(){
        drawBuilder(this);
    })
}));

try{
    shipBuilder.config(Packages.java.lang.String, (b, v) => setFromText(b, "" + v));
    shipBuilder.configClear(b => setFromText(b, null));
    shipBuilder.config(Packages.java.lang.Integer, (b, v) => { setDir(b, parseInt("" + v)); });
    shipBuilder.config(Packages.arc.math.geom.Point2, (b, v) => { setLaunch(b, v.x, v.y); });
}catch(e){
    Log.err("[mb] ship builder config not registered: " + e);
}

function builderInfoText(b){
    var st = stOf(b);
    if(st.info == null) return bundle("mb.builder.nothing");
    return bundle("mb.builder.status", st.info.name, "" + Math.floor(fraction(b) * 100), fmtTime(st.total));
}

PLANET_RECIPES.push({name: "builder", block: () => shipBuilder, width: 3, amounts: [BUILDER_COST_GRAPHITE, BUILDER_COST_PLASTANIUM, BUILDER_COST_SURGE],
    classic: null, make: builderRecipe, buildTicks: BUILDER_BUILD_SECONDS * 60});

var pics = null;
function regions(forIcons){
    if(pics != null && forIcons !== true) return pics;
    var find = name => Core.atlas.find(MOD + "-" + name);
    var p = {top: find("ship-builder-top"), fire: find("ship-builder-fire"), arrow: [], sbup: [], water: [], energy: [], glass: []};
    for(var r = 0; r < 4; r++){
        p.arrow.push(find("ship-builder-arrow-" + r));
        p.sbup.push(find("ship-builder-sbup-" + r));
        p.water.push(find("ship-builder-watermask-" + r));
        p.energy.push(find(r == 0 ? "ship-builder-down-energymask" : "ship-builder-down-energymask-" + r));
        p.glass.push(find(r == 0 ? "ship-builder-glasslayer" : "ship-builder-glasslayer-" + r));
    }
    if(forIcons !== true && p.top.found()) pics = p;
    return p;
}

function drawTurned(list, r, x, y, s){
    var own = list[r];
    if(own != null && own.found()){
        Draw.rect(own, x, y, s, s);
        return true;
    }
    var base = list[0];
    if(base == null || !base.found()) return false;
    Draw.rect(base, x, y, s, s, r * 90);
    return true;
}

var chimneyCache = null;
function chimneyOffsets(rot){
    if(chimneyCache == null){
        chimneyCache = [[], [], [], []];
        var unit = BUILDER_SIZE * TS / BUILDER_TEX_SIZE;
        BUILDER_CHIMNEYS.forEach(c => {
            var dx = (c[0] - BUILDER_TEX_SIZE / 2) * unit, dy = (BUILDER_TEX_SIZE / 2 - c[1]) * unit;
            chimneyCache[0].push([dx, dy]);
            chimneyCache[1].push([-dy, dx]);
            chimneyCache[2].push([-dx, -dy]);
            chimneyCache[3].push([dy, -dx]);
        });
    }
    return chimneyCache[rot];
}

function puffChimneys(b, st, delta){
    if(Vars.headless) return;
    var offs = chimneyOffsets(rotOf(b));
    var rates = [BUILDER_FIRE_PER_SEC, BUILDER_FIRESMOKE_PER_SEC, BUILDER_SMOKE_PER_SEC];
    var fx = [Fx.fire, Fx.fireSmoke, Fx.smoke];
    for(var i = 0; i < offs.length; i++){
        for(var k = 0; k < 3; k++){
            if(rates[k] <= 0) continue;
            var iv = 60 / rates[k], key = i * 3 + k;
            if(st.puffs[key] === undefined || st.puffs[key] < 0) st.puffs[key] = Math.random() * iv;
            st.puffs[key] += delta;
            if(st.puffs[key] >= iv){
                st.puffs[key] -= iv;
                if(st.puffs[key] > iv) st.puffs[key] = 0;
                fx[k].at(b.x + offs[i][0] + randRange(2.5), b.y + offs[i][1] + randRange(2.5));
            }
        }
    }
}

function drawFire(b, st, pic){
    var g = Mathf.clamp(st.speed);
    if(g <= 0.01 || pic.fire == null) return;
    g = g * g * (3 - 2 * g);
    var offs = chimneyOffsets(rotOf(b));
    var w = pic.fire.width * TS / 32, h = pic.fire.height * TS / 32;
    Draw.z(Layer.blockOver + 0.13);
    for(var i = 0; i < offs.length; i++){
        var phase = (b.id % 17) * 2 + i * PULSE_TICKS / offs.length;
        var wave = 0.5 + 0.5 * Math.sin((Time.time + phase) / PULSE_TICKS * 2 * Math.PI);
        Draw.color(Color.white);
        Draw.alpha((PULSE_ALPHA_MIN + (1 - PULSE_ALPHA_MIN) * wave) * g);
        Draw.rect(pic.fire, b.x + offs[i][0], b.y + offs[i][1], w, h);
    }
    Draw.color();
}

function drawSilhouette(b, st){
    var info = st.info, schem = st.schem;
    if(info == null || schem == null) return;
    var tex = Vars.schematics.getPreview(schem);
    if(st.region == null) st.region = new TextureRegion(tex);
    else if(st.regionTex !== tex) st.region.set(tex);
    st.regionTex = tex;
    var scale = Math.min(1, (BUILDER_SIZE - 2) / Math.max(info.w, info.h));
    var dw = (schem.width + SCHEM_PAD) * TS * scale, dh = (schem.height + SCHEM_PAD) * TS * scale;
    var vx = (((schem.width - 1) / 2) - ((info.minX + info.maxX) / 2)) * TS * scale;
    var vy = (((schem.height - 1) / 2) - ((info.minY + info.maxY) / 2)) * TS * scale;
    var ang = shipAngleOf(dirIndexOf(b, st));
    var ca = Mathf.cosDeg(ang), sa = Mathf.sinDeg(ang);
    var cx = b.x + vx * ca - vy * sa, cy = b.y + vx * sa + vy * ca;
    var alpha = 0.35 + 0.65 * st.speed;
    var sh = Shaders.build;
    if(sh == null){
        Draw.color(Pal.accent, alpha);
        Draw.rect(st.region, cx, cy, dw, dh, ang);
        Draw.color();
    }else{
        sh.region = st.region;
        sh.progress = st.total > 0 ? Mathf.clamp(st.progress / st.total) : 0;
        sh.color.set(Pal.accent);
        sh.color.a = alpha;
        sh.time = -st.time / 20;
        Draw.shader(sh);
        Draw.rect(st.region, cx, cy, dw, dh, ang);
        Draw.shader();
        Draw.reset();
    }
    Draw.color(Pal.accent);
    Draw.alpha(st.speed);
    Lines.lineAngleCenter(b.x + Mathf.sin(st.time, 20, BUILDER_SIZE * TS / 2 - 2), b.y, 90, BUILDER_SIZE * TS - 4);
    Draw.reset();
}

var dirArrowRegion = null;
function drawDirArrow(b, st, s){
    var d = st.dir;
    if(d === undefined || d === null || d < 0 || d > 3) return;
    if(dirArrowRegion === null){
        try{
            dirArrowRegion = Core.atlas.has(MOD + "-front-arrow") ? Core.atlas.find(MOD + "-front-arrow") : false;
        }catch(e){
            dirArrowRegion = false;
        }
    }
    if(!dirArrowRegion) return;
    var side = s * 0.2;
    Draw.z(Layer.blockOver + 0.13);
    Draw.color(Color.white, 0.8);
    Draw.rect(dirArrowRegion, b.x, b.y, side, side, (d - 1) * 90);
    Draw.color();
}

function drawBuilder(b){
    var st = stOf(b), pic = regions(), s = b.block.size * TS, r = rotOf(b);
    Draw.z(Layer.block);
    Draw.rect(b.block.region, b.x, b.y, s, s);
    Draw.z(Layer.block + 0.01);
    drawTurned(pic.arrow, r, b.x, b.y, s);
    var em = pic.energy[r] != null && pic.energy[r].found() ? pic.energy[r] : pic.energy[0];
    if(em != null && em.found() && b.power != null){
        Draw.z(Layer.block + 0.02);
        F.drawPowerMask(b, em, b.x, b.y, s, s, em === pic.energy[r] ? 0 : r * 90);
    }
    if(st.info != null) Draw.draw(Layer.blockOver, run(() => drawSilhouette(b, st)));
    Draw.z(Layer.blockOver + 0.1);
    Draw.rect(pic.top, b.x, b.y, s, s);
    Draw.z(Layer.blockOver + 0.11);
    drawTurned(pic.sbup, r, b.x, b.y, s);
    if(b.liquids != null){
        var best = null, bestAmount = 0, all = Vars.content.liquids();
        for(var li = 0; li < all.size; li++){
            var la = b.liquids.get(all.get(li));
            if(la > bestAmount){ bestAmount = la; best = all.get(li); }
        }
        var amount = bestAmount / b.block.liquidCapacity;
        if(best != null && amount > 0.002){
            Draw.z(Layer.blockOver + 0.12);
            Draw.color(best.color, Mathf.clamp(amount));
            drawTurned(pic.water, r, b.x, b.y, s);
            Draw.color();
        }
    }
    Draw.z(Layer.blockOver + 0.125);
    Draw.color(Color.white, BUILDER_GLASS_ALPHA);
    drawTurned(pic.glass, r, b.x, b.y, s);
    Draw.color();
    drawDirArrow(b, st, s);
    drawFire(b, st, pic);
    Draw.reset();
}

function openSchemDialog(b){
    if(Vars.headless || b.dead) return;
    if(Vars.net.client()){ say("mb.msg.mp"); return; }
    var d = new Packages.mindustry.ui.dialogs.BaseDialog(bundle("mb.builder.title"));
    d.addCloseButton();
    try{
        fillSchemDialog(d, b);
    }catch(e){
        logErr("schematic dialog", e);
        d.cont.clear();
        d.cont.add("[scarlet]" + bundle("mb.builder.error", "" + e)).width(Math.min(900, F.uiWidth() - 40)).wrap().left().row();
    }
    d.show();
}

function dirIcon(d){
    switch(d){
        case 0: return Icon.right;
        case 1: return Icon.up;
        case 2: return Icon.left;
        case 3: return Icon.down;
        default: return Icon.rotate || Icon.refresh || Icon.right;
    }
}

var DIR_NAMES = {"0": "mb.builder.dir.right", "1": "mb.builder.dir.up", "2": "mb.builder.dir.left", "3": "mb.builder.dir.down"};

function configQuiet(b, value){
    var keep = null;
    try{ keep = b.block.lastConfig; }catch(e){ keep = null; }
    try{
        b.configure(value);
    }finally{
        try{ b.block.lastConfig = keep; }catch(e2){  }
    }
}

function chooseDir(b, d){
    configQuiet(b, new java.lang.Integer(d | 0));
}

function openDirDialog(b){
    if(Vars.headless || b.dead) return;
    var d = new Packages.mindustry.ui.dialogs.BaseDialog(bundle("mb.builder.dir.title"));
    d.addCloseButton();
    var W = Math.min(520, F.uiWidth() - 40);
    d.cont.add(bundle("mb.builder.dir.hint")).width(W).wrap().left().padBottom(8).row();
    [0, 1, 2, 3].forEach(v => {
        var picked = dirIndexOf(b, stOf(b)) === v;
        d.cont.button((picked ? "[accent]" : "") + bundle(DIR_NAMES["" + v]), dirIcon(v), Styles.flatt, 32, run(() => { chooseDir(b, v); d.hide(); }))
            .width(W).height(52).pad(3).left().row();
    });
    d.show();
}

var launchRegion = null;
function launchDrawable(){
    if(launchRegion === null){
        try{
            var r = Core.atlas.find(MOD + "-builder-launch");
            launchRegion = r != null && r.found() ? r : false;
        }catch(e){
            launchRegion = false;
        }
    }
    if(!launchRegion) return null;
    try{
        var reg = new TextureRegion(launchRegion);
        reg.width = Math.max(1, Math.round(reg.width * 0.5));
        reg.height = Math.max(1, Math.round(reg.height * 0.5));
        return new Packages.arc.scene.style.TextureRegionDrawable(reg);
    }catch(e2){
        return null;
    }
}

function openLaunchDialog(b){
    if(Vars.headless || b.dead) return;
    var st = stOf(b);
    var cur = {blocks: st.blocks, fly: st.fly, sent: {blocks: st.blocks, fly: st.fly}, idle: 0};
    var d = new Packages.mindustry.ui.dialogs.BaseDialog(bundle("mb.builder.launch.title"));
    var send = () => {
        if(cur.sent.blocks === cur.blocks && cur.sent.fly === cur.fly) return;
        cur.sent = {blocks: cur.blocks, fly: cur.fly};
        configQuiet(b, new Packages.arc.math.geom.Point2(cur.blocks, cur.fly));
    };
    d.addCloseButton();
    d.hidden(run(send));
    var W = Math.min(560, F.uiWidth() - 40);
    var col = Math.max(150, Math.min(230, Math.floor((W - 60) / 2)));
    var icon = new Packages.arc.scene.style.TextureRegionDrawable(speedItem(currentPlanet()).uiIcon);
    d.cont.add(bundle("mb.builder.launch.hint", "" + BUILDER_LAUNCH_BLOCKS_DEFAULT, "" + BUILDER_LAUNCH_SPEED_DEFAULT)).width(W).wrap().left().padBottom(10).row();
    var sBlocks = new Packages.arc.scene.ui.Slider(0, BUILDER_LAUNCH_BLOCKS_MAX, 1, false);
    var sSpeed = new Packages.arc.scene.ui.Slider(BUILDER_LAUNCH_SPEED_MIN, BUILDER_LAUNCH_SPEED_MAX, 1, false);
    sBlocks.setValue(cur.blocks);
    sSpeed.setValue(cur.fly);
    var shownSpeed = () => cur.blocks > 0 ? cur.fly : 0;
    d.cont.table(cons(t => {
        t.add(bundle("mb.builder.launch.dist")).width(col).wrap().left();
        t.add("").width(36);
        t.add(bundle("mb.builder.launch.speed")).width(col).wrap().left().row();
        t.add(sBlocks).width(col).padTop(4);
        t.add("").width(36);
        t.add(sSpeed).width(col).padTop(4).row();
        t.table(cons(r => {
            r.left();
            r.image(icon).size(24);
            r.label(prov(() => "" + cur.blocks)).padLeft(4).color(Color.white);
        })).left().padTop(8);
        t.add("[accent]x").width(36).center();
        t.table(cons(r => {
            r.left();
            r.image(icon).size(24);
            r.label(prov(() => "" + shownSpeed())).padLeft(4).color(Color.white);
        })).left().padTop(8).row();
    })).padBottom(6).row();
    d.cont.table(cons(r => {
        r.add("= ").color(Color.lightGray);
        r.image(icon).size(24);
        r.label(prov(() => "[accent]" + (cur.blocks * shownSpeed()) + "[]")).padLeft(4);
        r.add(" " + bundle("mb.builder.launch.total")).color(Color.lightGray);
    })).padBottom(6).row();
    d.cont.label(prov(() => cur.blocks > 0 ? "" : bundle("mb.builder.launch.zero"))).width(W).wrap().color(Color.lightGray).row();
    d.update(run(() => {
        var nb = clampBlocks(sBlocks.getValue()), nf = clampFly(sSpeed.getValue());
        if(nb !== cur.blocks || nf !== cur.fly){
            cur.blocks = nb;
            cur.fly = nf;
            cur.idle = 0;
        }else if(cur.sent.blocks !== cur.blocks || cur.sent.fly !== cur.fly){
            cur.idle += Time.delta;
            if(cur.idle > 20) send();
        }
        try{ sSpeed.setDisabled(cur.blocks <= 0); }catch(e){  }
    }));
    d.show();
}

function schemImage(schem){
    try{
        var img = new Packages.mindustry.ui.dialogs.SchematicsDialog.SchematicImage(schem);
        img.setScaling(Packages.arc.util.Scaling.fit);
        return img;
    }catch(e){
        var plain = new Packages.arc.scene.ui.Image(new Packages.arc.scene.style.TextureRegionDrawable(new TextureRegion(Vars.schematics.getPreview(schem))));
        plain.setScaling(Packages.arc.util.Scaling.fit);
        return plain;
    }
}

function choose(b, schem){
    S.builderPick = null;
    var text = "" + Vars.schematics.writeBase64(schem);
    S.builderPick = {text: text, schem: schem};
    b.configure(java.lang.String.valueOf(text));
}

function whyText(info){
    switch(info.why){
        case "nohull": return bundle("mb.builder.why.nohull");
        case "toolarge": return bundle("mb.builder.why.toolarge", "" + info.w, "" + info.h, "" + BUILDER_MAX_SCHEM);
        case "loose": return bundle("mb.builder.why.loose");
        case "builder": return bundle("mb.builder.why.builder");
        case "error": return bundle("mb.builder.why.error", "" + info.err);
        default: return bundle("mb.builder.why.empty");
    }
}

function fillSchemDialog(d, b){
    var W = Math.min(960, F.uiWidth() - 40);
    var cell = Math.max(104, Math.min(190, Math.floor((W - 24) / 3) - 8));
    var cols = Math.max(1, Math.floor((W - 24) / (cell + 8)));
    var scan = scanSchematics();
    var list = scan.ships;
    d.cont.clear();
    if(F.uiHeight() >= 400) d.cont.add(bundle("mb.builder.hint")).width(W).wrap().left().padBottom(6).row();
    d.cont.add(bundle("mb.builder.count", "" + scan.total, "" + list.length)).width(W).wrap().left().color(Color.lightGray).padBottom(6).row();
    d.cont.table(cons(row => {
        row.left();
        row.label(prov(() => builderInfoText(b))).wrap().width(W - 170).left();
        row.button(bundle("mb.builder.clear"), run(() => { b.configure(null); d.hide(); })).height(40).width(150);
    })).width(W).padBottom(6).row();
    d.cont.pane(Styles.noBarPane, cons(outer => {
        outer.top().left();
        outer.table(cons(grid => {
            grid.top().left();
            if(list.length == 0) grid.add(bundle("mb.builder.none")).wrap().width(W - 30).row();
            list.forEach((e, i) => {
                grid.button(cons(btn => {
                    btn.top().margin(4);
                    btn.add(schemImage(e.schem)).size(cell - 12).row();
                    var name = new Packages.arc.scene.ui.Label(e.info.name);
                    name.setEllipsis(true);
                    name.setAlignment(Packages.arc.util.Align.center);
                    btn.add(name).width(cell - 12).row();
                    btn.add(bundle("mb.builder.card", "" + e.info.w, "" + e.info.h, "" + e.info.blocks)).color(Color.lightGray).row();
                }), run(() => { choose(b, e.schem); d.hide(); })).size(cell, cell + 44).pad(4).style(Styles.flati);
                if((i + 1) % cols == 0) grid.row();
            });
        })).left().row();
        if(scan.others.length > 0){
            outer.add(bundle("mb.builder.others", "" + scan.others.length)).wrap().width(W - 30).left().color(Color.lightGray).padTop(14).row();
            scan.others.forEach(e => {
                outer.add("[lightgray]" + e.info.name + "[]  -  " + whyText(e.info)).wrap().width(W - 30).left().padTop(3).row();
            });
        }
    })).width(W).growY().row();
}

onEvent(ResetEvent, () => { S.builders = {}; S.builderPick = null; });

F.shipBuilder = shipBuilder;
F.shipInfoOf = analyze;
F.builderRecipe = builderRecipe;
F.builderCostOf = costOf;
F.builderTimeOf = timeOf;
