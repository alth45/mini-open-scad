import { SCADError, numArg, isNum, DEG, truthy } from '../utils.js';
import { CONFIG } from '../config.js';
import { Scope, findChildrenContext } from '../core/scope.js';
import { makeBuiltins } from './builtins.js';
import { BUILTIN_FUNCTIONS } from './functions.js';
import { suggestName } from '../utils/suggest.js';
// import { Scope } from '../core/scope.js';
import { isOpenTypeFont } from './opentype-fonts.js';


/* ---------- EvalContext ---------- */
export class EvalContext {
    constructor(files = null, scadCache = null, timeoutMs = CONFIG.evalTimeoutMs) {
        this.timeoutMs = Math.max(100, Math.min(CONFIG.maxTimeoutMs, timeoutMs));
        this.start = performance.now();
        this.deadline = this.start + this.timeoutMs;
        this.warnings = [];
        this.warned = new Set();
        this.echoes = [];
        this.files = files || {};
        this.scadCache = scadCache || new Map();
        this.includeStack = new Set();
        this.moduleStack = [];         // stack nama module (untuk recursion detection)
        this.currentOp = null;         // { name, line } untuk error context
        this.profiling = true;
        this.opTimings = Object.create(null);
        this._warned50 = false;
        this._warned75 = false;
    }

    getFileBuffer(name) { return this.files[name] || null; }
    getScadAst(name) { return this.scadCache.get(name) || null; }

    check() {
        const now = performance.now();
        const elapsed = now - this.start;
        const pct = elapsed / this.timeoutMs;

        /* --- Warning HANYA di 75% (mendekati timeout) --- */
        if (pct >= 0.75 && !this._warned75) {
            this._warned75 = true;
            this.warn(
                `⏱ Render lambat: sudah ${Math.round(pct * 100)}% dari batas waktu ` +
                `(${Math.round(elapsed)}/${this.timeoutMs} ms). ` +
                `Jika sering muncul, tambahkan '$maxTime = ${this.timeoutMs * 2};' di baris atas kode.`
            );
        }

        /* --- Timeout --- */
        if (elapsed > this.timeoutMs) {
            const opInfo = this.currentOp
                ? ` saat '${this.currentOp.name}'${this.currentOp.line ? ` (line ${this.currentOp.line})` : ''}`
                : '';
            const recent = this.moduleStack.slice(-5).map(s => s.name).join(' → ');
            const chainInfo = recent ? `\n   Di module: ... → ${recent}` : '';
            const hint =
                `Coba: (1) tambahkan '$maxTime = ${this.timeoutMs * 2};' di baris atas, ` +
                `(2) kurangi $fn (sekarang ${this._currentFn()}), ` +
                `(3) perkecil loop, atau (4) klik Cancel.` +
                chainInfo;
            throw new SCADError(
                `Evaluation timeout (${Math.round(elapsed)} ms > ${this.timeoutMs} ms)${opInfo}`,
                0, 0, hint
            );
        }
    }

    _currentFn() {
        return this._fnValue === undefined ? CONFIG.defaultFn : this._fnValue;
    }

    warn(msg) {
        if (this.warned.has(msg)) return;
        this.warned.add(msg);
        this.warnings.push(msg);
    }

    log(msg) { this.echoes.push(msg); }

    trackOp(name, fn, line = 0) {
        this.check();
        if (!this.profiling) return fn();

        const prevOp = this.currentOp;
        this.currentOp = { name, line };
        const t0 = performance.now();
        try {
            return fn();
        } finally {
            const dt = performance.now() - t0;
            const cur = this.opTimings[name] || { total: 0, count: 0, max: 0 };
            cur.total += dt;
            cur.count += 1;
            if (dt > cur.max) cur.max = dt;
            this.opTimings[name] = cur;
            this.currentOp = prevOp;
        }
    }
}

export function makeRootScope(initialVars, previewMode = true) {
    const s = new Scope(null);
    s.set('$fn', CONFIG.defaultFn);
    s.set('$fa', CONFIG.defaultFa);
    s.set('$fs', CONFIG.defaultFs);
    s.set('$preview', !!previewMode);           // ← NEW
    if (initialVars) {
        for (const k in initialVars) {
            if (!k.startsWith('$')) s.set(k, initialVars[k]);
        }
    }
    return s;
}

