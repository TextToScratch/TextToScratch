// Scratch blocks -> TextToScratch TypeScript: the reverse of compile.ts, driven by the same tables in api.ts.
import { Arg, HATS, MATHOP, PROPS, REPORT, Slot, Spec, STACK } from "./api";

export interface DecompileResult { sources: Record<string, string>; warnings: string[] }

/** Value types: number, string, boolean, any. */
type T = "n" | "s" | "b" | "a";
/** Wanted type. Lowercase converts (Number(x) / String(x)), uppercase only casts (`x as any`, no extra blocks), "v" takes anything. */
type W = "n" | "s" | "N" | "S" | "B" | "v";
/** An emitted expression: code, precedence, type, and the raw text when it came from a literal input. */
interface Ex { c: string; p: number; t: T; lit?: string }
interface Var { ident: string; name: string; list: boolean; global: boolean; cloud: boolean; value: any; t?: T }
interface Param { name: string; ident: string; kind: "b" | "n" | "s"; t?: T }
interface Proc { ident: string; proccode: string; ids: string[]; params: Param[]; warp: boolean }

// ---------- reverse tables (derived from api.ts) ----------

type Rev = { name: string; spec: Spec };
function index(...tables: Record<string, Spec>[]) {
  const m = new Map<string, Rev[]>();
  for (const table of tables) for (const [name, spec] of Object.entries(table)) m.set(spec.op, [...(m.get(spec.op) ?? []), { name, spec }]);
  return m;
}
const propGets = Object.fromEntries(Object.entries(PROPS).filter(([, p]) => p.get).map(([k, p]) => [`me.${k}`, p.get!]));
const R_STACK = index(STACK);
const R_REPORT = index(REPORT, propGets);
const R_HATS = index(HATS);
const R_MATH = Object.fromEntries(Object.entries(MATHOP).map(([k, v]) => [v, k]));
const R_SET = Object.fromEntries(Object.entries(PROPS).filter(([, p]) => p.set).map(([k, p]) => [p.set![0], [k, p.set![1]]]));
const R_CHANGE = Object.fromEntries(Object.entries(PROPS).filter(([, p]) => p.change).map(([k, p]) => [p.change![0], [k, p.change![1]]]));
/** The table entry for a block: same opcode and matching fixed fields (goToFront vs goToBack). */
const pick = (revs: Rev[] | undefined, b: any) => revs?.find((r) => Object.entries(r.spec.fx ?? {}).every(([k, v]) => b.fields?.[k]?.[0] === v));

const BOOL_REPORTERS = new Set(["touching", "touchingColor", "keyPressed", "mouseDown"]);
const STR_REPORTERS = new Set(["answer", "username", "me.costumeName", "me.backdropName"]);
const SLOT_W: Record<Slot, W> = { n: "n", pn: "n", int: "n", whole: "n", ang: "n", col: "S", s: "v", b: "B", msg: "s" };
/** Unknown top-level opcodes that look like events (extension hats) are kept; other loose stacks never run. */
const HATLIKE = /^event_|when|start_as_clone/i;
const KEY = /^([a-z0-9]|space|up arrow|down arrow|left arrow|right arrow|any)$/;

const RESERVED = new Set([
  ..."break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await as any boolean number string symbol undefined NaN Infinity arguments eval".split(" "),
  ...Object.keys(STACK), ...Object.keys(REPORT), ...Object.keys(HATS), ...Object.keys(MATHOP).filter((k) => !k.includes(".")),
  ..."whenClicked onMessage repeat forever waitUntil showVariable hideVariable me Math String Number Boolean Array Object JSON Date game cloud".split(" "),
]);

// precedence
const PRIM = 20, UNARY = 15, MUL = 13, ADD = 12, REL = 10, EQ = 9, AND = 5, OR = 4;

const str = (s: string) => JSON.stringify(s);
const NUM = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const numLike = (s: string) => s.trim() !== "" && Number.isFinite(Number(s));
const num = (s: string): Ex => {
  // more than 15 digits don't fit a JS number exactly (cloud data is often long digit strings): keep them as text
  if (/^-?\d{16,}$/.test(s.trim())) return { c: `(${str(s.trim())} as any)`, p: PRIM, t: "a" };
  const c = NUM.test(s) ? s : String(Number(s));
  return { c, p: c.startsWith("-") ? UNARY : PRIM, t: "n" };
};
const cast = (e: Ex): Ex => (e.t === "a" ? e : { c: `(${e.c} as any)`, p: PRIM, t: "a" });
const par = (e: Ex, p: number) => (e.p < p ? `(${e.c})` : e.c);
const bin = (a: Ex, op: string, b: Ex, p: number, t: T): Ex => ({ c: `${par(a, p)} ${op} ${par(b, p + 1)}`, p, t });
// "true"/"false" text is what the compiler stores for boolean literals, so it reads back as a boolean
const natural = (text: string): Ex => (NUM.test(text) ? num(text) : text === "true" || text === "false" ? { c: text, p: PRIM, t: "b" } : { c: str(text), p: PRIM, t: "s" });
const typeOfValue = (v: any): T => natural(String(v)).t;

