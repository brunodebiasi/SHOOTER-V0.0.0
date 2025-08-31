// client/client.js
// Muestra errores en pantalla para facilitar el debug
import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { MessageTypes, Defaults } from '/common/protocol.js';
const overlay = document.getElementById('overlay');
// Configuración de cámara y vista temprana para evitar TDZ
const FIRST_PERSON = true;
const HEAD_HEIGHT = 1.6;

// Rutas sugeridas para modelos gratuitos (colocar archivos locales GLTF/GLB en client/assets/weapons/)
// Recomendado: Quaternius (SMG futurista) y Kenney (pistola láser) – ambos CC0
const WEAPON_MODELS = {
  auto: {
    // Ejemplo esperado: 'client/assets/weapons/smg_futuristic.glb'
    url: '/client/assets/weapons/smg_futuristic.glb',
    scale: 0.8,
    tint: { color: 0x2a3542, accent: 0x2aa7ff }
  },
  ray: {
    // Ejemplo esperado: 'client/assets/weapons/laser_pistol.glb'
    url: '/client/assets/weapons/laser_pistol.glb',
    scale: 0.8,
    tint: { color: 0x202a34, emissive: 0x990000 }
  }
};

// Declaración temprana para evitar uso antes de inicialización
let fpsReticle;
// Cursor minimalista tecnológico (DOM overlay)
let techCursor = null; let cursorActive = false; let cursorPrev = '';
let cursorStyleEl = null; // <style> global para ocultar cursor del sistema

function ensureTechCursor(){
  if (techCursor) return techCursor;
  const c = document.createElement('div');
  c.id = 'techCursor';
  c.style.position = 'fixed';
  c.style.left = '0'; c.style.top = '0';
  c.style.width = '16px'; c.style.height = '16px';
  c.style.pointerEvents = 'none';
  c.style.zIndex = '99999';
  // Triángulo como flecha + borde cian
  c.style.transform = 'translate(-2px, -2px)';
  c.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#00caff" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#00caff" stop-opacity="0.2"/>
        </linearGradient>
      </defs>
      <path d="M2 1 L14 9 L8 10 L9 16 Z" fill="url(#g)" stroke="#00caff" stroke-width="1.2" />
    </svg>`;
  c.style.display = 'none';
  document.body.appendChild(c); techCursor = c; return c;
}

// ===== Colisiones básicas: punto (jugador XZ) vs AABB (cubo) =====
// Desplaza la posición del jugador p en X/Z fuera de la AABB del cubo (centro cubePos, half-extent "half")
function resolvePlayerVsCubeXZ(p, cubePos, half){
  // Consideramos al jugador como un punto en XZ (cámara en 1ra persona)
  const minX = cubePos.x - half, maxX = cubePos.x + half;
  const minZ = cubePos.z - half, maxZ = cubePos.z + half;
  const insideX = (p.x >= minX && p.x <= maxX);
  const insideZ = (p.z >= minZ && p.z <= maxZ);
  if (insideX && insideZ){
    const dxLeft = p.x - minX;   // distancia a cara izquierda
    const dxRight = maxX - p.x;  // distancia a cara derecha
    const dzNear = p.z - minZ;   // distancia a cara cercana
    const dzFar = maxZ - p.z;    // distancia a cara lejana
    // Empujar por el eje de menor penetración
    const minPen = Math.min(dxLeft, dxRight, dzNear, dzFar);
    if (minPen === dxLeft) p.x = minX - 1e-4;
    else if (minPen === dxRight) p.x = maxX + 1e-4;
    else if (minPen === dzNear) p.z = minZ - 1e-4;
    else p.z = maxZ + 1e-4;
  }
}
// Helper: configuraciones de texturas cuadriculadas por índice (1..10)
function gridCfgById(id){
  const cfgs = [
    ['#ffffff', 'rgba(0,0,0,0.85)', 2, 4, 4],
    ['#00ffff', 'rgba(0,0,0,0.70)', 2, 8, 8],
    ['#ff00ff', 'rgba(0,0,0,0.70)', 3, 6, 6],
    ['#ffcc00', 'rgba(0,0,0,0.70)', 2, 10, 10],
    ['#00ff66', 'rgba(0,0,0,0.70)', 2, 12, 12],
    ['#ff5555', 'rgba(0,0,0,0.70)', 2, 5, 5],
    ['#66aaff', 'rgba(0,0,0,0.70)', 1, 14, 14],
    ['#ffffff', 'rgba(20,20,20,0.70)', 3, 3, 3],
    ['#00ffff', 'rgba(20,0,30,0.70)', 2, 7, 3],
    ['#ff00aa', 'rgba(0,20,30,0.70)', 2, 3, 7],
  ];
  return cfgs[Math.max(1, Math.min(10, id)) - 1];
}

// Miniatura 2D para HUD basada en gridCfgById
function makeGridPreviewDataURL(id, size=40){
  try{
    const [line, bg, lw, rx, ry] = gridCfgById(id);
    const c = document.createElement('canvas'); c.width=size; c.height=size;
    const ctx = c.getContext('2d');
    // Fondo
    ctx.fillStyle = bg; ctx.fillRect(0,0,size,size);
    // Líneas de grilla
    ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, lw*0.6);
    const stepX = size/Math.max(1, rx); const stepY = size/Math.max(1, ry);
    ctx.globalAlpha = 0.95;
    for (let x=0; x<=size+0.5; x+=stepX){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,size); ctx.stroke(); }
    for (let y=0; y<=size+0.5; y+=stepY){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(size,y); ctx.stroke(); }
    // Borde sutil
    ctx.globalAlpha = 1.0; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.strokeRect(0.5,0.5,size-1,size-1);
    return c.toDataURL('image/png');
  }catch{}
  return '';
}

// ===== Modo Construcción (ghost + snap + rotación) =====
const Build = { active:false, ghost:null, rotX:0, rotY:0, altY:1.0 };
function ensureBuildGhost(){
  // Crear o actualizar ghost según el item equipado
  const equipSlot = Inventory.equippedSlot;
  if (!equipSlot) return null;
  const itemId = Inventory.slots[equipSlot];
  if (!itemId) return null;
  const [line,bg,lw,rx,ry] = gridCfgById(itemId);
  const mat = makeGridMaterial(line,bg,lw,rx,ry).clone();
  if (!Array.isArray(mat)){
    mat.transparent = true; mat.opacity = 0.5; mat.depthWrite = false;
  }
  const geo = new THREE.BoxGeometry(0.6,0.6,0.6);
  if (!Build.ghost){
    Build.ghost = new THREE.Mesh(geo, mat);
    Build.ghost.name = `Ghost Cubo ${itemId}`;
    Build.ghost.renderOrder = 8;
    scene.add(Build.ghost);
  } else {
    Build.ghost.geometry.dispose();
    Build.ghost.geometry = geo;
    Build.ghost.material.dispose?.();
    Build.ghost.material = mat;
    Build.ghost.name = `Ghost Cubo ${itemId}`;
  }
  Build.ghost.visible = Build.active;
  return Build.ghost;
}
function toggleBuildMode(){
  Build.active = !Build.active;
  if (Build.active){ ensureBuildGhost(); chat('Modo construcción: ON'); }
  else { if (Build.ghost) Build.ghost.visible = false; chat('Modo construcción: OFF'); }
}
// Snap libre en X/Z; Y se controla con Build.altY (por defecto +1.0m)
function snap1(v){ return v; }
function updateBuildGhostPosition(){
  if (!Build.active) return;
  const ghost = ensureBuildGhost(); if (!ghost) return;
  const ndc = new THREE.Vector2(0,0); // centro pantalla
  raycaster.setFromCamera(ndc, camera);
  // Intersecar con plano del suelo (y=0)
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)){
    ghost.position.set(snap1(hit.x), Build.altY, snap1(hit.z));
    ghost.rotation.set(Build.rotX, Build.rotY, 0);
    ghost.visible = true;
  } else {
    ghost.visible = false;
  }
}
function placeEquippedCubeAtGhost(){
  const equipSlot = Inventory.equippedSlot;
  if (!equipSlot) { chat('No hay slot equipado'); return; }
  const itemId = Inventory.slots[equipSlot];
  if (!itemId) { chat('Slot equipado vacío'); return; }
  if (!Build.ghost || !Build.ghost.visible) { chat('No hay posición válida para colocar'); return; }
  const [line,bg,lw,rx,ry] = gridCfgById(itemId);
  const mat = makeGridMaterial(line,bg,lw,rx,ry);
  const geo = new THREE.BoxGeometry(0.6,0.6,0.6);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(Build.ghost.position);
  m.rotation.copy(Build.ghost.rotation);
  m.name = `Cubo ${itemId}`;
  m.userData = { ...(m.userData||{}), from:'placed', id:itemId };
  m.castShadow = true; m.receiveShadow = true; m.renderOrder = 6;
  scene.add(m);
  chat(`Colocado Cubo ${itemId}`);
}
function showTechCursor(){
  ensureTechCursor();
  if (!cursorActive){
    cursorPrev = document.body.style.cursor;
    document.body.style.cursor = 'none';
    // Inyectar estilo global para evitar cursor nativo sobre botones/inputs
    if (!cursorStyleEl){
      cursorStyleEl = document.createElement('style');
      cursorStyleEl.id = 'cursorNoneStyle';
      cursorStyleEl.textContent = `* { cursor: none !important; }`;
      document.head.appendChild(cursorStyleEl);
    }
  }
  techCursor.style.display = 'block'; cursorActive = true;
}
function hideTechCursor(){
  if (!techCursor) return;
  techCursor.style.display = 'none'; cursorActive = false; document.body.style.cursor = cursorPrev || 'auto';
  // Quitar estilo global si existe
  if (cursorStyleEl && cursorStyleEl.parentNode){ cursorStyleEl.parentNode.removeChild(cursorStyleEl); cursorStyleEl = null; }
}
window.addEventListener('mousemove', (e)=>{
  if (!techCursor || !cursorActive) return;
  techCursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});
function showError(msg) {
  if (overlay) {
    overlay.textContent = `ERROR: ${msg}`;
    overlay.style.background = 'rgba(128,0,0,0.6)';
  }
  console.error(msg);
}
function safeHeadHeight(){
  // No referenciar HEAD_HEIGHT directamente para evitar TDZ; usar fallback razonable
  // Si más adelante quieres centralizar, podemos leerlo de Defaults o exponerlo en una variable global temprana
  return 1.6; // altura humana estándar ~1.6m
}
window.addEventListener('error', (e) => showError(e.message || String(e.error || e)));
window.addEventListener('unhandledrejection', (e) => showError(e.reason?.message || String(e.reason || e)));

// Conexión WebSocket (robusta si se abre el HTML con file://)
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const host = (location.protocol === 'file:' || !location.host) ? 'localhost:3000' : location.host;
const ws = new WebSocket(`${proto}://${host}`);
ws.addEventListener('open', () => console.log('WS conectado'));
ws.addEventListener('error', () => showError(`WebSocket error (intentando ${proto}://${host})`));
ws.addEventListener('close', () => showError('WebSocket cerrado'));
let myId = null;
let ready = false; // bloquea control hasta confirmar personalización
let myCosmetics = { name: 'Cliente', color: Defaults.player?.defaultColor || '#4488ff', accessories: [], form: 'classic' };

// Estado local
const state = {
  players: new Map(), // id -> { mesh, data, target:{pos,yaw}, last:{pos} }
  enemies: new Map(), // id -> { mesh, data, target:{pos,yaw}, hpBar }
  coins: new Map(),   // id -> { mesh }
  mazeBuilt: false,
  mazeGroup: null,
  spawnMesh: null,
  roofsAdded: false,
  safeFloorsAdded: false,
  houseAdded: false,
  houseGroup: null,
  currentMap: 1,
};

// Referencias para decoraciones y FX en Mapa 1
state.wavyPlatforms = []; // { mesh, uniforms }
state.fractals = []; // { mesh, type: 'shader'|'canvas' }
state.decorAdded = false; // flag para asegurar adición única

// Utilidades de zonas seguras (centros de spawn por mapa y radio)
function getMapSpawnPos(map){
  const half = Defaults.world.halfSize;
  const x = (map === 1) ? (-half + 2 + Defaults.world.map1OffsetX) : (-half + 2);
  const z = -half + 2;
  return { x, z };
}
function isInSafeZoneLocal(map, x, z) {
  const c = getMapSpawnPos(map);
  const r = Defaults.base?.exclusionRadius ?? 6.0;
  const dx = x - c.x, dz = z - c.z;
  return (dx*dx + dz*dz) <= r*r;
}

// Techo visual sobre las casas (solo visual, sin colisión)
function ensureRoofs(){
  if (state.roofsAdded) return;
  // Eliminado: no crear techos visuales
  state.roofsAdded = true;
}

// Piso visual futurista sobre la zona segura (solo visual, sin colisión)
function ensureSafeFloors(){
  if (state.safeFloorsAdded) return;
  const y = 0.03; // sobre el suelo para evitar z-fighting
  const baseSize = Defaults.world.halfSize * 2; // cubrir todo el Mapa 1
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  // Base semitransparente en todo el mapa
  const base = new THREE.Mesh(new THREE.PlaneGeometry(baseSize, baseSize), new THREE.MeshBasicMaterial({ color: 0x0a0f15, transparent:true, opacity:0.5 }));
  base.rotation.x = -Math.PI/2; base.position.y = y;
  group.add(base);
  // Grilla de cuadrados 1x1 m
  const divisions = Math.max(1, Math.round(baseSize));
  const grid = new THREE.GridHelper(baseSize, divisions, 0x33ccff, 0x115566);
  grid.position.y = y + 0.001;
  if (grid.material && !Array.isArray(grid.material)){
    grid.material.transparent = true;
    grid.material.opacity = 0.85;
    grid.material.depthWrite = false;
  }
  group.add(grid);
  scene.add(group);
  // Si en el futuro deseas también en Mapa 2, descomenta:
  // const s2 = getMapSpawnPos(2); makeFloorAt(s2.x, s2.z);
  state.safeFloorsAdded = true;
}

// Material cuadriculado similar al GridHelper usando textura de canvas
function makeGridMaterial(lineColor = '#0ff', bgColor = 'rgba(0,0,0,0.35)', lineWidth = 2, repeatX = 8, repeatY = 8){
  const size = 256;
  const cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d');
  // fondo
  ctx.fillStyle = bgColor;
  ctx.fillRect(0,0,size,size);
  // líneas
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  const step = size / 8; // base 8 celdas, luego repetimos por repeatX/Y
  for (let i=0;i<=8;i++){
    const t = Math.round(i*step) + 0.5; // pixel snapping para nitidez
    ctx.beginPath(); ctx.moveTo(t,0); ctx.lineTo(t,size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,t); ctx.lineTo(size,t); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent:true, opacity:0.9, depthWrite:false, side: THREE.DoubleSide });
  return mat;
}