/* ---------- Expressions ---------- */
export function evalExpr(node, scope, ctx) {
    switch (node.type) {
        case 'Literal': return node.value;
        case 'Vector': return node.items.map(n => evalExpr(n, scope, ctx));

        case 'Range': {
            const start = numArg(evalExpr(node.start, scope, ctx), 0);
            const end = numArg(evalExpr(node.end, scope, ctx), 0);
            const step = node.step ? numArg(evalExpr(node.step, scope, ctx), 1)
                : (end >= start ? 1 : -1);
            return { __range: true, start, end, step: step === 0 ? 1 : step };
        }

        case 'Var': {
            if (node.name === 'PI') return Math.PI;
            if (node.name === '$fn') {
                const v = scope.get('$fn');
                return v === undefined ? CONFIG.defaultFn : v;
            }
            if (node.name === '$preview') {
                const v = scope.get('$preview');
                return v === undefined ? true : v;
            }
            if (node.name === '$children') {
                const cc = findChildrenContext(scope);
                return cc ? cc.children.length : 0;
            }
            const v = scope.get(node.name);
            if (v === undefined) {
                const candidates = scope.collectVarNames();
                candidates.add('PI');
                candidates.add('$fn');
                candidates.add('$children');
                const sug = suggestName(node.name, candidates);
                throw new SCADError(
                    `Variabel tidak dikenal: '${node.name}'`,
                    node.line,
                    node.col,
                    sug ? `Mungkin maksud Anda: '${sug}'` : null
                );
            }
            return v;

            return v;
        }

        case 'Unary': {
            const v = evalExpr(node.operand, scope, ctx);
            if (node.op === '-') return -numArg(v, 0);
            if (node.op === '+') return numArg(v, 0);
            if (node.op === '!') return !truthy(v);
            return v;
        }

        case 'Binary': return evalBinary(node, scope, ctx);
        case 'Ternary': {
            const c = evalExpr(node.cond, scope, ctx);
            return truthy(c)
                ? evalExpr(node.thenExpr, scope, ctx)
                : evalExpr(node.elseExpr, scope, ctx);
        }
        case 'Let': {
            const inner = new Scope(scope);
            for (const b of node.bindings) {
                /* `inner` dipakai — biar `b` bisa referensi binding sebelumnya */
                inner.set(b.name, evalExpr(b.value, inner, ctx));
            }
            return evalExpr(node.body, inner, ctx);
        }

        case 'Index': {
            const obj = evalExpr(node.object, scope, ctx);
            const idx = numArg(evalExpr(node.index, scope, ctx), 0);
            if (Array.isArray(obj)) {
                const i = Math.floor(idx);
                if (i < 0 || i >= obj.length) throw new SCADError('Index di luar batas', node.line);
                return obj[i];
            }
            throw new SCADError('Index hanya untuk vector', node.line);
        }

        case 'ListComp': return evalComprehension(node, scope, ctx);
        case 'Call': return evalCall(node, scope, ctx);

        default:
            throw new SCADError(`Ekspresi tidak didukung: ${node.type}`, node.line);
    }
}



function evalBinary(node, scope, ctx) {
    const op = node.op;

    if (op === '&&') {
        if (!truthy(evalExpr(node.left, scope, ctx))) return false;
        return truthy(evalExpr(node.right, scope, ctx));
    }
    if (op === '||') {
        if (truthy(evalExpr(node.left, scope, ctx))) return true;
        return truthy(evalExpr(node.right, scope, ctx));
    }

    const l = evalExpr(node.left, scope, ctx);
    const r = evalExpr(node.right, scope, ctx);

    if (Array.isArray(l) && isNum(r)) return l.map(v => applyNum(op, v, r, node));
    if (isNum(l) && Array.isArray(r)) return r.map(v => applyNum(op, l, v, node));
    if (Array.isArray(l) && Array.isArray(r) && l.length === r.length) {
        return l.map((v, i) => applyNum(op, v, r[i], node));
    }

    switch (op) {
        case '==': return l === r;
        case '!=': return !(l === r);
        case '<': return numArg(l) < numArg(r);
        case '<=': return numArg(l) <= numArg(r);
        case '>': return numArg(l) > numArg(r);
        case '>=': return numArg(l) >= numArg(r);
        default: return applyNum(op, l, r, node);
    }
}

