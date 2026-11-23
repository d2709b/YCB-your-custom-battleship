'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var logErr = F.logErr, onEvent = F.onEvent, signedDiff = F.signedDiff;
var frontFromSave = F.frontFromSave;
var membersOf = F.membersOf, reindexAll = F.reindexAll;
var partsChanged = F.partsChanged, setAng = F.setAng, setPartsReal = F.setPartsReal;
var loadFlying = F.loadFlying, machineRecord = F.machineRecord, newMachineObj = F.newMachineObj;

var TYPE = "fb";
var VERSION = 2;
var CHUNK = 24000;
var OP_JSON = 1, OP_STATE = 2, OP_INPUT = 3, OP_PARTS = 4, OP_BULLETS = 5, OP_FX = 6;

var NET = S.net = {peers: {}, msgId: 1, asm: {}, tick: 0, helloSent: false, helloAt: 0, ready: false, debug: false, bq: [], fq: [], rot: {}, rotSweep: 0};

function packJson(obj){
    var raw = new java.lang.String(JSON.stringify(obj)).getBytes("UTF-8");
    var bo = new java.io.ByteArrayOutputStream();
    var gz = new java.util.zip.GZIPOutputStream(bo);
    gz.write(raw);
    gz.close();
    return bo.toByteArray();
}

function unpackJson(bytes){
    var gi = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(bytes));
    var out = new java.io.ByteArrayOutputStream();
    var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    var n = gi.read(buf);
    while(n > 0){
        out.write(buf, 0, n);
        n = gi.read(buf);
    }
    gi.close();
    return JSON.parse("" + new java.lang.String(out.toByteArray(), "UTF-8"));
}

function jsonPackets(obj){
    var data = packJson(obj);
    var n = data.length;
    var count = Math.max(1, Math.ceil(n / CHUNK));
    var id = NET.msgId++;
    var out = [];
    for(var i = 0; i < count; i++){
        var from = i * CHUNK, len = Math.min(n, from + CHUNK) - from;
        var bo = new java.io.ByteArrayOutputStream();
        var d = new java.io.DataOutputStream(bo);
        d.writeByte(OP_JSON);
        d.writeInt(id);
        d.writeShort(i);
        d.writeShort(count);
        d.write(data, from, len);
        out.push(bo.toByteArray());
    }
    return out;
}

function takeChunk(who, bytes){
    var din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
    din.readByte();
    var id = din.readInt(), idx = din.readShort(), count = din.readShort();
    var len = bytes.length - 9;
    var part = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, len);
    java.lang.System.arraycopy(bytes, 9, part, 0, len);
    if(count <= 1) return unpackJson(part);
    var key = who + ":" + id;
    var a = NET.asm[key];
    if(a === undefined){
        a = NET.asm[key] = {count: count, got: 0, parts: [], stamp: Time.globalTime};
    }
    if(a.parts[idx] === undefined){
        a.parts[idx] = part;
        a.got++;
    }
    if(a.got < a.count) return null;
    delete NET.asm[key];
    var all = new java.io.ByteArrayOutputStream();
    for(var i = 0; i < a.count; i++) all.write(a.parts[i], 0, a.parts[i].length);
    return unpackJson(all.toByteArray());
}

function sweepChunks(){
    for(var k in NET.asm){
        if(Time.globalTime - NET.asm[k].stamp > 60 * 30) delete NET.asm[k];
    }
}

function sendServerToPeer(peer, bytes, reliable){
    try{
        var con = peer.p.con;
        if(con == null) return;
        if(reliable) Call.clientBinaryPacketReliable(con, TYPE, bytes);
        else Call.clientBinaryPacketUnreliable(con, TYPE, bytes);
    }catch(e){
        logErr("send to " + peer.p.id, e);
    }
}

function sendJsonToPeer(peer, packets){
    for(var i = 0; i < packets.length; i++) sendServerToPeer(peer, packets[i], true);
}

function sendJsonToServer(obj){
    var packets = jsonPackets(obj);
    for(var i = 0; i < packets.length; i++) Call.serverBinaryPacketReliable(TYPE, packets[i]);
}

function peerList(){
    var out = [];
    for(var id in NET.peers) out.push(NET.peers[id]);
    return out;
}

function hasPeers(){
    for(var id in NET.peers) return true;
    return false;
}

function driverIdOf(m){
    var d = F.driverOf(m);
    if(d == null) return -1;
    if(d.local) return Vars.player != null ? Vars.player.id : -1;
    return d.p != null ? d.p.id : -1;
}

function editorIdsOf(m){
    return F.netEditorIds != null ? F.netEditorIds(m) : [];
}

