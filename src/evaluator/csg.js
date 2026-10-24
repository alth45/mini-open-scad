import * as CSG from 'three-bvh-csg';
import { mergeWorldGeometries } from './geometry.js';

export { CSG };

export const csgEvaluator = CSG.Evaluator ? new CSG.Evaluator() : null;
if (csgEvaluator) {
  csgEvaluator.attributes = ['position', 'normal'];
  csgEvaluator.useGroups = false;
}

export function makeBrush(obj) {
  if (!CSG) return null;
  const geo = mergeWorldGeometries(obj);
  if (!geo) return null;
  const brush = new CSG.Brush(geo);
  brush.updateMatrixWorld(true);
  return brush;
}

export function csgApply(aBrush, bBrush, op) {
  if (!csgEvaluator) throw new Error('CSG not ready');
  const result = csgEvaluator.evaluate(aBrush, bBrush, op);
  result.updateMatrixWorld(true);
  return result;
}