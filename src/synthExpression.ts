// A bounded numeric language. Imported resources never execute JavaScript.
export type ExpressionContext = { t: number; phase: number; frequency: number; duration: number; velocity: number; noise: () => number; values: Record<string, number> };
type Evaluate = (c: ExpressionContext) => number;
const functions: Record<string, {arity: number; fn: (...n: number[]) => number}> = {
  sin:{arity:1,fn:Math.sin}, cos:{arity:1,fn:Math.cos}, tanh:{arity:1,fn:Math.tanh},
  abs:{arity:1,fn:Math.abs}, exp:{arity:1,fn:Math.exp}, sqrt:{arity:1,fn:Math.sqrt}, floor:{arity:1,fn:Math.floor},
  fract:{arity:1,fn:x=>x-Math.floor(x)}, min:{arity:2,fn:Math.min}, max:{arity:2,fn:Math.max},
  pow:{arity:2,fn:Math.pow}, clamp:{arity:3,fn:(x,a,b)=>Math.min(b,Math.max(a,x))},
};
export const reservedVariables = new Set(['t','phase','frequency','duration','velocity','pi','noise','constructor','prototype','__proto__',...Object.keys(functions)]);
export function compileExpression(expression: string, variables: string[]): {evaluate: Evaluate; cost: number} {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 2048) throw Error('resources.expression');
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z_][a-zA-Z_0-9]*|[+\-*/(),]/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s/g,'') || tokens.length > 256) throw Error('resources.expression');
  let at = 0, cost = 0, depth = 0;
  const allowed = new Set(variables);
  const take = (s: string) => { if (tokens[at] !== s) throw Error('resources.expression'); at++; };
  const primary = (): Evaluate => {
    if (++cost > 128 || ++depth > 16) throw Error('resources.expression');
    let result: Evaluate; const token = tokens[at++];
    if (token === '(') { result = sum(); take(')'); }
    else if (token === '-' || token === '+') { const operand = primary(); result = token === '-' ? c=>-operand(c) : operand; }
    else if (/^(?:\d|\.)/.test(token ?? '')) { const n = Number(token); if (!Number.isFinite(n)) throw Error('resources.expression'); result = ()=>n; }
    else if (token === 'noise') { take('('); take(')'); result = c=>c.noise()*2-1; }
    else if (Object.hasOwn(functions,token)) {
      const f = functions[token]; take('('); const a = sum();
      let b: Evaluate | undefined, d: Evaluate | undefined;
      if (f.arity > 1) { take(','); b = sum(); } if (f.arity > 2) { take(','); d = sum(); } take(')');
      result = f.arity === 1 ? c=>f.fn(a(c)) : f.arity === 2 ? c=>f.fn(a(c),b!(c)) : c=>f.fn(a(c),b!(c),d!(c));
    } else if (token === 'pi') result = ()=>Math.PI;
    else if (['t','phase','frequency','duration','velocity'].includes(token)) result = c=>c[token as 't'];
    else if (allowed.has(token)) result = c=>c.values[token];
    else throw Error('resources.expression');
    depth--; return result;
  };
  const product = (): Evaluate => {
    let left = primary();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++], a = left, b = primary(); if (++cost > 128) throw Error('resources.expression');
      left = op === '*' ? c=>a(c)*b(c) : c=>a(c)/b(c);
    } return left;
  };
  const sum = (): Evaluate => {
    let left = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++], a = left, b = product(); if (++cost > 128) throw Error('resources.expression');
      left = op === '+' ? c=>a(c)+b(c) : c=>a(c)-b(c);
    } return left;
  };
  const evaluate = sum(); if (at !== tokens.length) throw Error('resources.expression');
  return {evaluate: c=>{ const value = evaluate(c); if (!Number.isFinite(value)) throw Error('resources.expressionOutput'); return Math.max(-1,Math.min(1,value)); }, cost};
}
