import ts from "typescript";
import { Ctx, Diag, Target } from "./compile";
import { emptyProject, IMAGE_EXT, makeCostume, makeSound, newSprite, Sb3, SOUND_EXT } from "./project";

export * from "./project";
export { decompile } from "./decompile";
export type { DecompileResult } from "./decompile";
export type { Diag } from "./compile";

export interface BuildInput {
  /** "Player.ts" -> source. File name (without .ts) is the sprite name; "Stage.ts" is the stage. */
  sources: Record<string, string>;
  /** "Player/run1.png" -> bytes. In a folder named after a sprite, images become costumes and wav/mp3 files become sounds. */
  images?: Record<string, Uint8Array>;
  base: Sb3;
}
/** es5/scratch: type libraries. engine: "physics.ts" -> source, importable as "tts/physics". */
export interface Libs { es5: string; scratch: string; engine?: Record<string, string> }
export interface BuildResult { sb3: Sb3 | null; diagnostics: Diag[]; types: string }

export const SOURCE_COMMENT = "tts_source";
const SOURCE_HEADER = "TextToScratch source — edit with the TextToScratch editor\n";

const q = (names: Iterable<string>) => [...new Set(names)].map((n) => JSON.stringify(n)).join(" | ") || "never";

/** Generated typings: asset and sprite names as string-literal unions. */
export function typesFor(json: any, extraSprites: string[] = [], images: string[] = []): string {
  const sprites = json.targets.filter((t: any) => !t.isStage);
  const stage = json.targets.find((t: any) => t.isStage);
  const names = (exts: string[], folder: (f: string) => boolean) =>
    images.filter((p) => folder(p.split("/")[0]) && exts.includes(p.split(".").pop()!.toLowerCase())).map((p) => p.split("/").pop()!.replace(/\.[^.]+$/, ""));
  return [
    `type SpriteName = ${q([...sprites.map((t: any) => t.name), ...extraSprites.filter((s) => s !== "Stage")])};`,
    `type CostumeName = ${q([...sprites.flatMap((t: any) => t.costumes.map((c: any) => c.name)), ...names(IMAGE_EXT, (f) => f !== "Stage")])};`,
    `type BackdropName = ${q([...stage.costumes.map((c: any) => c.name), ...names(IMAGE_EXT, (f) => f === "Stage")])};`,
    `type SoundName = ${q([...json.targets.flatMap((t: any) => t.sounds.map((s: any) => s.name)), ...names(SOUND_EXT, () => true)])};`,
    "",
  ].join("\n");
}

// Scratch rejects projects with comments over 8000 characters, so sources are split across comments.
const CHUNK = 7500;
const PART = /^TextToScratch source part (\d+)\/(\d+)[^\n]*\n/;

function sourceComments(sources: Record<string, string>) {
  const text = JSON.stringify(sources);
  const n = Math.max(1, Math.ceil(text.length / CHUNK));
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [
    `${SOURCE_COMMENT}_${i}`,
    { blockId: null, x: 0, y: i * 40, width: 400, height: 200, minimized: true,
      text: `TextToScratch source part ${i + 1}/${n} (edit with the TextToScratch editor)\n` + text.slice(i * CHUNK, (i + 1) * CHUNK) },
  ]));
}

const isSourceComment = (c: any) => typeof c?.text === "string" && (PART.test(c.text) || c.text.startsWith(SOURCE_HEADER));