/* ---------- List Comprehension ---------- */
function evalComprehension(node, scope, ctx) {
    const out = [];
    evalCompInto(node, scope, ctx, out);
    return out;
}

function evalCompInto(node, scope, ctx, out) {
    switch (node.kind) {
        case 'expr':
            out.push(evalExpr(node.expr, scope, ctx));
            return;

        case 'for': {
            const lists = node.iterators.map(it => ({
                varName: it.varName,
                values: iterToValues(evalExpr(it.iter, scope, ctx), node.line)
            }));

            const total = lists.reduce((a, b) => a * b.values.length, 1);
            if (total > CONFIG.maxLoopIterations) {
                throw new SCADError(
                    `Loop terlalu besar (> ${CONFIG.maxLoopIterations} kombinasi)`,
                    0
                );
            }

            function recurse(idx, inner) {
                ctx.check();
                if (idx === lists.length) {
                    evalCompInto(node.body, inner, ctx, out);
                    return;
                }
                const { varName, values } = lists[idx];
                for (const v of values) {
                    const child = new Scope(inner);
                    child.set(varName, v);
                    recurse(idx + 1, child);
                }
            }
            recurse(0, scope);
            return;
        }

        case 'if': {
            if (truthy(evalExpr(node.cond, scope, ctx))) {
                evalCompInto(node.thenBody, scope, ctx, out);
            } else if (node.elseBody) {
                evalCompInto(node.elseBody, scope, ctx, out);
            }
            return;
        }
    }
}

/* Helper: iter → array of values. Dipakai oleh For loop & ListComp. */
function iterToValues(iter, line) {
    if (iter && iter.__range) {
        const values = [];
        const { start, end, step } = iter;
        if (step > 0) {
            for (let v = start; v <= end + 1e-9; v += step) {
                values.push(v);
                if (values.length > CONFIG.maxLoopIterations)
                    throw new SCADError(`Loop terlalu besar (> ${CONFIG.maxLoopIterations} iterasi)`, line);
            }
        } else {
            for (let v = start; v >= end - 1e-9; v += step) {
                values.push(v);
                if (values.length > CONFIG.maxLoopIterations)
                    throw new SCADError(`Loop terlalu besar (> ${CONFIG.maxLoopIterations} iterasi)`, line);
            }
        }
        return values;
    }
    if (Array.isArray(iter)) return iter;
    throw new SCADError('Iterasi harus range [a:b] atau vector', line);
}

function applyNum(op, l, r, node) {
    const a = typeof l === 'string' ? parseFloat(l) : l;
    const b = typeof r === 'string' ? parseFloat(r) : r;
    if (!isNum(a) || !isNum(b)) {
        throw new SCADError(`Operasi '${op}' butuh angka (dapat: ${typeof l} & ${typeof r})`, node.line);
    }
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '%': return b === 0 ? 0 : a % b;
        case '^': return Math.pow(a, b);
        default: throw new SCADError(`Operator tidak dikenal: '${op}'`, node.line);
    }
}

function evalCall(node, scope, ctx) {
    const args = node.args;

    const userFn = scope.getFunc(node.name);
    if (userFn) {
        const pos = args.pos.map(n => evalExpr(n, scope, ctx));
        const named = Object.create(null);
        for (const k in args.named) named[k] = evalExpr(args.named[k], scope, ctx);
        const fnScope = new Scope(scope);
        bindParams(userFn.params, { pos, named }, fnScope, scope, ctx);
        return evalExpr(userFn.expr, fnScope, ctx);
    }

    const fn = BUILTIN_FUNCTIONS[node.name];
    if (!fn) {
        const candidates = new Set(Object.keys(BUILTIN_FUNCTIONS));
        scope.collectFuncNames(candidates);
        const sug = suggestName(node.name, candidates);
        throw new SCADError(
            `Function tidak dikenal: '${node.name}'`,
            node.line,
            node.col,
            sug ? `Mungkin maksud Anda: '${sug}'` : null
        );
    }
    return fn(...args.pos.map(n => evalExpr(n, scope, ctx)));
}

