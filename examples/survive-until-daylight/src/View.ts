// The whole game: menus, Dead-by-Daylight rules (host-authoritative), bot AI, networking and the 3D renderer.
// Agents: 0 is the killer, 1-4 are survivors. Each one is played by a human (agSlot = their cloud slot) or by a bot
// that the host simulates. Humans own their own position; the host owns everything else and broadcasts it.
// Rendering: a DDA raycaster over a 28-wide tile map (the house stacks its two floors in one grid). Each of the 120
// screen columns stamps one wall slice; billboards are stamped far-to-near with nearer wall columns re-stamped on top.
import * as Net from "tts/net";
import * as Time from "tts/time";
import * as Draw from "tts/draw";
import * as MathX from "tts/math";
import { game, wcloud } from "./Stage";
import * as M from "./lib/maps";
import {
  C_S0_FRONTA, C_K0_FRONTA, C_GEN0, C_HOOK, C_PALLET_UP, C_TREE0, C_ROCK, C_HAY, C_FURN0, C_FX_DUST, C_FX_SPARK, C_FX_CROW,
  C_AURA_NOISE, C_AURA_EXIT, C_AURA_UP, C_AURA_DOWN, C_D0, C_DCOLON, C_FACE0, C_KFACE0, C_ST_HEALTHY, C_ST_INJURED, C_ST_DOWN,
  C_ST_CARRIED, C_ST_HOOKED, C_ST_DEAD, C_ST_ESCAPED, C_ST_PIP, C_ST_PIP_OFF, C_HUD_GENS, C_HUD_GATES, C_HUD_COLLAPSE,
  C_HUD_FLOOR0, C_HUD_YOU, C_HUD_BOT, C_VIGNETTE, C_DARKNESS, C_EYE, C_SC_RING, C_SC_GREAT, C_SC_GOOD, C_SC_MISS, C_PERK0,
  C_POWER0, C_PR_REPAIR, C_PR_HEAL, C_PR_UNHOOK, C_PR_GATE, C_PR_GATE_OFF, C_PR_DROP, C_PR_VAULT, C_PR_ESCAPE, C_PR_WIGGLE,
  C_PR_SELFCARE, C_PR_PICKUP, C_PR_HOOK, C_PR_BREAK, C_PR_KICK, C_PR_ATTACK, C_PR_CRAWL, C_PR_SPECTATE, C_BN_FIELD, C_BN_HOUSE,
  C_BN_FIELD_K, C_BN_HOUSE_K, C_BN_POWERED, C_BN_POWERED_K, C_BN_OPEN, C_BN_GEN, C_BN_STUNNED, C_BN_ESCAPED, C_BN_DEAD,
  C_BN_INJURED, C_BN_HOOKED, C_BN_WIGGLED, C_BN_FREED, C_MENU_MAIN, C_MENU_CONNECTING, C_MENU_WAITING, C_MENU_ROLE, C_CS_BG,
  C_KS_BG, C_CS_FRAME, C_CS_FRAME_SEL, C_KS_FRAME, C_KS_FRAME_SEL, C_CS_INFO0, C_KS_INFO0, C_CS_RANDOM, C_RES_PANEL,
  C_RES_ESCAPED, C_RES_DEAD, C_RES_K0, C_NM0, C_KNM0, C_LB_ESCAPED, C_LB_DEAD, C_LB_SPECTATE, C_LB_WAITMATCH,
  C_HUD_TIMER, C_HUD_TIMER_RED, C_HUD_COLLAPSE2, C_FACE_YOU, C_BN_LOCKED, C_BN_MINUTE, C_TC_BASE, C_TC_KNOB, C_TC_ACT, C_TC_USE,
  C_TC_HEAL, C_TC_CHAT, C_TC_PH0, C_MENU_TOUCH_OFF, C_CS_DAWN, C_CS_DARK, C_CS_MOON, C_CS_BARS, C_CS_T_ESCAPED, C_CS_T_DEAD,
  C_CS_T_KILLER, C_CS_T_SURVIVORS, C_CS_S_ESCAPED, C_CS_S_DEAD, C_CS_S_KILLS, C_CS_S_TIME, C_CS_S_SURVIVORS, C_CS_SKIP,
} from "./lib/ids";

const MW = 28;
const N = 120; // screen columns
const CW = 4; // column width in pixels
const PLANE = 0.66;
const PROJ = 363.6; // 240 / PLANE
const NA = 5; // agents
const PATHMAX = 90;
const SURV_SPD = 2.5;
const KILL_SPD = 2.9;
const HOOK_STAGE = 45; // seconds per hook stage
const GEN_TIME = 45; // seconds for one survivor to repair a generator
const GATE_TIME = 10;
const COLLAPSE = 90;
const MATCH_TIME = 420; // seconds until dawn: then the gates lock and the killer wins
const JX = -160; // touch joystick centre
const JY = -112;
// costumes per character: survivors 10 (front a/b, back a/b, left a/b, right a/b, down, hooked), killers 10 (8 walk, attack, stunned)
const SC_DOWN = 8;
const SC_HOOKED = 9;
const KC_ATK = 8;
const KC_STUN = 9;

// ------------------------------------------------------------------ world (current map)
let mapId = 0;
let mh = 28;
let cells = 784;
const map: number[] = [];
const palAt: number[] = []; // per cell: pallet index + 1
const stairAt: number[] = []; // per cell: stairs index + 1
const escAt: number[] = []; // per cell: 1 = walking in escapes
const genAt: number[] = []; // per cell: generator index + 1
const genC: number[] = [];
const genP: number[] = []; // 0..100
const genReg: number[] = []; // 1 = regressing (kicked)
const genFx: number[] = []; // last time progress changed (animation)
const genWork: number[] = []; // host: survivors working on it this frame
const hookC: number[] = [];
const palC: number[] = [];
const palAx: number[] = [];
const palSt: number[] = []; // 0 standing, 1 dropped, 2 broken
const decC: number[] = [];
const decK: number[] = [];
const spawnC: number[] = [];
const gateC: number[] = [];
const gateIn: number[] = [];
const gateP: number[] = [];
const escC: number[] = [];
const stFrom: number[] = [];
const stTo: number[] = [];
const stAng: number[] = [];
let kspawn = 0;
let gensDone = 0;
let powered = false;
let collapseT = 0;

// ------------------------------------------------------------------ agents (index 0 killer, 1-4 survivors)
const agSlot: number[] = []; // 0 = bot
const agSkin: number[] = [];
const agX: number[] = [];
const agY: number[] = [];
const agA: number[] = [];
const agSt: number[] = []; // survivors: 0 healthy 1 injured 2 downed 3 carried 4 hooked 5 dead 6 escaped. killer: 0 normal 1 stunned 2 carrying
const agStage: number[] = []; // survivors: times hooked (hook stage)
const agProg: number[] = []; // 0..99: hook timer / wiggle / heal progress (for the bars)
const agAnim: number[] = []; // 0 idle 1 move 2 act 3 swing 4 vault 5 break/kick
const agFx: number[] = []; // killer power active: 1 Rampage, 2 Vanish, 3 Crow Sight
// host only
const hookT: number[] = [];
const agHook: number[] = [];
const healP: number[] = [];
const unhookP: number[] = [];
const wiggleP: number[] = [];
const stunEnd: number[] = [];
const slowEnd: number[] = [];
const boostEnd: number[] = [];
const dodgeEnd: number[] = [];
const hAct: number[] = []; // this frame's activity: 1 repair 2 heal 3 unhook 4 gate 5 wiggle 6 self-care
const hActT: number[] = [];
const escTries: number[] = [];
// bots
const botPlanAt: number[] = [];
const botMode: number[] = []; // 0 none 1 gen 2 unhook 3 heal 4 gate 5 escape 6 flee 7 chase 8 pickup 9 hook 10 patrol 11 lastseen
const botTgt: number[] = [];
const pathBuf: number[] = [];
const pathLen: number[] = [];
const pathI: number[] = [];
const botGoal: number[] = [];
const botActEnd: number[] = [];
const botSkillAt: number[] = [];
const vaultT: number[] = [];
const vaultFX: number[] = [];
const vaultFY: number[] = [];
const vaultTX: number[] = [];
const vaultTY: number[] = [];
const botStuckAt: number[] = [];
const botLastX: number[] = [];
const botLastY: number[] = [];
let kSeenX = 0;
let kSeenY = 0;
let kSeenAt = -99;
let kChase = -1;
let kSwingAt = -9;
let kSwingHit = false;
let kPatrolGen = -1;
let kKickUntil = 0;
let kPowerEnd = 0;
let kIgnoreUntil = 0;
let kPowerReady = 20;
// rendering smoothing and change detection (every client)
const rX: number[] = [];
const rY: number[] = [];
const rA: number[] = [];
const prevSt: number[] = [];
const prevAnim: number[] = [];
const prevGenP: number[] = [];
const prevPal: number[] = [];
const prevGate: number[] = [];
let prevFx = 0;
// bfs scratch
const dist: number[] = [];
const prev: number[] = [];
const queue: number[] = [];
const tmp: number[] = [];
let bfsStart = 0;

// ------------------------------------------------------------------ remote humans (slot 1..6, index slot - 1)
const slAct: number[] = []; // active and in a session
const slX: number[] = [];
const slY: number[] = [];
const slA: number[] = [];
const slFlags: number[] = [];
const slRole: number[] = [];
const slSkin: number[] = [];
const slDo: number[] = [];
const slDoT: number[] = [];
const slAnim: number[] = [];
const slEv: number[] = [];
const slEvSeq: number[] = [];
const slLastSeq: number[] = [];
const slAck: number[] = []; // which agent they think they control (+1)

// ------------------------------------------------------------------ local player
let px = 5;
let py = 5;
let pa = 0;
let myAgent = -1;
let prevMyAgent = -1;
let myRole = 1; // 1 survivor, 2 killer
let mySkin = 0;
let myKSkin = 0;
let myDo = 0; // activity this frame (see hAct)
let myDoT = 0;
let myAnim = 0;
const evQ: number[] = [];
let curEv = 0;
let evSeq = 0;
let prevLocked = true;
let moving = false;
let stepPhase = 0;
let bob = 0;
let boostUntil = 0;
let slowUntil = 0;
let qReadyAt = 0;
let qActiveUntil = 0;
let dashUntil = 0;
let vaulting = false;
let vaultEnd = 0;
let vaultDur = 0.5;
let vfx = 0;
let vfy = 0;
let vtx = 0;
let vty = 0;
let holdT = 0; // killer: time E held on a pallet / generator
let holdKind = 0;
let holdIdx = -1;
let attackAt = -9;
let attackChecked = true;
let attackCool = 0;
let hookTries = 0;
let lastWig = 0;
let wigAt = -9;
let promptC = 0;
let barFrac = -1;
let barCol = "#F2D16A";
let bannerC = 0;
let bannerUntil = 0;
let hurtAt = -9;
let heartAt = 0;
let heartK = 0;
let specA = -1;
let prevSpecKey = false;
let prevSpace = false;
let prevE = false;
let prevQ = false;
let prevClick = false;
let pausedUntil = 0;
// skill check
let scOn = false;
let scStart = 0;
let scZone = 0;
let scWidth = 45;
let scResultC = 0;
let scResultUntil = 0;
let scNextAt = 0;
let scWarnAt = 0;
// noise notifications (killer)
let noiseSeq = 0;
let noiseCell = 0;
let lastNoiseSeq = 0;
let noiseUntil = 0;
let noiseX = 0;
let noiseY = 0;
// fx
const fxX: number[] = [];
const fxY: number[] = [];
const fxT: number[] = [];
const fxK: number[] = [];

// ------------------------------------------------------------------ match / lobby
let mode = 0; // 0 title, 1 main menu, 2 connecting, 3 role select, 4 character select, 5 in game
let offline = true;
let wantJoin = false;
let isHost = true;
let joinedAt = 0;
let hPhase = 0; // 0 no match, 1 playing, 2 results
let hGame = 0;
let myGame = -1;
let matchAt = 0;
let endAt = 0;
let onResults = false;
let lastPhase = 0;
let hSeq = 10;
let lastWSeq = -1;
let nextTick = 0;
let tick = 0;
let lastGensDone = 0;
let lastPowered = false;
let lastOpen = false;
let myOutcome = 0;
let hTime = MATCH_TIME; // seconds left until the gates lock
let timeUp = 0;
let warnedMinute = false;
let tickAt = 0;
// cutscenes (queued: 1 escaped, 2 sacrificed, 3 killer wins, 4 survivors win)
const csQ: number[] = [];
let csKind = 0;
let csAt = 0;
let csPrevSkip = true;
// input (keyboard + touch)
let kFwd = 0;
let kStr = 0;
let kTurn = 0;
let kSpace = false;
let kE = false;
let kQ = false;
let kF = false;
let kA = false;
let kD = false;
let tBtn = 0;
let prevTBtn = 0;
let joyX = 0;
let joyY = 0;
let chatOpen = false;
let showHeal = false;
let prevResClick = true;
let resultsAt = 0;

// ------------------------------------------------------------------ rendering
const cDepth: number[] = [];
const cCost: number[] = [];
const cSize: number[] = [];
const cBr: number[] = [];
const oDepth: number[] = [];
const oCost: number[] = [];
const oSize: number[] = [];
const oBr: number[] = [];
const bD: number[] = [];
const bX: number[] = [];
const bY: number[] = [];
const bS: number[] = [];
const bC: number[] = [];
const bB: number[] = [];
const bG: number[] = [];
const bW: number[] = [];
const aX: number[] = []; // auras (drawn last, through walls)
const aY: number[] = [];
const aS: number[] = [];
const aC: number[] = [];
const aH: number[] = [];
let dirX = 1;
let dirY = 0;
let plX = 0;
let plY = PLANE;
let horizon = 0;
let camX = 0;
let camY = 0;
let camA = 0;
let camFloor = 0;
let sCost = 0;
let sSize = 0;
let sBr = 0;
let mvX = 0;
let mvY = 0;
let fogK = 5.6;
export const perf = { ms: 0, fps: 0 };
let fpsCount = 0;
let fpsAt = 0;

// ================================================================== setup

/** @warp */
function initLists() {
  agSlot.length = 0;
  agSkin.length = 0;
  agX.length = 0;
  agY.length = 0;
  agA.length = 0;
  agSt.length = 0;
  agStage.length = 0;
  agProg.length = 0;
  agAnim.length = 0;
  agFx.length = 0;
  hookT.length = 0;
  agHook.length = 0;
  healP.length = 0;
  unhookP.length = 0;
  wiggleP.length = 0;
  stunEnd.length = 0;
  slowEnd.length = 0;
  boostEnd.length = 0;
  dodgeEnd.length = 0;
  hAct.length = 0;
  hActT.length = 0;
  escTries.length = 0;
  botPlanAt.length = 0;
  botMode.length = 0;
  botTgt.length = 0;
  pathLen.length = 0;
  pathI.length = 0;
  botGoal.length = 0;
  botActEnd.length = 0;
  botSkillAt.length = 0;
  vaultT.length = 0;
  vaultFX.length = 0;
  vaultFY.length = 0;
  vaultTX.length = 0;
  vaultTY.length = 0;
  botStuckAt.length = 0;
  botLastX.length = 0;
  botLastY.length = 0;
  rX.length = 0;
  rY.length = 0;
  rA.length = 0;
  prevSt.length = 0;
  prevAnim.length = 0;
  for (let a = 0; a < NA; a++) {
    agSlot.push(0);
    agSkin.push(a);
    agX.push(5);
    agY.push(5);
    agA.push(0);
    agSt.push(0);
    agStage.push(0);
    agProg.push(0);
    agAnim.push(0);
    agFx.push(0);
    hookT.push(0);
    agHook.push(0);
    healP.push(0);
    unhookP.push(0);
    wiggleP.push(0);
    stunEnd.push(0);
    slowEnd.push(0);
    boostEnd.push(0);
    dodgeEnd.push(0);
    hAct.push(0);
    hActT.push(0);
    escTries.push(0);
    botPlanAt.push(0);
    botMode.push(0);
    botTgt.push(-1);
    pathLen.push(0);
    pathI.push(0);
    botGoal.push(-1);
    botActEnd.push(0);
    botSkillAt.push(0);
    vaultT.push(-1);
    vaultFX.push(0);
    vaultFY.push(0);
    vaultTX.push(0);
    vaultTY.push(0);
    botStuckAt.push(0);
    botLastX.push(0);
    botLastY.push(0);
    rX.push(5);
    rY.push(5);
    rA.push(0);
    prevSt.push(0);
    prevAnim.push(0);
  }
  pathBuf.length = 0;
  for (let i = 0; i < NA * PATHMAX; i++) pathBuf.push(0);
  slAct.length = 0;
  slX.length = 0;
  slY.length = 0;
  slA.length = 0;
  slFlags.length = 0;
  slRole.length = 0;
  slSkin.length = 0;
  slDo.length = 0;
  slDoT.length = 0;
  slAnim.length = 0;
  slEv.length = 0;
  slEvSeq.length = 0;
  slLastSeq.length = 0;
  slAck.length = 0;
  for (let i = 0; i < 6; i++) {
    slAct.push(0);
    slX.push(0);
    slY.push(0);
    slA.push(0);
    slFlags.push(0);
    slRole.push(1);
    slSkin.push(0);
    slDo.push(0);
    slDoT.push(0);
    slAnim.push(0);
    slEv.push(0);
    slEvSeq.push(0);
    slLastSeq.push(-1);
    slAck.push(0);
  }
  cDepth.length = 0;
  cCost.length = 0;
  cSize.length = 0;
  cBr.length = 0;
  oDepth.length = 0;
  oCost.length = 0;
  oSize.length = 0;
  oBr.length = 0;
  for (let i = 0; i < N; i++) {
    cDepth.push(99);
    cCost.push(1);
    cSize.push(100);
    cBr.push(0);
    oDepth.push(999);
    oCost.push(1);
    oSize.push(100);
    oBr.push(0);
  }
  fxX.length = 0;
  fxY.length = 0;
  fxT.length = 0;
  fxK.length = 0;
  evQ.length = 0;
}