// Casa simple en el spawn del Mapa 1: 4 paredes con grilla y una plataforma como techo
function ensureHouseAtSpawn(){
  if (state.houseAdded) return;
  // Colocar la casa en el centro del Mapa 1: x = map1OffsetX, z = 0
  const c = { x: Defaults.world.map1OffsetX, z: 0 };
  const group = new THREE.Group();
  const wallH = 3.2;
  const sizeX = 6.0, sizeZ = 6.0; // dimensiones de la casa
  const thickness = 0.06;

  // Material cuadriculado para paredes y techo
  const wallMat = makeGridMaterial('#33ccff', 'rgba(2,16,23,0.55)', 2, 6, 3);
  const roofBaseMat = new THREE.MeshBasicMaterial({ color: 0x0a0f15, transparent:true, opacity:0.7 });

  // Paredes: usamos PlaneGeometry para cada lado
  const mkWall = (w, h)=> new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat.clone());
  // Norte
  const wallN = mkWall(sizeX, wallH); wallN.position.set(c.x, wallH/2, c.z - sizeZ/2); wallN.rotation.y = Math.PI;
  // Sur
  const wallS = mkWall(sizeX, wallH); wallS.position.set(c.x, wallH/2, c.z + sizeZ/2);
  // Este
  const wallE = mkWall(sizeZ, wallH); wallE.position.set(c.x + sizeX/2, wallH/2, c.z); wallE.rotation.y = -Math.PI/2;
  // Oeste
  const wallW = mkWall(sizeZ, wallH); wallW.position.set(c.x - sizeX/2, wallH/2, c.z); wallW.rotation.y = Math.PI/2;
  [wallN, wallS, wallE, wallW].forEach(w=>{ w.renderOrder = 5; group.add(w); });

  // Techo: plataforma con base y grilla encima para simular el estilo del piso
  const roofY = wallH + 0.02;
  const roofBase = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), roofBaseMat);
  roofBase.rotation.x = -Math.PI/2; roofBase.position.set(c.x, roofY, c.z);
  const roofGrid = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), makeGridMaterial('#33ccff', 'rgba(0,0,0,0)', 2, 6, 6));
  roofGrid.rotation.x = -Math.PI/2; roofGrid.position.set(c.x, roofY + 0.002, c.z);
  roofGrid.renderOrder = 6;
  group.add(roofBase); group.add(roofGrid);

  // Borde del techo (marco): líneas finas para realce visual
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(sizeX, thickness, sizeZ));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x33ccff, transparent:true, opacity:0.8 });
  const edge = new THREE.LineSegments(edgeGeo, edgeMat);
  edge.position.set(c.x, roofY + thickness/2, c.z);
  group.add(edge);

  scene.add(group);
  state.houseGroup = group;
  state.houseAdded = true;
}

// Plataforma ondulada 1x1 m con grilla fina y animación suave
function addWavyPlatformAt(x, z, size = 1.0){
  const uniforms = {
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color(0x0ff0fc) },
    uColorB: { value: new THREE.Color(0x073b3f) },
    uGridAlpha: { value: 0.85 },
  };
  const vs = `
    varying vec2 vUv;
    uniform float uTime;
    void main(){
      vUv = uv;
      vec3 p = position;
      // Onda suave en Y
      float w = 0.05 * sin( (p.x*8.0 + uTime*2.5) ) * cos( (p.z*8.0 - uTime*2.0) );
      p.y += w;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
    }
  `;
  const fs = `
    varying vec2 vUv;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uGridAlpha;
    // Grilla fina
    float grid(vec2 uv, float N){
      vec2 g = abs(fract(uv*N - 0.5) - 0.5) / fwidth(uv*N);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      return smoothstep(0.0, 1.0, line);
    }
    void main(){
      // Base oscura
      vec3 base = mix(uColorB*0.25, uColorB*0.45, 0.5);
      // Grilla 1x1 subdividida fina
      float g1 = grid(vUv, 10.0);
      vec3 col = base + (uColorA * 0.6) * g1;
      gl_FragColor = vec4(col, uGridAlpha);
    }
  `;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent:true, depthWrite:false });
  const geo = new THREE.PlaneGeometry(size, size, 32, 32);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI/2;
  mesh.position.set(x, 0.02, z);
  mesh.renderOrder = 8;
  scene.add(mesh);
  state.wavyPlatforms.push({ mesh, uniforms });
  return mesh;
}

// Fractal Mandelbrot (shader vistoso) sobre plano 1x1 m
function addMandelbrotShaderAt(x, z, size = 1.0){
  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2(-0.5, 0.0) },
    uScale: { value: 2.5 },
    uColor1: { value: new THREE.Color(0x001018) },
    uColor2: { value: new THREE.Color(0x00e0ff) },
    uColor3: { value: new THREE.Color(0xff66aa) },
  };
  const vs = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `;
  const fs = `
    varying vec2 vUv;
    uniform float uTime; uniform vec2 uCenter; uniform float uScale;
    uniform vec3 uColor1, uColor2, uColor3;
    vec3 palette(float t){
      return mix(uColor2, uColor3, smoothstep(0.0,1.0, t)) + 0.15*sin(vec3(0.0,2.0,4.0)+t*6.2831);
    }
    void main(){
      // Mapear UV a plano complejo
      float aspect = 1.0; // plano cuadrado
      vec2 uv = (vUv - 0.5) * vec2(uScale*aspect, uScale);
      uv += uCenter;
      // Zoom/pulso sutil
      float zoom = 1.0 + 0.15*sin(uTime*0.6);
      uv /= zoom;
      vec2 c = uv;
      vec2 z = vec2(0.0);
      float it = 0.0;
      const int MAX_IT = 100;
      for (int i=0;i<MAX_IT;i++){
        // z = z^2 + c
        vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
        z = z2 + c;
        if (dot(z,z) > 256.0){ it = float(i); break; }
      }
      float t = it/float(MAX_IT);
      vec3 col = mix(uColor1, palette(t), smoothstep(0.0,1.0,t));
      gl_FragColor = vec4(col, 0.95);
    }
  `;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent:true, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 1.0, z);
  // Ligeramente inclinado para captar luz
  mesh.rotation.y = Math.PI/8;
  scene.add(mesh);
  state.fractals.push({ mesh, type: 'shader', uniforms });
  return mesh;
}

// Fractal Mandelbrot (simple): textura Canvas precalculada en plano 1x1 m
function addMandelbrotCanvasAt(x, z, size = 1.0){
  const N = 256;
  const cvs = document.createElement('canvas'); cvs.width = N; cvs.height = N;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(N, N);
  const cx = -0.5, cy = 0.0, scale = 2.5;
  const maxIt = 64;
  for (let j=0;j<N;j++){
    for (let i=0;i<N;i++){
      const u = (i+0.5)/N, v = (j+0.5)/N;
      let a = (u-0.5)*scale + cx;
      let b = (v-0.5)*scale + cy;
      let x0 = 0, y0 = 0;
      let it = 0;
      while (x0*x0 + y0*y0 <= 256 && it < maxIt){
        const x1 = x0*x0 - y0*y0 + a;
        const y1 = 2*x0*y0 + b;
        x0 = x1; y0 = y1; it++;
      }
      const t = it/maxIt;
      const idx = (j*N + i)*4;
      const r = Math.floor(20 + 200*t);
      const g = Math.floor(40 + 180*(1.0 - t*t));
      const bcol = Math.floor(80 + 120*t);
      img.data[idx+0] = r; img.data[idx+1] = g; img.data[idx+2] = bcol; img.data[idx+3] = 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent:true, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0.9, z+1.2);
  mesh.rotation.y = -Math.PI/10;
  scene.add(mesh);
  state.fractals.push({ mesh, type: 'canvas' });
  return mesh;
}

// Flags de rendimiento (activar según necesidad)
const DRAW_WALL_EDGES = false; // líneas de borde en muros (costoso)

// THREE.js escena básica
const scene = new THREE.Scene();
// Cuadrícula métrica (1m) en planos XZ, XY y YZ, con toggle (G)
let metricGridGroup = null;
let metricGridOn = false;
function ensureMetricGrids(){
  if (metricGridGroup) return metricGridGroup;
  const size = 20; // metros
  const divisions = size; // 1m por división
  const mkGrid = (color1, color2)=>{
    const g = new THREE.GridHelper(size, divisions, color1, color2);
    if (g.material && !Array.isArray(g.material)){
      g.material.transparent = true;
      g.material.opacity = 0.35;
      g.material.depthWrite = false;
    }
    return g;
  };
  const grp = new THREE.Group();
  // XZ en el suelo
  const gXZ = mkGrid(0x33ccff, 0x115566); gXZ.rotation.x = 0; gXZ.position.y = 0.02; grp.add(gXZ);
  // XY vertical, perpendicular a Z (pared frontal)
  const gXY = mkGrid(0xff6699, 0x552233); gXY.rotation.x = Math.PI/2; grp.add(gXY);
  // YZ vertical, perpendicular a X (pared lateral)
  const gYZ = mkGrid(0x66ff99, 0x235533); gYZ.rotation.z = Math.PI/2; grp.add(gYZ);
  grp.visible = false;
  scene.add(grp);
  metricGridGroup = grp; return grp;
}

// ===== Inventario básico (items por cubo numerado, slots 3–0 y HUD) =====
const Inventory = {
  selectedItemId: null, // id de textura/cubo seleccionado (1..10)
  items: new Map(),     // id -> { id, name }
  slots: { '3':null,'4':null,'5':null,'6':null,'7':null,'8':null,'9':null,'0':null },
  equippedSlot: null,
  hud: null,
};
function ensureInventoryHUD(){
  if (Inventory.hud) return Inventory.hud;
  const hud = document.createElement('div');
  hud.id = 'inv-hud';
  Object.assign(hud.style, {
    position:'fixed', left:'50%', bottom:'18px', transform:'translateX(-50%)',
    display:'block', padding:'8px 10px', background:'rgba(0, 20, 30, 0.55)', border:'1px solid rgba(0, 200, 255, 0.35)',
    color:'#d9f7ff', fontFamily:'12px monospace', fontSize:'12px', borderRadius:'8px', zIndex: 10000,
    pointerEvents:'none', boxShadow:'0 0 12px rgba(0,200,255,0.25) inset, 0 0 8px rgba(0,200,255,0.15)'
  });
  const bar = document.createElement('div'); bar.style.display='flex'; bar.style.gap='6px';
  const keys = ['3','4','5','6','7','8','9','0'];
  for (const k of keys){
    const slot = document.createElement('div');
    slot.dataset.slot = k; slot.style.minWidth='42px'; slot.style.minHeight='42px';
    slot.style.display='flex'; slot.style.alignItems='center'; slot.style.justifyContent='center';
    slot.style.border='1px solid rgba(0,200,255,0.35)'; slot.style.background='rgba(0, 40, 60, 0.35)';
    slot.style.borderRadius='6px'; slot.style.boxShadow='inset 0 0 0 1px rgba(0,200,255,0.15)';
    slot.textContent = k;
    bar.appendChild(slot);
  }
  const info = document.createElement('div'); info.id='inv-info'; info.style.marginTop='6px'; info.style.opacity='0.9'; info.textContent='Ningún cubo equipado';
  const selRow = document.createElement('div'); selRow.style.display='flex'; selRow.style.alignItems='center'; selRow.style.gap='8px'; selRow.style.marginTop='4px';
  const selLbl = document.createElement('div'); selLbl.textContent = 'Seleccionado:'; selLbl.style.opacity='0.8'; selLbl.style.fontSize='11px';
  const selPrev = document.createElement('div'); selPrev.id='inv-selected-preview'; selPrev.style.width='32px'; selPrev.style.height='32px'; selPrev.style.border='1px solid rgba(0,200,255,0.35)'; selPrev.style.borderRadius='4px'; selPrev.style.background='rgba(0, 40, 60, 0.35)'; selPrev.style.backgroundSize='cover'; selPrev.style.backgroundPosition='center';
  selRow.appendChild(selLbl); selRow.appendChild(selPrev);
  // Barra de experiencia bajo el texto
  const xpWrap = document.createElement('div'); xpWrap.style.marginTop='4px';
  const xpBar = document.createElement('div'); xpBar.style.height='10px'; xpBar.style.background='#001722'; xpBar.style.border='1px solid #003244'; xpBar.style.borderRadius='6px'; xpBar.style.overflow='hidden';
  const xpFill = document.createElement('div'); xpFill.id='invXpFill'; xpFill.style.height='100%'; xpFill.style.width='0%'; xpFill.style.background='#00bbff';
  xpBar.appendChild(xpFill); xpWrap.appendChild(xpBar);
  hud.appendChild(bar); hud.appendChild(info); hud.appendChild(selRow); hud.appendChild(xpWrap);
  document.body.appendChild(hud);
  Inventory.hud = hud; return hud;
}
function updateInventoryHUD(){
  const hud = ensureInventoryHUD();
  const keys = ['3','4','5','6','7','8','9','0'];
  for (const k of keys){
    const el = hud.querySelector(`div[data-slot="${k}"]`);
    if (!el) continue;
    const itemId = Inventory.slots[k];
    el.style.outline = (Inventory.equippedSlot === k ? '2px solid #ffcc55' : 'none');
    el.style.opacity = itemId ? '1' : '0.4';
    el.title = itemId ? `Cubo ${itemId}` : `Slot ${k}`;
    if (itemId){
      const url = makeGridPreviewDataURL(itemId, 42);
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.textContent = k;
    }
  }
  const info = hud.querySelector('#inv-info');
  if (info){
    const eq = Inventory.equippedSlot ? Inventory.slots[Inventory.equippedSlot] : null;
    info.textContent = eq ? `Equipado: Cubo ${eq} (slot ${Inventory.equippedSlot})` : 'Ningún cubo equipado';
  }
  // Preview del ítem seleccionado (aunque no esté asignado a slot)
  try{
    const sel = Inventory.selectedItemId;
    const el = document.getElementById('inv-selected-preview');
    if (el){
      if (sel){ el.style.backgroundImage = `url(${makeGridPreviewDataURL(sel, 32)})`; }
      else { el.style.backgroundImage = ''; }
    }
  }catch{}
  // Sincronizar XP en HUD tecnológico con HUD general si existe
  try{
    const self = state.players.get(myId)?.data;
    const need = Defaults.player.levelUpXP ?? 100;
    const xp = Math.max(0, self?.xp ?? 0);
    const frac = Math.max(0, Math.min(1, xp/need));
    const invXp = document.getElementById('invXpFill'); if (invXp) invXp.style.width = `${Math.round(frac*100)}%`;
  }catch{}
  try { updateCubosSolidFlags(); } catch {}
}

// Actualizar flags de solidez para Cubo 1 principal y Cubo 1 de Cubos 2 (cuando equipado)
function updateCubosSolidFlags(){
  try{
    if (state.mainCubo1) state.mainCubo1.userData.solid = true;
    const equipId = Inventory.equippedSlot ? Inventory.slots[Inventory.equippedSlot] : null;
    const c1 = state.cubos2ById?.get(1);
    if (c1){ c1.userData.solid = (equipId === 1); }
  }catch{}
}
// HUD del inventario siempre visible (no se oculta con V). V abrirá un inventario separado de botín.
function ensureLootInventory(){
  if (document.getElementById('loot-inventory')) return;
  const p = document.createElement('div'); p.id='loot-inventory';
  Object.assign(p.style, { position:'fixed', right:'16px', bottom:'100px', width:'320px', minHeight:'120px',
    background:'rgba(0,12,18,0.75)', border:'1px solid rgba(0,200,255,0.35)', color:'#d9f7ff', borderRadius:'8px', padding:'8px 10px', display:'none', zIndex:10001 });
  p.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><div style="opacity:0.85;">Inventario (botín)</div><div style="opacity:0.7; font-size:12px;">Drop de slimes</div></div><div id="lootGrid" style="display:grid; grid-template-columns: repeat(5, 1fr); gap:6px;"></div>`;
  document.body.appendChild(p);
}
function toggleLootInventory(){ ensureLootInventory(); const p = document.getElementById('loot-inventory'); if (p) p.style.display = (p.style.display==='none'?'block':'none'); }
function addItemToInventory(id){
  if (id<1 || id>10) return;
  if (!Inventory.items.has(id)) Inventory.items.set(id, { id, name: `Cubo ${id}` });
  Inventory.selectedItemId = id;
  chat(`Seleccionado Cubo ${id} (añadido al inventario)`);
  updateInventoryHUD();
}
function tryAssignToSlot(slotKey){
  if (!Inventory.selectedItemId) {
    // Si ya existe item en slot, equiparlo
    if (Inventory.slots[slotKey]){
      Inventory.equippedSlot = slotKey;
      chat(`Equipado Cubo ${Inventory.slots[slotKey]} en slot ${slotKey}`);
      updateInventoryHUD();
      // si está en modo construcción, actualizar ghost
      try { if (Build.active) { ensureBuildGhost(); updateBuildGhostPosition(); } } catch {}
    } else chat(`No hay selección para asignar al slot ${slotKey}`);
    return;
  }
  Inventory.slots[slotKey] = Inventory.selectedItemId;
  Inventory.equippedSlot = slotKey;
  chat(`Asignado Cubo ${Inventory.selectedItemId} al slot ${slotKey} y equipado`);
  updateInventoryHUD();
  // si está en modo construcción, actualizar ghost
  try { if (Build.active) { ensureBuildGhost(); updateBuildGhostPosition(); } } catch {}
}
// Fondo y niebla por mapa activo
function applySkyForMap(map){
  if (map === 1){
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 20, 90);
  } else {
    // Mapa 2: volver a negro como antes
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 20, 90);
  }
}
applySkyForMap(1);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 200);
// Orden de rotación tipo FPS: primero Y (yaw), luego X (pitch) para evitar gimbal lock
camera.rotation.order = 'YXZ';
console.log('Creando renderer Three.js');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
// Asegurar que el canvas pueda recibir foco para eventos de teclado
renderer.domElement.setAttribute('tabindex', '0');
renderer.domElement.style.outline = 'none';
// Retícula FPS
ensureFpsReticle();
// UI de personalización previa
const ui = document.createElement('div');
ui.id = 'customizeUI';
ui.style.position = 'fixed';
ui.style.left = '50%'; ui.style.top = '50%'; ui.style.transform = 'translate(-50%, -50%)';
ui.style.background = 'rgba(0,0,0,0.7)'; ui.style.color = '#e8f7ff';
ui.style.padding = '16px 18px'; ui.style.border = '1px solid #0af'; ui.style.borderRadius = '10px';
ui.style.zIndex = '9999'; ui.style.minWidth = '320px';
ui.innerHTML = `
  <div style="font: 16px/1.4 system-ui, sans-serif; display:flex; gap:12px; align-items:stretch;">
    <div style="flex:1; min-width:240px;">
      <div style="font-weight:600; margin-bottom:8px;">Personaliza tu personaje</div>
      <label style="display:block; margin:6px 0 4px;">Nombre</label>
      <input id="nameInput" type="text" maxlength="20" value="${myCosmetics.name}" style="width:100%; padding:6px; border-radius:6px; border:1px solid #0af; background:#03131a; color:#e8f7ff;" />
      <label style="display:block; margin:10px 0 4px;">Forma</label>
      <div id="formGroup" style="display:flex; gap:8px;">
        <label><input type="radio" name="form" value="classic" checked/> Clásico</label>
        <label><input type="radio" name="form" value="futuristic"/> Futurista</label>
        <label><input type="radio" name="form" value="technologic"/> Tecnológico</label>
        <label><input type="radio" name="form" value="medieval"/> Medieval</label>
        <label><input type="radio" name="form" value="cyberpunk"/> Cyberpunk</label>
        <label><input type="radio" name="form" value="cartoon"/> Cartoon</label>
        <label><input type="radio" name="form" value="steampunk"/> Steampunk</label>
        <label><input type="radio" name="form" value="slime"/> Cabeza de Slime</label>
      </div>
      <label style="display:block; margin:10px 0 4px;">Color</label>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
        <button class="presetColor" data-color="#000000" title="Negro" style="width:24px; height:24px; border-radius:4px; border:1px solid #0af; background:#000000"></button>
        <button class="presetColor" data-color="#4488ff" title="Azul" style="width:24px; height:24px; border-radius:4px; border:1px solid #0af; background:#4488ff"></button>
        <button class="presetColor" data-color="#ff5566" title="Rojo" style="width:24px; height:24px; border-radius:4px; border:1px solid #0af; background:#ff5566"></button>
        <button class="presetColor" data-color="#66ff66" title="Verde" style="width:24px; height:24px; border-radius:4px; border:1px solid #0af; background:#66ff66"></button>
        <button class="presetColor" data-color="#ffaa33" title="Naranja" style="width:24px; height:24px; border-radius:4px; border:1px solid #0af; background:#ffaa33"></button>
      </div>
      
      <button id="startBtn" style="margin-top:12px; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #0af; background:#072734; color:#e8f7ff; font-weight:700; cursor:pointer;">Comenzar</button>
    </div>
    <div style="width:220px; display:flex; flex-direction:column; gap:6px; align-items:center;">
      <div style="opacity:0.85; font-weight:600;">Vista previa</div>
      <canvas id="previewCanvas" width="200" height="220" style="background:#021017; border:1px solid #0af; border-radius:8px;"></canvas>
      <div id="previewHint" style="font-size:12px; color:#9bd; opacity:0.85;">Así se verá tu personaje</div>
    </div>
  </div>
`;
document.body.appendChild(ui);
function gatherCosmetics(){
  const name = (document.getElementById('nameInput')?.value || 'Jugador').trim().substring(0,20) || 'Jugador';
  // color seleccionado por botones; si no se tocó, default
  const color = (window.__selectedColor || '#4488ff');
  const form = (document.querySelector('#formGroup input[name="form"]:checked')?.value || 'classic');
  return { name, color, accessories: [], form };
}
document.getElementById('startBtn')?.addEventListener('click', () => {
  myCosmetics = gatherCosmetics();
  // Enviar Hello con cosméticos
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MessageTypes.Hello, name: myCosmetics.name, color: myCosmetics.color, accessories: myCosmetics.accessories, form: myCosmetics.form }));
  }
  ready = true;
  ui.style.display = 'none';
  // Capturar puntero automáticamente para jugar sin clic adicional
  try {
    renderer.domElement.focus();
    renderer.domElement.requestPointerLock();
  } catch {}
  if (!isAnyMenuOpen()) hideTechCursor();
});

