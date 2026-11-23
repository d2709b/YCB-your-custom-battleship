'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var TAG = F.TAG;
var onEvent = F.onEvent, say = F.say;
var blockRot = F.blockRot, frontFromSave = F.frontFromSave, frontIndex = F.frontIndex, isHull = F.isHull;
var bstate = F.bstate;
var driverType = F.driverType;
var isShipControl = F.isShipControl, legacyMods = F.legacyMods, modsFromData = F.modsFromData,
    modsToData = F.modsToData, shipSaveList = F.shipSaveList;
var ensureBody = F.ensureBody, keepBody = F.keepBody, membersOf = F.membersOf, reindexAll = F.reindexAll;
var makePocket = F.makePocket, partsChanged = F.partsChanged, refreshOre = F.refreshOre,
    setPartsReal = F.setPartsReal, withPocket = F.withPocket;
var placeInPocket = F.placeInPocket;
var destroyMachine = F.destroyMachine;
var reconcile = F.reconcile;

var CHUNK_NAME = "your-custom-battleship-machines";
var OLD_CHUNK_NAME = F.OLD_MOD + "-machines";
var CHUNK_VERSION = 1;
var TAG_MAX_CHARS = 40000;
var GZIP_PREFIX = "gz:";
var chunkOk = false;
var chunkText = null;
var lastText = null;

function serializePart(b){
    var bo = new java.io.ByteArrayOutputStream();
    var w = new Packages.arc.util.io.Writes(new java.io.DataOutputStream(bo));
    w.b(b.version());
    b.writeAll(w);
    var out = {n: b.block.name, x: b.tile.x, y: b.tile.y, r: blockRot(b), d: "" + java.util.Base64.getEncoder().encodeToString(bo.toByteArray())};
    var bs = S.bstates[b.id];
    if(bs !== undefined && bs.burn > 0 && bs.item != null){
        out.bu = bs.burn;
        out.bi = bs.item.id;
    }
    if(isShipControl(b) && S.shipMods[b.id] != null && S.shipMods[b.id].length > 0) out.sm = modsToData(S.shipMods[b.id]);
    return out;
}

function bodyIdOf(m){
    try{
        if(m.body != null && m.body.isValid()) return m.body.id;
    }catch(e){  }
    return m.bodyId === undefined || m.bodyId === null ? -1 : m.bodyId;
}

function machineRecord(m, opts){
    opts = opts || {};
    var o;
    if(m.mode == "land"){
        o = {
            k: "l", t: m.team.id, a: m.anchor, c: Object.keys(m.cells).map(Number), fr: frontIndex(m), pk: m.parked ? 1 : 0,
            pd: m.pad == null ? null : {x: m.pad.x, y: m.pad.y, t: m.pad.team.id},
            sm: shipSaveList(membersOf(m.cells, m.team))
        };
        if(opts.net === true){
            o.pn = Object.keys(m.pending).map(Number);
            if(opts.parts === true) o.parts = membersOf(m.cells, m.team).map(serializePart);
        }
    }else{
        o = {
            k: "f", t: m.team.id, x: m.x, y: m.y, g: m.ang, sg: m.savedAng, off: m.off, ref: m.ref, pw: m.pw, ph: m.ph,
            hull: m.parts.indexOf(m.hull), parts: m.parts.map(serializePart), fr: frontIndex(m), pc: m.pivotCustom === true ? 1 : undefined,
            ch: m.craftHold != null ? [m.craftHold.x, m.craftHold.y, m.craftHold.ang] : undefined,
            gd: m.bonds != null && m.bonds.length > 0 ? m.parts.map(b => (m.gid != null && m.gid[b.id]) || 0) : undefined,
            bd: m.bonds != null && m.bonds.length > 0 ? m.bonds.map(bd => [m.parts.findIndex(b => b.id == bd.a), m.parts.findIndex(b => b.id == bd.b)]) : undefined,
            gn: m.bonds != null && m.bonds.length > 0 ? m.gnext : undefined
        };
        if(opts.net === true){
            o.vx = m.vx; o.vy = m.vy;
            if(m.air != null) o.air = airRecord(m.air);
        }
    }
    o.i = m.id;
    if(m.ctrlOff === true) o.co = 1;
    if(opts.net === true){
        o.bi = bodyIdOf(m);
        o.rv = m.netRev | 0;
        o.dr = F.driverIdOf != null ? F.driverIdOf(m) : -1;
        o.ed = F.editorIdsOf != null ? F.editorIdsOf(m) : [];
        if(m.marks != null) o.mk = Object.keys(m.marks).map(Number);
        if(m.dust != null) o.dust = m.dust;
    }
    return o;
}

