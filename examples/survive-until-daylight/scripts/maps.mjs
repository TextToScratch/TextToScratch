// Builds src/lib/maps.ts from the two hand-drawn maps below and checks them (sizes, pallet gaps, stairs, reachability).
// Run from examples/survive-until-daylight: node scripts/maps.mjs
//
// Legend:  .  open        #  wall A (field: corn / house: wallpaper)   W  wall B (field: shack planks / house: wood panels)
//          R  wall C (field: stone / house: brick)   X  exit gate   D  daylight (outside the gates)   E  escape (walk in = escaped)
//          U  stairs up (walk in from the south)     V  stairs down (walk in from the north)
//          T  tree   o  rock   h  hay bale   f  furniture   G  generator   H  hook   P  pallet   S  survivor spawn   K  killer spawn
// Tiles in the generated map string: 0 open, 1-3 walls, 4 gate, 5 daylight, 6 stairs up, 7 stairs down, 8 solid prop, 9 generator.
// The house is two floors stacked in one grid: rows 0-23 are the ground floor, rows 24-47 upstairs. Stairs up at (x, y) lead to
// (x, y + 23) upstairs; the stairs down right behind that at (x, y + 24) lead back to (x, y + 1).
import fs from "node:fs";

const W = 28;

const FIELD_IN = [
  "T...T......T.....h....T..T",
  ".........RRPRR............",
  "........R...R....T...G....",
  ".T..H...R.G.R........H..T.",
  "....................RRPRR.",
  "...RPRR.....T.......R.....",
  "...R.......WWWPWWW..R.....",
  "...R..T....W.....W........",
  ".G.R.......W..G..P...T....",
  "......H....W.....W....H...",
  "..T........WW.WWWW........",
  ".......T............T.....",
  "....RRPRR.....H.......T...",
  "........R..........RRPRR..",
  ".T..G...R....T......G.R...",
  "...........h..........R...",
  "..T..H...........H.......T",
  ".....RRRPRR...T.......K...",
  "SS.......R........T.......",
  "SS..T........RRPRR....T...",
  "........H........R....h...",
  "T....T.......T...G....T..T",
];

function buildField() {
  const rows = [];
  rows.push("D".repeat(W));
  rows.push("#".repeat(13) + "DED" + "#".repeat(12));
  rows.push("#".repeat(14) + "X" + "#".repeat(13));
  for (const r of FIELD_IN) rows.push("#" + r + "#");
  rows.push("#".repeat(13) + "X" + "#".repeat(14));
  rows.push("#".repeat(12) + "DED" + "#".repeat(13));
  rows.push("D".repeat(W));
  return rows;
}

const HOUSE_G = [
  "f......#......#.....ff",
  "..G....#..H...#.......",
  ".......P......P....G..",
  "..f....#......#...U...",
  ".......#......#.......",
  "...H...#......#..H....",
  ".......#......#.......",
  "f..........f.........f",
  "###.####......####.###",
  "......................",
  "S.S...................",
  "S.S..................K",
  "###P####......####P###",
  ".......#..#U#.#.......",
  "..G....#......#...G...",
  ".......#......#.......",
  "...f...P..H...P...f...",
  ".......#......#.......",
  "..H....#......#....H..",
  ".......#..ff..#.......",
  "f.............#......f",
  "ff.....#...........fff",
];
const HOUSE_U = [
  "f.....#.......#......f",
  "..G...#...H...#.......",
  "......P.......P.......",
  "...f..#.......#...V...",
  "......#.......#.......",
  "..H...#.......#...H...",
  "#####.#.......#.######",
  "......................",
  "....f.................",
  "......................",
  "####.##.......##.#####",
  "......#.......#.......",
  "......#.......#.......",
  "..G...#...#V#.P...G...",
  "......#.......#.......",
  "...H..P.......#.......",
  "......#.......#.......",
  "f.....#...H...#.....f.",
  "......#.......#.......",
  "..ff..#.......#..ff...",
  "f.............#......f",
  "ff....#.......#.....ff",
];

function buildHouse() {
  const rows = [];
  rows.push("R".repeat(W));
  for (let i = 0; i < 22; i++) {
    const y = i + 1;
    let left = "RRR", right = "RRR";
    if (y === 10 || y === 12) { left = "RDR"; right = "RDR"; }
    if (y === 11) { left = "DEX"; right = "XED"; }
    rows.push(left + HOUSE_G[i] + right);
  }
  rows.push("R".repeat(W));
  rows.push("R".repeat(W));
  for (let i = 0; i < 22; i++) rows.push("RRR" + HOUSE_U[i] + "RRR");
  rows.push("R".repeat(W));
  return rows;
}