/** Sources stored in a project (Stage comments), or null. */
export function sourcesOf(json: any): Record<string, string> | null {
  const comments = Object.values(json.targets.find((t: any) => t.isStage)?.comments ?? {}) as any[];
  const legacy = comments.find((c) => c?.text?.startsWith(SOURCE_HEADER));
  const parts = comments.map((c) => ({ m: typeof c?.text === "string" ? c.text.match(PART) : null, text: c?.text as string })).filter((p) => p.m);
  const text = legacy
    ? legacy.text.slice(SOURCE_HEADER.length)
    : parts.sort((a, b) => Number(a.m![1]) - Number(b.m![1])).map((p) => p.text.slice(p.m![0].length)).join("");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function build(input: BuildInput, libs: Libs): BuildResult {
  const json = structuredClone(input.base.json);
  const files = { ...input.base.files };
  const images = input.images ?? {};
  // "Player.ts" is a sprite; files in folders ("lib/math.ts") are shared libraries
  const names = Object.keys(input.sources).filter((f) => !f.includes("/")).map((f) => f.replace(/\.ts$/, ""));
  const types = typesFor(json, [...names, ...Object.keys(images).map((p) => p.split("/")[0])], Object.keys(images));

  // ---- type check ----
  const vfs = new Map<string, string>([["/lib.es5.d.ts", libs.es5], ["/scratch.d.ts", libs.scratch], ["/sprites.d.ts", types]]);
  for (const [f, src] of Object.entries(input.sources)) vfs.set("/src/" + f, src);
  for (const [f, src] of Object.entries(libs.engine ?? {})) vfs.set("/engine/" + f, src);
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES5, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, moduleDetection: ts.ModuleDetectionKind.Force, types: [], skipLibCheck: true,
    baseUrl: "/", paths: { "tts/*": ["engine/*"] },
  };
  const host: ts.CompilerHost = {
    getSourceFile: (f, v) => (vfs.has(f) ? ts.createSourceFile(f, vfs.get(f)!, v, true) : undefined),
    getDefaultLibFileName: () => "/lib.es5.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => vfs.has(f),
    readFile: (f) => vfs.get(f),
  };
  const program = ts.createProgram([...vfs.keys()], options, host);
  const diagnostics: Diag[] = ts.getPreEmitDiagnostics(program).map((d) => {
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
    return { file: d.file?.fileName ?? "", line: pos.line + 1, col: pos.character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, "\n"), code: d.code };
  });
  if (diagnostics.length) return { sb3: null, diagnostics, types };

  // ---- compile ----
  const ctx = new Ctx(program.getTypeChecker());
  for (const sf of program.getSourceFiles()) if (sf.fileName.startsWith("/engine/") || sf.fileName.startsWith("/src/lib/")) ctx.addLib(sf);
  const targets = names.map((name, i) => new Target(ctx, name, name === "Stage", program.getSourceFile("/src/" + name + ".ts")!, `t${i}_`));
  targets.forEach((t) => t.declare(1));
  targets.forEach((t) => t.declare(2));
  targets.forEach((t) => t.compile());
  if (ctx.diags.length) return { sb3: null, diagnostics: ctx.diags, types };

  // ---- assemble ----
  const stage = json.targets.find((t: any) => t.isStage);
  const find = (name: string) => (name === "Stage" ? stage : json.targets.find((t: any) => !t.isStage && t.name === name));
  for (const name of new Set([...names, ...Object.keys(images).map((p) => p.split("/")[0])])) {
    if (find(name)) continue;
    const s = newSprite(name, json.targets.length);
    json.targets.push(s.target);
    files[s.file[0]] = s.file[1];
  }
  // A sprite named "Thumbnail" is always the top layer: it's the title card (and the Scratch thumbnail,
  // which is captured from the stage when the project is saved) until the game hides it.
  const thumb = find("Thumbnail");
  if (thumb) thumb.layerOrder = Math.max(...json.targets.map((t: any) => t.layerOrder ?? 0)) + 1;

  // image folders -> costumes (replace same name, else append; drop the placeholder once real art exists)
  const placeholders = new Set([newSprite("", 0).target.costumes[0].assetId, emptyProject().json.targets[0].costumes[0].assetId]);
  for (const [path, bytes] of Object.entries(images).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const [folder, file] = path.split("/");
    const ext = file.split(".").pop()!.toLowerCase();
    const t = find(folder);
    if (SOUND_EXT.includes(ext)) {
      const s = makeSound(file.replace(/\.[^.]+$/, ""), bytes, ext);
      files[s.file[0]] = s.file[1];
      const i = t.sounds.findIndex((x: any) => x.name === s.sound.name);
      if (i >= 0 && t.sounds[i].assetId === s.sound.assetId) continue; // unchanged file: keep the original entry
      if (i >= 0) t.sounds[i] = s.sound;
      else t.sounds.push(s.sound);
      continue;
    }
    if (!IMAGE_EXT.includes(ext)) continue;
    const c = makeCostume(file.replace(/\.[^.]+$/, ""), bytes, ext);
    files[c.file[0]] = c.file[1];
    if (t.costumes.length === 1 && placeholders.has(t.costumes[0].assetId)) t.costumes = [];
    const i = t.costumes.findIndex((x: any) => x.name === c.costume.name);
    if (i >= 0 && t.costumes[i].assetId === c.costume.assetId) continue; // unchanged file: keep its rotation center
    if (i >= 0) t.costumes[i] = c.costume;
    else t.costumes.push(c.costume);
    t.currentCostume = Math.min(t.currentCostume, t.costumes.length - 1);
  }

  for (const t of targets) {
    const jt = find(t.name);
    const { variables, lists } = t.variables(false);
    jt.blocks = t.blocks;
    jt.variables = variables;
    jt.lists = lists;
    jt.comments = {};
  }
  const g = targets[0]?.variables(true) ?? { variables: {}, lists: {} };
  const stageTarget = targets.find((t) => t.isStage);
  const stageLocal = stageTarget?.variables(false) ?? { variables: {}, lists: {} };
  stage.variables = { ...(stageTarget ? {} : stage.variables), ...stageLocal.variables, ...g.variables };
  stage.lists = { ...(stageTarget ? {} : stage.lists), ...stageLocal.lists, ...g.lists };
  stage.broadcasts = { ...stage.broadcasts, ...Object.fromEntries([...ctx.broadcasts].map(([n, id]) => [id, n])) };
  stage.comments = {
    ...(stageTarget ? {} : Object.fromEntries(Object.entries(stage.comments ?? {}).filter(([, c]) => !isSourceComment(c)))),
    ...sourceComments(input.sources),
  };
  json.extensions = [...new Set([...(json.extensions ?? []), ...ctx.extensions])];

  // drop monitors whose variable no longer exists
  const ids = new Set(json.targets.flatMap((t: any) => [...Object.keys(t.variables), ...Object.keys(t.lists)]));
  json.monitors = (json.monitors ?? []).filter((m: any) => !["data_variable", "data_listcontents"].includes(m.opcode) || ids.has(m.id));
  // the VM's "show variable" only toggles an existing monitor, so declare one (hidden) per shown variable
  for (const t of targets)
    for (const v of t.monitored) {
      if (json.monitors.some((m: any) => m.id === v.id)) continue;
      const m = (v as any).monitor ?? {};
      const slider = m.slider ?? (m.sliderMin !== undefined || m.sliderMax !== undefined);
      json.monitors.push({
        id: v.id, mode: v.list ? "list" : (slider ? "slider" : "default"), opcode: v.list ? "data_listcontents" : "data_variable",
        params: v.list ? { LIST: v.name } : { VARIABLE: v.name }, spriteName: v.global ? null : t.name,
        value: v.list ? [] : 0, width: 0, height: 0, x: m.x ?? 5, y: m.y ?? (5 + 27 * json.monitors.length), visible: m.visible ?? false,
        sliderMin: m.sliderMin ?? 0, sliderMax: m.sliderMax ?? 100, isDiscrete: true,
      });
    }
  json.meta = { ...json.meta, agent: "TextToScratch" };
  return { sb3: { json, files }, diagnostics: [], types };
}