function netSetUsers(m, o){
    m.driverId = o.dr === undefined ? -1 : o.dr;
    m.editorIds = o.ed === undefined ? [] : o.ed;
    m.marks = null;
    if(o.mk !== undefined && o.mk.length > 0){
        m.marks = {};
        o.mk.forEach(p => { m.marks[p] = true; });
    }
    m.markRev = (m.markRev | 0) + 1;
}

function syncDrivers(){
    if(!Vars.net.server()) return;
    Groups.player.each(cons(p => {
        if(p.con == null) return;
        var u = p.unit(), m = null;
        if(u != null && !u.dead && u.type == F.driverType){
            for(var i = 0; i < S.machines.length; i++){
                if(S.machines[i].body === u){ m = S.machines[i]; break; }
            }
        }
        var cur = S.drivers[p.id];
        if(m == null){
            if(cur != null) delete S.drivers[p.id];
            return;
        }
        if(cur != null && cur.m === m) return;
        for(var id in S.drivers){
            if(S.drivers[id].m === m && +id != p.id){ Call.unitClear(p); return; }
        }
        if(S.poss != null && S.poss.m === m){ Call.unitClear(p); return; }
        S.drivers[p.id] = {p: p, m: m, inp: {ix: 0, iy: 0, spin: 0, cam: null, aim: null}, stamp: -1000,
            stale(){ return Time.globalTime - this.stamp > 30; }};
        if(m.mode == "land" && m.pad != null) F.startLift(m);
        sendSay(p, "mb.msg.entered");
    }));
}

function sendSay(p, key, a, b, c){
    var peer = NET.peers[p.id];
    if(peer == null) return;
    sendJsonToPeer(peer, jsonPackets({t: "say", k: key, a: a, b: b, c: c}));
}

function playerLeft(p){
    delete S.drivers[p.id];
    if(F.netEditorLeft != null) F.netEditorLeft(p);
}

function signature(m){
    if(m.mode == "fly") return "f" + (m.netRev | 0) + ":" + m.parts.length + ":" + F.bodyIdOf(m) + ":" + driverIdOf(m) + ":" + editorIdsOf(m).join(",");
    if(m.sigCells === undefined || NET.tick - m.sigCellsAt >= 6 || NET.tick < m.sigCellsAt){
        var h = 0, n = 0;
        for(var k in m.cells){ h = (h * 31 + (+k)) | 0; n++; }
        var p = 0;
        for(var k2 in m.pending){ p = (p * 31 + (+k2)) | 0; }
        m.sigCells = n + ":" + h + ":" + p;
        m.sigCellsAt = NET.tick;
    }
    return "l" + m.sigCells + ":" + m.anchor + ":" + F.frontIndex(m) + ":" + (m.parked ? 1 : 0) + ":" + (m.pad == null ? "" : m.pad.x + "," + m.pad.y)
        + ":" + F.bodyIdOf(m) + ":" + driverIdOf(m) + ":" + editorIdsOf(m).join(",") + ":" + F.marksSignature(m);
}

function recordFor(m, withParts){
    var o = machineRecord(m, {net: true, parts: withParts});
    if(m.mode == "fly"){
        o.x = m.x; o.y = m.y; o.g = m.ang;
    }
    return o;
}

// The server runs all logic and sends changed machines to the clients.
function serverTick(delta){
    if(!Vars.net.server()) return;
    NET.tick++;
    if(NET.tick % 600 == 0) sweepChunks();
    if(!hasPeers()) return;
    var peers = peerList();
    var live = {};
    var cache = {};
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        live[m.id] = true;
        var sig = signature(m);
        for(var pi = 0; pi < peers.length; pi++){
            var peer = peers[pi];
            var was = peer.sent[m.id];
            if(was === sig) continue;
            var withParts = m.mode == "land" && was !== undefined && was.charAt(0) == "f";
            var key = withParts ? "p" : "n";
            var pk = cache[m.id + key];
            if(pk === undefined) pk = cache[m.id + key] = jsonPackets({t: "full", o: recordFor(m, withParts)});
            sendJsonToPeer(peer, pk);
            peer.sent[m.id] = sig;
            delete peer.ps[m.id];
        }
        if(m.mode == "fly" && m.air !== m.netAir){
            m.netAir = m.air;
            var am = jsonPackets({t: "air", i: m.id, a: m.air == null ? null : F.airRecord(m.air), x: m.x, y: m.y, g: m.ang, vx: m.vx, vy: m.vy});
            for(var pj = 0; pj < peers.length; pj++){
                if(peers[pj].sent[m.id] !== undefined) sendJsonToPeer(peers[pj], am);
            }
        }
    }
    for(var pk2 = 0; pk2 < peers.length; pk2++){
        for(var id in peers[pk2].sent){
            if(live[id]) continue;
            delete peers[pk2].sent[id];
            delete peers[pk2].ps[id];
            sendJsonToPeer(peers[pk2], jsonPackets({t: "rm", i: +id}));
        }
    }
    if(NET.looseAt === undefined || NET.tick - NET.looseAt >= 6){ NET.looseAt = NET.tick; NET.looseSig = looseSignature(); }
    var ls = NET.looseSig;
    for(var lp = 0; lp < peers.length; lp++){
        if(peers[lp].looseSig === ls) continue;
        peers[lp].looseSig = ls;
        var list = [];
        for(var lk in S.loose) list.push([+lk, S.loose[lk] === true ? 1 : S.loose[lk]]);
        sendJsonToPeer(peers[lp], jsonPackets({t: "loose", l: list}));
    }
    if(NET.tick % 3 == 0) sendStates(peers);
    if(NET.tick % 6 == 0) sendParts(peers);
    flushEvents(peers);
}

