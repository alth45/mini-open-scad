import { numArg } from '../utils.js';
import { DEG } from '../utils.js';

export const BUILTIN_FUNCTIONS = {
  abs:   v => Math.abs(numArg(v)),
  sign:  v => Math.sign(numArg(v)),
  sin:   v => Math.sin(numArg(v) * DEG),
  cos:   v => Math.cos(numArg(v) * DEG),
  tan:   v => Math.tan(numArg(v) * DEG),
  asin:  v => Math.asin(numArg(v)) / DEG,
  acos:  v => Math.acos(numArg(v)) / DEG,
  atan:  v => Math.atan(numArg(v)) / DEG,
  atan2: (a, b) => Math.atan2(numArg(a), numArg(b)) / DEG,
  floor: v => Math.floor(numArg(v)),
  ceil:  v => Math.ceil(numArg(v)),
  round: v => Math.round(numArg(v)),
  sqrt:  v => Math.sqrt(Math.max(0, numArg(v))),
  pow:   (a, b) => Math.pow(numArg(a), numArg(b)),
  exp:   v => Math.exp(numArg(v)),
  ln:    v => Math.log(Math.max(1e-300, numArg(v))),
  log:   v => Math.log10(Math.max(1e-300, numArg(v))),
  min: (...a) => (a.length === 1 && Array.isArray(a[0]) ? Math.min(...a[0]) : Math.min(...a.map(x => numArg(x)))),
  max: (...a) => (a.length === 1 && Array.isArray(a[0]) ? Math.max(...a[0]) : Math.max(...a.map(x => numArg(x)))),
  len:   v => Array.isArray(v) ? v.length : (typeof v === 'string' ? v.length : 0),
  norm:  v => Math.hypot(...(Array.isArray(v) ? v.map(x => numArg(x)) : [numArg(v)])),
  concat: (...a) => a.flat(),
  str:   (...a) => a.map(x => Array.isArray(x) ? '[' + x.map(y => String(y)).join(', ') + ']' : String(x)).join('')
};