/** A Scratch name as a camelCase identifier ("my variable" -> myVariable). */
function identOf(raw: string) {
  const words = raw.normalize("NFKD").replace(/[^\w$]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let s = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  if (!s) s = "v";
  return /^\d/.test(s) ? "_" + s : s;
}
function unique(raw: string, scope: Set<string>) {
  const base = identOf(raw);
  let name = base;
  for (let i = 2; RESERVED.has(name) || scope.has(name); i++) name = base + i;
  scope.add(name);
  return name;
}
/** Join two inferred types; "a" (any) contributions are neutral since any is assignable to everything. */
function widen(o: { t?: T }, t: T | undefined): boolean {
  if (!t || t === "a" || o.t === t || o.t === "a") return false;
  o.t = o.t ? "a" : t;
  return true;
}
const tsType = (t: T | undefined) => (t === "n" ? "number" : t === "s" ? "string" : t === "b" ? "boolean" : "any");

/** Shared state for one project. */
class Proj {
  globals = new Map<string, Var>();
  globalScope = new Set<string>();
  warnings: string[] = [];
  changed = false;
  names: Record<"sprite" | "costume" | "backdrop" | "sound", Set<string>>;
  constructor(public json: any) {
    const sprites = json.targets.filter((t: any) => !t.isStage);
    const stage = json.targets.find((t: any) => t.isStage);
    this.names = {
      sprite: new Set(sprites.map((t: any) => t.name)),
      costume: new Set(sprites.flatMap((t: any) => t.costumes.map((c: any) => c.name))),
      backdrop: new Set(stage?.costumes.map((c: any) => c.name) ?? []),
      sound: new Set(json.targets.flatMap((t: any) => t.sounds.map((s: any) => s.name))),
    };
  }
}

/** One target (sprite or stage) -> one file. */
class Dec {
  scope = new Set<string>();
  locals = new Map<string, Var>();
  procs = new Map<string, Proc>();
  used = new Set<"game" | "cloud">();
  quiet = true;
  private proc: Proc | null = null;
  private narrowed = new Set<string>();
  private warns: { msg: string; needle?: string }[] = [];
  private hatNames = new Map<string, string>();
  private comments = new Map<string, string[]>();
  blocks: Record<string, any>;

  constructor(public p: Proj, public t: any, public file: string) {
    this.blocks = t.blocks ?? {};
    for (const c of Object.values(t.comments ?? {}) as any[])
      if (c?.blockId && typeof c.text === "string") this.comments.set(c.blockId, [...(this.comments.get(c.blockId) ?? []), ...c.text.split(/\r\n|\r|\n/)]);
  }

  warn(msg: string, needle?: string) { if (!this.quiet) this.warns.push({ msg, needle }); }

  // ---------- declarations ----------

  addVar(id: string, name: string, value: any, list: boolean, global: boolean, cloud = false): Var {
    const v: Var = { ident: unique(cloud ? name.replace(/^☁\s*/, "") : name, global ? this.p.globalScope : this.scope), name, list, global, cloud, value };
    if (list) for (const x of value) widen(v, typeOfValue(x));
    else widen(v, typeOfValue(value));
    (global ? this.p.globals : this.locals).set(id, v);
    return v;
  }

  declare() {
    for (const [id, [name, value, cloud]] of Object.entries(this.t.variables ?? {}) as any) this.addVar(id, name, value, false, this.t.isStage, this.t.isStage && !!cloud);
    for (const [id, [name, value]] of Object.entries(this.t.lists ?? {}) as any) this.addVar(id, name, Array.isArray(value) ? value : [], true, this.t.isStage);
  }

  declareProcs() {
    for (const b of Object.values(this.blocks)) {
      if (b?.opcode !== "procedures_definition") continue;
      const proto = this.blocks[b.inputs?.custom_block?.[1]];
      const m = proto?.mutation;
      if (!m || this.procs.has(m.proccode)) continue;
      const label = m.proccode.replace(/%[snb]/g, " ").trim();
      const ids: string[] = JSON.parse(m.argumentids ?? "[]");
      const names: string[] = JSON.parse(m.argumentnames ?? "[]");
      const kinds = (m.proccode.match(/%[snb]/g) ?? []).map((k: string) => k[1]);
      this.procs.set(m.proccode, { ident: unique(label, this.scope), proccode: m.proccode, ids, params: [], warp: m.warp === true || m.warp === "true" });
      this.procs.get(m.proccode)!.params = names.map((name, i) => ({ name, ident: "", kind: kinds[i] ?? "s", t: kinds[i] === "n" ? "n" : kinds[i] === "b" ? "b" : undefined }));
    }
    for (const p of this.procs.values()) {
      const local = new Set(this.scope);
      for (const a of p.params) a.ident = unique(a.name, local);
    }
    for (const id of this.scripts()) {
      const b = this.blocks[id];
      if (!this.hatOf(b) && HATLIKE.test(b.opcode)) this.hatNames.set(id, unique("unsupported " + b.opcode, this.scope));
    }
  }

  /** Top-level scripts in vertical order. */
  scripts() {
    return Object.entries(this.blocks)
      .filter(([, b]) => b && !Array.isArray(b) && b.topLevel && !b.shadow)
      .sort(([, a], [, b]) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
      .map(([id]) => id);
  }

  // ---------- references ----------

  varOf(field: [string, string] | undefined, list: boolean): Var {
    const [name, id] = field ?? ["", ""];
    const find = (m: Map<string, Var>) => m.get(id) ?? [...m.values()].find((v) => v.name === name && v.list === list);
    let v = find(this.locals) ?? find(this.p.globals);
    if (!v) {
      v = this.addVar(id, name || "unnamed", list ? [] : 0, list, false);
      this.p.warnings.push(`${this.file}: ${list ? "list" : "variable"} '${name}' doesn't exist; declared it in this file`);
    }
    return v;
  }

  ref(v: Var) {
    if (!v.global) return v.ident;
    const obj = v.cloud ? "cloud" : "game";
    this.used.add(obj);
    return `${obj}.${v.ident}`;
  }

  // ---------- expressions ----------

  lit(text: string): Ex { return { ...natural(text), lit: text }; }

  /** An input's expression, uncoerced. */
  input(b: any, name: string): Ex {
    const inp = b.inputs?.[name];
    if (!inp) return this.lit("");
    const ref = inp[1] ?? inp[2];
    if (ref == null) return this.lit("");
    if (Array.isArray(ref)) {
      if (ref[0] === 12 || ref[0] === 13) return this.varEx(this.varOf([ref[1], ref[2]], ref[0] === 13));
      return this.lit(String(ref[1] ?? ""));
    }
    const blk = this.blocks[ref];
    if (!blk) return this.lit("");
    if (blk.shadow) return this.lit(String((Object.values(blk.fields ?? {})[0] as any)?.[0] ?? ""));
    return this.expr(ref);
  }

  /** Is this input a (non-shadow) block with this opcode? Returns the block. */
  inBlock(b: any, name: string, ...ops: string[]) {
    const ref = b.inputs?.[name]?.[1];
    const blk = typeof ref === "string" ? this.blocks[ref] : null;
    return blk && !blk.shadow && ops.includes(blk.opcode) ? blk : null;
  }

  arg(b: any, name: string, w: W): Ex { return this.coerce(this.input(b, name), w); }

  coerce(e: Ex, w: W): Ex {
    if (e.lit !== undefined) {
      const text = e.lit;
      if (w === "n") return numLike(text) ? num(text) : num("0");
      if (w === "N") return numLike(text) ? num(text) : cast(natural(text));
      if (w === "s" || w === "S") return { c: str(text), p: PRIM, t: "s" };
      if (w === "B") return text === "" ? { c: "false", p: PRIM, t: "b" } : natural(text).t === "b" ? natural(text) : cast(natural(text));
      return natural(text);
    }
    if (w === "v" || e.t === "a" || e.t === w.toLowerCase()) return e;
    if (w === "n") return { c: `Number(${e.c})`, p: PRIM, t: "n" };
    if (w === "s") return { c: `String(${e.c})`, p: PRIM, t: "s" };
    return cast(e);
  }

  /** Wanted type for a value going into something of type t (a variable, parameter or list item). */
  wantFor(t: T | undefined): W { return t === "n" ? "N" : t === "s" ? "S" : t === "b" ? "B" : "v"; }

  varEx(v: Var): Ex {
    // the compiler turns a list used as a value back into Scratch's "list contents" reporter
    if (v.list) return { c: `(${this.ref(v)} as any)`, p: PRIM, t: "a" };
    return { c: this.ref(v), p: PRIM, t: v.t ?? "a" };
  }

  unsupported(op: string): Ex {
    this.warn(`unsupported block '${op}'`, op);
    return { c: `/* unsupported: ${op} */ (0 as any)`, p: PRIM, t: "a" };
  }

  /** 1-based Scratch index -> 0-based TypeScript index. */
  index(b: any, name: string, list?: string): Ex {
    const e = this.input(b, name);
    if (e.lit !== undefined) {
      if (list && e.lit === "last") return { c: `${list}.length - 1`, p: ADD, t: "n" };
      if (list && (e.lit === "random" || e.lit === "any")) return { c: `random(0, ${list}.length - 1)`, p: PRIM, t: "n" };
      return num(String((numLike(e.lit) ? Number(e.lit) : 0) - 1));
    }
    const add = this.inBlock(b, name, "operator_add");
    if (add) {
      if (this.input(add, "NUM2").lit === "1") return this.arg(add, "NUM1", "n");
      if (this.input(add, "NUM1").lit === "1") return this.arg(add, "NUM2", "n");
    }
    return bin(this.coerce(e, "n"), "-", num("1"), ADD, "n");
  }

  /** Make two compared operands type-compatible for TypeScript without changing the blocks. */
  compare(b: any, op: string, p: number): Ex {
    let x = this.input(b, "OPERAND1"), y = this.input(b, "OPERAND2");
    const fit = (l: Ex, other: Ex): Ex => {
      if (other.t === "a") return natural(l.lit!);
      if (other.t === "n") return NUM.test(l.lit!) ? num(l.lit!) : cast(natural(l.lit!));
      if (other.t === "s") return { c: str(l.lit!), p: PRIM, t: "s" };
      return cast(natural(l.lit!));
    };
    if (x.lit !== undefined && y.lit === undefined) x = fit(x, y);
    else if (y.lit !== undefined && x.lit === undefined) y = fit(y, x);
    else if (x.lit !== undefined && y.lit !== undefined) x = cast(natural(x.lit)); // two literals never "overlap" for TypeScript
    else if (x.t !== y.t && x.t !== "a" && y.t !== "a") y = cast(y);
    // inside `if (x === "a")` TypeScript narrows x to "a", so comparing it to "b" there would be an error
    if (p === EQ) { if (this.narrowed.has(x.c)) x = cast(x); if (this.narrowed.has(y.c)) y = cast(y); }
    if (p === REL) { if (x.t === "b") x = cast(x); if (y.t === "b") y = cast(y); }
    return bin(x, op, y, p, "b");
  }

  expr(id: string): Ex {
    const b = this.blocks[id];
    const op: string = b.opcode;
    const arith = (sym: string, p: number) => bin(this.arg(b, "NUM1", "n"), sym, this.arg(b, "NUM2", "n"), p, "n");
    switch (op) {
      case "data_variable": return this.varEx(this.varOf(b.fields?.VARIABLE, false));
      case "data_listcontents": return this.varEx(this.varOf(b.fields?.LIST, true));
      case "argument_reporter_string_number":
      case "argument_reporter_boolean": {
        const name = b.fields?.VALUE?.[0];
        const a = this.proc?.params.find((x) => x.name === name);
        if (!a) {
          this.warn(`'${name}' is a custom block input used outside its block`, "unsupported: argument");
          return { c: "/* unsupported: argument */ (0 as any)", p: PRIM, t: "a" };
        }
        return { c: a.ident, p: PRIM, t: a.kind === "b" ? "b" : a.kind === "n" ? "n" : a.t === "b" ? "a" : a.t ?? "a" };
      }
      case "operator_add": return arith("+", ADD);
      case "operator_subtract": {
        const n1 = this.input(b, "NUM1");
        if (n1.lit === "0") {
          const x = this.arg(b, "NUM2", "n");
          return { c: x.c.startsWith("-") || x.p < UNARY ? `-(${x.c})` : `-${x.c}`, p: UNARY, t: "n" };
        }
        const idx = this.inBlock(b, "NUM1", "data_itemnumoflist");
        if (idx && this.input(b, "NUM2").lit === "1") return this.indexOf(idx);
        return arith("-", ADD);
      }
      case "operator_multiply": return arith("*", MUL);
      case "operator_divide": return arith("/", MUL);
      case "operator_mod": return arith("%", MUL);
      case "operator_lt": return this.compare(b, "<", REL);
      case "operator_gt": return this.compare(b, ">", REL);
      case "operator_equals": return this.compare(b, "===", EQ);
      case "operator_and":
      case "operator_or":
        return bin(this.arg(b, "OPERAND1", "B"), op === "operator_and" ? "&&" : "||", this.arg(b, "OPERAND2", "B"), op === "operator_and" ? AND : OR, "b");
      case "operator_not": {
        const e = this.input(b, "OPERAND");
        if (e.lit !== undefined) return { c: "true", p: PRIM, t: "b" }; // not <empty>
        const inner = this.inBlock(b, "OPERAND", "operator_lt", "operator_gt", "operator_equals");
        if (inner) return this.compare(inner, { operator_lt: ">=", operator_gt: "<=", operator_equals: "!==" }[inner.opcode as string]!, inner.opcode === "operator_equals" ? EQ : REL);
        return { c: `!${par(e, UNARY)}`, p: UNARY, t: "b" };
      }
      case "operator_join": {
        const parts: (string | Ex)[] = [];
        const walk = (blk: any) => {
          for (const k of ["STRING1", "STRING2"]) {
            const j = this.inBlock(blk, k, "operator_join");
            if (j) { walk(j); continue; }
            const e = this.input(blk, k);
            parts.push(e.lit !== undefined ? e.lit : e);
          }
        };
        walk(b);
        if (parts.every((x) => typeof x === "string")) return { c: str(parts.join("")), p: PRIM, t: "s" };
        const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        return { c: "`" + parts.map((x) => (typeof x === "string" ? esc(x) : "${" + x.c + "}")).join("") + "`", p: PRIM, t: "s" };
      }
      case "operator_letter_of": return { c: `${par(this.strict(this.input(b, "STRING")), PRIM)}[${this.index(b, "LETTER").c}]`, p: PRIM, t: "s" };
      case "operator_length": return { c: `${par(this.strict(this.input(b, "STRING")), PRIM)}.length`, p: PRIM, t: "n" };
      case "operator_contains": return { c: `${par(this.strict(this.input(b, "STRING1")), PRIM)}.includes(${this.arg(b, "STRING2", "S").c})`, p: PRIM, t: "b" };
      case "operator_round": return { c: `Math.round(${this.arg(b, "NUM", "n").c})`, p: PRIM, t: "n" };
      case "operator_mathop": {
        const f = b.fields?.OPERATOR?.[0];
        const x = this.arg(b, "NUM", "n");
        if (f === "log") return { c: `Math.log(${x.c}) / Math.log(10)`, p: MUL, t: "n" }; // lib.es5 has no Math.log10
        if (R_MATH[f]) return { c: `${R_MATH[f]}(${x.c})`, p: PRIM, t: "n" };
        if (f === "10 ^") return { c: `Math.exp(${par(x, MUL)} * Math.log(10))`, p: PRIM, t: "n" };
        return this.unsupported(`operator_mathop ${f}`);
      }
      case "operator_random": {
        const from = this.input(b, "FROM"), to = this.input(b, "TO");
        if (from.lit === "0" && to.lit === "1.0") return { c: "Math.random()", p: PRIM, t: "n" };
        // "1.0" picks a decimal; a plain 1.0 in TypeScript would lose that
        const lim = (e: Ex) => (e.lit !== undefined && e.lit.includes(".") && Number.isInteger(Number(e.lit)) ? cast(natural(e.lit)) : this.coerce(e, "n"));
        return { c: `random(${lim(from).c}, ${lim(to).c})`, p: PRIM, t: "n" };
      }
      case "data_itemoflist": {
        const v = this.varOf(b.fields?.LIST, true);
        const L = this.ref(v);
        return { c: `${L}[${this.index(b, "INDEX", L).c}]`, p: PRIM, t: v.t ?? "a" };
      }
      case "data_itemnumoflist": { const e = this.indexOf(b); return { c: `${e.c} + 1`, p: ADD, t: "n" }; }
      case "data_lengthoflist": return { c: `${this.ref(this.varOf(b.fields?.LIST, true))}.length`, p: PRIM, t: "n" };
      case "data_listcontainsitem": {
        const v = this.varOf(b.fields?.LIST, true);
        return { c: `${this.ref(v)}.includes(${this.arg(b, "ITEM", this.wantFor(v.t)).c})`, p: PRIM, t: "b" };
      }
    }
    const r = pick(R_REPORT.get(op), b);
    if (r) {
      if (r.name.startsWith("me.")) return { c: r.name, p: PRIM, t: STR_REPORTERS.has(r.name) ? "s" : "n" };
      const call = `${r.name}(${this.args(b, r.spec).join(", ")})`;
      if (r.name === "valueOf") return { c: `(${call} as any)`, p: PRIM, t: "a" };
      return { c: call, p: PRIM, t: BOOL_REPORTERS.has(r.name) ? "b" : STR_REPORTERS.has(r.name) ? "s" : "n" };
    }
    return this.unsupported(op);
  }

  /** A string for .includes / [i] / .length: TypeScript (and the compiler) must see a string type. */
  strict(e: Ex): Ex {
    if (e.lit !== undefined) return { c: str(e.lit), p: PRIM, t: "s" };
    return e.t === "s" ? e : { c: `String(${e.c})`, p: PRIM, t: "s" };
  }

  indexOf(b: any): Ex {
    const v = this.varOf(b.fields?.LIST, true);
    return { c: `${this.ref(v)}.indexOf(${this.arg(b, "ITEM", this.wantFor(v.t)).c})`, p: PRIM, t: "n" };
  }

  /** Positional TypeScript arguments for a table entry; trailing defaults are dropped. */
  args(b: any, spec: Spec): string[] {
    const out = (spec.args ?? []).map((a: Arg) => {
      if ("f" in a) {
        const v = String(b.fields?.[a.f]?.[0] ?? "");
        return { c: this.fieldLit(a.map ? v.toLowerCase() : v, a.f), def: false };
      }
      if ("menu" in a) return this.menu(b, a);
      return { c: this.arg(b, a.i, SLOT_W[a.s]).c, def: false };
    });
    while (out.length && out[out.length - 1].def) out.pop();
    return out.map((x) => x.c);
  }

  /** A field value as a string literal; values TypeScript would reject (unknown keys, missing names) are cast. */
  fieldLit(v: string, field: string, kind?: keyof Proj["names"] | "key") {
    kind ??= field === "KEY_OPTION" ? "key" : field === "BACKDROP" ? "backdrop" : undefined;
    const ok = !kind || (kind === "key" ? KEY.test(v) : this.p.names[kind].has(v));
    return ok ? str(v) : `(${str(v)} as any)`;
  }

  menu(b: any, a: Extract<Arg, { menu: any }>): { c: string; def: boolean } {
    const ref = b.inputs?.[a.i]?.[1];
    const sh = typeof ref === "string" ? this.blocks[ref] : null;
    if (sh?.shadow || !b.inputs?.[a.i]) {
      const raw = String(sh?.fields?.[a.menu[1]]?.[0] ?? a.def ?? "");
      const rev = Object.entries(a.sp ?? {}).find(([, v]) => v === raw)?.[0];
      const kind = ({ looks_costume: "costume", looks_backdrops: "backdrop", sound_sounds_menu: "sound", sensing_keyoptions: "key" } as const)[a.menu[0] as string];
      if (rev) return { c: str(rev), def: rev === a.def };
      return { c: this.fieldLit(raw, a.menu[1], kind ?? (a.sp ? "sprite" : undefined)), def: false };
    }
    return { c: cast(this.input(b, a.i)).c, def: false };
  }

  // ---------- statements ----------

  stack(id: string | null | undefined, ind: number): string[] {
    const out: string[] = [];
    for (let cur = id; cur && this.blocks[cur]; cur = this.blocks[cur].next) out.push(...this.note(cur, ind), ...this.stmt(cur, ind));
    return out;
  }

  note(id: string, ind: number) { return (this.comments.get(id) ?? []).map((l) => "  ".repeat(ind) + "// " + l); }

  body(b: any, name: string, ind: number) { return this.stack(b.inputs?.[name]?.[1], ind + 1); }

  cond(b: any, name: string) {
    const e = this.input(b, name);
    return e.lit !== undefined ? "false" : e.c;
  }

  ifLines(b: any, ind: number): string[] {
    const L = (s: string) => "  ".repeat(ind) + s;
    const cond = this.cond(b, "CONDITION");
    const narrow = cond.match(/^(.+?) === ("[^"]*"|-?[\d.]+|true|false)$/)?.[1];
    const fresh = narrow && !this.narrowed.has(narrow);
    if (fresh) this.narrowed.add(narrow);
    let then: string[];
    try { then = this.body(b, "SUBSTACK", ind); } finally { if (fresh) this.narrowed.delete(narrow); }
    const out = [L(`if (${cond}) {`), ...then];
    if (b.opcode === "control_if_else") {
      const sub = this.blocks[b.inputs?.SUBSTACK2?.[1]];
      if (sub && !sub.next && (sub.opcode === "control_if" || sub.opcode === "control_if_else") && !this.comments.has(b.inputs.SUBSTACK2[1])) {
        const nested = this.ifLines(sub, ind);
        return [...out, L(`} else ${nested[0].trimStart()}`), ...nested.slice(1)];
      }
      out.push(L("} else {"), ...this.body(b, "SUBSTACK2", ind));
    }
    return [...out, L("}")];
  }

  stmt(id: string, ind: number): string[] {
    const b = this.blocks[id];
    const op: string = b.opcode;
    const L = (s: string) => "  ".repeat(ind) + s;
    const block = (head: string, name = "SUBSTACK", tail = "}") => [L(head), ...this.body(b, name, ind), L(tail)];
    const step = (lhs: string, e: Ex) => (e.p === UNARY && e.c.startsWith("-") ? `${lhs} -= ${e.c.slice(1)};` : `${lhs} += ${e.c};`);
    switch (op) {
      case "control_if":
      case "control_if_else": return this.ifLines(b, ind);
      case "control_repeat": return block(`repeat(${this.arg(b, "TIMES", "n").c}, () => {`, "SUBSTACK", "});");
      case "control_forever": return block("forever(() => {", "SUBSTACK", "});");
      case "control_while": return block(`while (${this.cond(b, "CONDITION")}) {`);
      case "control_repeat_until": {
        const e = this.input(b, "CONDITION");
        const not = this.inBlock(b, "CONDITION", "operator_not");
        if (e.lit !== undefined) return block("while (true) {");
        if (not && this.input(not, "OPERAND").lit === undefined) return block(`while (${this.input(not, "OPERAND").c}) {`);
        return block(`while (!${par(e, UNARY)}) {`);
      }
      case "control_wait_until": return [L(`waitUntil(() => ${this.arg(b, "CONDITION", "B").c});`)];
      case "control_stop": {
        const o = b.fields?.STOP_OPTION?.[0];
        return [L(o === "all" ? "stopAll();" : o === "this script" ? "stopThis();" : "stopOthers();")];
      }
      case "data_setvariableto": {
        const v = this.varOf(b.fields?.VARIABLE, false);
        const e = this.input(b, "VALUE");
        if (widen(v, e.t)) this.p.changed = true;
        return [L(`${this.ref(v)} = ${this.coerce(e, this.wantFor(v.t)).c};`)];
      }
      case "data_changevariableby": {
        const v = this.varOf(b.fields?.VARIABLE, false);
        if (widen(v, "n")) this.p.changed = true;
        return [L(step(this.ref(v), this.arg(b, "VALUE", "n")))];
      }
      case "data_showvariable": case "data_hidevariable": case "data_showlist": case "data_hidelist": {
        const v = this.varOf(op.endsWith("list") ? b.fields?.LIST : b.fields?.VARIABLE, op.endsWith("list"));
        let extra = "";
        if (op.includes("show")) {
          const mon = (this.p.json?.monitors ?? []).find((m: any) => {
            const mv = m.params?.VARIABLE ?? m.params?.LIST;
            return mv === v.name || (typeof mv === "string" && mv.split(/\s/)[0] === v.name);
          });
          if (mon) {
            const parts = [`x: ${mon.x}`, `y: ${mon.y}`, `sliderMin: ${mon.sliderMin}`, `sliderMax: ${mon.sliderMax}`, `visible: ${!!mon.visible}`, `slider: ${mon.mode === "slider"}`];
            extra = `, { ${parts.join(", ")} }`;
          }
        }
        return [L(`${op.includes("show") ? "showVariable" : "hideVariable"}(${this.ref(v)}${extra});`)];
      }
      case "data_addtolist": case "data_insertatlist": case "data_replaceitemoflist": case "data_deleteoflist": case "data_deletealloflist": {
        const v = this.varOf(b.fields?.LIST, true);
        const ls = this.ref(v);
        const item = () => {
          const e = this.input(b, "ITEM");
          if (widen(v, e.t)) this.p.changed = true;
          return this.coerce(e, this.wantFor(v.t)).c;
        };
        const at = this.input(b, "INDEX").lit;
        if (op === "data_deletealloflist") return [L(`${ls}.length = 0;`)];
        if (op === "data_addtolist") return [L(`${ls}.push(${item()});`)];
        if (op === "data_insertatlist") return [L(at === "last" ? `${ls}.push(${item()});` : `${ls}.insert(${at === "random" || at === "any" ? `random(0, ${ls}.length)` : this.index(b, "INDEX", ls).c}, ${item()});`)];
        if (op === "data_replaceitemoflist") return [L(`${ls}[${this.index(b, "INDEX", ls).c}] = ${item()};`)];
        if (at === "all") return [L(`${ls}.length = 0;`)];
        if (at === "last") return [L(`${ls}.pop();`)];
        return [L(`${ls}.remove(${this.index(b, "INDEX", ls).c});`)];
      }
      case "procedures_call": {
        const p = this.procs.get(b.mutation?.proccode);
        if (!p) {
          this.warn(`call to custom block "${b.mutation?.proccode}" which isn't defined in this sprite`, "unsupported: call");
          return [L(`// unsupported: call to undefined block ${str(b.mutation?.proccode ?? "")}`)];
        }
        const ids: string[] = JSON.parse(b.mutation.argumentids ?? "[]");
        const args = p.params.map((a, i) => {
          const e = this.input(b, ids[i] ?? p.ids[i]);
          if (a.kind === "s" && widen(a, e.t)) this.p.changed = true;
          return this.coerce(e, a.kind === "b" ? "B" : a.kind === "n" ? "N" : a.t === "b" ? "v" : this.wantFor(a.t)).c;
        });
        return [L(`${p.ident}(${args.join(", ")});`)];
      }
      case "looks_show": return [L("me.visible = true;")];
      case "looks_hide": return [L("me.visible = false;")];
      case "motion_setrotationstyle": return [L(`me.rotationStyle = ${str(b.fields?.STYLE?.[0] ?? "all around")};`)];
      case "sensing_setdragmode": return [L(`me.draggable = ${b.fields?.DRAG_MODE?.[0] === "draggable"};`)];
    }
    const r = pick(R_STACK.get(op), b);
    if (r) return [L(`${r.name}(${this.args(b, r.spec).join(", ")});`)];
    if (R_SET[op]) return [L(`me.${R_SET[op][0]} = ${this.arg(b, R_SET[op][1], "n").c};`)];
    if (R_CHANGE[op]) return [L(step(`me.${R_CHANGE[op][0]}`, this.arg(b, R_CHANGE[op][1], "n")))];
    this.warn(`unsupported block '${op}'`, `unsupported: ${op}`);
    return [L(`// unsupported: ${op}`)];
  }

  // ---------- scripts ----------

  hatOf(b: any): { name: string; args: string[] } | null {
    if (b.opcode === "event_whenthisspriteclicked" || b.opcode === "event_whenstageclicked") return { name: "whenClicked", args: [] };
    if (b.opcode === "event_whenbroadcastreceived") return { name: "onMessage", args: [str(b.fields?.BROADCAST_OPTION?.[0] ?? "")] };
    const r = pick(R_HATS.get(b.opcode), b);
    return r ? { name: r.name, args: this.args(b, r.spec) } : null;
  }

  script(id: string): string[] {
    const b = this.blocks[id];
    if (b.opcode === "procedures_definition") {
      const m = this.blocks[b.inputs?.custom_block?.[1]]?.mutation;
      const p = this.procs.get(m?.proccode);
      if (!p) return [];
      this.proc = p;
      try {
        const params = p.params.map((a) => `${a.ident}: ${a.kind === "b" ? "boolean" : a.kind === "n" ? "number" : a.t === "b" ? "any" : tsType(a.t)}`);
        const label = p.proccode.replace(/ %[snb]/g, "").replace(/%[snb]/g, "").trim();
        const renamed = [...(label !== p.ident ? [`"${p.proccode}"`] : []), ...p.params.filter((a) => a.ident !== a.name).map((a) => `${a.ident} = "${a.name}"`)];
        return [
          ...this.note(id, 0),
          ...(renamed.length ? [`// custom block ${renamed.join(", ")}`] : []),
          ...(p.warp ? ["/** @warp */"] : []),
          `function ${p.ident}(${params.join(", ")}) {`,
          ...this.stack(b.next, 1),
          "}",
        ];
      } finally { this.proc = null; }
    }
    const hat = this.hatOf(b);
    if (!hat) {
      const name = this.hatNames.get(id)!;
      this.warn(`unsupported event '${b.opcode}': its script was kept as function ${name}() (never called)`, `function ${name}(`);
      return [...this.note(id, 0), `// unsupported: ${b.opcode}`, `function ${name}() {`, ...this.stack(b.next, 1), "}"];
    }
    return [...this.note(id, 0), `${hat.name}(${[...hat.args, "() => {"].join(", ")}`, ...this.stack(b.next, 1), "});"];
  }

  /** All scripts, as blank-line separated chunks. */
  scriptsCode(): string[][] {
    const out: string[][] = [];
    let loose = 0;
    for (const id of this.scripts()) {
      const b = this.blocks[id];
      if (!this.hatOf(b) && b.opcode !== "procedures_definition" && !HATLIKE.test(b.opcode)) { loose++; continue; }
      out.push(this.script(id));
    }
    if (loose) this.warn(`${loose} loose block stack(s) without an event were skipped (they never run)`);
    return out;
  }

  // ---------- output ----------

  /** `let x = 0;` for a local, `x: 0,` for a property of the stage's state object. */
  decl(v: Var, prop: boolean): string {
    const lit = (x: any, t: T | undefined) =>
      t === "n" ? num(numLike(String(x)) ? String(x) : "0").c
      : t === "s" ? str(String(x))
      : t === "b" ? String(x === true || x === "true")
      : typeof x === "boolean" ? String(x) : natural(String(x)).c;
    // keep the exact Scratch name when the identifier differs: other sprites may read it with valueOf(sprite, name)
    const tag = v.ident !== v.name.replace(/^☁\s*/, "") ? `/** @name ${v.name} */ ` : "";
    if (v.list) {
      const items = `[${(v.value as any[]).map((x) => lit(x, v.t)).join(", ")}]`;
      return prop ? `  ${tag}${v.ident}: ${items} as ${tsType(v.t)}[],` : `${tag}let ${v.ident}: ${tsType(v.t)}[] = ${items};`;
    }
    const value = lit(v.value, v.cloud ? "n" : v.t);
    const any = !value.endsWith("as any)") && (v.t === "a" || (v.cloud && v.t !== "n")) ? " as any" : "";
    if (prop) return `  ${tag}${v.ident}: ${value}${any},`;
    return `${tag}let ${v.ident}${v.t === "a" ? ": any" : ""} = ${value};`;
  }

  source(): string {
    this.used.clear();
    this.quiet = false;
    const chunks = this.scriptsCode();
    const head = ["// Converted from Scratch blocks by TextToScratch."];
    if (this.t.isStage) {
      const all = [...this.p.globals.values()];
      const plain = all.filter((v) => !v.cloud), cloud = all.filter((v) => v.cloud);
      head.push("", "// Global variables and lists: other sprites use them as game.<name>.");
      head.push(plain.length ? ["export const game = {", ...plain.map((v) => this.decl(v, true)), "};"].join("\n") : "export const game = {};");
      if (cloud.length) head.push("", "/** @cloud */", ["export const cloud = {", ...cloud.map((v) => this.decl(v, true)), "};"].join("\n"));
    } else {
      const imports = [...this.used].sort();
      if (imports.length) head.push(`import { ${imports.join(", ")} } from "./Stage";`);
      if (this.locals.size) head.push("", ...[...this.locals.values()].map((v) => this.decl(v, false)));
    }
    if (this.t.isStage && this.locals.size) head.push("", ...[...this.locals.values()].map((v) => this.decl(v, false)));
    const text = [head.join("\n"), ...chunks.map((c) => c.join("\n"))].join("\n\n") + "\n";
    const lines = text.split("\n");
    const from = new Map<string, number>();
    for (const w of this.warns) {
      const start = from.get(w.needle ?? "") ?? 0;
      const i = w.needle ? lines.findIndex((l, j) => j >= start && l.includes(w.needle!)) : -1;
      if (w.needle && i >= 0) from.set(w.needle, i + 1);
      this.p.warnings.push(i >= 0 ? `${this.file}:${i + 1}: ${w.msg}` : `${this.file}: ${w.msg}`);
    }
    return text;
  }
}

/** Convert a project's blocks into TextToScratch sources: one file per sprite plus Stage.ts. Never throws on unknown blocks. */
export function decompile(json: any): DecompileResult {
  const p = new Proj(json);
  const stage = json.targets.find((t: any) => t.isStage) ?? { isStage: true, name: "Stage", blocks: {}, variables: {}, lists: {} };
  const decs = [stage, ...json.targets.filter((t: any) => !t.isStage)].map((t) => {
    let name = t.isStage ? "Stage" : String(t.name);
    if (/[\/\\]/.test(name)) {
      p.warnings.push(`Sprite '${name}' has a slash in its name; its file is named without it, so building will create a new sprite`);
      name = name.replace(/[\/\\]/g, "_");
    }
    return new Dec(p, t, name + ".ts");
  });
  decs.forEach((d) => d.declare());
  decs.forEach((d) => d.declareProcs());
  // infer variable / list / parameter types: emit quietly until no type changes
  for (let i = 0; i < 10; i++) {
    p.changed = false;
    decs.forEach((d) => d.scriptsCode());
    if (!p.changed) break;
  }
  // sprites first: they decide which globals exist (missing ones are declared on the fly)
  const sources: Record<string, string> = {};
  for (const d of decs.slice(1)) sources[d.file] = d.source();
  sources[decs[0].file] = decs[0].source();
  return { sources: { [decs[0].file]: sources[decs[0].file], ...sources }, warnings: p.warnings };
}