function partsPacket(m){
    var i, b;
    var at = {};
    var get = idx => at[idx] || (at[idx] = [idx, 0, 0, 0, 0]);
    for(i = 0; i < m.turrets.length; i++){
        b = m.turrets[i];
        if(b.dead) continue;
        var et = get(m.pidx[b.id]);
        et[1] |= 1;
        et[2] = Math.round(Mathf.mod(b.rotation - m.ang, 360) * 90);
    }
    for(i = 0; i < m.boosters.length; i++){
        b = m.boosters[i];
        if(b.dead) continue;
        var s = S.bstates[b.id];
        var eb = get(m.pidx[b.id]);
        eb[1] |= 2;
        eb[3] = s === undefined ? 0 : ((s.thrusting ? 1 : 0) | (s.working ? 2 : 0));
    }
    if(m.hurtDirty || m.hurt === undefined || NET.tick - m.hurtAt > 60){
        m.hurt = m.parts.filter(p => !p.dead && p.damaged());
        m.hurtAt = NET.tick;
        m.hurtDirty = false;
    }else{
        m.hurt = m.hurt.filter(p => !p.dead && p.damaged());
    }
    for(i = 0; i < m.hurt.length; i++){
        b = m.hurt[i];
        var eh = get(m.pidx[b.id]);
        eh[1] |= 4;
        eh[4] = Math.round(b.health * 10) / 10;
    }
    var ent = Object.keys(at).map(Number).sort((x, y) => x - y).map(k => at[k]);
    var fires = [];
    if(m.fires != null){
        for(var k in m.fires){
            var f = m.fires[k];
            fires.push([f.x, f.y, f.life, f.max, f.intensity]);
        }
    }
    var bo = new java.io.ByteArrayOutputStream();
    var d = new java.io.DataOutputStream(bo);
    d.writeByte(OP_PARTS);
    d.writeInt(m.id);
    d.writeInt(m.netRev | 0);
    d.writeShort(ent.length);
    ent.forEach(e => {
        d.writeShort(e[0]);
        d.writeByte(e[1]);
        if((e[1] & 1) != 0) d.writeShort(e[2]);
        if((e[1] & 2) != 0) d.writeByte(e[3]);
        if((e[1] & 4) != 0) d.writeFloat(e[4]);
    });
    d.writeShort(fires.length);
    fires.forEach(f => {
        d.writeShort(f[0]); d.writeShort(f[1]);
        d.writeFloat(f[2]); d.writeFloat(f[3]); d.writeFloat(f[4]);
    });
    var sig = ent.map(e => e.join(":")).join(",") + "|" + fires.map(f => f[0] + ":" + f[1]).join(",");
    return {sig: sig, bytes: bo.toByteArray()};
}

function netDebris(d){
    if(!Vars.net.server() || !hasPeers()) return;
    var o = machineRecord(d, {net: false});
    o.vx = d.vx; o.vy = d.vy;
    var pk = jsonPackets({t: "debris", o: o, a: F.airRecord(d.air)});
    var peers = peerList();
    for(var i = 0; i < peers.length; i++){
        if(peers[i].sent !== undefined) sendJsonToPeer(peers[i], pk);
    }
}

function applyDebris(msg){
    var o = msg.o;
    var d = loadFlying(o);
    d.debris = true;
    d.vx = o.vx || 0; d.vy = o.vy || 0;
    d.air = msg.a;
    d.hull = null;
    F.finishDebris(d);
    S.debris.push(d);
}