// Vista previa simple en el panel
let preview = null;
function initPreview(){
  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;
  const r = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  r.setSize(canvas.width, canvas.height, false);
  const sc = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, canvas.width/canvas.height, 0.1, 50);
  cam.position.set(0, 1.4, 3.2);
  const amb = new THREE.AmbientLight(0xffffff, 0.7); sc.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(3,4,2); sc.add(dir);
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshStandardMaterial({ color:0x0a222e, roughness:1 }));
  gnd.rotation.x = -Math.PI/2; gnd.position.y = 0; sc.add(gnd);
  let mesh = null;
  function rebuild(){
    // limpiar anterior
    if (mesh){ sc.remove(mesh); mesh.traverse(o=>{ if(o.geometry) o.geometry.dispose?.(); if(o.material) o.material.dispose?.(); }); }
    const sel = gatherCosmetics();
    mesh = makePlayerMesh(false, sel.color, sel.form); // en preview nunca ocultamos el mesh
    mesh.position.set(0, 0, 0);
    sc.add(mesh);
  }
  function render(){
    requestAnimationFrame(render);
    if (mesh) mesh.rotation.y += 0.01;
    r.render(sc, cam);
  }
  rebuild(); render();
  preview = { rebuild };
}
initPreview();

// Actualizar preview al cambiar opciones
function onChangeUpdatePreview(){ if (preview?.rebuild) preview.rebuild(); }
document.getElementById('nameInput')?.addEventListener('input', onChangeUpdatePreview);
document.querySelectorAll('#formGroup input[name="form"]').forEach(el=> el.addEventListener('change', onChangeUpdatePreview));
document.querySelectorAll('.presetColor').forEach(btn => btn.addEventListener('click', (e)=>{ const c=e.currentTarget.getAttribute('data-color'); window.__selectedColor=c; onChangeUpdatePreview(); }));
['accEngineer','accChemist','accLabCoat','accArmor'].forEach(id=> document.getElementById(id)?.addEventListener('change', onChangeUpdatePreview));
// Chat/Log overlay in-game
let chatDiv = document.createElement('div');
chatDiv.id = 'chatLog';
chatDiv.style.position = 'fixed';
chatDiv.style.left = '10px';
chatDiv.style.bottom = '10px';
chatDiv.style.width = '36vw';
chatDiv.style.maxHeight = '32vh';
chatDiv.style.overflowY = 'auto';
chatDiv.style.font = '12px monospace';
chatDiv.style.color = '#d9f7ff';
chatDiv.style.background = 'rgba(0, 20, 30, 0.35)';
chatDiv.style.border = '1px solid rgba(0, 200, 255, 0.25)';
chatDiv.style.padding = '6px 8px';
chatDiv.style.borderRadius = '6px';
chatDiv.style.pointerEvents = 'none';
document.body.appendChild(chatDiv);

// Campo de entrada para chat (toggle con Enter)
let chatting = false;
const chatInput = document.createElement('input');
chatInput.type = 'text';
chatInput.placeholder = 'Escribe y presiona Enter...';
chatInput.style.position = 'fixed';
chatInput.style.left = '10px';
chatInput.style.bottom = '10px';
chatInput.style.width = '36vw';
chatInput.style.font = '14px system-ui, sans-serif';
chatInput.style.padding = '6px 8px';
chatInput.style.border = '1px solid rgba(0, 200, 255, 0.4)';
chatInput.style.borderRadius = '6px';
chatInput.style.background = 'rgba(0, 20, 30, 0.75)';
chatInput.style.color = '#d9f7ff';
chatInput.style.display = 'none';
chatInput.style.pointerEvents = 'auto';
document.body.appendChild(chatInput);

function toggleChatInput(on){
  chatting = !!on;
  chatInput.style.display = chatting ? 'block' : 'none';
  if (chatting) {
    if (pointerLocked) document.exitPointerLock();
    setTimeout(()=> chatInput.focus(), 0);
  } else {
    chatInput.blur();
  }
}

function chat(msg){
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.textContent = `[${time}] ${msg}`;
  chatDiv.appendChild(line);
  // limitar a 50 líneas
  while (chatDiv.children.length > 50) chatDiv.removeChild(chatDiv.firstChild);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}
// HUD 2D para el jugador local
let hudRoot = document.createElement('div');
hudRoot.id = 'hud2d';
hudRoot.style.position = 'fixed';
hudRoot.style.right = '10px';
hudRoot.style.bottom = '10px';
hudRoot.style.width = '260px';
hudRoot.style.font = '13px system-ui, sans-serif';
hudRoot.style.color = '#d9f7ff';
hudRoot.style.background = 'rgba(0, 20, 30, 0.35)';
hudRoot.style.border = '1px solid rgba(0, 200, 255, 0.25)';
hudRoot.style.padding = '8px 10px';
hudRoot.style.borderRadius = '8px';
hudRoot.style.pointerEvents = 'none';
hudRoot.innerHTML = `
  <div style="margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
    <div style="opacity:0.85;">Estado</div>
    <div id="hudLevel" style="font-weight:700;">Lv 1</div>
  </div>
  <div style="margin:4px 0;">HP</div>
  <div style="height:14px; background:#220000; border:1px solid #440000; border-radius:6px; overflow:hidden;">
    <div id="hudHpFill" style="height:100%; width:100%; background:#00ff66;"></div>
  </div>
  <div style="margin:8px 0 4px;">XP</div>
  <div style="height:12px; background:#001722; border:1px solid #003244; border-radius:6px; overflow:hidden;">
    <div id="hudXpFill" style="height:100%; width:0%; background:#00bbff;"></div>
  </div>
`;
document.body.appendChild(hudRoot);
// Asegurar HUD de inventario visible desde el inicio (slots 3..0, XP, seleccionado)
try { updateInventoryHUD(); } catch {}
function updateHUD(p){
  const maxHp = Defaults.player.hp ?? 5;
  const need = Defaults.player.levelUpXP ?? 100;
  const hp = Math.max(0, Math.min(maxHp, p?.hp ?? maxHp));
  const xp = Math.max(0, p?.xp ?? 0);
  const lvl = Math.max(1, p?.level ?? 1);
  const fracHp = Math.max(0, Math.min(1, hp / maxHp));
  const fracXp = Math.max(0, Math.min(1, xp / need));
  const hpFill = document.getElementById('hudHpFill');
  const xpFill = document.getElementById('hudXpFill');
  const lvlEl = document.getElementById('hudLevel');
  if (hpFill) hpFill.style.width = `${Math.round(fracHp*100)}%`;
  if (xpFill) xpFill.style.width = `${Math.round(fracXp*100)}%`;
  if (lvlEl) lvlEl.textContent = `Lv ${lvl}`;
}
// Posición inicial de cámara para evitar pantalla negra antes de recibir el snapshot
camera.position.set(0, 1.6, 0);
camera.lookAt(new THREE.Vector3(0, 1.6, -1));

// Reloj para delta time
const clock = new THREE.Clock();
let camTarget = new THREE.Vector3(0, 1.6, 0);
// (definido arriba) const FIRST_PERSON, const HEAD_HEIGHT

// Utilidades de suavizado
function dampFactor(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Luz y suelo
const ambient = new THREE.AmbientLight(0x99ccff, 0.4);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xaad4ff, 0.8);
dirLight.position.set(8,14,6);
scene.add(dirLight);

