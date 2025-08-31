// common/protocol.js
// Tipos y constantes compartidos entre cliente y servidor

export const MessageTypes = {
  Hello: 'hello',              // C -> S { type, name, color?: string('#rrggbb'), accessories?: string[], form?: 'classic'|'futuristic' }
  Welcome: 'welcome',          // S -> C { type, id, snapshot }
  Input: 'input',              // C -> S { type, input: { up, down, left, right, attack, yaw, pitch } }
  WorldState: 'world_state',   // S -> C { type, t, players, enemies, projectiles }
  Pong: 'pong',                // S -> C { type, t }
  HitEnemy: 'hit_enemy',       // C -> S { type, enemyId, damage }
  EnemyHP: 'enemy_hp',         // S -> C { type, enemyId, hp }
  EnemyDied: 'enemy_died',     // S -> C { type, enemyId }
  SpawnPoint: 'spawn_point',   // S -> C { type, pos:{x,z}, visible }
  ChangeMap: 'change_map',     // C -> S { type, map: 1|2 }
  MapChanged: 'map_changed',   // S -> C { type, pos:{x,y,z}, map }
  ChangeMapDenied: 'change_map_denied', // S -> C { type, reason }
};

export const EntityKinds = {
  Player: 'player',
  Enemy: 'enemy',
  Projectile: 'projectile',
  Coin: 'coin',
};

export function nowMs() { return Date.now(); }

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function vec(x=0, y=0, z=0) { return { x, y, z }; }

export const Defaults = {
  tickRate: 30,            // Hz (simulación del servidor)
  broadcastRate: 10,       // Hz (estado del mundo)
  player: {
    radius: 0.5,
    speed: 7.0,           // m/s (más sensible)
    gravity: 24.0,        // m/s^2
    jumpSpeed: 7.5,       // m/s
    dashSpeed: 18.0,      // m/s adicional durante dash
    dashDuration: 0.15,   // s
    dashCooldownMs: 650,  // ms
    hp: 5,
    defaultColor: '#4488ff',
    defaultForm: 'classic', // 'classic' | 'futuristic'
    levelUpXP: 100,
  },
  enemy: {
    radius: 0.8,
    speed: 3.0,
    hp: 10,          // vida inicial de cada slime
    spawn: { x: 0, z: 0 },
    respawnDelayMs: 1000,
    segments: 3,     // partes visibles del cuerpo
  },
  projectile: {
    radius: 0.15,
    speed: 10.0,
    ttlMs: 1500,
    damage: 2,
  },
  coin: {
    radius: 0.35,
    valueMin: 1,
    valueMax: 3,
  },
  world: {
    halfSize: 25.0,
    map1OffsetX: 200.0, // desplazamiento en X para ubicar el Mapa 1 lejos del laberinto
    maze: {
      cols: 15,
      rows: 15,
      cell: 3.0,      // tamaño de celda en metros
      wallW: 0.4,
      wallH: 3.5,
    }
  },
  base: {
    // Centro del respawn de jugadores (coincide con createPlayer): (-half+2, -half+2)
    exclusionRadius: 6.0, // radio donde NO pueden spawnear slimes
  },
  weapon: {
    fireCooldownMs: 250,
    range: 35.0,
  }
};

export function createPlayer(id, name) {
  return {
    id,
    name,
    kind: EntityKinds.Player,
    // Spawn inicial en Mapa 1 (arena) como mapa principal
    pos: vec(-Defaults.world.halfSize + 2 + Defaults.world.map1OffsetX, 0, -Defaults.world.halfSize + 2),
    dir: vec(0, 0, 1),
    yaw: 0,
    hp: Defaults.player.hp,
    gold: 0,
    xp: 0,
    level: 1,
    color: Defaults.player.defaultColor,
    accessories: [], // ['glasses_engineer','glasses_chemist','lab_coat','armor']
    form: Defaults.player.defaultForm,
    lastAttackMs: 0,
    input: { up:false, down:false, left:false, right:false, attack:false, jump:false, dash:false, yaw:0, pitch:0 },
  };
}

export function createEnemy(id) {
  return {
    id,
    kind: EntityKinds.Enemy,
    pos: vec((Math.random()-0.5)*20, 0, (Math.random()-0.5)*20),
    dir: vec(0, 0, 1),
    yaw: Math.random()*Math.PI*2,
    hp: Defaults.enemy.hp,
    ai: { targetYaw: Math.random()*Math.PI*2, changeAt: nowMs()+1000+Math.random()*2000 },
  };
}

export function createProjectile(id, ownerId, pos, dir) {
  return {
    id,
    ownerId,
    kind: EntityKinds.Projectile,
    pos: { ...pos },
    dir: { ...dir },
    born: nowMs(),
  };
}

export function createCoin(id, pos, value=1) {
  return {
    id,
    kind: EntityKinds.Coin,
    pos: { ...pos },
    value,
  };
}

export function circleHit(aPos, aR, bPos, bR) {
  const dx = aPos.x - bPos.x;
  const dz = aPos.z - bPos.z;
  const rr = (aR + bR) * (aR + bR);
  return dx*dx + dz*dz <= rr;
}
