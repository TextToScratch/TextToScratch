// Generates Survive Until Daylight's art. Run from examples/survive-until-daylight: node scripts/art.mjs
// - View/w0001..w1760.png : wall texture column slices (11 textures x 5 aspect ratios x 32 columns)
// - View/y###_*.svg       : billboards (survivors, killers, props), HUD pieces, menus
// - Weapon, Stage, Chat, Thumbnail costumes
import fs from "node:fs";
import zlib from "node:zlib";

const out = (p, data) => {
  fs.mkdirSync("src/" + p.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync("src/" + p, data);
};
const svg = (W, H, body, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
for (const d of ["View", "Weapon", "Stage", "Chat", "Thumbnail"]) fs.rmSync("src/" + d, { recursive: true, force: true });

// ---------------------------------------------------------------- PNG encoder
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = px(x, y);
    raw.set([r, g, b, a].map((v) => Math.max(0, Math.min(255, Math.round(v)))), y * (w * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- textures (32 x 64 RGBA)
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const TW = 32, TH = 64;
function valueNoise(scale) {
  const gw = Math.ceil(TW / scale) + 1, gh = Math.ceil(TH / scale) + 1;
  const g = Array.from({ length: gw * gh }, rnd);
  return (x, y) => {
    const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const at = (a, b) => g[(a % (gw - 1)) + Math.min(b, gh - 1) * gw];
    const s = (t) => t * t * (3 - 2 * t);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * s(tx), bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * s(tx);
    return top + (bot - top) * s(ty);
  };
}
const make = (f) => Array.from({ length: TW * TH }, (_, i) => f(i % TW, Math.floor(i / TW)));
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k, c[3] ?? 255];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];

function wallpaper() {
  const n = valueNoise(6);
  return make((x, y) => {
    if (y >= 40) { // wainscot: dark wood panel with a rail
      if (y === 40 || y === 41) return mul([170, 118, 70], y === 40 ? 1.25 : 0.7);
      const inset = (x % 16 === 2 || x % 16 === 13 || y === 45 || y === 59) ? 0.7 : 1;
      return mul([140, 92, 58], inset * (0.85 + n(x, y) * 0.25) * (y > 61 ? 0.6 : 1));
    }
    const stripe = x % 8 < 4 ? [150, 92, 96] : [124, 74, 82];
    const dot = ((x % 8 === 6 && (y % 10 === 3 || y % 10 === 5)) || (x % 8 === 5 && y % 10 === 4) || (x % 8 === 7 && y % 10 === 4)) ? 1.6 : 1;
    const stain = n(x + 9, y) > 0.72 ? 0.8 : 1;
    const peel = y < 6 ? 0.75 : 1;
    return mul(stripe, dot * stain * peel * (0.9 + rnd() * 0.12));
  });
}
function woodPanel() {
  const grain = valueNoise(4);
  return make((x, y) => {
    const board = Math.floor(x / 8);
    const base = [[150, 102, 62], [136, 90, 54], [160, 110, 68], [142, 96, 58]][board];
    if (x % 8 === 0) return mul(base, 0.45);
    const g = 0.85 + 0.15 * Math.sin(y * 0.5 + grain(x, y) * 8 + board * 2) + (rnd() - 0.5) * 0.08;
    const knot = Math.hypot(x % 8 - 4, (y + board * 17) % 40 - 20) < 1.6 ? 0.5 : 1;
    return mul(base, g * knot * (y > 60 ? 0.6 : 1));
  });
}
function brick() {
  const n1 = valueNoise(6), n2 = valueNoise(3);
  const shade = Array.from({ length: 40 }, () => 0.8 + rnd() * 0.35);
  return make((x, y) => {
    const row = Math.floor(y / 8), off = row % 2 ? 8 : 0, id = row * 2 + Math.floor(((x + off) % 32) / 16);
    if (y % 8 >= 7 || (x + off) % 16 === 15) return mul([70, 66, 60], 0.85 + rnd() * 0.2);
    const ivy = n1(x, y) > 0.66 && y < 40 ? [46, 70, 40] : null;
    return mul(ivy ?? [150, 76, 56], shade[id] * (y % 8 === 0 ? 1.12 : 1) * (0.88 + n2(x, y) * 0.24));
  });
}
function corn() {
  const stalks = Array.from({ length: 6 }, (_, i) => [i * 5.5 + rnd() * 3, 0.8 + rnd() * 0.4]);
  const n = valueNoise(5);
  return make((x, y) => {
    let c = mixc([14, 20, 30], [30, 46, 28], Math.min(1, y / 14)); // night sky fading into dense leaves
    if (y > 10) c = mul([42, 64, 30], 0.6 + n(x, y) * 0.5);
    for (const [sx, k] of stalks) {
      const d = Math.abs(x - sx - Math.sin(y / 9) * 1.2);
      if (d < 1.2 && y > 4) c = mul([150, 140, 70], k * (0.7 + (y / 64) * 0.4));
      if (y > 14 && y < 50 && (y + Math.round(sx * 3)) % 13 < 2 && x > sx && x < sx + 6) c = mul([90, 120, 50], k); // leaves
      if (y >= 14 && y < 26 && Math.abs(x - sx - 2) < 1.5 && (y + Math.round(sx)) % 22 < 7) c = mul([214, 186, 90], k); // cobs
    }
    if (y < 6 && rnd() < 0.3) c = mul([170, 150, 90], 0.8); // tassels
    return mul(c, y > 56 ? 0.6 : 1);
  });
}
function planks() {
  const grain = valueNoise(4);
  return make((x, y) => {
    const row = Math.floor(y / 9);
    if (y % 9 === 0) return [24, 18, 14, 255];
    const base = [[104, 92, 76], [92, 82, 70], [112, 98, 80], [86, 78, 66], [98, 88, 72], [108, 94, 78], [90, 80, 66], [96, 86, 70]][row];
    const nail = (x === 3 || x === 28) && y % 9 === 4 ? 0.4 : 1;
    const g = 0.85 + 0.15 * Math.sin(x * 0.7 + grain(x, y) * 7 + row) + (rnd() - 0.5) * 0.1;
    return mul(base, g * nail);
  });
}
function stone() {
  const n = valueNoise(4), n2 = valueNoise(2);
  return make((x, y) => {
    const cell = Math.floor((x + (Math.floor(y / 12) % 2) * 9) / 14) + Math.floor(y / 12) * 3;
    const edge = y % 12 === 0 || (x + (Math.floor(y / 12) % 2) * 9) % 14 === 0;
    if (edge) return mul([40, 42, 44], 0.9 + rnd() * 0.2);
    const k = 0.75 + ((cell * 37) % 10) / 30 + n2(x, y) * 0.15;
    const moss = n(x, y) > 0.7 ? [70, 90, 56] : [116, 116, 112];
    return mul(moss, k * (y > 58 ? 0.7 : 1));
  });
}
function gate() {
  return make((x, y) => {
    if (y < 10) { // housing with the EXIT light
      if (y > 2 && y < 8 && x > 9 && x < 22) return [230, 60, 40, 255];
      return mul([60, 62, 66], 0.9 + rnd() * 0.15);
    }
    if (x < 3 || x > 28) return mul([74, 78, 84], x === 1 || x === 30 ? 1.3 : 1);
    const bar = x % 6 === 3;
    const cross = y % 18 === 14;
    if (bar || cross) return mul([118, 124, 130], 0.9 + rnd() * 0.2);
    if (y > 50 && Math.floor((x + y) / 4) % 2 === 0) return [196, 160, 40, 255]; // hazard stripes
    return mul([40, 44, 48], 0.8 + rnd() * 0.2);
  });
}
function daylight() {
  return make((x, y) => {
    const t = y / 64;
    let c = mixc([255, 236, 190], [255, 200, 140], t);
    if (y > 40 && Math.abs(x - 16 - Math.sin(y) * 2) < 3 + (y - 40) / 6) c = mixc(c, [210, 170, 120], 0.4);
    return c;
  });
}
function stairsUp() {
  return make((x, y) => {
    if (x < 3 || x > 28) return mul([60, 40, 26], 0.9 + rnd() * 0.1); // posts
    if (y < 18) return mul([18, 14, 12], 1); // dark upstairs
    const step = Math.floor((y - 18) / 6);
    const tread = (y - 18) % 6 < 2;
    const k = 0.45 + step * 0.08;
    if (x === 6 || x === 25) return mul([120, 84, 50], k + 0.2); // banister spindles
    return mul(tread ? [140, 100, 64] : [90, 62, 40], k * (0.9 + rnd() * 0.15));
  });
}
function stairsDown() {
  return make((x, y) => {
    if (x < 3 || x > 28) return mul([60, 40, 26], 0.9 + rnd() * 0.1);
    if (y < 34) return mul([22, 18, 16], 1); // wall behind the stairwell
    if (y < 37) return mul([96, 66, 42], 1.1); // railing
    const step = Math.floor((y - 37) / 7);
    const tread = (y - 37) % 7 < 2;
    const k = 0.7 - step * 0.15;
    return mul(tread ? [140, 100, 64] : [80, 56, 36], Math.max(0.15, k) * (0.9 + rnd() * 0.15));
  });
}
function palletDown() {
  const grain = valueNoise(4);
  return make((x, y) => {
    if (y < 40) return [0, 0, 0, 0];
    const slat = Math.floor((x + 1) / 8) % 2 === 0 || y > 58 || y < 43;
    if (!slat) return y > 52 ? [24, 18, 12, 255] : [0, 0, 0, 0];
    const base = y < 43 ? [150, 112, 66] : [128, 94, 56];
    const g = 0.85 + 0.15 * Math.sin(y * 1.3 + grain(x, y) * 9);
    return mul(base, g * (y === 40 || x % 8 === 7 ? 0.6 : 1));
  });
}
const TEX = [wallpaper(), woodPanel(), brick(), corn(), planks(), stone(), gate(), daylight(), stairsUp(), stairsDown(), palletDown()];
const RATIOS = [2, 4, 8, 16, 32];
let idx = 0;
for (let t = 0; t < TEX.length; t++)
  for (const r of RATIOS)
    for (let s = 0; s < 32; s++) {
      idx++;
      const w = 64 / r;
      out(`View/w${String(idx).padStart(4, "0")}.png`, png(w, 64, (_x, y) => TEX[t][s + y * TW]));
    }

// ---------------------------------------------------------------- shared SVG helpers
const Y = [];
const addY = (name, body) => { Y.push(name); out(`View/y${String(Y.length).padStart(3, "0")}_${name}.svg`, body); };
const grad = (id, light, dark) => `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${dark}"/><stop offset=".55" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
const vgrad = (id, top, bot) => `<linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient>`;
const radial = (id, inner, outer, o1 = 1, o2 = 0) => `<radialGradient id="${id}"><stop offset="0" stop-color="${inner}" stop-opacity="${o1}"/><stop offset="1" stop-color="${outer}" stop-opacity="${o2}"/></radialGradient>`;
const T = (x, y, size, text, fill = "#F4F1E6", anchor = "middle", extra = "", family = "Sans Serif") =>
  `<text x="${x}" y="${y}" font-family="${family}" font-weight="bold" font-size="${size}" text-anchor="${anchor}" fill="${fill}" stroke="#0A0C0E" stroke-width="${(size / 7).toFixed(1)}" paint-order="stroke" stroke-linejoin="round" ${extra}>${text}</text>`;
const darken = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};

// ---------------------------------------------------------------- survivors (160 x 160, feet at the bottom)
export const SURV = [
  { name: "MAX RIVERA", skin: "#C98F62", hair: "#4A2E1C", hs: "short", top: "#C83A32", style: "hoodie", pants: "#3A5A8A", shoes: "#EEE", acc: null },
  { name: "LILY CHEN", skin: "#F0CBA4", hair: "#16141A", hs: "ponytail", top: "#F2C230", style: "raincoat", pants: "#2E4E7A", shoes: "#C8322A", acc: null },
  { name: "ROSA DIAZ", skin: "#8E5A3A", hair: "#1E1410", hs: "bun", top: "#3AA8A0", style: "scrubs", pants: "#3AA8A0", shoes: "#FFF", acc: null },
  { name: "THEO PARK", skin: "#EAC09A", hair: "#2A2018", hs: "short", top: "#3A7A3A", style: "flannel", pants: "#5A4A3A", shoes: "#3A2A1A", acc: "beanie" },
  { name: "JIN SATO", skin: "#E8C4A0", hair: "#121216", hs: "spiky", top: "#22222A", style: "leather", pants: "#30303A", shoes: "#111", acc: null },
  { name: "AVA BROOKS", skin: "#F6D2B8", hair: "#E8C860", hs: "long", top: "#7A4AB0", style: "sweater", pants: "#2A2A3A", shoes: "#8A5A3A", acc: null },
  { name: "SAM OKAFOR", skin: "#5E3A26", hair: "#141010", hs: "short", top: "#E8782A", style: "vest", pants: "#4A4A52", shoes: "#EEE", acc: "cap" },
  { name: "KAI MORENO", skin: "#B07A52", hair: "#2A1A12", hs: "short", top: "#2AB0B8", style: "tank", pants: "#222A3A", shoes: "#F2F2F2", acc: "headband" },
  { name: "NIA PATEL", skin: "#9A6440", hair: "#0E0C10", hs: "long", top: "#E85A9A", style: "jacket", pants: "#2E3A5A", shoes: "#FFF", acc: "glasses" },
  { name: "LEO NOVAK", skin: "#F2C8A8", hair: "#C0582A", hs: "short", top: "#4A6A9A", style: "denim", pants: "#2A2E3A", shoes: "#5A3A22", acc: "bandana" },
];
const SURV_PERK = [
  ["SPRINT BURST", "Press Q: run 60% faster for 3 seconds.", "40 second cooldown."],
  ["MECHANIC", "Repair generators 30% faster.", "Skill checks are a little easier."],
  ["MEDIC", "Heal teammates twice as fast.", "Pick up downed teammates quicker."],
  ["SELF-CARE", "Hold F to heal yourself", "when injured (slowly)."],
  ["QUICK HANDS", "Vault and drop pallets faster.", "Your pallet stuns last longer."],
  ["BOND", "See your teammates' auras", "through walls at all times."],
  ["LIFELINE", "Unhook teammates 3x faster.", "They come off the hook healthy."],
  ["DEAD HARD", "While injured, press Q to dash", "and dodge one hit. 50s cooldown."],
  ["SPINE CHILL", "An eye warns you when the killer", "is close and looking your way."],
  ["DECISIVE STRIKE", "Wiggle free from the killer", "twice as fast."],
];

function hairShape(p, view, hx, hy) {
  const h = p.hair;
  if (view === "back") {
    let s = `<ellipse cx="${hx}" cy="${hy - 1}" rx="14" ry="15" fill="${h}"/>`;
    if (p.hs === "long") s += `<path d="M${hx - 14} ${hy} q-2 24 4 30 h20 q6 -6 4 -30z" fill="${h}"/>`;
    if (p.hs === "ponytail") s += `<path d="M${hx - 4} ${hy + 4} q-2 18 4 26 q6 -8 4 -26z" fill="${h}"/>`;
    if (p.hs === "bun") s += `<circle cx="${hx}" cy="${hy - 12}" r="7" fill="${h}"/>`;
    if (p.hs === "spiky") s += `<path d="M${hx - 14} ${hy - 4} l-4 -8 l8 2 l2 -10 l6 8 l4 -10 l4 10 l6 -8 l2 10 l8 -2 l-4 8z" fill="${h}"/>`;
    return s;
  }
  if (view === "side") {
    let s = `<path d="M${hx - 14} ${hy + 2} q-1 -18 15 -17 q12 1 13 12 q-8 -4 -14 -2 q-4 6 -6 14z" fill="${h}"/>`;
    if (p.hs === "long") s += `<path d="M${hx - 14} ${hy} q-4 22 2 28 h10 q-2 -14 0 -26z" fill="${h}"/>`;
    if (p.hs === "ponytail") s += `<path d="M${hx - 14} ${hy - 2} q-12 6 -10 22 q8 -6 10 -18z" fill="${h}"/>`;
    if (p.hs === "bun") s += `<circle cx="${hx - 10}" cy="${hy - 12}" r="6" fill="${h}"/>`;
    if (p.hs === "spiky") s += `<path d="M${hx - 14} ${hy - 4} l-2 -10 l7 4 l2 -10 l6 8 l5 -8 l2 10 l8 -2z" fill="${h}"/>`;
    return s;
  }
  let s = "";
  s += `<path d="M${hx - 14} ${hy - 1} q0 -17 14 -17 q14 0 14 17 q-6 -8 -14 -8 q-8 0 -14 8z" fill="${h}"/>`;
  if (p.hs === "spiky") s += `<path d="M${hx - 14} ${hy - 6} l-3 -10 l8 3 l3 -11 l6 8 l4 -9 l3 9 l7 -6 l0 10 l6 1z" fill="${h}"/>`;
  if (p.hs === "bun") s += `<circle cx="${hx}" cy="${hy - 18}" r="7" fill="${h}"/>`;
  if (p.hs === "ponytail") s += `<path d="M${hx + 12} ${hy - 8} q10 4 8 20 q-6 -6 -8 -12z" fill="${h}"/>`;
  return s;
}
function accessory(p, view, hx, hy) {
  const a = p.acc;
  if (a === "beanie") return `<path d="M${hx - 15} ${hy - 4} q0 -19 15 -19 q15 0 15 19z" fill="#6A6A72"/><rect x="${hx - 16}" y="${hy - 7}" width="32" height="6" rx="3" fill="#56565E"/><circle cx="${hx}" cy="${hy - 23}" r="3.5" fill="#8A8A92"/>`;
  if (a === "cap") {
    if (view === "back") return `<path d="M${hx - 15} ${hy - 4} q0 -17 15 -17 q15 0 15 17z" fill="#2A4AA8"/>`;
    if (view === "side") return `<path d="M${hx - 15} ${hy - 4} q0 -17 15 -17 q15 0 15 17z" fill="#2A4AA8"/><path d="M${hx + 12} ${hy - 5} h14 q0 4 -14 4z" fill="#1E3680"/>`;
    return `<path d="M${hx - 15} ${hy - 4} q0 -17 15 -17 q15 0 15 17z" fill="#2A4AA8"/><path d="M${hx - 14} ${hy - 5} q14 -4 28 0 q-14 8 -28 0z" fill="#1E3680"/><circle cx="${hx}" cy="${hy - 13}" r="3" fill="#F2F2F2"/>`;
  }
  if (a === "headband") return `<rect x="${hx - 15}" y="${hy - 10}" width="30" height="5" rx="2" fill="#F2F2F2"/>${view === "back" ? `<path d="M${hx} ${hy - 8} l-6 12 M${hx} ${hy - 8} l5 12" stroke="#F2F2F2" stroke-width="3"/>` : ""}`;
  if (a === "bandana") return `<path d="M${hx - 15} ${hy - 6} q15 -8 30 0 v-5 q-15 -9 -30 0z" fill="#C8322A"/>${view !== "front" ? `<path d="M${hx - 14} ${hy - 8} l-8 8 l3 2z" fill="#C8322A"/>` : ""}`;
  if (a === "glasses" && view === "front") return `<g fill="none" stroke="#1A1A1A" stroke-width="1.8"><circle cx="${hx - 5}" cy="${hy + 1}" r="4.2"/><circle cx="${hx + 5}" cy="${hy + 1}" r="4.2"/><path d="M${hx - 1} ${hy + 1} h2"/></g>`;
  if (a === "glasses" && view === "side") return `<circle cx="${hx + 9}" cy="${hy + 1}" r="4" fill="none" stroke="#1A1A1A" stroke-width="1.8"/>`;
  return "";
}
function head(p, view, hx, hy, scared = false) {
  const sk = p.skin, skD = darken(p.skin, 0.72);
  let s = `<rect x="${hx - 5}" y="${hy + 10}" width="10" height="10" fill="${skD}"/>`;
  if (view === "back") return s + `<ellipse cx="${hx}" cy="${hy}" rx="13" ry="14" fill="${sk}" stroke="${skD}" stroke-width="1.5"/>` + hairShape(p, view, hx, hy) + accessory(p, view, hx, hy);
  if (view === "side") {
    s += `<ellipse cx="${hx}" cy="${hy}" rx="13" ry="14" fill="${sk}" stroke="${skD}" stroke-width="1.5"/><path d="M${hx + 12} ${hy - 1} l4 5 l-4 1z" fill="${sk}" stroke="${skD}"/>`;
    s += `<ellipse cx="${hx + 7}" cy="${hy}" rx="2" ry="2.6" fill="#1A1414"/><path d="M${hx + 4} ${hy - 5} l6 -1" stroke="${darken(p.hair, 0.9)}" stroke-width="2"/>`;
    s += `<path d="M${hx + 6} ${hy + 8} h5" stroke="#5A2A22" stroke-width="1.5"/><ellipse cx="${hx - 3}" cy="${hy + 1}" rx="3" ry="4" fill="${skD}"/>`;
    return s + hairShape(p, view, hx, hy) + accessory(p, view, hx, hy);
  }
  if (p.hs === "long") s = `<path d="M${hx - 16} ${hy - 4} q0 -14 16 -14 q16 0 16 14 v26 q0 6 -6 6 h-20 q-6 0 -6 -6z" fill="${p.hair}"/>` + s;
  s += `<ellipse cx="${hx}" cy="${hy}" rx="13" ry="14" fill="${sk}" stroke="${skD}" stroke-width="1.5"/>`;
  s += `<ellipse cx="${hx - 13}" cy="${hy + 1}" rx="2.5" ry="4" fill="${sk}" stroke="${skD}"/><ellipse cx="${hx + 13}" cy="${hy + 1}" rx="2.5" ry="4" fill="${sk}" stroke="${skD}"/>`;
  s += `<ellipse cx="${hx - 5}" cy="${hy + 1}" rx="2.6" ry="${scared ? 3.6 : 3}" fill="#FFF"/><ellipse cx="${hx + 5}" cy="${hy + 1}" rx="2.6" ry="${scared ? 3.6 : 3}" fill="#FFF"/>`;
  s += `<circle cx="${hx - 5}" cy="${hy + 1.5}" r="1.6" fill="#1A1414"/><circle cx="${hx + 5}" cy="${hy + 1.5}" r="1.6" fill="#1A1414"/>`;
  s += `<path d="M${hx - 8} ${hy - 4} l5 ${scared ? -2 : 1} M${hx + 8} ${hy - 4} l-5 ${scared ? -2 : 1}" stroke="${darken(p.hair, 0.9)}" stroke-width="1.8" stroke-linecap="round"/>`;
  s += scared ? `<ellipse cx="${hx}" cy="${hy + 8}" rx="3" ry="3.5" fill="#5A2A22"/>` : `<path d="M${hx - 4} ${hy + 8} q4 -2 8 0" stroke="#5A2A22" stroke-width="1.6" fill="none"/>`;
  if (p.name === "LEO NOVAK") s += `<g fill="#C8784A" opacity=".6"><circle cx="${hx - 7}" cy="${hy + 5}" r=".9"/><circle cx="${hx - 4}" cy="${hy + 6}" r=".9"/><circle cx="${hx + 5}" cy="${hy + 6}" r=".9"/><circle cx="${hx + 8}" cy="${hy + 5}" r=".9"/></g>`;
  return s + hairShape(p, view, hx, hy) + accessory(p, view, hx, hy);
}
function torso(p, view, top) {
  const c = p.top, d = darken(p.top, 0.62);
  const shape = view === "side" ? `M68 ${top} q12 -4 24 0 l2 52 h-28z` : `M58 ${top} Q80 ${top - 6} 102 ${top} L100 100 H60 Z`;
  let s = `<path d="${shape}" fill="${c}" stroke="${d}" stroke-width="2"/>`;
  const st = p.style;
  if (view === "front") {
    if (st === "hoodie") s += `<path d="M70 ${top} q10 12 20 0" fill="none" stroke="${d}" stroke-width="2"/><path d="M76 ${top + 6} v10 M84 ${top + 6} v10" stroke="#EEE" stroke-width="1.5"/><path d="M68 84 h24 v10 h-24z" fill="${d}" opacity=".5"/>`;
    if (st === "raincoat") s += `<path d="M80 ${top} V100" stroke="${d}" stroke-width="2"/><g fill="#3A3A3A"><circle cx="76" cy="62" r="1.6"/><circle cx="76" cy="74" r="1.6"/><circle cx="76" cy="86" r="1.6"/></g>`;
    if (st === "scrubs") s += `<path d="M72 ${top} l8 12 l8 -12" fill="none" stroke="${d}" stroke-width="2"/><rect x="64" y="66" width="10" height="8" fill="${d}" opacity=".5"/>`;
    if (st === "flannel") s += `<g stroke="${d}" stroke-width="2" opacity=".8"><path d="M60 62 h40 M60 76 h40 M60 90 h40 M70 ${top} v52 M90 ${top} v52"/></g><path d="M80 ${top} V100" stroke="#1E3A1E" stroke-width="1.5"/>`;
    if (st === "leather") s += `<path d="M80 ${top} V100" stroke="#888" stroke-width="2"/><path d="M66 ${top} l10 16 M94 ${top} l-10 16" stroke="#44444C" stroke-width="3"/><path d="M76 ${top + 2} h8 v14 h-8z" fill="#D0D0D0"/>`;
    if (st === "sweater") s += `<path d="M60 92 h40 v8 h-40z" fill="${d}"/><path d="M72 ${top} q8 6 16 0" fill="none" stroke="${d}" stroke-width="3"/>`;
    if (st === "vest") s += `<path d="M75 ${top} h10 v54 h-10z" fill="#F2F2F2"/><path d="M60 70 h40" stroke="#F2E85A" stroke-width="3"/><path d="M60 82 h40" stroke="#F2E85A" stroke-width="3"/>`;
    if (st === "tank") s += `<path d="M70 ${top - 2} v-2 M90 ${top - 2} v-2" stroke="${d}"/><path d="M68 ${top} q12 10 24 0" fill="${p.skin}"/>`;
    if (st === "jacket") s += `<path d="M80 ${top} V100" stroke="#FFF" stroke-width="2"/><path d="M64 70 h10 M86 70 h10" stroke="${d}" stroke-width="2"/>`;
    if (st === "denim") s += `<path d="M80 ${top} V100" stroke="${d}" stroke-width="2"/><rect x="64" y="60" width="11" height="9" fill="none" stroke="#D8C080" stroke-width="1.2"/><rect x="85" y="60" width="11" height="9" fill="none" stroke="#D8C080" stroke-width="1.2"/>`;
  } else if (view === "back") {
    if (st === "hoodie") s += `<path d="M66 ${top - 2} q14 18 28 0 q-4 14 -14 14 q-10 0 -14 -14z" fill="${d}"/>`;
    if (st === "raincoat") s += `<path d="M64 ${top - 2} q16 16 32 0 q-2 12 -16 12 q-14 0 -16 -12z" fill="${d}"/>`;
    if (st === "flannel") s += `<g stroke="${d}" stroke-width="2" opacity=".8"><path d="M60 62 h40 M60 76 h40 M60 90 h40 M70 ${top} v52 M90 ${top} v52"/></g>`;
    if (st === "vest") s += `<path d="M60 70 h40 M60 82 h40" stroke="#F2E85A" stroke-width="3"/>`;
    if (st === "denim") s += `<path d="M62 64 h36" stroke="#D8C080" stroke-width="1.2"/>`;
    if (st === "leather") s += `<path d="M64 60 h32 M64 80 h32" stroke="#36363E" stroke-width="2"/>`;
  }
  return s;
}
function legs(p, view, step, crawl = false) {
  const c = p.pants, d = darken(p.pants, 0.6), sh = p.shoes, shD = darken(p.shoes, 0.55);
  const shorts = p.style === "tank";
  const leg = (x, dx, lift) => {
    const top = 98, bot = 148 - lift;
    let s = `<path d="M${x - 8} ${top} h16 l${-1 + dx} ${bot - top} h-14z" fill="${c}" stroke="${d}" stroke-width="1.5"/>`;
    if (shorts) s = `<path d="M${x - 8} ${top} h16 l-1 22 h-14z" fill="${c}" stroke="${d}" stroke-width="1.5"/><path d="M${x - 6} 120 h12 l${-1 + dx} ${bot - 120} h-10z" fill="${p.skin}" stroke="${darken(p.skin, 0.72)}" stroke-width="1.2"/>`;
    s += `<path d="M${x - 9 + dx} ${bot - 2} h17 q3 0 3 6 v4 h-21z" fill="${sh}" stroke="${shD}" stroke-width="1.5"/>`;
    return s;
  };
  if (view === "side") {
    const a = step * 8;
    return `<g transform="rotate(${a} 80 98)">${leg(80, 4, 0)}</g><g transform="rotate(${-a} 80 98)">${leg(80, 4, 0)}</g>`;
  }
  const L = step * 4;
  return leg(70, 0, Math.max(0, L)) + leg(90, 0, Math.max(0, -L));
}
function arms(p, view, step, top, pose) {
  const c = p.top, d = darken(p.top, 0.62), sk = p.skin, skD = darken(p.skin, 0.72);
  const bare = p.style === "tank";
  const sleeve = bare ? sk : c, sleeveD = bare ? skD : d;
  if (pose === "up") { // holding on (hooked): arms raised to the hook above
    return [-1, 1].map((s) => `<path d="M${80 + 20 * s} ${top + 4} L${80 + 12 * s} ${top - 34} L${80 + 4 * s} ${top - 34} L${80 + 10 * s} ${top + 8}Z" fill="${sleeve}" stroke="${sleeveD}" stroke-width="1.5"/><circle cx="${80 + 8 * s}" cy="${top - 37}" r="5" fill="${sk}" stroke="${skD}"/>`).join("");
  }
  if (view === "side") {
    const a = -step * 14;
    return `<g transform="rotate(${a} 80 ${top + 4})"><path d="M74 ${top + 2} h12 l-1 34 h-10z" fill="${sleeve}" stroke="${sleeveD}" stroke-width="1.5"/><circle cx="80" cy="${top + 40}" r="5.5" fill="${sk}" stroke="${skD}"/></g>`;
  }
  return [-1, 1].map((s) => {
    const sw = step * s * 4;
    const sx = 80 + 22 * s;
    return `<path d="M${sx - 5} ${top + 2} L${sx + 5} ${top + 2} L${sx + 4 * s + 2} ${top + 38 + sw} L${sx + 4 * s - 8} ${top + 38 + sw}Z" fill="${sleeve}" stroke="${sleeveD}" stroke-width="1.5"/><circle cx="${sx + 4 * s - 3}" cy="${top + 42 + sw}" r="5.5" fill="${sk}" stroke="${skD}"/>`;
  }).join("");
}
function survivorBody(p, view, pose) {
  const step = pose === "a" ? 1 : pose === "b" ? -1 : 0;
  const top = 50;
  let s = `<ellipse cx="80" cy="156" rx="28" ry="5" fill="#000" opacity=".35"/>`;
  const hv = view === "front" ? "front" : view === "back" ? "back" : "side";
  if (view === "back") s += arms(p, "back", step, top) + legs(p, "back", step) + torso(p, "back", top) + head(p, "back", 80, 32);
  else if (view === "side") s += arms(p, "side", -step, top) + legs(p, "side", step) + torso(p, "side", top) + head(p, "side", 80, 32) + arms(p, "side", step, top);
  else s += legs(p, "front", step) + torso(p, "front", top) + head(p, "front", 80, 32, pose === "scared") + arms(p, "front", step, top);
  return s;
}
function survivorSvg(p, view, pose) {
  if (view === "right") return svg(160, 160, `<g transform="translate(160 0) scale(-1 1)">${survivorBody(p, "side", pose)}</g>`);
  if (view === "left") return svg(160, 160, survivorBody(p, "side", pose));
  if (view === "down") { // crawling on the ground, reaching forward
    const b = survivorBody(p, "front", "scared").replace(/<ellipse cx="80" cy="156"[^>]*>/, "");
    return svg(160, 160, `<ellipse cx="80" cy="154" rx="70" ry="6" fill="#000" opacity=".3"/><g transform="translate(80 128) rotate(-80) scale(0.95) translate(-80 -88)">${b}</g>`);
  }
  if (view === "hooked") { // hanging from the hook by the jacket, holding on
    const step = 0;
    const top = 50;
    const b = legs(p, "front", step) + torso(p, "front", top) + head(p, "front", 80, 32, true) + arms(p, "front", 0, top, "up");
    return svg(160, 160, `<g transform="translate(0 6)">${b}</g>`);
  }
  return svg(160, 160, survivorBody(p, view, pose));
}
SURV.forEach((p, i) => {
  for (const [v, pose] of [["front", "a"], ["front", "b"], ["back", "a"], ["back", "b"], ["left", "a"], ["left", "b"], ["right", "a"], ["right", "b"], ["down", ""], ["hooked", ""]])
    addY(`s${i}_${v}${pose}`, survivorSvg(p, v, pose));
});

// ---------------------------------------------------------------- killers (160 x 160, drawn ~15% taller than survivors)
export const KILL = [
  { name: "THE BUTCHER", coat: "#4A3A2E", coatD: "#261C14", pants: "#3A3028", mask: "hockey", weapon: "cleaver" },
  { name: "THE DOLL", coat: "#2A2234", coatD: "#120E18", pants: "#1E1A26", mask: "doll", weapon: "knife" },
  { name: "THE SCARECROW", coat: "#5A4A2A", coatD: "#2E2614", pants: "#3E3420", mask: "sack", weapon: "sickle" },
];
const KILL_POWER = [
  ["RAMPAGE", "Press Q: charge 35% faster for 4s.", "Brutal Strength: break pallets and kick generators 2x faster."],
  ["VANISH", "Press Q: turn invisible for 8s, with no heartbeat.", "Discordance: see survivors working on generators."],
  ["CROW SIGHT", "Press Q: crows reveal every survivor for 5s.", "Iron Grasp: survivors wiggle free 40% slower."],
];
function mask(k, view, hx, hy) {
  if (view === "back") {
    if (k.mask === "sack") return `<ellipse cx="${hx}" cy="${hy}" rx="15" ry="16" fill="#B89A62" stroke="#6A5430" stroke-width="2"/><path d="M${hx - 14} ${hy + 10} q14 6 28 0" stroke="#5A4426" stroke-width="3" fill="none"/><path d="M${hx - 22} ${hy - 6} h44 l-6 -6 h-32z" fill="#8A6A3A" stroke="#4A3A1E"/>`;
    if (k.mask === "doll") return `<ellipse cx="${hx}" cy="${hy}" rx="14" ry="15" fill="#1A1218"/><path d="M${hx - 14} ${hy} q-4 24 4 32 h20 q8 -8 4 -32z" fill="#1A1218"/><path d="M${hx - 6} ${hy - 12} q6 -6 12 0" stroke="#C8323A" stroke-width="4" fill="none"/>`;
    return `<ellipse cx="${hx}" cy="${hy}" rx="14" ry="15" fill="#3A2A20"/><path d="M${hx - 14} ${hy - 2} h28" stroke="#E8E4D8" stroke-width="3"/>`;
  }
  if (view === "side") {
    if (k.mask === "sack") return `<ellipse cx="${hx}" cy="${hy}" rx="15" ry="16" fill="#B89A62" stroke="#6A5430" stroke-width="2"/><circle cx="${hx + 8}" cy="${hy - 2}" r="2.6" fill="#120E08"/><path d="M${hx + 4} ${hy + 8} h9" stroke="#3A2A12" stroke-width="2" stroke-dasharray="2 1.5"/><path d="M${hx - 22} ${hy - 8} h44 l-6 -6 h-30z" fill="#8A6A3A" stroke="#4A3A1E"/>`;
    if (k.mask === "doll") return `<ellipse cx="${hx}" cy="${hy}" rx="13" ry="15" fill="#F4EEE6" stroke="#B8AEA4" stroke-width="1.5"/><circle cx="${hx + 7}" cy="${hy - 1}" r="2.2" fill="#120E10"/><circle cx="${hx + 6}" cy="${hy + 6}" r="2.6" fill="#E8A0A8" opacity=".7"/><path d="M${hx - 14} ${hy - 6} q-4 26 2 32 h10 q-4 -14 2 -30z" fill="#1A1218"/>`;
    return `<ellipse cx="${hx}" cy="${hy}" rx="13" ry="15" fill="#ECE8DC" stroke="#9A968A" stroke-width="1.5"/><ellipse cx="${hx + 7}" cy="${hy - 2}" rx="2.4" ry="3" fill="#0E0C0A"/><path d="M${hx - 13} ${hy - 4} h-4 M${hx - 13} ${hy + 4} h-4" stroke="#3A2A20" stroke-width="2"/>`;
  }
  if (k.mask === "sack") return `<ellipse cx="${hx}" cy="${hy}" rx="15" ry="16" fill="#B89A62" stroke="#6A5430" stroke-width="2"/>` +
    `<path d="M${hx - 9} ${hy - 3} l5 -3 l1 6z M${hx + 9} ${hy - 3} l-5 -3 l-1 6z" fill="#120E08"/><circle cx="${hx - 5}" cy="${hy - 1}" r="1.2" fill="#F2E85A"/><circle cx="${hx + 5}" cy="${hy - 1}" r="1.2" fill="#F2E85A"/>` +
    `<path d="M${hx - 8} ${hy + 8} q8 4 16 0" stroke="#3A2A12" stroke-width="2" fill="none"/><path d="M${hx - 6} ${hy + 6} v5 M${hx - 2} ${hy + 7} v5 M${hx + 2} ${hy + 7} v5 M${hx + 6} ${hy + 6} v5" stroke="#3A2A12" stroke-width="1.5"/>` +
    `<path d="M${hx - 13} ${hy + 10} q13 7 26 0" stroke="#5A4426" stroke-width="3" fill="none"/><path d="M${hx - 24} ${hy - 9} h48 l-8 -5 h-32z" fill="#8A6A3A" stroke="#4A3A1E" stroke-width="1.5"/><path d="M${hx - 14} ${hy - 14} q14 -14 28 0z" fill="#8A6A3A" stroke="#4A3A1E" stroke-width="1.5"/>` +
    `<path d="M${hx - 22} ${hy - 8} l-4 6 M${hx + 22} ${hy - 8} l4 6 M${hx - 16} ${hy - 8} l-2 7" stroke="#D8B860" stroke-width="1.5"/>`;
  if (k.mask === "doll") return `<path d="M${hx - 15} ${hy - 4} q-5 30 3 36 h24 q8 -6 3 -36z" fill="#1A1218"/><ellipse cx="${hx}" cy="${hy}" rx="13" ry="15" fill="#F4EEE6" stroke="#B8AEA4" stroke-width="1.5"/>` +
    `<ellipse cx="${hx - 5}" cy="${hy - 1}" rx="3.4" ry="3" fill="#120E10"/><ellipse cx="${hx + 5}" cy="${hy - 1}" rx="3.4" ry="3" fill="#120E10"/><circle cx="${hx - 5}" cy="${hy - 1}" r="1" fill="#E8E0F0"/><circle cx="${hx + 5}" cy="${hy - 1}" r="1" fill="#E8E0F0"/>` +
    `<circle cx="${hx - 8}" cy="${hy + 6}" r="2.8" fill="#E8A0A8" opacity=".75"/><circle cx="${hx + 8}" cy="${hy + 6}" r="2.8" fill="#E8A0A8" opacity=".75"/><path d="M${hx - 2} ${hy + 9} q2 1.5 4 0" stroke="#A82A3A" stroke-width="2" fill="none"/>` +
    `<path d="M${hx + 4} ${hy - 13} l-3 6 l3 4 l-2 5" stroke="#8A8078" stroke-width="1" fill="none"/><path d="M${hx - 15} ${hy - 6} q4 -14 15 -14 q11 0 15 14 q-8 -6 -15 -6 q-7 0 -15 6z" fill="#1A1218"/><path d="M${hx - 7} ${hy - 15} q7 -8 14 0" stroke="#C8323A" stroke-width="4" fill="none"/>`;
  return `<ellipse cx="${hx}" cy="${hy}" rx="13" ry="15" fill="#ECE8DC" stroke="#9A968A" stroke-width="1.5"/>` +
    `<path d="M${hx - 9} ${hy - 4} q4 -3 7 0 q-1 4 -3.5 4 q-3 0 -3.5 -4z M${hx + 9} ${hy - 4} q-4 -3 -7 0 q1 4 3.5 4 q3 0 3.5 -4z" fill="#0E0C0A"/>` +
    `<g fill="#3A3630"><circle cx="${hx - 4}" cy="${hy + 6}" r="1"/><circle cx="${hx}" cy="${hy + 7}" r="1"/><circle cx="${hx + 4}" cy="${hy + 6}" r="1"/><circle cx="${hx - 2}" cy="${hy + 10}" r="1"/><circle cx="${hx + 2}" cy="${hy + 10}" r="1"/><circle cx="${hx}" cy="${hy - 10}" r="1"/></g>` +
    `<path d="M${hx - 11} ${hy - 9} l4 -3 l3 3 M${hx + 11} ${hy - 9} l-4 -3 l-3 3" stroke="#C8323A" stroke-width="2" fill="none"/><path d="M${hx - 13} ${hy - 2} h-4 M${hx + 13} ${hy - 2} h4" stroke="#3A2A20" stroke-width="2.5"/>`;
}
function weaponSvg(k, x, y, rot, scale = 1) {
  const g = (b) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">${b}</g>`;
  if (k.weapon === "cleaver") return g(`<rect x="-3" y="-4" width="6" height="22" rx="2" fill="#4A2E1A" stroke="#1E120A"/><path d="M-4 -4 v-32 h22 q4 0 4 4 v28z" fill="#B8BCC4" stroke="#3A3C42" stroke-width="1.5"/><path d="M14 -36 q4 0 4 4 v28 h-4z" fill="#E8ECF2"/><circle cx="2" cy="-30" r="2.4" fill="#3A3C42"/>`);
  if (k.weapon === "knife") return g(`<rect x="-3" y="-2" width="6" height="18" rx="2" fill="#2A1A1E" stroke="#0E0A0A"/><rect x="-6" y="-4" width="12" height="3" fill="#8A8A90"/><path d="M-3 -4 L-2 -40 L4 -30 L3 -4Z" fill="#D8DCE4" stroke="#5A5C64" stroke-width="1.2"/>`);
  return g(`<rect x="-3" y="-4" width="6" height="22" rx="2" fill="#6A4A2A" stroke="#2A1A0A"/><path d="M-2 -4 V-14 q0 -22 24 -24 q-18 6 -18 24 V-4z" fill="#9AA0A8" stroke="#3A3C42" stroke-width="1.5"/>`);
}
function killerBody(k, view, pose) {
  const step = pose === "a" ? 1 : pose === "b" ? -1 : 0;
  const c = k.coat, d = k.coatD, pc = k.pants, pd = darken(k.pants, 0.6), sk = "#D8C8B0", glove = "#1E1A18";
  let s = `<ellipse cx="80" cy="156" rx="34" ry="6" fill="#000" opacity=".4"/>`;
  const legsK = view === "side"
    ? [1, -1].map((m) => `<g transform="rotate(${step * 8 * m} 80 100)"><path d="M72 100 h16 l-1 48 h-14z" fill="${pc}" stroke="${pd}" stroke-width="1.5"/><path d="M70 146 h22 q3 0 3 6 v4 h-25z" fill="#1A1410"/></g>`).join("")
    : [70, 90].map((x, i) => { const lift = Math.max(0, (i ? -1 : 1) * step * 4); return `<path d="M${x - 9} 100 h18 l-1 ${48 - lift} h-16z" fill="${pc}" stroke="${pd}" stroke-width="1.5"/><path d="M${x - 10} ${146 - lift} h20 q3 0 3 6 v4 h-23z" fill="#1A1410"/>`; }).join("");
  const top = 46;
  const body = view === "side"
    ? `<path d="M64 ${top} q16 -6 32 0 l2 58 h-36z" fill="${c}" stroke="${d}" stroke-width="2"/>`
    : `<path d="M54 ${top} Q80 ${top - 8} 106 ${top} L104 104 H56 Z" fill="${c}" stroke="${d}" stroke-width="2"/>` +
      (k.mask === "doll" && view === "front" ? `<path d="M56 104 l-6 30 h60 l-6 -30z" fill="${d}"/><path d="M74 ${top} l6 10 l6 -10" fill="#E8E4E8"/>` : "") +
      (k.mask === "scarecrow" || k.mask === "sack" ? `<path d="M56 100 l-2 10 l6 -4 l4 8 l4 -8 l6 6 l4 -6 l6 8 l4 -8 l6 6 l4 -8 l4 6 l0 -10z" fill="${c}"/><path d="M60 ${top + 6} l-6 -6 M100 ${top + 6} l6 -6" stroke="#D8B860" stroke-width="2"/>` : "") +
      (k.mask === "hockey" && view === "front" ? `<path d="M80 ${top} V104" stroke="${d}" stroke-width="2"/><rect x="64" y="70" width="10" height="10" fill="${d}"/><rect x="86" y="70" width="10" height="10" fill="${d}"/>` : "");
  let armsK = "";
  const w = weaponSvg(k, 0, 0, 0);
  if (view === "back") {
    armsK = [-1, 1].map((m) => `<path d="M${80 + 24 * m} ${top + 2} l${4 * m} 40 h${-10 * m} l${-4 * m} -38z" fill="${c}" stroke="${d}" stroke-width="1.5"/>`).join("");
    s += legsK + body + armsK + mask(k, "back", 80, 28);
  } else if (view === "side") {
    const armA = pose === "atk" ? -120 : -step * 12;
    s += legsK + body + mask(k, "side", 80, 28) +
      `<g transform="rotate(${armA} 80 ${top + 4})"><path d="M73 ${top + 2} h14 l-1 38 h-12z" fill="${c}" stroke="${d}" stroke-width="1.5"/><circle cx="80" cy="${top + 42}" r="6" fill="${glove}"/>${weaponSvg(k, 80, top + 44, 90, 1.1)}</g>`;
  } else if (pose === "atk") {
    s += legsK + body + mask(k, "front", 80, 28) +
      `<path d="M58 ${top + 2} l-8 38 h10 l6 -36z" fill="${c}" stroke="${d}" stroke-width="1.5"/><circle cx="54" cy="${top + 42}" r="6" fill="${glove}"/>` +
      `<path d="M102 ${top + 2} l18 -34 l8 6 l-16 34z" fill="${c}" stroke="${d}" stroke-width="1.5"/><circle cx="124" cy="${top - 30}" r="6.5" fill="${glove}"/>` + weaponSvg(k, 124, top - 30, -30, 1.25) +
      `<path d="M134 ${top - 50} q14 20 4 44" stroke="#FFF" stroke-width="3" opacity=".5" fill="none"/>`;
  } else if (pose === "stun") {
    s += legsK + body + mask(k, "front", 80, 32) +
      [-1, 1].map((m) => `<path d="M${80 + 24 * m} ${top + 2} L${80 + 18 * m} ${top - 14} L${80 + 10 * m} ${top - 14} L${80 + 14 * m} ${top + 6}Z" fill="${c}" stroke="${d}" stroke-width="1.5"/><circle cx="${80 + 12 * m}" cy="${top - 16}" r="6" fill="${glove}"/>`).join("") +
      [0, 1, 2, 3].map((i) => { const a = i * 90 + 20, r = 26; return `<path d="M${80 + Math.cos(a * Math.PI / 180) * r} ${10 + Math.sin(a * Math.PI / 180) * 7} l2 -5 l2 5 l5 1 l-4 3 l1 5 l-4 -3 l-4 3 l1 -5 l-4 -3z" fill="#FFE860" stroke="#7A5A0A" stroke-width=".8"/>`; }).join("");
  } else {
    armsK = `<path d="M56 ${top + 2} l${-6 - step * 2} 40 h10 l${4 + step * 2} -38z" fill="${c}" stroke="${d}" stroke-width="1.5"/><circle cx="${53 - step * 2}" cy="${top + 44}" r="6" fill="${glove}"/>` +
      `<path d="M104 ${top + 2} l${6 + step * 2} 40 h-10 l${-4 - step * 2} -38z" fill="${c}" stroke="${d}" stroke-width="1.5"/><circle cx="${107 + step * 2}" cy="${top + 44}" r="6" fill="${glove}"/>` + weaponSvg(k, 107 + step * 2, top + 44, 160, 1.1);
    s += legsK + body + mask(k, "front", 80, 28) + armsK;
  }
  return s;
}
function killerSvg(k, view, pose) {
  if (view === "right") return svg(160, 160, `<g transform="translate(160 0) scale(-1 1)">${killerBody(k, "side", pose)}</g>`);
  if (view === "left") return svg(160, 160, killerBody(k, "side", pose));
  return svg(160, 160, killerBody(k, view, pose));
}
KILL.forEach((k, i) => {
  for (const [v, pose] of [["front", "a"], ["front", "b"], ["back", "a"], ["back", "b"], ["left", "a"], ["left", "b"], ["right", "a"], ["right", "b"], ["front", "atk"], ["front", "stun"]])
    addY(`k${i}_${v}${pose}`, killerSvg(k, v, pose));
});

// ---------------------------------------------------------------- props
const genSvg = (state) => {
  // state: 0 off, 1/2 running (pistons up/down), 3 done (lamp on)
  const lamp = state === 3 ? "#FFF2A0" : state > 0 ? "#B8A060" : "#4A4430";
  const pist = state === 1 ? -6 : 0;
  return svg(160, 160,
    (state === 3 ? `<circle cx="80" cy="34" r="46" fill="url(#gl)"/>` : "") +
    `<ellipse cx="80" cy="156" rx="60" ry="6" fill="#000" opacity=".4"/>` +
    `<rect x="26" y="78" width="108" height="76" rx="6" fill="url(#gb)" stroke="#1A1C1E" stroke-width="3"/>` +
    `<rect x="36" y="${60 + pist}" width="14" height="22" fill="#6A6E74" stroke="#1A1C1E" stroke-width="2"/><rect x="58" y="${62 - pist}" width="14" height="20" fill="#6A6E74" stroke="#1A1C1E" stroke-width="2"/>` +
    `<path d="M88 78 v-40 h24 v40" fill="none" stroke="#3A3C40" stroke-width="5"/><rect x="92" y="${44 + pist}" width="16" height="12" fill="#5A5E64" stroke="#1A1C1E"/>` +
    `<rect x="70" y="20" width="20" height="10" fill="#2A2C30"/><path d="M80 30 v48" stroke="#2A2C30" stroke-width="4"/><circle cx="80" cy="24" r="9" fill="${lamp}" stroke="#2A2C30" stroke-width="3"/>` +
    `<path d="M34 96 h92 M34 112 h92" stroke="#2A2E30" stroke-width="2"/><rect x="44" y="122" width="72" height="20" rx="3" fill="#1E2022"/>` +
    [0, 1, 2, 3, 4].map((i) => `<rect x="${50 + i * 13}" y="127" width="8" height="10" fill="${state === 3 ? "#7CE05A" : state > 0 && i < 3 ? "#E0C04A" : "#3A3C30"}"/>`).join("") +
    (state === 2 ? `<path d="M52 56 l4 -8 l3 6 l4 -9" stroke="#FFE8A0" stroke-width="2" fill="none"/>` : ""),
    grad("gb", "#8A7E5E", "#4A4230") + radial("gl", "#FFF6C0", "#FFE070", 0.8, 0));
};
for (let s = 0; s < 4; s++) addY(`gen${s}`, genSvg(s));
addY("hook", svg(160, 160, `<ellipse cx="80" cy="156" rx="26" ry="5" fill="#000" opacity=".4"/>` +
  `<path d="M70 156 L76 18 L84 18 L90 156Z" fill="url(#hk)" stroke="#1A1A1C" stroke-width="2"/><path d="M60 156 l20 -26 l20 26z" fill="#3A3C40" stroke="#1A1A1C" stroke-width="2"/>` +
  `<path d="M76 20 h34 v8 h-26" fill="#5A5E66" stroke="#1A1A1C" stroke-width="2"/><path d="M104 28 v10 q0 14 -12 14 q-10 0 -10 -10 l6 -2 q0 5 4 5 q5 0 5 -7 v-10z" fill="#9AA0A8" stroke="#2A2C30" stroke-width="2"/>`,
  grad("hk", "#6A6E76", "#2A2C30")));
addY("pallet_up", svg(160, 160, `<ellipse cx="80" cy="156" rx="26" ry="4" fill="#000" opacity=".35"/>` +
  `<g transform="rotate(-8 80 156)"><rect x="56" y="40" width="48" height="116" fill="none"/>` +
  [0, 1, 2, 3, 4, 5].map((i) => `<rect x="54" y="${44 + i * 19}" width="52" height="12" fill="#A0764A" stroke="#4A3018" stroke-width="1.5"/>`).join("") +
  `<rect x="58" y="40" width="9" height="118" fill="#8A6038" stroke="#4A3018" stroke-width="1.5"/><rect x="93" y="40" width="9" height="118" fill="#8A6038" stroke="#4A3018" stroke-width="1.5"/></g>`));
const tree = (kind) => {
  if (kind === 0) return svg(160, 240, `<ellipse cx="80" cy="236" rx="40" ry="6" fill="#000" opacity=".45"/><rect x="72" y="170" width="16" height="68" fill="#4A3220" stroke="#22160C" stroke-width="2"/>` +
    [0, 1, 2, 3].map((i) => `<path d="M${80 - 64 + i * 10} ${190 - i * 42} L80 ${110 - i * 40} L${80 + 64 - i * 10} ${190 - i * 42}Z" fill="${["#1E3A26", "#22422A", "#28502E", "#2E5A34"][i]}" stroke="#0E1E12" stroke-width="2"/>`).join(""));
  if (kind === 1) return svg(160, 240, `<ellipse cx="80" cy="236" rx="34" ry="6" fill="#000" opacity=".45"/>` +
    `<path d="M70 238 L74 120 L60 80 L66 78 L78 112 L82 60 L76 30 L84 30 L88 70 L100 50 L106 54 L90 96 L88 140 L104 110 L110 114 L90 160 L92 238Z" fill="#3A2E28" stroke="#1A1410" stroke-width="2"/>`);
  return svg(160, 240, `<ellipse cx="80" cy="236" rx="40" ry="6" fill="#000" opacity=".45"/><path d="M70 238 L72 150 h16 L90 238Z" fill="#4A3622" stroke="#22160C" stroke-width="2"/>` +
    `<circle cx="80" cy="96" r="52" fill="#25452A" stroke="#0E1E12" stroke-width="2"/><circle cx="52" cy="128" r="30" fill="#2A4E2E" stroke="#0E1E12" stroke-width="2"/><circle cx="108" cy="124" r="32" fill="#2A4E2E" stroke="#0E1E12" stroke-width="2"/><circle cx="80" cy="70" r="30" fill="#30583A"/>`);
};
for (let k = 0; k < 3; k++) addY(`tree${k}`, tree(k));
addY("rock", svg(160, 160, `<ellipse cx="80" cy="154" rx="64" ry="7" fill="#000" opacity=".4"/><path d="M18 154 L26 104 L56 74 L98 70 L132 96 L144 154Z" fill="url(#rk)" stroke="#202224" stroke-width="3"/><path d="M56 74 l10 30 l40 6 M98 70 l8 40" stroke="#3A3C40" stroke-width="2" fill="none"/>`, grad("rk", "#8A8C90", "#4A4C50")));
addY("hay", svg(160, 160, `<ellipse cx="80" cy="154" rx="64" ry="7" fill="#000" opacity=".4"/><rect x="18" y="86" width="124" height="68" rx="12" fill="url(#hy)" stroke="#6A5420" stroke-width="3"/>` +
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${26 + i * 15} 92 l4 56" stroke="#A88A3A" stroke-width="2"/>`).join("") + `<path d="M18 108 h124 M18 132 h124" stroke="#6A4A1E" stroke-width="4"/>`, grad("hy", "#E0C470", "#A88A3A")));
const furn = [
  // armchair
  svg(160, 160, `<ellipse cx="80" cy="154" rx="58" ry="6" fill="#000" opacity=".4"/><rect x="30" y="54" width="100" height="70" rx="18" fill="#6A2A30" stroke="#2A0E10" stroke-width="3"/><rect x="20" y="88" width="30" height="56" rx="10" fill="#7A3238" stroke="#2A0E10" stroke-width="3"/><rect x="110" y="88" width="30" height="56" rx="10" fill="#7A3238" stroke="#2A0E10" stroke-width="3"/><rect x="44" y="106" width="72" height="34" rx="6" fill="#8A3A40" stroke="#2A0E10" stroke-width="3"/><path d="M30 144 v10 M130 144 v10" stroke="#2A1A10" stroke-width="5"/>`),
  // dresser with a candle
  svg(160, 160, `<ellipse cx="80" cy="154" rx="58" ry="6" fill="#000" opacity=".4"/><circle cx="104" cy="44" r="20" fill="url(#cg)"/><rect x="28" y="66" width="104" height="86" rx="4" fill="url(#dr)" stroke="#22140A" stroke-width="3"/>` +
    [0, 1, 2].map((i) => `<rect x="36" y="${74 + i * 26}" width="88" height="20" rx="2" fill="#5A3A22" stroke="#22140A" stroke-width="2"/><circle cx="80" cy="${84 + i * 26}" r="3" fill="#C8A040"/>`).join("") +
    `<rect x="100" y="48" width="8" height="18" fill="#EEE8D8"/><path d="M104 38 q4 6 0 10 q-4 -4 0 -10z" fill="#FFC040"/>`, grad("dr", "#6A4428", "#3A2412") + radial("cg", "#FFE080", "#FFB040", 0.7, 0)),
  // grandfather clock
  svg(160, 160, `<ellipse cx="80" cy="154" rx="30" ry="5" fill="#000" opacity=".4"/><rect x="56" y="10" width="48" height="144" rx="4" fill="url(#dr2)" stroke="#22140A" stroke-width="3"/><circle cx="80" cy="36" r="16" fill="#E8E0C8" stroke="#22140A" stroke-width="2"/><path d="M80 36 v-10 M80 36 l7 4" stroke="#22140A" stroke-width="2"/><rect x="66" y="62" width="28" height="70" fill="#2A180C"/><path d="M80 64 v40" stroke="#C8A040" stroke-width="2"/><circle cx="80" cy="108" r="7" fill="#C8A040"/>`, grad("dr2", "#5A3A20", "#2A1A0C")),
  // table with an old lamp
  svg(160, 160, `<ellipse cx="80" cy="154" rx="58" ry="6" fill="#000" opacity=".4"/><circle cx="80" cy="60" r="28" fill="url(#cg2)"/><rect x="22" y="94" width="116" height="12" rx="3" fill="#6A4428" stroke="#22140A" stroke-width="3"/><path d="M32 106 v48 M128 106 v48" stroke="#4A2E18" stroke-width="7"/>` +
    `<path d="M70 94 h20 l-4 -14 h-12z" fill="#3A3A40"/><path d="M64 80 h32 l-8 -24 h-16z" fill="#E8D8A0" stroke="#5A4A20" stroke-width="2"/>`, radial("cg2", "#FFE8A0", "#FFC860", 0.6, 0)),
];
furn.forEach((f, i) => addY(`furn${i}`, f));
addY("fx_dust", svg(64, 64, `<circle cx="32" cy="34" r="22" fill="url(#d1)"/><circle cx="20" cy="28" r="12" fill="url(#d1)"/><circle cx="44" cy="40" r="12" fill="url(#d1)"/>`, radial("d1", "#C8B8A0", "#8A7E6A", 0.85, 0)));
addY("fx_spark", svg(64, 64, `<circle cx="32" cy="32" r="26" fill="url(#sp)"/><path d="M32 6 L36 26 L56 22 L38 34 L50 54 L32 40 L14 54 L26 34 L8 22 L28 26Z" fill="#FFE070"/><circle cx="32" cy="32" r="7" fill="#FFF"/>`, radial("sp", "#FFC040", "#FF6020", 0.8, 0)));
addY("fx_crow", svg(64, 64, `<path d="M10 30 q12 -14 22 0 q10 -14 22 0 q-10 -4 -14 4 l-8 6 l-8 -6 q-4 -8 -14 -4z" fill="#14121A" stroke="#000"/><circle cx="34" cy="32" r="1.5" fill="#E8D040"/>`));
// aura markers (drawn through walls)
addY("aura_noise", svg(64, 64, `<circle cx="32" cy="32" r="28" fill="url(#an)"/><path d="M32 8 L37 26 L56 22 L40 34 L50 54 L32 42 L14 54 L24 34 L8 22 L27 26Z" fill="#FFE070" stroke="#7A5A0A" stroke-width="2"/>`, radial("an", "#FFE070", "#FFB020", 0.7, 0)));
addY("aura_exit", svg(96, 48, `<rect x="4" y="6" width="88" height="36" rx="6" fill="#0E2A12" stroke="#7CF05A" stroke-width="3"/>` + T(48, 33, 22, "EXIT", "#9CFF7A")));
addY("aura_up", svg(40, 40, `<circle cx="20" cy="20" r="17" fill="#0B0E10" opacity=".7"/><path d="M20 8 L31 24 H24 V32 H16 V24 H9Z" fill="#F4F1E6"/>`));
addY("aura_down", svg(40, 40, `<circle cx="20" cy="20" r="17" fill="#0B0E10" opacity=".7"/><path d="M20 32 L31 16 H24 V8 H16 V16 H9Z" fill="#F4F1E6"/>`));

// ---------------------------------------------------------------- HUD
for (let d = 0; d <= 9; d++) addY(`d${d}`, svg(20, 28, T(10, 24, 26, d)));
addY("dcolon", svg(12, 28, T(6, 23, 24, ":")));
const panel = (w, h, inner, stroke = "#C8C2A8") => svg(w, h, `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="#0B0E10" opacity=".78" stroke="${stroke}" stroke-opacity=".55" stroke-width="2"/>${inner}`);
// survivor portraits (head and shoulders, 44 x 44) and killer portraits
SURV.forEach((p, i) => addY(`face${i}`, svg(44, 44, `<circle cx="22" cy="22" r="21" fill="#1A1E22" stroke="#C8C2A8" stroke-width="1.5"/><g transform="translate(22 24) scale(0.62) translate(-80 -34)"><path d="M54 66 Q80 52 106 66 L108 80 H52Z" fill="${p.top}"/>${head(p, "front", 80, 32)}</g>`)));
KILL.forEach((k, i) => addY(`kface${i}`, svg(44, 44, `<circle cx="22" cy="22" r="21" fill="#2A0E10" stroke="#E85A4A" stroke-width="1.5"/><g transform="translate(22 24) scale(0.62) translate(-80 -30)"><path d="M50 62 Q80 48 110 62 L112 80 H48Z" fill="${k.coat}"/>${mask(k, "front", 80, 28)}</g>`)));
// survivor state icons (28 x 28)
const icon = (inner, ring = "#C8C2A8") => svg(28, 28, `<circle cx="14" cy="14" r="13" fill="#0B0E10" opacity=".8" stroke="${ring}" stroke-width="1.5"/>${inner}`);
addY("st_healthy", icon(`<path d="M14 22 l-7 -7 q-3 -4 0 -7 q4 -3 7 1 q3 -4 7 -1 q3 3 0 7z" fill="#7CC444"/>`, "#7CC444"));
addY("st_injured", icon(`<path d="M14 22 l-7 -7 q-3 -4 0 -7 q4 -3 7 1 q3 -4 7 -1 q3 3 0 7z" fill="#E8A030"/><path d="M8 11 l12 6" stroke="#F4F1E6" stroke-width="3"/>`, "#E8A030"));
addY("st_down", icon(`<circle cx="8" cy="17" r="3" fill="#E85A4A"/><path d="M11 17 h11 M14 17 l-2 -4" stroke="#E85A4A" stroke-width="3" stroke-linecap="round"/>`, "#E85A4A"));
addY("st_carried", icon(`<circle cx="14" cy="8" r="3" fill="#E85A4A"/><path d="M14 11 v8 M8 14 h12 M14 19 l-3 5 M14 19 l3 5" stroke="#E85A4A" stroke-width="2.5" stroke-linecap="round"/>`, "#E85A4A"));
addY("st_hooked", icon(`<path d="M14 4 v8 q0 8 -6 8 q-4 0 -4 -4" stroke="#E85A4A" stroke-width="3" fill="none" stroke-linecap="round"/>`, "#E85A4A"));
addY("st_dead", icon(`<path d="M14 5 q8 0 8 8 q0 4 -3 5 v4 h-10 v-4 q-3 -1 -3 -5 q0 -8 8 -8z" fill="#E8E4D8"/><circle cx="11" cy="13" r="2.2" fill="#0B0E10"/><circle cx="17" cy="13" r="2.2" fill="#0B0E10"/>`, "#8A8A8A"));
addY("st_escaped", icon(`<rect x="8" y="5" width="12" height="18" fill="#FFE8A0"/><path d="M4 14 h10 m-4 -4 l4 4 l-4 4" stroke="#0E2A12" stroke-width="2.5" fill="none"/>`, "#7CF05A"));
addY("st_pip", svg(8, 8, `<circle cx="4" cy="4" r="3.2" fill="#E85A4A" stroke="#200" stroke-width="1"/>`));
addY("st_pip_off", svg(8, 8, `<circle cx="4" cy="4" r="3.2" fill="#3A3A3A" stroke="#000" stroke-width="1"/>`));
addY("hud_gens", panel(118, 40, `<g transform="translate(6 4) scale(0.2)">${genSvg(0).replace(/<svg[^>]*>|<\/svg>|<defs>.*?<\/defs>/g, "").replace(/url\(#gb\)/g, "#8A7E5E")}</g>` + T(66, 27, 15, "GENS", "#F2D16A")));
addY("hud_gates", panel(170, 40, T(85, 27, 14, "EXIT GATES POWERED", "#9CFF7A")));
addY("hud_collapse", panel(118, 40, T(42, 26, 13, "COLLAPSE", "#E85A4A")));
addY("hud_floor0", svg(130, 22, T(65, 17, 14, "GROUND FLOOR", "#C8C2A8")));
addY("hud_floor1", svg(130, 22, T(65, 17, 14, "UPSTAIRS", "#C8C2A8")));
addY("hud_you", svg(30, 14, T(15, 12, 11, "YOU", "#F2D16A")));
addY("hud_bot", svg(30, 14, T(15, 12, 10, "BOT", "#8A8A8A")));
addY("vignette", svg(480, 360, `<rect width="480" height="360" fill="url(#vg)"/>`, `<radialGradient id="vg" cx=".5" cy=".5" r=".75"><stop offset=".45" stop-color="#B01810" stop-opacity="0"/><stop offset="1" stop-color="#9A0E08" stop-opacity=".85"/></radialGradient>`));
addY("darkness", svg(480, 360, `<rect width="480" height="360" fill="url(#dk)"/>`, `<radialGradient id="dk" cx=".5" cy=".5" r=".7"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".9"/></radialGradient>`));
addY("crosshair", svg(16, 16, `<circle cx="8" cy="8" r="2.2" fill="#F4F1E6" stroke="#0A0C0E" stroke-width="1.2"/>`));
addY("eye", svg(44, 30, `<path d="M2 15 q20 -20 40 0 q-20 20 -40 0z" fill="#F4F1E6" stroke="#0A0C0E" stroke-width="2"/><circle cx="22" cy="15" r="7" fill="#E85A4A"/><circle cx="22" cy="15" r="3" fill="#0A0C0E"/>`));
addY("sc_ring", svg(110, 110, `<circle cx="55" cy="55" r="44" fill="#0B0E10" fill-opacity=".45" stroke="#F4F1E6" stroke-width="3"/>` + T(55, 61, 15, "SPACE", "#F4F1E6")));
addY("sc_great", svg(160, 30, T(80, 24, 22, "GREAT!", "#9CFF7A")));
addY("sc_good", svg(160, 30, T(80, 24, 20, "GOOD", "#F4F1E6")));
addY("sc_miss", svg(160, 30, T(80, 24, 22, "MISSED!", "#E85A4A")));
// perk / power icons (DBD-style diamonds, 40 x 40)
const diamond = (inner, col) => svg(40, 40, `<path d="M20 2 L38 20 L20 38 L2 20Z" fill="#1A1426" stroke="${col}" stroke-width="2.5"/>${inner}`);
const PERK_ICONS = [
  `<path d="M12 26 l8 -12 l2 6 l6 -6 l-4 14 l-2 -6z" fill="#F2D16A"/>`,
  `<circle cx="20" cy="20" r="7" fill="none" stroke="#C8C2A8" stroke-width="3" stroke-dasharray="3 2"/><circle cx="20" cy="20" r="2.5" fill="#C8C2A8"/>`,
  `<path d="M17 11 h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 v-6 h6z" fill="#E85A4A"/>`,
  `<path d="M20 29 l-8 -8 q-3 -5 1 -8 q4 -2 7 2 q3 -4 7 -2 q4 3 1 8z" fill="#7CC444"/>`,
  `<path d="M10 25 h20 M12 20 h16 M14 15 h12" stroke="#C89A5A" stroke-width="3"/>`,
  `<circle cx="15" cy="18" r="4" fill="#F2D16A"/><circle cx="25" cy="18" r="4" fill="#F2D16A"/><path d="M9 28 q6 -6 12 0 M19 28 q6 -6 12 0" stroke="#F2D16A" stroke-width="2.5" fill="none"/>`,
  `<path d="M20 10 v12 q0 6 -5 6 q-4 0 -4 -4" stroke="#C8C2A8" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M26 14 l4 -4 m-4 0 l4 4" stroke="#7CC444" stroke-width="2.5"/>`,
  `<path d="M10 20 h14 m-5 -6 l6 6 l-6 6" stroke="#7AB8F0" stroke-width="3.5" fill="none"/>`,
  `<path d="M8 20 q12 -12 24 0 q-12 12 -24 0z" fill="#F4F1E6"/><circle cx="20" cy="20" r="4" fill="#E85A4A"/>`,
  `<path d="M12 28 L26 12 M22 12 h4 v4" stroke="#C8C2A8" stroke-width="3.5" fill="none"/><path d="M10 14 l4 4 m0 -4 l-4 4" stroke="#E85A4A" stroke-width="2.5"/>`,
];
PERK_ICONS.forEach((p, i) => addY(`perk${i}`, diamond(p, "#B8A8E8")));
const POWER_ICONS = [
  `<path d="M12 28 l6 -16 l4 8 l6 -10 l-2 18z" fill="#E85A4A"/>`,
  `<circle cx="20" cy="20" r="9" fill="#F4EEE6" opacity=".5"/><circle cx="17" cy="19" r="2" fill="#120E10"/><circle cx="23" cy="19" r="2" fill="#120E10"/>`,
  `<path d="M8 20 q6 -8 12 0 q6 -8 12 0 q-6 -2 -8 3 l-4 3 l-4 -3 q-2 -5 -8 -3z" fill="#120E18" stroke="#B8A8E8" stroke-width="1"/>`,
];
POWER_ICONS.forEach((p, i) => addY(`power${i}`, diamond(p, "#E85A4A")));
// prompts and banners
const prompt = (t, c = "#F2D16A") => svg(460, 30, T(230, 22, 17, t, c));
const PROMPTS = {
  pr_repair: "Hold E to repair the generator",
  pr_heal: "Hold E to heal your teammate",
  pr_unhook: "Hold E to unhook your teammate",
  pr_gate: "Hold E to open the exit gate",
  pr_gate_off: "The exit gate has no power yet",
  pr_drop: "SPACE: throw down the pallet",
  pr_vault: "SPACE: vault over the pallet",
  pr_escape: "SPACE: try to free yourself",
  pr_wiggle: "Mash A and D to wiggle free!",
  pr_selfcare: "Hold F to heal yourself",
  pr_pickup: "Press E to pick up the survivor",
  pr_hook: "Press E to hang them on the hook",
  pr_break: "Hold E to break the pallet",
  pr_kick: "Hold E to damage the generator",
  pr_attack: "SPACE or CLICK to attack",
  pr_crawl: "You're down! Crawl away - a teammate can heal you",
  pr_spectate: "Q / E: switch who you're watching",
};
for (const [k, t] of Object.entries(PROMPTS)) addY(k, prompt(t, k === "pr_crawl" || k === "pr_wiggle" ? "#E85A4A" : "#F2D16A"));
const banner = (t, c, sub = "", subc = "#F4F1E6") => svg(460, 80, T(230, 46, 32, t, c, "middle", 'letter-spacing="1"', "Marker") + (sub ? T(230, 72, 15, sub, subc) : ""));
const BANNERS = {
  bn_field: ["THE MOONLIT FIELD", "#B8D0F0", "Repair 5 generators, open a gate, escape before dawn"],
  bn_house: ["THE OLD HOUSE", "#E8B87A", "Repair 5 generators, open a gate, escape before dawn"],
  bn_field_k: ["THE MOONLIT FIELD", "#B8D0F0", "Hunt them down and hang them on the hooks"],
  bn_house_k: ["THE OLD HOUSE", "#E8B87A", "Hunt them down and hang them on the hooks"],
  bn_powered: ["EXIT GATES POWERED", "#9CFF7A", "Find an exit gate and open it!"],
  bn_powered_k: ["EXIT GATES POWERED", "#E85A4A", "Don't let them reach the gates!"],
  bn_open: ["A GATE IS OPEN", "#9CFF7A", "The collapse has begun - get out!"],
  bn_gen: ["GENERATOR DONE", "#F2D16A", ""],
  bn_stunned: ["STUNNED!", "#F2D16A", ""],
  bn_escaped: ["YOU ESCAPED!", "#9CFF7A", "Watch the others while the match finishes"],
  bn_dead: ["SACRIFICED", "#E85A4A", "Watch the others while the match finishes"],
  bn_injured: ["YOU'RE HURT!", "#E8A030", "One more hit and you go down"],
  bn_hooked: ["ON THE HOOK", "#E85A4A", "Hang on - a teammate can free you"],
  bn_wiggled: ["YOU BROKE FREE!", "#9CFF7A", "Run!"],
  bn_freed: ["UNHOOKED!", "#9CFF7A", "Run, and get healed"],
};
for (const [k, [t, c, s]] of Object.entries(BANNERS)) addY(k, banner(t, c, s));

// ---------------------------------------------------------------- menus (480 x 360)
const title = (y = 62, size = 36) =>
  `<text x="243" y="${y + 4}" font-family="Marker" font-weight="bold" font-size="${size}" text-anchor="middle" fill="#000" opacity=".6">SURVIVE UNTIL DAYLIGHT</text>` +
  `<text x="240" y="${y}" font-family="Marker" font-weight="bold" font-size="${size}" text-anchor="middle" fill="url(#ttl)" stroke="#120608" stroke-width="7" paint-order="stroke" stroke-linejoin="round">SURVIVE UNTIL DAYLIGHT</text>`;
const titleDefs = `<linearGradient id="ttl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FFE8B0"/><stop offset=".55" stop-color="#F09A3A"/><stop offset="1" stop-color="#A8281A"/></linearGradient>`;
const moonBg = `<rect width="480" height="360" fill="url(#mbg)"/><circle cx="400" cy="70" r="70" fill="url(#mmo)"/><circle cx="400" cy="70" r="24" fill="#E8EADA" opacity=".9"/>` +
  `<path d="M0 300 L40 250 L60 270 L90 230 L120 262 L160 220 L200 270 L240 240 L280 268 L330 226 L370 262 L420 232 L480 270 L480 360 L0 360Z" fill="#06080A"/>`;
const moonDefs = vgrad("mbg", "#06080E", "#2A1E2A") + radial("mmo", "#C8D4D8", "#C8D4D8", 0.4, 0);
const btn = (x, y, w, h, label, col = "#F09A3A", size = 20) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#1A0E10" stroke="${col}" stroke-width="3"/>` + T(x + w / 2, y + h / 2 + size * 0.36, size, label, "#FFE8C8");
addY("menu_main", svg(480, 360, moonBg + title() + btn(120, 120, 240, 46, "PLAY SOLO (WITH BOTS)") + btn(120, 180, 240, 46, "PLAY ONLINE") +
  T(240, 270, 12, "WASD move  -  Arrows turn  -  E hold to interact  -  SPACE act / attack", "#C8C2A8") +
  T(240, 288, 12, "Q perk / power  -  F self-heal  -  Z X C V B N quick chat (online)", "#C8C2A8") +
  T(240, 314, 12, "Survivors: fix 5 generators, open an exit gate and escape before dawn.", "#E8D8B8") +
  T(240, 332, 12, "Killer: hang survivors on hooks - when the timer runs out, the gates lock.", "#E8D8B8"), moonDefs + titleDefs));
addY("menu_connecting", svg(480, 360, moonBg + title() + T(240, 190, 22, "Connecting to the session...", "#F4F1E6"), moonDefs + titleDefs));
addY("menu_waiting", svg(480, 360, moonBg + title() + T(240, 170, 22, "Waiting for the next match...", "#F4F1E6") + T(240, 200, 14, "A match is wrapping up. You'll be pulled in automatically.", "#C8C2A8"), moonDefs + titleDefs));
// role select: two cards
const sv = survivorBody(SURV[0], "front", "a"), kv = killerBody(KILL[0], "front", "a");
addY("menu_role", svg(480, 360, moonBg + title(56, 34) + T(240, 96, 18, "CHOOSE YOUR SIDE", "#F4F1E6") +
  `<rect x="40" y="110" width="190" height="210" rx="14" fill="#0E1A22" stroke="#7AB8F0" stroke-width="4"/><g transform="translate(55 112) scale(1)">${sv}</g>` + T(135, 300, 24, "SURVIVOR", "#9AD0FF") +
  `<rect x="250" y="110" width="190" height="210" rx="14" fill="#220E0E" stroke="#E85A4A" stroke-width="4"/><g transform="translate(265 112) scale(1)">${kv}</g>` + T(345, 300, 24, "KILLER", "#FF8A7A") +
  T(240, 346, 11, "Online: only one player can be the killer - if it's taken you'll join as a survivor.", "#C8C2A8"), moonDefs + titleDefs));
// character select backgrounds (preview on the left, grid on the right)
const csBg = (head, col) => svg(480, 360, `<rect width="480" height="360" fill="url(#csb)"/>` +
  T(240, 34, 24, head, col, "middle", 'letter-spacing="2"', "Marker") +
  `<rect x="10" y="48" width="170" height="250" rx="12" fill="#0B0E10" opacity=".7" stroke="${col}" stroke-opacity=".6" stroke-width="2"/>` +
  btn(14, 310, 110, 40, "&lt; BACK", "#8A8A8A", 17) + btn(330, 310, 140, 40, "READY!", col, 20),
  vgrad("csb", "#0A0C12", "#241418"));
addY("cs_bg", csBg("CHOOSE YOUR SURVIVOR", "#9AD0FF"));
addY("ks_bg", csBg("CHOOSE YOUR KILLER", "#FF8A7A"));
addY("cs_frame", svg(56, 56, `<rect x="2" y="2" width="52" height="52" rx="8" fill="#141820" stroke="#5A5E66" stroke-width="2"/>`));
addY("cs_frame_sel", svg(56, 56, `<rect x="2" y="2" width="52" height="52" rx="8" fill="#2A3A20" stroke="#F2D16A" stroke-width="4"/>`));
addY("ks_frame", svg(84, 84, `<rect x="2" y="2" width="80" height="80" rx="10" fill="#1A1010" stroke="#5A5E66" stroke-width="2"/>`));
addY("ks_frame_sel", svg(84, 84, `<rect x="2" y="2" width="80" height="80" rx="10" fill="#3A1414" stroke="#F2D16A" stroke-width="4"/>`));
const info = (name, perk, l1, l2, col) => svg(300, 96, T(150, 22, 20, name, "#F4F1E6") + T(150, 48, 15, perk, col) + T(150, 70, 12, l1, "#C8C2A8") + T(150, 88, 12, l2, "#C8C2A8"));
SURV.forEach((p, i) => addY(`cs_info${i}`, info(p.name, "PERK: " + SURV_PERK[i][0], SURV_PERK[i][1], SURV_PERK[i][2], "#B8A8E8")));
KILL.forEach((k, i) => addY(`ks_info${i}`, info(k.name, "POWER: " + KILL_POWER[i][0], KILL_POWER[i][1], KILL_POWER[i][2], "#FF8A7A")));
addY("cs_random", svg(170, 22, T(85, 16, 12, "(picked at random for you)", "#8A8A8A")));
// results
addY("res_panel", svg(440, 300, `<rect x="2" y="2" width="436" height="296" rx="16" fill="#0B0E10" opacity=".85" stroke="#F09A3A" stroke-width="3"/>` + T(220, 286, 13, "Click or press SPACE to continue", "#C8C2A8")));
const RES = {
  res_escaped: ["YOU ESCAPED!", "#9CFF7A"], res_dead: ["YOU WERE SACRIFICED", "#E85A4A"],
  res_k4: ["MERCILESS VICTORY", "#E85A4A"], res_k3: ["BRUTAL VICTORY", "#E85A4A"], res_k2: ["TIE", "#F2D16A"],
  res_k1: ["NARROW DEFEAT", "#9AD0FF"], res_k0: ["TOTAL DEFEAT", "#9AD0FF"],
};
for (const [k, [t, c]] of Object.entries(RES)) addY(k, svg(420, 50, T(210, 38, 32, t, c, "middle", "", "Marker")));
SURV.forEach((p, i) => addY(`nm${i}`, svg(150, 20, T(0, 15, 13, p.name, "#F4F1E6", "start"))));
KILL.forEach((k, i) => addY(`knm${i}`, svg(150, 20, T(0, 15, 13, k.name, "#FF8A7A", "start"))));
addY("lb_escaped", svg(110, 20, T(55, 15, 14, "ESCAPED", "#9CFF7A")));
addY("lb_dead", svg(110, 20, T(55, 15, 14, "SACRIFICED", "#E85A4A")));
addY("lb_spectate", svg(240, 22, T(120, 17, 14, "SPECTATING", "#C8C2A8")));
addY("lb_waitmatch", svg(320, 26, T(160, 19, 15, "Joining the match...", "#F4F1E6")));


// ---------------------------------------------------------------- round 2: timer, touch controls, cutscenes
addY("hud_timer", panel(132, 40, `<circle cx="20" cy="20" r="9" fill="#FFC850"/><g stroke="#FFC850" stroke-width="2.5" stroke-linecap="round">` +
  [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M${20 + Math.cos(a * Math.PI / 180) * 12} ${20 + Math.sin(a * Math.PI / 180) * 12} L${20 + Math.cos(a * Math.PI / 180) * 16} ${20 + Math.sin(a * Math.PI / 180) * 16}"/>`).join("") + `</g>`, "#FFC850"));
addY("hud_timer_red", panel(132, 40, `<path d="M26 8 a12 12 0 1 0 0 24 a9 9 0 1 1 0 -24z" fill="#E85A4A"/>`, "#E85A4A"));
addY("hud_collapse2", panel(132, 40, `<path d="M12 30 l8 -20 l8 20z" fill="#E85A4A" stroke="#200" stroke-width="1.5"/><path d="M20 16 v7 M20 26 v1" stroke="#FFF" stroke-width="2.5"/>`, "#E85A4A"));
addY("face_you", svg(44, 44, `<circle cx="22" cy="22" r="20" fill="none" stroke="#F2D16A" stroke-width="3.5"/>`));
addY("bn_locked", banner("THE GATES ARE LOCKED", "#E85A4A", "Daylight never came..."));
addY("bn_minute", banner("1 MINUTE TO DAWN", "#FFC850", "Get out before the gates lock!"));
// touch controls
const tb = (w, h, inner, col = "#F4F1E6") => svg(w, h, `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${Math.min(w, h) / 3}" fill="#0B0E10" opacity=".6" stroke="${col}" stroke-width="3"/>${inner}`);
addY("tc_base", svg(120, 120, `<circle cx="60" cy="60" r="56" fill="#0B0E10" opacity=".45" stroke="#F4F1E6" stroke-opacity=".7" stroke-width="3"/>` +
  [0, 90, 180, 270].map((r) => `<path d="M60 10 l8 10 h-16z" fill="#F4F1E6" opacity=".7" transform="rotate(${r} 60 60)"/>`).join("")));
addY("tc_knob", svg(50, 50, `<circle cx="25" cy="25" r="22" fill="#F4F1E6" opacity=".75" stroke="#0B0E10" stroke-width="2"/>`));
addY("tc_act", svg(76, 76, `<circle cx="38" cy="38" r="35" fill="#5A0E0A" opacity=".7" stroke="#FF8A6A" stroke-width="3"/>` + T(38, 44, 16, "ACT", "#FFD0C0")));
addY("tc_use", tb(66, 42, T(33, 27, 15, "USE (E)", "#F2D16A"), "#F2D16A"));
addY("tc_heal", tb(66, 36, T(33, 24, 14, "HEAL", "#9CFF7A"), "#9CFF7A"));
addY("tc_chat", tb(56, 30, T(28, 20, 12, "CHAT", "#F4F1E6")));
["Hi!", "Good game!", "Follow me!", "Nice!", "Oops!", "Bye!"].forEach((p, i) => addY(`tc_ph${i}`, tb(170, 30, T(85, 21, 15, p, "#F4F1E6"))));
addY("menu_touch_off", tb(170, 26, T(85, 18, 12, "TOUCH CONTROLS: OFF", "#C8C2A8")));
addY("menu_touch_on", tb(170, 26, T(85, 18, 12, "TOUCH CONTROLS: ON", "#9CFF7A"), "#9CFF7A"));
// cutscenes
let rays = "";
for (let i = 0; i < 14; i++) { const a = -170 + i * 12; rays += `<path d="M240 250 L${240 + Math.cos(a * Math.PI / 180) * 700} ${250 + Math.sin(a * Math.PI / 180) * 700} L${240 + Math.cos((a + 5) * Math.PI / 180) * 700} ${250 + Math.sin((a + 5) * Math.PI / 180) * 700}Z" fill="#FFF4C8" opacity=".12"/>`; }
addY("cs_dawn", svg(480, 360, `<rect width="480" height="360" fill="url(#dw)"/>${rays}<circle cx="240" cy="250" r="70" fill="url(#sun)"/><circle cx="240" cy="250" r="34" fill="#FFF6D8"/>` +
  `<path d="M0 250 L60 228 L120 244 L180 222 L240 240 L300 220 L370 242 L430 226 L480 238 L480 360 L0 360Z" fill="#3A2A3A"/>` +
  `<path d="M0 280 h480 v80 h-480z" fill="#5A6A3A"/><path d="M220 280 L260 280 L360 360 L120 360Z" fill="#A08A6A"/>` +
  [40, 90, 400, 440].map((x, i) => `<path d="M${x} 284 l-22 -40 l22 -60 l22 60z" fill="#2A3A2A"/>`).join(""),
  vgrad("dw", "#4A6AA8", "#FFB070") + radial("sun", "#FFF6D0", "#FFC870", 0.95, 0)));
let tend = "";
for (let i = 0; i < 9; i++) { const x = 20 + i * 55; tend += `<path d="M${x} 360 q${-20 + (i % 3) * 20} -90 ${10 - (i % 2) * 30} -180 q10 -40 -10 -70" stroke="#2A0608" stroke-width="${10 - (i % 3) * 2}" fill="none" stroke-linecap="round"/>`; }
addY("cs_dark", svg(480, 360, `<rect width="480" height="360" fill="url(#dk2)"/>${tend}<ellipse cx="240" cy="330" rx="200" ry="30" fill="#000" opacity=".6"/>`,
  `<radialGradient id="dk2" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#7A1A1E"/><stop offset=".6" stop-color="#2A0608"/><stop offset="1" stop-color="#050102"/></radialGradient>`));
addY("cs_moon", svg(480, 360, `<rect width="480" height="360" fill="url(#bm)"/><circle cx="240" cy="140" r="110" fill="url(#bmg)"/><circle cx="240" cy="140" r="78" fill="#C8322A"/><circle cx="214" cy="118" r="14" fill="#A8221E"/><circle cx="262" cy="160" r="20" fill="#A8221E"/>` +
  `<path d="M0 300 L50 260 L80 280 L130 240 L170 270 L200 250 L240 276 L290 244 L330 268 L380 236 L430 266 L480 250 L480 360 L0 360Z" fill="#050203"/>`,
  vgrad("bm", "#140406", "#3A0A0C") + radial("bmg", "#FF5A3A", "#FF2A1A", 0.5, 0)));
addY("cs_bars", svg(480, 360, `<rect width="480" height="38" fill="#000"/><rect y="322" width="480" height="38" fill="#000"/>`));
const big = (t, c) => svg(460, 90, T(230, 64, 52, t, c, "middle", 'letter-spacing="2"', "Marker"));
addY("cs_t_escaped", big("YOU ESCAPED!", "#FFE070"));
addY("cs_t_dead", big("SACRIFICED", "#E85A4A"));
addY("cs_t_killer", big("THE KILLER WINS", "#E85A4A"));
addY("cs_t_survivors", big("DAYLIGHT!", "#FFE070"));
const sub = (t, c = "#F4F1E6") => svg(460, 30, T(230, 22, 18, t, c));
addY("cs_s_escaped", sub("You made it out alive!"));
addY("cs_s_dead", sub("The darkness took you..."));
addY("cs_s_kills", sub("Too many survivors were sacrificed."));
addY("cs_s_time", sub("Time ran out - the exit gates are locked forever."));
addY("cs_s_survivors", sub("The sun rises. The survivors win!"));
addY("cs_skip", svg(200, 20, T(100, 15, 12, "Click or SPACE to skip", "#C8C2A8")));

// index table for the code
let ids = "// Generated by scripts/art.mjs: View costume numbers.\n";
Y.forEach((n, i) => (ids += `export const C_${n.toUpperCase()} = ${idx + 1 + i};\n`));
out("lib/ids.ts", ids);

// ---------------------------------------------------------------- Weapon (killer's first-person weapon, 200 x 200)
const arm = (k) => `<path d="M150 210 L128 150 q-4 -14 10 -18 q14 -2 18 10 L184 210Z" fill="${k.coat}" stroke="${k.coatD}" stroke-width="3"/><ellipse cx="136" cy="142" rx="16" ry="14" fill="#1E1A18" stroke="#000" stroke-width="2"/>`;
KILL.forEach((k, i) => {
  out(`Weapon/w${i * 2}_${k.weapon}.svg`, svg(200, 200, arm(k) + weaponSvg(k, 136, 140, -20, 2.4)));
  out(`Weapon/w${i * 2 + 1}_${k.weapon}_swing.svg`, svg(200, 200, `<path d="M40 40 q80 -20 120 60" stroke="#FFF" stroke-width="10" opacity=".3" fill="none"/>` +
    `<g transform="rotate(-50 136 140) translate(-30 -10)">${arm(k)}${weaponSvg(k, 136, 140, -20, 2.4)}</g>`));
});

// ---------------------------------------------------------------- Stage backdrops (ceiling/sky and floor)
let stars = "";
for (let i = 0; i < 70; i++) stars += `<circle cx="${(rnd() * 480).toFixed(0)}" cy="${(rnd() * 150).toFixed(0)}" r="${(0.4 + rnd() * 0.8).toFixed(1)}" fill="#C8D0E0" opacity="${(0.2 + rnd() * 0.5).toFixed(2)}"/>`;
out("Stage/field.svg", svg(480, 360,
  `<rect width="480" height="180" fill="url(#sky)"/>${stars}<circle cx="370" cy="46" r="44" fill="url(#mg)"/><circle cx="370" cy="46" r="14" fill="#E6E8D8" opacity=".85"/>` +
  `<rect y="180" width="480" height="180" fill="url(#gnd)"/><rect y="156" width="480" height="50" fill="url(#fog)"/>`,
  vgrad("sky", "#04060C", "#141A24") + `<linearGradient id="gnd" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0A100A"/><stop offset=".4" stop-color="#16241A"/><stop offset="1" stop-color="#2E4430"/></linearGradient>` +
  `<linearGradient id="fog" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3A4450" stop-opacity="0"/><stop offset=".5" stop-color="#2E3640" stop-opacity=".6"/><stop offset="1" stop-color="#2E3640" stop-opacity="0"/></linearGradient>` +
  radial("mg", "#B8C4D8", "#B8C4D8", 0.35, 0)));
let boards = "";
for (let y = 186; y < 360; y += Math.max(4, (y - 180) * 0.18)) boards += `<path d="M0 ${y.toFixed(1)} H480" stroke="#1A0E08" stroke-width="${Math.max(0.6, (y - 180) / 60).toFixed(1)}" opacity=".6"/>`;
out("Stage/house.svg", svg(480, 360,
  `<rect width="480" height="180" fill="url(#ceil)"/><rect y="180" width="480" height="180" fill="url(#flr)"/>${boards}<rect y="160" width="480" height="40" fill="url(#hz)"/>`,
  vgrad("ceil", "#1A120E", "#0A0706") + vgrad("flr", "#0C0806", "#4A3020") +
  `<linearGradient id="hz" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`));
out("Stage/menu.svg", svg(480, 360, `<rect width="480" height="360" fill="#06080E"/>`));
out("Chat/anchor.svg", svg(4, 4, `<rect width="4" height="4" fill="#000" opacity="0.01"/>`));

// ---------------------------------------------------------------- Thumbnail (480 x 360 title card)
const kb = killerBody(KILL[0], "front", "atk");
const s1 = survivorBody(SURV[1], "back", "a"), s2 = survivorBody(SURV[6], "front", "scared"), s3 = survivorBody(SURV[8], "back", "b");
let tstars = "";
for (let i = 0; i < 60; i++) tstars += `<circle cx="${(rnd() * 480).toFixed(0)}" cy="${(rnd() * 200).toFixed(0)}" r="${(0.4 + rnd() * 0.9).toFixed(1)}" fill="#E8D8D8" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`;
const cornT = Array.from({ length: 40 }, (_, i) => `<path d="M${i * 12 + 4} 262 q${(i % 3) - 1} -30 ${(i % 2) * 3} -${44 + (i * 7) % 18}" stroke="#2A3A1E" stroke-width="3" fill="none"/>`).join("");
out("Thumbnail/thumbnail.svg", svg(480, 360,
  `<rect width="480" height="360" fill="url(#tsky)"/>${tstars}<circle cx="240" cy="170" r="150" fill="url(#tmg)"/><circle cx="240" cy="170" r="96" fill="#B8282A"/><circle cx="212" cy="140" r="16" fill="#9A1E20"/><circle cx="270" cy="196" r="22" fill="#9A1E20"/><circle cx="262" cy="128" r="8" fill="#9A1E20"/>` +
  `<path d="M0 250 L40 226 L90 240 L130 214 L180 236 L240 222 L300 238 L350 210 L410 236 L480 220 L480 360 L0 360Z" fill="#0A0606"/>${cornT}` +
  `<rect y="258" width="480" height="102" fill="url(#tg)"/><rect y="240" width="480" height="50" fill="url(#tfog)"/>` +
  `<g transform="translate(130 112) scale(1.38)">${kb}</g>` +
  `<g transform="translate(-36 166) scale(1.15)">${s1}</g><g transform="translate(336 160) scale(1.1)">${s2}</g><g transform="translate(48 206) scale(0.85)">${s3}</g>` +
  `<g transform="translate(384 196) scale(0.55)">${genSvg(3).replace(/<svg[^>]*>|<\/svg>/g, "")}</g>` +
  `<g transform="translate(398 112) scale(0.75)"><path d="M70 156 L76 18 L84 18 L90 156Z" fill="#1A1A1E"/><path d="M76 20 h34 v8 h-26" fill="#2A2C30"/><path d="M104 28 v10 q0 14 -12 14 q-10 0 -10 -10 l6 -2 q0 5 4 5 q5 0 5 -7 v-10z" fill="#5A5E66"/></g>` +
  `<text x="245" y="66" font-family="Marker" font-weight="bold" font-size="56" text-anchor="middle" fill="#000" opacity=".7">SURVIVE UNTIL</text>` +
  `<text x="240" y="60" font-family="Marker" font-weight="bold" font-size="56" text-anchor="middle" fill="url(#ttl)" stroke="#120608" stroke-width="9" paint-order="stroke" stroke-linejoin="round">SURVIVE UNTIL</text>` +
  `<text x="246" y="128" font-family="Marker" font-weight="bold" font-size="72" text-anchor="middle" fill="#000" opacity=".7">DAYLIGHT</text>` +
  `<text x="240" y="122" font-family="Marker" font-weight="bold" font-size="72" text-anchor="middle" fill="url(#ttl)" stroke="#120608" stroke-width="10" paint-order="stroke" stroke-linejoin="round">DAYLIGHT</text>` +
  `<text x="240" y="286" font-family="Sans Serif" font-weight="bold" font-size="15" text-anchor="middle" fill="#F4E8E0" stroke="#120608" stroke-width="4" paint-order="stroke" letter-spacing="2">1 KILLER  vs  4 SURVIVORS  -  SOLO OR ONLINE</text>` +
  `<rect x="150" y="296" width="180" height="34" rx="17" fill="#1A0E10" stroke="#F09A3A" stroke-width="3"/><text x="240" y="319" font-family="Sans Serif" font-weight="bold" font-size="17" text-anchor="middle" fill="#FFE8C8">CLICK TO PLAY</text>` +
  `<rect x="318" y="334" width="156" height="20" rx="10" fill="#4C97FF" stroke="#FFF" stroke-width="2"/><text x="396" y="348" font-family="Sans Serif" font-weight="bold" font-size="11" text-anchor="middle" fill="#FFF">Made with TextToScratch</text>`,
  titleDefs + vgrad("tsky", "#05030A", "#3A0E14") + vgrad("tg", "#0E0A0A", "#241A16") + radial("tmg", "#FF4A2A", "#FF2A1A", 0.45, 0) +
  `<linearGradient id="tfog" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6A4448" stop-opacity="0"/><stop offset=".5" stop-color="#6A4448" stop-opacity=".45"/><stop offset="1" stop-color="#6A4448" stop-opacity="0"/></linearGradient>` +
  grad("gb", "#8A7E5E", "#4A4230") + radial("gl", "#FFF6C0", "#FFE070", 0.8, 0)));
console.log(`walls: ${idx}, billboards/hud: ${Y.length}`);
