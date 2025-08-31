// server/server.js
// Servidor HTTP + WebSocket y lógica básica del juego
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { MessageTypes, Defaults, createPlayer, createEnemy, createCoin, circleHit } from '../common/protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');

// HTTP server simple para servir archivos estáticos del cliente
const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  // Permite servir también /common/* desde ROOT/common con chequeo de directorio base
  const isCommon = urlPath.startsWith('/common/');
  const isData = urlPath.startsWith('/data/');
  const baseDir = isCommon ? path.join(ROOT, 'common') : isData ? path.join(ROOT, 'data') : CLIENT_DIR;
  // En la rama por defecto (cliente), si la ruta comienza con '/', quitarlo para evitar que path.join ignore CLIENT_DIR
  const relPath = isCommon
    ? urlPath.replace('/common/', '')
    : isData
      ? urlPath.replace('/data/', '')
      : (urlPath.startsWith('/') ? urlPath.slice(1) : urlPath);
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

// WebSocket
const wss = new WebSocketServer({ server });

// Estado del juego
const players = new Map(); // id -> player
const sockets = new Map(); // id -> ws
let nextId = 1;

// Enemigos iniciales: crear 50 para repartir 5 por mapa (1..10)
const enemies = [];
for (let i=1;i<=50;i++) enemies.push(createEnemy('E'+i));
let coins = []; // {id,pos,value}
// Rate limit de daño por beam: map[playerId][enemyId] = lastMs
const lastBeamHitMs = new Map();

// Construir una "casa" de muros alrededor del centro (cx,cz) con una puerta al sur
function addSafeHouseWallsAt(cx, cz) {
  const wallW = Defaults.world.maze.wallW; // grosor
  const a = 4.5; // semilado de la casa
  const doorHalf = 2.0; // mitad del ancho de la puerta (ancho total 4.0m)
  // Lados: usamos segmentos AABB delgados
  // Norte (sin puerta): centro en (cx, cz - a), largo 2a
  walls.push({ x: cx, z: cz - a, w: 2*a, h: wallW });
  // Oeste: centro en (cx - a, cz), alto 2a
  walls.push({ x: cx - a, z: cz, w: wallW, h: 2*a });
  // Este: centro en (cx + a, cz), alto 2*a
  walls.push({ x: cx + a, z: cz, w: wallW, h: 2*a });
  // Sur con puerta centrada: dos segmentos dejando hueco de 2*doorHalf
  const southZ = cz + a;
  const leftLen = a - doorHalf; // desde -a hasta -doorHalf
  const rightLen = a - doorHalf; // desde doorHalf hasta +a
  // Segmento sur izquierdo: centro en (cx - (doorHalf + leftLen)/2, southZ), largo = leftLen + doorHalf (pero mejor calcular exacto)
  // Más simple: dos medias sin cubrir [-a,-doorHalf] y [doorHalf,a]
  walls.push({ x: cx - (a - doorHalf)/2, z: southZ, w: (a - doorHalf), h: wallW });
  walls.push({ x: cx + (a - doorHalf)/2, z: southZ, w: (a - doorHalf), h: wallW });
}

// Construir casas en zonas seguras de ambos mapas
function buildSafeHouses() {
  const s1 = getMapSpawn(1);
  const s2 = getMapSpawn(2);
  // Solo construir casa en Mapa 1 para evitar encierro en Mapa 2
  addSafeHouseWallsAt(s1.x, s1.z);
}

// Muros del laberinto (AABB en XZ): { x, z, w, h }
let walls = [];

// Colisión círculo (x,z,r) contra AABB de muros
function collidesCircleWalls(x,z,r){
  const eps = 0.02;
  for (const w of walls){
    const dx = Math.max(Math.abs(x - w.x) - w.w/2, 0);
    const dz = Math.max(Math.abs(z - w.z) - w.h/2, 0);
    if (dx*dx + dz*dz <= (r+eps)*(r+eps)) return true;
  }
  return false;
}