const groundGeo = new THREE.PlaneGeometry(Defaults.world.halfSize*2, Defaults.world.halfSize*2, 10,10);
const groundMat = new THREE.MeshPhongMaterial({ color: 0x0e2a1a, wireframe:false });
// Suelo y grilla del Mapa 2 (centrados en 0,0)
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI/2;
scene.add(ground);
const grid = new THREE.GridHelper(Defaults.world.halfSize*2, 24, 0x0ff0fc, 0x073b3f);
grid.position.y = 0.01;
grid.material.opacity = 0.25;
grid.material.transparent = true;
grid.material.side = THREE.DoubleSide;
scene.add(grid);
// Suelo y grilla del Mapa 1 (mismo estilo, desplazados en X)
const groundMap1 = new THREE.Mesh(groundGeo.clone(), groundMat);
groundMap1.rotation.x = -Math.PI/2;
groundMap1.position.x = Defaults.world.map1OffsetX;
scene.add(groundMap1);
const gridMap1 = new THREE.GridHelper(Defaults.world.halfSize*2, 24, 0x0ff0fc, 0x073b3f);
gridMap1.position.y = 0.01;
gridMap1.position.x = Defaults.world.map1OffsetX;
gridMap1.material.opacity = 0.25;
gridMap1.material.transparent = true;
gridMap1.material.side = THREE.DoubleSide;
scene.add(gridMap1);

// Mostrar cursor tecnológico al inicio (personalización)
showTechCursor();

// Añadir techo y piso futurista en zona segura
try { ensureRoofs(); } catch {}
try { ensureSafeFloors(); } catch {}
try { ensureHouseAtSpawn(); } catch {}

// Decoraciones del Mapa 1: plataforma ondulada y muestras de texturas (sin fractales)
function ensureMap1Decor(){
  if (state.decorAdded) return;
  const ox = Defaults.world.map1OffsetX;
  // Centro de la zona segura/casa en Mapa 1
  const half = Defaults.world.halfSize;
  const sx = (-half + 2) + ox;
  const sz = (-half + 2);

  // Decoraciones en zona segura del Mapa 1: cubo translúcido y dodecaedro metálico
  try {
    // (sx, sz) es el centro de la casa/zona segura

    // Cubo con textura cuadriculada similar a la plataforma
    {
      const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      // Usar la textura N°1 del mapa (cfg índice 0 de addGridSampleTilesAt):
      // ['#ffffff', 'rgba(0,0,0,0.85)', 2, 4, 4]
      const mat = makeGridMaterial('#ffffff', 'rgba(0,0,0,0.85)', 2, 4, 4);
      const cube = new THREE.Mesh(geo, mat);
      cube.position.set(sx + 1.5, 0.6, sz + 1.0);
      // Nombrar para referencia
      cube.name = 'Cubo 1';
      cube.userData = { ...(cube.userData||{}), label: 'Cubo 1', solid:true };
      cube.castShadow = true; cube.receiveShadow = true;
      scene.add(cube);
      state.mainCubo1 = cube;

      // Plataforma ondulada por encima del cubo translúcido
      const plat = addWavyPlatformAt(cube.position.x, cube.position.z, 1.0);
      // Elevarla por encima del cubo (top ~1.0), colocar a ~1.2m
      plat.position.y = 1.2;

      // Muestra plana al costado con la MISMA textura del cubo, numerada distinto
      try {
        const sideGeo = new THREE.PlaneGeometry(1.0, 1.0);
        const side = new THREE.Mesh(sideGeo, mat.clone());
        side.rotation.x = -Math.PI/2;
        const off = 1.2; // separación lateral
        side.position.set(cube.position.x + off, 0.021, cube.position.z);
        side.renderOrder = 9;
        scene.add(side);
        // Etiqueta con otro número (por ejemplo "11") para diferenciarla del tile #1
        const label = makeLabelSprite('11', '#ffffff');
        label.scale.set(0.18, 0.10, 1);
        label.position.set(side.position.x, 0.12, side.position.z);
        scene.add(label);
      } catch {}
    }

    // Dodecaedro con textura cuadriculada por encima de la plataforma ondulada, elevado ~2m
    {
      const geo = new THREE.DodecahedronGeometry(0.6, 0);
      const mat = makeGridMaterial('#33ccff', 'rgba(2,16,23,0.35)', 2, 4, 4);
      const dode = new THREE.Mesh(geo, mat);
      // Posición centrada con el cubo/plataforma y más arriba (+2m aprox), luego -1m solicitado => 3.6 - 1 = 2.6
      dode.position.set(sx + 1.5, 2.6, sz + 1.0);
      dode.castShadow = true; dode.receiveShadow = true;
      // ligera rotación para interés visual
      dode.rotation.set(0.3, 0.4, 0.1);
      scene.add(dode);
    }
  } catch {}

  // Eliminar cualquier fractal existente del estado/escena
  try {
    if (Array.isArray(state.fractals)) {
      for (const f of state.fractals) { if (f?.mesh) scene.remove(f.mesh); }
      state.fractals.length = 0;
    }
  } catch {}

  // Agregar tira de cuadrados 0.12m con texturas de grilla numeradas y contrastadas
  try {
    // (Eliminado) Tira de cuadrados con texturas numeradas en el piso
    // Solicitud: remover texturas 1..11 del piso
    // Antes: addGridSampleTilesAt(startX, startZ, 10, 1.0, 0.02);
  } catch {}

  // Crear cubos con las 10 texturas numeradas, posicionados dentro de la zona segura del Mapa 1
  function spawnTextureCubesInSafeZone(sx, sz){
  try{
    // Centro de la casa en Mapa 1
    const c = { x: sx, z: sz };
      // Reubicar dentro de la casa (rectángulo ±3m) en grilla XYZ con paso 1m
      if (!state.cubos2ById) state.cubos2ById = new Map();
      // Limpiar si ya existían
      try { for (const m of state.cubos2ById.values()) { scene.remove(m); } } catch {}
      state.cubos2ById.clear?.();
      // Mismas configuraciones de grilla que en addGridSampleTilesAt
      const cfgs = [
        ['#ffffff', 'rgba(0,0,0,0.85)', 2, 4, 4],
        ['#00ffff', 'rgba(0,0,0,0.70)', 2, 8, 8],
        ['#ff00ff', 'rgba(0,0,0,0.70)', 3, 6, 6],
        ['#ffcc00', 'rgba(0,0,0,0.70)', 2, 10, 10],
        ['#00ff66', 'rgba(0,0,0,0.70)', 2, 12, 12],
        ['#ff5555', 'rgba(0,0,0,0.70)', 2, 5, 5],
        ['#66aaff', 'rgba(0,0,0,0.70)', 1, 14, 14],
        ['#ffffff', 'rgba(20,20,20,0.70)', 3, 3, 3],
        ['#00ffff', 'rgba(20,0,30,0.70)', 2, 7, 3],
        ['#ff00aa', 'rgba(0,20,30,0.70)', 2, 3, 7],
      ];
      for (let i=0;i<cfgs.length;i++){
        const [line, bg, lw, rx, ry] = cfgs[i];
        const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const mat = makeGridMaterial(line, bg, lw, rx, ry);
        const m = new THREE.Mesh(geo, mat);
        m.name = `Cubo ${i+1}`;
        m.userData = { ...(m.userData||{}), label: `Cubo ${i+1}` };
        // Posicionar en grilla 1m dentro de casa: 2 filas en Y, 5 columnas en X, Z centrado
        const row = Math.floor(i / 5); // 0 o 1
        const col = i % 5;            // 0..4
      // Offset solicitado: +2m en X y -1m en Z
      // Corrección adicional: -0.5m en X y -0.1m en Z
      const x = c.x - 2 + col * 1.0 + 2.0 - 0.5; // X final
      const y = 0.6 + row * 1.0;                 // Y: 0.6 y 1.6 (1m de separación)
      const z = c.z - 1.0 - 0.1;                 // Z final
      m.position.set(x, y, z);
        m.castShadow = true; m.receiveShadow = true; m.renderOrder = 6;
        scene.add(m);
        state.cubos2ById.set(i+1, m);
        // Etiqueta flotante con el número
        const label = makeLabelSprite(String(i+1), '#ffffff');
        label.scale.set(0.18, 0.10, 1);
        label.position.set(x, y + 0.5, z);
        scene.add(label);
      }
    }catch{}
  }
  // Volver a agregar los cubos con texturas numeradas dentro de la zona segura
  spawnTextureCubesInSafeZone(sx, sz);

  state.decorAdded = true;
}
try { ensureMap1Decor(); } catch {}

// Ejes XYZ visibles en el mapa con etiquetas
function makeLabelSprite(text, color='#ffffff'){
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillStyle = color; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text, c.width/2, c.height/2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthTest:true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.8, 0.4, 1);
  return spr;
}

// Genera una tira de cuadrados 0.12 m con texturas de grilla contrastadas y numeración visible
function addGridSampleTilesAt(x0, z0, count = 10, size = 0.12, spacing = 0.02){
  // Variantes de grilla: [lineColor, bgColor, lineWidth, repeatX, repeatY]
  const cfgs = [
    ['#ffffff', 'rgba(0,0,0,0.85)', 2, 4, 4],
    ['#00ffff', 'rgba(0,0,0,0.70)', 2, 8, 8],
    ['#ff00ff', 'rgba(0,0,0,0.70)', 3, 6, 6],
    ['#ffcc00', 'rgba(0,0,0,0.70)', 2, 10, 10],
    ['#00ff66', 'rgba(0,0,0,0.70)', 2, 12, 12],
    ['#ff5555', 'rgba(0,0,0,0.70)', 2, 5, 5],
    ['#66aaff', 'rgba(0,0,0,0.70)', 1, 14, 14],
    ['#ffffff', 'rgba(20,20,20,0.70)', 3, 3, 3],
    ['#00ffff', 'rgba(20,0,30,0.70)', 2, 7, 3],
    ['#ff00aa', 'rgba(0,20,30,0.70)', 2, 3, 7],
  ];
  const n = Math.min(count, cfgs.length);
  for (let i=0; i<n; i++){
    const [line, bg, lw, rx, ry] = cfgs[i];
    const mat = makeGridMaterial(line, bg, lw, rx, ry);
    const geo = new THREE.PlaneGeometry(size, size);
    const tile = new THREE.Mesh(geo, mat);
    tile.rotation.x = -Math.PI/2;
    const x = x0 + i * (size + spacing);
    tile.position.set(x, 0.021, z0); // elevar para evitar z-fighting con la grilla
    tile.renderOrder = 9;
    scene.add(tile);

    // Número encima del tile
    const label = makeLabelSprite(String(i+1), '#ffffff');
    label.scale.set(0.18, 0.10, 1);
    label.position.set(x, 0.12, z0);
    scene.add(label);
  }
}
function addAxesWithLabels(){
  const origin = new THREE.Vector3(-Defaults.world.halfSize+2, 0.02, -Defaults.world.halfSize+2);
  const axes = new THREE.AxesHelper(3.0);
  axes.position.copy(origin);
  scene.add(axes);
  const lx = makeLabelSprite('X', '#ff6666'); lx.position.set(origin.x+3.4, origin.y+0.02, origin.z);
  const ly = makeLabelSprite('Y', '#66ff66'); ly.position.set(origin.x, origin.y+3.6, origin.z);
  const lz = makeLabelSprite('Z', '#6699ff'); lz.position.set(origin.x, origin.y+0.02, origin.z+3.4);
  scene.add(lx); scene.add(ly); scene.add(lz);
}
addAxesWithLabels();

// Utilidades visuales
function fitMeshHeight(mesh, targetH){
  try{
    const box = new THREE.Box3().setFromObject(mesh);
    const h = Math.max(0.001, box.max.y - box.min.y);
    const s = targetH / h;
    mesh.scale.setScalar(s);
  }catch{}
}

function makeClassicMesh(isSelf, hexColor){
  // Estilo clásico: más simple, redondeado y mate
  const color = (typeof hexColor === 'string') ? new THREE.Color(hexColor) : (isSelf ? new THREE.Color(0x4488ff) : new THREE.Color(0xcccccc));
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness:0.0, roughness:0.95 });
  const accentMat = new THREE.MeshStandardMaterial({ color:0x222833, metalness:0.0, roughness:0.98 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.0, 6, 12), bodyMat); torso.position.set(0, 0.9, 0); group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), bodyMat); head.position.set(0, 1.6, 0); group.add(head);
  // Cinturón/acentos muy sutiles para no competir con futurista
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 24), accentMat); belt.rotation.x = Math.PI/2; belt.position.set(0, 1.0, 0); group.add(belt);
  group.traverse(o => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

function makeFuturisticMesh(hexColor){
  // Estilo futurista: angular, metálico y con acentos luminosos fuertes
  const color = (typeof hexColor === 'string') ? new THREE.Color(hexColor) : new THREE.Color(0x66ccff);
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness:0.75, roughness:0.18 });
  const glowMat = new THREE.MeshStandardMaterial({ color:0x00e0ff, emissive:0x00caff, emissiveIntensity:1.6, metalness:0.1, roughness:0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color:0x0e1620, metalness:0.6, roughness:0.4 });
  const group = new THREE.Group();
  // Tronco angular con placas
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.2, 0.55), bodyMat); torso.position.set(0, 0.9, 0); group.add(torso);
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.12), darkMat); chestPlate.position.set(0, 1.2, 0.34); group.add(chestPlate);
  // Casco
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.43, 24, 16), darkMat); helmet.position.set(0, 1.8, 0); group.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.22, 0.06), glowMat); visor.position.set(0, 1.8, 0.36); group.add(visor);
  // Hombreras
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.3), bodyMat); shoulderL.position.set(-0.7, 1.35, 0); group.add(shoulderL);
  const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.7; group.add(shoulderR);
  // Brazos
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 12), bodyMat); armL.rotation.z = Math.PI/2; armL.position.set(-0.7, 1.1, 0); group.add(armL);
  const armR = armL.clone(); armR.position.x = 0.7; group.add(armR);
  // Piernas con rodilleras
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.0, 12), bodyMat); legL.position.set(-0.25, 0.4, 0); group.add(legL);
  const kneeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.18), darkMat); kneeL.position.set(-0.25, 0.8, 0.16); group.add(kneeL);
  const legR = legL.clone(); legR.position.x = 0.25; group.add(legR);
  const kneeR = kneeL.clone(); kneeR.position.x = 0.25; group.add(kneeR);
  // Líneas luminosas adicionales
  for (let i=0;i<3;i++){
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.02), glowMat);
    line.position.set(-0.3 + i*0.3, 0.95, 0.29); group.add(line);
  }
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.04), glowMat); spine.position.set(0, 0.95, -0.29); group.add(spine);
  // Botas
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.4), darkMat); bootL.position.set(-0.25, 0.1, 0.08); group.add(bootL);
  const bootR = bootL.clone(); bootR.position.x = 0.25; group.add(bootR);
  // Sombras
  group.traverse(o => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

// Estilo tecnológico: cuerpo esbelto con detalles de paneles y un halo dorsal
function makeTechnologicMesh(hexColor){
  const base = new THREE.MeshStandardMaterial({ color: (typeof hexColor==='string'? new THREE.Color(hexColor): new THREE.Color(0x77bbff)), metalness:0.5, roughness:0.35 });
  const accent = new THREE.MeshStandardMaterial({ color:0x00ddff, emissive:0x00bbff, emissiveIntensity:1.0, metalness:0.1, roughness:0.5 });
  const dark = new THREE.MeshStandardMaterial({ color:0x141a22, metalness:0.6, roughness:0.45 });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.1, 6, 12), base); torso.position.set(0,0.95,0); g.add(torso);
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 1), dark); head.position.set(0,1.7,0); g.add(head);
  const visor = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 10, 24), accent); visor.position.set(0,1.68,0.02); visor.rotation.x = Math.PI/2; g.add(visor);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 10, 32), accent); halo.position.set(0,1.2,-0.18); halo.rotation.x = Math.PI/2; g.add(halo);
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  return g;
}