function airRecord(a){
    var r = {};
    for(var k in a){
        var v = a[k];
        if(v === undefined || typeof v === "function") continue;
        if(v !== null && typeof v === "object" && !Array.isArray(v) && v.length === undefined && k != "sc" && k != "pad") continue;
        r[k] = v;
    }
    return r;
}

function registryText(){
    var opts = {net: Vars.net.server()};
    var out = {bm: false, ms: S.machines.map(m => machineRecord(m, opts))};
    return JSON.stringify(out);
}

function packText(text){
    var bytes = new java.lang.String(text).getBytes("UTF-8");
    var bo = new java.io.ByteArrayOutputStream();
    var gz = new java.util.zip.GZIPOutputStream(bo);
    gz.write(bytes);
    gz.close();
    return GZIP_PREFIX + java.util.Base64.getEncoder().encodeToString(bo.toByteArray());
}

function unpackText(s){
    if(s.indexOf(GZIP_PREFIX) != 0) return s;
    var raw = java.util.Base64.getDecoder().decode(s.substring(GZIP_PREFIX.length));
    var gi = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(raw));
    var out = new java.io.ByteArrayOutputStream();
    var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    var n = gi.read(buf);
    while(n > 0){
        out.write(buf, 0, n);
        n = gi.read(buf);
    }
    gi.close();
    return "" + new java.lang.String(out.toByteArray(), "UTF-8");
}

function dropTag(){
    try{ Vars.state.rules.tags.remove(TAG); }catch(e){  }
}

// Saves all machines with the world save.
function saveRegistry(){
    S.saveDirty = false;
    if(chunkOk) return;
    try{
        var packed = packText(registryText());
        if(packed.length > TAG_MAX_CHARS){
            dropTag();
            Log.err("[mb] the machines are too big to be saved in the rules of this game version (" + packed.length + " chars)");
            say("mb.msg.savebig");
            return;
        }
        Vars.state.rules.tags.put(TAG, packed);
    }catch(e){
        Log.err("[mb] save failed: " + e);
    }
}

function writeChunk(stream){
    var text = null;
    try{
        text = registryText();
        lastText = text;
    }catch(e){
        Log.err("[mb] save failed, the last good data is written again: " + e);
        text = lastText;
    }
    var w = new Packages.arc.util.io.Writes(stream);
    w.b(CHUNK_VERSION);
    if(text == null){
        w.i(0);
        return;
    }
    var bytes = new java.lang.String(text).getBytes("UTF-8");
    w.i(bytes.length);
    w.b(bytes);
}

function readChunk(stream){
    var r = new Packages.arc.util.io.Reads(stream);
    r.b();
    var n = r.i();
    var text = n > 0 ? "" + new java.lang.String(r.b(n), "UTF-8") : null;
    chunkText = text;
    lastText = text;
    try{
        loadRegistry();
    }catch(e){
        Log.err("[mb] load failed: " + e + (e && e.stack ? "\n" + e.stack : ""));
    }
}

function registerChunk(){
    try{
        var chunk = extend(Packages.mindustry.io.SaveFileReader.CustomChunk, {
            write: function(stream){ writeChunk(stream); },
            read: function(stream){ readChunk(stream); },
            shouldWrite: function(){ return true; },
            writeNet: function(){ return true; }
        });
        Packages.mindustry.io.SaveVersion.addCustomChunk(CHUNK_NAME, chunk);
        chunkOk = true;
        // saves of 8.3 and older hold the machines under the old name: read only, the next save writes the new name
        var old = extend(Packages.mindustry.io.SaveFileReader.CustomChunk, {
            write: function(stream){  },
            read: function(stream){ readChunk(stream); },
            shouldWrite: function(){ return false; },
            writeNet: function(){ return false; }
        });
        Packages.mindustry.io.SaveVersion.addCustomChunk(OLD_CHUNK_NAME, old);
    }catch(e){
        Log.err("[mb] custom save chunk not available, the machines are kept in the rules of the save: " + e);
    }
}
registerChunk();

