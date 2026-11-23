# Architecture

The mod is Rhino JS under scripts/ (about 13,000 lines, 33 files). A ship is called a machine in the code (variable m). Functions are referred to by name; search for them.

## 1. Machine model

Every ship is one record in S.machines and is in one of two modes.

- m.mode == "land": the blocks are ordinary world buildings. m.cells lists their cells and S.cellIndex maps a world cell to the machine.
- m.mode == "fly": the blocks live in m.pocket, a private Tiles array that belongs to the machine. m.parts lists them and S.partIndex maps a building id to the machine. The machine itself is a pose (m.x, m.y, m.ang). Every tick setPartsReal computes the real world position of each block, and withPocket swaps Vars.world.tiles to the pocket while the blocks update or are drawn.

Each machine also has a body (m.body), an invisible unit at its centre. The player takes control through it, enemies can target it, and the RTS command panel works on it. keepBody keeps it in place.

takeOff and landMachine move the same Building objects between the world and the pocket, so items, liquids, power and processor state survive.

The pose is the position of the pivot m.ref (pocket tile coordinates); every turn is around it. By default the pivot is the hull centre. A Center module of a Ship Control block (centerInfo: mean of cells, a chosen core or storage, or a chosen block) moves it: takeOff starts from F.centerPoint, and applyPivot (pocket.js) moves m.ref in flight when m.pivotDirty is set, recomputing m.x and m.y so no block moves. The module offsets are turned on landing like the rule targets (turnShipOffsets).

## 2. Files and load order

main.js loads the files in the order of COMMON (everywhere) and CLIENT (not on a headless server). A file can use at load time only what earlier files put into the shared objects.

- S (state.js): shared state (S.machines, S.cellIndex, S.partIndex, S.debris, and so on).
- F (hub.js): shared functions. A file ends with F.takeOff = takeOff; and another starts with var takeOff = F.takeOff;. A function from a file that loads later is called as F.name(...) at call time.

Files:

- config.js: tunable numbers (MAX_EXTENT, POCKET_MARGIN, the AIR and DUST constants, DEBRIS_FALL_SPEEDUP).
- geometry.js: block cells, connected groups (components), splitGroups.
- boosters.js, blocks.js: engines and thrust (flightSpeed, engineWorking, engineLevel); block definitions and the body unit.
- machines.js: registry, createMachine, body units.
- pocket.js: makePocket, withPocket, pose conversion, partsChanged, setPartsReal.
- landing.js: takeOff, landMachine, landing spot search, park button.
- air.js: animated landing, lift, fall and magnet pull (m.air).
- flight.js: flyStep, moveFlying, flyLogic.
- combat.js: damage to blocks, flyReconcile, destroyMachine, fires, bullet speed inheritance.
- impact.js: landing on units, debris, wave drop zone.
- magnets.js: magnet forces, docking, joining and splitting machines.
- physics.js: machine-to-machine collisions.
- editor.js: build mode, layers, merging and splitting machines, reconcile.
- commands.js, control.js: RTS orders; player possession of a machine.
- ship-control.js, ship-panel.js: control block modules, autopilot and its UI.
- ship-builder.js: schematic builder block.
- net.js, persistence.js: multiplayer and saving.
- loop.js: order of work in every tick.
- render.js, hud.js, guide.js: client-only drawing and UI.

## 3. Machine creation

In build mode, placing a core or storage (a hull) calls createMachine, which registers a landed machine. Blocks that touch the machine join it. Blocks placed before their hull exists wait in S.loose and are attached by adoptLoose once a chain of blocks reaches a machine.

Membership is decided by connectivity. reconcile collects the machine's blocks, builds connected groups (components), and splitGroups keeps the group holding the main hull. The rest is unattached: marked red in build mode and removed on exit. A group with a hull of its own becomes a separate machine (spinOff). Touching landed machines are merged (mergeTouching), except parked ones.

reindexAll maintains the lookups: S.cellIndex[pos] for landed machines and S.partIndex[building.id] for flying ones.

## 4. Takeoff and landing

Ways to take off:

- Leaving build mode (G): exitBuildMode, finishLanded, reconcile, then takeOff at once.
- Take off order, park button, control block modules, boarding a ship on a landing spot: startLift calls takeOff, then a slow rise animation plays.