function bindParams(params, args, targetScope, callerScope, ctx) {
    /* Warn named arg yang tidak cocok dengan parameter */
    if (args.named && params.length > 0) {
        const paramNames = new Set(params.map(p => p.name));
        for (const k in args.named) {
            if (!paramNames.has(k)) {
                const sug = suggestName(k, paramNames);
                if (sug) {
                    ctx.warn(`Parameter '${k}' tidak dikenal (mungkin maksud: '${sug}')`);
                }
            }
        }
    }
    let posIndex = 0;
    for (const p of params) {
        if (args.named[p.name] !== undefined) {
            targetScope.set(p.name, args.named[p.name]);
        } else if (posIndex < args.pos.length) {
            targetScope.set(p.name, args.pos[posIndex++]);
        } else if (p.def) {
            targetScope.set(p.name, evalExpr(p.def, callerScope, ctx));
        } else {
            targetScope.set(p.name, null);
        }
    }
}

function evalArgsNode(argsNode, scope, ctx) {
    const pos = argsNode.pos.map(n => evalExpr(n, scope, ctx));
    const named = Object.create(null);
    for (const k in argsNode.named) named[k] = evalExpr(argsNode.named[k], scope, ctx);
    return { pos, named };
}

/* ---------- Statements ---------- */

export function evalStatements(stmts, scope, ctx) {
    let out = [];
    try {
        for (const st of stmts) {
            ctx.check();
            const res = evalStatement(st, scope, ctx);
            if (!res || res.length === 0) continue;
            if (st.modifier === '*') continue;
            if (st.modifier === '!') { out = res.slice(); continue; }
            out = out.concat(res);
        }
    } catch (e) {
        if (e instanceof RangeError && /call stack/i.test(e.message)) {
            const chain = ctx.moduleStack.slice(-5).map(s => s.name).join(' → ');
            throw new SCADError(
                'Infinite recursion terdeteksi (JS call stack overflow)',
                0, 0,
                (chain ? `Rantai: ... → ${chain}\n` : '') +
                'Pastikan module punya kondisi berhenti.'
            );
        }
        throw e;
    }
    return out;
}

