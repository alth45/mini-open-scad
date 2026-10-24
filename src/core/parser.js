import { SCADError } from '../utils.js';

const BIN_LEVELS = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%']
];

export class Parser {
    constructor(tokens) { this.tokens = tokens; this.i = 0; }

    get cur() { return this.tokens[this.i]; }
    at(o = 0) { return this.tokens[Math.min(this.i + o, this.tokens.length - 1)]; }
    advance() { return this.tokens[this.i++]; }
    isOp(v, o = 0) { const t = this.at(o); return t.type === 'op' && t.value === v; }
    isKw(v, o = 0) { const t = this.at(o); return t.type === 'ident' && t.value === v; }
    eat(v) { if (this.isOp(v)) { this.advance(); return true; } return false; }
    expect(v, msg) { if (!this.isOp(v)) this.error(msg || `Diharapkan '${v}'`); return this.advance(); }
    error(msg, tok) { const t = tok || this.cur; throw new SCADError(msg, t.line, t.col); }

    checkClose(openTok, closeSym) {
        if (!this.isOp(closeSym)) {
            throw new SCADError(
                `Diharapkan '${closeSym}'`,
                this.cur.line,
                this.cur.col,
                `'${openTok.value}' dibuka di baris ${openTok.line} belum ditutup`
            );
        }
        this.advance();
    }

    parseProgram() {
        const body = [];
        while (this.cur.type !== 'eof') body.push(this.parseStatement());
        return { type: 'Program', body };
    }

    parseBody() {
        if (this.isOp('{')) {
            const openTok = this.advance();
            const body = [];
            while (!this.isOp('}') && this.cur.type !== 'eof') body.push(this.parseStatement());
            this.checkClose(openTok, '}');
            return body;
        }
        return [this.parseStatement()];
    }

    parseStatement() {
        const startTok = this.cur;
        let modifier = null;
        while (this.cur.type === 'op' && ['*', '!', '#'].includes(this.cur.value)) {
            modifier = this.cur.value;
            this.advance();
        }

        if (this.isOp(';')) { this.advance(); return { type: 'Empty', line: startTok.line }; }

        if (this.isOp('{')) {
            const openTok = this.advance();
            const body = [];
            while (!this.isOp('}') && this.cur.type !== 'eof') body.push(this.parseStatement());
            this.checkClose(openTok, '}');
            return { type: 'Block', body, modifier, line: startTok.line };
        }

        if (this.cur.type === 'ident') {
            const kw = this.cur.value;

            if (kw === 'module') {
                this.advance();
                if (this.cur.type !== 'ident') this.error('module: diharapkan nama module');
                const name = this.advance().value;
                this.expect('(', "Diharapkan '('");
                const params = this.parseParams();
                this.expect(')', "Diharapkan ')'");
                const body = this.parseBody();
                return { type: 'ModuleDef', name, params, body, line: startTok.line };
            }

            if (kw === 'function') {
                this.advance();
                if (this.cur.type !== 'ident') this.error('function: diharapkan nama function');
                const name = this.advance().value;
                this.expect('(', "Diharapkan '('");
                const params = this.parseParams();
                this.expect(')', "Diharapkan ')'");
                this.expect('=', "Diharapkan '='");
                const expr = this.parseExpression();
                this.expect(';', "Diharapkan ';'");
                return { type: 'FunctionDef', name, params, expr, line: startTok.line };
            }

            if (kw === 'if') {
                this.advance();
                this.expect('(', "Diharapkan '('");
                const cond = this.parseExpression();
                this.expect(')', "Diharapkan ')'");
                const thenBody = this.parseBody();
                let elseBody = null;
                if (this.isKw('else')) { this.advance(); elseBody = this.parseBody(); }
                return { type: 'If', cond, thenBody, elseBody, modifier, line: startTok.line };
            }

            if (kw === 'for') {
                this.advance();
                this.expect('(', "Diharapkan '('");
                if (this.cur.type !== 'ident') this.error('for: diharapkan variabel loop');
                const varName = this.advance().value;
                this.expect('=', "Diharapkan '='");
                const iter = this.parseExpression();
                this.expect(')', "Diharapkan ')'");
                const body = this.parseBody();
                return { type: 'For', varName, iter, body, modifier, line: startTok.line };
            }

            if (this.isOp('=', 1)) {
                const name = this.advance().value;
                this.advance();
                const value = this.parseExpression();
                this.expect(';', "Diharapkan ';' setelah assignment");
                return { type: 'Assignment', name, value, modifier, line: startTok.line };
            }

            if (this.isOp('(', 1)) {
                const name = this.advance().value;
                const openTok = this.advance();
                const args = this.parseArgs();
                this.checkClose(openTok, ')');
                let children = [];
                if (this.isOp(';')) { this.advance(); }
                else children = this.parseBody();
                return { type: 'ModuleCall', name, args, children, modifier, line: startTok.line };
            }
        }

        this.error(`Statement tidak dikenal: '${this.cur.value ?? this.cur.type}'`);
    }