// Obstáculo circular del respawn de enemigos (colisionable)
const spawnObstacle = { x: Defaults.enemy.spawn.x, z: Defaults.enemy.spawn.z, r: 1.2 };
// Zonas seguras por mapa (casa/base): centros en los spawns de cada mapa
const SAFE_R = Defaults.base?.exclusionRadius ?? 6.0;
const safeZones = [];
for (let m=1;m<=10;m++) safeZones.push({ map: m, x: getMapSpawn(m).x, z: getMapSpawn(m).z, r: SAFE_R });
// Punto visual/activo de respawn (teletransportable); visible solo mientras cuenta el respawn
const spawnPoint = { x: Defaults.enemy.spawn.x, z: Defaults.enemy.spawn.z, visible: false };
function collidesCircleSpawn(x,z,r){
  const dx = x - spawnObstacle.x;
  const dz = z - spawnObstacle.z;
  return (dx*dx + dz*dz) <= (spawnObstacle.r + r) * (spawnObstacle.r + r);
}
function collidesCircleSafeZones(x,z,r){
  for (const s of safeZones){
    const dx = x - s.x, dz = z - s.z;
    if (dx*dx + dz*dz <= (s.r + r) * (s.r + r)) return true;
  }
  return false;
}
function isInSafeZone(map, x, z) {
  for (const s of safeZones) {
    if (s.map !== map) continue;
    const dx = x - s.x, dz = z - s.z;
    if (dx*dx + dz*dz <= s.r * s.r) return true;
  }
  return false;
}
// Para enemigos: paredes + obstáculo de respawn + zonas seguras
function collidesWorld(x,z,r){
  return collidesCircleWalls(x,z,r) || collidesCircleSpawn(x,z,r) || collidesCircleSafeZones(x,z,r);
}

// Busca una posición cercana a (cx,cz) que no colisione con muros/obstáculos ni con otros enemigos
function findClearNear(cx, cz, r = Defaults.enemy.radius) {
  // Búsqueda más amplia con mayor separación mínima para evitar apilamiento
  const maxTries = 80;
  const minSep = r * 3.0; // separación mínima entre centros
  for (let i=0;i<maxTries;i++) {
    const ang = Math.random()*Math.PI*2;
    const dist = 0.5 + Math.random()*3.0; // radio de búsqueda ampliado
    const x = cx + Math.cos(ang)*dist;
    const z = cz + Math.sin(ang)*dist;
    if (collidesWorld(x, z, r)) continue;
    let ok = true;
    for (const e of enemies) {
      const dx = x - e.pos.x, dz = z - e.pos.z;
      if (dx*dx + dz*dz < (minSep*minSep)) { ok = false; break; }
    }
    if (ok) return { x, z };
  }
  return { x: cx, z: cz };
}

// Mover con colisiones usando subpasos para evitar atravesar esquinas en dt grandes
function moveWithCollisions(pos, vx, vz, r) {
  const steps = 8;
  let x = pos.x, z = pos.z;
  for (let i=0;i<steps;i++){
    const sx = vx/steps, sz = vz/steps;
    let nx = x + sx;
    let nz = z + sz;
    // Eje X con bisección simple
    if (!collidesWorld(nx, z, r)) x = nx;
    else {
      let f = 0.5; let moved = false;
      for (let k=0;k<3;k++) { // probar 1/2, 1/4, 1/8 del paso
        const tx = x + sx * f;
        if (!collidesWorld(tx, z, r)) { x = tx; moved = true; break; }
        f *= 0.5;
      }
      if (!moved) { /* bloqueado en X, no mover */ }
    }
    // Eje Z con bisección simple
    if (!collidesWorld(x, nz, r)) z = nz;
    else {
      let f = 0.5; let moved = false;
      for (let k=0;k<3;k++) {
        const tz = z + sz * f;
        if (!collidesWorld(x, tz, r)) { z = tz; moved = true; break; }
        f *= 0.5;
      }
      if (!moved) { /* bloqueado en Z, no mover */ }
    }
  }
  return { x, z };
}

