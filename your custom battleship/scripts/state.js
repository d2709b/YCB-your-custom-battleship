'use strict';

var S = exports;

S.machines = [];
S.cellIndex = {};
S.partIndex = {};
S.magDock = [];
S.debris = [];
S.nextId = 1;
S.busy = false;
S.inPocketOp = 0;
S.poss = null;
S.buildMode = false;
S.editing = {};
S.netHandlers = {};
S.netClientHandlers = {};
S.dirty = false;
S.layoutVersion = 0;
S.saveDirty = false;

S.loose = {};

S.bstates = {};
S.shipMods = {};
S.shipMap = null;
S.ruled = {};
S.shipPick = null;
S.shipDialog = null;
S.builderPick = null;
S.builders = {};
S.testFire = null;
S.testInput = null;

S.inheritedBullets = new java.util.IdentityHashMap();
S.lastMsg = -1000;
S.padX = 0;
S.padY = 0;

S.layerDrag = null;
S.moveMode = false;
S.netWorld = false;