// Estilo medieval: armadura simple con yelmo y hombreras
function makeMedievalMesh(hexColor){
  const baseColor = (typeof hexColor==='string'? new THREE.Color(hexColor): new THREE.Color(0xb0b0b0));
  const steel = new THREE.MeshStandardMaterial({ color: baseColor, metalness:0.85, roughness:0.32 });
  const cloth = new THREE.MeshStandardMaterial({ color: baseColor.clone().offsetHSL(0, -0.2, -0.25), metalness:0.0, roughness:0.95 });
  const g = new THREE.Group();
  const cuirass = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 1.0, 12), steel); cuirass.position.set(0,1.0,0); g.add(cuirass);
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 10), cloth); skirt.position.set(0,0.55,0); g.add(skirt);
  const helm = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 8), steel); helm.position.set(0,1.75,0); g.add(helm);
  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), steel); shoulderL.position.set(-0.55,1.3,0); g.add(shoulderL);
  const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.55; g.add(shoulderR);
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  return g;
}

// Estilo cyberpunk: placas oscuras y tubos luminosos
function makeCyberpunkMesh(hexColor){
  const dark = new THREE.MeshStandardMaterial({ color:0x0b0e12, metalness:0.7, roughness:0.35 });
  const neon = new THREE.MeshStandardMaterial({ color:0xff00aa, emissive:0xff0088, emissiveIntensity:1.4, metalness:0.2, roughness:0.6 });
  const cyan = new THREE.MeshStandardMaterial({ color:0x00ffee, emissive:0x00e0ff, emissiveIntensity:1.1, metalness:0.2, roughness:0.6 });
  const g = new THREE.Group();
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.5), dark); chest.position.set(0,1.0,0); g.add(chest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), dark); head.position.set(0,1.7,0); g.add(head);
  for (let i=0;i<3;i++){ const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.9, 12), i%2?neon:cyan); tube.rotation.z = Math.PI/2; tube.position.set(-0.3 + i*0.3, 1.0, 0.26); g.add(tube); }
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  return g;
}

// Estilo cartoon: proporciones cabezonas y colores mates
function makeCartoonMesh(hexColor){
  const body = new THREE.MeshStandardMaterial({ color:(typeof hexColor==='string'? new THREE.Color(hexColor): new THREE.Color(0xffaa33)), metalness:0.0, roughness:1.0 });
  const headMat = new THREE.MeshStandardMaterial({ color:0xffe0c0, metalness:0.0, roughness:1.0 });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 6, 12), body); torso.position.set(0,0.9,0); g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), headMat); head.position.set(0,1.7,0); g.add(head);
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  return g;
}

// Estilo steampunk: cobre con engranajes simples
function makeSteampunkMesh(hexColor){
  const copper = new THREE.MeshStandardMaterial({ color:(typeof hexColor==='string'? new THREE.Color(hexColor): new THREE.Color(0xcc8844)), metalness:0.8, roughness:0.4 });
  const leather = new THREE.MeshStandardMaterial({ color:0x4b2e17, metalness:0.1, roughness:0.9 });
  const g = new THREE.Group();
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12), copper); boiler.position.set(0,1.0,0); g.add(boiler);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), copper); head.position.set(0,1.7,0); g.add(head);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), leather); strap.position.set(0,1.0,0); strap.rotation.x = Math.PI/2; g.add(strap);
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  return g;
}

// Estilo cabeza de slime: cabeza gelatinosa sobre base mínima
function makeSlimeHeadMesh(hexColor){
  const slime = new THREE.MeshPhysicalMaterial({ color:(typeof hexColor==='string'? new THREE.Color(hexColor): new THREE.Color(0x33ffcc)), roughness:0.1, transmission:0.7, thickness:0.6, metalness:0.0, transparent:true, opacity:0.95 });
  const matte = new THREE.MeshStandardMaterial({ color:0x224444, metalness:0.0, roughness:0.9 });
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 0.2, 12), matte); base.position.set(0,0.2,0); g.add(base);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), slime); head.position.set(0,1.2,0); g.add(head);
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  return g;
}

function makePlayerMesh(isSelf, hexColor, form){
  let m;
  if (form === 'futuristic') m = makeFuturisticMesh(hexColor);
  else if (form === 'technologic') m = makeTechnologicMesh(hexColor);
  else if (form === 'medieval') m = makeMedievalMesh(hexColor);
  else if (form === 'cyberpunk') m = makeCyberpunkMesh(hexColor);
  else if (form === 'cartoon') m = makeCartoonMesh(hexColor);
  else if (form === 'steampunk') m = makeSteampunkMesh(hexColor);
  else if (form === 'slime') m = makeSlimeHeadMesh(hexColor);
  else m = makeClassicMesh(isSelf, hexColor);
  if (isSelf && FIRST_PERSON) m.visible = false;
  // Ajustar altura del modelo a la altura de cámara
  fitMeshHeight(m, safeHeadHeight());
  return m;
}

function clearAccessories(mesh){
  if (!mesh) return;
  const toRemove = (mesh.children||[]).filter(c => c.userData && c.userData.isAccessory);
  for (const c of toRemove) { mesh.remove(c); c.geometry?.dispose?.(); c.material?.dispose?.(); }
}
function applyAccessories(mesh, accessories){
  if (!mesh || !Array.isArray(accessories)) return;
  clearAccessories(mesh);
  const add = (obj)=>{ obj.userData = { ...(obj.userData||{}), isAccessory:true }; mesh.add(obj); };
  // Gafas ingeniero: marco cian
  if (accessories.includes('glasses_engineer')){
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x00e0ff });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), frameMat); bar.position.set(0, 1.4, 0.35); add(bar);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.02), new THREE.MeshBasicMaterial({ color:0x003344 })); l.position.set(-0.2,1.4,0.33); add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.02), new THREE.MeshBasicMaterial({ color:0x003344 })); r.position.set( 0.2,1.4,0.33); add(r);
  }
  // Gafas químico: marco verde
  if (accessories.includes('glasses_chemist')){
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x66ff66 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), frameMat); bar.position.set(0, 1.4, 0.35); add(bar);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.02), new THREE.MeshBasicMaterial({ color:0x113311 })); l.position.set(-0.2,1.4,0.33); add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.02), new THREE.MeshBasicMaterial({ color:0x113311 })); r.position.set( 0.2,1.4,0.33); add(r);
  }
  // Bata de químico: faldón blanco
  if (accessories.includes('lab_coat')){
    const coatMat = new THREE.MeshStandardMaterial({ color:0xffffff, metalness:0.0, roughness:0.95 });
    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.6), coatMat);
    coat.position.set(0, 0.5, 0);
    add(coat);
  }
  // Armadura: pechera gris
  if (accessories.includes('armor')){
    const armorMat = new THREE.MeshStandardMaterial({ color:0x888888, metalness:0.7, roughness:0.3 });
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.5), armorMat);
    chest.position.set(0, 1.1, 0);
    add(chest);
  }
}

// ===== Nombre sobre el jugador (Sprite con textura de canvas)
function makeNameTexture(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const pad = 8; const font = 20; const fontFam = '12px system-ui, sans-serif';
  ctx.font = `${font}px system-ui, sans-serif`;
  const w = Math.max(64, ctx.measureText(text).width + pad*2);
  const h = 32 + pad;
  canvas.width = w; canvas.height = h;
  ctx.font = `${font}px ${fontFam}`;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w/2, h/2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}
function makeNameSprite(text) {
  const tex = makeNameTexture(text);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest:true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.8, 0.5, 1); // tamaño aproximado
  spr.position.set(0, 1.6, 0);
  spr.userData.name = text;
  spr.renderOrder = 999;
  return spr;
}

function makeEnemyMesh() {
  // 3 segmentos apilados
  const group = new THREE.Group();
  const colors = [0xff5560, 0xff3344, 0xcc2233];
  const segs = [];
  const baseYs = [];
  // Reducir el tamaño visual total a ~diámetro 1.6 para coincidir con radio 0.8
  const totalH = 1.6; // altura total visual aprox
  const size = totalH/3;
  for (let i=0;i<3;i++){
    const geo = new THREE.BoxGeometry(1.6, size, 1.6);
    const mat = new THREE.MeshStandardMaterial({ color: colors[i], metalness:0.4, roughness:0.4, emissive:0x220008, emissiveIntensity:0.2 });
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    m.position.y = -totalH/2 + size/2 + i*size;
    baseYs.push(m.position.y);
    group.add(m);
    segs.push(m);
  }
  group.userData = { segments: segs, baseYs };
  return group;
}

function makeHpBar(maxHp) {
  const group = new THREE.Group();
  const w = 1.6, h = 0.15;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x330000, depthTest:true, transparent:true }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x00ff55, depthTest:true, transparent:true }));
  fg.position.z = 0.001;
  group.add(bg); group.add(fg);
  group.userData = { maxHp, fg, w };
  // Altura según tamaño visual (diámetro ~ 1.6) y un offset
  group.position.set(0, (Defaults.enemy.radius*2)/2 + 1.0, 0);
  group.rotation.y = 0;
  // Asegurar visibilidad delante de otros objetos
  bg.renderOrder = 999; fg.renderOrder = 999; group.renderOrder = 999;
  return group;
}

// Barras 3D de jugadores (HP + XP)
function makePlayerBars(maxHp) {
  const group = new THREE.Group();
  const w = 1.4, h = 0.12, pad = 0.02;
  // HP
  const bgHp = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x220000, depthTest:true, transparent:true }));
  const fgHp = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x00ff66, depthTest:true, transparent:true }));
  fgHp.position.z = 0.001;
  // XP (debajo)
  const bgXp = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x001722, depthTest:true, transparent:true }));
  const fgXp = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x00bbff, depthTest:true, transparent:true }));
  bgHp.position.y = h/2 + pad;
  fgHp.position.y = h/2 + pad; fgXp.position.z = 0.001;
  bgXp.position.y = -h/2 - pad; fgXp.position.y = -h/2 - pad;
  group.add(bgHp, fgHp, bgXp, fgXp);
  group.userData = { maxHp, w, fgHp, fgXp };
  group.position.set(0, 1.9, 0);
  // Asegurar visibilidad delante de otros objetos
  bgHp.renderOrder = fgHp.renderOrder = bgXp.renderOrder = fgXp.renderOrder = 999;
  group.renderOrder = 999;
  return group;
}

function makeCoinMesh(value=1) {
  const geo = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive:0x332200, metalness:0.6, roughness:0.3 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = Math.PI/2;
  // numerito simple como sprite opcional (omitido por simplicidad)
  return m;
}

// Entrada de usuario
const input = { up:false, down:false, left:false, right:false, attack:false, jump:false, dash:false, yaw:0, pitch:0 };
let jumpUntilMs = 0; // ventana temporal para garantizar que el servidor lea el salto
// Predicción visual local del salto (no altera controles ni estado del servidor)
let predVy = 0; // velocidad vertical local
let predY = 0;  // offset visual local (>=0)

function key(e, d) {
  if (e.repeat) return;
  switch (e.code) {
    // Pedido: invertir W y S; A y D igual
    case 'KeyW': input.down = d; break;
    case 'KeyS': input.up = d; break;
    case 'KeyA': input.left = d; break;
    case 'KeyD': input.right = d; break;
    case 'Digit1':
      if (d) { startWeaponSwitch('auto'); chat('Arma: Automática'); }
      break;
    case 'Digit2':
      if (d) { startWeaponSwitch('ray'); chat('Arma: Rayo'); }
      break;
    case 'Space':
      if (d) {
        jumpUntilMs = Date.now() + 300; // ventana de 300ms
        // Impulso visual inmediato (predicción). Se corrige con el snapshot del servidor
        if (predY <= 0) predVy = Defaults.player.jumpSpeed; // solo si estamos en el suelo visualmente
        chat('Jump solicitado');
      }
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      if (d) { input.dash = true; setTimeout(()=> input.dash=false, 30); }
      break;
  }
}
window.addEventListener('keydown', e => {
  // Toggle chat con Enter
  if (e.code === 'Enter') {
    e.preventDefault();
    if (!chatting) {
      toggleChatInput(true);
    } else {
      const msg = chatInput.value.trim();
      if (msg) chat(msg);
      chatInput.value = '';
      toggleChatInput(false);
    }
    return;
  }
  if (chatting) return; // no procesar inputs del juego mientras se escribe
  if (!ready) return; // bloquear controles hasta confirmar UI
  // Prevenir scroll/acciones por defecto con Space/WASD
  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
    e.preventDefault();
  }
  key(e, true);
});
window.addEventListener('keyup', e => { if (!chatting && ready) key(e, false); });
window.addEventListener('mousedown', (e) => {
  if (chatting) return;
  if (!ready) return;
  if (e.button !== 0) return; // solo botón izquierdo
  if (!pointerLocked) return; // el click que bloquea el puntero no dispara
  // Si estamos en modo construcción, confirmar colocación
  if (Build.active){
    placeEquippedCubeAtGhost();
    return;
  }
  // Antes de disparar: intentar seleccionar un cubo si el rayo golpea uno
  try{
    const ndc = new THREE.Vector2(0,0); // centro pantalla en 1ra persona
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    const hitCube = hits.find(h => h.object && typeof h.object.name === 'string' && h.object.name.startsWith('Cubo '));
    if (hitCube){
      // Parsear número
      const name = hitCube.object.name; // 'Cubo N'
      const parts = name.split(' ');
      const id = parseInt(parts[1], 10);
      if (!isNaN(id)){
        addItemToInventory(id);
        updateInventoryHUD();
        return; // cancelar disparo: este click fue de selección
      }
    }
  } catch {}
  // Permitir disparo también en Mapa 1 (sin bloqueo por zona segura)
  input.attack = true;
  const fired = startGunFire();
  if (fired) chat('Disparo ejecutado');
});
window.addEventListener('mouseup', (e) => {
  if (chatting) return;
  if (e.button !== 0) return;
  input.attack = false;
});