function sendParts(peers){
    var now = NET.tick;
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.mode != "fly") continue;
        var pp = null;
        for(var pi = 0; pi < peers.length; pi++){
            var peer = peers[pi];
            var known = peer.sent[m.id];
            if(known === undefined || known.charAt(0) != "f") continue;
            var last = peer.ps[m.id];
            if(last !== undefined && last.sig === (pp = pp || partsPacket(m)).sig && now - last.at < 120) continue;
            if(pp == null) pp = partsPacket(m);
            sendServerToPeer(peer, pp.bytes, true);
            peer.ps[m.id] = {sig: pp.sig, at: now};
        }
    }
}

function netBullet(b){
    if(!Vars.net.server() || NET.bq.length >= 300 || !hasPeers()) return;
    NET.bq.push([b.type.id, b.team.id, b.x, b.y, b.vel.angle(), b.vel.x, b.vel.y]);
}

function netFx(kind, x, y, a, b){
    if(!Vars.net.server() || NET.fq.length >= 200 || !hasPeers()) return;
    NET.fq.push([kind, x, y, a || 0, b || 0]);
}

function sendBatches(peers, op, list, perPacket, write){
    for(var from = 0; from < list.length; from += perPacket){
        var part = list.slice(from, from + perPacket);
        var bo = new java.io.ByteArrayOutputStream();
        var d = new java.io.DataOutputStream(bo);
        d.writeByte(op);
        d.writeShort(part.length);
        part.forEach(e => write(d, e));
        var bytes = bo.toByteArray();
        for(var pi = 0; pi < peers.length; pi++) sendServerToPeer(peers[pi], bytes, false);
    }
}

function flushEvents(peers){
    if(NET.bq.length > 0){
        var bq = NET.bq;
        NET.bq = [];
        sendBatches(peers, OP_BULLETS, bq, 40, (d, e) => {
            d.writeShort(e[0]); d.writeByte(e[1]);
            d.writeFloat(e[2]); d.writeFloat(e[3]); d.writeFloat(e[4]); d.writeFloat(e[5]); d.writeFloat(e[6]);
        });
    }
    if(NET.fq.length > 0){
        var fq = NET.fq;
        NET.fq = [];
        sendBatches(peers, OP_FX, fq, 55, (d, e) => {
            d.writeByte(e[0]);
            d.writeFloat(e[1]); d.writeFloat(e[2]); d.writeFloat(e[3]); d.writeFloat(e[4]);
        });
    }
}

function looseSignature(){
    var h = 0, n = 0;
    for(var k in S.loose){ h = (h * 31 + (+k) * 7 + (S.loose[k] === true ? 1 : S.loose[k])) | 0; n++; }
    return n + ":" + h;
}

function sendGMode(p, on){
    var peer = NET.peers[p.id];
    if(peer != null) sendJsonToPeer(peer, jsonPackets({t: "gmode", on: on}));
}

S.netClientHandlers.gmode = function(msg){
    S.buildMode = msg.on === true;
    if(!S.buildMode) S.layerDrag = null;
};

S.netClientHandlers.loose = function(msg){
    S.loose = {};
    msg.l.forEach(e => { S.loose[e[0]] = e[1]; });
};

function sendStates(peers){
    var list = [];
    for(var i = 0; i < S.machines.length; i++){
        if(S.machines[i].mode == "fly") list.push(S.machines[i]);
    }
    if(list.length == 0) return;
    var bo = new java.io.ByteArrayOutputStream();
    var d = new java.io.DataOutputStream(bo);
    d.writeByte(OP_STATE);
    d.writeShort(list.length);
    list.forEach(m => {
        d.writeInt(m.id);
        d.writeFloat(m.x);
        d.writeFloat(m.y);
        d.writeFloat(m.ang);
        d.writeFloat(m.air != null ? 0 : m.vx);
        d.writeFloat(m.air != null ? 0 : m.vy);
        d.writeFloat(m.air != null ? m.air.t : -1);
        d.writeFloat(m.air != null && m.air.kind == "pull" ? (m.air.rate || 0) : 0);
    });
    var bytes = bo.toByteArray();
    for(var pi = 0; pi < peers.length; pi++) sendServerToPeer(peers[pi], bytes, false);
}