takeOff(m):

1. Checks that a hull exists, no block is under construction, and the size is within MAX_EXTENT.
2. Computes the bounding box, the pocket offset m.off and the reference point m.ref (the point of the Center module, else the hull centre, in pocket coordinates), sets m.mode = "fly" and creates the pocket with makePocket.
3. Under S.busy = true (so the mod's own handlers ignore the change) it calls pickedUp(), removes each building from its world tile, then inside withPocket(m, ..., true) puts the same objects into pocket tiles (placeInPocket) and restores their configuration with coordinates remapped (configToAbs, applyConfigAbs).
4. Fills m.parts and m.hull, then calls refreshOre, partsChanged (builds the per-tick lists: updList, boosters, turrets, drawList, radius), setPartsReal, ensureBody and fires the "lift" event for processor modules.

withPocket(m, fn, structural):

```js
w.tiles = m.pocket;                    // the game now sees the pocket
S.inPocketOp++;                        // the mod's own handlers ignore changes made inside
if(structural) Vars.headless = true;   // placing or removing must not touch the renderer
try{ return fn(); } finally { /* restore all three */ }
```

While fn runs, every neighbour lookup in vanilla code (conveyors, turrets, power graphs) sees the pocket, so a flying conveyor hands items to a flying neighbour.

Real positions: setPartsReal sets building.set(x, y) for each block from its offset against m.ref, rotated by m.ang and added to (m.x, m.y); it returns early if nothing moved. toWorld and toLocal convert between pocket and world coordinates (hits, debris, drop zone).

landMachine(m, parked, at) finds a spot on the grid (findLandingSide, findPadLanding, fitsOnGrid; the machine turns by quarter turns q), then does the reverse: blocks leave the pocket and are placed with placeReal and landOrigin. Before placing it runs landImpact (enemy ground units under the blocks fight them by health) and, after a crash, crashImpact. If landing destroys every storage, dropMachine leaves the blocks as ordinary world blocks.

## 5. Animations (air.js)

m.air = {kind, t, dur, alt, ...}. While it is set, moveFlying calls airStep and nobody steers the machine.

- "land" (started by startLanding or startFall): descent to a chosen spot; ends in touchDown and landMachine.
- "lift" (startLift): takeOff is already done; the ship rises (alt goes from 0 to 1).
- "up" (abortLanding): the spot was taken; the ship rises again.
- "pull" (startMagnetPull): drawn to a ground magnet; progress follows the magnets' force.

startFall keeps the machine's velocity. It crashes onto whatever is below when no engine works (!engineWorking(m)). engineCheck triggers it after NO_ENGINE_TICKS without a working engine.

## 6. The tick (loop.js)

Server and single player, in order:

```
restoreBodies, adoptPlayerUnit, netSyncDrivers, checkPossession
processOrders           RTS Land and Take off (each machine every third tick)
driveLanded, shipTick (landed on a pad), enforceRules
magnetPass              magnet forces, bonds, pull of ground magnets
flyStep (each flying)   choose goal, move
collideMachines         machine-to-machine collisions
flyLogic (each flying)  update() of every block inside the pocket
procTick, magnetCouple, netServerTick, airTick, debrisTick
inheritMachineVelocity, scanBullets, processDirty, saveRegistry
```

After the game update (afterGameUpdate) the bodies of landed machines are put back (every third tick, each machine in its own phase) and inheritMachineVelocity runs again for delayed shots.

moveFlying picks the goal in this priority: animation (m.air), builder launch, player input, RTS order (commandAI, commandGoal), craft hold, autopilot (shipGoal). Then:

```js
tvx += m.magVx || 0;                     // magnet pull is added to the target speed
var k = 1 - Math.exp(-delta * 0.12);     // velocity eases toward the target
m.vx += (tvx - m.vx) * k;  m.x += m.vx * delta;
```

Speed is flightSpeed(m): total thrust times the thrust of one rocket booster, divided by the cells. With no working engine there is no braking; the machine coasts until engineCheck drops it.

Leaking conduits: puddles are stored per Tiles object in v160.7, so a conduit that ends in empty space inside the pocket would drop its puddle at pocket coordinates. partsChanged collects such conduits in m.leakParts, and relocatePuddles (pocket.js, called from flyLogic) moves each puddle from the pocket tile in front of the conduit to the real tile under that point (merging with an existing puddle of the same liquid).

flyLogic calls setPartsReal, then inside withPocket runs fireControl and p.update() for every block in m.updList (blocks with block.update === true), then tickBoosters, reapDead (blocks killed by the game itself), stepFires and keepBody. This is the most expensive part of a tick, and it is vanilla code.

## 7. Damage, lost support and debris

scanBullets applies enemy bullets to blocks (partAtWorld, then damagePart; splash goes through splashParts). A flying ship counts as an air target: scanBullets skips bullets whose type has collidesAir false (ground-only artillery, flames), for direct hits and for splash alike. Lasers, lightning and energy fields are not bullets in the world, so they never reach the ship's blocks. Enemy units aim at the body unit in the centre, not at single blocks.

A destroyed block goes through destroyPart (explosion, removed from the pocket and from m.parts), then flyReconcile:

```js
var comps = components(alive);
var sp = splitGroups(comps, hull);
if(sp.good.length == 0){ destroyMachine(m, true); return; }   // no hull: everything falls
F.detachParts(m, sp.bad);                                      // unsupported groups fall as debris
```

Debris (impact.js): detachParts splits blocks into connected groups, and makeDebris turns each group into a record shaped like a machine (mode "fly", its own small pocket, air.kind == "fall"), so drawing and setPartsReal work unchanged. The blocks move into the new pocket as the same objects. The piece keeps the machine's velocity at the moment of detaching and falls DEBRIS_FALL_SPEEDUP times faster than a landing of the same weight. debrisTick moves it; landDebris then damages enemy units under it by block health and destroys each block with its own explosion. Clients receive pieces through netDebris and animate them with clientDebrisTick. Debris is not saved.

Wave drop zone: at the start of a wave the game damages everything of the player's within dropZoneRadius of a ground spawn. Blocks in a pocket are invisible to it, so the mod does the same for flying machines:

```js
onEvent(WaveEvent, () => { dropZoneStrike(); });
```

dropZoneStrike (server only) converts each block's tiles to world points and calls zoneHits, which returns the blocks with at least one tile inside the circle (the game's own rule). Those blocks go through detachParts and flyReconcile: whatever they held falls with them, and a machine whose hull was hit falls whole. Machines of the wave team are skipped.

