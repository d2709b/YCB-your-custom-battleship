# Your custom battleship

A Mindustry mod (v160+) for building flying ships out of ordinary blocks. A ship is a core or storage hull plus any blocks attached to it. In flight every block keeps working (conveyors, drills, pumps, factories, generators, turrets), turrets fire together, and each block casts a shadow on the ground.

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

## Limits

- Maximum ship size is about 110 tiles across.
- Blocks under construction do not move; finish them before takeoff.
- Ground units cannot path to a core that is in the air.
- Plasma bores and cliff crushers do not mine walls while the ship flies.
- Enemies aim at the centre of a ship; lasers, lightning and energy fields (Navanax, Aegires) do not hurt its blocks; an enemy Parallax cannot pull it.
- Settings (Settings > Your custom battleship): thrust of a rocket booster and turning toward the direction of movement.
- The MB console object (scripts/debug.js) helps with debugging.