export function evalStatement(st, scope, ctx) {
    switch (st.type) {
        case 'Empty': return null;

        case 'Assignment': {
            scope.set(st.name, evalExpr(st.value, scope, ctx));
            return null;
        }

        case 'ModuleDef': scope.modules.set(st.name, st); return null;
        case 'FunctionDef': scope.funcs.set(st.name, st); return null;

        case 'Block': {
            return evalStatements(st.body, new Scope(scope), ctx);
        }

        case 'LetStatement': {
            const inner = new Scope(scope);
            for (const b of st.bindings) {                           // ← st saja
                inner.set(b.name, evalExpr(b.value, inner, ctx));
            }
            return evalStatements(st.body, inner, ctx);
        }

        case 'If': {
            const c = evalExpr(st.cond, scope, ctx);
            const inner = new Scope(scope);
            if (truthy(c)) return evalStatements(st.thenBody, inner, ctx);
            if (st.elseBody) return evalStatements(st.elseBody, inner, ctx);
            return null;
        }

        case 'For': {
            /* Evaluasi nilai tiap iterator */
            const lists = st.iterators.map(it => ({
                varName: it.varName,
                values: iterToValues(evalExpr(it.iter, scope, ctx), st.line)
            }));

            /* Cek total kombinasi (Cartesian product) */
            const total = lists.reduce((a, b) => a * b.values.length, 1);
            if (total > CONFIG.maxLoopIterations) {
                throw new SCADError(
                    `Loop terlalu besar (> ${CONFIG.maxLoopIterations} kombinasi)`,
                    st.line
                );
            }

            const out = [];

            /* Cartesian product via rekursi — leftmost outermost, rightmost cycles fastest */
            function recurse(idx, inner) {
                ctx.check();
                if (idx === lists.length) {
                    out.push(...evalStatements(st.body, inner, ctx));
                    return;
                }
                const { varName, values } = lists[idx];
                for (const v of values) {
                    const child = new Scope(inner);
                    child.set(varName, v);
                    recurse(idx + 1, child);
                }
            }
            recurse(0, scope);

            return out;
        }

        case 'Include': {
            const file = st.file;

            /* Cycle detection runtime */
            if (ctx.includeStack.has(file)) {
                ctx.warn(`Circular include terdeteksi: '${file}' — diabaikan`);
                return null;
            }

            const entry = ctx.getScadAst(file);
            if (!entry) {
                throw new SCADError(
                    `include: file '${file}' belum dimuat`,
                    st.line, 0,
                    'File .scad harus di-import lewat menu 📁 Files sebelum dipakai'
                );
            }
            if (entry.error || !entry.ast) {
                throw new SCADError(
                    `include: gagal parse '${file}': ${entry.error || 'unknown'}`,
                    st.line
                );
            }

            ctx.includeStack.add(file);
            try {
                if (st.isUse) {
                    /* use — hanya module & function, dan rekursif ke use-inner */
                    for (const innerSt of entry.ast.body) {
                        if (innerSt.type === 'Include' && innerSt.isUse) {
                            evalStatement(innerSt, scope, ctx);
                        }
                    }
                    for (const innerSt of entry.ast.body) {
                        if (innerSt.type === 'ModuleDef') {
                            scope.modules.set(innerSt.name, innerSt);
                        } else if (innerSt.type === 'FunctionDef') {
                            scope.funcs.set(innerSt.name, innerSt);
                        }
                    }
                    return null;
                }

                /* include — eval semua statement di current scope */
                return evalStatements(entry.ast.body, scope, ctx);
            } finally {
                ctx.includeStack.delete(file);
            }
        }

        case 'ModuleCall': {
            const builtin = BUILTINS[st.name];
            if (builtin) {
                const args = evalArgsNode(st.args, scope, ctx);
                /* Track $fn terakhir untuk hint error */
                if (st.name === 'sphere' || st.name === 'cylinder' || st.name === 'circle') {
                    const f = (args.named && args.named.$fn) || scope.get('$fn');
                    if (f !== undefined) ctx._fnValue = f;
                }
                return ctx.trackOp(st.name, () => builtin(args, st, scope, ctx), st.line) || [];
            }

            const userMod = scope.getModule(st.name);
            if (userMod) {
                /* ---- recursion detection ---- */
                if (ctx.moduleStack.length >= 200) {
                    const chain = ctx.moduleStack.slice(-5).map(s => s.name).join(' → ');
                    throw new SCADError(
                        `Infinite recursion terdeteksi (kedalaman > 200)`,
                        st.line, 0,
                        `Rantai: ... → ${chain} → ${st.name}\n` +
                        `Pastikan module '${st.name}' punya kondisi berhenti (if (n > 0) ...) atau tidak memanggil dirinya tanpa batas.`
                    );
                }

                const args = evalArgsNode(st.args, scope, ctx);
                const modScope = new Scope(scope);
                bindParams(userMod.params, args, modScope, scope, ctx);

                modScope.childrenContext = {
                    children: st.children,
                    callerScope: scope
                };

                ctx.moduleStack.push({ name: st.name, line: st.line });
                try {
                    return evalStatements(userMod.body, modScope, ctx);
                } finally {
                    ctx.moduleStack.pop();
                }
            }

            /* Suggestion untuk module tidak dikenal (existing) */
            const candidates = new Set(Object.keys(BUILTINS));
            scope.collectModuleNames(candidates);
            const sug = suggestName(st.name, candidates);
            throw new SCADError(
                `Module tidak dikenal: '${st.name}'`,
                st.line,
                st.col,
                sug ? `Mungkin maksud Anda: '${sug}'` : null
            );
        }

        default:
            throw new SCADError(`Statement tidak didukung: ${st.type}`, st.line);
    }
}

// BUILTINS di-inject dengan evalStatements (menghindari circular import)
const BUILTINS = makeBuiltins(evalStatements);