// Blocks of the map itself (a parked ship, ground blocks) and schematics are read through the game's own name map.
function registerLegacyNames(){
    try{
        var all = Vars.content.blocks();
        var prefix = F.MOD + "-";
        for(var i = 0; i < all.size; i++){
            var nm = all.get(i).name;
            if(nm.indexOf(prefix) == 0) Packages.mindustry.io.SaveFileReader.fallback.put(F.OLD_MOD + "-" + nm.substring(prefix.length), nm);
        }
    }catch(e){
        Log.err("[mb] old block names could not be registered: " + e);
    }
}
registerLegacyNames();

function newMachineObj(team, id){
    var nid = id !== undefined && id !== null && id >= 0 ? id : S.nextId++;
    if(nid >= S.nextId) S.nextId = nid + 1;
    return {
        id: nid, team: team, mode: "land",
        anchor: 0, cells: {}, pending: {},
        parts: [], hull: null, pocket: null, off: [0, 0], ref: [0, 0], realTiles: null,
        x: 0, y: 0, ang: 0, savedAng: 0, vx: 0, vy: 0, radius: 12,
        body: null, stats: null, oreCache: {}, oreStamp: 0, oreTimer: 0, lastOre: [0, 0, 0],
        target: null, targetTimer: 0, turrets: [], boosters: [], thrusting: false, flip: 0, progress: 0,
        front: 1, parked: false, bonds: [], gid: null, gnext: 1
    };
}

function loadFlying(o){
    var m = newMachineObj(Team.get(o.t), o.i);
    m.mode = "fly";
    if(o.co === 1) m.ctrlOff = true;
    m.front = frontFromSave(o);
    m.x = o.x; m.y = o.y; m.ang = o.g; m.savedAng = o.sg; m.off = o.off; m.ref = o.ref; m.pivotCustom = o.pc === 1;
    if(Vars.net.client()){
        m.bodyId = o.bi === undefined ? -1 : o.bi;
        m.vx = o.vx || 0; m.vy = o.vy || 0;
        if(o.air != null) m.air = o.air;
        if(o.dust != null) m.dust = o.dust;
        F.netSetUsers(m, o);
    }
    makePocket(m, o.pw, o.ph);
    var made = [];
    var byIndex = {};
    withPocket(m, () => {
        o.parts.forEach((po, pi) => {
            var bname = F.legacyBlockName(po.n);
            var block = Vars.content.getByName(ContentType.block, bname);
            if(block == null) return;
            var b = block.newBuilding().create(block, m.team);
            placeInPocket(m, {px: po.x, py: po.y, block: block, team: m.team, rot: po.r, b: b});
            if(isShipControl(b)){
                if(po.sm !== undefined) S.shipMods[b.id] = modsFromData(po.sm);
                else if(po.sc !== undefined) S.shipMods[b.id] = legacyMods(po.sc);
            }
            if(po.bu > 0 && po.bi !== undefined){
                var burnItem = Vars.content.item(po.bi);
                if(burnItem != null){
                    var bs = bstate(b);
                    bs.burn = po.bu;
                    bs.item = burnItem;
                }
            }
            try{
                var rd = new Packages.arc.util.io.Reads(new java.io.DataInputStream(new java.io.ByteArrayInputStream(java.util.Base64.getDecoder().decode(po.d))));
                var rev = rd.b();
                b.readAll(rd, rev);
            }catch(e){
                Log.err("[mb] part read failed " + po.n + ": " + e);
            }
            made.push(b);
            byIndex[pi] = b;
        });
        made.forEach(b => { try{ b.afterReadAll(); }catch(e){} });
        made.forEach(b => { b.updateProximity(); });
    }, true);
    m.parts = made;
    setPartsReal(m);
    var hi = o.hull >= 0 && o.hull < o.parts.length ? o.parts[o.hull] : null;
    m.hull = made.filter(b => hi != null && b.tile.x == hi.x && b.tile.y == hi.y)[0] || made.filter(isHull)[0] || null;
    if(o.ch !== undefined && o.ch != null) m.craftHold = {x: o.ch[0], y: o.ch[1], ang: o.ch[2]};
    if(o.bd !== undefined && o.gd !== undefined){
        m.gid = {};
        for(var gi = 0; gi < o.gd.length; gi++){
            if(byIndex[gi] !== undefined && o.gd[gi] != 0) m.gid[byIndex[gi].id] = o.gd[gi];
        }
        m.bonds = [];
        o.bd.forEach(pr => {
            if(byIndex[pr[0]] !== undefined && byIndex[pr[1]] !== undefined) m.bonds.push({a: byIndex[pr[0]].id, b: byIndex[pr[1]].id, off: 0});
        });
        m.gnext = o.gn || 1;
    }
    return m;
}