### Blocks that need the real world (found by the unique-block checklist in 8.3)

A block inside the pocket sees the pocket as its world, so anything that looks outside the ship needs a bridge. The cases found so far:

- **Position of a pocket tile.** Blocks measure angles and distances to another block through `tile.getX()/getY()` (mass driver: `tile.angleTo(link)`). mkPocketTile overrides both to return the building's real position (`b.x`, `b.y`), which setPartsReal keeps at real world coordinates. Without it a mass driver aimed with pocket coordinates and shot into the sky.
- **Regeneration projector.** Its target list comes from `indexer.eachBlock`, and the block indexer does not know ship blocks. projectors.js fills `p.targets` itself (`regenTargets`: every live part within the range, measured at real positions) and sets `lastChange = world.tileChanges`, so the game's own update does the healing.
- **Payload blocks.** payloadCheck takes any `PayloadBlock` that holds a `UnitPayload` and has nothing in front that takes it (an empty front, or a block that does not accept payloads); at the exit it releases the unit into the real world (payloadRelease, with a safe-tile search for ground units, the unit cap respected). A block payload (`BuildPayload`) is never dumped by the game (`Payload.dump()` is false for it), so it stays inside, as on land.
- **Build tower.** A `BuildTurret` rebuilds plans of the real map (`team.data().plans`), so flight.js updates it outside the pocket (`m.updReal`, computed in partsChanged by `updatesInWorld`; the pocket loop skips those blocks, a second loop calls their `update()` after `withPocket`).
- **Wall miners.** BeamDrill (plasma bore) and WallCrafter (cliff crusher) read walls through `world.tile(...)`, so in flight they see the empty pocket and mine nothing. Known limit: making them read terrain below a rotating, moving ship was judged too risky (it would need real-world solidity on pocket tiles).
- Checked and needing no bridge: dome, bridge / phase conveyors, power / beam / surge nodes (links survive takeoff), heat routers, segment, doors, surge and shielded walls, repair point and tower, floor-attribute blocks.

