# Your custom battleship

Author: 2709

A Mindustry mod (v160+) for building flying ships out of ordinary blocks. A ship is a core or storage hull plus any blocks attached to it. In flight every block keeps working (conveyors, drills, pumps, factories, generators, turrets), turrets fire together, and each block casts a shadow on the ground.

Install: put the mod zip into the game's mods folder, or use Mods > Import. In multiplayer the mod is needed on the server and on every client.

The in-game YCB guide (button in the bottom row of the build menu) explains every block, key and mechanic. For how the code works, see ARCHITECTURE.md.

## Concept

- A ship exists only after you make it one in build mode: place a core or storage there (or press Y on one) and attach blocks to it.
- On the ground a ship is made of normal blocks. In flight its blocks leave the map and live in a private tile array of their own, so the whole ship can move and turn freely.
- Blocks that lose their connection to the hull fall as debris. If the hull is destroyed, everything it held falls.

## Controls

- G: toggle build mode. The ship lands on the grid for editing and takes off when you leave.
- Y in build mode: move the block under the cursor between the world layer and the ship layer. Hold Y and drag a square to move many blocks.
- Y outside build mode: enter or leave a ship.
- Shift+Y: land the ship, or take it off.
- R in build mode: turn the green front arrow (Shift+R turns it the other way).
- WASD: fly. Q and E turn the ship by hand.
- Left mouse button: all turrets aim at the cursor and fire.

On a phone the ship follows the centre of the screen, and the button panel on the left has the rest of the buttons.

## Blocks

- Rocket, energy (2x2) and fuel (3x3) boosters give thrust. Ship speed is the total thrust times the thrust of one rocket booster, divided by the number of cells.
- Ship Control (2x2, Logic category) runs modules: mine an ore or liquid, rest at a point or on a landing spot, land to refuel, drill and pump rules, join other ships with magnets, preload items, processor actions, and the center the ship turns around. Modules run one after another in a loop.
- Landing Spot (1x1) is a place where ships land.
- Magnet (1x1) and Super Magnet (2x2) pull or push ships and join them face to face. Magnets on the ground can draw a hovering ship in and land it.
- Schematic Builder (16x16) prints a ship from a schematic.

In build mode, ground-bound blocks (drills, pumps, thermal generators) can be placed anywhere.

## Orders and behavior

- RTS command mode: Land, Take off, Mine, move and attack orders work on ships.
- Ships collide with mass and momentum, burn and explode, and land and take off with a shadow and dust.
- A wave's drop zone also tears off blocks of ships that hover over it.
- Every block is available on every planet, including planets of other mods.

## Ship interaction checklist (v8.2)

How vanilla mechanics behave on a flying ship. Checked in a real headless server unless noted.

- Mender and overdrive projectors: work (the overdrive gives its full boost to ship blocks).
- Force projector: works; enemy bullets are absorbed by the shield.
- Battery diode: works.
- Erekir heat: heat sources feed heat consumers on the ship, also through heat routers.
- Anti-air and anti-ground turrets: work. Ship turrets shoot ground and air enemies, enemy bullets hit ship blocks. A flying ship is an air target, so air-only shots (flak) hit it and ground-only shots (artillery, flames) pass under it. Fixed in 8.2.
- Leaking conduits: a conduit that ends in empty space leaks onto the ground below the ship. Fixed in 8.2 (the puddle used to appear at the wrong place).
- Special walls: phase walls deflect bullets; surge wall lightning and shielded walls work (see the unique-block checklist below). Plastanium wall laser absorption is not tested.
- Parallax: the ship's own Parallax works. An enemy Parallax cannot pull the ship.
- Navanax and Aegires: their lightning and energy fields do not hurt ship blocks (limit).
- Floor efficiency: buildings that depend on the floor (thermal generator, and so on) read the real floor under the ship.
- Logic blocks: processors run and sense real world coordinates.
- Enemy targeting: enemies aim at the body unit in the centre of the ship, not at single blocks (limit).

## Unique block checklist (v8.3)

Blocks that behave differently from ordinary ones, checked on the ground and on a flying ship in a real headless server (v160.7). "Fixed" means a bug found by this checklist.

| Block | On a flying ship |
|---|---|
| Overdrive dome | works |
| Bridge conveyor, phase conveyor | work (7 tiles for the phase one) |
| Power node, surge tower, beam node | work, links survive takeoff |
| Mass driver | works. Fixed in 8.3: it used to aim with pocket coordinates and shoot into the sky |
| Regeneration projector | works. Fixed in 8.3: it found no blocks to heal |
| Heat source, heat router | work, also through routers |
| Segment (point defense) | shoots down enemy bullets |
| Shockwave tower | destroys enemy bullets only (by design; it never hurt units) |
| Lancer, arc, ripple, fuse, wave | all fire and hurt enemies |
| Door, blast door | open and close; the blast door opens for friendly units |
| Surge wall, shielded wall | surge wall throws lightning; shielded wall reflects bullets |
| Repair point, unit repair tower | heal friendly units next to the ship |
| Floor-attribute blocks (turbine, vent, crucible, cultivator, extractor, pumps) | read the real floor under the ship and change it while it moves |
| Thorium reactor | explodes and destroys the blocks around it |
| Payload source, unit factories and other payload blocks | units come out into the world. Fixed in 8.3: they used to stay inside. A block payload stays inside, as on land |
| Build tower | rebuilds destroyed blocks of the real map. Fixed in 8.3: it did nothing |
| Plasma bore, cliff crusher | work on the ground; in flight they do not mine (limit) |

## Changelog

8.4
- The mod id changed from fling-bases to your-custom-battleship. Steam takes the Workshop title from the name field of mod.json, so it used to show "fling-bases"; now it shows "Your custom battleship".
- Saves, schematics and ships made by 8.3 and older open in 8.4 (block names and machine data are converted on load). Remove the old version before installing 8.4; the game treats the two ids as different mods, and a Steam Workshop item is bound to the id, so 8.4 is published as a new item.

8.3
- Found with the unique-block checklist: mass driver aimed with pocket coordinates (now with real ones), regeneration projector found no blocks to heal, payload blocks did not release units in flight, build tower did not rebuild anything in flight. All four work now.
- New German translation (English, Russian, Spanish, Simplified Chinese, French and German are complete).
- The guide lists the new limit (plasma bore and cliff crusher in flight).

8.2
- Super Magnet has new textures for all four directions and the power glow.
- Flying ships are air targets: ground-only artillery and flames no longer damage them.
- Leaking conduits put their puddle on the real ground under the ship.
- New French translation (English, Russian, Spanish, Simplified Chinese and French are complete).
- The guide describes the new rules and the limits above.

## Limits

- Maximum ship size is about 110 tiles across.
- Blocks under construction do not move; finish them before takeoff.
- Ground units cannot path to a core that is in the air.
- Plasma bores and cliff crushers do not mine walls while the ship flies.
- Enemies aim at the centre of a ship; lasers, lightning and energy fields (Navanax, Aegires) do not hurt its blocks; an enemy Parallax cannot pull it.
- Settings (Settings > Your custom battleship): thrust of a rocket booster and turning toward the direction of movement.
- The MB console object (scripts/debug.js) helps with debugging.
