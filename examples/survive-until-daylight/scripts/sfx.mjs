// Synthesizes Survive Until Daylight's sound effects (16-bit mono, 22050 Hz). Run from examples/survive-until-daylight
// after art.mjs (which clears the costume folders):  node scripts/sfx.mjs
import fs from "node:fs";

const RATE = 22050;
function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buf;
}
let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const buf = (len) => new Float32Array(Math.round(len * RATE));
function lowpass(x, cut) {
  let y = 0;
  return x.map((v, i) => (y += (v - y) * Math.min(1, (2 * Math.PI * cut(i / RATE)) / RATE)));
}
function bandpass(x, f, q) { // RBJ biquad
  const w = (2 * Math.PI * f) / RATE, al = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x.map((v) => { const y = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; });
}
function noise(len, decay, cut, vol = 1, attack = 0.002) {
  const n = buf(len).map(() => rnd());
  return lowpass(n, cut).map((v, i) => { const t = i / RATE; return v * vol * Math.min(1, t / attack) * Math.exp(-t / decay); });
}
function tone(len, f0, f1, decay, vol, wave = "sine", start = 0) {
  let ph = 0;
  return buf(len).map((_, i) => {
    const t = i / RATE - start;
    if (t < 0) return 0;
    const f = f0 * Math.pow(f1 / f0, Math.min(1, t / len));
    ph += (2 * Math.PI * f) / RATE;
    const s = wave === "saw" ? ((ph / Math.PI) % 2) - 1 : wave === "square" ? Math.sign(Math.sin(ph)) : wave === "tri" ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
    return s * vol * Math.min(1, t / 0.005) * Math.exp(-t / decay);
  });
}
const mix = (...xs) => { const n = Math.max(...xs.map((x) => x.length)), o = new Float32Array(n); for (const x of xs) x.forEach((v, i) => (o[i] += v)); return o; };
const delay = (x, secs) => { const d = Math.round(secs * RATE), o = new Float32Array(x.length + d); x.forEach((v, i) => (o[i + d] = v)); return o; };
const gain = (x, g) => x.map((v) => v * g);
const softclip = (x) => x.map((v) => Math.tanh(v * 1.4) / Math.tanh(1.4));
const fade = (x, inT, outT) => x.map((v, i) => { const t = i / RATE, L = x.length / RATE; return v * Math.min(1, t / inT, (L - t) / outT); });
const echo = (x, d, fb, n = 3) => { let o = x; for (let k = 1; k <= n; k++) o = mix(o, gain(delay(x, d * k), Math.pow(fb, k))); return o; };

/** cartoon vowel "aah" with a pitch glide (screams and yelps) */
function voice(len, f0, f1, vol, formants = [[800, 6], [1200, 7], [2600, 9]], vib = 0.03) {
  let ph = 0;
  const src = buf(len).map((_, i) => {
    const t = i / RATE;
    const f = (f0 + (f1 - f0) * Math.pow(t / len, 0.7)) * (1 + vib * Math.sin(t * 38));
    ph += f / RATE;
    return ((ph % 1) * 2 - 1) * 0.8 + rnd() * 0.08;
  });
  const v = mix(...formants.map(([f, q], k) => gain(bandpass(src, f, q), [1, 0.7, 0.3][k])));
  return softclip(v.map((s, i) => { const t = i / RATE; return s * vol * 3 * Math.min(1, t / 0.03) * Math.min(1, (len - t) / 0.12); }));
}
const thump = (f, len, vol) => mix(tone(len, f, f * 0.6, len / 3, vol), noise(len, 0.02, () => 400, vol * 0.4));

const S = {};
const put = (dir, name, x) => { fs.mkdirSync(`src/${dir}`, { recursive: true }); fs.writeFileSync(`src/${dir}/${name}.wav`, wav(x)); };