// Control de cámara y mira: raycasting hacia el plano del suelo
const mouseNDC = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0); // y=0
let crosshair;
function ensureCrosshair() {
  if (crosshair) return crosshair;
  const ring = new THREE.RingGeometry(0.25, 0.32, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffff55, transparent:true, opacity:0.9, side: THREE.DoubleSide, depthTest:false });
  crosshair = new THREE.Mesh(ring, mat);
  crosshair.rotation.x = -Math.PI/2;
  crosshair.renderOrder = 10;
  scene.add(crosshair);
  return crosshair;
}
window.addEventListener('mousemove', (e) => {
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  // Actualizar ghost en tiempo real
  try { updateBuildGhostPosition(); } catch {}
});

function updateYawFromMouse(selfData) {
  if (!selfData) return;
  // Raycast desde la cámara hacia el plano y=0
  // En primera persona, apuntamos con el centro de pantalla (retículo)
  const ndc = (FIRST_PERSON ? new THREE.Vector2(0,0) : mouseNDC);
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(groundPlane, hit);
  if (!ok) return;
  if (!FIRST_PERSON) { // en tercera persona mostramos mira en el suelo
    ensureCrosshair();
    crosshair.position.set(hit.x, 0.02, hit.z);
  }
  // Yaw hacia la mira
  const dx = hit.x - selfData.pos.x;
  const dz = hit.z - selfData.pos.z;
  input.yaw = Math.atan2(dx, dz);
}

// Retículo de primera persona (sprite en el centro de la pantalla, hijo de la cámara)

// Pistola futurista en primera persona
let gun, muzzleFlash, fireTimer=0;
let beam, beamTimer=0;
let beamTickAcc = 0; // acumulador para ticks de daño del beam (0.1s)
let beamActive = false; // indica si el beam continuo está activo este frame
// Sistema de armas: 'auto' o 'ray'
let selectedWeapon = 'ray';
// Cambio de arma con animación
let weaponSwitching = false;
let weaponSwitchTimer = 0;
const weaponSwitchDuration = 0.30; // 300ms
let pendingWeapon = null;
function easeInOutQuad(t){ return t<0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
function startWeaponSwitch(to){
  if (to === selectedWeapon) return; // nada que hacer
  if (weaponSwitching) return; // ya en curso
  ensureGun();
  weaponSwitching = true; weaponSwitchTimer = 0; pendingWeapon = to;
}
let autoFireTimer = 0; // cooldown entre disparos automáticos
function ensureGun() {
  if (gun) return gun;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.25,0.18,0.35), new THREE.MeshStandardMaterial({ color:0x1b2530, metalness:0.6, roughness:0.3, emissive:0x081018, emissiveIntensity:0.3 }));
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.26), new THREE.MeshStandardMaterial({ color:0x00e0ff, emissive:0x0088aa, emissiveIntensity:0.8 }));
  accent.position.set(0,0,0.02);
  g.add(body); g.add(accent);
  // Panel HUD con símbolo de munición infinita (∞)
  const hudCanvas = document.createElement('canvas');
  hudCanvas.width = 128; hudCanvas.height = 64;
  const hctx = hudCanvas.getContext('2d');
  hctx.clearRect(0,0,128,64);
  hctx.fillStyle = 'rgba(10,20,28,0.9)';
  hctx.fillRect(0,0,128,64);
  hctx.strokeStyle = '#00e0ff'; hctx.lineWidth = 3;
  hctx.strokeRect(2,2,124,60);
  hctx.fillStyle = '#00e0ff';
  g.position.set(0.25, -0.18, -0.5);
  g.rotation.set(-0.05, 0.1, 0);
  camera.add(g);
  gun = g;
  gun.userData.basePos = g.position.clone();

  // Crear contenedores por arma
  const autoG = new THREE.Group(); autoG.name = 'autoModel';
  const rayG = new THREE.Group();  rayG.name = 'rayModel';
  g.add(autoG); g.add(rayG);

  // Crear recursos inmediatos: muzzleFlash y beam antes de la carga GLTF
  if (!muzzleFlash){
    muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ color:0xffdd88, transparent:true, opacity:0.0 }));
    muzzleFlash.scale.set(0.10, 0.10, 1);
    muzzleFlash.position.set(0.0, 0.0, 0.22);
    muzzleFlash.visible = false;
    g.add(muzzleFlash);
  }
  if (!beam){
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0,0,1)]);
    beam = new THREE.Line(geo, new THREE.LineBasicMaterial({ color:0x77ffff, transparent:true, opacity:0.9, depthTest:false }));
    beam.renderOrder = 999; beam.visible = false; scene.add(beam);
  }

  // Intentar cargar modelos GLTF (con fallback a mallas procedurales)
  buildWeaponModel('auto')
    .then(mg => { try { autoG.add(mg); } catch { autoG.add(createProceduralAutoGun()); } })
    .catch(() => { try { autoG.add(createProceduralAutoGun()); } catch {} });
  buildWeaponModel('ray')
    .then(rg => { try { rayG.add(rg); } catch { rayG.add(createProceduralRayGun()); } })
    .catch(() => { try { rayG.add(createProceduralRayGun()); } catch {} });

  updateWeaponVisibility();
  return gun;
}

function updateWeaponVisibility(){
  if (!gun) return;
  const autoG = gun.children.find(c=>c.name==='autoModel');
  const rayG  = gun.children.find(c=>c.name==='rayModel');
  if (autoG) autoG.visible = (selectedWeapon === 'auto');
  if (rayG)  rayG.visible  = (selectedWeapon === 'ray');
}

function createProceduralAutoGun(){
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.25,0.18,0.35), new THREE.MeshStandardMaterial({ color:0x2a3542, metalness:0.6, roughness:0.35 }));
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.26), new THREE.MeshStandardMaterial({ color:0x2aa7ff, emissive:0x1088cc, emissiveIntensity:0.6 }));
  accent.position.set(0,0,0.02); g.add(body); g.add(accent);
  return g;
}

function createProceduralRayGun(){
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.14,0.28), new THREE.MeshStandardMaterial({ color:0x202a34, metalness:0.5, roughness:0.4 }));
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.10, 16), new THREE.MeshStandardMaterial({ color:0x222222, emissive:0x990000, emissiveIntensity:1.0 }));
  emitter.rotation.x = Math.PI/2; emitter.position.set(0,0,0.18);
  g.add(body); g.add(emitter);
  return g;
}

function promiseLoadGLTF(url){
  return new Promise((resolve, reject)=>{
    const loader = new GLTFLoader();
    loader.load(url, gltf=>resolve(gltf), undefined, err=>reject(err));
  });
}

async function buildWeaponModel(kind){
  const cfg = WEAPON_MODELS[kind];
  if (!cfg || !cfg.url) throw new Error('No model url');
  const gltf = await promiseLoadGLTF(cfg.url);
  const model = gltf.scene || gltf.scenes?.[0];
  if (!model) throw new Error('No scene in gltf');
  model.scale.setScalar(cfg.scale || 1.0);
  // Tintado básico
  model.traverse(o=>{
    if (o.isMesh && o.material) {
      const m = o.material;
      if (m.color && cfg.tint?.color) m.color = new THREE.Color(cfg.tint.color);
      if (m.emissive && cfg.tint?.emissive) m.emissive = new THREE.Color(cfg.tint.emissive);
    }
  });
  return model;
}
function startGunFire(){
  // Bloquear disparo durante cambio de arma
  if (weaponSwitching) return false;
  ensureGun(); fireTimer = 0.12; muzzleFlash.visible = true;
  // Variación de escala del fogonazo para dar naturalidad
  const s = 0.9 + Math.random()*0.5;
  muzzleFlash.scale.set(s, s, 1);
  // Spawn de beam breve
  const origin = new THREE.Vector3();
  if (muzzleFlash) muzzleFlash.getWorldPosition(origin); else camera.getWorldPosition(origin);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  // Alcance
  const range = Defaults.weapon.range ?? 35;
  // Colisión con muros: obtener el primer impacto contra geometría de muros (si existe)
  let tWall = range;
  if (state.mazeGroup && state.mazeGroup.children && state.mazeGroup.children.length > 0) {
    // Reutilizar raycaster global
    raycaster.set(origin, dir.normalize());
    const hits = raycaster.intersectObjects(state.mazeGroup.children, false);
    if (hits && hits.length > 0) {
      tWall = Math.min(range, hits[0].distance);
    }
  }
  // Buscar impacto aproximado con enemigos en cliente (cilindro vertical) y validar línea de visión
  let tEnemy = range;
  let hitEnemyId = null;
  for (const entry of state.enemies.values()){
    const center = entry.mesh.getWorldPosition(new THREE.Vector3()); // (cx, cy, cz)
    const toC = new THREE.Vector3().subVectors(center, origin);
    const t = Math.max(0, Math.min(range, toC.dot(dir)));
    const closest = new THREE.Vector3().copy(origin).addScaledVector(dir, t);
    // Ignorar la componente Y para un cilindro vertical: medir en XZ
    const dx = closest.x - center.x;
    const dz = closest.z - center.z;
    const distXZ = Math.hypot(dx, dz);
    const rad = (Defaults.enemy?.radius ?? 1.0);
    if (distXZ <= rad && t < tEnemy) { tEnemy = t; hitEnemyId = entry.data?.id ?? null; }
  }
  // Determinar el fin del rayo: hasta el muro más cercano o el enemigo si está antes del muro
  let tEnd = Math.min(range, tWall);
  let validHitEnemy = false;
  if (hitEnemyId && tEnemy < tEnd) { tEnd = tEnemy; validHitEnemy = true; }
  const end = new THREE.Vector3().copy(origin).addScaledVector(dir, tEnd);
  const pos = beam.geometry.attributes.position;
  pos.setXYZ(0, origin.x, origin.y, origin.z);
  pos.setXYZ(1, end.x, end.y, end.z);
  pos.needsUpdate = true;
  beam.visible = true; beamTimer = 0.06;

  // Enviar evento de impacto al servidor si detectamos un enemigo
  if (validHitEnemy && ws.readyState === WebSocket.OPEN) {
    console.debug('[FIRE] Impacto detectado en', hitEnemyId, 'daño=', Defaults.projectile?.damage ?? 1);
    ws.send(JSON.stringify({ type: MessageTypes.HitEnemy, enemyId: hitEnemyId, damage: Defaults.projectile?.damage ?? 1 }));
  }
  return true;
}
function updateGun(dt){
  if (!gun && FIRST_PERSON) ensureGun();
  if (!gun) return;
  // Animación de cambio de arma: bajar y subir
  if (weaponSwitching) {
    weaponSwitchTimer += dt;
    const t = Math.min(1, weaponSwitchTimer / weaponSwitchDuration);
    const k = easeInOutQuad(t);
    const b = gun.userData?.basePos || new THREE.Vector3(0.25, -0.18, -0.5);
    // Fase: 0..1, usamos k para transicionar Y hacia abajo y volver arriba
    // Perfil: baja hasta -0.48 en la mitad y vuelve a base
    const downAmt = 0.30; // metros hacia abajo
    let y;
    if (t < 0.5) {
      // bajar
      const kk = k / 0.5; // ~0..1 en primera mitad
      y = b.y - downAmt * Math.min(1, kk);
    } else {
      // cambiar arma en el punto medio si no se cambió
      if (pendingWeapon) { selectedWeapon = pendingWeapon; pendingWeapon = null; try{ updateWeaponVisibility(); }catch{} }
      // subir
      const kk = (k - 0.5) / 0.5; // 0..1 en segunda mitad
      y = (b.y - downAmt) + downAmt * Math.min(1, kk);
    }
    gun.position.set(b.x, y, b.z);
    muzzleFlash.visible = false; // ocultar flash mientras cambia
    // finalizar
    if (t >= 1) { weaponSwitching = false; gun.position.copy(b); }
  }
  // Beam continuo para arma 'ray' mientras se mantiene pulsado (10 DPS en ticks de 0.1s)
  beamActive = false;
  if (!weaponSwitching && selectedWeapon === 'ray') {
    // Validar zona segura del Mapa 1 (no permitir disparo dentro)
    let canFire = true;
    // Permitir beam continuo en cualquier mapa
    if (input.attack && canFire) {
      // Calcular rayo desde la boca del arma hacia adelante
      const origin = new THREE.Vector3();
      if (muzzleFlash) muzzleFlash.getWorldPosition(origin); else camera.getWorldPosition(origin);
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      const range = Defaults.weapon.range ?? 35;
      // Intersección con muros
      let tWall = range;
      if (state.mazeGroup && state.mazeGroup.children && state.mazeGroup.children.length > 0) {
        raycaster.set(origin, dir.normalize());
        const hits = raycaster.intersectObjects(state.mazeGroup.children, false);
        if (hits && hits.length > 0) tWall = Math.min(range, hits[0].distance);
      }
      // Aproximar impacto con enemigos (cilindro vertical)
      let tEnemy = range;
      let hitEnemyId = null;
      for (const entry of state.enemies.values()){
        const center = entry.mesh.getWorldPosition(new THREE.Vector3());
        const toC = new THREE.Vector3().subVectors(center, origin);
        const t = Math.max(0, Math.min(range, toC.dot(dir)));
        const closest = new THREE.Vector3().copy(origin).addScaledVector(dir, t);
        const dx = closest.x - center.x;
        const dz = closest.z - center.z;
        const distXZ = Math.hypot(dx, dz);
        const rad = (Defaults.enemy?.radius ?? 1.0);
        if (distXZ <= rad && t < tEnemy) { tEnemy = t; hitEnemyId = entry.data?.id ?? null; }
      }
      // Definir extremo del rayo
      let tEnd = Math.min(range, tWall);
      let validHitEnemy = false;
      if (hitEnemyId && tEnemy < tEnd) { tEnd = tEnemy; validHitEnemy = true; }
      const end = new THREE.Vector3().copy(origin).addScaledVector(dir, tEnd);
      // Actualizar geometría del beam
      if (beam && beam.geometry && beam.geometry.attributes && beam.geometry.attributes.position){
        const pos = beam.geometry.attributes.position;
        pos.setXYZ(0, origin.x, origin.y, origin.z);
        pos.setXYZ(1, end.x, end.y, end.z);
        pos.needsUpdate = true;
      }
      if (beam) {
        beam.visible = true;
        beam.material.opacity = 0.9;
      }
      muzzleFlash.visible = false; // sin fogonazo durante el beam continuo
      beamActive = true;
      // Ticks de daño cada 0.1s
      beamTickAcc += dt;
      const tick = 0.1;
      while (beamTickAcc >= tick) {
        beamTickAcc -= tick;
        if (validHitEnemy && ws.readyState === WebSocket.OPEN) {
          // 1 de daño por tick = 10 DPS base
          ws.send(JSON.stringify({ type: MessageTypes.HitEnemy, enemyId: hitEnemyId, damage: 1 }));
        }
      }
    } else {
      // no disparando
      beamTickAcc = 0;
    }
  }
  // Disparo automático si arma seleccionada es automática y el jugador mantiene click
  if (!weaponSwitching && selectedWeapon === 'auto') {
    autoFireTimer -= dt;
    if (input.attack && autoFireTimer <= 0) {
      // Permitir disparo automático en cualquier mapa
      startGunFire();
      // Intervalo de fuego automático (≈8.3 disparos/seg)
      autoFireTimer = 0.12;
    }
  }
  if (fireTimer>0){
    fireTimer -= dt;
    const k = Math.max(0, fireTimer)/0.12;
    // Retroceso relativo a la Z base del arma
    const b = gun.userData?.basePos || new THREE.Vector3(0.25, -0.18, -0.5);
    gun.position.z = b.z - 0.03*(1-k); // pequeño retroceso
    muzzleFlash.visible = k>0;
  } else {
    const b = gun.userData?.basePos || new THREE.Vector3(0.25, -0.18, -0.5);
    gun.position.z = b.z;
    muzzleFlash.visible = false;
  }
  // Fade del beam
  if (beam){
    // Si no está activo el beam continuo, usar fade breve del disparo puntual
    if (!beamActive) {
      if (beamTimer>0){ beamTimer -= dt; beam.material.opacity = 0.8 * Math.max(0, beamTimer)/0.06; }
      else { beam.visible = false; }
    }
  }
}
function ensureFpsReticle() {
  if (fpsReticle) return fpsReticle;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,85,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32-6, 32); ctx.lineTo(32-2, 32);
  ctx.moveTo(32+2, 32); ctx.lineTo(32+6, 32);
  ctx.moveTo(32, 32-6); ctx.lineTo(32, 32-2);
  ctx.moveTo(32, 32+2); ctx.lineTo(32, 32+6);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  fpsReticle = new THREE.Sprite(mat);
  fpsReticle.scale.set(0.06, 0.06, 1); // tamaño relativo
  fpsReticle.position.set(0, 0, -1); // 1m delante de la cámara
  camera.add(fpsReticle);
  scene.add(camera);
  // Ocultar el cursor del sistema para que solo se vea el retículo
  if (renderer && renderer.domElement) renderer.domElement.style.cursor = 'none';
  return fpsReticle;
}