function buildMaze() {
  const { cols, rows, cell, wallW } = Defaults.world.maze;
  walls = [];
  // Bordes del mundo
  const half = Defaults.world.halfSize;
  walls.push({ x: 0, z: -half, w: half*2, h: wallW });
  walls.push({ x: 0, z:  half, w: half*2, h: wallW });
  walls.push({ x: -half, z: 0, w: wallW, h: half*2 });
  walls.push({ x:  half, z: 0, w: wallW, h: half*2 });
  // Maze por división recursiva simple
  const startX = -cols*cell/2, startZ = -rows*cell/2;
  function div(x0,y0,x1,y1) {
    const w = x1-x0, h = y1-y0;
    if (w < 2 || h < 2) return;
    if (w > h) {
      const x = Math.floor((x0+x1)/2);
      const gap = Math.floor(Math.random()*(y1-y0))+y0;
      for (let y=y0; y<y1; y++) if (y!==gap) {
        const wx = startX + x*cell; const wz = startZ + (y+0.5)*cell;
        walls.push({ x: wx, z: wz, w: wallW, h: cell });
      }
      div(x0,y0,x,y1); div(x+1,y0,x1,y1);
    } else {
      const y = Math.floor((y0+y1)/2);
      const gap = Math.floor(Math.random()*(x1-x0))+x0;
      for (let x=x0; x<x1; x++) if (x!==gap) {
        const wx = startX + (x+0.5)*cell; const wz = startZ + y*cell;
        walls.push({ x: wx, z: wz, w: cell, h: wallW });
      }
      div(x0,y0,x1,y); div(x0,y+1,x1,y1);
    }
  }
  div(0,0,cols,rows);
}
// Construcción de muros del Mapa 1: arena sin laberinto, solo perímetro, desplazada en X
function buildArena(offsetX) {
  const half = Defaults.world.halfSize;
  const wallW = Defaults.world.maze.wallW;
  // Perímetro rectangular alto; el cliente les dará look futurista con el material
  walls.push({ x: offsetX + 0, z: -half, w: half*2, h: wallW });
  walls.push({ x: offsetX + 0, z:  half, w: half*2, h: wallW });
  walls.push({ x: offsetX - half, z: 0, w: wallW, h: half*2 });
  walls.push({ x: offsetX +  half, z: 0, w: wallW, h: half*2 });
}
// Construir ambos mapas en un mismo mundo
buildMaze();
buildArena(Defaults.world.map1OffsetX);

// Utilidad: spawn por mapa
function getMapSpawn(map){
  const half = Defaults.world.halfSize;
  const x = (map === 1) ? (-half + 2 + Defaults.world.map1OffsetX) : (-half + 2);
  const z = -half + 2;
  return { x, z };
}

// Clamp de posición según mapa (X depende del mapa; Z es global)
function clampToMap(pos, map){
  const half = Defaults.world.halfSize;
  const minX = (map === 1) ? (Defaults.world.map1OffsetX - half) : (-half);
  const maxX = (map === 1) ? (Defaults.world.map1OffsetX + half) : (half);
  const x = Math.max(minX, Math.min(maxX, pos.x));
  const z = Math.max(-half, Math.min(half, pos.z));
  return { x, z };
}

// Elegir un punto aleatorio válido para el spawn de slimes, evitando la base de jugadores
function randomSpawnPos(map = 2) {
  const half = Defaults.world.halfSize;
  const baseX = (map === 1) ? (-half + 2 + Defaults.world.map1OffsetX) : (-half + 2);
  const baseZ = -half + 2;
  // Evitar cercanía a la base: anillo entre 2m y 8m del spawn
  const ang = Math.random()*Math.PI*2;
  const r = 2 + Math.random()*6;
  const x = baseX + Math.cos(ang)*r;
  const z = baseZ + Math.sin(ang)*r;
  return { x, z };
}

