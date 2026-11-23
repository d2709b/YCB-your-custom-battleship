// Loads every script in dependency order. Files share functions through hub (F) and state (S).
var COMMON = ["hub", "config", "util", "state", "geometry", "boosters", "blocks", "ship-control", "machines", "pocket", "landing", "air",
    "combat", "impact", "projectors", "commands", "mobile", "control", "payloads", "flight", "physics", "magnets", "editor", "free-place", "ship-panel", "persistence", "net", "ship-builder", "loop", "debug"];
var CLIENT = ["render", "hud", "guide"];

function loadFile(name){
    try{
        require("your-custom-battleship/" + name);
    }catch(e){
        Log.err("[mb] scripts/" + name + ".js failed to load: " + e + (e && e.stack ? "\n" + e.stack : ""));
        throw e;
    }
}

COMMON.forEach(loadFile);
if(!Vars.headless) CLIENT.forEach(loadFile);