// heartbeat: lub-dub
S.heartbeat = mix(thump(62, 0.25, 0.9), delay(thump(54, 0.25, 0.7), 0.18));
// generator: big clunk, motor surge and a bell
S.gendone = softclip(mix(noise(1.6, 0.08, () => 1200, 0.9), tone(1.6, 55, 110, 0.6, 0.6, "saw"), delay(mix(tone(2, 880, 880, 0.9, 0.35), tone(2, 1320, 1320, 0.7, 0.2)), 0.25)));
// gates powered: two-tone horn
S.powered = softclip(mix(tone(1.4, 220, 220, 1.2, 0.5, "saw"), tone(1.4, 277, 277, 1.2, 0.4, "saw"), delay(mix(tone(1.4, 220, 220, 1.2, 0.5, "saw"), tone(1.4, 330, 330, 1.2, 0.4, "saw")), 1.2)).map((v) => v * 0.7));
// skill checks
S.scwarn = mix(tone(0.25, 1760, 1760, 0.12, 0.45), delay(tone(0.2, 1760, 1760, 0.1, 0.3), 0.08));
S.scgood = tone(0.15, 660, 880, 0.06, 0.5, "tri");
S.scgreat = mix(tone(0.4, 880, 880, 0.15, 0.4, "tri"), delay(tone(0.4, 1320, 1320, 0.15, 0.4, "tri"), 0.07), delay(tone(0.4, 1760, 1760, 0.2, 0.35, "tri"), 0.14));
S.scfail = softclip(mix(noise(1.2, 0.25, (t) => 3000 * Math.exp(-t * 3) + 200, 1.4), tone(1.2, 90, 40, 0.3, 0.9), delay(noise(0.6, 0.08, () => 6000, 0.5), 0.05)));
// combat
S.swing = noise(0.35, 0.12, (t) => 600 + 4000 * Math.sin(Math.min(1, t / 0.3) * Math.PI), 0.9, 0.08);
S.hit = softclip(mix(noise(0.3, 0.05, () => 2500, 1.2), thump(110, 0.3, 0.9)));
S.scream = voice(0.75, 620, 380, 0.7);
S.yelp = voice(0.35, 520, 700, 0.6, [[700, 6], [1100, 7], [2500, 9]]);
S.pallet = softclip(mix(noise(0.8, 0.12, () => 1800, 1.3), thump(80, 0.5, 1), delay(noise(0.3, 0.05, () => 3000, 0.5), 0.12)));
S.pbreak = softclip(mix(noise(0.9, 0.2, (t) => 4000 * Math.exp(-t * 4) + 300, 1.2), delay(noise(0.3, 0.04, () => 5000, 0.7), 0.15), delay(noise(0.3, 0.04, () => 5000, 0.6), 0.3)));
S.stun = mix(tone(0.6, 1200, 300, 0.25, 0.5, "tri"), thump(70, 0.3, 0.8));
S.hook = softclip(mix(tone(1.2, 520, 515, 0.5, 0.45, "tri"), tone(1.2, 780, 776, 0.4, 0.25), noise(0.3, 0.04, () => 6000, 0.6), delay(voice(0.9, 700, 420, 0.6), 0.1)));
S.unhook = mix(tone(0.5, 440, 520, 0.2, 0.35, "tri"), noise(0.3, 0.05, () => 5000, 0.4));
// sacrifice: crows and a dark rising whoosh
S.sacrifice = softclip(mix(fade(noise(2.4, 3, (t) => 200 + t * 900, 0.9, 0.5), 0.5, 0.4), tone(2.4, 50, 160, 2, 0.4, "saw"),
  delay(voice(0.3, 900, 700, 0.35, [[1500, 5], [2500, 6], [3500, 8]], 0.08), 0.4), delay(voice(0.3, 950, 760, 0.3, [[1500, 5], [2500, 6], [3500, 8]], 0.08), 0.9)));