// Distribuir slimes iniciales de forma aleatoria evitando apilamiento y colisiones
function distributeInitialEnemies(){
  // Repartir 5 enemigos por mapa (1..10)
  const perMap = 5;
  let idx = 0;
  for (let map=1; map<=10; map++){
    for (let k=0; k<perMap; k++){
      const e = enemies[idx++]; if (!e) break;
      e.map = map;
      const p = randomSpawnPos(map);
      const q = findClearNear(p.x, p.z, Defaults.enemy.radius);
      e.pos.x = q.x; e.pos.z = q.z; e.pos.y = 0;
      e.hp = Defaults.enemy.hp;
    }
  }
}
// Ejecutar después de construir el laberinto y antes de aceptar conexiones
buildSafeHouses();
distributeInitialEnemies();

// Utilidades
function broadcast(msgObj) {
  const data = JSON.stringify(msgObj);
  for (const ws of sockets.values()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function getSnapshot() {
  return {
    t: Date.now(),
    players: Array.from(players.values()).map(p => ({ id:p.id, name:p.name, pos:p.pos, yaw:p.yaw, hp:p.hp, gold:p.gold, xp:p.xp ?? 0, level:p.level ?? 1, color:p.color, accessories:p.accessories, form:p.form })),
    enemies: enemies.map(e => ({ id:e.id, pos:e.pos, yaw:e.yaw, hp:e.hp, map:e.map })),
    coins: coins.map(c => ({ id:c.id, pos:c.pos, value:c.value })),
    walls
  };
}

wss.on('connection', (ws) => {
  const id = 'P' + (nextId++);
  let player = createPlayer(id, 'Jugador ' + id);
  players.set(id, player);
  sockets.set(id, ws);
  // mapa por defecto
  player.map = 1;

  // Mensaje de bienvenida y snapshot inicial
  ws.send(JSON.stringify({ type: MessageTypes.Welcome, id, snapshot: getSnapshot() }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === MessageTypes.Hello) {
      if (typeof msg.name === 'string') {
        player.name = msg.name.substring(0, 20);
      }
      if (typeof msg.color === 'string') {
        const ok = /^#([0-9a-fA-F]{6})$/.test(msg.color);
        if (ok) player.color = msg.color;
      }
      if (Array.isArray(msg.accessories)) {
        const allow = new Set(['glasses_engineer','glasses_chemist','lab_coat','armor']);
        const acc = msg.accessories.filter(a => typeof a === 'string' && allow.has(a));
        player.accessories = acc.slice(0,4);
      }
      if (typeof msg.form === 'string') {
        const allowedForms = new Set(['classic','futuristic','technologic','medieval','cyberpunk','cartoon','steampunk','slime']);
        if (allowedForms.has(msg.form)) player.form = msg.form;
      }
    }

    if (msg.type === MessageTypes.Input && msg.input && players.has(id)) {
      const inp = msg.input;
      player.input.up = !!inp.up;
      player.input.down = !!inp.down;
      player.input.left = !!inp.left;
      player.input.right = !!inp.right;
      player.input.attack = !!inp.attack;
      player.input.jump = !!inp.jump;
      player.input.dash = !!inp.dash;
      player.yaw = typeof inp.yaw === 'number' ? inp.yaw : player.yaw;
      if (player.input.jump) console.log(`[INPUT] ${id} jump=true`);
    }

    // Cambio de mapa por solicitud del cliente
    if (msg.type === MessageTypes.ChangeMap) {
      const map = Number(msg.map);
      if (!(map >= 1 && map <= 10)) return;
      // Gating: mapa N requiere nivel >= N (N>=2)
      if (map >= 2 && (player.level ?? 1) < map) {
        ws.send(JSON.stringify({ type: MessageTypes.ChangeMapDenied, reason: `Nivel insuficiente (requiere nivel ${map})` }));
        return;
      }
      const half = Defaults.world.halfSize;
      const spawnX = (map === 1) ? (-half + 2 + Defaults.world.map1OffsetX) : (-half + 2);
      const spawnZ = -half + 2;
      player.pos.x = spawnX; player.pos.z = spawnZ; player.pos.y = 0;
      // opcional: orientar hacia +Z
      player.yaw = 0;
      player.map = map;
      // Responder al solicitante con la nueva posición
      ws.send(JSON.stringify({ type: MessageTypes.MapChanged, pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z }, map }));
      return;
    }

    // Impacto reportado por el cliente (beam o disparo): aplicar rate-limit por jugador/enemigo
    if (msg.type === MessageTypes.HitEnemy && typeof msg.enemyId === 'string') {
      const eIdx = enemies.findIndex(e => e.id === msg.enemyId);
      if (eIdx !== -1) {
        const e = enemies[eIdx];
        // Rate-limit: un hit cada 100ms por jugador/enemigo
        const nowMs = Date.now();
        let perEnemy = lastBeamHitMs.get(id);
        if (!perEnemy) { perEnemy = new Map(); lastBeamHitMs.set(id, perEnemy); }
        const lastMs = perEnemy.get(e.id) || 0;
        if (nowMs - lastMs < 100) return; // ignorar golpes más rápidos que 0.1s
        perEnemy.set(e.id, nowMs);
        // Daño por tick (1 base; más adelante se multiplicará por stats de ATK)
        const dmg = Math.max(1, Math.floor(Number(msg.damage ?? 1)) || 1);
        e.hp = Math.max(0, (e.hp ?? Defaults.enemy.hp) - dmg);
        console.log(`[HIT] ${id} -> ${e.id} dmg=${dmg} hp=${e.hp}`);
        if (e.hp <= 0) {
          const dead = enemies.splice(eIdx, 1)[0];
          console.log(`[DEAD] ${dead.id} eliminado`);
          broadcast({ type: MessageTypes.EnemyDied, enemyId: dead.id });
          // Otorgar XP al jugador que eliminó al slime
          const killer = players.get(id);
          if (killer) {
            killer.xp = (killer.xp ?? 0) + 10;
            // Subir de nivel cada 100 XP (configurable)
            const need = Defaults.player.levelUpXP ?? 100;
            if (typeof killer.level !== 'number') killer.level = 1;
            while (killer.xp >= need) {
              killer.xp -= need;
              killer.level += 1;
            }
          }
          // Siempre teletransportar la esfera a un lugar aleatorio (evitando la base) y mostrarla durante el countdown
          const p = randomSpawnPos(dead.map || 2);
          spawnPoint.x = p.x; spawnPoint.z = p.z; spawnPoint.visible = true;
          // mover el obstáculo de colisión junto con el punto de spawn
          spawnObstacle.x = p.x; spawnObstacle.z = p.z;
          broadcast({ type: MessageTypes.SpawnPoint, pos: { x: spawnPoint.x, z: spawnPoint.z }, visible: true });
          // Respawn tras delay (1s por Defaults)
          setTimeout(() => {
            const ne = createEnemy(dead.id);
            ne.map = dead.map || 2;
            // buscar un punto libre cercano al punto de spawn para evitar apilamiento
            const base = randomSpawnPos(ne.map);
            const q = findClearNear(base.x, base.z, Defaults.enemy.radius);
            ne.pos.x = q.x; ne.pos.z = q.z; ne.pos.y = 0;
            ne.hp = Defaults.enemy.hp;
            enemies.push(ne);
            console.log(`[RESPAWN] ${ne.id} en (${ne.pos.x.toFixed(2)}, ${ne.pos.z.toFixed(2)}) con hp=${ne.hp}`);
            // Ocultar la esfera de spawn al completar el respawn
            spawnPoint.visible = false;
            // conservar el último lugar como obstáculo hasta que se mueva en la próxima muerte
            broadcast({ type: MessageTypes.SpawnPoint, pos: { x: spawnPoint.x, z: spawnPoint.z }, visible: false });
          }, Defaults.enemy.respawnDelayMs || 1000);
        } else {
          broadcast({ type: MessageTypes.EnemyHP, enemyId: e.id, hp: e.hp });
        }
      }
    }
  });

  ws.on('close', () => {
    sockets.delete(id);
    players.delete(id);
  });
});

