import { SCADError, numArg, isNum, DEG, truthy } from '../utils.js';
import { CONFIG } from '../config.js';
import { Scope, findChildrenContext } from '../core/scope.js';
import { makeBuiltins } from './builtins.js';
import { BUILTIN_FUNCTIONS } from './functions.js';
import { suggestName } from '../utils/suggest.js';
// import { Scope } from '../core/scope.js';

/* ---------- EvalContext ---------- */
export class EvalContext {
    constructor() {
        this.start = performance.now();
        this.deadline = this.start + CONFIG.evalTimeoutMs;
        this.warnings = [];
        this.warned = new Set();
        this.echoes = [];
    }
    check() {
        if (performance.now() > this.deadline) {
            throw new SCADError(
                `Evaluation timeout (> ${CONFIG.evalTimeoutMs} ms). Loop terlalu besar?`,
                0, 0
            );
        }
    }
    warn(msg) {
        if (this.warned.has(msg)) return;
        this.warned.add(msg);
        this.warnings.push(msg);
    }
    log(msg) { this.echoes.push(msg); }              // NEW
}

export function makeRootScope(initialVars) {
    const s = new Scope(null);
    s.set('$fn', CONFIG.defaultFn);
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
            const iter = evalExpr(node.iter, scope, ctx);
            const values = iterToValues(iter, node.line);
            for (const v of values) {
                ctx.check();
                const inner = new Scope(scope);
                inner.set(node.varName, v);
                evalCompInto(node.body, inner, ctx, out);
            }
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
    for (const st of stmts) {
        ctx.check();
        const res = evalStatement(st, scope, ctx);
        if (!res || res.length === 0) continue;
        if (st.modifier === '*') continue;
        if (st.modifier === '!') { out = res.slice(); continue; }
        out = out.concat(res);
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

        case 'If': {
            const c = evalExpr(st.cond, scope, ctx);
            const inner = new Scope(scope);
            if (truthy(c)) return evalStatements(st.thenBody, inner, ctx);
            if (st.elseBody) return evalStatements(st.elseBody, inner, ctx);
            return null;
        }

        case 'For': {
            const iter = evalExpr(st.iter, scope, ctx);
            const values = iterToValues(iter, st.line);

            const out = [];
            for (const v of values) {
                ctx.check();
                const inner = new Scope(scope);
                inner.set(st.varName, v);
                out.push(...evalStatements(st.body, inner, ctx));
            }
            return out;
        }
        case 'ModuleCall': {
            const builtin = BUILTINS[st.name];
            if (builtin) {
                const args = evalArgsNode(st.args, scope, ctx);
                return builtin(args, st, scope, ctx) || [];
            }

            const userMod = scope.getModule(st.name);
            if (userMod) {
                const args = evalArgsNode(st.args, scope, ctx);
                const modScope = new Scope(scope);
                bindParams(userMod.params, args, modScope, scope, ctx);

                // Simpan konteks children — dipakai oleh children() builtin
                modScope.childrenContext = {
                    children: st.children,   // array AST statement
                    callerScope: scope       // scope di call site
                };

                return evalStatements(userMod.body, modScope, ctx);
            }

            // throw new SCADError(`Module tidak dikenal: '${st.name}'`, st.line);
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