/** Load map m (0 field, 1 house): tiles, objects and lookup tables; resets generators, pallets and gates. */
/** @warp */
function loadMap(m: number) {
  mapId = m;
  let src = M.F_MAP;
  if (m === 1) {
    src = M.H_MAP;
    mh = M.H_H;
    genC.length = 0;
    for (let i = 0; i < M.H_GENS.length; i++) genC.push(M.H_GENS[i]);
    hookC.length = 0;
    for (let i = 0; i < M.H_HOOKS.length; i++) hookC.push(M.H_HOOKS[i]);
    palC.length = 0;
    for (let i = 0; i < M.H_PALS.length; i++) palC.push(M.H_PALS[i]);
    palAx.length = 0;
    for (let i = 0; i < M.H_PALAX.length; i++) palAx.push(M.H_PALAX[i]);
    decC.length = 0;
    for (let i = 0; i < M.H_DEC_C.length; i++) decC.push(M.H_DEC_C[i]);
    decK.length = 0;
    for (let i = 0; i < M.H_DEC_K.length; i++) decK.push(M.H_DEC_K[i]);
    spawnC.length = 0;
    for (let i = 0; i < M.H_SPAWN.length; i++) spawnC.push(M.H_SPAWN[i]);
    gateC.length = 0;
    for (let i = 0; i < M.H_GATES.length; i++) gateC.push(M.H_GATES[i]);
    gateIn.length = 0;
    for (let i = 0; i < M.H_GATEIN.length; i++) gateIn.push(M.H_GATEIN[i]);
    escC.length = 0;
    for (let i = 0; i < M.H_ESC.length; i++) escC.push(M.H_ESC[i]);
    stFrom.length = 0;
    for (let i = 0; i < M.H_STAIR_FROM.length; i++) stFrom.push(M.H_STAIR_FROM[i]);
    stTo.length = 0;
    for (let i = 0; i < M.H_STAIR_TO.length; i++) stTo.push(M.H_STAIR_TO[i]);
    stAng.length = 0;
    for (let i = 0; i < M.H_STAIR_ANG.length; i++) stAng.push(M.H_STAIR_ANG[i]);
    kspawn = M.H_KSPAWN[0];
    fogK = 4.6;
    switchBackdrop("house");
  } else {
    mh = M.F_H;
    genC.length = 0;
    for (let i = 0; i < M.F_GENS.length; i++) genC.push(M.F_GENS[i]);
    hookC.length = 0;
    for (let i = 0; i < M.F_HOOKS.length; i++) hookC.push(M.F_HOOKS[i]);
    palC.length = 0;
    for (let i = 0; i < M.F_PALS.length; i++) palC.push(M.F_PALS[i]);
    palAx.length = 0;
    for (let i = 0; i < M.F_PALAX.length; i++) palAx.push(M.F_PALAX[i]);
    decC.length = 0;
    for (let i = 0; i < M.F_DEC_C.length; i++) decC.push(M.F_DEC_C[i]);
    decK.length = 0;
    for (let i = 0; i < M.F_DEC_K.length; i++) decK.push(M.F_DEC_K[i]);
    spawnC.length = 0;
    for (let i = 0; i < M.F_SPAWN.length; i++) spawnC.push(M.F_SPAWN[i]);
    gateC.length = 0;
    for (let i = 0; i < M.F_GATES.length; i++) gateC.push(M.F_GATES[i]);
    gateIn.length = 0;
    for (let i = 0; i < M.F_GATEIN.length; i++) gateIn.push(M.F_GATEIN[i]);
    escC.length = 0;
    for (let i = 0; i < M.F_ESC.length; i++) escC.push(M.F_ESC[i]);
    stFrom.length = 0;
    for (let i = 0; i < M.F_STAIR_FROM.length; i++) stFrom.push(M.F_STAIR_FROM[i]);
    stTo.length = 0;
    for (let i = 0; i < M.F_STAIR_TO.length; i++) stTo.push(M.F_STAIR_TO[i]);
    stAng.length = 0;
    for (let i = 0; i < M.F_STAIR_ANG.length; i++) stAng.push(M.F_STAIR_ANG[i]);
    kspawn = M.F_KSPAWN[0];
    fogK = 4.4;
    switchBackdrop("field");
  }
  cells = MW * mh;
  map.length = 0;
  palAt.length = 0;
  stairAt.length = 0;
  escAt.length = 0;
  genAt.length = 0;
  dist.length = 0;
  prev.length = 0;
  for (let i = 0; i < cells; i++) {
    map.push(Number(src[i]));
    palAt.push(0);
    stairAt.push(0);
    escAt.push(0);
    genAt.push(0);
    dist.push(9999);
    prev.push(-1);
  }
  for (let p = 0; p < palC.length; p++) palAt[palC[p]] = p + 1;
  for (let s = 0; s < stFrom.length; s++) stairAt[stFrom[s]] = s + 1;
  for (let e = 0; e < escC.length; e++) escAt[escC[e]] = 1;
  genP.length = 0;
  genReg.length = 0;
  genFx.length = 0;
  genWork.length = 0;
  prevGenP.length = 0;
  for (let g = 0; g < genC.length; g++) {
    genAt[genC[g]] = g + 1;
    genP.push(0);
    genReg.push(0);
    genFx.push(-9);
    genWork.push(0);
    prevGenP.push(0);
  }
  palSt.length = 0;
  prevPal.length = 0;
  for (let p = 0; p < palC.length; p++) {
    palSt.push(0);
    prevPal.push(0);
  }
  gateP.length = 0;
  prevGate.length = 0;
  for (let i = 0; i < 2; i++) {
    gateP.push(0);
    prevGate.push(0);
  }
  gensDone = 0;
  powered = false;
  collapseT = 0;
  lastGensDone = 0;
  lastPowered = false;
  lastOpen = false;
}

// ================================================================== geometry helpers

/** @warp */
function dist2(x0: number, y0: number, x1: number, y1: number): number {
  return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
}

/** Is (x, y) blocked for kind k (0 killer, 1 survivor)? Stairs are walk-in triggers; escape cells are survivor-only. */
/** @warp */
function blocked(x: number, y: number, k: number): boolean {
  if (x < 0 || y < 0 || x >= MW || y >= mh) return true;
  const c = Math.floor(x) + Math.floor(y) * MW;
  const t = map[c];
  if (t > 0 && t !== 6 && t !== 7) return true;
  const p = palAt[c];
  if (p > 0) {
    if (palSt[p - 1] === 1) return true;
  }
  if (k === 0 && escAt[c] === 1) return true;
  return false;
}

/** Move a 0.44-wide box from (x, y) by (dx, dy) with wall sliding; result in mvX, mvY. */
/** @warp */
function moveBox(x: number, y: number, dx: number, dy: number, k: number) {
  let nx = x + dx;
  if (dx !== 0) {
    const ex = nx + (dx > 0 ? 0.22 : -0.22);
    const b1 = blocked(ex, y - 0.2, k);
    const b2 = blocked(ex, y + 0.2, k);
    if (b1 || b2) nx = x;
  }
  let ny = y + dy;
  if (dy !== 0) {
    const ey = ny + (dy > 0 ? 0.22 : -0.22);
    const b3 = blocked(nx - 0.2, ey, k);
    const b4 = blocked(nx + 0.2, ey, k);
    if (b3 || b4) ny = y;
  }
  mvX = nx;
  mvY = ny;
}

/** If (x, y) is inside something solid, find a free spot: off a dropped pallet along its gap (toward side sx, sy), else
 * the nearest open cell. Result in mvX, mvY (unchanged position if it was fine). */
