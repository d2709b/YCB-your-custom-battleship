'use strict';

var S = require("your-custom-battleship/state");
var F = require("your-custom-battleship/hub");

var DIRS = F.DIRS;

function isHull(b){
    return b != null && (b.block instanceof StorageBlock);
}

function isConstructing(b){
    return (b.block instanceof ConstructBlock);
}

function isTurret(b){
    return b.block instanceof Turret;
}

function originShift(size){
    return -Math.floor((size - 1) / 2);
}

function coverTiles(b){
    var s = b.block.size, off = originShift(s), tx = b.tile.x, ty = b.tile.y, out = [];
    for(var dx = 0; dx < s; dx++){
        for(var dy = 0; dy < s; dy++){
            out.push(Point2.pack(tx + off + dx, ty + off + dy));
        }
    }
    return out;
}

function centerOf(b){
    var s = b.block.size;
    return [b.tile.x + originShift(s) + (s - 1) / 2, b.tile.y + originShift(s) + (s - 1) / 2];
}

function sameTeam(b, team){
    return b != null && b.team.id == team.id;
}

function blockRot(b){
    return b.block.rotate ? (b.rotation | 0) : 0;
}

var DEFAULT_FRONT = 1;

function frontIndex(m){
    return m.front === undefined || m.front === null ? DEFAULT_FRONT : (m.front | 0) & 3;
}

function frontDeg(m){
    return frontIndex(m) * 90;
}

function turnFront(m, steps){
    m.front = (frontIndex(m) + steps + 4) & 3;
    S.saveDirty = true;
}

function rotXY(q, x, y){
    switch(q & 3){
        case 1: return [-y, x];
        case 2: return [-x, -y];
        case 3: return [y, -x];
        default: return [x, y];
    }
}

function landCell(q, off, x, y){
    var r = rotXY(q, x, y);
    return [r[0] + off[0], r[1] + off[1]];
}

function landOrigin(q, off, b){
    var o = b.block.size % 2 == 0 ? 0.5 : 0;
    var r = rotXY(q, b.tile.x + o, b.tile.y + o);
    return [Math.round(r[0] + off[0] - o), Math.round(r[1] + off[1] - o)];
}

function frontFromSave(o){
    return o.fr === undefined || o.fr === null ? DEFAULT_FRONT : (o.fr | 0) & 3;
}

// Connected groups of blocks (4-neighbour flood fill).
function components(blds){
    var cover = {};
    blds.forEach(b => coverTiles(b).forEach(p => { cover[p] = b; }));
    var seen = {}, comps = [];
    blds.forEach(b0 => {
        if(seen[b0.pos()]) return;
        var comp = [], stack = [b0];
        seen[b0.pos()] = true;
        while(stack.length){
            var b = stack.pop();
            comp.push(b);
            coverTiles(b).forEach(p => {
                var x = Point2.x(p), y = Point2.y(p);
                for(var i = 0; i < 4; i++){
                    var o = cover[Point2.pack(x + DIRS[i][0], y + DIRS[i][1])];
                    if(o != null && !seen[o.pos()]){
                        seen[o.pos()] = true;
                        stack.push(o);
                    }
                }
            });
        }
        comps.push(comp);
    });
    return comps;
}

function cellsOf(blds){
    var cells = {};
    blds.forEach(b => coverTiles(b).forEach(p => { cells[p] = true; }));
    return cells;
}

// Splits groups into the one that holds the main hull (kept) and the rest (detached).
function splitGroups(comps, mainHull){
    var keep = null;
    if(mainHull != null){
        for(var i = 0; i < comps.length && keep == null; i++){
            if(comps[i].some(b => b === mainHull || (b.tile != null && mainHull.tile != null && b.pos() == mainHull.pos()))) keep = comps[i];
        }
    }
    if(keep == null){
        comps.forEach(c => {
            if(c.some(isHull) && (keep == null || c.length > keep.length)) keep = c;
        });
    }
    var good = [], bad = [], badComps = [];
    comps.forEach(c => { if(c === keep) good = good.concat(c); else{ bad = bad.concat(c); badComps.push(c); } });
    return {good: good, bad: bad, badComps: badComps};
}

F.isHull = isHull;
F.isConstructing = isConstructing;
F.isTurret = isTurret;
F.originShift = originShift;
F.coverTiles = coverTiles;
F.centerOf = centerOf;
F.sameTeam = sameTeam;
F.blockRot = blockRot;
F.frontIndex = frontIndex;
F.frontDeg = frontDeg;
F.turnFront = turnFront;
F.frontFromSave = frontFromSave;
F.rotXY = rotXY;
F.landCell = landCell;
F.landOrigin = landOrigin;
F.components = components;
F.cellsOf = cellsOf;
F.splitGroups = splitGroups;