function serverMessage(player, msg){
    if(msg.t == "hello"){
        if(msg.v !== VERSION){
            Log.warn("[mb] " + player.name + " has another version of the multiplayer protocol (" + msg.v + ", here " + VERSION + ")");
            return;
        }
        NET.peers[player.id] = {p: player, sent: {}, ps: {}};
        sendJsonToPeer(NET.peers[player.id], jsonPackets({t: "welcome", v: VERSION}));
        Log.info("[mb] " + player.name + " has the mod: the machines are sent");
        return;
    }
    var h = S.netHandlers[msg.t];
    if(h === undefined) return;
    try{
        h(player, msg);
    }catch(e){
        logErr("request " + msg.t, e);
    }
}

function takeInput(player, bytes){
    var d = S.drivers[player.id];
    if(d == null) return;
    var din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
    din.readByte();
    var ix = din.readByte() / 100, iy = din.readByte() / 100, spin = din.readByte();
    var flags = din.readByte();
    var cam = null, aim = null;
    if((flags & 1) != 0) cam = {x: din.readFloat(), y: din.readFloat(), stop: 0, target: null, lever: 0};
    if((flags & 2) != 0) aim = [din.readFloat(), din.readFloat()];
    d.inp = {ix: Mathf.clamp(ix, -1, 1), iy: Mathf.clamp(iy, -1, 1), spin: Mathf.clamp(spin, -1, 1), cam: cam, aim: aim};
    d.stamp = Time.globalTime;
}

function onServerPacket(player, bytes){
    try{
        if(bytes.length >= 1 && bytes[0] == OP_INPUT){ takeInput(player, bytes); return; }
        if(NET.debug) Log.info("[mb] packet from " + player.name + ", " + bytes.length + " bytes, op " + bytes[0]);
        if(bytes.length < 1 || bytes[0] != OP_JSON) return;
        var msg = takeChunk(player.id, bytes);
        if(msg != null) serverMessage(player, msg);
    }catch(e){
        logErr("server packet", e);
    }
}

function indexOfId(id){
    for(var i = 0; i < S.machines.length; i++){
        if(S.machines[i].id === id) return i;
    }
    return -1;
}

function byId(id){
    var i = indexOfId(id);
    return i < 0 ? null : S.machines[i];
}

function removeLanded(m){
    var wasBusy = S.busy;
    S.busy = true;
    try{
        membersOf(m.cells, m.team).forEach(b => {
            try{ b.tile.remove(); }catch(e){ logErr("remove landed block", e); }
        });
    }finally{
        S.busy = wasBusy;
    }
}

function placeLanded(parts, team){
    var wasBusy = S.busy;
    S.busy = true;
    var made = [];
    try{
        parts.forEach(po => {
            try{
                var bname = F.legacyBlockName(po.n);
                var block = Vars.content.getByName(ContentType.block, bname);
                var t = Vars.world.tile(po.x, po.y);
                if(block == null || t == null) return;
                t.setBlock(block, team, po.r);
                var b = t.build;
                if(b == null) return;
                var rd = new Packages.arc.util.io.Reads(new java.io.DataInputStream(new java.io.ByteArrayInputStream(java.util.Base64.getDecoder().decode(po.d))));
                var rev = rd.b();
                b.readAll(rd, rev);
                if(po.sm !== undefined && F.isShipControl(b)) S.shipMods[b.id] = F.modsFromData(po.sm);
                made.push(b);
            }catch(e){
                logErr("place landed block " + po.n, e);
            }
        });
        made.forEach(b => { try{ b.afterReadAll(); }catch(e){  } });
    }finally{
        S.busy = wasBusy;
    }
}

function fillLanded(m, o){
    m.front = frontFromSave(o);
    m.anchor = o.a;
    m.parked = o.pk === 1;
    m.bodyId = o.bi === undefined ? -1 : o.bi;
    m.pending = {};
    (o.pn || []).forEach(p => { m.pending[p] = true; });
    m.cells = {};
    o.c.forEach(p => { m.cells[p] = true; });
    m.pad = o.pd == null ? null : {x: o.pd.x, y: o.pd.y, team: Team.get(o.pd.t)};
    m.dust = o.dust === undefined ? null : o.dust;
    netSetUsers(m, o);
}

function applyShipMods(o){
    (o.sm || []).forEach(e => {
        if(o.k != "l") return;
        var t = Vars.world.tile(e[0], e[1]);
        if(t != null && F.isShipControl(t.build)) S.shipMods[t.build.id] = typeof e[2] == "string" ? F.legacyMods(e[2]) : F.modsFromData(e[2]);
    });
}