### Mod id (8.4)

Steam publishes `meta.name` of mod.json as the Workshop title (`LoadedMod.steamTitle()`), and the game derives the mod id from it (`name.toLowerCase().replace(" ", "-")`). Until 8.3 the name was "fling-bases", so Steam showed that. Since 8.4 it is "Your custom battleship", the id is `your-custom-battleship`, and every content name (`your-custom-battleship-magnet`, ...), `require("your-custom-battleship/...")` path and bundle key carries it. Old data keeps working through three bridges (config.js `legacyBlockName`, persistence.js):

- Blocks of the map and schematics: `registerLegacyNames` fills `SaveFileReader.fallback` (old block name to new one) for every block of the mod. The game reads block names of a save through that map.
- Machine data: the custom save chunk is also registered under the old name `fling-bases-machines`, read only (`shouldWrite` and `writeNet` are false); the next save writes the new name.
- Parts inside a machine (`po.n`, in saves and in the network sync): `F.legacyBlockName` rewrites `fling-bases-*` (and the older "machine-builder-wheel").

Checked in a real server: a save made by 8.3 with a landed ship and a flying ship (and map blocks) opens in 8.4 with the same machines, parts and mode; a save made by 8.4 opens again. Unit types (the ship driver) are not covered by the game's map; the driver is created again by the machine, so nothing is lost.

## 8. Magnets (magnets.js)

- magnetPass runs once per tick: resets forces, keeps bonds (bondStep), then calls magnetOne for every free ship and every machine that ground magnets can act on. Landed machines whose team has no ground magnets are skipped.
- Opposite poles attract. The force is expressed in rocket-booster thrust and is added to the target speed (m.magVx, m.magVy).
- Docking: two magnets face to face are queued in S.magDock, then magnetCouple calls couple, which merges the lighter machine into the heavier. splitOff separates machines when a bond loses power or a magnet is destroyed.
- Ground magnets draw a hovering, idle ship in (startMagnetPull, m.air.kind == "pull"). The ship leaves only if shipThrust(m) exceeds the pull. pairsPull keeps a remembered pair only while the ship's magnet is alive and the ground magnet is still a world block.

## 9. Collisions (physics.js)

collideMachines sorts flying machines by left edge and stops the inner loop when the next machine is entirely to the right, so only nearby pairs are tested. Block circles (worldCircles) are built only for overlapping pairs; collidePair exchanges momentum (machineMass, machineMomentum).

## 10. Network, saving, UI

Network (net.js): the server runs all logic. A client runs none of the tick: netClientTick moves copies of machines and draws them. Packets: full (a whole machine, gzipped JSON in chunks), rm, air (the client plays the animation itself), state (pose, about 20 per second, unreliable), parts (turret aim, hurt blocks, fires), bullets and fx (events). Damage and explosions are server-side only.

Saving (persistence.js): machines are stored in a custom chunk of the save file (your-custom-battleship-machines: a version byte, length, UTF-8 JSON), with a compressed rules tag as fallback for game versions without custom chunks. saveRegistry runs when S.saveDirty is set; loadRegistry restores, and loadFlying rebuilds a pocket for each flying machine.

Ship panel (ship-panel.js): a BaseDialog built from Tables. compact() switches to the phone layout: one column of module cards, a bottom bar with the add-module button, wrapped texts. A card's header is its own table so a wide cell in column 0 cannot push the header buttons off screen.

Drawing (render.js, drawFlying): the shadow is drawn under units, and the blocks above the map darkness through a batch transform (translate to m.x and m.y, rotate by m.ang, translate by minus ref in tiles), inside withPocket after setPartsPocket. Body units are shrunk during the draw (shrinkBodies) so selection frames are not huge.

## 11. Performance notes

- Per-tick work that does not need every tick is spread out: processOrders runs every third tick per machine (phase offset by m.id), landed bodies are re-placed every third tick, and reapDead runs every fourth tick.
- magnetPass is one pass with a per-team cache of ground magnets; collideMachines is sort-and-sweep.
- Rhino calls into Java are costly, so cheap checks come before any call that crosses into Java.
- Most flying-machine time is vanilla block update(), which the mod cannot speed up.
- Startup time is dominated by Rhino compiling all scripts on every launch; the mod's own handlers are small by comparison.
