import ts from "typescript";
import { Arg, HATS, MATHOP, PROPS, REPORT, SHADOW, Slot, Spec, STACK } from "./api";

/** code: set on TypeScript type errors (editors show those already), unset on TextToScratch compile errors */
export interface Diag { file: string; line: number; col: number; message: string; code?: number }
export interface VarInfo { name: string; id: string; list: boolean; value: any; global: boolean; cloud?: boolean; monitor?: { x: number; y: number; sliderMin: number; sliderMax: number; visible?: boolean; slider?: boolean } }
/** An object created with `new` at the top level: fields are variables, methods are compiled per object. */
interface Instance { name: string; cls: ts.ClassDeclaration; fields: Map<string, VarInfo>; global: boolean }
type FnDecl = ts.FunctionDeclaration | ts.MethodDeclaration;
interface ProcInfo { name: string; proccode: string; ids: string[]; names: string[]; bools: boolean[]; warp: boolean; decl: FnDecl }
type Op = { t: "lit"; v: string | number | boolean } | { t: "blk"; id: string } | { t: "var"; k: 12 | 13; name: string; vid: string };
type Fields = Record<string, [string, string | null]>;

class CErr extends Error {
  constructor(public node: ts.Node, msg: string) { super(msg); }
}
const fail = (node: ts.Node, msg: string): never => { throw new CErr(node, msg); };

const MUT = (o: Record<string, string>) => ({ tagName: "mutation", children: [], ...o });
const isExported = (n: ts.Node) => !!ts.getCombinedModifierFlags(n as ts.Declaration) && (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
/** The Scratch name from a `@name` JSDoc tag, if any. */
const scratchName = (n: ts.Node) => {
  const t = ts.getJSDocTags(n).find((t) => t.tagName.text === "name");
  return (t && ts.getTextOfJSDocComment(t.comment)?.trim()) || undefined;
};

/** Literal value of an initializer, or undefined when not a compile-time literal. */
function literal(e: ts.Expression | undefined): any {
  if (!e) return undefined;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text);
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return literal(e.expression);
  if (ts.isArrayLiteralExpression(e)) {
    const vals = e.elements.map((x) => literal(x));
    return vals.some((v) => v === undefined || Array.isArray(v)) ? undefined : vals;
  }
  return undefined;
}

/** Shared state across all targets of one build. */
export class Ctx {
  diags: Diag[] = [];
  globals = new Map<ts.Node, VarInfo>();
  /** exported objects (`export const boss = new Enemy()`): their fields are global variables */
  globalInstances = new Map<ts.Node, Instance>();
  consts = new Map<ts.Node, string | number | boolean>();
  globalNames = new Set<string>();
  broadcasts = new Map<string, string>();
  extensions = new Set<string>();
  /** Library modules (engine, src/lib): their functions and state are compiled into each sprite that uses them. */
  libs = new Set<ts.SourceFile>();
  constructor(public checker: ts.TypeChecker) {}

  isLib(node: ts.Node) { return this.libs.has(node.getSourceFile()); }
  modName(node: ts.Node) { return node.getSourceFile().fileName.split("/").pop()!.replace(/\.ts$/, ""); }

  /** Register a library: its literal constants are inlined; anything else at top level must be a declaration. */
  addLib(sf: ts.SourceFile) {
    this.libs.add(sf);
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st)) {
        if (st.declarationList.flags & ts.NodeFlags.Const)
          for (const d of st.declarationList.declarations) {
            const v = literal(d.initializer);
            if (v !== undefined && !Array.isArray(v)) this.consts.set(d, v);
          }
      } else if (!ts.isFunctionDeclaration(st) && !ts.isClassDeclaration(st) && !ts.isImportDeclaration(st) && !ts.isTypeAliasDeclaration(st) && !ts.isInterfaceDeclaration(st) && !ts.isExportDeclaration(st)) {
        this.report(st, "Library files can only contain declarations (no events): call library functions from a sprite");
      }
    }
  }

  report(node: ts.Node, message: string) {
    const sf = node.getSourceFile();
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
    this.diags.push({ file: sf.fileName, line: line + 1, col: character + 1, message });
  }
  broadcast(name: string) {
    if (!this.broadcasts.has(name)) this.broadcasts.set(name, "msg_" + name);
    return this.broadcasts.get(name)!;
  }
}

export class Target {
  blocks: Record<string, any> = {};
  vars = new Map<ts.Node, VarInfo>();
  names = new Set<string>();
  procs = new Map<ts.Node, ProcInfo>();
  /** variables used with show/hideVariable: they need a monitor entry in project.json */
  monitored = new Set<VarInfo>();
  private n = 0;
  private pre: string[] = [];
  private retUsed = 0;
  private proc: ProcInfo | null = null;
  private y = 0;

  constructor(public ctx: Ctx, public name: string, public isStage: boolean, public file: ts.SourceFile, private prefix: string) {}

  // ---------- declaration pass ----------

  /** Pass 1 (globals) / pass 2 (locals + procs): register top-level declarations. */
  declare(pass: 1 | 2) {
    for (const st of this.file.statements) {
      if (ts.isVariableStatement(st)) {
        const exp = isExported(st) || this.isStage;
        if (exp !== (pass === 1)) continue;
        const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
        for (const d of st.declarationList.declarations) this.guard(() => this.declareVar(d, isConst, exp));
      } else if (pass === 2 && ts.isFunctionDeclaration(st)) {
        this.guard(() => this.declareProc(st));
      }
    }
  }