function applyFull(o){
    var idx = indexOfId(o.i);
    var old = idx >= 0 ? S.machines[idx] : null;
    var m;
    if(o.k == "f"){
        if(old != null && old.mode == "land") removeLanded(old);
        m = loadFlying(o);
        m.net = {x: o.x, y: o.y, g: o.g, vx: o.vx || 0, vy: o.vy || 0, at: Time.time};
        m.x = o.x; m.y = o.y; m.vx = o.vx || 0; m.vy = o.vy || 0;
        m.netRev = o.rv | 0;
    }else{
        if(o.parts != null && old != null && old.mode == "fly") placeLanded(o.parts, Team.get(o.t));
        m = old != null && old.mode == "land" ? old : newMachineObj(Team.get(o.t), o.i);
        m.mode = "land";
        fillLanded(m, o);
    }
    if(idx >= 0) S.machines[idx] = m; else S.machines.push(m);
    if(S.poss != null && S.poss.m.id === m.id) S.poss.m = m;
    reindexAll();
    if(m.mode == "fly"){
        partsChanged(m);
        m.netRev = o.rv | 0;
        setPartsReal(m);
    }
    applyShipMods(o);
    S.layoutVersion++;
}

function applyRemove(id){
    var i = indexOfId(id);
    if(i < 0) return;
    var m = S.machines[i];
    S.machines.splice(i, 1);
    if(S.poss != null && S.poss.m === m) S.poss = null;
    reindexAll();
}

function applyAir(msg){
    var m = byId(msg.i);
    if(m == null || m.mode != "fly") return;
    m.air = msg.a;
    if(msg.a == null){
        m.net = {x: msg.x, y: msg.y, g: msg.g, vx: msg.vx, vy: msg.vy, at: Time.time};
    }else{
        m.x = msg.x; m.y = msg.y; m.vx = 0; m.vy = 0;
        setAng(m, msg.g);
    }
}

function applyStates(bytes){
    var din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
    din.readByte();
    var n = din.readShort();
    for(var i = 0; i < n; i++){
        var id = din.readInt(), x = din.readFloat(), y = din.readFloat(), g = din.readFloat();
        var vx = din.readFloat(), vy = din.readFloat(), at = din.readFloat(), rate = din.readFloat();
        var m = byId(id);
        if(m == null || m.mode != "fly") continue;
        m.net = {x: x, y: y, g: g, vx: vx, vy: vy, at: Time.time};
        if(m.air != null && at >= 0){
            if(m.air.kind == "pull"){
                m.air.p = Math.max(0, Math.min(1, at / Math.max(1, m.air.dur)));
                m.air.rate = rate;
            }else if(Math.abs(m.air.t - at) > 4) m.air.t = at;
        }
    }
}

function applyParts(bytes){
    var din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
    din.readByte();
    var id = din.readInt(), rv = din.readInt();
    var m = byId(id);
    var ok = m != null && m.mode == "fly" && (m.netRev | 0) === rv;
    var n = din.readShort(), i;
    var hurt = {};
    for(i = 0; i < n; i++){
        var idx = din.readShort(), mask = din.readByte();
        var rot = (mask & 1) != 0 ? din.readShort() / 90 : 0;
        var fl = (mask & 2) != 0 ? din.readByte() : 0;
        var hp = (mask & 4) != 0 ? din.readFloat() : 0;
        var p = ok ? m.parts[idx] : null;
        if(p == null || p.dead) continue;
        if((mask & 1) != 0){
            if(NET.rot[p.id] === undefined) p.rotation = rot + m.ang;
            NET.rot[p.id] = rot;
        }
        if((mask & 2) != 0){
            var s = F.bstate(p);
            s.thrusting = (fl & 1) != 0;
            s.working = (fl & 2) != 0;
        }
        if((mask & 4) != 0){ p.health = hp; hurt[idx] = true; }
    }
    var nf = din.readShort();
    var fires = {};
    for(i = 0; i < nf; i++){
        var fx = din.readShort(), fy = din.readShort();
        fires[fx + fy * 4096] = {x: fx, y: fy, life: din.readFloat(), max: din.readFloat(), intensity: din.readFloat(), flam: 0};
    }
    if(!ok) return;
    for(i = 0; i < m.parts.length; i++){
        var q = m.parts[i];
        if(!hurt[i] && !q.dead && q.health < q.maxHealth) q.health = q.maxHealth;
    }
    m.fires = fires;
    m.fireCount = nf;
}

