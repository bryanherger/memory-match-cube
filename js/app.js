/**
 * Memory Match Cube
 * The classic Memory card game, laid out on the faces of a cube.
 *
 * Copyright (c) 2020, Bryan Herger and Woodside Labs — BSD 3-Clause.
 * Built on three.js (https://threejs.org, MIT).
 *
 * Rendering: three.js r187, ES modules (see the import map in index.html).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

/* ------------------------------------------------------------------ *
 * Configuration (URL parameters keep games shareable / bookmarkable)
 * ------------------------------------------------------------------ */

const TEXTURE_SETS = ['num', 'sym', 'pic'];
const MAX_TEXTURES = 15;
const TAP_SLOP_PX = 10;

// Number of distinct matching values per (cube size, difficulty) pair.
// Every value is placed twice (or more) so a board is always solvable.
const DISTINCT_VALUES = {
  3: { 3: 2, 4: 2, 5: 13 },
  4: { 3: 4, 4: 7, 5: 14 },
  5: { 3: 2, 4: 7, 5: 14 },
};

const params = new URLSearchParams(window.location.search);

function intParam(name, fallback, min, max) {
  const raw = Number.parseInt(params.get(name), 10);
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.min(max, Math.max(min, value));
}

const config = {
  size: intParam('cube_size', 4, 3, 5),
  difficulty: intParam('cube_scale', 4, 3, 5),
  style: TEXTURE_SETS.includes(params.get('cube_style')) ? params.get('cube_style') : 'num',
  resetWait: intParam('resetwait', 1000, 100, 5000),
};

const distinctValues = DISTINCT_VALUES[config.size][config.difficulty];

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const ui = {
  tiles: document.getElementById('hud-tiles'),
  timer: document.getElementById('hud-timer'),
  loading: document.getElementById('loading'),
  loadingBar: document.getElementById('loading-bar'),
  solved: document.getElementById('solved'),
  solvedTime: document.getElementById('solved-time'),
  form: document.getElementById('options-form'),
  help: document.getElementById('help-dialog'),
};

for (const [name, value] of [
  ['cube_size', config.size],
  ['cube_scale', config.difficulty],
  ['cube_style', config.style],
]) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

ui.form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(ui.form);
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of data) next.set(key, String(value));
  window.location.search = next.toString();
});

document.getElementById('help-button')?.addEventListener('click', () => {
  if (typeof ui.help?.showModal === 'function') ui.help.showModal();
});

document.getElementById('help-close')?.addEventListener('click', () => ui.help?.close());

// Close the Options menu when tapping anywhere else.
document.addEventListener('pointerdown', (event) => {
  const options = document.getElementById('options');
  if (options?.open && !options.contains(event.target)) options.open = false;
});

/* ------------------------------------------------------------------ *
 * Renderer / scene
 * ------------------------------------------------------------------ */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f5f7);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
renderer.domElement.id = 'view';
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Memory Match Cube board');
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.enablePan = false;
controls.rotateSpeed = 0.85;
controls.zoomSpeed = 0.8;
controls.minDistance = config.size * 1.1;
controls.maxDistance = config.size * 4.5;

// Soft, even lighting so the individual tiles read as a grid rather than
// one flat mass. Revealed tiles use unlit materials, so they stay bright.
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa8ba, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(-1, 1.6, -0.8);
scene.add(keyLight);

function requiredDistance() {
  // Distance at which the cube fits both the vertical and horizontal field of
  // view (portrait phones have very little horizontal FOV). 0.7 is a rough
  // silhouette half-extent for a cube seen corner-on, which fills the frame
  // better than the bounding sphere would.
  const radius = config.size * 0.75;
  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const fit = Math.max(radius / Math.sin(vHalf), radius / Math.sin(hHalf)) * 1.08;
  return Math.max(fit, config.size * 1.9); // keep perspective distortion sane
}

function frameCamera() {
  const distance = requiredDistance();
  camera.position.set(0.58, 0.46, 0.72).normalize().multiplyScalar(distance);
  controls.target.set(0, 0, 0);
  controls.update();
}
frameCamera();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Zoom out just enough to keep the whole cube visible; never crop it.
  const offset = camera.position.clone().sub(controls.target);
  const needed = requiredDistance();
  if (offset.length() < needed) {
    camera.position.copy(controls.target).add(offset.setLength(needed));
    controls.update();
  }
});

/* ------------------------------------------------------------------ *
 * Tiles
 * ------------------------------------------------------------------ */

const TILE_SIZE = 0.94; // small gap between neighbours avoids z-fighting
const tileGeometry = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE);
const hiddenMaterials = [
  new THREE.MeshLambertMaterial({ color: 0xccd8e6 }),
  new THREE.MeshLambertMaterial({ color: 0xb9c8d9 }),
];

const tiles = [];
const valueMaterials = []; // index -> MeshBasicMaterial showing the texture

let firstPick = null;
let locked = false;
let remaining = 0;

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Build a board: every tile gets one value, each value appears an even
 * number of times, so the board is always solvable.
 */