// Pointer Lock para control de cámara con mouse en primera persona
let pointerLocked = false;
let localYaw = 0;
let localPitch = 0; // mirar arriba/abajo
let mouseSensitivity = 0.0025; // ajustable
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (pointerLocked) {
    // Al entrar en juego, ocultar cursor si no hay menús
    if (!isAnyMenuOpen()) hideTechCursor();
  } else {
    // Al salir de pointer lock, mostrar cursor si estamos listos
    if (ready) showTechCursor();
  }
});
renderer.domElement.addEventListener('click', () => {
  if (chatting) return;
  // Primer click: activar Pointer Lock; siguientes: permitir disparo
  if (!pointerLocked) {
    renderer.domElement.focus();
    renderer.domElement.requestPointerLock();
    return;
  }
});

// Menú de selección de mapa (DOM overlay simple)
let mapMenu = null;
let pauseMenu = null;
let statsMenu = null;

// Reintento controlado de pointer lock al cerrar menús o tras cambiar de mapa
function tryRelockPointer(){
  if (!ready) return;
  if (chatting) return;
  if (isAnyMenuOpen()) return;
  if (!pointerLocked) {
    try {
      renderer.domElement.focus();
      renderer.domElement.requestPointerLock();
    } catch {}
  }
}
function ensureMapMenu() {
  if (mapMenu) return mapMenu;
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.left = '0'; overlay.style.top = '0';
  overlay.style.right = '0'; overlay.style.bottom = '0';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.35)';
  overlay.style.zIndex = '9999';

  const panel = document.createElement('div');
  panel.style.minWidth = '320px';
  panel.style.padding = '16px 20px';
  panel.style.borderRadius = '10px';
  panel.style.background = 'linear-gradient(180deg, rgba(12,22,34,0.95), rgba(8,16,26,0.95))';
  panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5), inset 0 0 20px rgba(0,180,255,0.15)';
  panel.style.border = '1px solid rgba(0,180,255,0.25)';
  panel.style.color = '#cfefff';
  panel.style.fontFamily = 'Consolas, Menlo, monospace';
  panel.style.textAlign = 'center';

  const title = document.createElement('div');
  title.textContent = 'Seleccionar Mapa (M)';
  title.style.fontSize = '18px';
  title.style.marginBottom = '12px';
  title.style.letterSpacing = '1px';
  title.style.textShadow = '0 0 8px rgba(0,200,255,0.35)';
  panel.appendChild(title);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '12px';
  row.style.justifyContent = 'center';

  function makeBtn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.padding = '10px 14px';
    b.style.borderRadius = '8px';
    b.style.border = '1px solid rgba(0,180,255,0.35)';
    b.style.background = 'rgba(10,30,45,0.8)';
    b.style.color = '#d6f7ff';
    b.style.cursor = 'pointer';
    b.onmouseenter = () => { b.style.background = 'rgba(12,50,70,0.9)'; };
    b.onmouseleave = () => { b.style.background = 'rgba(10,30,45,0.8)'; };
    return b;
  }
  // Botones de mapas 1..10 con validación visual de nivel (servidor valida de forma autoritativa)
  for (let m=1; m<=10; m++){
    const label = (m===1) ? 'Mapa 1 (Arena)'
                 : (m===2) ? 'Mapa 2 (Laberinto)'
                 : `Mapa ${m}`;
    const b = makeBtn(label);
    b.onclick = () => {
      const lvl = state.players.get(myId)?.data?.level ?? 1;
      if (m>=2 && lvl < m) chat(`Nivel insuficiente: se requiere nivel ${m} para Mapa ${m}`);
      ws.send(JSON.stringify({ type: MessageTypes.ChangeMap, map: m }));
    };
    row.appendChild(b);
  }
  panel.appendChild(row);

  const tip = document.createElement('div');
  tip.textContent = 'Acceso: Mapa N requiere nivel N (desde N=2)';
  tip.style.marginTop = '10px';
  tip.style.opacity = '0.8';
  tip.style.fontSize = '12px';
  panel.appendChild(tip);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  mapMenu = overlay; return overlay;
}
function showMapMenu(){ ensureMapMenu(); mapMenu.style.display = 'flex'; if (pointerLocked) document.exitPointerLock(); showTechCursor(); }
function hideMapMenu(){ if (mapMenu) mapMenu.style.display = 'none'; if (!isAnyMenuOpen() && ready) { hideTechCursor(); tryRelockPointer(); } }

function ensurePauseMenu(){
  if (pauseMenu) return pauseMenu;
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed'; overlay.style.left = '0'; overlay.style.top = '0';
  overlay.style.right = '0'; overlay.style.bottom = '0'; overlay.style.display = 'none';
  overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.35)'; overlay.style.zIndex = '9999';
  const panel = document.createElement('div');
  panel.style.minWidth = '280px'; panel.style.padding = '16px 20px'; panel.style.borderRadius = '10px';
  panel.style.background = '#06141d'; panel.style.border = '1px solid #0af'; panel.style.color = '#d9f7ff';
  panel.innerHTML = `<div style="font-weight:800; font-size:16px; margin-bottom:10px;">Menú</div>`;
  const mkBtn = (txt)=>{ const b=document.createElement('button'); b.textContent=txt; b.style.margin='6px 0'; b.style.padding='10px 12px'; b.style.width='100%'; b.style.borderRadius='8px'; b.style.border='1px solid #0af'; b.style.background='#072734'; b.style.color='#e8f7ff'; b.style.cursor='pointer'; return b; };
  const bMaps = mkBtn('Mapas'); const bStats = mkBtn('Estadísticas'); const bOpts = mkBtn('Opciones');
  bMaps.onclick = ()=>{ hidePauseMenu(); showMapMenu(); };
  bStats.onclick = ()=>{ hidePauseMenu(); showStatsMenu(); };
  bOpts.onclick = ()=>{ chat('Opciones próximamente'); };
  panel.appendChild(bMaps); panel.appendChild(bStats); panel.appendChild(bOpts);
  overlay.appendChild(panel); document.body.appendChild(overlay); pauseMenu = overlay; return overlay;
}
function showPauseMenu(){ ensurePauseMenu(); pauseMenu.style.display='flex'; if (pointerLocked) document.exitPointerLock(); showTechCursor(); }
function hidePauseMenu(){ if (pauseMenu) pauseMenu.style.display='none'; if (!isAnyMenuOpen() && ready) { hideTechCursor(); tryRelockPointer(); } }

function ensureStatsMenu(){
  if (statsMenu) return statsMenu;
  const overlay = document.createElement('div');
  overlay.style.position='fixed'; overlay.style.left='0'; overlay.style.top='0'; overlay.style.right='0'; overlay.style.bottom='0';
  overlay.style.display='none'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
  overlay.style.background='rgba(0,0,0,0.35)'; overlay.style.zIndex='9999';
  const panel = document.createElement('div');
  panel.style.minWidth='320px'; panel.style.padding='16px 20px'; panel.style.borderRadius='10px';
  panel.style.background='#06141d'; panel.style.border='1px solid #0af'; panel.style.color='#d9f7ff';
  panel.innerHTML = `<div style="font-weight:800; font-size:16px; margin-bottom:10px;">Estadísticas</div>
  <div id="statsBody" style="max-height:50vh; overflow:auto; font-size:13px; opacity:0.95;"></div>`;
  overlay.appendChild(panel); document.body.appendChild(overlay); statsMenu = overlay; return overlay;
}
function showStatsMenu(){ ensureStatsMenu();
  // Relleno básico con datos locales si existen
  const p = state.players.get(myId)?.data || {};
  const el = statsMenu.querySelector('#statsBody');
  if (el) el.innerHTML = `
    <div>Nombre: <b>${p.name || myCosmetics.name || 'Jugador'}</b></div>
    <div>Nivel: <b>${p.level ?? 1}</b></div>
    <div>HP: <b>${p.hp ?? (Defaults.player.hp ?? 5)}</b></div>
    <div>XP: <b>${p.xp ?? 0}</b></div>
  `;
  statsMenu.style.display='flex'; if (pointerLocked) document.exitPointerLock(); showTechCursor();
}
function hideStatsMenu(){ if (statsMenu) statsMenu.style.display='none'; if (!isAnyMenuOpen() && ready) { hideTechCursor(); tryRelockPointer(); } }

function isAnyMenuOpen(){
  const uiOpen = (typeof ui !== 'undefined' && ui && ui.style?.display !== 'none');
  const mapOpen = (mapMenu && mapMenu.style.display !== 'none');
  const pauseOpen = (pauseMenu && pauseMenu.style.display !== 'none');
  const statsOpen = (statsMenu && statsMenu.style.display !== 'none');
  return !!(uiOpen || mapOpen || pauseOpen || statsOpen);
}

// Tecla M para abrir/cerrar menú de mapas
window.addEventListener('keydown', (e) => {
  if (chatting) return;
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    if (!mapMenu || mapMenu.style.display === 'none') showMapMenu();
    else hideMapMenu();
  }
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (!statsMenu || statsMenu.style.display === 'none') showStatsMenu();
    else hideStatsMenu();
  }
  if (e.key === 'g' || e.key === 'G'){
    e.preventDefault();
    ensureMetricGrids();
    metricGridOn = !metricGridOn;
    metricGridGroup.visible = metricGridOn;
  }
  // Ajustar altura Y del ghost en modo construcción: T sube, Y baja (paso 0.25m)
  if (Build.active && (e.key === 't' || e.key === 'T')){
    e.preventDefault();
    Build.altY = Math.min(5.0, (Build.altY ?? 1.0) + 0.25);
    try { updateBuildGhostPosition(); } catch {}
  }
  if (Build.active && (e.key === 'y' || e.key === 'Y')){
    e.preventDefault();
    Build.altY = Math.max(0.0, (Build.altY ?? 1.0) - 0.25);
    try { updateBuildGhostPosition(); } catch {}
  }
  // Inventario: abrir/cerrar HUD con V
  if (e.key === 'v' || e.key === 'V'){
    e.preventDefault();
    toggleLootInventory();
  }
  // Modo construcción: toggle con B
  if (e.key === 'b' || e.key === 'B'){
    e.preventDefault();
    toggleBuildMode();
    try { updateBuildGhostPosition(); } catch {}
  }
  // Rotación del ghost: Q (eje Y) y E (eje X)
  if (Build.active && (e.key === 'q' || e.key === 'Q')){
    e.preventDefault();
    Build.rotY -= Math.PI/2;
    try { updateBuildGhostPosition(); } catch {}
  }
  if (Build.active && (e.key === 'e' || e.key === 'E')){
    e.preventDefault();
    Build.rotX -= Math.PI/2;
    try { updateBuildGhostPosition(); } catch {}
  }
  // Inventario: asignación/equipado de slots 3–0
  const digitMap = {
    'Digit3':'3','Digit4':'4','Digit5':'5','Digit6':'6','Digit7':'7','Digit8':'8','Digit9':'9','Digit0':'0'
  };
  if (digitMap[e.code]){
    e.preventDefault();
    tryAssignToSlot(digitMap[e.code]);
    try { updateInventoryHUD(); } catch {}
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (!pauseMenu || pauseMenu.style.display === 'none') {
      // Cerrar otros menús si abiertos y abrir pausa
      hideMapMenu(); hideStatsMenu(); showPauseMenu();
    } else {
      hidePauseMenu();
    }
  }
});
window.addEventListener('mousemove', (e) => {
  if (chatting) return;
  if (!pointerLocked) return;
  // Invertir izquierda/derecha (yaw): izquierda -> yaw+, derecha -> yaw- (según preferencia actual)
  localYaw -= e.movementX * mouseSensitivity;
  localPitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, localPitch - e.movementY * mouseSensitivity));
});

// Comunicación con servidor
ws.addEventListener('open', () => {
  // Si el usuario ya confirmó la UI, enviar Hello con cosméticos
  if (ready) {
    ws.send(JSON.stringify({ type: MessageTypes.Hello, name: myCosmetics.name, color: myCosmetics.color, accessories: myCosmetics.accessories, form: myCosmetics.form }));
  }
});