function applyBullets(bytes){
    var din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
    din.readByte();
    var n = din.readShort();
    for(var i = 0; i < n; i++){
        var id = din.readShort(), tid = din.readByte() & 255;
        var x = din.readFloat(), y = din.readFloat(), rot = din.readFloat(), vx = din.readFloat(), vy = din.readFloat();
        try{
            var bt = Vars.content.getByID(ContentType.bullet, id);
            if(bt == null) continue;
            var b = bt.create(null, Team.get(tid), x, y, rot, -1, 1, 1, null);
            if(b != null && bt.speed > 0.01) b.vel.set(vx, vy);
            try{ if(bt.shootEffect != null) bt.shootEffect.at(x, y, rot); }catch(e2){  }
        }catch(e){
            logErr("copy of a bullet", e);
        }
    }
}

function applyFx(bytes){
    var din = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
    din.readByte();
    var n = din.readShort();
    for(var i = 0; i < n; i++){
        var kind = din.readByte();
        var x = din.readFloat(), y = din.readFloat(), a = din.readFloat(), b = din.readFloat();
        try{
            if(kind == 1) Fx.explosion.at(x, y);
            else if(kind == 2) Fx.hitBulletSmall.at(x, y);
            else if(kind == 3){
                if(b > 15) Fx.shockwave.at(x, y);
                if(b > 30) Fx.bigShockwave.at(x, y);
                var shake = Math.min(b / 4 + 3, 9);
                Effect.shake(shake, shake, x, y);
                Fx.dynamicExplosion.at(x, y, a / 8);
            }else if(kind == 4){
                var blk = Vars.content.block(Math.round(b));
                if(blk != null) Fx.healBlockFull.at(x, y, a, Pal.heal, blk);
            }
        }catch(e){
            logErr("copy of an effect " + kind, e);
        }
    }
}

function clientMessage(msg){
    if(msg.t == "full") applyFull(msg.o);
    else if(msg.t == "welcome") NET.welcomed = true;
    else if(msg.t == "say") F.say(msg.k, msg.a, msg.b, msg.c);
    else if(msg.t == "rm") applyRemove(msg.i);
    else if(msg.t == "air") applyAir(msg);
    else if(msg.t == "debris") applyDebris(msg);
    else{
        var h = S.netClientHandlers[msg.t];
        if(h !== undefined) h(msg);
    }
}

function onClientPacket(bytes){
    try{
        if(bytes.length < 1) return;
        if(bytes[0] == OP_STATE){ applyStates(bytes); return; }
        if(bytes[0] == OP_PARTS){ applyParts(bytes); return; }
        if(bytes[0] == OP_BULLETS){ applyBullets(bytes); return; }
        if(bytes[0] == OP_FX){ applyFx(bytes); return; }
        if(bytes[0] != OP_JSON) return;
        var msg = takeChunk(0, bytes);
        if(msg != null) clientMessage(msg);
    }catch(e){
        logErr("client packet", e);
    }
}

function followServer(m, delta){
    var n = m.net;
    if(n == null) return;
    var el = Math.min(10, Time.time - n.at);
    var px = n.x + n.vx * el, py = n.y + n.vy * el;
    var dx = px - m.x, dy = py - m.y;
    if(dx * dx + dy * dy > 90 * 90){
        m.x = px; m.y = py;
    }else{
        var k = Math.min(1, 0.35 * delta);
        m.x += dx * k;
        m.y += dy * k;
    }
    m.vx = n.vx;
    m.vy = n.vy;
    var da = signedDiff(n.g, m.ang);
    if(Math.abs(da) > 45) setAng(m, n.g);
    else setAng(m, m.ang + da * Math.min(1, 0.35 * delta));
}

var inputStamp = 0, lastInput = "";
function sendInput(){
    if(S.poss == null || !NET.welcomed) return;
    var now = Time.globalTime;
    var di = F.localInput();
    var flags = (di.cam != null ? 1 : 0) | (di.aim != null ? 2 : 0);
    var key = [Math.round(di.ix * 100), Math.round(di.iy * 100), di.spin, flags, di.cam != null ? Math.round(di.cam.x) + "," + Math.round(di.cam.y) : "", di.aim != null ? Math.round(di.aim[0]) + "," + Math.round(di.aim[1]) : ""].join("|");
    if(key === lastInput && now - inputStamp < 12) return;
    if(now - inputStamp < 2) return;
    inputStamp = now;
    lastInput = key;
    var bo = new java.io.ByteArrayOutputStream();
    var d = new java.io.DataOutputStream(bo);
    d.writeByte(OP_INPUT);
    d.writeByte(Math.round(Mathf.clamp(di.ix, -1, 1) * 100));
    d.writeByte(Math.round(Mathf.clamp(di.iy, -1, 1) * 100));
    d.writeByte(di.spin);
    d.writeByte(flags);
    if(di.cam != null){ d.writeFloat(di.cam.x); d.writeFloat(di.cam.y); }
    if(di.aim != null){ d.writeFloat(di.aim[0]); d.writeFloat(di.aim[1]); }
    Call.serverBinaryPacketUnreliable(TYPE, bo.toByteArray());
}