  // `/** @name nextCostume # */ let nextCostume = 0;` keeps a Scratch name that isn't a valid identifier
  private declareVar(d: ts.VariableDeclaration, isConst: boolean, global: boolean) {
    if (!ts.isIdentifier(d.name)) fail(d, "Destructuring is not supported");
    const name = (d.name as ts.Identifier).text;
    if (d.initializer && ts.isNewExpression(d.initializer)) return void this.declareInstance(d, global);
    if (d.initializer && ts.isObjectLiteralExpression(d.initializer)) {
      // `const game = { score: 0, items: [] as number[] }` -> one Scratch variable per property
      // `/** @cloud */ export const net = { a: 0 }` -> cloud variables (numbers only, stored on the stage)
      const cloud = ts.getJSDocTags(d).some((t) => t.tagName.text === "cloud");
      if (cloud && !global) fail(d, "@cloud state must be exported (cloud variables are global)");
      for (const p of d.initializer.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) fail(p, "State objects may only contain `name: literal` properties");
        const v = this.initValue((p as ts.PropertyAssignment).initializer);
        if (v === undefined) fail(p, "State object values must be literals or constants");
        if (cloud && !(typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v)))) fail(p, "Cloud variables can only hold numbers");
        const base = (p.name as ts.Identifier).text;
        const info: VarInfo = { name: this.unique(scratchName(p) ?? (cloud ? `☁ ${base}` : base), global), id: "", list: Array.isArray(v), value: v, global, cloud };
        info.id = (global ? "g_" : this.prefix + "v_") + info.name.replace("☁ ", "cloud_");
        (global ? this.ctx.globals : this.vars).set(p, info);
      }
      return;
    }
    const val = this.initValue(d.initializer);
    if (d.initializer && val === undefined) fail(d.initializer!, "Top-level initializers must be literals or constants; assign other values inside whenFlag()");
    const list = Array.isArray(val) || this.isArray(d);
    if (isConst && !list && val !== undefined) return void this.ctx.consts.set(d, val);
    const info: VarInfo = { name: this.unique(scratchName(d) ?? name, global), id: "", list, value: val ?? (list ? [] : 0), global };
    info.id = (global ? "g_" : this.prefix + "v_") + info.name;
    (global ? this.ctx.globals : this.vars).set(d, info);
  }

  // ---------- classes ----------

  /** Objects declared in this target (or a library it uses); exported ones live in ctx.globalInstances. */
  private instances = new Map<ts.Node, Instance>();
  /** Methods compiled into this target, per object: "boss.update" etc. */
  private instMethods = new Map<Instance, Map<string, ProcInfo>>();
  /** The object `this` refers to while compiling a method. */
  private thisInst: Instance | null = null;

  private baseClass(cls: ts.ClassDeclaration): ts.ClassDeclaration | undefined {
    const ext = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    if (!ext) return undefined;
    const d = this.decl(ext.expression);
    return d && ts.isClassDeclaration(d) ? d : fail(ext, "Classes can only extend other classes");
  }

  /** Class chain from the base class down to `cls`. */
  private classChain(cls: ts.ClassDeclaration): ts.ClassDeclaration[] {
    const base = this.baseClass(cls);
    return [...(base ? this.classChain(base) : []), cls];
  }

  /** A method by name, searching from the object's own class up to its bases (so overrides win). */
  private findMethod(cls: ts.ClassDeclaration, name: string): ts.MethodDeclaration | undefined {
    for (const c of this.classChain(cls).reverse()) {
      const m = c.members.find((x) => ts.isMethodDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === name && x.body);
      if (m) return m as ts.MethodDeclaration;
    }
    return undefined;
  }

  /** Evaluate a constructor argument / field initializer at compile time. */
  private evalConst(e: ts.Expression, env: Map<string, any>): any {
    const v = this.initValue(e);
    if (v !== undefined) return v;
    if (ts.isIdentifier(e) && env.has(e.text)) return env.get(e.text);
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return this.evalConst(e.expression, env);
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) {
      const x = this.evalConst(e.operand, env);
      return typeof x === "number" ? -x : undefined;
    }
    if (ts.isBinaryExpression(e)) {
      const a = this.evalConst(e.left, env), b = this.evalConst(e.right, env);
      if (a === undefined || b === undefined) return undefined;
      switch (e.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return a + b;
        case ts.SyntaxKind.MinusToken: return a - b;
        case ts.SyntaxKind.AsteriskToken: return a * b;
        case ts.SyntaxKind.SlashToken: return a / b;
      }
    }
    return undefined;
  }

  /** `const boss = new Enemy(3, "red")`: create the object's variables with their starting values. */
  private declareInstance(d: ts.VariableDeclaration, global: boolean): Instance {
    const ne = d.initializer as ts.NewExpression;
    const cls = this.decl(ne.expression);
    if (!cls || !ts.isClassDeclaration(cls)) return fail(ne, "`new` needs a class declared in your code (or a library)");
    const objName = (d.name as ts.Identifier).text;
    const values = new Map<string, any>();
    const chain = this.classChain(cls);

    // field initializers, base class first
    for (const c of chain)
      for (const m of c.members) {
        if (!ts.isPropertyDeclaration(m) || !ts.isIdentifier(m.name)) continue;
        if (m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) fail(m, "Static fields are not supported; use a top-level const");
        let v = m.initializer ? this.evalConst(m.initializer, new Map()) : undefined;
        if (m.initializer && v === undefined) fail(m.initializer, "Field initializers must be literals or constants");
        if (v === undefined) v = this.isArray(m) ? [] : this.isBool(m) ? false : this.isStr(m) ? "" : 0;
        values.set(m.name.text, v);
      }

    // constructors: `this.field = value` and `super(...)`, evaluated at compile time
    const run = (c: ts.ClassDeclaration, args: any[]) => {
      const ctor = c.members.find(ts.isConstructorDeclaration);
      const base = this.baseClass(c);
      if (!ctor) return void (base && run(base, args));
      const env = new Map<string, any>();
      ctor.parameters.forEach((p, i) => {
        if (!ts.isIdentifier(p.name)) fail(p, "Destructured parameters are not supported");
        const pn = (p.name as ts.Identifier).text;
        const v = args[i] !== undefined ? args[i] : p.initializer ? this.evalConst(p.initializer, env) : undefined;
        if (v === undefined) fail(p, `Missing constructor argument '${pn}' (arguments must be constants)`);
        env.set(pn, v);
        if (ts.getCombinedModifierFlags(p) & (ts.ModifierFlags.Public | ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Readonly)) values.set(pn, v);
      });
      let calledSuper = false;
      for (const st of ctor.body?.statements ?? []) {
        if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression) && st.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
          calledSuper = true;
          if (base) run(base, st.expression.arguments.map((a) => this.evalConst(a, env)));
          continue;
        }
        const e = ts.isExpressionStatement(st) ? st.expression : undefined;
        if (e && ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(e.left) && e.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const v = this.evalConst(e.right, env);
          if (v === undefined) fail(e.right, "Constructors run when the project is built: assign constants or constructor arguments (do the rest in a method)");
          values.set(e.left.name.text, v);
          continue;
        }
        fail(st, "Constructors may only contain super(...) and `this.field = value` (put other logic in a method)");
      }
      if (base && !calledSuper) run(base, []);
    };
    run(cls, ne.arguments?.map((a) => {
      const v = this.evalConst(a, new Map());
      return v === undefined ? fail(a, "Constructor arguments must be constants") : v;
    }) ?? []);

    const inst: Instance = { name: objName, cls, fields: new Map(), global };
    for (const [field, v] of values) {
      const info: VarInfo = { name: this.unique(`${objName}.${field}`, global), id: "", list: Array.isArray(v), value: v, global };
      info.id = (global ? "g_" : this.prefix + "v_") + info.name;
      inst.fields.set(field, info);
      (global ? this.ctx.globals : this.vars).set(info as any, info); // registered so it is written to the project
    }
    (global ? this.ctx.globalInstances : this.instances).set(d, inst);
    return inst;
  }

  /** The object an expression refers to (`this`, `boss`, `Lib.thing`), if any. */
  private instOf(e: ts.Expression): Instance | undefined {
    if (e.kind === ts.SyntaxKind.ThisKeyword) return this.thisInst ?? fail(e, "`this` can only be used inside class methods");
    if (!ts.isIdentifier(e) && !ts.isPropertyAccessExpression(e)) return undefined;
    const d = this.decl(e);
    if (!d || !ts.isVariableDeclaration(d) || !d.initializer || !ts.isNewExpression(d.initializer)) return undefined;
    const known = this.ctx.globalInstances.get(d) ?? this.instances.get(d);
    if (known) return known;
    if (!ts.isSourceFile(d.parent.parent.parent)) return fail(d, "Create objects with `new` at the top level of a file");
    if (this.ctx.isLib(d)) return this.declareInstance(d, false); // library objects: one copy per sprite
    return fail(e, `'${e.getText()}' belongs to another sprite: export it to share it`);
  }

  /** `obj.field` / `this.field` -> the variable holding it. */
  private fieldOf(pa: ts.PropertyAccessExpression): VarInfo | undefined {
    const inst = this.instOf(pa.expression);
    return inst?.fields.get(pa.name.text);
  }

  /** `obj.method(...)` / `this.method(...)` -> that object's copy of the method (compiled on first use). */
  private methodOf(c: ts.CallExpression): ProcInfo | undefined {
    if (!ts.isPropertyAccessExpression(c.expression)) return undefined;
    const inst = this.instOf(c.expression.expression);
    if (!inst) return undefined;
    const name = c.expression.name.text;
    let map = this.instMethods.get(inst);
    if (!map) this.instMethods.set(inst, (map = new Map()));
    let p = map.get(name);
    if (!p) {
      const m = this.findMethod(inst.cls, name) ?? fail(c, `'${name}' is not a method of ${inst.cls.name?.text ?? "this class"}`);
      if (m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) fail(m, "Static methods are not supported; use a top-level function");
      p = this.makeProc(m, `${inst.name}.${name}`);
      map.set(name, p);
      this.pendingLib.push({ d: m, p, inst });
    }
    return p;
  }

  /** Compile-time value of a top-level initializer: a literal, or a reference to a literal constant. */
  private initValue(e: ts.Expression | undefined): any {
    const v = literal(e);
    if (v !== undefined || !e) return v;
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
      const d = this.decl(e);
      if (d && this.ctx.consts.has(d)) return this.ctx.consts.get(d);
    }
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) {
      const inner = this.initValue(e.operand);
      if (typeof inner === "number") return -inner;
    }
    return undefined;
  }

  private unique(base: string, global: boolean) {
    let name = base;
    for (let i = 2; this.ctx.globalNames.has(name) || this.names.has(name); i++) name = `${base}_${i}`;
    (global ? this.ctx.globalNames : this.names).add(name);
    return name;
  }

  private declareProc(f: ts.FunctionDeclaration) {
    if (!f.name || !f.body) fail(f, "Functions need a name and a body");
    // library functions are namespaced ("physics.step") so they can't clash with the sprite's own blocks
    const name = this.ctx.isLib(f) ? `${this.ctx.modName(f)}.${f.name!.text}` : f.name!.text;
    this.procs.set(f, this.makeProc(f, name));
  }

  /** A custom block for a function or method; `name` is the block's label ("physics.step", "boss.update"). */
  private makeProc(f: FnDecl, name: string): ProcInfo {
    const names = f.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : fail(p, "Destructured parameters are not supported")));
    const bools = f.parameters.map((p) => this.isBool(p));
    const warp = ts.getJSDocTags(f).some((t) => t.tagName.text === "warp");
    const proccode = [name, ...bools.map((b) => (b ? "%b" : "%s"))].join(" ");
    const ids = names.map((_, i) => `${this.prefix}${name}_a${i}`);
    return { name, proccode, ids, names, bools, warp, decl: f };
  }

  // ---------- script pass ----------

  /** Library functions and object methods this sprite uses, waiting to be compiled into it. */
  private pendingLib: { d: FnDecl; p: ProcInfo; inst: Instance | null }[] = [];

  compile() {
    for (const st of this.file.statements) {
      this.guard(() => {
        if (ts.isFunctionDeclaration(st)) return this.compileProc(st, this.procs.get(st)!, null);
        if (ts.isClassDeclaration(st)) return; // compiled per object, when its methods are used
        if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) return this.compileHat(st.expression);
        if (ts.isVariableStatement(st) || ts.isImportDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isExportDeclaration(st)) return;
        fail(st, "Top-level code must be a declaration, function, class, or event like whenFlag(() => { ... })");
      });
    }
    // compiling a library function or method can pull in more of them
    for (let job; (job = this.pendingLib.shift()); ) {
      const { d, p, inst } = job;
      this.guard(() => this.compileProc(d, p, inst));
    }
  }

  private guard(fn: () => void) {
    try { fn(); } catch (e) { if (e instanceof CErr) this.ctx.report(e.node, e.message); else throw e; }
  }

  /** Place a top-level script and give it a position. */
  private place(id: string, start: number) {
    Object.assign(this.blocks[id], { topLevel: true, x: 0, y: this.y });
    this.y += Math.max(120, (this.n - start) * 30 + 60);
  }

  private compileHat(call: ts.CallExpression) {
    const start = this.n;
    const name = this.ambientName(call.expression);
    const args = call.arguments;
    let id: string;
    if (name === "whenClicked") id = this.mk(this.isStage ? "event_whenstageclicked" : "event_whenthisspriteclicked");
    else if (name === "onMessage") {
      const msg = String(this.constStr(args[0]));
      id = this.mk("event_whenbroadcastreceived", { f: { BROADCAST_OPTION: [msg, this.ctx.broadcast(msg)] } });
    } else if (name && HATS[name]) id = this.call(HATS[name], args.slice(0, -1), call);
    else return fail(call, "Top-level calls must be events (whenFlag, whenKey, onMessage, onClone, ...)");
    this.attach(id, this.callback(args[args.length - 1] ?? fail(call, "Missing event body")));
    this.place(id, start);
  }

  private compileProc(f: FnDecl, p: ProcInfo, inst: Instance | null) {
    const start = this.n;
    const argShadows = p.ids.map((aid, i) => [aid, [1, this.mk(p.bools[i] ? "argument_reporter_boolean" : "argument_reporter_string_number", { f: { VALUE: [p.names[i], null] }, shadow: true })]] as const);
    const proto = this.mk("procedures_prototype", {
      in: Object.fromEntries(argShadows),
      shadow: true,
      m: MUT({ proccode: p.proccode, argumentids: JSON.stringify(p.ids), argumentnames: JSON.stringify(p.names), argumentdefaults: JSON.stringify(p.bools.map((b) => (b ? "false" : ""))), warp: String(p.warp) }),
    });
    const def = this.mk("procedures_definition", { in: { custom_block: [1, proto] } });
    this.proc = p;
    this.thisInst = inst;
    try { this.attach(def, this.chain(f.body!.statements.flatMap((s) => this.stmt(s)))); } finally { this.proc = null; this.thisInst = null; }
    this.place(def, start);
  }

  // ---------- blocks ----------

  private mk(opcode: string, o: { in?: Record<string, any>; f?: Fields; m?: any; shadow?: boolean } = {}): string {
    const id = this.prefix + (this.n++).toString(36);
    if (opcode.startsWith("pen_")) this.ctx.extensions.add("pen");
    this.blocks[id] = { opcode, next: null, parent: null, inputs: o.in ?? {}, fields: o.f ?? {}, shadow: !!o.shadow, topLevel: false, ...(o.m ? { mutation: o.m } : {}) };
    for (const input of Object.values(this.blocks[id].inputs) as any[])
      for (const ref of input.slice(1)) if (typeof ref === "string" && this.blocks[ref]) this.blocks[ref].parent = id;
    return id;
  }

  /** Link stack blocks in order; returns the first id. */
  private chain(ids: string[]): string | null {
    for (let i = 0; i + 1 < ids.length; i++) {
      this.blocks[ids[i]].next = ids[i + 1];
      this.blocks[ids[i + 1]].parent = ids[i];
    }
    return ids[0] ?? null;
  }

  private attach(parent: string, first: string | null) {
    if (!first) return;
    this.blocks[parent].next = first;
    this.blocks[first].parent = parent;
  }

  private sub(first: string | null) { return first ? [2, first] : [2, null]; }

  private inp(op: Op, slot: Slot): any[] {
    if (slot === "b") {
      if (op.t === "blk") return [2, op.id];
      if (op.t === "var") {
        // A round variable can't sit in a hexagon slot in the Scratch editor: spell out Scratch's own truthiness,
        // not <(x = 0) or (x = "false") or (x = "")>, which is what the VM does with the bare variable.
        const eq = (v: string | number) => this.B(this.mk("operator_equals", { in: { OPERAND1: this.inp(op, "s"), OPERAND2: this.inp({ t: "lit", v }, "s") } }));
        const or = (a: Op, b: Op) => this.B(this.mk("operator_or", { in: { OPERAND1: this.inp(a, "b"), OPERAND2: this.inp(b, "b") } }));
        return [2, this.mk("operator_not", { in: { OPERAND: this.inp(or(or(eq(0), eq("false")), eq("")), "b") } })];
      }
      return [2, this.mk(op.v ? "operator_not" : "operator_and")]; // not(<>) = true, <> and <> = false
    }
    if (slot === "msg") {
      if (op.t === "lit") return [1, [11, String(op.v), this.ctx.broadcast(String(op.v))]];
      return [3, op.t === "blk" ? op.id : [op.k, op.name, op.vid], [11, "message1", this.ctx.broadcast("message1")]];
    }
    const T = SHADOW[slot];
    if (op.t === "lit") return [1, [T, String(op.v)]];
    const empty = [T, slot === "col" ? "#000000" : ""];
    return [3, op.t === "blk" ? op.id : [op.k, op.name, op.vid], empty];
  }

  private menuInp(op: Op, menuOp: string, field: string, sp?: Record<string, string>): any[] {
    if (op.t === "lit") {
      const v = String(op.v);
      return [1, this.mk(menuOp, { f: { [field]: [sp?.[v] ?? v, null] }, shadow: true })];
    }
    const shadow = this.mk(menuOp, { f: { [field]: ["", null] }, shadow: true });
    return [3, op.t === "blk" ? op.id : [op.k, op.name, op.vid], shadow];
  }

  /** Build a block from a spec and positional TS arguments. */
  private call(spec: Spec, args: readonly ts.Expression[], node: ts.Node): string {
    const inputs: Record<string, any> = {};
    const fields: Fields = {};
    (spec.args ?? []).forEach((a: Arg, i) => {
      const e = args[i];
      if ("f" in a) {
        const v = String(this.constStr(e ?? fail(node, `Missing argument ${i + 1}`)));
        fields[a.f] = [a.map ? a.map(v) : v, null];
        return;
      }
      const op: Op = e ? this.expr(e) : a.def !== undefined ? { t: "lit", v: a.def } : fail(node, `Missing argument ${i + 1}`);
      inputs[a.i] = "menu" in a ? this.menuInp(op, a.menu[0], a.menu[1], a.sp) : this.inp(op, a.s);
    });
    for (const [k, v] of Object.entries(spec.fx ?? {})) fields[k] = [v, null];
    return this.mk(spec.op, { in: inputs, f: fields, m: spec.m ? MUT(spec.m) : undefined });
  }

  // ---------- helpers ----------

  private decl(node: ts.Node): ts.Declaration | undefined {
    if (ts.isPropertyAccessExpression(node)) node = node.name;
    let s = this.ctx.checker.getSymbolAtLocation(node);
    if (s && s.flags & ts.SymbolFlags.Alias) s = this.ctx.checker.getAliasedSymbol(s);
    return s?.valueDeclaration ?? s?.declarations?.[0];
  }

  /** Name of an ambient (scratch.d.ts / lib) identifier, or null for user code. */
  private ambientName(e: ts.Expression): string | null {
    if (!ts.isIdentifier(e)) return null;
    const d = this.decl(e);
    return d && d.getSourceFile().isDeclarationFile ? e.text : null;
  }

  private isMe(e: ts.Expression) { return this.ambientName(e) === "me"; }

  private type(n: ts.Node) { return this.ctx.checker.getTypeAtLocation(n); }
  private isStr(n: ts.Node) {
    const t = this.type(n);
    const s = (x: ts.Type) => (x.flags & ts.TypeFlags.StringLike) !== 0;
    return s(t) || (t.isUnion() && t.types.every(s));
  }
  private isBool(n: ts.Node) {
    const t = this.type(n);
    return (t.flags & ts.TypeFlags.BooleanLike) !== 0 || (t.isUnion() && t.types.every((x) => (x.flags & ts.TypeFlags.BooleanLike) !== 0));
  }
  private isArray(n: ts.Node) {
    const t = this.type(n);
    return (this.ctx.checker as any).isArrayType?.(t) ?? t.symbol?.name === "Array";
  }

  private constStr(e: ts.Expression): string | number | boolean {
    const op = this.expr(e);
    return op.t === "lit" ? op.v : fail(e, "This argument must be a constant value");
  }

  private varOf(decl: ts.Node | undefined): VarInfo | undefined {
    if (!decl) return undefined;
    const known = this.ctx.globals.get(decl) ?? this.vars.get(decl);
    if (known) return known;
    const lib = this.ctx.isLib(decl);
    if (!lib && decl.getSourceFile() !== this.file) return undefined;
    // library state object (`export const view = { ... }`): shared globals, created the first time any sprite uses them
    if (lib && ts.isPropertyAssignment(decl) && ts.isVariableDeclaration(decl.parent.parent) && ts.isSourceFile(decl.parent.parent.parent.parent.parent)) {
      this.declareVar(decl.parent.parent, true, true);
      return this.ctx.globals.get(decl);
    }
    if (!ts.isVariableDeclaration(decl)) return undefined;
    const topLevel = ts.isSourceFile(decl.parent.parent.parent);
    if (topLevel && !lib) return undefined; // top-level of another target's file
    if (!ts.isIdentifier(decl.name)) fail(decl, "Destructuring is not supported");
    // library top-level variables: every sprite that uses the library gets its own copy ("physics.vx")
    const base = (decl.name as ts.Identifier).text;
    const name = this.unique(topLevel ? `${this.ctx.modName(decl)}.${base}` : base, false);
    const info: VarInfo = { name, id: this.prefix + "v_" + name, list: this.isArray(decl), value: 0, global: false };
    if (topLevel) {
      const v = this.initValue(decl.initializer);
      if (decl.initializer && v === undefined) fail(decl.initializer, "Top-level initializers must be literals or constants");
      if (v !== undefined) info.value = v;
    }
    if (info.list && !Array.isArray(info.value)) info.value = [];
    this.vars.set(decl, info);
    return info;
  }

  private varRef(node: ts.Expression): VarInfo {
    const v = ts.isPropertyAccessExpression(node) ? this.fieldOf(node) ?? this.varOf(this.decl(node)) : ts.isIdentifier(node) ? this.varOf(this.decl(node)) : undefined;
    return v ?? fail(node, ts.isIdentifier(node) ? `'${node.text}' is not a variable of this sprite (export it to share it)` : "Expected a variable");
  }

  private retVar(): VarInfo {
    const key = this.file; // one hidden return slot per target
    let v = this.vars.get(key);
    if (!v) this.vars.set(key, (v = { name: this.unique("__ret", false), id: this.prefix + "v___ret", list: false, value: 0, global: false }));
    return v;
  }

  private tempVar(): VarInfo {
    const key = ts.factory.createIdentifier("tmp"); // unique key node
    const name = this.unique("_t", false);
    const v: VarInfo = { name, id: this.prefix + "v_" + name, list: false, value: 0, global: false };
    this.vars.set(key, v);
    return v;
  }

  private V = (v: VarInfo): Op => ({ t: "var", k: v.list ? 13 : 12, name: v.name, vid: v.id });
  private L = (v: string | number): Op => ({ t: "lit", v });
  private B = (id: string): Op => ({ t: "blk", id });

  private bin(opcode: string, a: Op, b: Op, slot: Slot = "n", k1 = "NUM1", k2 = "NUM2"): Op {
    return this.B(this.mk(opcode, { in: { [k1]: this.inp(a, slot), [k2]: this.inp(b, slot) } }));
  }
  private not(a: Op): Op { return this.B(this.mk("operator_not", { in: { OPERAND: this.inp(a, "b") } })); }
  private neg(a: Op): Op { return a.t === "lit" && typeof a.v === "number" ? this.L(-a.v) : this.bin("operator_subtract", this.L(0), a); }
  private plus1(e: ts.Expression): Op {
    const op = this.expr(e);
    return op.t === "lit" && typeof op.v === "number" ? this.L(op.v + 1) : this.bin("operator_add", op, this.L(1));
  }
  private listF(v: VarInfo, node: ts.Node): Fields {
    if (!v.list) fail(node, `'${v.name}' is not a list`);
    return { LIST: [v.name, v.id] };
  }

  /** Arithmetic for compound assignment and binary expressions. */
  private arith(kind: ts.SyntaxKind, a: Op, b: Op, str: boolean, node: ts.Node): Op {
    const K = ts.SyntaxKind;
    switch (kind) {
      case K.PlusToken: case K.PlusEqualsToken:
        return str ? this.bin("operator_join", a, b, "s", "STRING1", "STRING2") : this.bin("operator_add", a, b);
      case K.MinusToken: case K.MinusEqualsToken: return this.bin("operator_subtract", a, b);
      case K.AsteriskToken: case K.AsteriskEqualsToken: return this.bin("operator_multiply", a, b);
      case K.SlashToken: case K.SlashEqualsToken: return this.bin("operator_divide", a, b);
      case K.PercentToken: case K.PercentEqualsToken: return this.bin("operator_mod", a, b);
    }
    return fail(node, `Operator '${ts.tokenToString(kind)}' is not supported`);
  }

  /** Run fn with a fresh hoisting buffer; returns hoisted blocks + result. */
  /** Run fn with a fresh hoisting buffer (its own "one value-returning call" budget); returns hoisted blocks + result. */
  private hoisted<T>(fn: () => T): [string[], T] {
    const saved = [this.pre, this.retUsed] as const;
    this.pre = [];
    this.retUsed = 0;
    try { const r = fn(); return [this.pre, r]; } finally { [this.pre, this.retUsed] = saved; }
  }

  private callback(e: ts.Expression): string | null {
    if (!ts.isArrowFunction(e) && !ts.isFunctionExpression(e)) return fail(e, "Expected an arrow function: () => { ... }");
    if (e.parameters.length) fail(e, "Event/loop bodies take no parameters");
    return ts.isBlock(e.body) ? this.chain(e.body.statements.flatMap((s) => this.stmt(s))) : this.chain(this.stmt(e.body as any, true));
  }

  // ---------- statements ----------

  private stmt(node: ts.Statement | ts.Expression, isExpr = false): string[] {
    const saved = [this.pre, this.retUsed] as const;
    this.pre = [];
    this.retUsed = 0;
    try {
      const own = isExpr ? this.exprStmt(node as ts.Expression) : this.stmtInner(node as ts.Statement);
      return [...this.pre, ...own];
    } catch (e) {
      if (e instanceof CErr) { this.ctx.report(e.node, e.message); return []; }
      throw e;
    } finally {
      [this.pre, this.retUsed] = saved;
    }
  }

  private body(s: ts.Statement): string | null { return this.chain(this.stmt(s)); }

  private stmtInner(s: ts.Statement): string[] {
    if (ts.isExpressionStatement(s)) return this.exprStmt(s.expression);
    if (ts.isBlock(s)) return s.statements.flatMap((x) => this.stmt(x));
    if (ts.isEmptyStatement(s)) return [];
    if (ts.isVariableStatement(s)) return this.varDecls(s.declarationList);
    if (ts.isIfStatement(s)) {
      const cond = this.inp(this.expr(s.expression), "b");
      const then = this.body(s.thenStatement);
      if (!s.elseStatement) return [this.mk("control_if", { in: { CONDITION: cond, SUBSTACK: this.sub(then) } })];
      return [this.mk("control_if_else", { in: { CONDITION: cond, SUBSTACK: this.sub(then), SUBSTACK2: this.sub(this.body(s.elseStatement)) } })];
    }
    if (ts.isWhileStatement(s)) {
      if (s.expression.kind === ts.SyntaxKind.TrueKeyword) return [this.mk("control_forever", { in: { SUBSTACK: this.sub(this.body(s.statement)) } })];
      return this.until(s.expression, this.stmt(s.statement));
    }
    if (ts.isForStatement(s)) {
      const init = !s.initializer ? [] : ts.isVariableDeclarationList(s.initializer) ? this.varDecls(s.initializer) : this.exprStmt(s.initializer);
      const loop = [...this.stmt(s.statement), ...(s.incrementor ? this.stmt(s.incrementor, true) : [])];
      if (!s.condition) return [...init, this.mk("control_forever", { in: { SUBSTACK: this.sub(this.chain(loop)) } })];
      return [...init, ...this.until(s.condition, loop)];
    }
    if (ts.isReturnStatement(s)) {
      const out: string[] = [];
      if (s.expression) {
        if (!this.proc) fail(s, "Only functions can return values");
        const v = this.retVar();
        out.push(this.mk("data_setvariableto", { in: { VALUE: this.inp(this.expr(s.expression), "s") }, f: { VARIABLE: [v.name, v.id] } }));
      }
      out.push(this.call(STACK.stopThis, [], s));
      return out;
    }
    if (ts.isBreakStatement(s) || ts.isContinueStatement(s)) return fail(s, "Scratch has no break/continue — use a flag variable in the loop condition, or return from a function");
    return fail(s, `Unsupported statement: ${ts.SyntaxKind[s.kind]}`);
  }

  /** `while (cond) body` as repeat-until. Conditions that call functions are evaluated into a variable
   *  before the loop and again at the end of every iteration. */
  private until(cond: ts.Expression, body: string[]): string[] {
    const stop = () => (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken ? this.expr(cond.operand) : this.not(this.expr(cond)));
    const [pre, c] = this.hoisted(stop);
    if (!pre.length) return [this.mk("control_repeat_until", { in: { CONDITION: this.inp(c, "b"), SUBSTACK: this.sub(this.chain(body)) } })];
    const v = this.tempVar();
    const before = [...pre, this.setVar(v, c)];
    const [pre2, c2] = this.hoisted(stop); // a second copy of the condition for the end of each iteration
    const again = [...pre2, this.setVar(v, c2)];
    return [...before, this.mk("control_repeat_until", { in: { CONDITION: this.inp(this.V(v), "b"), SUBSTACK: this.sub(this.chain([...body, ...again])) } })];
  }

  private varDecls(list: ts.VariableDeclarationList): string[] {
    return list.declarations.flatMap((d) => {
      const v = this.varOf(d) ?? fail(d, "Unsupported variable");
      if (!d.initializer) return [];
      if (v.list) {
        const items = ts.isArrayLiteralExpression(d.initializer) ? d.initializer.elements : fail(d.initializer, "Lists can only be initialized with [ ... ]");
        return [this.mk("data_deletealloflist", { f: this.listF(v, d) }), ...items.map((it) => this.mk("data_addtolist", { in: { ITEM: this.inp(this.expr(it), "s") }, f: this.listF(v, d) }))];
      }
      return [this.setVar(v, this.expr(d.initializer))];
    });
  }

  private setVar(v: VarInfo, op: Op) {
    return this.mk("data_setvariableto", { in: { VALUE: this.inp(op, "s") }, f: { VARIABLE: [v.name, v.id] } });
  }

  private exprStmt(e: ts.Expression): string[] {
    const K = ts.SyntaxKind;
    if (ts.isParenthesizedExpression(e)) return this.exprStmt(e.expression);
    if (ts.isCallExpression(e)) return this.callStmt(e);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind >= K.FirstAssignment && e.operatorToken.kind <= K.LastAssignment)
      return this.assign(e.left, e.operatorToken.kind, e.right, e);
    if ((ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) && (e.operator === K.PlusPlusToken || e.operator === K.MinusMinusToken))
      return this.assign(e.operand, e.operator === K.PlusPlusToken ? K.PlusEqualsToken : K.MinusEqualsToken, 1, e);
    return fail(e, "This expression does nothing on its own");
  }

  private assign(lhs: ts.Expression, kind: ts.SyntaxKind, rhs: ts.Expression | number, node: ts.Node): string[] {
    const K = ts.SyntaxKind;
    const val = () => (typeof rhs === "number" ? this.L(rhs) : this.expr(rhs));
    const str = this.isStr(lhs);
    const compound = (cur: () => Op) => (kind === K.EqualsToken ? val() : this.arith(kind, cur(), val(), str, node));

    if (ts.isIdentifier(lhs) || (ts.isPropertyAccessExpression(lhs) && (this.fieldOf(lhs) ?? this.varOf(this.decl(lhs))))) {
      const v = this.varRef(lhs);
      if (v.list) {
        if (kind !== K.EqualsToken || typeof rhs === "number" || !ts.isArrayLiteralExpression(rhs)) return fail(node, "Lists can only be reassigned with [ ... ]");
        return [this.mk("data_deletealloflist", { f: this.listF(v, lhs) }), ...rhs.elements.map((it) => this.mk("data_addtolist", { in: { ITEM: this.inp(this.expr(it), "s") }, f: this.listF(v, lhs) }))];
      }
      const VF = { VARIABLE: [v.name, v.id] as [string, string] };
      if (!str && (kind === K.PlusEqualsToken || kind === K.MinusEqualsToken))
        return [this.mk("data_changevariableby", { in: { VALUE: this.inp(kind === K.PlusEqualsToken ? val() : this.neg(val()), "n") }, f: VF })];
      return [this.setVar(v, compound(() => this.V(v)))];
    }

    if (ts.isPropertyAccessExpression(lhs) && this.isMe(lhs.expression)) {
      const p = lhs.name.text;
      if (p === "visible" || p === "draggable" || p === "rotationStyle") {
        if (kind !== K.EqualsToken) fail(node, `Use = with me.${p}`);
        const v = val();
        if (p === "rotationStyle") return [this.mk("motion_setrotationstyle", { f: { STYLE: [String(this.constStr(rhs as ts.Expression)), null] } })];
        if (p === "draggable") return [this.mk("sensing_setdragmode", { f: { DRAG_MODE: [this.constStr(rhs as ts.Expression) ? "draggable" : "not draggable", null] } })];
        if (v.t === "lit") return [this.mk(v.v ? "looks_show" : "looks_hide")];
        return [this.mk("control_if_else", { in: { CONDITION: this.inp(v, "b"), SUBSTACK: this.sub(this.mk("looks_show")), SUBSTACK2: this.sub(this.mk("looks_hide")) } })];
      }
      const spec = PROPS[p];
      if (!spec?.set) return fail(node, `me.${p} is read-only`);
      if (spec.change && (kind === K.PlusEqualsToken || kind === K.MinusEqualsToken))
        return [this.mk(spec.change[0], { in: { [spec.change[1]]: this.inp(kind === K.PlusEqualsToken ? val() : this.neg(val()), "n") } })];
      return [this.mk(spec.set[0], { in: { [spec.set[1]]: this.inp(compound(() => this.B(this.call(spec.get!, [], node))), spec.set[2] ?? "n") } })];
    }

    if (ts.isPropertyAccessExpression(lhs) && lhs.name.text === "length" && this.isArray(lhs.expression)) {
      if (kind !== K.EqualsToken || literal(rhs as ts.Expression) !== 0) fail(node, "Only list.length = 0 (clear) is supported");
      return [this.mk("data_deletealloflist", { f: this.listF(this.varRef(lhs.expression), lhs) })];
    }

    if (ts.isElementAccessExpression(lhs) && this.isArray(lhs.expression)) {
      const v = this.varRef(lhs.expression);
      const item = () => this.B(this.mk("data_itemoflist", { in: { INDEX: this.inp(this.plus1(lhs.argumentExpression), "int") }, f: this.listF(v, lhs) }));
      return [this.mk("data_replaceitemoflist", { in: { INDEX: this.inp(this.plus1(lhs.argumentExpression), "int"), ITEM: this.inp(compound(item), "s") }, f: this.listF(v, lhs) })];
    }
    return fail(lhs, "Can't assign to this");
  }

  private callStmt(c: ts.CallExpression): string[] {
    const name = this.ambientName(c.expression);
    const args = c.arguments;
    if (name) {
      if (HATS[name] || name === "whenClicked" || name === "onMessage") fail(c, `${name}() must be at the top level of the file`);
      if (name === "repeat") return [this.mk("control_repeat", { in: { TIMES: this.inp(this.expr(args[0]), "whole"), SUBSTACK: this.sub(this.callback(args[1])) } })];
      if (name === "forever") return [this.mk("control_forever", { in: { SUBSTACK: this.sub(this.callback(args[0])) } })];
      if (name === "waitUntil") {
        const f = args[0];
        if (!ts.isArrowFunction(f)) return fail(f, "Expected () => condition");
        const body = ts.isBlock(f.body) && f.body.statements.length === 1 && ts.isReturnStatement(f.body.statements[0]) ? f.body.statements[0].expression! : f.body;
        if (ts.isBlock(body)) return fail(f, "Expected () => condition");
        const [pre, c] = this.hoisted(() => this.expr(body as ts.Expression));
        if (!pre.length) return [this.mk("control_wait_until", { in: { CONDITION: this.inp(c, "b") } })];
        // the condition calls functions: poll it once per frame instead
        const v = this.tempVar();
        const [pre2, c2] = this.hoisted(() => this.expr(body as ts.Expression));
        return [...pre, this.setVar(v, c), this.mk("control_repeat_until", { in: { CONDITION: this.inp(this.V(v), "b"), SUBSTACK: this.sub(this.chain([...pre2, this.setVar(v, c2)])) } })];
      }
      if (name === "showVariable" || name === "hideVariable") {
        const v = this.varRef(args[0]);
        this.monitored.add(v);
        if (name === "showVariable" && args[1] && ts.isObjectLiteralExpression(args[1])) {
          const o: any = {};
          for (const p of args[1].properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
              const key = p.name.text;
              const init = p.initializer;
              if (ts.isNumericLiteral(init)) o[key] = Number(init.text);
              if (init.kind === ts.SyntaxKind.TrueKeyword) o[key] = true;
              if (init.kind === ts.SyntaxKind.FalseKeyword) o[key] = false;
            }
          }
          v.monitor = { x: o.x ?? 5, y: o.y ?? 5, sliderMin: o.sliderMin ?? 0, sliderMax: o.sliderMax ?? 100, visible: o.visible, slider: o.slider };
        }
        const op = `data_${name === "showVariable" ? "show" : "hide"}${v.list ? "list" : "variable"}`;
        return [this.mk(op, { f: v.list ? { LIST: [v.name, v.id] } : { VARIABLE: [v.name, v.id] } })];
      }
      if (STACK[name]) return [this.call(STACK[name], args, c)];
      if (REPORT[name] || MATHOP[name]) return fail(c, `${name}() returns a value — use it in an expression`);
      return fail(c, `${name}() is not supported`);
    }

    const proc = this.procOf(c);
    if (proc) return [this.procCall(proc, c)];

    if (ts.isPropertyAccessExpression(c.expression) && this.isArray(c.expression.expression)) {
      const v = this.varRef(c.expression.expression);
      const LF = this.listF(v, c);
      const add = (index: Op | null, item: ts.Expression) =>
        index ? this.mk("data_insertatlist", { in: { INDEX: this.inp(index, "int"), ITEM: this.inp(this.expr(item), "s") }, f: LF }) : this.mk("data_addtolist", { in: { ITEM: this.inp(this.expr(item), "s") }, f: LF });
      const del = (index: Op) => this.mk("data_deleteoflist", { in: { INDEX: this.inp(index, "int") }, f: LF });
      switch (c.expression.name.text) {
        case "push": return args.map((a) => add(null, a));
        case "unshift": return [add(this.L(1), args[0])];
        case "insert": return [add(this.plus1(args[0]), args[1])];
        case "remove": return [del(this.plus1(args[0]))];
        case "pop": return [del(this.L("last"))];
        case "shift": return [del(this.L(1))];
        case "splice":
          if (args.length !== 2 || literal(args[1]) !== 1) fail(c, "Only list.splice(index, 1) is supported");
          return [del(this.plus1(args[0]))];
      }
    }
    return fail(c, "Unsupported call");
  }

  private procOf(c: ts.CallExpression): ProcInfo | undefined {
    const method = this.methodOf(c);
    if (method) return method;
    if (!ts.isIdentifier(c.expression) && !ts.isPropertyAccessExpression(c.expression)) return undefined; // f() or Lib.f()
    const d = this.decl(c.expression);
    if (!d || !ts.isFunctionDeclaration(d)) return undefined;
    if (!this.procs.has(d) && this.ctx.isLib(d)) {
      this.declareProc(d);
      this.pendingLib.push({ d, p: this.procs.get(d)!, inst: null });
    }
    return this.procs.get(d) ?? fail(c, "Functions can only be called from the same sprite file (use broadcast for other sprites, or move shared code to src/lib/)");
  }

  private procCall(p: ProcInfo, c: ts.CallExpression): string {
    const inputs = Object.fromEntries(p.ids.map((id, i) => [id, this.inp(this.expr(c.arguments[i]), p.bools[i] ? "b" : "s")]));
    return this.mk("procedures_call", { in: inputs, m: MUT({ proccode: p.proccode, argumentids: JSON.stringify(p.ids), warp: String(p.warp) }) });
  }

  // ---------- expressions ----------

  private expr(e: ts.Expression): Op {
    const K = ts.SyntaxKind;
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) return this.expr(e.expression);
    const lit = literal(e);
    if (lit !== undefined && !Array.isArray(lit)) return { t: "lit", v: lit };

    if (ts.isIdentifier(e)) {
      const d = this.decl(e);
      if (d && this.ctx.consts.has(d)) return { t: "lit", v: this.ctx.consts.get(d)! };
      const v = this.varOf(d);
      if (v) return this.V(v);
      if (d && ts.isParameter(d)) {
        if (!this.proc || d.parent !== this.proc.decl) fail(e, "Parameters can only be used inside their own function");
        return this.B(this.mk(this.isBool(d) ? "argument_reporter_boolean" : "argument_reporter_string_number", { f: { VALUE: [e.text, null] } }));
      }
      if (e.text === "Infinity") return this.L("Infinity");
      return fail(e, `Unknown name '${e.text}'`);
    }

    if (ts.isTemplateExpression(e)) {
      let acc: Op = this.L(e.head.text);
      for (const span of e.templateSpans) {
        acc = this.bin("operator_join", acc, this.expr(span.expression), "s", "STRING1", "STRING2");
        if (span.literal.text) acc = this.bin("operator_join", acc, this.L(span.literal.text), "s", "STRING1", "STRING2");
      }
      return acc;
    }

    if (ts.isPrefixUnaryExpression(e)) {
      if (e.operator === K.MinusToken) return this.neg(this.expr(e.operand));
      if (e.operator === K.PlusToken) return this.expr(e.operand);
      if (e.operator === K.ExclamationToken) return this.not(this.expr(e.operand));
      return fail(e, "++/-- must be used as a statement");
    }

    if (ts.isBinaryExpression(e)) {
      const k = e.operatorToken.kind;
      const a = () => this.expr(e.left), b = () => this.expr(e.right);
      const cmp = (op: string) => this.bin(op, a(), b(), "s", "OPERAND1", "OPERAND2");
      switch (k) {
        case K.LessThanToken: return cmp("operator_lt");
        case K.GreaterThanToken: return cmp("operator_gt");
        case K.LessThanEqualsToken: return this.not(cmp("operator_gt"));
        case K.GreaterThanEqualsToken: return this.not(cmp("operator_lt"));
        case K.EqualsEqualsEqualsToken: case K.EqualsEqualsToken: return cmp("operator_equals");
        case K.ExclamationEqualsEqualsToken: case K.ExclamationEqualsToken: return this.not(cmp("operator_equals"));
        case K.AmpersandAmpersandToken: return this.bin("operator_and", a(), b(), "b", "OPERAND1", "OPERAND2");
        case K.BarBarToken: return this.bin("operator_or", a(), b(), "b", "OPERAND1", "OPERAND2");
      }
      if (k >= K.FirstAssignment && k <= K.LastAssignment) return fail(e, "Assignments must be statements");
      return this.arith(k, a(), b(), this.isStr(e.left) || this.isStr(e.right), e);
    }

    if (ts.isConditionalExpression(e)) {
      const t = this.tempVar();
      const cond = this.inp(this.expr(e.condition), "b");
      const branch = (x: ts.Expression) => { const [pre, op] = this.hoisted(() => this.expr(x)); return this.sub(this.chain([...pre, this.setVar(t, op)])); };
      this.pre.push(this.mk("control_if_else", { in: { CONDITION: cond, SUBSTACK: branch(e.whenTrue), SUBSTACK2: branch(e.whenFalse) } }));
      return this.V(t);
    }

    if (ts.isPropertyAccessExpression(e)) {
      const pv = this.fieldOf(e) ?? this.varOf(this.decl(e));
      if (pv) return this.V(pv);
      const p = e.name.text;
      if (this.isMe(e.expression)) {
        if (p === "visible") fail(e, "Scratch can't report whether a sprite is visible: keep it in a variable (Camera.place sets Camera.onScreen)");
        const spec = PROPS[p]?.get ?? fail(e, `me.${p} can't be read`);
        return this.B(this.call(spec, [], e));
      }
      if (e.getText() === "Math.PI") return this.L(Math.PI);
      if (e.getText() === "Math.E") return this.L(Math.E);
      if (p === "length") {
        if (this.isArray(e.expression)) return this.B(this.mk("data_lengthoflist", { f: this.listF(this.varRef(e.expression), e) }));
        return this.B(this.mk("operator_length", { in: { STRING: this.inp(this.expr(e.expression), "s") } }));
      }
      return fail(e, `Unsupported property '${p}'`);
    }

    if (ts.isElementAccessExpression(e)) {
      if (this.isArray(e.expression))
        return this.B(this.mk("data_itemoflist", { in: { INDEX: this.inp(this.plus1(e.argumentExpression), "int") }, f: this.listF(this.varRef(e.expression), e) }));
      return this.B(this.mk("operator_letter_of", { in: { LETTER: this.inp(this.plus1(e.argumentExpression), "whole"), STRING: this.inp(this.expr(e.expression), "s") } }));
    }

    if (ts.isCallExpression(e)) return this.callExpr(e);
    return fail(e, `Unsupported expression: ${K[e.kind]}`);
  }

  private callExpr(c: ts.CallExpression): Op {
    const args = c.arguments;
    const callee = c.expression;
    const name = this.ambientName(callee) ?? (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Math" ? callee.getText() : null);
    if (name) {
      if (MATHOP[name]) return this.B(this.mk("operator_mathop", { in: { NUM: this.inp(this.expr(args[0]), "n") }, f: { OPERATOR: [MATHOP[name], null] } }));
      if (REPORT[name]) return this.B(this.call(REPORT[name], args, c));
      switch (name) {
        case "String": return this.bin("operator_join", this.expr(args[0]), this.L(""), "s", "STRING1", "STRING2");
        case "Number": return this.bin("operator_add", this.expr(args[0]), this.L(0));
        case "Math.round": return this.B(this.mk("operator_round", { in: { NUM: this.inp(this.expr(args[0]), "n") } }));
        case "Math.random": return this.bin("operator_random", this.L(0), this.L("1.0"), "n", "FROM", "TO");
        case "Math.min": case "Math.max": {
          // ponytail: (a+b ∓ |a-b|)/2 evaluates each argument twice; fine for pure expressions
          if (args.length !== 2) fail(c, `${name} takes exactly 2 arguments`);
          const sum = this.bin("operator_add", this.expr(args[0]), this.expr(args[1]));
          const abs = this.B(this.mk("operator_mathop", { in: { NUM: this.inp(this.bin("operator_subtract", this.expr(args[0]), this.expr(args[1])), "n") }, f: { OPERATOR: ["abs", null] } }));
          return this.bin("operator_divide", this.bin(name === "Math.min" ? "operator_subtract" : "operator_add", sum, abs), this.L(2));
        }
      }
      return fail(c, `${name}() doesn't return a value here`);
    }

    const proc = this.procOf(c);
    if (proc) {
      if (++this.retUsed > 1) fail(c, "Only one value-returning function call per statement — split it into separate variables");
      this.pre.push(this.procCall(proc, c));
      return this.V(this.retVar());
    }

    if (ts.isPropertyAccessExpression(callee)) {
      const obj = callee.expression;
      const m = callee.name.text;
      if (this.isArray(obj)) {
        const LF = this.listF(this.varRef(obj), c);
        if (m === "indexOf") return this.bin("operator_subtract", this.B(this.mk("data_itemnumoflist", { in: { ITEM: this.inp(this.expr(args[0]), "s") }, f: LF })), this.L(1));
        if (m === "includes") return this.B(this.mk("data_listcontainsitem", { in: { ITEM: this.inp(this.expr(args[0]), "s") }, f: LF }));
      } else if (this.isStr(obj)) {
        if (m === "charAt") return this.B(this.mk("operator_letter_of", { in: { LETTER: this.inp(this.plus1(args[0]), "whole"), STRING: this.inp(this.expr(obj), "s") } }));
        if (m === "includes") return this.bin("operator_contains", this.expr(obj), this.expr(args[0]), "s", "STRING1", "STRING2");
      }
    }
    return fail(c, "Unsupported call");
  }

  // ---------- output ----------

  variables(global: boolean) {
    const out: Record<string, [string, any]> = {};
    const lists: Record<string, [string, any[]]> = {};
    for (const v of (global ? this.ctx.globals : this.vars).values()) (v.list ? lists : out)[v.id] = (v.cloud ? [v.name, v.value, true] : [v.name, v.value]) as any;
    return { variables: out, lists };
  }
}