// Lógica del juego
let lastTick = Date.now();
const dtMs = Math.floor(1000 / Defaults.tickRate);

setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTick) / 1000; // en segundos
  if (dt <= 0) dt = 1 / Defaults.tickRate;
  lastTick = now;

  const half = Defaults.world.halfSize;

  // Inputs por jugador
  for (const p of players.values()) {
    const sp = Defaults.player.speed;
    if (p.vy === undefined) p.vy = 0;
    if (p.grounded === undefined) p.grounded = true;
    if (p.lastDashMs === undefined) p.lastDashMs = 0;
    if (p.dashUntil === undefined) p.dashUntil = 0;
    // Dirección en plano XZ a partir de yaw (mirada)
    // Forward estándar; el cliente ya decide qué flag (up/down) mandar
    const forward = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
    let vx = 0, vz = 0;
    if (p.input.up) { vx += forward.x; vz += forward.z; }
    if (p.input.down) { vx -= forward.x; vz -= forward.z; }
    if (p.input.right) { vx += right.x;   vz += right.z; }
    if (p.input.left)  { vx -= right.x;   vz -= right.z; }
    // Activación de dash
    if (p.input.dash && (p.lastDashMs === 0 || now - p.lastDashMs > Defaults.player.dashCooldownMs)) {
      p.lastDashMs = now;
      p.dashUntil = now + Math.floor(Defaults.player.dashDuration * 1000);
    }
    const dashing = now < p.dashUntil;
    // Dirección normalizada para mover en XZ
    const len = Math.hypot(vx, vz);
    let dirx = 0, dirz = 0;
    if (len > 0) { dirx = vx/len; dirz = vz/len; }
    // Velocidad base + impulso de dash (no se normaliza fuera)
    let speed = sp;
    if (dashing) speed += Defaults.player.dashSpeed;
    let nx = p.pos.x + dirx * speed * dt;
    let nz = p.pos.z + dirz * speed * dt;
    // Colisión con paredes (AABB vs círculo)
    // (usa collidesCircleWalls definido a nivel superior)
    // Resolver por ejes
    const r = Defaults.player.radius;
    if (!collidesCircleWalls(nx, p.pos.z, r)) p.pos.x = nx;
    if (!collidesCircleWalls(p.pos.x, nz, r)) p.pos.z = nz;
    const cP = clampToMap(p.pos, p.map || 1);
    p.pos.x = cP.x; p.pos.z = cP.z;

    // Salto y gravedad simple en Y con suelo en y=0
    if (p.input.jump && p.grounded) { p.vy = Defaults.player.jumpSpeed; p.grounded = false; }
    p.vy -= Defaults.player.gravity * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.grounded = true; }

    // Se elimina el daño hitscan automático; el daño llega vía mensajes HitEnemy del cliente
  }

  // Enemigos: caminar cambiando dirección cada cierto tiempo
  for (const e of enemies) {
    // Elegir jugador objetivo más cercano EN EL MISMO MAPA y que no esté en zona segura
    let best = null; let bestD2 = Infinity;
    for (const p of players.values()) {
      if ((p.map || 1) !== (e.map || 2)) continue;
      if (isInSafeZone(p.map || 1, p.pos.x, p.pos.z)) continue;
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const d2 = dx*dx + dz*dz;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    // Actualizar rumbo hacia el objetivo o vagar si no hay jugadores
    if (best) {
      const targetYaw = Math.atan2(best.pos.x - e.pos.x, best.pos.z - e.pos.z);
      e.ai.targetYaw = targetYaw;
      e.ai.changeAt = now + 300; // actualizar con frecuencia
    } else if (now >= e.ai.changeAt) {
      e.ai.targetYaw = Math.random()*Math.PI*2;
      e.ai.changeAt = now + 1000 + Math.random()*2000;
    }
    // interpolar yaw suavemente
    let dy = e.ai.targetYaw - e.yaw;
    while (dy > Math.PI) dy -= Math.PI*2;
    while (dy < -Math.PI) dy += Math.PI*2;
    e.yaw += Math.sign(dy) * Math.min(Math.abs(dy), 2.5*dt);

    const sp = Defaults.enemy.speed;
    const vx = Math.sin(e.yaw) * sp * dt;
    const vz = Math.cos(e.yaw) * sp * dt;
    const rE = Defaults.enemy.radius;
    const prevX = e.pos.x, prevZ = e.pos.z;
    const moved = moveWithCollisions(e.pos, vx, vz, rE);
    e.pos.x = moved.x; e.pos.z = moved.z;
    const cE = clampToMap(e.pos, e.map || 2);
    e.pos.x = cE.x; e.pos.z = cE.z;

    // Anti-atasco: si el enemigo casi no se desplaza durante un periodo, forzar cambio de rumbo y reposicionamiento leve
    if (e.ai === undefined) e.ai = {};
    const dxSt = e.pos.x - (e.ai.lastX ?? prevX);
    const dzSt = e.pos.z - (e.ai.lastZ ?? prevZ);
    const d2 = dxSt*dxSt + dzSt*dzSt;
    const movedEnough = d2 > 0.0004; // ~2cm^2 por tick
    const nowMs = now; // ya en ms
    if (!movedEnough) {
      e.ai.stuckMs = (e.ai.stuckMs ?? 0) + Math.floor(dt*1000);
    } else {
      e.ai.stuckMs = 0;
    }
    e.ai.lastX = e.pos.x; e.ai.lastZ = e.pos.z;
    if ((e.ai.stuckMs ?? 0) > 1500) {
      // Reposicionar cerca evitando muros y apilamiento, y cambiar dirección
      const q = findClearNear(e.pos.x, e.pos.z, rE);
      e.pos.x = q.x; e.pos.z = q.z;
      e.ai.targetYaw = Math.random()*Math.PI*2;
      e.ai.changeAt = nowMs + 500 + Math.random()*500;
      e.ai.stuckMs = 0;
    }

    // Daño por colisión a jugadores con probabilidad y cooldown
    for (const p of players.values()) {
      if ((p.map || 1) !== (e.map || 2)) continue;
      if (isInSafeZone(p.map || 1, p.pos.x, p.pos.z)) continue;
      const hit = circleHit(e.pos, Defaults.enemy.radius, p.pos, Defaults.player.radius);
      if (!hit) continue;
      const cdMs = 800; // cooldown por jugador
      if (typeof p.lastHurtMs !== 'number') p.lastHurtMs = 0;
      if (now - p.lastHurtMs < cdMs) continue;
      p.lastHurtMs = now;
      // 50% de probabilidad de daño
      if (Math.random() < 0.5) {
        const dmg = 2 + Math.floor(Math.random()*3); // 2..4
        p.hp = Math.max(0, (p.hp ?? Defaults.player.hp) - dmg);
        // Muerte y respawn
        if (p.hp <= 0) {
          // perder 5% de XP sin bajar de 0
          p.xp = Math.max(0, Math.floor((p.xp ?? 0) * 0.95));
          // Respawn en spawn del mapa actual
          const spawn = getMapSpawn(p.map || 1);
          p.pos.x = spawn.x; p.pos.z = spawn.z; p.pos.y = 0;
          p.yaw = 0;
          p.hp = Defaults.player.hp;
        }
      }
    }
  }

  // (El respawn de enemigos ahora se maneja al morir con un setTimeout)

  // Recolección de monedas por jugadores
  coins = coins.filter(c => {
    let alive = true;
    for (const p of players.values()) {
      if (circleHit(c.pos, Defaults.coin.radius, p.pos, Defaults.player.radius)) {
        p.gold += c.value;
        alive = false; break;
      }
    }
    return alive;
  });
}, dtMs);

// Broadcast del estado
setInterval(() => {
  broadcast({ type: MessageTypes.WorldState, ...getSnapshot() });
}, Math.floor(1000 / Defaults.broadcastRate));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