function copyParts(m, delta){
    var i, p, tl = m.turrets, bl = m.boosters;
    for(i = 0; i < tl.length; i++){
        p = tl[i];
        var aim = NET.rot[p.id];
        if(!p.dead && aim !== undefined) p.rotation = Mathf.slerpDelta(p.rotation, aim + m.ang, 0.45);
    }
    for(i = 0; i < bl.length; i++){
        p = bl[i];
        var s = S.bstates[p.id];
        if(p.dead || s === undefined) continue;
        s.level = F.engineLevel(m, s.thrusting);
        if(s.working) F.stepSmoke(p, s, delta * s.level);
    }
    if(m.fires != null && (m.fireCount | 0) > 0){
        for(var key in m.fires){
            var f = m.fires[key];
            f.life += delta;
            if(f.life >= f.max){ delete m.fires[key]; m.fireCount--; continue; }
            F.fireFx(m, f, delta);
        }
    }
}

// Clients only move and draw the copies of the machines.
function clientTick(delta){
    if(!NET.welcomed && Vars.state.isGame() && Time.globalTime - NET.helloAt > 90){
        NET.helloAt = Time.globalTime;
        NET.helloSent = true;
        sendJsonToServer({t: "hello", v: VERSION});
    }
    for(var i = 0; i < S.machines.length; i++){
        var m = S.machines[i];
        if(m.mode != "fly") continue;
        try{
            if(m.air != null) F.airStep(m, delta);
            else followServer(m, delta);
            setPartsReal(m);
            copyParts(m, delta);
        }catch(e){
            logErr("copy of a machine", e);
        }
    }
    if(Time.globalTime - NET.rotSweep > 3600){
        NET.rotSweep = Time.globalTime;
        var keep = {};
        S.machines.forEach(m2 => { if(m2.mode == "fly") m2.parts.forEach(q => { if(NET.rot[q.id] !== undefined) keep[q.id] = NET.rot[q.id]; }); });
        NET.rot = keep;
    }
    try{ F.airTick(delta); }catch(e){ logErr("airTick", e); }
    try{ F.clientDebrisTick(delta); }catch(e){ logErr("client debris tick", e); }
    try{ sendInput(); }catch(e){ logErr("send input", e); }
    if(F.netClientExtra != null) F.netClientExtra(delta);
}

var clientHandler = false, serverHandler = false;
function installHandlers(){
    try{
        if(!clientHandler && Vars.netClient != null){
            Vars.netClient.addBinaryPacketHandler(TYPE, cons(bytes => onClientPacket(bytes)));
            clientHandler = true;
        }
        if(!serverHandler && Vars.netServer != null){
            Vars.netServer.addBinaryPacketHandler(TYPE, new Packages.arc.func.Cons2({
                get: function(player, bytes){ onServerPacket(player, bytes); }
            }));
            serverHandler = true;
        }
    }catch(e){
        logErr("packet handlers", e);
    }
}
installHandlers();
if(!Vars.headless) onEvent(ClientLoadEvent, installHandlers);
else onEvent(ServerLoadEvent, installHandlers);

onEvent(WorldLoadEvent, () => {
    S.netWorld = Vars.net.client();
    installHandlers();
    NET.helloSent = false;
    NET.welcomed = false;
    NET.helloAt = -1000;
    NET.asm = {};
    NET.rot = {};
    if(Vars.net.server()) NET.peers = {};
});
onEvent(ResetEvent, () => { S.netWorld = false; NET.helloSent = false; NET.welcomed = false; NET.helloAt = -1000; NET.asm = {}; NET.peers = {}; });
onEvent(PlayerLeave, e => {
    delete NET.peers[e.player.id];
    playerLeft(e.player);
});

F.netServerTick = serverTick;
F.netBullet = netBullet;
F.netFx = netFx;
F.netDebris = netDebris;
F.netSyncDrivers = syncDrivers;
F.netSendGMode = sendGMode;
F.netRequest = sendJsonToServer;
F.driverIdOf = driverIdOf;
F.editorIdsOf = editorIdsOf;
F.netSay = sendSay;
F.netClientTick = clientTick;
F.netSetUsers = netSetUsers;
F.netByMachineId = byId;
F.netSendToServer = sendJsonToServer;
F.netJsonPackets = jsonPackets;
F.netSendPackets = sendJsonToPeer;
F.netPeers = peerList;
F.NET = NET;