function compile(name, rows, house) {
  const H = rows.length;
  rows.forEach((r, i) => { if (r.length !== W) throw new Error(`${name} row ${i} has ${r.length} columns`); });
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? "R" : rows[y][x]);
  const tile = { ".": 0, "#": 1, W: 2, R: 3, X: 4, D: 5, U: 6, V: 7, E: 0, T: 8, o: 8, h: 8, f: 8, G: 9, H: 0, P: 0, S: 0, K: 0 };
  const isWall = (ch) => "#WRXDUV".includes(ch);
  const solid = (ch) => isWall(ch) || "Tohf G".includes(ch);
  let map = "";
  const out = { GENS: [], HOOKS: [], PALS: [], PALAX: [], DEC_C: [], DEC_K: [], SPAWN: [], KSPAWN: [], GATES: [], GATEIN: [], ESC: [], STAIR_FROM: [], STAIR_TO: [], STAIR_ANG: [] };
  let treeN = 0, furnN = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x];
      if (!(ch in tile)) throw new Error(`${name}: unknown tile '${ch}' at ${x},${y}`);
      map += tile[ch];
      const c = x + y * W;
      if (ch === "G") out.GENS.push(c);
      if (ch === "H") out.HOOKS.push(c);
      if (ch === "S") out.SPAWN.push(c);
      if (ch === "K") out.KSPAWN.push(c);
      if (ch === "E") out.ESC.push(c);
      if (ch === "T") { out.DEC_C.push(c); out.DEC_K.push(treeN++ % 3); }
      if (ch === "o") { out.DEC_C.push(c); out.DEC_K.push(3); }
      if (ch === "h") { out.DEC_C.push(c); out.DEC_K.push(4); }
      if (ch === "f") { out.DEC_C.push(c); out.DEC_K.push(5 + (furnN++ % 4)); }
      if (ch === "P") {
        // axis 0: walls above and below, so the gap runs east-west and a dropped pallet blocks x movement
        const ns = solid(at(x, y - 1)) && solid(at(x, y + 1));
        const ew = solid(at(x - 1, y)) && solid(at(x + 1, y));
        if (ns === ew) throw new Error(`${name}: pallet at ${x},${y} is not in a one-way gap`);
        out.PALS.push(c);
        out.PALAX.push(ns ? 0 : 1);
      }
      if (ch === "X") {
        out.GATES.push(c);
        let inner = -1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = at(x + dx, y + dy);
          if (n !== "E" && !solid(n)) inner = x + dx + (y + dy) * W;
        }
        if (inner < 0) throw new Error(`${name}: gate at ${x},${y} has no inside cell`);
        out.GATEIN.push(inner);
      }
      if (ch === "U") {
        if (!house) throw new Error("stairs outside the house");
        const to = x + (y + 23) * W, back = x + (y + 24) * W;
        if (rows[y + 23][x] === undefined || solid(rows[y + 23][x])) throw new Error(`${name}: stairs up at ${x},${y} land on a wall`);
        if (rows[y + 24][x] !== "V") throw new Error(`${name}: stairs up at ${x},${y} have no stairs down at ${x},${y + 24}`);
        if (solid(rows[y + 1][x])) throw new Error(`${name}: stairs up at ${x},${y} have no landing below`);
        out.STAIR_FROM.push(c); out.STAIR_TO.push(to); out.STAIR_ANG.push(270);
        out.STAIR_FROM.push(back); out.STAIR_TO.push(x + (y + 1) * W); out.STAIR_ANG.push(90);
      }
    }
  // reachability from the survivor spawn (stairs teleport, pallets and gates count as open)
  const seen = new Set();
  const q = [out.SPAWN[0]];
  seen.add(out.SPAWN[0]);
  const walk = (ch) => !solid(ch) || ch === "U" || ch === "V" || ch === "X";
  while (q.length) {
    const c = q.shift();
    const x = c % W, y = Math.floor(c / W);
    const si = out.STAIR_FROM.indexOf(c);
    const next = si >= 0 ? [out.STAIR_TO[si]] : [c - 1, c + 1, c - W, c + W];
    for (const n of next) {
      const ch = rows[Math.floor(n / W)][n % W];
      if (!seen.has(n) && walk(ch)) { seen.add(n); q.push(n); }
    }
  }
  let lost = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solid(rows[y][x]) && !seen.has(x + y * W)) { lost++; console.log(`${name}: unreachable ${x},${y}`); }
  // every generator and hook must be reachable next to it
  for (const g of out.GENS) if (![g - 1, g + 1, g - W, g + W].some((n) => seen.has(n))) throw new Error(`${name}: generator ${g} unreachable`);
  for (const k of ["SPAWN", "KSPAWN", "HOOKS", "ESC"]) for (const c of out[k]) if (!seen.has(c)) throw new Error(`${name}: ${k} cell ${c} unreachable`);
  if (out.GENS.length !== 7) throw new Error(`${name}: ${out.GENS.length} generators (want 7)`);
  if (out.SPAWN.length !== 4 || out.KSPAWN.length !== 1 || out.GATES.length !== 2) throw new Error(`${name}: spawns/gates`);
  console.log(`${name}: ${W}x${H}, gens ${out.GENS.length}, hooks ${out.HOOKS.length}, pallets ${out.PALS.length}, props ${out.DEC_C.length}, stairs ${out.STAIR_FROM.length}, unreachable ${lost}`);
  return { map, H, out };
}

const maps = [compile("field", buildField(), false), compile("house", buildHouse(), true)];
let ts = "// Generated by scripts/maps.mjs: the two maps (0 the field, 1 the house) and their objects (cell = x + y * 28).\n";
const PFX = ["F_", "H_"];
maps.forEach((m, i) => {
  ts += `export const ${PFX[i]}H = ${m.H};\n`;
  ts += `export const ${PFX[i]}MAP = "${m.map}";\n`;
  for (const [k, v] of Object.entries(m.out)) ts += `export const ${PFX[i]}${k}: number[] = [${v.join(", ")}];\n`;
});
fs.writeFileSync("src/lib/maps.ts", ts);
if (process.argv.includes("--show")) maps.forEach((m) => { for (let y = 0; y < m.H; y++) console.log(m.map.slice(y * W, y * W + W)); console.log(); });