ws.addEventListener('message', (ev) => {
  let msg; try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.type === MessageTypes.Welcome) {
    myId = msg.id;
    applySnapshot(msg.snapshot);
    // Si ya confirmamos UI antes de recibir Welcome, enviar Hello ahora
    if (ready) {
      try { ws.send(JSON.stringify({ type: MessageTypes.Hello, name: myCosmetics.name, color: myCosmetics.color, accessories: myCosmetics.accessories, form: myCosmetics.form })); } catch {}
    }
  }
  if (msg.type === MessageTypes.WorldState) {
    applySnapshot(msg);
  }
  // Punto de spawn: teletransporte y visibilidad
  if (msg.type === MessageTypes.SpawnPoint) {
    // No mostrar esfera de spawn; ignorar visualmente este mensaje
    // Si se requiere teletransporte u otra lógica no visual, se puede manejar aquí.
  }
  // Cambio de mapa confirmado: mover jugador local inmediatamente
  if (msg.type === MessageTypes.MapChanged) {
    const self = state.players.get(myId);
    if (self) {
      const p = msg.pos || { x: 0, y: 0, z: 0 };
      self.mesh.position.set(p.x, 0.5, p.z);
      self.target = self.target || { pos: new THREE.Vector3(), yaw: 0 };
      self.target.pos.set(p.x, 0.5, p.z);
      // Reposicionar cámara si estamos en primera persona
      camera.position.set(p.x, HEAD_HEIGHT + predY, p.z);
      chat(`Teletransportado al Mapa ${msg.map}`);
    }
    // Asegurar cuadrícula métrica disponible en cualquier mapa
    try {
      ensureMetricGrids();
      metricGridGroup.visible = metricGridOn;
    } catch {}
    // Guardar mapa actual para lógica de zona segura
    if (typeof msg.map === 'number') state.currentMap = msg.map;
    // Aplicar cielo por mapa y reintentar pointer lock
    try { applySkyForMap(state.currentMap); } catch {}
    tryRelockPointer();
    // cerrar menú si seguía abierto
    hideMapMenu();
  }
  if (msg.type === MessageTypes.ChangeMapDenied) {
    chat(msg.reason || 'Cambio de mapa denegado');
  }
  // Actualizaciones de HP de enemigos
  if (msg.type === MessageTypes.EnemyHP) {
    const e = state.enemies.get(msg.enemyId);
    if (e) {
      e.data = e.data || {};
      e.data.hp = msg.hp;
      // Desactivar titileo/flash en actualización de HP
      console.debug('[WS] EnemyHP', msg.enemyId, 'hp=', msg.hp);
      chat(`EnemyHP ${msg.enemyId} => ${msg.hp}`);
    }
  }
  // Eliminación de enemigo al morir
  if (msg.type === MessageTypes.EnemyDied) {
    console.debug('[WS] EnemyDied', msg.enemyId);
    chat(`EnemyDied ${msg.enemyId}`);
    const e = state.enemies.get(msg.enemyId);
    if (e) {
      scene.remove(e.mesh);
      state.enemies.delete(msg.enemyId);
    }
  }
});

function applySnapshot(s) {
  // Players
  const seenPlayers = new Set();
  for (const p of s.players) {
    seenPlayers.add(p.id);
    let entry = state.players.get(p.id);
    if (!entry) {
      const mesh = makePlayerMesh(p.id === myId, p.color || (p.id === myId ? myCosmetics.color : null), p.form || 'classic');
      // Añadir etiqueta de nombre
      const nameSprite = makeNameSprite(p.name || p.id);
      mesh.add(nameSprite);
      scene.add(mesh);
      // Accesorios deshabilitados
      // Barras 3D (HP/XP)
      const bars = makePlayerBars(Defaults.player.hp ?? 5);
      mesh.add(bars);
      entry = { mesh, data: p, nameSprite, bars, target: { pos: new THREE.Vector3(p.pos.x, 0.5, p.pos.z), yaw: p.yaw }, last: { pos: mesh.position.clone() } };
      state.players.set(p.id, entry);
    }
    // Guardar estado previo antes de sobrescribir entry.data
    const prev = entry.data || {};
    const prevForm = prev.form;
    const prevColor = prev.color;
    const prevAcc = Array.isArray(prev.accessories) ? prev.accessories : null;
    // Si la forma cambió, reconstruir el mesh manteniendo posición
    if (prevForm !== p.form) {
      const oldMesh = entry.mesh;
      const oldPos = oldMesh.position.clone();
      const oldRotY = oldMesh.rotation.y;
      scene.remove(oldMesh);
      const newMesh = makePlayerMesh(p.id === myId, p.color || (p.id === myId ? myCosmetics.color : null), p.form || 'classic');
      const nameSpriteNew = makeNameSprite(p.name || p.id);
      newMesh.add(nameSpriteNew);
      applyAccessories(newMesh, Array.isArray(p.accessories) ? p.accessories : []);
      // recrear barras
      const bars = makePlayerBars(Defaults.player.hp ?? 5);
      newMesh.add(bars);
      newMesh.position.copy(oldPos);
      newMesh.rotation.y = oldRotY;
      scene.add(newMesh);
      entry.mesh = newMesh;
      entry.nameSprite = nameSpriteNew;
      entry.bars = bars;
    }
    // Actualizar etiqueta si cambió el nombre
    // Actualizar etiqueta si cambió el nombre
    if ((entry.nameSprite?.userData.name || '') !== (p.name || '')) {
      const newTex = makeNameTexture(p.name || p.id);
      entry.nameSprite.material.map.dispose?.();
      entry.nameSprite.material.map = newTex;
      entry.nameSprite.userData.name = p.name || p.id;
      entry.nameSprite.material.needsUpdate = true;
    }
    // Actualizar color si cambió (recorrer grupo si es necesario)
    if (p.color && prevColor !== p.color) {
      const applyColor = (obj, colorHex)=>{
        if (obj.material && obj.material.color) {
          obj.material.color = new THREE.Color(colorHex);
          obj.material.needsUpdate = true;
        }
      };
      entry.mesh.traverse(o=> applyColor(o, p.color));
    }
    // Actualizar accesorios solo si cambiaron
    if (Array.isArray(p.accessories)) {
      const changedAccessories = !prevAcc || prevAcc.length !== p.accessories.length || prevAcc.some((v,i)=> v !== p.accessories[i]);
      if (changedAccessories) {
        applyAccessories(entry.mesh, p.accessories);
      }
    }
    // Finalmente, actualizar entry.data con el snapshot actual
    entry.data = p;
    entry.target.pos.set(p.pos.x, p.pos.y ?? 0, p.pos.z);
    entry.target.yaw = p.yaw;
  }
  // remove missing players
  for (const [id, entry] of Array.from(state.players.entries())) {
    if (!seenPlayers.has(id)) { scene.remove(entry.mesh); state.players.delete(id); }
  }

  // Actualizar HUD local si tenemos datos del jugador
  try { const selfData = state.players.get(myId)?.data; if (selfData) updateHUD(selfData); } catch {}

  // Enemies
  const seenEnemies = new Set();
  for (const e of s.enemies) {
    // Mostrar solo enemigos del mapa actual
    if (typeof state.currentMap === 'number' && typeof e.map === 'number' && e.map !== state.currentMap) {
      continue;
    }
    seenEnemies.add(e.id);
    let entry = state.enemies.get(e.id);
    if (!entry) {
      const mesh = makeEnemyMesh();
      scene.add(mesh);
      entry = { mesh, data: e, target: { pos: new THREE.Vector3(e.pos.x, 0.5, e.pos.z), yaw: e.yaw }, lastHp: e.hp, hitTimer: 0 };
      state.enemies.set(e.id, entry);
    }
    // Desactivar feedback de golpe (sin temporizador de flash)
    // if (typeof entry.lastHp === 'number' && typeof e.hp === 'number' && e.hp < entry.lastHp) { }
    entry.lastHp = e.hp;
    entry.data = e;
    entry.target.pos.set(e.pos.x, 0.5, e.pos.z);
    entry.target.yaw = e.yaw;
  }
  for (const [id, entry] of Array.from(state.enemies.entries())) {
    if (!seenEnemies.has(id)) { scene.remove(entry.mesh); state.enemies.delete(id); }
  }

  // Monedas
  const seenCoins = new Set();
  for (const c of (s.coins||[])) {
    seenCoins.add(c.id);
    let entry = state.coins.get(c.id);
    if (!entry) {
      const mesh = makeCoinMesh(c.value);
      mesh.position.set(c.pos.x, 0.1, c.pos.z);
      scene.add(mesh);
      entry = { mesh };
      state.coins.set(c.id, entry);
    } else {
      entry.mesh.position.set(c.pos.x, 0.1, c.pos.z);
    }
  }
  for (const [id, entry] of Array.from(state.coins.entries())) {
    if (!seenCoins.has(id)) { scene.remove(entry.mesh); state.coins.delete(id); }
  }

  // Muros del laberinto (estáticos): construir una sola vez
  if (!state.mazeBuilt && Array.isArray(s.walls)) {
    state.mazeBuilt = true;
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c2733, metalness:0.3, roughness:0.6, emissive:0x0a1a22, emissiveIntensity:0.25 });
    const wallH = Math.max(Defaults.world.maze.wallH, 3.5);
    for (const w of s.walls) {
      const geo = new THREE.BoxGeometry(w.w, wallH, w.h);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(w.x, wallH/2, w.z);
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    // Bordes marcados (edges) para mayor visibilidad
    if (DRAW_WALL_EDGES) {
      const edgesMat = new THREE.LineBasicMaterial({ color: 0x22e0ff, transparent:true, opacity:0.3 });
      for (const child of grp.children) {
        const edges = new THREE.EdgesGeometry(child.geometry, 15);
        const line = new THREE.LineSegments(edges, edgesMat);
        line.position.copy(child.position);
        line.rotation.copy(child.rotation);
        grp.add(line);
      }
    }
    state.mazeGroup = grp;
    scene.add(grp);
  }

  // La esfera de spawn ahora es dinámica vía mensajes SpawnPoint
}

// Enviar input a una tasa fija
setInterval(() => {
  const self = state.players.get(myId)?.data;
  // Usar siempre localYaw/localPitch como única fuente de verdad del look
  if (self && !Number.isFinite(localYaw)) localYaw = self.yaw;
  if (self && localYaw === 0) localYaw = self.yaw; // inicialización suave
  input.yaw = localYaw;
  input.pitch = localPitch;
  // Enviar salto mientras esté dentro de la ventana temporal
  input.jump = (Date.now() < jumpUntilMs);
  if (ws.readyState === WebSocket.OPEN) {
    if (input.jump) { console.debug('[INPUT] jump=true enviado'); chat('Input jump=true enviado'); }
    ws.send(JSON.stringify({ type: MessageTypes.Input, input }));
  }
  // nada que limpiar; la ventana expira sola
}, 33);

// Loop de render
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  // Normalizar yaw para evitar overflow y asegurar giro suave
  if (Number.isFinite(localYaw)) {
    if (localYaw > Math.PI) localYaw -= Math.PI*2;
    else if (localYaw < -Math.PI) localYaw += Math.PI*2;
  }
  // Predicción local de salto: integrar física simple y sumar offset visual
  if (predY > 0 || predVy > 0) {
    const g = Defaults.player.gravity ?? 25;
    predVy -= g * dt;
    predY += predVy * dt;
    if (predY <= 0) { predY = 0; predVy = 0; }
  }

  const aPos = dampFactor(8, dt);
  const aRot = dampFactor(10, dt);
  // Animación de espada y monedas giratorias
  updateGun(dt);

  // Actualizar shaders de plataformas onduladas y animar fractales
  for (const item of state.wavyPlatforms){ if (item?.uniforms?.uTime) item.uniforms.uTime.value += dt; }
  for (const f of state.fractals){ if (f?.mesh) f.mesh.rotation.y += dt*0.4; }

  // Interpolación jugadores
  for (const [id, entry] of state.players) {
    const m = entry.mesh;
    m.position.lerp(entry.target.pos, aPos);
    const vel = new THREE.Vector3().subVectors(entry.target.pos, entry.last.pos);
    entry.last.pos.copy(m.position);
    let desiredYaw = entry.target.yaw;
    if (vel.lengthSq() > 0.00005) {
      desiredYaw = Math.atan2(vel.x, vel.z);
    }
    m.rotation.y = lerpAngle(m.rotation.y, desiredYaw, aRot);
    // Actualizar barras 3D de HP/XP
    if (entry.bars) {
      const maxHp = Defaults.player.hp ?? 5;
      const need = Defaults.player.levelUpXP ?? 100;
      const hp = Math.max(0, Math.min(maxHp, entry.data?.hp ?? maxHp));
      const xp = Math.max(0, entry.data?.xp ?? 0);
      const fracHp = Math.max(0, Math.min(1, hp / maxHp));
      const fracXp = Math.max(0, Math.min(1, xp / need));
      const w = entry.bars.userData.w;
      entry.bars.userData.fgHp.scale.x = fracHp;
      entry.bars.userData.fgHp.position.x = (fracHp-1)*0.5*w;
      entry.bars.userData.fgXp.scale.x = fracXp;
      entry.bars.userData.fgXp.position.x = (fracXp-1)*0.5*w;
    }
  }

  // Interpolación enemigos + actualizar barra de vida + feedback de golpe + segmentos visibles por HP
  for (const entry of state.enemies.values()) {
    const m = entry.mesh;
    m.position.lerp(entry.target.pos, aPos);
    const vel = new THREE.Vector3().subVectors(entry.target.pos, m.position);
    let desiredYaw = entry.target.yaw;
    if (vel.lengthSq() > 0.00005) desiredYaw = Math.atan2(vel.x, vel.z);
    m.rotation.y = lerpAngle(m.rotation.y, desiredYaw, aRot);
    // barra de vida
    if (!entry.hpBar) {
      const bar = makeHpBar(Defaults.enemy.hp);
      m.add(bar); entry.hpBar = bar;
    }
    const frac = Math.max(0, Math.min(1, (entry.data?.hp ?? Defaults.enemy.hp)/Defaults.enemy.hp));
    entry.hpBar.userData.fg.scale.x = frac;
    entry.hpBar.userData.fg.position.x = (frac-1)*0.5*entry.hpBar.userData.w;
    // Sin feedback de golpe: mantener escala y emisivo constantes
    // mostrar segmentos según HP (3->todo, 2->ocultar top, 1->solo bottom, 0->ninguno durante el frame previo a respawn)
    const hp = entry.data?.hp ?? Defaults.enemy.hp;
    const segs = m.userData?.segments || [];
    for (let i=0;i<segs.length;i++) segs[i].visible = i < hp; // i=0 bottom, 1 mid, 2 top
  }

  // Actualizar cámara y resolver colisiones del jugador local si existe (primera persona)
  const selfEntry = state.players.get(myId);
  if (selfEntry) {
    const p = selfEntry.mesh.position;
    try {
      // Resolver colisión contra Cubo 1 principal
      if (state.mainCubo1) {
        resolvePlayerVsCubeXZ(p, state.mainCubo1.position, 0.4); // Cubo 1 principal: 0.8m -> half=0.4
      }
      // Resolver colisión contra Cubo 1 de Cubos 2 (si es sólido)
      const c1 = state.cubos2ById?.get(1);
      if (c1 && c1.userData?.solid) {
        resolvePlayerVsCubeXZ(p, c1.position, 0.3); // Cubos 2: 0.6m -> half=0.3
      }
    } catch {}
    camera.position.set(p.x, HEAD_HEIGHT + predY, p.z);
    camera.rotation.set(localPitch, localYaw, 0, 'YXZ');
  }

  // Girar monedas
  for (const [, c] of state.coins) c.mesh.rotation.z += dt*3.0;

  renderer.render(scene, camera);
}
animate();

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