function loadRegistry(){
    var client = Vars.net.client();
    S.machines = [];
    S.cellIndex = {};
    S.partIndex = {};
    S.bstates = {};
    S.loose = {};
    S.poss = null;
    S.dirty = false;
    S.buildMode = false;
    S.shipMods = {};
    S.shipPick = null;
    S.shipMap = null;
    S.inheritedBullets = new java.util.IdentityHashMap();
    if(!client) Groups.unit.each(u => u.type == driverType, u => u.remove());
    try{
        var s = chunkText;
        if(s == null){
            var raw = Vars.state.rules.tags.get(TAG);
            if(raw == null || raw == "") return;
            s = unpackText("" + raw);
            lastText = s;
            if(chunkOk) dropTag();
        }
        if(s == null || s == "") return;
        var data = JSON.parse(s);
        data.ms.forEach(o => {
            if(o.k == "l"){
                var m = newMachineObj(Team.get(o.t), o.i);
                m.front = frontFromSave(o);
                m.anchor = o.a;
                if(o.co === 1) m.ctrlOff = true;
                m.parked = o.pk === 1 || !client;
                if(client){
                    m.bodyId = o.bi === undefined ? -1 : o.bi;
                    m.pending = {};
                    (o.pn || []).forEach(p => { m.pending[p] = true; });
                    F.netSetUsers(m, o);
                }
                m.pad = o.pd == null ? null : {x: o.pd.x, y: o.pd.y, team: Team.get(o.pd.t)};
                o.c.forEach(p => { m.cells[p] = true; });
                m.shipSaved = o.sm || o.sc || [];
                S.machines.push(m);
            }else{
                var f = loadFlying(o);
                S.machines.push(f);
            }
        });
        reindexAll();
        S.machines.slice().forEach(m => {
            if(m.mode == "land"){
                if(!client) reconcile(m, false);
            }else if(m.hull == null){
                if(!client) destroyMachine(m);
            }else{
                partsChanged(m);
                if(!client){
                    refreshOre(m);
                    ensureBody(m);
                    keepBody(m);
                }
            }
        });
        S.machines.forEach(m => {
            (m.shipSaved || []).forEach(e => {
                var t = Vars.world.tile(e[0], e[1]);
                if(t != null && isShipControl(t.build)) S.shipMods[t.build.id] = typeof e[2] == "string" ? legacyMods(e[2]) : modsFromData(e[2]);
            });
            m.shipSaved = null;
        });
    }catch(e){
        Log.err("[mb] load failed: " + e + (e.stack ? "\n" + e.stack : ""));
    }
}

onEvent(WorldLoadEvent, () => { chunkText = null; lastText = null; loadRegistry(); });
onEvent(ResetEvent, () => {
    chunkText = null; lastText = null;
    S.machines = []; S.cellIndex = {}; S.partIndex = {}; S.bstates = {}; S.loose = {}; S.poss = null; S.dirty = false; S.buildMode = false;
    S.shipMods = {}; S.shipMap = null; S.shipPick = null;
    S.inheritedBullets = new java.util.IdentityHashMap();
});
onEvent(SaveWriteEvent, () => {
    if(chunkOk) dropTag();
    saveRegistry();
});

F.saveRegistry = saveRegistry;
F.machineRecord = machineRecord;
F.loadFlying = loadFlying;
F.serializePart = serializePart;
F.bodyIdOf = bodyIdOf;
F.airRecord = airRecord;
F.loadRegistry = loadRegistry;
F.newMachineObj = newMachineObj;