    parseParams() {
        const params = [];
        while (!this.isOp(')')) {
            if (this.cur.type !== 'ident') this.error('Diharapkan nama parameter');
            const name = this.advance().value;
            let def = null;
            if (this.eat('=')) def = this.parseExpression();
            params.push({ name, def });
            if (!this.eat(',')) break;
        }
        return params;
    }

    parseArgs() {
        const pos = [], named = Object.create(null);
        while (!this.isOp(')')) {
            if (this.cur.type === 'ident' && this.isOp('=', 1)) {
                const k = this.advance().value;
                this.advance();
                named[k] = this.parseExpression();
            } else {
                pos.push(this.parseExpression());
            }
            if (!this.eat(',')) break;
        }
        return { pos, named };
    }

    parseExpression() { return this.parseBinary(0); }

    parseBinary(level) {
        if (level >= BIN_LEVELS.length) return this.parseUnary();
        let left = this.parseBinary(level + 1);
        while (this.cur.type === 'op' && BIN_LEVELS[level].includes(this.cur.value)) {
            const opTok = this.advance();
            const right = this.parseBinary(level + 1);
            left = { type: 'Binary', op: opTok.value, left, right, line: opTok.line };
        }
        return left;
    }

    parseUnary() {
        if (this.cur.type === 'op' && ['-', '+', '!'].includes(this.cur.value)) {
            const opTok = this.advance();
            const operand = this.parseUnary();
            return { type: 'Unary', op: opTok.value, operand, line: opTok.line };
        }
        return this.parsePostfix();
    }

    parsePostfix() {
        let e = this.parsePrimary();
        while (this.isOp('[')) {
            const t = this.advance();
            const index = this.parseExpression();
            this.expect(']', "Diharapkan ']'");
            e = { type: 'Index', object: e, index, line: t.line };
        }
        return e;
    }

    parsePrimary() {
        const t = this.cur;
        if (t.type === 'number') { this.advance(); return { type: 'Literal', value: t.value }; }
        if (t.type === 'string') { this.advance(); return { type: 'Literal', value: t.value }; }

        if (t.type === 'ident') {
            if (t.value === 'true') { this.advance(); return { type: 'Literal', value: true }; }
            if (t.value === 'false') { this.advance(); return { type: 'Literal', value: false }; }
            if (t.value === 'undef') { this.advance(); return { type: 'Literal', value: null }; }

            this.advance();
            if (this.isOp('(')) {
                const openTok = this.advance();
                const args = this.parseArgs();
                this.checkClose(openTok, ')');
                return { type: 'Call', name: t.value, args, line: t.line };
            }
            return { type: 'Var', name: t.value, line: t.line };
        }

        if (this.isOp('(')) {
            const openTok = this.advance();
            const e = this.parseExpression();
            this.checkClose(openTok, ')');
            return e;
        }

        if (this.isOp('[')) {
            const openTok = this.advance();
            if (this.isOp(']')) { this.advance(); return { type: 'Vector', items: [] }; }

            if (this.isKw('for') || this.isKw('if')) {
                const comp = this.isKw('for') ? this.parseComprehensionFor() : this.parseComprehensionIf();
                this.checkClose(openTok, ']');
                return comp;
            }

            const first = this.parseExpression();
            if (this.isOp(':')) {
                this.advance();
                const second = this.parseExpression();
                let step = null, end;
                if (this.isOp(':')) { this.advance(); step = second; end = this.parseExpression(); }
                else end = second;
                this.checkClose(openTok, ']');
                return { type: 'Range', start: first, step, end, line: t.line };
            }

            const items = [first];
            while (this.eat(',')) {
                if (this.isOp(']')) break;
                items.push(this.parseExpression());
            }
            this.checkClose(openTok, ']');
            return { type: 'Vector', items, line: t.line };
        }

        this.error(`Ekspresi tidak valid: '${t.value ?? t.type}'`);
    }

    /* ---------- list comprehension: [for (...) expr], [if (...) expr] ---------- */
    parseComprehensionFor() {
        this.advance();                                    // 'for'
        this.expect('(', "Diharapkan '('");
        if (this.cur.type !== 'ident') this.error('for: diharapkan variabel loop');
        const varName = this.advance().value;
        this.expect('=', "Diharapkan '='");
        const iter = this.parseExpression();
        this.expect(')', "Diharapkan ')'");
        const body = this.parseComprehensionBody();
        return { type: 'ListComp', kind: 'for', varName, iter, body };
    }

    parseComprehensionIf() {
        this.advance();                                    // 'if'
        this.expect('(', "Diharapkan '('");
        const cond = this.parseExpression();
        this.expect(')', "Diharapkan ')'");
        const thenBody = this.parseComprehensionBody();
        let elseBody = null;
        if (this.isKw('else')) { this.advance(); elseBody = this.parseComprehensionBody(); }
        return { type: 'ListComp', kind: 'if', cond, thenBody, elseBody };
    }

    parseComprehensionBody() {
        if (this.isKw('for')) return this.parseComprehensionFor();
        if (this.isKw('if')) return this.parseComprehensionIf();
        return { type: 'ListComp', kind: 'expr', expr: this.parseExpression() };
    }


}