/** @warp */
function unstickAt(x: number, y: number, k: number, sx: number, sy: number) {
  mvX = x;
  mvY = y;
  const bad = blocked(x, y, k);
  if (!bad) return;
  const c = Math.floor(x) + Math.floor(y) * MW;
  const p = palAt[c];
  if (p > 0) {
    const ox = ((c) % MW + 0.5);
    const oy = (Math.floor((c) / MW) + 0.5);
    if (palAx[p - 1] === 0) {
      mvX = ox + (sx - ox >= 0 ? 0.85 : -0.85);
      mvY = oy;
    } else {
      mvX = ox;
      mvY = oy + (sy - oy >= 0 ? 0.85 : -0.85);
    }
    const ok = blocked(mvX, mvY, k);
    if (!ok) return;
  }
  let best = -1;
  let bd = 9999;
  for (let i = 0; i < cells; i++) {
    if (map[i] === 0 && palAt[i] === 0 && escAt[i] === 0) {
      const dx = ((i) % MW + 0.5) - x;
      const dy = (Math.floor((i) / MW) + 0.5) - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  if (best >= 0) {
    mvX = ((best) % MW + 0.5);
    mvY = (Math.floor((best) / MW) + 0.5);
  }
}

/** Line of sight between two points (walls block, props don't). */
/** @warp */
function los(x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  const n = Math.ceil(d / 0.3);
  for (let i = 1; i < n; i++) {
    const c = Math.floor(x0 + (dx * i) / n) + Math.floor(y0 + (dy * i) / n) * MW;
    const t = map[c];
    if (t >= 1 && t <= 7) return false;
  }
  return true;
}

/** Is (x, y) within range and in front of someone at (ox, oy) looking at angle a? */
/** @warp */
function facingFrom(ox: number, oy: number, a: number, x: number, y: number, range: number, dot: number): boolean {
  const dx = x - ox;
  const dy = y - oy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > range) return false;
  if (d < 0.35) return true;
  return (dx * cos(a) + dy * sin(a)) / d > dot;
}

/** @warp */
function floorOf(y: number): number {
  if (mapId === 1 && y >= 24) return 1;
  return 0;
}

/** Stairs: if (x, y) is a stairs cell, mvX/mvY/mvA are the landing on the other floor and it returns true. */
let mvA = 0;
/** @warp */
function stairsAt(x: number, y: number): boolean {
  const s = stairAt[Math.floor(x) + Math.floor(y) * MW];
  if (s === 0) return false;
  mvX = ((stTo[s - 1]) % MW + 0.5);
  mvY = (Math.floor((stTo[s - 1]) / MW) + 0.5);
  mvA = stAng[s - 1];
  return true;
}

/** @warp */
function angTo(x0: number, y0: number, x1: number, y1: number): number {
  return MathX.atan2(y1 - y0, x1 - x0);
}

/** @warp */
function angDiff(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

// ================================================================== host: match flow and rules

/** @warp */
function survSpeedMul(a: number): number {
  if (timer() < boostEnd[a]) return 1.45;
  return 1;
}

/** Does slot s want to be the killer, and which skin? (s = 0 for this machine when offline) */
/** @warp */
function humanRole(s: number): number {
  if (s === mySlot()) return myRole;
  return slRole[s - 1];
}

/** @warp */
function humanSkin(s: number, role: number): number {
  if (s === mySlot()) {
    if (role === 2) return myKSkin;
    return mySkin;
  }
  if (role === 2) return slSkin[s - 1] % 3;
  return slSkin[s - 1];
}

/** @warp */
function mySlot(): number {
  if (offline) return 1;
  return Net.session.slot;
}

/** Is slot s a human who is in the game (ready, not in menus)? */
/** @warp */
function humanIn(s: number): boolean {
  if (s === mySlot()) return mode === 5;
  if (offline) return false;
  return slAct[s - 1] === 1 && slFlags[s - 1] % 2 === 1;
}

/** Waiting for a match (in game, not looking at results). */
/** @warp */
function humanWaiting(s: number): boolean {
  if (s === mySlot()) return mode === 5 && !onResults;
  if (offline) return false;
  return slAct[s - 1] === 1 && slFlags[s - 1] % 2 === 1 && Math.floor(slFlags[s - 1] / 4) % 2 === 0;
}

/** @warp */
function agentOfSlot(s: number): number {
  for (let a = 0; a < NA; a++) {
    if (agSlot[a] === s) return a;
  }
  return -1;
}

/** @warp */
function skinUsed(k: number): boolean {
  for (let a = 1; a < NA; a++) {
    if (agSkin[a] === k) return true;
  }
  return false;
}

/** @warp */
function freeSkin(not: number): number {
  let k = random(0, 9);
  for (let t = 0; t < 12; t++) {
    const used = skinUsed(k);
    if (used || k === not) k = (k + 1) % 10;
  }
  return k;
}

/** @warp */
function resetAgent(a: number) {
  agSt[a] = 0;
  agStage[a] = 0;
  agProg[a] = 0;
  agAnim[a] = 0;
  agFx[a] = 0;
  hookT[a] = 0;
  healP[a] = 0;
  unhookP[a] = 0;
  wiggleP[a] = 0;
  stunEnd[a] = 0;
  slowEnd[a] = 0;
  boostEnd[a] = 0;
  dodgeEnd[a] = 0;
  escTries[a] = 0;
  botMode[a] = 0;
  botTgt[a] = -1;
  pathLen[a] = 0;
  pathI[a] = 0;
  botPlanAt[a] = 0;
  vaultT[a] = -1;
}

/** Host: start a new match on a random map with every waiting human; bots fill the rest. */
/** @warp */
function newMatch() {
  hGame = (hGame + 1) % 10;
  const m = random(0, 1);
  loadMap(m);
  for (let a = 0; a < NA; a++) {
    agSlot[a] = 0;
    agSkin[a] = -1;
    resetAgent(a);
  }
  // the killer: the lowest slot that wants it
  for (let s = 6; s >= 1; s--) {
    const inG = humanIn(s);
    if (inG && humanRole(s) === 2) agSlot[0] = s;
  }
  if (agSlot[0] > 0) agSkin[0] = humanSkin(agSlot[0], 2);
  else agSkin[0] = random(0, 2);
  for (let s = 1; s <= 6; s++) {
    const inG = humanIn(s);
    if (inG && agSlot[0] !== s) {
      let free = -1;
      for (let a = NA - 1; a >= 1; a--) {
        if (agSlot[a] === 0) free = a;
      }
      if (free > 0) {
        agSlot[free] = s;
        agSkin[free] = humanSkin(s, 1);
      }
    }
  }
  for (let a = 1; a < NA; a++) {
    if (agSlot[a] === 0) {
      const k = freeSkin(-1);
      agSkin[a] = k;
    }
  }
  for (let a = 0; a < NA; a++) {
    let c = kspawn;
    if (a > 0) c = spawnC[a - 1];
    agX[a] = ((c) % MW + 0.5);
    agY[a] = (Math.floor((c) / MW) + 0.5);
    agA[a] = a === 0 ? 180 : 0;
    rX[a] = agX[a];
    rY[a] = agY[a];
  }
  kChase = -1;
  kSeenAt = -99;
  kPatrolGen = -1;
  noiseSeq = (noiseSeq + 1) % 10;
  noiseCell = 0;
  hPhase = 1;
  matchAt = timer();
  hTime = MATCH_TIME;
  timeUp = 0;
}

/** Host: give humans who joined mid-match a bot's body, and hand disconnected humans' bodies to bots. */
/** @warp */
function hostAssign() {
  for (let a = 0; a < NA; a++) {
    if (agSlot[a] > 0) {
      const still = humanIn(agSlot[a]);
      if (!still) {
        agSlot[a] = 0;
        botPlanAt[a] = 0;
        pathLen[a] = 0;
      }
    }
  }
  if (hPhase !== 1) return;
  for (let s = 1; s <= 6; s++) {
    const inG = humanIn(s);
    if (inG) {
      const has = agentOfSlot(s);
      if (has < 0) {
        let pick = -1;
        if (humanRole(s) === 2 && agSlot[0] === 0) pick = 0;
        else {
          for (let a = NA - 1; a >= 1; a--) {
            if (agSlot[a] === 0 && agSt[a] < 5) pick = a;
          }
        }
        if (pick >= 0) {
          agSlot[pick] = s;
          if (pick === 0) agSkin[0] = humanSkin(s, 2);
          else agSkin[pick] = humanSkin(s, 1);
        }
      }
    }
  }
}

/** Host: a game event from agent a (humans send them in their packet; bots call this directly). */
/** @warp */
function applyEvent(a: number, code: number) {
  if (hPhase !== 1) return;
  if (code >= 100 && code < 105) hitSurvivor(code - 100);
  else if (code >= 200 && code < 205) pickUp(code - 200);
  else if (code >= 300 && code < 340) hookCarried(code - 300);
  else if (code >= 400 && code < 440) {
    const p = code - 400;
    if (palSt[p] === 1) {
      palSt[p] = 2;
      addFxAt(((palC[p]) % MW + 0.5), (Math.floor((palC[p]) / MW) + 0.5), C_FX_DUST);
    }
  } else if (code >= 500 && code < 510) {
    const g = code - 500;
    if (genP[g] < 100 && genP[g] > 0) {
      genP[g] = Math.max(0, genP[g] - 6);
      genReg[g] = 1;
    }
  } else if (code >= 610 && code < 630) dropPallet(a, code - 610);
  else if (code >= 630 && code < 640) {
    const g2 = code - 630;
    if (genP[g2] < 100) genP[g2] = Math.max(0, genP[g2] - 8);
    makeNoise(genC[g2]);
  } else if (code >= 640 && code < 650) {
    const g3 = code - 640;
    if (genP[g3] < 100) genP[g3] = Math.min(99.9, genP[g3] + 2.5);
  } else if (code === 650) {
    if (agSt[a] === 4 && agStage[a] === 1 && escTries[a] < 3) {
      escTries[a]++;
      if (random(1, 100) <= 6) unhook(a, 0);
      else hookT[a] = hookT[a] - 12;
    }
  } else if (code >= 660 && code < 665) {
    const t = code - 660;
    healP[t] = Math.max(0, healP[t] - 10);
    makeNoise(Math.floor(agX[a]) + Math.floor(agY[a]) * MW);
  } else if (code === 670) dodgeEnd[a] = timer() + 0.6;
}

/** @warp */
function makeNoise(c: number) {
  noiseSeq = (noiseSeq + 1) % 10;
  noiseCell = c;
}

/** @warp */
function hitSurvivor(t: number) {
  if (agSt[0] !== 0 || (agSt[t] !== 0 && agSt[t] !== 1)) return;
  if (dist2(agX[0], agY[0], agX[t], agY[t]) > 2.6) return;
  if (timer() < dodgeEnd[t]) return;
  agSt[t] = agSt[t] + 1;
  healP[t] = 0;
  boostEnd[t] = timer() + 1.8;
  slowEnd[0] = timer() + 2.6;
  if (agFx[0] === 2) agFx[0] = 0; // a hit ends Vanish
}

/** @warp */
function pickUp(t: number) {
  if (agSt[0] !== 0 || agSt[t] !== 2) return;
  if (dist2(agX[0], agY[0], agX[t], agY[t]) > 2.2) return;
  agSt[t] = 3;
  agSt[0] = 2;
  wiggleP[t] = 0;
  healP[t] = 0;
}

/** @warp */
function carried(): number {
  for (let a = 1; a < NA; a++) {
    if (agSt[a] === 3) return a;
  }
  return -1;
}

/** @warp */
function hookCarried(h: number) {
  const t = carried();
  if (t < 0 || agSt[0] !== 2) return;
  if (dist2(agX[0], agY[0], ((hookC[h]) % MW + 0.5), (Math.floor((hookC[h]) / MW) + 0.5)) > 2.2) return;
  agSt[0] = 0;
  agHook[t] = h;
  agStage[t] = agStage[t] + 1;
  escTries[t] = 0;
  unhookP[t] = 0;
  if (agStage[t] >= 3) {
    agSt[t] = 5;
    return;
  }
  agSt[t] = 4;
  if (agStage[t] === 1) hookT[t] = HOOK_STAGE * 2;
  else hookT[t] = HOOK_STAGE;
  agX[t] = ((hookC[h]) % MW + 0.5);
  agY[t] = (Math.floor((hookC[h]) / MW) + 0.5);
}

/** Off the hook (by = helper agent, 0 for a self-unhook). */
/** @warp */
function unhook(t: number, by: number) {
  agSt[t] = 1;
  if (by > 0 && agSkin[by] === 6) agSt[t] = 0; // Lifeline
  unhookP[t] = 0;
  boostEnd[t] = timer() + 1.5;
  if (agStage[t] === 1 && hookT[t] <= HOOK_STAGE) agStage[t] = 2;
}

/** @warp */
function dropPallet(a: number, p: number) {
  if (palSt[p] !== 0) return;
  const ox = ((palC[p]) % MW + 0.5);
  const oy = (Math.floor((palC[p]) / MW) + 0.5);
  if (dist2(agX[a], agY[a], ox, oy) > 1.9) return;
  palSt[p] = 1;
  makeNoise(palC[p]);
  if (dist2(agX[0], agY[0], ox, oy) < 1.25 && agSt[0] !== 1) {
    // stunned! (and drops whoever it was carrying)
    const t = carried();
    if (t >= 0) {
      agSt[t] = 1;
      boostEnd[t] = timer() + 1.5;
    }
    agSt[0] = 1;
    stunEnd[0] = timer() + (agSkin[a] === 4 ? 3 : 2);
    if (agSlot[0] === 0) {
      unstickAt(agX[0], agY[0], 0, agX[0], agY[0]);
      agX[0] = mvX;
      agY[0] = mvY;
    }
  }
  if (agSlot[a] === 0) {
    unstickAt(agX[a], agY[a], 1, agX[a], agY[a]);
    agX[a] = mvX;
    agY[a] = mvY;
  }
}

/** Host: per-frame rules (activities, hooks, wiggling, gates, collapse, match end). */
/** @warp */
function hostRules(dt: number) {
  for (let g = 0; g < genC.length; g++) genWork[g] = 0;
  // killer
  if (agSt[0] === 1 && timer() > stunEnd[0]) agSt[0] = 0;
  if (agSt[0] === 2) {
    const ct = carried();
    if (ct < 0) agSt[0] = 0;
  }
  for (let a = 1; a < NA; a++) {
    const st = agSt[a];
    const act = hAct[a];
    const at = hActT[a];
    if (st === 3) {
      agX[a] = agX[0];
      agY[a] = agY[0];
      if (act === 5) {
        let rate = 100 / 16;
        if (agSkin[a] === 9) rate = rate * 2;
        if (agSkin[0] === 2) rate = rate * 0.6;
        wiggleP[a] = wiggleP[a] + rate * dt;
        if (wiggleP[a] >= 100) {
          agSt[a] = 1;
          boostEnd[a] = timer() + 1.8;
          agSt[0] = 1;
          stunEnd[0] = timer() + 3;
          wiggleP[a] = 0;
          if (agSlot[a] === 0) {
            unstickAt(agX[a] + cos(agA[0]) * 0.5, agY[a] + sin(agA[0]) * 0.5, 1, agX[0], agY[0]);
            agX[a] = mvX;
            agY[a] = mvY;
          }
        }
      }
      agProg[a] = Math.min(99, Math.floor(wiggleP[a]));
    } else if (st === 4) {
      agX[a] = (hookC[agHook[a]] % MW) + 0.5;
      agY[a] = Math.floor(hookC[agHook[a]] / MW) + 0.5;
      hookT[a] = hookT[a] - dt;
      if (agStage[a] === 1 && hookT[a] <= HOOK_STAGE) agStage[a] = 2;
      if (hookT[a] <= 0) agSt[a] = 5;
      agProg[a] = Math.max(0, Math.min(99, Math.floor((hookT[a] / (HOOK_STAGE * 2)) * 100)));
    } else if (st <= 2) {
      const c = Math.floor(agX[a]) + Math.floor(agY[a]) * MW;
      if (escAt[c] === 1) agSt[a] = 6;
      agProg[a] = Math.min(99, Math.floor(healP[a]));
    }
    // what this survivor is doing
    if (st <= 1) {
      if (act === 1 && at < genC.length && !powered) {
        if (genP[at] < 100) {
          let rate = 100 / GEN_TIME;
          if (agSkin[a] === 1) rate = rate * 1.3;
          genP[at] = genP[at] + rate * dt;
          genReg[at] = 0;
          genWork[at] = genWork[at] + 1;
          genFx[at] = timer();
          if (genP[at] >= 100) {
            genP[at] = 100;
            makeNoise(genC[at]);
          }
        }
      } else if ((act === 2 && at >= 1 && at < NA) || (act === 6 && st === 1)) {
        let t = at;
        if (act === 6) t = a;
        if (agSt[t] === 1 || agSt[t] === 2) {
          let hr = 100 / 12;
          if (agSkin[a] === 2) hr = hr * 2;
          if (act === 6) hr = 100 / 24;
          healP[t] = healP[t] + hr * dt;
          if (healP[t] >= 100) {
            healP[t] = 0;
            agSt[t] = agSt[t] - 1;
          }
        }
      } else if (act === 3 && at >= 1 && at < NA) {
        if (agSt[at] === 4) {
          let ur = 100;
          if (agSkin[a] === 6) ur = 300;
          unhookP[at] = unhookP[at] + ur * dt;
          if (unhookP[at] >= 100) unhook(at, a);
        }
      } else if (act === 4 && at < 2 && powered) {
        if (gateP[at] < 100) {
          gateP[at] = gateP[at] + (100 / GATE_TIME) * dt;
          if (gateP[at] >= 100) {
            gateP[at] = 100;
            if (collapseT <= 0) collapseT = COLLAPSE;
          }
        }
      }
    }
  }
  for (let g = 0; g < genC.length; g++) {
    if (genReg[g] === 1 && genWork[g] === 0 && genP[g] < 100) {
      genP[g] = Math.max(0, genP[g] - 0.35 * dt);
      if (genP[g] <= 0) genReg[g] = 0;
    }
  }
  // dawn: the gates lock and whoever is still inside is lost
  hTime = hTime - dt;
  if (hTime <= 0 && timeUp === 0) {
    hTime = 0;
    timeUp = 1;
    for (let a = 1; a < NA; a++) {
      if (agSt[a] <= 4) agSt[a] = 5;
    }
    if (agSt[0] === 2) agSt[0] = 0;
  }
  if (collapseT > 0) {
    collapseT = collapseT - dt;
    if (collapseT <= 0) {
      collapseT = 0.01;
      for (let a = 1; a < NA; a++) {
        if (agSt[a] <= 4) agSt[a] = 5;
      }
      if (agSt[0] === 2) agSt[0] = 0;
    }
  }
  // match over when nobody is left in the trial
  let left = 0;
  for (let a = 1; a < NA; a++) {
    if (agSt[a] <= 4) left++;
  }
  if (left === 0) {
    hPhase = 2;
    endAt = timer();
  }
}

/** Generators done, gates powered/open (every client derives these from the synced progress). */
/** @warp */
function deriveWorld() {
  gensDone = 0;
  for (let g = 0; g < genC.length; g++) {
    if (genP[g] >= 100) gensDone++;
  }
  powered = gensDone >= 5;
  for (let i = 0; i < 2; i++) {
    if (gateP[i] >= 100) map[gateC[i]] = 0;
    else map[gateC[i]] = 4;
  }
}

// ================================================================== bots

/** Breadth-first search from cell s for kind k (stairs teleport; dropped pallets count as passable). */
/** @warp */
function bfs(s: number, k: number) {
  for (let i = 0; i < cells; i++) dist[i] = 9999;
  queue.length = 0;
  bfsStart = s;
  dist[s] = 0;
  prev[s] = -1;
  queue.push(s);
  let head = 0;
  while (head < queue.length) {
    const q = queue[head];
    head++;
    const d = dist[q] + 1;
    const st = stairAt[q];
    if (st > 0 && q !== s) bvisit(stTo[st - 1], q, d, k);
    else {
      bvisit(q - 1, q, d, k);
      bvisit(q + 1, q, d, k);
      bvisit(q - MW, q, d, k);
      bvisit(q + MW, q, d, k);
    }
  }
}

/** @warp */
function bvisit(n: number, from: number, d: number, k: number) {
  if (dist[n] <= d) return;
  const t = map[n];
  if (t !== 0 && t !== 6 && t !== 7) return;
  if (k === 0 && escAt[n] === 1) return;
  dist[n] = d;
  prev[n] = from;
  queue.push(n);
}

/** Store the path from the last bfs start to goal g for agent a. */
/** @warp */
function setPath(a: number, g: number) {
  tmp.length = 0;
  let c = g;
  let guard = 0;
  while (c !== bfsStart && c >= 0 && guard < 400) {
    tmp.push(c);
    c = prev[c];
    guard++;
  }
  const n = Math.min(tmp.length, PATHMAX);
  for (let i = 0; i < n; i++) pathBuf[a * PATHMAX + i] = tmp[tmp.length - 1 - i];
  pathLen[a] = n;
  pathI[a] = 0;
  botGoal[a] = g;
}

/** Best open cell next to generator g (by the last bfs). */
/** @warp */
function genSpot(g: number): number {
  const c = genC[g];
  let best = c - 1;
  let bd = dist[c - 1];
  if (dist[c + 1] < bd) {
    best = c + 1;
    bd = dist[c + 1];
  }
  if (dist[c - MW] < bd) {
    best = c - MW;
    bd = dist[c - MW];
  }
  if (dist[c + MW] < bd) best = c + MW;
  return best;
}

/** @warp */
function nearestHook(): number {
  let best = 0;
  let bd = 99999;
  for (let h = 0; h < hookC.length; h++) {
    let busy = false;
    for (let a = 1; a < NA; a++) {
      if (agSt[a] === 4 && agHook[a] === h) busy = true;
    }
    if (!busy && dist[hookC[h]] < bd) {
      bd = dist[hookC[h]];
      best = h;
    }
  }
  return best;
}

/** Survivor bot: choose what to do and plan a path. */
/** @warp */
function planSurvivor(a: number) {
  const me = Math.floor(agX[a]) + Math.floor(agY[a]) * MW;
  bfs(me, 1);
  const kd = dist2(agX[a], agY[a], agX[0], agY[0]);
  const seen = los(agX[a], agY[a], agX[0], agY[0]);
  let threat = (seen && kd < 7.5) || kd < 3;
  if (agFx[0] === 2 && kd > 2) threat = false; // Vanish
  if (agSt[0] === 2) threat = kd < 2.5;
  if (agSt[0] === 1) threat = false;
  botMode[a] = 0;
  botTgt[a] = -1;
  if (threat || agSt[a] === 2) {
    // flee: somewhere far from the killer that we reach first
    let best = -1;
    let bs = -9999;
    for (let k = 0; k < 14; k++) {
      let c = random(0, cells - 1);
      if (k < palC.length && palSt[k] === 0) c = palC[k];
      if (dist[c] < 9999 && dist[c] > 1) {
        const ek = dist2(((c) % MW + 0.5), (Math.floor((c) / MW) + 0.5), agX[0], agY[0]);
        const sc = ek - dist[c] * 0.3 + (palAt[c] > 0 ? 2.5 : 0);
        if (ek > kd + 1.5 && sc > bs) {
          bs = sc;
          best = c;
        }
      }
    }
    if (best >= 0) {
      botMode[a] = 6;
      setPath(a, best);
      return;
    }
  }
  if (powered) {
    let open = -1;
    for (let i = 0; i < 2; i++) {
      if (gateP[i] >= 100) open = i;
    }
    if (open >= 0) {
      botMode[a] = 5;
      let be = escC[0];
      for (let e = 0; e < escC.length; e++) {
        if (dist[escC[e]] < dist[be]) be = escC[e];
      }
      setPath(a, be);
      return;
    }
    // the gate that's quicker to reach, unless the killer is guarding it
    let s0 = dist[gateIn[0]];
    let s1 = dist[gateIn[1]];
    const k0 = dist2((gateIn[0] % MW) + 0.5, Math.floor(gateIn[0] / MW) + 0.5, agX[0], agY[0]);
    const k1 = dist2((gateIn[1] % MW) + 0.5, Math.floor(gateIn[1] / MW) + 0.5, agX[0], agY[0]);
    if (k0 < 7) s0 = s0 + 40;
    if (k1 < 7) s1 = s1 + 40;
    let gi = 0;
    if (s1 < s0) gi = 1;
    botMode[a] = 4;
    botTgt[a] = gi;
    setPath(a, gateIn[gi]);
    return;
  }
  // rescue a hooked teammate if we're the closest one free to do it
  for (let t = 1; t < NA; t++) {
    if (agSt[t] === 4 && botMode[a] === 0) {
      const hc = hookC[agHook[t]];
      const hd = dist2(((hc) % MW + 0.5), (Math.floor((hc) / MW) + 0.5), agX[0], agY[0]);
      let closest = true;
      const myD = dist2(agX[a], agY[a], ((hc) % MW + 0.5), (Math.floor((hc) / MW) + 0.5));
      for (let o = 1; o < NA; o++) {
        if (o !== a && o !== t && agSt[o] <= 1) {
          const oD = dist2(agX[o], agY[o], ((hc) % MW + 0.5), (Math.floor((hc) / MW) + 0.5));
          if (oD < myD - 0.5) closest = false;
        }
      }
      if (closest && (hd > 6 || agStage[t] >= 2) && dist[hc] < 9999) {
        botMode[a] = 2;
        botTgt[a] = t;
        setPath(a, hc);
      }
    }
  }
  if (botMode[a] > 0) return;
  // heal a downed teammate when the killer is far
  for (let t2 = 1; t2 < NA; t2++) {
    if (t2 !== a && agSt[t2] === 2 && botMode[a] === 0 && kd > 9) {
      const tc = Math.floor(agX[t2]) + Math.floor(agY[t2]) * MW;
      if (dist[tc] < 30) {
        botMode[a] = 3;
        botTgt[a] = t2;
        setPath(a, tc);
      }
    }
  }
  if (botMode[a] > 0) return;
  // repair: the nearest unfinished generator, avoiding crowds
  let bg = -1;
  let bgs = 99999;
  for (let g = 0; g < genC.length; g++) {
    if (genP[g] < 100) {
      const sp = genSpot(g);
      let sc2 = dist[sp] - genP[g] * 0.08;
      for (let o2 = 1; o2 < NA; o2++) {
        if (o2 !== a && botMode[o2] === 1 && botTgt[o2] === g) sc2 = sc2 + 14;
      }
      if (dist2(((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), agX[0], agY[0]) < 6) sc2 = sc2 + 20;
      if (sc2 < bgs) {
        bgs = sc2;
        bg = g;
      }
    }
  }
  if (bg >= 0) {
    botMode[a] = 1;
    botTgt[a] = bg;
    const sp2 = genSpot(bg);
    setPath(a, sp2);
  }
}

/** Killer bot: choose a target and plan a path. */
/** @warp */
function planKiller() {
  const me = Math.floor(agX[0]) + Math.floor(agY[0]) * MW;
  bfs(me, 0);
  botMode[0] = 10;
  if (agSt[0] === 2) {
    const h = nearestHook();
    botMode[0] = 9;
    botTgt[0] = h;
    setPath(0, hookC[h]);
    return;
  }
  // who can we see?
  let bestT = -1;
  let bd = 99;
  let downT = -1;
  let dd = 99;
  for (let t = 1; t < NA; t++) {
    const st = agSt[t];
    if (st <= 2) {
      const d = dist2(agX[0], agY[0], agX[t], agY[t]);
      let vis = d < 2.5;
      if (!vis && d < 12) {
        const l = los(agX[0], agY[0], agX[t], agY[t]);
        if (l) {
          const fc = facingFrom(agX[0], agY[0], agA[0], agX[t], agY[t], 12, 0.35);
          vis = fc || d < 4.5;
        }
      }
      if (timer() < kIgnoreUntil && st <= 1 && d > 3) vis = false; // just hooked someone: go patrol
      if (vis && st === 2 && d < dd) {
        dd = d;
        downT = t;
      }
      if (vis && st <= 1 && d < bd) {
        bd = d;
        bestT = t;
      }
    }
  }
  if (downT >= 0 && (bestT < 0 || dd < bd + 4)) {
    botMode[0] = 8;
    botTgt[0] = downT;
    setPath(0, Math.floor(agX[downT]) + Math.floor(agY[downT]) * MW);
    return;
  }
  if (bestT >= 0) {
    kChase = bestT;
    kSeenX = agX[bestT];
    kSeenY = agY[bestT];
    kSeenAt = timer();
    botMode[0] = 7;
    botTgt[0] = bestT;
    setPath(0, Math.floor(kSeenX) + Math.floor(kSeenY) * MW);
    return;
  }
  if (timer() - kSeenAt < 3) {
    botMode[0] = 11;
    setPath(0, Math.floor(kSeenX) + Math.floor(kSeenY) * MW);
    return;
  }
  if (noiseUntil > timer() && noiseCell > 0) {
    botMode[0] = 11;
    setPath(0, noiseCell);
    noiseUntil = 0;
    return;
  }
  // patrol the generator with the most progress
  if (kPatrolGen < 0 || genP[kPatrolGen] >= 100 || botGoal[0] < 0 || pathI[0] >= pathLen[0]) {
    let bg = -1;
    let bs = -1;
    for (let g = 0; g < genC.length; g++) {
      if (genP[g] < 100 && g !== kPatrolGen) {
        const sc = genP[g] + random(0, 35);
        if (sc > bs) {
          bs = sc;
          bg = g;
        }
      }
    }
    kPatrolGen = bg;
  }
  if (kPatrolGen >= 0) {
    const sp = genSpot(kPatrolGen);
    setPath(0, sp);
  } else {
    setPath(0, gateIn[random(0, 1)]);
  }
}

/** Walk agent a along its path; returns true when it's at the end. */
/** @warp */
function followPath(a: number, speed: number, dt: number, k: number): boolean {
  if (pathI[a] >= pathLen[a]) return true;
  const c = pathBuf[a * PATHMAX + pathI[a]];
  const tx = ((c) % MW + 0.5);
  const ty = (Math.floor((c) / MW) + 0.5);
  // dropped pallet next: survivors vault, the killer breaks it
  const p = palAt[c];
  if (p > 0) {
    if (palSt[p - 1] === 1) {
      if (k === 1 && pathI[a] + 1 < pathLen[a]) {
        const c2 = pathBuf[a * PATHMAX + pathI[a] + 1];
        startBotVault(a, ((c2) % MW + 0.5), (Math.floor((c2) / MW) + 0.5), agSkin[a] === 4 ? 0.35 : 0.55);
        pathI[a] = pathI[a] + 2;
        return false;
      }
      if (k === 0) {
        agA[0] = angTo(agX[0], agY[0], tx, ty);
        agAnim[0] = 5;
        if (botActEnd[0] === 0) botActEnd[0] = timer() + (agSkin[0] === 0 ? 1.2 : 2.4);
        if (timer() > botActEnd[0]) {
          botActEnd[0] = 0;
          applyEvent(0, 400 + p - 1);
        }
        return false;
      }
    }
  }
  const dx = tx - agX[a];
  const dy = ty - agY[a];
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.18) {
    pathI[a] = pathI[a] + 1;
    return pathI[a] >= pathLen[a];
  }
  const step = Math.min(d, speed * dt);
  moveBox(agX[a], agY[a], (dx / d) * step, (dy / d) * step, k);
  agX[a] = mvX;
  agY[a] = mvY;
  agA[a] = angTo(0, 0, dx, dy);
  agAnim[a] = 1;
  const onStairs = stairsAt(agX[a], agY[a]);
  if (onStairs) {
    agX[a] = mvX;
    agY[a] = mvY;
    agA[a] = mvA;
    pathI[a] = pathI[a] + 1;
  }
  return false;
}

/** @warp */
function startBotVault(a: number, tx: number, ty: number, dur: number) {
  vaultT[a] = 0;
  vaultFX[a] = agX[a];
  vaultFY[a] = agY[a];
  vaultTX[a] = tx;
  vaultTY[a] = ty;
  botActEnd[a] = dur;
  agAnim[a] = 4;
}

/** Bot skill check on a generator / heal: occasionally fails (noise + regression). */
/** @warp */
function botSkill(a: number, gen: number, healT: number) {
  if (timer() < botSkillAt[a]) return;
  botSkillAt[a] = timer() + 3 + Math.random() * 5;
  const r = random(1, 100);
  if (r <= 9) {
    if (gen >= 0) applyEvent(a, 630 + gen);
    else applyEvent(a, 660 + healT);
  } else if (r >= 80 && gen >= 0) applyEvent(a, 640 + gen);
}

/** Survivor bot, every frame. */
/** @warp */
function botSurvivor(a: number, dt: number) {
  hAct[a] = 0;
  agAnim[a] = 0;
  const st = agSt[a];
  if (st === 3) {
    // wiggle!
    hAct[a] = 5;
    agAnim[a] = 2;
    return;
  }
  if (st >= 4) return;
  if (vaultT[a] >= 0) {
    vaultT[a] = vaultT[a] + dt;
    const f = Math.min(1, vaultT[a] / botActEnd[a]);
    agX[a] = vaultFX[a] + (vaultTX[a] - vaultFX[a]) * f;
    agY[a] = vaultFY[a] + (vaultTY[a] - vaultFY[a]) * f;
    agAnim[a] = 4;
    if (f >= 1) vaultT[a] = -1;
    return;
  }
  const kd = dist2(agX[a], agY[a], agX[0], agY[0]);
  // re-plan now and then (quickly when the killer is close)
  let every = 1.4;
  if (kd < 8 || st === 2) every = 0.5;
  if (timer() > botPlanAt[a]) {
    botPlanAt[a] = timer() + every + Math.random() * 0.3;
    planSurvivor(a);
  }
  // stuck? re-plan
  if (timer() > botStuckAt[a]) {
    botStuckAt[a] = timer() + 1.5;
    if (dist2(botLastX[a], botLastY[a], agX[a], agY[a]) < 0.2 && hAct[a] === 0 && botMode[a] !== 1) botPlanAt[a] = 0;
    botLastX[a] = agX[a];
    botLastY[a] = agY[a];
  }
  // throw a pallet down between us and the killer
  if (st <= 1 && kd < 2.8 && agSt[0] !== 1) {
    for (let p = 0; p < palC.length; p++) {
      if (palSt[p] === 0) {
        const ox = ((palC[p]) % MW + 0.5);
        const oy = (Math.floor((palC[p]) / MW) + 0.5);
        if (dist2(agX[a], agY[a], ox, oy) < 1.1) {
          let between = false;
          if (palAx[p] === 0) between = (agX[a] - ox) * (agX[0] - ox) < 0 || Math.abs(agX[0] - ox) < 0.9;
          else between = (agY[a] - oy) * (agY[0] - oy) < 0 || Math.abs(agY[0] - oy) < 0.9;
          if (between) applyEvent(a, 610 + p);
        }
      }
    }
  }
  let speed = SURV_SPD * survSpeedMul(a);
  if (st === 2) speed = 0.55;
  if (agSkin[a] === 0 && kd < 5 && timer() > botActEnd[a] + 40 && st <= 1) {
    boostEnd[a] = timer() + 3; // Sprint Burst
    botActEnd[a] = timer();
  }
  const done = followPath(a, speed, dt, 1);
  if (!done || st === 2) return;
  const m = botMode[a];
  const t = botTgt[a];
  if (m === 1 && t >= 0 && genP[t] < 100 && !powered) {
    const gx = ((genC[t]) % MW + 0.5);
    const gy = (Math.floor((genC[t]) / MW) + 0.5);
    if (dist2(agX[a], agY[a], gx, gy) < 1.5) {
      hAct[a] = 1;
      hActT[a] = t;
      agAnim[a] = 2;
      agA[a] = angTo(agX[a], agY[a], gx, gy);
      botSkill(a, t, 0);
    } else botPlanAt[a] = 0;
  } else if (m === 2 && t > 0 && agSt[t] === 4) {
    hAct[a] = 3;
    hActT[a] = t;
    agAnim[a] = 2;
  } else if (m === 3 && t > 0 && agSt[t] === 2) {
    if (dist2(agX[a], agY[a], agX[t], agY[t]) < 1.4) {
      hAct[a] = 2;
      hActT[a] = t;
      agAnim[a] = 2;
      agA[a] = angTo(agX[a], agY[a], agX[t], agY[t]);
      botSkill(a, -1, t);
    } else botPlanAt[a] = 0;
  } else if (m === 4 && t >= 0) {
    hAct[a] = 4;
    hActT[a] = t;
    agAnim[a] = 2;
    agA[a] = angTo(agX[a], agY[a], ((gateC[t]) % MW + 0.5), (Math.floor((gateC[t]) / MW) + 0.5));
    if (gateP[t] >= 100) botPlanAt[a] = 0;
  } else if (m === 1 && t >= 0 && genP[t] >= 100) {
    botPlanAt[a] = 0;
  } else if (m !== 1 || t < 0) {
    if (m !== 5) botPlanAt[a] = Math.min(botPlanAt[a], timer() + 0.3);
  } else {
    botPlanAt[a] = 0;
  }
}

/** Killer bot, every frame. */
/** @warp */
function botKiller(dt: number) {
  agAnim[0] = 0;
  if (agSt[0] === 1) {
    pathLen[0] = 0;
    botPlanAt[0] = timer() + 0.2;
    return;
  }
  // swing in progress
  if (kSwingAt > 0) {
    agAnim[0] = 3;
    if (!kSwingHit && timer() - kSwingAt > 0.22) {
      kSwingHit = true;
      let t = attackTarget(agX[0], agY[0], agA[0]);
      if (random(1, 100) <= 22) t = 0; // bots aren't perfect
      if (t > 0) applyEvent(0, 100 + t);
      else slowEnd[0] = timer() + 0.8;
    }
    if (timer() - kSwingAt > 0.45) kSwingAt = 0;
  }
  let every = 0.6;
  if (botMode[0] === 7) every = 0.3;
  if (timer() > botPlanAt[0]) {
    botPlanAt[0] = timer() + every;
    planKiller();
  }
  let speed = KILL_SPD - 0.25;
  if (agSt[0] === 2) speed = 2.5;
  if (timer() < slowEnd[0]) speed = 0.8;
  if (agFx[0] === 1) speed = speed * 1.35;
  // power: used during chases
  if (agFx[0] > 0 && timer() > kPowerEnd) agFx[0] = 0;
  if (botMode[0] === 7 && timer() > kPowerReady && agFx[0] === 0) {
    agFx[0] = agSkin[0] + 1;
    kPowerEnd = timer() + (agSkin[0] === 1 ? 6 : 4);
    kPowerReady = timer() + 35;
  }
  if (agFx[0] === 3) {
    // Crow Sight: the bot knows where everyone is
    kSeenAt = timer();
  }
  // chase: straight at the target when we can see it
  const t2 = botTgt[0];
  if ((botMode[0] === 7 || botMode[0] === 8) && t2 > 0 && agSt[t2] <= 2) {
    const d = dist2(agX[0], agY[0], agX[t2], agY[t2]);
    const l = los(agX[0], agY[0], agX[t2], agY[t2]);
    if (l && d < 5) {
      const tx = agX[t2];
      const ty = agY[t2];
      agA[0] = angTo(agX[0], agY[0], tx, ty);
      if (botMode[0] === 8 && d < 1.2) {
        applyEvent(0, 200 + t2);
        botPlanAt[0] = 0;
        return;
      }
      if (botMode[0] === 7 && d < 1.25 && kSwingAt === 0 && timer() > slowEnd[0]) {
        kSwingAt = timer();
        kSwingHit = false;
        agAnim[0] = 3;
      }
      if (d > 0.7) {
        moveBox(agX[0], agY[0], cos(agA[0]) * speed * dt, sin(agA[0]) * speed * dt, 0);
        agX[0] = mvX;
        agY[0] = mvY;
        if (agAnim[0] === 0) agAnim[0] = 1;
      }
      kSeenX = tx;
      kSeenY = ty;
      kSeenAt = timer();
      return;
    }
  }
  const done = followPath(0, speed, dt, 0);
  if (!done) return;
  if (botMode[0] === 9 && agSt[0] === 2) {
    applyEvent(0, 300 + botTgt[0]);
    botPlanAt[0] = 0;
    kPatrolGen = -1;
    kIgnoreUntil = timer() + 12;
    kSeenAt = -99;
  } else if (botMode[0] === 10 && kPatrolGen >= 0) {
    // at a generator: kick it if it has progress
    const g = kPatrolGen;
    if (genP[g] > 10 && genP[g] < 100 && genReg[g] === 0) {
      agAnim[0] = 5;
      agA[0] = angTo(agX[0], agY[0], ((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5));
      if (kKickUntil === 0) kKickUntil = timer() + (agSkin[0] === 0 ? 0.9 : 1.8);
      if (timer() > kKickUntil) {
        kKickUntil = 0;
        applyEvent(0, 500 + g);
        kPatrolGen = -1;
        botPlanAt[0] = 0;
      }
    } else {
      kPatrolGen = -1;
      botPlanAt[0] = 0;
    }
  } else {
    botPlanAt[0] = Math.min(botPlanAt[0], timer() + 0.2);
  }
}

/** Which survivor would a swing from (x, y) at angle a hit? (0 = none) */
/** @warp */
function attackTarget(x: number, y: number, a: number): number {
  let best = 0;
  let bd = 99;
  for (let t = 1; t < NA; t++) {
    if (agSt[t] <= 1) {
      let tx = agX[t];
      let ty = agY[t];
      if (agSlot[t] > 0 && agSlot[t] !== mySlot()) {
        tx = rX[t];
        ty = rY[t];
      }
      const d = dist2(x, y, tx, ty);
      if (d < 1.45 && d < bd) {
        const f = facingFrom(x, y, a, tx, ty, 1.45, 0.72);
        if (f) {
          const l = los(x, y, tx, ty);
          if (l) {
            bd = d;
            best = t;
          }
        }
      }
    }
  }
  return best;
}

/** Host: run every bot. */
/** @warp */
function hostBots(dt: number) {
  for (let a = 0; a < NA; a++) {
    if (agSlot[a] === 0) {
      if (a === 0) botKiller(dt);
      else botSurvivor(a, dt);
    }
  }
}

// ================================================================== local player

/** @warp */
function sendEvent(code: number) {
  if (isHost) applyEvent(myAgent, code);
  else evQ.push(code);
}

/** @warp */
function playAt(snd: string, x: number, y: number, vol: number) {
  let d = dist2(camX, camY, x, y);
  if (mapId === 1 && floorOf(y) !== camFloor) d = d + 8;
  me.volume = Math.max(0, vol - d * 7);
  if (me.volume > 2) playSound(snd as SoundName);
}

/** Start a skill check. */
/** @warp */
function startSkill() {
  scOn = true;
  scStart = timer() + 0.6; // the warning ding comes first
  scZone = random(110, 280);
  scWidth = 46;
  if (mySkin === 1 && myRole === 1) scWidth = 58;
  me.volume = 70;
  playSound("scwarn");
}

/** @warp */
function skillResult(kind: number) {
  // kind: 0 miss, 1 good, 2 great
  scOn = false;
  scResultUntil = timer() + 0.8;
  scNextAt = timer() + 2.5 + Math.random() * 3;
  me.volume = 80;
  if (kind === 2) {
    scResultC = C_SC_GREAT;
    playSound("scgreat");
    if (myDo === 1) sendEvent(640 + myDoT);
  } else if (kind === 1) {
    scResultC = C_SC_GOOD;
    playSound("scgood");
  } else {
    scResultC = C_SC_MISS;
    playSound("scfail");
    pausedUntil = timer() + 1.2;
    hurtAt = timer();
    if (myDo === 1) sendEvent(630 + myDoT);
    else if (myDo === 2) sendEvent(660 + myDoT);
    else sendEvent(660 + myAgent);
  }
}

/** @warp */
function updateSkill(spaceEdge: boolean) {
  if (!scOn) return;
  const t = timer() - scStart;
  if (t < 0) return;
  const ang = (t / 1.15) * 360;
  if (spaceEdge) {
    const off = ang - scZone;
    if (off >= 0 && off < 12) skillResult(2);
    else if (off >= 0 && off < scWidth) skillResult(1);
    else skillResult(0);
    return;
  }
  if (ang > scZone + scWidth + 10) skillResult(0);
}

/** Keyboard and touch input for this frame (sets kFwd, kStr, kTurn, kSpace, kE, kQ, kF, kA, kD). */
/** @warp */
function readInput() {
  kFwd = 0;
  if (keyPressed("w") || keyPressed("up arrow")) kFwd++;
  if (keyPressed("s") || keyPressed("down arrow")) kFwd--;
  kStr = 0;
  if (keyPressed("d")) kStr++;
  if (keyPressed("a")) kStr--;
  kTurn = 0;
  if (keyPressed("right arrow")) kTurn++;
  if (keyPressed("left arrow")) kTurn--;
  kSpace = keyPressed("space");
  kE = keyPressed("e");
  kQ = keyPressed("q");
  kF = keyPressed("f");
  kA = keyPressed("a") || keyPressed("left arrow");
  kD = keyPressed("d") || keyPressed("right arrow");
  if (kFwd !== 0 || kStr !== 0 || kTurn !== 0 || kE) game.touch = false; // a keyboard player: hide the touch buttons
  tBtn = 0;
  joyX = 0;
  joyY = 0;
  if (!game.touch || !mouseDown()) {
    prevTBtn = 0;
    return;
  }
  // one pointer (Scratch tracks a single touch): joystick, a button, or drag on the screen to look around
  const x = mouseX();
  const y = mouseY();
  tBtn = 99;
  if ((x - JX) * (x - JX) + (y - JY) * (y - JY) < 75 * 75) tBtn = 1;
  else if ((x - 190) * (x - 190) + (y + 100) * (y + 100) < 40 * 40) tBtn = 2;
  else if (Math.abs(x - 110) < 35 && Math.abs(y + 142) < 22) tBtn = 3;
  else if (showHeal && Math.abs(x - 110) < 35 && Math.abs(y + 88) < 19) tBtn = 4;
  else if (Math.abs(x - 214) < 22 && Math.abs(y - 150) < 22) tBtn = 5;
  else if (!offline && Math.abs(x - 214) < 30 && Math.abs(y - 100) < 16) tBtn = 6;
  else if (chatOpen && Math.abs(x) < 85 && y < 95 && y > -85) tBtn = 20 + Math.floor((95 - y) / 30);
  if (tBtn === 1) {
    joyX = Math.max(-45, Math.min(45, x - JX));
    joyY = Math.max(-45, Math.min(45, y - JY));
    if (Math.abs(joyY) > 8) kFwd = joyY / 40;
    if (Math.abs(joyX) > 8) kTurn = joyX / 40;
  }
  if (tBtn === 2) kSpace = true;
  if (tBtn === 3) kE = true;
  if (tBtn === 4) kF = true;
  if (tBtn === 5) kQ = true;
  if (tBtn === 99) kTurn = Math.max(-1, Math.min(1, x / 140));
  const edge = tBtn !== prevTBtn;
  if (edge && tBtn === 6) chatOpen = !chatOpen;
  if (edge && tBtn >= 20 && tBtn < 26) {
    game.chatSend = tBtn - 19;
    chatOpen = false;
  }
  prevTBtn = tBtn;
}

/** On-screen touch controls. */
/** @warp */
function drawTouch() {
  if (!game.touch || hPhase !== 1 || myAgent < 0) return;
  clearEffects();
  me.size = 100;
  stampAt(C_TC_BASE, JX, JY);
  stampAt(C_TC_KNOB, JX + joyX, JY + joyY);
  stampAt(C_TC_ACT, 190, -100);
  stampAt(C_TC_USE, 110, -142);
  if (showHeal) stampAt(C_TC_HEAL, 110, -88);
  if (!offline) stampAt(C_TC_CHAT, 214, 100);
  if (chatOpen) {
    for (let i = 0; i < 6; i++) stampAt(C_TC_PH0 + i, 0, 80 - i * 30);
  }
}

/** Movement for the local player: speed per role and state, sliding collision, stairs. */
/** @warp */
function moveLocal(dt: number, spd0: number, k: number) {
  let speed = spd0;
  pa += Math.max(-1, Math.min(1, kTurn)) * 160 * dt;
  let fwd = Math.max(-1, Math.min(1, kFwd));
  let str = kStr;
  moving = fwd !== 0 || str !== 0;
  if (timer() < dashUntil) {
    fwd = 1;
    str = 0;
    moving = true;
    speed = 7;
  }
  if (!moving || speed <= 0) return;
  const ca = cos(pa);
  const sa = sin(pa);
  let mx = ca * fwd - sa * str;
  let my = sa * fwd + ca * str;
  const ml = Math.sqrt(mx * mx + my * my);
  const mag = Math.min(1, ml); // half a joystick push = half speed
  mx = (mx / ml) * speed * mag * dt;
  my = (my / ml) * speed * mag * dt;
  moveBox(px, py, mx, my, k);
  px = mvX;
  py = mvY;
  const st = stairsAt(px, py);
  if (st) {
    px = mvX;
    py = mvY;
    pa = mvA;
    me.volume = 60;
    playSound("step");
  }
  const before = Math.floor(stepPhase / 180);
  stepPhase += dt * speed * 210;
  if (Math.floor(stepPhase / 180) !== before) {
    me.volume = myRole === 2 ? 45 : 25;
    playSound("step");
  }
  bob = sin(stepPhase) * (speed > 1 ? 5 : 2);
}

/** @warp */
function showBanner(c: number) {
  bannerC = c;
  bannerUntil = timer() + 2.8;
}

/** Survivor controls (my agent is a survivor). */
/** @warp */
function survivorControls(dt: number, eHeld: boolean, spaceEdge: boolean, qEdge: boolean) {
  const a = myAgent;
  const st = agSt[a];
  myDo = 0;
  myAnim = 0;
  promptC = 0;
  barFrac = -1;
  if (st === 3) {
    // carried: wiggle by alternating A and D
    promptC = C_PR_WIGGLE;
    barFrac = agProg[a] / 100;
    barCol = "#9CFF7A";
    let k = 0;
    if (kA) k = 1;
    if (kD) k = 2;
    if (spaceEdge) k = 3 - Math.max(1, lastWig); // touch: tap ACT over and over
    if (k > 0 && k !== lastWig) {
      lastWig = k;
      wigAt = timer();
      me.volume = 50;
      playSound("wiggle");
    }
    if (timer() - wigAt < 0.4) myDo = 5;
    myAnim = 2;
    scOn = false;
    return;
  }
  if (st === 4) {
    if (agStage[a] === 1 && hookTries < 3) {
      promptC = C_PR_ESCAPE;
      if (spaceEdge) {
        hookTries++;
        sendEvent(650);
      }
    }
    barFrac = agProg[a] / 100;
    barCol = "#E85A4A";
    scOn = false;
    return;
  }
  if (vaulting) {
    const f = Math.min(1, 1 - (vaultEnd - timer()) / vaultDur);
    px = vfx + (vtx - vfx) * f;
    py = vfy + (vty - vfy) * f;
    bob = sin(f * 180) * 18;
    myAnim = 4;
    if (f >= 1) vaulting = false;
    return;
  }
  // perks with Q
  if (qEdge && timer() > qReadyAt && st <= 1) {
    if (mySkin === 0) {
      qActiveUntil = timer() + 3;
      qReadyAt = timer() + 40;
      me.volume = 60;
      playSound("dash");
    } else if (mySkin === 7 && st === 1) {
      dashUntil = timer() + 0.22;
      qReadyAt = timer() + 50;
      sendEvent(670);
      me.volume = 70;
      playSound("dash");
    }
  }
  let speed = SURV_SPD;
  if (timer() < boostUntil) speed = SURV_SPD * 1.45;
  if (timer() < qActiveUntil) speed = SURV_SPD * 1.6;
  if (st === 2) speed = 0.55;
  // interactions (only while standing still and holding E)
  const busy = timer() < pausedUntil;
  let did = false;
  if (st <= 1) {
    // unhook / heal teammates
    for (let t = 1; t < NA; t++) {
      if (t !== a && !did) {
        const ts = agSt[t];
        if (ts === 4 || ts === 1 || ts === 2) {
          const d = dist2(px, py, rX[t], rY[t]);
          if (d < 1.4) {
            did = true;
            if (ts === 4) {
              promptC = C_PR_UNHOOK;
              if (eHeld) {
                myDo = 3;
                myDoT = t;
              }
            } else {
              promptC = C_PR_HEAL;
              barFrac = agProg[t] / 100;
              barCol = "#7CC444";
              if (eHeld && !busy) {
                myDo = 2;
                myDoT = t;
              }
            }
          }
        }
      }
    }
    // generators
    if (!did) {
      for (let g = 0; g < genC.length; g++) {
        if (!did && genP[g] < 100 && !powered) {
          const f = facingFrom(px, py, pa, ((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), 1.55, 0.35);
          if (f) {
            did = true;
            promptC = C_PR_REPAIR;
            barFrac = genP[g] / 100;
            barCol = "#F2D16A";
            if (eHeld && !busy) {
              myDo = 1;
              myDoT = g;
            }
          }
        }
      }
    }
    // exit gates
    if (!did) {
      for (let i = 0; i < 2; i++) {
        if (!did && gateP[i] < 100) {
          const f2 = facingFrom(px, py, pa, ((gateC[i]) % MW + 0.5), (Math.floor((gateC[i]) / MW) + 0.5), 1.7, 0.3);
          if (f2) {
            did = true;
            promptC = powered ? C_PR_GATE : C_PR_GATE_OFF;
            if (powered) {
              barFrac = gateP[i] / 100;
              barCol = "#9CFF7A";
              if (eHeld) {
                myDo = 4;
                myDoT = i;
              }
            }
          }
        }
      }
    }
    // pallets: drop a standing one / vault a dropped one
    if (!did) {
      for (let p = 0; p < palC.length; p++) {
        if (!did) {
          const ox = ((palC[p]) % MW + 0.5);
          const oy = (Math.floor((palC[p]) / MW) + 0.5);
          const d2 = dist2(px, py, ox, oy);
          if (palSt[p] === 0 && d2 < 1.15) {
            did = true;
            promptC = C_PR_DROP;
            if (spaceEdge) {
              sendEvent(610 + p);
              palSt[p] = 1; // show it now; the host confirms
              me.volume = 100;
              playSound("pallet");
              const inside = Math.floor(px) + Math.floor(py) * MW === palC[p];
              if (inside) {
                // step off it, away from the killer
                if (palAx[p] === 0) px = ox + (rX[0] > ox ? -0.85 : 0.85);
                else py = oy + (rY[0] > oy ? -0.85 : 0.85);
              }
            }
          } else if (palSt[p] === 1 && d2 < 1.45) {
            const f3 = facingFrom(px, py, pa, ox, oy, 1.45, 0.3);
            if (f3) {
              did = true;
              promptC = C_PR_VAULT;
              if (spaceEdge) {
                vaulting = true;
                vaultDur = mySkin === 4 ? 0.35 : 0.55;
                vaultEnd = timer() + vaultDur;
                vfx = px;
                vfy = py;
                vtx = ox;
                vty = oy;
                if (palAx[p] === 0) vtx = ox + (px < ox ? 0.9 : -0.9);
                else vty = oy + (py < oy ? 0.9 : -0.9);
                me.volume = 80;
                playSound("vault");
              }
            }
          }
        }
      }
    }
    // Self-Care
    showHeal = st === 1 && mySkin === 3;
    if (!did && st === 1 && mySkin === 3) {
      promptC = C_PR_SELFCARE;
      barFrac = agProg[a] / 100;
      barCol = "#7CC444";
      if (kF && !busy) {
        myDo = 6;
        myDoT = a;
      }
    }
  } else if (st === 2) {
    promptC = C_PR_CRAWL;
    barFrac = agProg[a] / 100;
    barCol = "#7CC444";
  }
  if (myDo > 0) {
    myAnim = 2;
    // skill checks while repairing / healing
    if ((myDo === 1 || myDo === 2 || myDo === 6) && !scOn && timer() > scNextAt) {
      scNextAt = timer() + 1;
      if (random(1, 100) <= 14) startSkill();
    }
  } else {
    if (scOn && timer() > scStart) skillResult(0);
    scOn = false;
    moveLocal(dt, speed, 1);
    if (moving) myAnim = 1;
  }
  updateSkill(spaceEdge && myDo > 0);
}

/** Killer controls. */
/** @warp */
function killerControls(dt: number, eHeld: boolean, attackEdge: boolean, qEdge: boolean) {
  const st = agSt[0];
  myDo = 0;
  myAnim = 0;
  promptC = 0;
  barFrac = -1;
  if (st === 1) {
    holdT = 0;
    return; // stunned
  }
  const carrying = st === 2;
  // power
  if (qEdge && timer() > qReadyAt) {
    if (myKSkin === 0) {
      qActiveUntil = timer() + 4;
      qReadyAt = timer() + 30;
      me.volume = 90;
      playSound("rampage");
    } else if (myKSkin === 1) {
      qActiveUntil = timer() + 8;
      qReadyAt = timer() + 35;
      me.volume = 80;
      playSound("vanish");
    } else {
      qActiveUntil = timer() + 5;
      qReadyAt = timer() + 40;
      me.volume = 90;
      playSound("crows");
    }
  }
  let speed = KILL_SPD;
  if (carrying) speed = 2.6;
  if (timer() < qActiveUntil && myKSkin === 0) speed = speed * 1.35;
  if (timer() < slowUntil) speed = 1.0;
  // attack
  if (attackEdge && !carrying && timer() > attackCool) {
    attackAt = timer();
    attackChecked = false;
    attackCool = timer() + 0.55;
    game.swingAt = timer();
    me.volume = 80;
    playSound("swing");
    if (myKSkin === 1) qActiveUntil = 0; // attacking ends Vanish
  }
  if (!attackChecked && timer() - attackAt > 0.15) {
    attackChecked = true;
    const t = attackTarget(px, py, pa);
    if (t > 0) {
      sendEvent(100 + t);
      slowUntil = timer() + 2.4;
      attackCool = timer() + 2.4;
      me.volume = 100;
      playSound("hit");
    } else {
      slowUntil = timer() + 0.8;
    }
  }
  if (timer() - attackAt < 0.4) myAnim = 3;
  let did = false;
  if (carrying) {
    for (let h = 0; h < hookC.length; h++) {
      if (!did) {
        const hd = dist2(px, py, ((hookC[h]) % MW + 0.5), (Math.floor((hookC[h]) / MW) + 0.5));
        if (hd < 1.5) {
          did = true;
          promptC = C_PR_HOOK;
          if (eHeld && !prevE) sendEvent(300 + h);
        }
      }
    }
  } else {
    for (let t2 = 1; t2 < NA; t2++) {
      if (!did && agSt[t2] === 2) {
        const f = facingFrom(px, py, pa, rX[t2], rY[t2], 1.4, 0.2);
        if (f) {
          did = true;
          promptC = C_PR_PICKUP;
          if (eHeld && !prevE) sendEvent(200 + t2);
        }
      }
    }
  }
  if (!did && !carrying) {
    for (let p = 0; p < palC.length; p++) {
      if (!did && palSt[p] === 1) {
        const f2 = facingFrom(px, py, pa, ((palC[p]) % MW + 0.5), (Math.floor((palC[p]) / MW) + 0.5), 1.5, 0.4);
        if (f2) {
          did = true;
          promptC = C_PR_BREAK;
          if (eHeld) {
            if (holdKind !== 1 || holdIdx !== p) holdT = 0;
            holdKind = 1;
            holdIdx = p;
            holdT += dt;
            const need = myKSkin === 0 ? 1.2 : 2.4;
            barFrac = holdT / need;
            barCol = "#E85A4A";
            myDo = 1;
            if (holdT >= need) {
              holdT = 0;
              sendEvent(400 + p);
              palSt[p] = 2;
              me.volume = 100;
              playSound("pbreak");
            }
          }
        }
      }
    }
  }
  if (!did && !carrying) {
    for (let g = 0; g < genC.length; g++) {
      if (!did && genP[g] > 0 && genP[g] < 100 && !powered) {
        const f3 = facingFrom(px, py, pa, ((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), 1.55, 0.35);
        if (f3) {
          did = true;
          promptC = C_PR_KICK;
          barFrac = genP[g] / 100;
          barCol = "#F2D16A";
          if (eHeld) {
            if (holdKind !== 2 || holdIdx !== g) holdT = 0;
            holdKind = 2;
            holdIdx = g;
            holdT += dt;
            const need2 = myKSkin === 0 ? 0.9 : 1.8;
            barFrac = holdT / need2;
            barCol = "#E85A4A";
            myDo = 1;
            if (holdT >= need2) {
              holdT = 0;
              sendEvent(500 + g);
              me.volume = 100;
              playSound("pbreak");
            }
          }
        }
      }
    }
  }
  if (!eHeld) holdT = 0;
  if (promptC === 0 && !carrying && timer() - matchAt < 20) promptC = C_PR_ATTACK;
  if (myDo === 0) {
    moveLocal(dt, speed, 0);
    if (moving && myAnim === 0) myAnim = 1;
  } else myAnim = 5;
}

/** Every frame for the local player: pick up state changes from the host and run the controls. */
/** @warp */
function updateLocal(dt: number) {
  const ms = mySlot();
  myAgent = agentOfSlot(ms);
  if (myAgent !== prevMyAgent) {
    // just got a body (match start or taking over a bot): start where it is
    prevMyAgent = myAgent;
    if (myAgent >= 0) {
      px = agX[myAgent];
      py = agY[myAgent];
      pa = agA[myAgent];
      prevLocked = true;
      qReadyAt = timer() + 10;
      hookTries = 0;
      scOn = false;
      vaulting = false;
      myRole = myAgent === 0 ? 2 : 1;
    }
  }
  game.weapon = -1;
  game.carrying = false;
  const space = kSpace;
  const spaceEdge = space && !prevSpace;
  prevSpace = space;
  const click = mouseDown() && !game.touch;
  const clickEdge = click && !prevClick;
  prevClick = click;
  const eHeld = kE;
  const q = kQ;
  const qEdge = q && !prevQ;
  prevQ = q;
  bob = bob * 0.8;
  if (myAgent < 0 || hPhase !== 1) {
    prevE = eHeld;
    myDo = 0;
    return;
  }
  const st = agSt[myAgent];
  let locked = st >= 3;
  if (myAgent === 0) locked = false;
  if (locked) {
    px = agX[myAgent];
    py = agY[myAgent];
  } else if (prevLocked) {
    // freed from the hook / the killer's shoulder: carry on from the host's spot
    px = agX[myAgent];
    py = agY[myAgent];
    unstickAt(px, py, 1, px, py);
    px = mvX;
    py = mvY;
  }
  prevLocked = locked;
  if (myAgent === 0) {
    killerControls(dt, eHeld, spaceEdge || clickEdge, qEdge);
    game.weapon = myKSkin;
    game.carrying = agSt[0] === 2;
    unstickAt(px, py, 0, px, py);
    px = mvX;
    py = mvY;
  } else {
    survivorControls(dt, eHeld, spaceEdge, qEdge);
    if (st <= 2 && !vaulting) {
      unstickAt(px, py, 1, px, py);
      px = mvX;
      py = mvY;
    }
  }
  prevE = eHeld;
  // host: my own agent mirrors me directly
  if (isHost) {
    agX[myAgent] = px;
    agY[myAgent] = py;
    agA[myAgent] = pa;
    if (st >= 3 && myAgent > 0) {
      agX[myAgent] = px;
      agY[myAgent] = py;
    }
    hAct[myAgent] = myDo;
    hActT[myAgent] = myDoT;
    agAnim[myAgent] = myAnim;
    if (myAgent === 0) setKillerFx();
  }
}

/** @warp */
function setKillerFx() {
  agFx[0] = 0;
  if (timer() < qActiveUntil) agFx[0] = myKSkin + 1;
}

// ================================================================== networking

const lastVal: string[] = [];
const lastChg: number[] = [];
let sendAt = -99;
let beat = 10;

/** @warp */
function netResetSlots() {
  lastVal.length = 0;
  lastChg.length = 0;
  for (let i = 1; i <= 6; i++) {
    const v = Net.slotValue(i);
    lastVal.push(v);
    lastChg.push(-99);
  }
  sendAt = -99;
}

/** @warp */
function num(v: string, i: number, n: number): number {
  let r = 0;
  for (let k = i; k < i + n; k++) r = r * 10 + Number(v[k]);
  return r;
}

/** My packet: position, angle, flags (1 in game, 2 hosting, 4 on results), role, skin, activity, anim, event. */
/** @warp */
function netWrite() {
  const slot = Net.session.slot;
  if (slot === 0) return;
  beat++;
  if (beat > 99) beat = 10;
  if (evQ.length > 0 && (curEv === 0 || timer() > sendAt + 0.25)) {
    curEv = evQ[0];
    evQ.remove(0);
    evSeq = (evSeq + 1) % 10;
    sendAt = timer();
  }
  let flags = 0;
  if (mode === 5) flags += 1;
  if (isHost && timer() > joinedAt + 4) flags += 2;
  if (onResults) flags += 4;
  let skin = mySkin;
  if (myRole === 2) skin = myKSkin;
  if (myAgent === 0 && timer() < qActiveUntil) skin = myKSkin + 3; // the killer's power is on
  const ang = Math.round((((pa % 360) + 360) % 360) / 5) % 72;
  let s = "1" + beat;
  const sx = Net.pad(Math.round(Math.max(0, Math.min(99.99, px)) * 100), 4);
  s = s + sx;
  const sy = Net.pad(Math.round(Math.max(0, Math.min(99.99, py)) * 100), 4);
  s = s + sy;
  const sa = Net.pad(ang, 2);
  s = s + sa + flags + myRole + skin + myDo + Math.min(9, myDoT) + myAnim;
  const se = Net.pad(curEv, 3);
  s = s + se + evSeq + (myAgent + 1);
  const v = s as unknown as number;
  if (slot === 1) Net.cloud.p1 = v;
  if (slot === 2) Net.cloud.p2 = v;
  if (slot === 3) Net.cloud.p3 = v;
  if (slot === 4) Net.cloud.p4 = v;
  if (slot === 5) Net.cloud.p5 = v;
  if (slot === 6) Net.cloud.p6 = v;
}

/** Read every other player's packet; pick the host; the host applies their events. */
/** @warp */
function netRead() {
  if (offline) {
    isHost = true;
    return;
  }
  const mine = Net.session.slot;
  let hostSlot = mine;
  let advSlot = 99;
  for (let i = 1; i <= 6; i++) {
    const r = i - 1;
    slAct[r] = 0;
    if (i !== mine && timer() > joinedAt + 3) {
      const v = Net.slotValue(i);
      if (v !== lastVal[r]) {
        lastVal[r] = v;
        lastChg[r] = timer();
      }
      const age = timer() - lastChg[r];
      if (v.length >= 24 && age >= 0 && age < 3) {
        slAct[r] = 1;
        slX[r] = num(v, 3, 4) / 100;
        slY[r] = num(v, 7, 4) / 100;
        slA[r] = num(v, 11, 2) * 5;
        slFlags[r] = Number(v[13]);
        slRole[r] = Number(v[14]);
        slSkin[r] = Number(v[15]);
        slDo[r] = Number(v[16]);
        slDoT[r] = Number(v[17]);
        slAnim[r] = Number(v[18]);
        slEv[r] = num(v, 19, 3);
        const sq = Number(v[22]);
        slAck[r] = Number(v[23]);
        if (i < hostSlot) hostSlot = i;
        if (Math.floor(slFlags[r] / 2) % 2 === 1 && i < advSlot) advSlot = i;
        if (sq !== slLastSeq[r]) {
          slLastSeq[r] = sq;
          if (isHost && slEv[r] > 0) {
            const ag = agentOfSlot(i);
            if (ag >= 0) applyEvent(ag, slEv[r]);
          }
        }
      }
    }
  }
  const settled = timer() > joinedAt + 4;
  if (advSlot < 99) isHost = isHost && settled && mine < advSlot;
  else isHost = settled && (isHost || hostSlot === mine);
}

/** Host: copy humans' positions and activities into their agents. */
/** @warp */
function hostTakeHumans() {
  if (offline) return;
  for (let a = 0; a < NA; a++) {
    const s = agSlot[a];
    if (s > 0 && s !== Net.session.slot) {
      const r = s - 1;
      const locked = a > 0 && agSt[a] >= 3;
      if (!locked && slAck[r] === a + 1) {
        agX[a] = slX[r];
        agY[a] = slY[r];
      }
      agA[a] = slA[r];
      hAct[a] = slDo[r];
      hActT[a] = slDoT[r];
      agAnim[a] = slAnim[r];
      if (a === 0) {
        agFx[0] = 0;
        if (slSkin[r] >= 3) agFx[0] = slSkin[r] - 2;
      }
    }
  }
}

/** Host -> everyone: the world packet. */
/** @warp */
function netWriteWorld() {
  hSeq++;
  if (hSeq > 99) hSeq = 10;
  let s = "1" + hSeq + hPhase + mapId + hGame;
  const cs = Net.pad(Math.min(99, Math.ceil(collapseT)), 2);
  s = s + cs;
  for (let g = 0; g < 7; g++) {
    let v = 0;
    if (g < genP.length) v = Math.min(99, Math.floor(genP[g]));
    if (g < genP.length && genP[g] >= 100) v = 99;
    const sg = Net.pad(v, 2);
    s = s + sg;
  }
  for (let i = 0; i < 2; i++) {
    let gv = Math.min(98, Math.floor(gateP[i]));
    if (gateP[i] >= 100) gv = 99;
    const sgate = Net.pad(gv, 2);
    s = s + sgate;
  }
  for (let p = 0; p < 12; p++) {
    if (p < palSt.length) s = s + palSt[p];
    else s = s + "0";
  }
  const nc = Net.pad(noiseCell, 4);
  s = s + noiseSeq + nc;
  for (let a = 0; a < NA; a++) {
    const ax = Net.pad(Math.round(Math.max(0, agX[a]) * 40), 4);
    const ay = Net.pad(Math.round(Math.max(0, agY[a]) * 40), 4);
    const aa = Net.pad(Math.round((((agA[a] % 360) + 360) % 360) / 5) % 72, 2);
    const ap = Net.pad(Math.max(0, Math.min(99, Math.floor(agProg[a]))), 2);
    let sk = agSkin[a];
    if (sk < 0) sk = 0;
    s = s + agSlot[a] + sk + ax + ay + aa + agSt[a] + Math.min(9, agStage[a]) + ap + agAnim[a] + agFx[a];
  }
  const tl = Net.pad(Math.max(0, Math.min(999, Math.ceil(hTime))), 3);
  s = s + tl + timeUp;
  wcloud.w = s as unknown as number;
}

/** Client: unpack the host's world packet when it changes. */
/** @warp */
function readWorld() {
  const v = String(wcloud.w);
  if (v.length < 137) return;
  const sq = num(v, 1, 2);
  if (sq === lastWSeq) return;
  lastWSeq = sq;
  hPhase = Number(v[3]);
  const m = Number(v[4]);
  const gm = Number(v[5]);
  if (gm !== hGame || mapId !== m || genC.length === 0) {
    hGame = gm;
    loadMap(m);
  }
  collapseT = num(v, 6, 2);
  for (let g = 0; g < genC.length; g++) {
    let gp = num(v, 8 + g * 2, 2);
    if (gp === 99) gp = 100;
    genP[g] = gp;
  }
  for (let i = 0; i < 2; i++) {
    let gt = num(v, 22 + i * 2, 2);
    if (gt === 99) gt = 100;
    gateP[i] = gt;
  }
  for (let p = 0; p < palC.length; p++) palSt[p] = Number(v[26 + p]);
  const ns = Number(v[38]);
  noiseCell = num(v, 39, 4);
  if (ns !== noiseSeq) {
    noiseSeq = ns;
  }
  for (let a = 0; a < NA; a++) {
    const o = 43 + a * 18;
    agSlot[a] = Number(v[o]);
    agSkin[a] = Number(v[o + 1]);
    agX[a] = num(v, o + 2, 4) / 40;
    agY[a] = num(v, o + 6, 4) / 40;
    agA[a] = num(v, o + 10, 2) * 5;
    agSt[a] = Number(v[o + 12]);
    agStage[a] = Number(v[o + 13]);
    agProg[a] = num(v, o + 14, 2);
    agAnim[a] = Number(v[o + 16]);
    agFx[a] = Number(v[o + 17]);
  }
  hTime = num(v, 133, 3);
  timeUp = Number(v[136]);
}

/** @warp */
function netSend() {
  if (offline || Net.session.slot === 0 || timer() < nextTick) return;
  nextTick = timer() + 0.105;
  tick++;
  if (isHost && tick % 2 === 1 && hPhase > 0) netWriteWorld();
  else {
    netWrite();
  }
}

// ================================================================== events every client notices (sounds, banners)

/** @warp */
function noticeChanges() {
  for (let a = 0; a < NA; a++) {
    const st = agSt[a];
    const was = prevSt[a];
    if (st !== was) {
      const x = rX[a];
      const y = rY[a];
      if (a === 0) {
        if (st === 1) {
          playAt("stun", x, y, 100);
          if (myAgent === 0) showBanner(C_BN_STUNNED);
        }
      } else {
        if (st === 1 && was === 0) {
          playAt("hit", x, y, 100);
          playAt("yelp", x, y, 90);
          if (a === myAgent) {
            boostUntil = timer() + 1.8;
            hurtAt = timer();
            showBanner(C_BN_INJURED);
          }
        }
        if (st === 2 && was <= 1) {
          playAt("hit", x, y, 100);
          playAt("scream", x, y, 100);
          if (a === myAgent) hurtAt = timer();
        }
        if (st === 3) playAt("yelp", x, y, 90);
        if (st === 4) {
          playAt("hook", x, y, 100);
          if (a === myAgent) {
            showBanner(C_BN_HOOKED);
            hookTries = 0;
          }
        }
        if ((st === 1 || st === 0) && was === 4) {
          playAt("unhook", x, y, 90);
          if (a === myAgent) showBanner(C_BN_FREED);
        }
        if (st === 1 && was === 3 && a === myAgent) showBanner(C_BN_WIGGLED);
        if (st < was && st <= 1 && was <= 2) playAt("heal", x, y, 70);
        if (st === 5) {
          if (a === myAgent) csQ.push(2);
          else playAt("sacrifice", x, y, 100);
        }
        if (st === 6 && a === myAgent) csQ.push(1);
      }
      prevSt[a] = st;
    }
    if (a === 0 && agAnim[0] === 3 && prevAnim[0] !== 3 && myAgent !== 0) playAt("swing", rX[0], rY[0], 90);
    if (agAnim[a] === 4 && prevAnim[a] !== 4 && a !== myAgent) playAt("vault", rX[a], rY[a], 80);
    prevAnim[a] = agAnim[a];
  }
  if (agFx[0] !== prevFx) {
    if (agFx[0] === 1) playAt("rampage", rX[0], rY[0], 110);
    if (agFx[0] === 2) playAt("vanish", rX[0], rY[0], 90);
    if (agFx[0] === 3) {
      me.volume = 70;
      playSound("crows");
    }
    prevFx = agFx[0];
  }
  for (let p = 0; p < palC.length; p++) {
    if (palSt[p] !== prevPal[p]) {
      if (palSt[p] === 1 && prevPal[p] === 0) playAt("pallet", ((palC[p]) % MW + 0.5), (Math.floor((palC[p]) / MW) + 0.5), 100);
      if (palSt[p] === 2) {
        playAt("pbreak", ((palC[p]) % MW + 0.5), (Math.floor((palC[p]) / MW) + 0.5), 100);
        addFxAt(((palC[p]) % MW + 0.5), (Math.floor((palC[p]) / MW) + 0.5), C_FX_DUST);
      }
      prevPal[p] = palSt[p];
    }
  }
  for (let g = 0; g < genC.length; g++) {
    if (genP[g] !== prevGenP[g]) {
      genFx[g] = timer();
      if (genP[g] >= 100 && prevGenP[g] < 100) {
        playAt("gendone", ((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), 160);
        addFxAt(((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), C_FX_SPARK);
      }
      prevGenP[g] = genP[g];
    }
  }
  if (gensDone !== lastGensDone) {
    if (gensDone > lastGensDone && gensDone < 5) showBanner(C_BN_GEN);
    lastGensDone = gensDone;
  }
  if (powered && !lastPowered) {
    me.volume = 100;
    playSound("powered");
    showBanner(myRole === 2 ? C_BN_POWERED_K : C_BN_POWERED);
  }
  lastPowered = powered;
  const open = gateP[0] >= 100 || gateP[1] >= 100;
  if (open && !lastOpen) {
    me.volume = 100;
    playSound("gate");
    showBanner(C_BN_OPEN);
  }
  lastOpen = open;
  if (noiseSeq !== lastNoiseSeq) {
    lastNoiseSeq = noiseSeq;
    if (noiseCell > 0) {
      noiseUntil = timer() + 3.5;
      noiseX = ((noiseCell) % MW + 0.5);
      noiseY = (Math.floor((noiseCell) / MW) + 0.5);
    }
  }
}

// ================================================================== rendering

/** Wall texture slice (sets sCost, sSize, sBr). Textures: 1-3 house walls, 4-6 field walls, 7 gate, 8 daylight,
 * 9 stairs up, 10 stairs down, 11 dropped pallet. */
/** @warp */
function slice(tex: number, perp: number, side: number, rdx: number, rdy: number) {
  let wx = 0;
  if (side === 0) wx = camY + perp * rdy;
  else wx = camX + perp * rdx;
  wx = wx - Math.floor(wx);
  let tx = Math.floor(wx * 32);
  if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) tx = 31 - tx;
  const h = PROJ / Math.max(perp, 0.05);
  const q = h / CW;
  let ri = 4;
  if (q < 4) ri = 0;
  else if (q < 8) ri = 1;
  else if (q < 16) ri = 2;
  else if (q < 32) ri = 3;
  sCost = (tex - 1) * 160 + ri * 32 + tx + 1;
  sSize = h * 1.5625;
  sBr = -Math.min(92, perp * fogK + side * 12);
  if (tex === 8) sBr = 0;
}

/** @warp */
function texOf(t: number): number {
  if (t <= 3) {
    if (mapId === 1) return t;
    return t + 3;
  }
  return t + 3;
}

/** @warp */
function castWalls() {
  for (let i = 0; i < N; i++) {
    const cxm = (2 * (i + 0.5)) / N - 1;
    let rdx = dirX + plX * cxm;
    let rdy = dirY + plY * cxm;
    if (Math.abs(rdx) < 0.00001) rdx = 0.00001;
    if (Math.abs(rdy) < 0.00001) rdy = 0.00001;
    let mx = Math.floor(camX);
    let my = Math.floor(camY);
    const ddx = Math.abs(1 / rdx);
    const ddy = Math.abs(1 / rdy);
    let stx = 1;
    let sty = 1;
    let sdx = (mx + 1 - camX) * ddx;
    let sdy = (my + 1 - camY) * ddy;
    if (rdx < 0) {
      stx = -1;
      sdx = (camX - mx) * ddx;
    }
    if (rdy < 0) {
      sty = -1;
      sdy = (camY - my) * ddy;
    }
    let hit = 0;
    let side = 0;
    let t = 0;
    oDepth[i] = 999;
    while (hit === 0) {
      if (sdx < sdy) {
        sdx += ddx;
        mx += stx;
        side = 0;
      } else {
        sdy += ddy;
        my += sty;
        side = 1;
      }
      const c = mx + my * MW;
      t = map[c];
      if (t > 0 && t < 8) hit = 1;
      else if (palAt[c] > 0 && oDepth[i] > 900) {
        if (palSt[palAt[c] - 1] === 1) {
          let od = sdy - ddy;
          if (side === 0) od = sdx - ddx;
          slice(11, od, side, rdx, rdy);
          oDepth[i] = od;
          oCost[i] = sCost;
          oSize[i] = sSize;
          oBr[i] = sBr;
        }
      }
    }
    let perp = sdy - ddy;
    if (side === 0) perp = sdx - ddx;
    const tex = texOf(t);
    slice(tex, perp, side, rdx, rdy);
    cDepth[i] = perp;
    cCost[i] = sCost;
    cSize[i] = sSize;
    cBr[i] = sBr;
    switchCostume(sCost);
    me.size = sSize;
    setEffect("brightness", sBr);
    goTo(i * CW - 238, horizon);
    stamp();
  }
  for (let i = 0; i < N; i++) {
    if (oDepth[i] < 900) {
      switchCostume(oCost[i]);
      me.size = oSize[i];
      setEffect("brightness", oBr[i]);
      goTo(i * CW - 238, horizon);
      stamp();
    }
  }
}

/** Queue a billboard: hWorld world height, cpx costume height in px, lift above the floor, halfW half width / height. */
/** @warp */
function addObj(wx: number, wy: number, cost: number, hWorld: number, cpx: number, lift: number, halfW: number, ghost: number) {
  const dx = wx - camX;
  const dy = wy - camY;
  const depth = dx * dirX + dy * dirY;
  if (depth < 0.2 || depth > 22) return;
  const sx = ((dy * dirX - dx * dirY) / depth) * PROJ;
  const hs = (PROJ * hWorld) / depth;
  if (Math.abs(sx) > 240 + hs * halfW) return;
  let k = 0;
  while (k < bD.length && bD[k] > depth) k++;
  bD.insert(k, depth);
  bX.insert(k, sx);
  bY.insert(k, horizon + (PROJ * (lift - 0.5)) / depth + hs / 2);
  bS.insert(k, (hs / cpx) * 100);
  bC.insert(k, cost);
  bB.insert(k, -Math.min(88, depth * fogK));
  bG.insert(k, ghost);
  bW.insert(k, hs * halfW);
}

/** Queue an aura (drawn through walls). Things on the other floor of the house show at their spot with an arrow. */
/** @warp */
function addAura(wx: number, wy: number, cost: number, hWorld: number, cpx: number, lift: number, hue: number) {
  let y = wy;
  let arrow = 0;
  if (mapId === 1) {
    const f = floorOf(wy);
    if (f !== camFloor) {
      if (f === 1) {
        y = wy - 24;
        arrow = C_AURA_UP;
      } else {
        y = wy + 24;
        arrow = C_AURA_DOWN;
      }
    }
  }
  const dx = wx - camX;
  const dy = y - camY;
  const depth = dx * dirX + dy * dirY;
  if (depth < 0.3) return;
  if (arrow === 0 && dx * dx + dy * dy < 12) return; // close by: you can see it anyway
  const sx = ((dy * dirX - dx * dirY) / depth) * PROJ;
  if (Math.abs(sx) > 260) return;
  const hs = Math.max(26, (PROJ * hWorld) / depth);
  const sc = (hs / cpx) * 100;
  aX.push(sx);
  aY.push(horizon + (PROJ * (lift - 0.5)) / Math.max(depth, 1.5) + hs / 2);
  aS.push(sc);
  aC.push(cost);
  aH.push(hue);
  if (arrow > 0) {
    aX.push(sx);
    aY.push(horizon + (PROJ * (lift - 0.5)) / Math.max(depth, 1.5) + hs + 16);
    aS.push(70);
    aC.push(arrow);
    aH.push(-1);
  }
}

/** Survivor costume for agent a seen from the camera. */
/** @warp */
function survCost(a: number): number {
  const base = C_S0_FRONTA + agSkin[a] * 10;
  const toMe = angTo(rX[a], rY[a], camX, camY);
  const diff = (((rA[a] - toMe) % 360) + 360) % 360;
  let frame = 0;
  if (agAnim[a] === 1) frame = Math.floor(timer() * 5 + a) % 2;
  if (diff < 45 || diff > 315) return base + frame;
  if (diff > 135 && diff < 225) return base + 2 + frame;
  if (diff <= 135) return base + 6 + frame;
  return base + 4 + frame;
}

/** @warp */
function killerCost(): number {
  const base = C_K0_FRONTA + agSkin[0] * 10;
  if (agSt[0] === 1) return base + KC_STUN;
  if (agAnim[0] === 3) return base + KC_ATK;
  const toMe = angTo(rX[0], rY[0], camX, camY);
  const diff = (((rA[0] - toMe) % 360) + 360) % 360;
  let frame = 0;
  if (agAnim[0] === 1) frame = Math.floor(timer() * 5) % 2;
  if (diff < 45 || diff > 315) return base + frame;
  if (diff > 135 && diff < 225) return base + 2 + frame;
  if (diff <= 135) return base + 6 + frame;
  return base + 4 + frame;
}

/** @warp */
function addFxAt(x: number, y: number, k: number) {
  if (fxX.length > 10) {
    fxX.remove(0);
    fxY.remove(0);
    fxT.remove(0);
    fxK.remove(0);
  }
  fxX.push(x);
  fxY.push(y);
  fxT.push(timer());
  fxK.push(k);
}

/** @warp */
function collectObjects(viewer: number) {
  bD.length = 0;
  bX.length = 0;
  bY.length = 0;
  bS.length = 0;
  bC.length = 0;
  bB.length = 0;
  bG.length = 0;
  bW.length = 0;
  aX.length = 0;
  aY.length = 0;
  aS.length = 0;
  aC.length = 0;
  aH.length = 0;
  // props
  for (let d = 0; d < decC.length; d++) {
    const k = decK[d];
    const x = ((decC[d]) % MW + 0.5);
    const y = (Math.floor((decC[d]) / MW) + 0.5);
    if (k <= 2) addObj(x, y, C_TREE0 + k, 1.7, 240, 0, 0.33, 0);
    else if (k === 3) addObj(x, y, C_ROCK, 0.7, 160, 0, 0.42, 0);
    else if (k === 4) addObj(x, y, C_HAY, 0.65, 160, 0, 0.42, 0);
    else addObj(x, y, C_FURN0 + k - 5, 0.8, 160, 0, 0.38, 0);
  }
  for (let g = 0; g < genC.length; g++) {
    let gc = C_GEN0;
    if (genP[g] >= 100) gc = C_GEN0 + 3;
    else if (timer() - genFx[g] < 0.6) gc = C_GEN0 + 1 + (Math.floor(timer() * 8) % 2);
    addObj(((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), gc, 0.85, 160, 0, 0.42, 0);
  }
  for (let h = 0; h < hookC.length; h++) addObj(((hookC[h]) % MW + 0.5), (Math.floor((hookC[h]) / MW) + 0.5) - 0.01, C_HOOK, 1.25, 160, 0, 0.18, 0);
  for (let p = 0; p < palC.length; p++) {
    if (palSt[p] === 0) {
      let ox = ((palC[p]) % MW + 0.5);
      let oy = (Math.floor((palC[p]) / MW) + 0.5);
      if (palAx[p] === 1) ox = ox - 0.36;
      else oy = oy - 0.36;
      addObj(ox, oy, C_PALLET_UP, 0.95, 160, 0, 0.2, 0);
    }
  }
  // agents
  for (let a = 1; a < NA; a++) {
    const st = agSt[a];
    if (a !== viewer && st <= 4) {
      if (st === 2) addObj(rX[a], rY[a], C_S0_FRONTA + agSkin[a] * 10 + SC_DOWN, 0.95, 160, 0, 0.45, 0);
      else if (st === 3) {
        if (viewer !== 0) addObj(rX[0] - cos(rA[0]) * 0.05, rY[0] - sin(rA[0]) * 0.05, C_S0_FRONTA + agSkin[a] * 10 + SC_DOWN, 0.85, 160, 0.62, 0.45, 0);
      } else if (st === 4) {
        // hanging in front of the hook (seen from wherever the camera is)
        let hd = dist2(rX[a], rY[a], camX, camY);
        hd = Math.max(0.01, hd);
        addObj(rX[a] + ((camX - rX[a]) / hd) * 0.12, rY[a] + ((camY - rY[a]) / hd) * 0.12, C_S0_FRONTA + agSkin[a] * 10 + SC_HOOKED, 0.95, 160, 0.16, 0.2, 0);
      }
      else {
        const sc = survCost(a);
        addObj(rX[a], rY[a], sc, 0.95, 160, 0, 0.2, 0);
      }
    }
  }
  if (viewer !== 0) {
    let ghost = 0;
    if (agFx[0] === 2) ghost = 88; // Vanish
    const kc = killerCost();
    addObj(rX[0], rY[0], kc, 1.12, 160, 0, 0.24, ghost);
  }
  for (let f = fxX.length - 1; f >= 0; f--) {
    const age = timer() - fxT[f];
    if (age > 0.7) {
      fxX.remove(f);
      fxY.remove(f);
      fxT.remove(f);
      fxK.remove(f);
    } else addObj(fxX[f], fxY[f], fxK[f], 0.4 + age, 64, 0.2, 0.5, age * 140);
  }
  collectAuras(viewer);
}

/** Auras: what this viewer can see through walls. */
/** @warp */
function collectAuras(viewer: number) {
  if (hPhase !== 1) return;
  if (viewer === 0) {
    // killer: hooks while carrying, noise notifications, power reveals
    if (agSt[0] === 2) {
      for (let h = 0; h < hookC.length; h++) addAura(((hookC[h]) % MW + 0.5), (Math.floor((hookC[h]) / MW) + 0.5), C_HOOK, 1.25, 160, 0, 0);
    }
    if (timer() < noiseUntil) addAura(noiseX, noiseY, C_AURA_NOISE, 0.6, 64, 0.5, 30);
    for (let a = 1; a < NA; a++) {
      const st = agSt[a];
      if (st <= 2) {
        let show = myAgent === 0 && timer() < qActiveUntil && myKSkin === 2;
        if (myKSkin === 1 && agAnim[a] === 2) show = true; // Discordance
        if (st === 2 && dist2(camX, camY, rX[a], rY[a]) > 16) show = false;
        if (show) {
          const sc = survCost(a);
          addAura(rX[a], rY[a], sc, 0.95, 160, 0, 0);
        }
      }
    }
    if (myAgent === 0 && timer() < qActiveUntil && myKSkin === 2) {
      for (let a2 = 1; a2 < NA; a2++) {
        if (agSt[a2] <= 2) addAura(rX[a2], rY[a2] - 0.01, C_FX_CROW, 0.35, 64, 1.05, -1);
      }
    }
    return;
  }
  // survivors: hooked teammates, unfinished generators, exit gates, Bond
  for (let a3 = 1; a3 < NA; a3++) {
    if (a3 !== viewer) {
      const st3 = agSt[a3];
      if (st3 === 4) addAura(rX[a3], rY[a3], C_S0_FRONTA + agSkin[a3] * 10 + SC_HOOKED, 0.95, 160, 0.16, 0);
      else if (st3 <= 3 && myAgent > 0 && mySkin === 5) {
        const sc3 = survCost(a3);
        addAura(rX[a3], rY[a3], sc3, 0.95, 160, 0, 40);
      } else if (st3 === 2 && dist2(camX, camY, rX[a3], rY[a3]) < 20) addAura(rX[a3], rY[a3], C_S0_FRONTA + agSkin[a3] * 10 + SC_DOWN, 0.95, 160, 0, 0);
    }
  }
  if (!powered) {
    for (let g = 0; g < genC.length; g++) {
      if (genP[g] < 100) {
        const gd = dist2(camX, camY, ((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5));
        if (gd > 3) addAura(((genC[g]) % MW + 0.5), (Math.floor((genC[g]) / MW) + 0.5), C_GEN0, 0.85, 160, 0, 30);
      }
    }
  } else {
    for (let i = 0; i < 2; i++) {
      if (gateP[i] < 100) addAura(((gateC[i]) % MW + 0.5), (Math.floor((gateC[i]) / MW) + 0.5), C_AURA_EXIT, 0.4, 48, 0.75, -1);
    }
  }
}

/** @warp */
function restampCol(c: number, d: number) {
  if (cDepth[c] < d) {
    switchCostume(cCost[c]);
    me.size = cSize[c];
    setEffect("brightness", cBr[c]);
    goTo(c * CW - 238, horizon);
    stamp();
  }
  if (oDepth[c] < d) {
    switchCostume(oCost[c]);
    me.size = oSize[c];
    setEffect("brightness", oBr[c]);
    goTo(c * CW - 238, horizon);
    stamp();
  }
}

/** @warp */
function drawObjects() {
  for (let k = 0; k < bD.length; k++) {
    const d = bD[k];
    const c0 = Math.max(0, Math.floor((bX[k] - bW[k] + 240) / CW));
    const c1 = Math.min(N - 1, Math.floor((bX[k] + bW[k] + 240) / CW));
    const cm = Math.max(0, Math.min(N - 1, Math.floor((bX[k] + 240) / CW)));
    if (!(cDepth[c0] < d && cDepth[c1] < d && cDepth[cm] < d)) {
      switchCostume(bC[k]);
      me.size = bS[k];
      setEffect("brightness", bB[k]);
      setEffect("ghost", bG[k]);
      goTo(bX[k], bY[k]);
      stamp();
      setEffect("ghost", 0);
      for (let c = c0; c <= c1; c++) restampCol(c, d);
    }
  }
  // auras on top
  for (let i = 0; i < aX.length; i++) {
    switchCostume(aC[i]);
    me.size = aS[i];
    if (aH[i] >= 0) {
      setEffect("brightness", 70);
      setEffect("color", aH[i]);
      setEffect("ghost", 45);
    } else {
      clearEffects();
    }
    goTo(aX[i], aY[i]);
    stamp();
  }
  clearEffects();
}

/** Stamp a number with the digit costumes. align: 0 left, 0.5 centre, 1 right. */
/** @warp */
function drawNum(n: number, x: number, y: number, sc: number, align: number) {
  const s = String(Math.max(0, Math.floor(n)));
  const w = (15 * sc) / 100;
  me.size = sc;
  const x0 = x - align * w * s.length;
  for (let k = 0; k < s.length; k++) {
    switchCostume(C_D0 + Number(s[k]));
    goTo(x0 + w * k + w / 2, y);
    stamp();
  }
}

/** @warp */
function stampAt(cost: number, x: number, y: number) {
  switchCostume(cost);
  goTo(x, y);
  stamp();
}

/** @warp */
function stateIcon(a: number): number {
  const st = agSt[a];
  if (st === 0) return C_ST_HEALTHY;
  if (st === 1) return C_ST_INJURED;
  if (st === 2) return C_ST_DOWN;
  if (st === 3) return C_ST_CARRIED;
  if (st === 4) return C_ST_HOOKED;
  if (st === 5) return C_ST_DEAD;
  return C_ST_ESCAPED;
}

/** The skill check ring: a needle sweeps clockwise; press SPACE inside the white zone (the bright start is GREAT). */
/** @warp */
function drawSkill() {
  let oy = 0;
  if (game.touch) oy = 50; // keep it clear of the thumbs
  if (timer() < scResultUntil) {
    me.size = 100;
    if (game.touch) {
      me.size = 70;
      stampAt(scResultC, 0, 108);
    } else stampAt(scResultC, 0, -72);
  }
  if (!scOn) return;
  me.size = 100;
  stampAt(C_SC_RING, 0, oy);
  const r = 44;
  for (let k = 0; k < scWidth; k += 4) {
    const a0 = scZone + k;
    const a1 = Math.min(scZone + scWidth, a0 + 4);
    Draw.line(sin(a0) * r, oy + cos(a0) * r, sin(a1) * r, oy + cos(a1) * r, 8, k < 12 ? "#FFFFFF" : "#C8C2A8");
  }
  const t = timer() - scStart;
  if (t >= 0) {
    const ang = (t / 1.15) * 360;
    Draw.line(0, oy, sin(ang) * (r + 8), oy + cos(ang) * (r + 8), 4, "#E8322A");
  }
}

/** m:ss with the digit costumes, centred at (x, y). */
/** @warp */
function drawClock(secs: number, x: number, y: number) {
  const s = Math.max(0, Math.ceil(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  me.size = 90;
  switchCostume(C_D0 + m);
  goTo(x - 22, y);
  stamp();
  switchCostume(C_DCOLON);
  goTo(x - 10, y);
  stamp();
  switchCostume(C_D0 + Math.floor(r / 10));
  goTo(x + 2, y);
  stamp();
  switchCostume(C_D0 + (r % 10));
  goTo(x + 16, y);
  stamp();
}

/** HUD layout (no overlaps): generators top-left, the dawn timer top-centre, my perk top-right, the survivors down the
 * left edge, banners in the middle band, prompts and the action bar at the bottom (higher up with touch controls). */
/** @warp */
function drawHud(viewer: number) {
  clearEffects();
  me.size = 100;
  // generators left / gates powered
  if (powered) stampAt(C_HUD_GATES, -150, 160);
  else {
    stampAt(C_HUD_GENS, -176, 160);
    drawNum(5 - gensDone, -142, 160, 110, 0);
  }
  // the dawn timer (or the collapse, whichever comes first)
  me.size = 100;
  let left = hTime;
  let panel = C_HUD_TIMER;
  if (hTime < 60) panel = C_HUD_TIMER_RED;
  if (collapseT > 0 && collapseT < hTime) {
    left = collapseT;
    panel = C_HUD_COLLAPSE2;
  }
  stampAt(panel, 0, 160);
  drawClock(left, 14, 160);
  if (left < 10 && timer() > tickAt && hPhase === 1) {
    tickAt = timer() + 1;
    me.volume = 60;
    playSound("tick");
  }
  if (hTime < 60 && !warnedMinute && hPhase === 1) {
    warnedMinute = true;
    showBanner(C_BN_MINUTE);
  }
  me.size = 100;
  if (mapId === 1) stampAt(C_HUD_FLOOR0 + camFloor, 0, 130);
  // survivors down the left edge: portrait, state badge, hook pips, hook timer
  for (let a = 1; a < NA; a++) {
    const y = 112 - (a - 1) * 40;
    me.size = 82;
    stampAt(C_FACE0 + Math.max(0, agSkin[a]), -218, y);
    if (a === myAgent) stampAt(C_FACE_YOU, -218, y);
    me.size = 62;
    const ic = stateIcon(a);
    stampAt(ic, -201, y - 10);
    me.size = 100;
    if (agStage[a] >= 1 && agSt[a] <= 4) stampAt(C_ST_PIP, -202, y + 12);
    if (agStage[a] >= 2 && agSt[a] <= 4) stampAt(C_ST_PIP, -193, y + 12);
    if (agSt[a] === 4) Draw.bar(-235, y - 20, 34, 4, agProg[a] / 100, "#E85A4A", "#2A1010");
  }
  // my perk / power (tap it on touch screens)
  if (myAgent >= 0) {
    me.size = 100;
    let ic2 = C_PERK0 + mySkin;
    if (myAgent === 0) ic2 = C_POWER0 + myKSkin;
    if (timer() < qReadyAt) setEffect("ghost", 50);
    stampAt(ic2, 214, 150);
    clearEffects();
    if (timer() < qReadyAt) Draw.bar(194, 124, 40, 5, 1 - (qReadyAt - timer()) / 40, "#B8A8E8", "#1A1426");
  }
  // prompt and action bar
  me.size = 100;
  let py0 = -122;
  if (game.touch) {
    py0 = -30;
    me.size = 62;
  }
  if (promptC > 0 && myAgent >= 0 && hPhase === 1) stampAt(promptC, 0, py0);
  if (barFrac >= 0 && hPhase === 1) Draw.bar(-80, py0 - 18, 160, 9, Math.min(1, barFrac), barCol, "#1A1C1A");
  drawSkill();
  if (timer() < bannerUntil && !scOn) {
    me.size = 80;
    stampAt(bannerC, 0, 78);
  }
}

/** Terror radius: heartbeat and a red edge when the killer is near (survivors only). */
/** @warp */
function terror() {
  if (myAgent <= 0 || agSt[myAgent] >= 5 || hPhase !== 1) return;
  if (agFx[0] === 2) return; // Vanish: no heartbeat
  const d = dist2(px, py, rX[0], rY[0]);
  let fd = d;
  const f1 = floorOf(py);
  const f2 = floorOf(rY[0]);
  if (f1 !== f2) fd = d + 6;
  if (fd < 10) {
    heartK = 1 - fd / 10;
    if (timer() > heartAt) {
      heartAt = timer() + 1.15 - heartK * 0.7;
      me.volume = 30 + heartK * 70;
      playSound("heartbeat");
    }
    setEffect("ghost", 100 - heartK * 55);
    me.size = 100;
    stampAt(C_VIGNETTE, 0, 0);
    clearEffects();
  }
  // Spine Chill
  if (mySkin === 8 && d < 13) {
    const f = facingFrom(rX[0], rY[0], rA[0], px, py, 13, 0.75);
    if (f) {
      me.size = 100;
      stampAt(C_EYE, 168, 150);
    }
  }
}

// ================================================================== menus

/** @warp */
function inRect(x: number, y: number, w: number, h: number): boolean {
  // (x, y) top-left in SVG coordinates of a 480 x 360 costume
  const mx = mouseX() + 240;
  const my = 180 - mouseY();
  return mx > x && mx < x + w && my > y && my < y + h;
}

/** @warp */
function menus() {
  const click = mouseDown();
  const edge = click && !prevClick;
  prevClick = click;
  penClear();
  clearEffects();
  me.size = 100;
  game.weapon = -1;
  if (mode === 1) {
    stampAt(C_MENU_MAIN, 0, 0);
    stampAt(C_MENU_TOUCH_OFF + (game.touch ? 1 : 0), 0, -63);
    if (edge && Math.abs(mouseX()) < 85 && Math.abs(mouseY() + 63) < 13) {
      game.touch = !game.touch;
      me.volume = 60;
      playSound("click");
    }
    if (edge) {
      const b1 = inRect(120, 120, 240, 46);
      const b2 = inRect(120, 180, 240, 46);
      if (b1) {
        offline = true;
        isHost = true;
        mode = 3;
        me.volume = 60;
        playSound("click");
      } else if (b2) {
        mode = 2;
        wantJoin = true;
        me.volume = 60;
        playSound("click");
      }
    }
  } else if (mode === 2) {
    stampAt(C_MENU_CONNECTING, 0, 0);
  } else if (mode === 3) {
    stampAt(C_MENU_ROLE, 0, 0);
    if (edge) {
      const s = inRect(40, 110, 190, 210);
      const k = inRect(250, 110, 190, 210);
      if (s || k) {
        myRole = s ? 1 : 2;
        mode = 4;
        me.volume = 60;
        playSound("click");
      }
    }
  } else if (mode === 4) {
    charSelect(edge);
  }
}

/** @warp */
function charSelect(edge: boolean) {
  const killer = myRole === 2;
  stampAt(killer ? C_KS_BG : C_CS_BG, 0, 0);
  // preview
  if (killer) {
    me.size = 100;
    stampAt(C_K0_FRONTA + myKSkin * 10 + Math.floor(timer() * 2) % 2, -145, 40);
  } else {
    me.size = 100;
    stampAt(C_S0_FRONTA + mySkin * 10 + Math.floor(timer() * 2) % 2, -145, 40);
  }
  me.size = 55;
  stampAt(killer ? C_KS_INFO0 + myKSkin : C_CS_INFO0 + mySkin, -145, -78);
  me.size = 100;
  if (!killer && !picked) stampAt(C_CS_RANDOM, -145, -116);
  // grid
  if (killer) {
    for (let i = 0; i < 3; i++) {
      const gx = 30 + i * 92;
      stampAt(i === myKSkin ? C_KS_FRAME_SEL : C_KS_FRAME, gx, 60);
      me.size = 160;
      stampAt(C_KFACE0 + i, gx, 60);
      me.size = 100;
      if (edge && Math.abs(mouseX() - gx) < 40 && Math.abs(mouseY() - 60) < 40) {
        myKSkin = i;
        me.volume = 60;
        playSound("click");
      }
    }
    me.size = 100;
    stampAt(C_POWER0 + myKSkin, 122, -20);
  } else {
    for (let i = 0; i < 10; i++) {
      const gx = -30 + (i % 5) * 58;
      const gy = 100 - Math.floor(i / 5) * 62;
      stampAt(i === mySkin ? C_CS_FRAME_SEL : C_CS_FRAME, gx, gy);
      me.size = 112;
      stampAt(C_FACE0 + i, gx, gy);
      me.size = 100;
      if (edge && Math.abs(mouseX() - gx) < 27 && Math.abs(mouseY() - gy) < 27) {
        mySkin = i;
        picked = true;
        me.volume = 60;
        playSound("click");
      }
    }
    me.size = 100;
    stampAt(C_PERK0 + mySkin, 106, -20);
  }
  if (edge) {
    const back = inRect(14, 310, 110, 40);
    const ready = inRect(330, 310, 140, 40);
    if (back) {
      mode = 3;
      me.volume = 60;
      playSound("click");
    }
    if (ready) {
      mode = 5;
      onResults = false;
      myAgent = -1;
      prevMyAgent = -1;
      me.volume = 80;
      playSound("click");
    }
  }
}
let picked = false;

/** Results screen. */
/** @warp */
function drawResults() {
  clearEffects();
  me.size = 100;
  stampAt(C_RES_PANEL, 0, 0);
  let tc = C_RES_DEAD;
  if (myRole === 2) {
    let kills = 0;
    for (let a = 1; a < NA; a++) {
      if (agSt[a] === 5) kills++;
    }
    tc = C_RES_K0 - kills;
  } else if (myOutcome === 6) tc = C_RES_ESCAPED;
  stampAt(tc, 0, 116);
  me.size = 100;
  stampAt(C_KFACE0 + Math.max(0, agSkin[0]), -150, 66);
  stampAt(C_KNM0 + Math.max(0, agSkin[0]), -40, 66);
  for (let a = 1; a < NA; a++) {
    const y = 66 - a * 40;
    me.size = 100;
    stampAt(C_FACE0 + Math.max(0, agSkin[a]), -150, y);
    stampAt(C_NM0 + Math.max(0, agSkin[a]), -40, y);
    stampAt(agSt[a] === 6 ? C_LB_ESCAPED : C_LB_DEAD, 120, y);
    if (a === myAgent) stampAt(C_HUD_YOU, -186, y);
  }
}

// ================================================================== frame

/** @warp */
function smoothAgents(dt: number) {
  for (let a = 0; a < NA; a++) {
    let tx = agX[a];
    let ty = agY[a];
    let ta = agA[a];
    const s = agSlot[a];
    // other humans: their own packets are fresher than the host's relay
    if (!offline && s > 0 && s !== mySlot() && slAct[s - 1] === 1 && slAck[s - 1] === a + 1 && !(a > 0 && agSt[a] >= 3)) {
      tx = slX[s - 1];
      ty = slY[s - 1];
      ta = slA[s - 1];
    }
    if (a === myAgent) {
      tx = px;
      ty = py;
      ta = pa;
    }
    if (a > 0 && agSt[a] === 3) {
      tx = rX[0];
      ty = rY[0];
    }
    const jump = Math.abs(tx - rX[a]) + Math.abs(ty - rY[a]);
    if (jump > 3 || a === myAgent || (isHost && agSlot[a] === 0)) {
      rX[a] = tx;
      rY[a] = ty;
    } else {
      const k = Math.min(1, dt * 12);
      rX[a] = rX[a] + (tx - rX[a]) * k;
      rY[a] = rY[a] + (ty - rY[a]) * k;
    }
    rA[a] = ta;
  }
}

/** Host: whole simulation step (also runs while the host is in the menus, so the match goes on). */
/** @warp */
function hostSim(dt: number) {
  hostAssign();
  if (hPhase === 1) {
    hostTakeHumans();
    hostBots(dt);
    hostRules(dt);
  } else if (hPhase === 2 || hPhase === 0) {
    // start the next match when someone is waiting
    let selfWait = false;
    let otherWait = false;
    for (let s = 1; s <= 6; s++) {
      const w = humanWaiting(s);
      if (w) {
        if (s === mySlot()) selfWait = true;
        else otherWait = true;
      }
    }
    const since = timer() - endAt;
    if ((selfWait && (hPhase === 0 || since > 1)) || (otherWait && (hPhase === 0 || since > 15))) newMatch();
  }
}

/** @warp */
function frame() {
  const t0 = timer();
  const rawDt = Time.delta();
  const dt = Math.max(0, Math.min(0.1, rawDt));
  if (mode === 0) {
    penClear();
    if (game.titleDone) {
      mode = 1;
      prevClick = true;
    }
    return;
  }
  if (mode >= 3) {
    netRead();
    if (!isHost) readWorld();
    if (isHost) hostSim(dt);
    deriveWorld();
  }
  if (mode < 5) {
    menus();
    netSend();
    return;
  }
  // in game
  readInput();
  if (hGame !== myGame && hPhase === 1) {
    myGame = hGame;
    myAgent = -1;
    prevMyAgent = -1;
    onResults = false;
    hookTries = 0;
    qReadyAt = 0;
    scOn = false;
    for (let a = 0; a < NA; a++) {
      prevSt[a] = agSt[a];
      rX[a] = agX[a];
      rY[a] = agY[a];
    }
    matchAt = timer();
    warnedMinute = false;
    csQ.length = 0;
    csKind = 0;
    showBanner(myRole === 2 ? (mapId === 1 ? C_BN_HOUSE_K : C_BN_FIELD_K) : mapId === 1 ? C_BN_HOUSE : C_BN_FIELD);
    stopAllSounds();
    me.volume = 100;
    playSound("start");
  }
  updateLocal(dt);
  if (myAgent >= 0) myOutcome = agSt[myAgent];
  smoothAgents(dt);
  // camera: me, or (dead / escaped / waiting) the survivor I'm watching
  let viewer = myAgent;
  if (myAgent > 0 && agSt[myAgent] >= 5) viewer = spectate();
  if (myAgent < 0) viewer = spectate();
  camX = rX[Math.max(0, viewer)];
  camY = rY[Math.max(0, viewer)];
  camA = rA[Math.max(0, viewer)];
  if (viewer === myAgent && myAgent >= 0) {
    camX = px;
    camY = py;
    camA = pa;
  }
  camFloor = floorOf(camY);
  noticeChanges();
  netSend();
  if (hPhase === 2 && lastPhase !== 2) {
    let kills = 0;
    for (let a = 1; a < NA; a++) {
      if (agSt[a] === 5) kills++;
    }
    if (timeUp === 1 || kills >= 3) csQ.push(3);
    else csQ.push(4);
    onResults = true;
    prevResClick = true;
    resultsAt = timer();
  }
  lastPhase = hPhase;
  dirX = cos(camA);
  dirY = sin(camA);
  plX = -dirY * PLANE;
  plY = dirX * PLANE;
  horizon = bob * 0.6;
  if (viewer === myAgent && myAgent > 0 && agSt[myAgent] === 2) horizon = -60;
  if (viewer === myAgent && myAgent > 0 && agSt[myAgent] === 3) horizon = -30 + sin(timer() * 300) * 6;
  if (viewer === myAgent && myAgent > 0 && agSt[myAgent] === 4) horizon = 25;
  penClear();
  // cutscenes take over the screen
  if (csKind === 0 && csQ.length > 0) startCutscene();
  if (csKind > 0) {
    game.weapon = -1;
    drawCutscene();
    return;
  }
  if (hPhase === 0 || (hPhase === 2 && !onResults)) {
    clearEffects();
    me.size = 100;
    stampAt(C_MENU_WAITING, 0, 0);
    game.weapon = -1;
    return;
  }
  castWalls();
  collectObjects(viewer);
  drawObjects();
  if (myAgent > 0 && timer() - hurtAt < 0.4) {
    setEffect("ghost", 30);
    me.size = 100;
    stampAt(C_VIGNETTE, 0, 0);
    clearEffects();
  }
  if (myAgent > 0 && agSt[myAgent] === 2) {
    setEffect("ghost", 20);
    me.size = 100;
    stampAt(C_DARKNESS, 0, 0);
    clearEffects();
  }
  terror();
  if (hPhase === 2) {
    game.weapon = -1;
    drawResults();
    const click = mouseDown() || keyPressed("space");
    if (click && !prevResClick && timer() - resultsAt > 1) {
      onResults = false;
      mode = 3;
      prevClick = true;
    }
    prevResClick = click;
    return;
  }
  drawHud(viewer);
  drawTouch();
  if (viewer !== myAgent || myAgent < 0) {
    me.size = 100;
    if (myAgent < 0) stampAt(C_LB_WAITMATCH, 0, 40);
    else {
      stampAt(C_LB_SPECTATE, -60, -96);
      stampAt(C_PR_SPECTATE, 0, -120);
      if (viewer > 0) stampAt(C_NM0 + Math.max(0, agSkin[viewer]), 95, -96);
    }
  }
  perf.ms = Math.round((timer() - t0) * 1000);
  fpsCount++;
  if (timer() > fpsAt + 1) {
    perf.fps = fpsCount;
    fpsCount = 0;
    fpsAt = timer();
  }
}

/** @warp */
function startCutscene() {
  csKind = csQ[0];
  csQ.remove(0);
  csAt = timer();
  csPrevSkip = true;
  scOn = false;
  stopAllSounds();
  me.volume = 100;
  if (csKind === 1) playSound("escape");
  if (csKind === 2) playSound("sacrifice");
  if (csKind === 3) {
    playSound("laugh");
    if (timeUp === 1) playSound("lock");
  }
  if (csKind === 4) playSound("win");
}

/** Escaping, being sacrificed, the killer winning, the survivors winning: about five seconds each (skippable). */
/** @warp */
function drawCutscene() {
  const t = timer() - csAt;
  clearEffects();
  me.size = 100;
  if (csKind === 1 || csKind === 4) stampAt(C_CS_DAWN, 0, 0);
  else if (csKind === 2) stampAt(C_CS_DARK, 0, 0);
  else stampAt(C_CS_MOON, 0, 0);
  let title = C_CS_T_ESCAPED;
  let sub = C_CS_S_ESCAPED;
  if (csKind === 1) {
    // walking off into the sunrise
    me.size = Math.max(30, 175 - t * 32);
    setEffect("ghost", Math.max(0, (t - 3.2) * 60));
    stampAt(C_S0_FRONTA + Math.max(0, mySkin) * 10 + 2 + (Math.floor(t * 4) % 2), sin((t * 3) * 57.3) * 4, -70 + t * 16);
  } else if (csKind === 2) {
    title = C_CS_T_DEAD;
    sub = C_CS_S_DEAD;
    me.size = 170;
    setEffect("brightness", -40);
    stampAt(C_HOOK, 0, -40);
    setEffect("brightness", -Math.min(80, t * 20));
    setEffect("ghost", Math.max(0, (t - 1.2) * 35));
    stampAt(C_S0_FRONTA + Math.max(0, mySkin) * 10 + SC_HOOKED, sin((t * 9) * 57.3) * 3, -20 + Math.max(0, t - 1.2) * 30);
    clearEffects();
    for (let i = 0; i < 4; i++) {
      me.size = 90 + i * 15;
      stampAt(C_FX_CROW, ((t * 160 + i * 140) % 560) - 280, 60 + i * 22 + sin((t * 6 + i) * 57.3) * 8);
    }
  } else if (csKind === 3) {
    title = C_CS_T_KILLER;
    sub = timeUp === 1 ? C_CS_S_TIME : C_CS_S_KILLS;
    const g = Math.min(1, t / 2.2);
    me.size = 70 + g * 150;
    setEffect("brightness", -100 + g * 100);
    let kc = C_K0_FRONTA + Math.max(0, agSkin[0]) * 10;
    if (t > 2.4 && Math.floor(t * 2) % 2 === 0) kc = kc + KC_ATK;
    stampAt(kc, 0, -150 + 70 + g * 60);
  } else {
    title = C_CS_T_SURVIVORS;
    sub = C_CS_S_SURVIVORS;
    let n = 0;
    for (let a = 1; a < NA; a++) {
      if (agSt[a] === 6) n++;
    }
    let i = 0;
    for (let a2 = 1; a2 < NA; a2++) {
      if (agSt[a2] === 6) {
        me.size = 95;
        stampAt(C_S0_FRONTA + Math.max(0, agSkin[a2]) * 10 + (Math.floor(t * 3 + a2) % 2), (i - (n - 1) / 2) * 95, -70 + Math.abs(sin((t * 4 + a2) * 57.3)) * 8);
        i++;
      }
    }
  }
  clearEffects();
  me.size = 100;
  stampAt(C_CS_BARS, 0, 0);
  if (t > 0.6) {
    setEffect("ghost", Math.max(0, 100 - (t - 0.6) * 220));
    me.size = 100 + Math.max(0, 1.2 - t) * 30;
    stampAt(title, 0, 108);
    me.size = 100;
    setEffect("ghost", Math.max(0, 100 - (t - 1.2) * 200));
    stampAt(sub, 0, 62);
    clearEffects();
  }
  if (t > 1.2) stampAt(C_CS_SKIP, 0, -162);
  const skip = mouseDown() || keyPressed("space");
  if ((skip && !csPrevSkip && t > 1.2) || t > 5.5) {
    csKind = 0;
    prevResClick = true;
  }
  csPrevSkip = skip;
}

/** Pick (and keep) a survivor to watch; Q / E switch. */
/** @warp */
function spectate(): number {
  const k = kQ || kE || kSpace;
  const edge = k && !prevSpecKey;
  prevSpecKey = k;
  if (specA < 1 || agSt[specA] >= 5 || edge) {
    let s = specA;
    for (let i = 0; i < 4; i++) {
      s = (Math.max(0, s) % 4) + 1;
      if (agSt[s] < 5 && s !== myAgent) {
        specA = s;
        return specA;
      }
    }
    specA = 0;
  }
  return specA;
}

whenFlag(() => {
  me.visible = false;
  penClear();
  clearEffects();
  initLists();
  loadMap(0);
  Net.session.slot = 0;
  netResetSlots();
  mySkin = random(0, 9); // a random survivor every time (pick another on the character screen)
  myKSkin = random(0, 2);
  picked = false;
  myRole = 1;
  mode = 0;
  offline = true;
  isHost = true;
  wantJoin = false;
  hPhase = 0;
  hGame = 0;
  myGame = -1;
  myAgent = -1;
  prevMyAgent = -1;
  lastPhase = 0;
  lastWSeq = -1;
  nextTick = 0;
  joinedAt = 0;
  endAt = 0;
  onResults = false;
  bannerUntil = 0;
  scOn = false;
  scResultUntil = 0;
  qReadyAt = 0;
  qActiveUntil = 0;
  boostUntil = 0;
  slowUntil = 0;
  dashUntil = 0;
  attackCool = 0;
  pausedUntil = 0;
  noiseUntil = 0;
  heartAt = 0;
  hurtAt = -9;
  fpsAt = 0;
  curEv = 0;
  evSeq = 0;
  kSwingAt = 0;
  kKickUntil = 0;
  kPowerEnd = 0;
  kPowerReady = 20;
  kIgnoreUntil = 0;
  prevFx = 0;
  hTime = MATCH_TIME;
  timeUp = 0;
  csQ.length = 0;
  csKind = 0;
  chatOpen = false;
  tickAt = 0;
  prevClick = true;
  game.weapon = -1;
  forever(() => {
    if (wantJoin) {
      wantJoin = false;
      Net.join(); // ~2 s: watches the cloud slots and claims a free one
      netResetSlots();
      joinedAt = timer();
      offline = Net.session.slot === 0; // session full: play solo
      isHost = offline;
      game.started = !offline;
      mode = 3;
    }
    frame();
  });
});