function buildBoard() {
  const size = config.size;
  const surfaceCount = size ** 3 - (size - 2) ** 3;
  const pairCount = Math.floor(surfaceCount / 2);

  const values = [];
  for (let pair = 0; pair < pairCount; pair += 1) {
    const value = pair % distinctValues;
    values.push(value, value);
  }
  shuffle(values);

  const offset = (size - 1) / 2;
  let index = 0;

  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) {
        const onSurface =
          x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1;
        if (!onSurface) continue;

        const tile = new THREE.Mesh(tileGeometry, hiddenMaterials[(x + y + z) % 2]);
        tile.position.set(x - offset, y - offset, z - offset);
        tile.userData = { value: values[index], state: 'hidden', shade: (x + y + z) % 2 };
        tiles.push(tile);
        scene.add(tile);
        index += 1;
      }
    }
  }

  remaining = tiles.length;
  updateHud();
}

function reveal(tile) {
  tile.userData.state = 'revealed';
  tile.material = valueMaterials[tile.userData.value];
}

function conceal(tile) {
  tile.userData.state = 'hidden';
  tile.material = hiddenMaterials[tile.userData.shade];
}

function pick(tile) {
  if (locked || !tile || tile.userData.state !== 'hidden') return;

  reveal(tile);

  if (!firstPick) {
    firstPick = tile;
    return;
  }

  const second = tile;

  if (firstPick.userData.value === second.userData.value) {
    firstPick.userData.state = 'matched';
    second.userData.state = 'matched';
    firstPick = null;
    remaining -= 2;
    updateHud();
    if (remaining === 0) solve();
    return;
  }

  locked = true;
  const a = firstPick;
  const b = second;
  firstPick = null;
  window.setTimeout(() => {
    conceal(a);
    conceal(b);
    locked = false;
  }, config.resetWait);
}

/* ------------------------------------------------------------------ *
 * Input: tap to reveal, drag to orbit
 * ------------------------------------------------------------------ */

let pointerStart = null;

/** Tile under a viewport point, or null. Shared by input and debug hooks. */
function tileAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(tiles, false);
  return hits.length > 0 ? hits[0].object : null;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) {
    pointerStart = null;
    return;
  }
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  const start = pointerStart;
  pointerStart = null;
  if (!start || start.id !== event.pointerId) return;

  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  if (moved > TAP_SLOP_PX) return; // that was an orbit gesture, not a tap

  const tile = tileAt(event.clientX, event.clientY);
  if (tile) pick(tile);
});

renderer.domElement.addEventListener('pointercancel', () => {
  pointerStart = null;
});

/* ------------------------------------------------------------------ *
 * HUD, timer, end of game
 * ------------------------------------------------------------------ */

let startedAt = 0;
let timerId = 0;

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function startTimer() {
  startedAt = performance.now();
  if (ui.timer) ui.timer.textContent = formatTime(0);
  timerId = window.setInterval(() => {
    if (ui.timer) ui.timer.textContent = formatTime(performance.now() - startedAt);
  }, 250);
}

function stopTimer() {
  window.clearInterval(timerId);
  timerId = 0;
}

function updateHud() {
  if (ui.tiles) ui.tiles.textContent = String(remaining);
}

function solve() {
  stopTimer();
  const elapsed = performance.now() - startedAt;
  if (ui.timer) ui.timer.textContent = formatTime(elapsed);
  if (ui.solvedTime) ui.solvedTime.textContent = formatTime(elapsed);
  if (ui.solved) {
    ui.solved.hidden = false;
    ui.solved.classList.add('is-open');
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  if (ui.loadingBar) ui.loadingBar.value = total > 0 ? (loaded / total) * 100 : 0;
};
manager.onError = (url) => {
  console.error('Failed to load', url);
  if (ui.loading) ui.loading.textContent = `Could not load ${url}`;
};
manager.onLoad = () => {
  try {
    buildBoard();
    startTimer();
  } finally {
    // Never leave the loader covering the board, even if a HUD node is
    // missing because the markup was edited.
    if (ui.loading) {
      ui.loading.classList.add('is-hidden');
      window.setTimeout(() => ui.loading?.remove(), 300);
    }
  }
};

const loader = new THREE.TextureLoader(manager);

for (let i = 1; i <= distinctValues; i += 1) {
  const texture = loader.load(`textures/${config.style}_${i}.jpg`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  valueMaterials.push(new THREE.MeshBasicMaterial({ map: texture }));
}

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

/* ------------------------------------------------------------------ *
 * Debug / automation hooks (small, read-mostly; helpful when
 * troubleshooting a deployment)
 * ------------------------------------------------------------------ */

window.mmcube = {
  revision: THREE.REVISION,
  config,
  distinctValues,
  scene,
  camera,
  renderer,
  controls,
  tiles,
  /** Index of the tile hit at a viewport point, or -1. */
  tileIndexAt: (clientX, clientY) => tiles.indexOf(tileAt(clientX, clientY)),
  /** Reveal a tile as if tapped (used by automation/tests). */
  pick: (index) => pick(tiles[index]),
  status: () => ({
    remaining,
    total: tiles.length,
    locked,
    firstPick: firstPick ? firstPick.userData.value : null,
    states: tiles.map((tile) => tile.userData.state),
  }),
};