S.step = noise(0.12, 0.03, () => 900, 0.5);
S.wiggle = noise(0.25, 0.07, () => 2500, 0.6, 0.02);
S.gate = softclip(mix(tone(1.6, 60, 90, 1.5, 0.5, "saw"), noise(1.6, 1, () => 500, 0.5), delay(tone(0.5, 990, 990, 0.3, 0.3, "square"), 0.6), delay(tone(0.5, 990, 990, 0.3, 0.3, "square"), 1.1)));
S.escape = mix(...[523, 659, 784, 1047].map((f, i) => delay(tone(0.6, f, f, 0.4, 0.35, "tri"), i * 0.12)));
S.start = softclip(echo(mix(tone(3, 98, 98, 1.6, 0.6), tone(3, 147, 147, 1.4, 0.35), tone(3, 196, 196, 1.2, 0.25), noise(0.4, 0.1, () => 600, 0.4)), 0.35, 0.4));
S.win = mix(...[392, 494, 587, 784].map((f, i) => delay(tone(1.2, f, f, 0.8, 0.3, "tri"), i * 0.16)));
S.lose = softclip(mix(...[220, 207, 196, 147].map((f, i) => delay(tone(1.1, f, f, 0.7, 0.35, "saw"), i * 0.3))).map((v) => v * 0.6));
S.repair = mix(...[0, 0.11, 0.2, 0.33].map((d) => delay(noise(0.08, 0.02, () => 4000, 0.4), d)), tone(0.45, 70, 70, 0.4, 0.25, "square"));
S.heal = mix(tone(0.5, 660, 660, 0.25, 0.2), delay(tone(0.5, 990, 990, 0.25, 0.15), 0.1));
S.vanish = fade(noise(1.2, 2, (t) => 3000 * Math.exp(-t * 2) + 300, 0.8, 0.05), 0.05, 0.5);
S.rampage = softclip(mix(voice(1.0, 140, 110, 0.9, [[500, 4], [900, 5], [2200, 7]], 0.1), noise(1, 0.4, () => 600, 0.5)));
S.crows = mix(...[0, 0.25, 0.55, 0.7].map((d, i) => delay(voice(0.28, 900 - i * 40, 700, 0.35, [[1500, 5], [2500, 6], [3500, 8]], 0.08), d)));
S.dash = noise(0.4, 0.15, (t) => 5000 * Math.exp(-t * 6) + 400, 0.8, 0.01);
S.click = tone(0.06, 1200, 900, 0.02, 0.4, "square");
S.vault = mix(noise(0.25, 0.06, () => 1500, 0.6), delay(thump(90, 0.2, 0.6), 0.18));
// killer laugh: three low "ha"s
S.laugh = softclip(mix(...[0, 0.32, 0.62, 0.95].map((d, i) => delay(voice(0.26, 150 - i * 6, 120 - i * 6, 0.9, [[650, 4], [1050, 5], [2400, 7]], 0.04), d)), noise(1.3, 0.8, () => 300, 0.2)));
S.tick = tone(0.08, 1500, 1500, 0.03, 0.4, "square");
S.lock = softclip(mix(thump(70, 0.6, 1), noise(0.5, 0.1, () => 3000, 0.8), delay(tone(0.8, 300, 290, 0.4, 0.4, "tri"), 0.08)));
for (const [k, v] of Object.entries(S)) put("View", k, v);

// Stage: night ambience (wind and crickets), loops
const amb = mix(fade(lowpass(buf(8).map(() => rnd()), (t) => 300 + 200 * Math.sin(t * 0.8)).map((v) => v * 0.5), 0.5, 0.5),
  ...Array.from({ length: 10 }, (_, i) => delay(mix(...[0, 0.05, 0.1].map((d) => delay(tone(0.04, 4200 + i * 37, 4200 + i * 37, 0.015, 0.06), d))), 0.4 + i * 0.73)));
put("Stage", "ambience", amb);
put("Thumbnail", "begin", S.start);
console.log(`${Object.keys(S).length + 2} sounds`);
