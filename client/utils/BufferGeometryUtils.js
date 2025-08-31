// Minimal BufferGeometryUtils subset: toTrianglesDrawMode
// Adaptado de three/examples/jsm/utils/BufferGeometryUtils.js
// Mantener misma API exportada que espera GLTFLoader.

import {
  TriangleFanDrawMode,
  TriangleStripDrawMode
} from '../lib/three.module.js';

// Convierte geometrías no trianguladas (TRIANGLE_STRIP / TRIANGLE_FAN)
// a un conjunto de triángulos estándar (TRIANGLES)
// Devuelve una nueva geometría con índices convertidos.
export function toTrianglesDrawMode(geometry, drawMode) {
  if (drawMode !== TriangleFanDrawMode && drawMode !== TriangleStripDrawMode) {
    return geometry;
  }

  const index = geometry.getIndex();
  // Si no hay índice, crear un índice secuencial
  const position = geometry.getAttribute('position');
  const hasIndices = !!index;
  const numberOfVertices = hasIndices ? index.count : position.count;

  const newIndices = [];

  if (drawMode === TriangleFanDrawMode) {
    // TRIANGLE_FAN: (v0, vi, vi+1)
    for (let i = 1; i < numberOfVertices - 1; i++) {
      const a = getIndexValue(geometry, 0);
      const b = getIndexValue(geometry, i);
      const c = getIndexValue(geometry, i + 1);
      newIndices.push(a, b, c);
    }
  } else if (drawMode === TriangleStripDrawMode) {
    // TRIANGLE_STRIP: alterna orientación por paridad
    for (let i = 0; i < numberOfVertices - 2; i++) {
      let a = getIndexValue(geometry, i);
      let b = getIndexValue(geometry, i + 1);
      let c = getIndexValue(geometry, i + 2);

      if (i % 2 === 0) {
        // even
        newIndices.push(a, b, c);
      } else {
        // odd - swap last two to maintain winding
        newIndices.push(a, c, b);
      }
    }
  }

  const newGeometry = geometry.clone();
  newGeometry.setIndex(newIndices);
  return newGeometry;
}

function getIndexValue(geometry, idx) {
  const index = geometry.getIndex();
  if (index) return index.getX(idx);
  return idx; // no index => identity mapping
}
