import * as THREE from 'three';
import { MAP_COLLIDERS, type Collider, type PublicPlayer, type Vec3 } from '../shared/game';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: THREE.ColorRepresentation, roughness = .85) {
  const key = `${color}-${roughness}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
  return materialCache.get(key)!;
}
function box(parent: THREE.Object3D, color: THREE.ColorRepresentation, x: number, y: number, z: number,
  w: number, h: number, d: number, shadow = true) {
  const mesh = new THREE.Mesh(boxGeometry, material(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function sign(parent: THREE.Object3D, text: string, x: number, y: number, z: number, w: number, h: number,
  options: { bg?: string; fg?: string; rotate?: number; sub?: string } = {}) {
  const texture = canvasTexture(512, 256, ctx => {
    ctx.fillStyle = options.bg ?? '#d4c3a3'; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = options.fg ?? '#303d3e';
    ctx.font = `900 ${text.length > 8 ? 66 : 140}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, options.sub ? 110 : 139, 470);
    if (options.sub) { ctx.font = 'bold 23px monospace'; ctx.fillText(options.sub, 256, 211, 470); }
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  mesh.position.set(x, y, z); mesh.rotation.y = options.rotate ?? 0;
  parent.add(mesh);
  return mesh;
}

function makeGround(scene: THREE.Scene) {
  const texture = canvasTexture(1024, 1024, ctx => {
    ctx.fillStyle = '#b9b29d'; ctx.fillRect(0, 0, 1024, 1024);
    let seed = 74;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 24000; i++) {
      ctx.fillStyle = random() > .55 ? 'rgba(255,250,225,.08)' : 'rgba(68,61,48,.07)';
      ctx.fillRect(random() * 1024, random() * 1024, random() * 3 + 1, random() * 3 + 1);
    }
    ctx.strokeStyle = 'rgba(73,69,57,.22)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 256) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1024); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1024, i); ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), new THREE.MeshStandardMaterial({ map: texture, color: '#dfd2b1', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.015; ground.receiveShadow = true; scene.add(ground);
  // Painted wayfinding and loading-bay lines sit flush with the concrete.
  const paint = (x: number, z: number, w: number, d: number, color = '#d9c59b') => box(scene, color, x, .006, z, w, .008, d, false);
  for (const x of [-24, 24]) { paint(x, 0, .12, 46); paint(x + 1.4, 0, .08, 46); }
  for (const z of [-16, 16]) { paint(0, z, 19, .15); paint(-4, z + 2.3, .15, 4.5); paint(4, z + 2.3, .15, 4.5); }
  for (let i = 0; i < 6; i++) {
    const stripe = paint(-3.4 + i * 1.4, 23, .36, 1.4, '#e5ca6e'); stripe.rotation.y = -.5;
  }
  const groundMark = sign(scene, '01', 0, .015, 14, 3.4, 2.2, { bg: '#bdb49c', fg: '#dbcfac', sub: 'LOADING ZONE' });
  groundMark.rotation.x = -Math.PI / 2;
}

function decorateCollider(scene: THREE.Scene, c: Collider) {
  box(scene, c.color, c.x, c.y, c.z, c.w, c.h, c.d);
  const top = c.y + c.h / 2;
  if (c.id === 'bridge') {
    box(scene, '#c6b89a', c.x, top + .025, c.z, c.w + .06, .05, c.d + .06);
    for (const z of [c.z - c.d / 2 - .02, c.z + c.d / 2 + .02]) {
      box(scene, '#817a5e', c.x, .85, z, c.w, .3, .035, false);
      for (let x = -2.6; x < 3; x += .65) {
        const stripe = box(scene, '#d7ba69', x, .85, z + Math.sign(z) * .025, .2, .3, .03, false);
        stripe.rotation.z = -.4;
      }
    }
  } else if (c.kind === 'container') {
    // A few strong ribs read clearly at speed and remain cheap to draw.
    for (let z = c.z - c.d / 2 + .2; z < c.z + c.d / 2; z += .42) {
      box(scene, c.color, c.x - c.w / 2 - .025, c.y, z, .07, c.h - .18, .055, false);
      box(scene, c.color, c.x + c.w / 2 + .025, c.y, z, .07, c.h - .18, .055, false);
    }
    for (const y of [.08, c.h - .08]) box(scene, '#384d52', c.x, y, c.z, c.w + .08, .08, c.d + .08, false);
    for (const x of [-.7, .7]) box(scene, '#aeb6ad', c.x + x, c.y, c.z + c.d / 2 + .022, .045, c.h - .22, .05, false);
    sign(scene, c.id.startsWith('blue') ? 'DFT / 02' : 'DFT / 03', c.x, c.y + .25, c.z + c.d / 2 + .041, c.w * .84, .65, { bg: c.id.startsWith('blue') ? '#496b76' : '#a35e49', fg: '#e9dbc2' });
  } else if (c.kind === 'crate') {
    const band = '#736851';
    for (const y of [c.y - c.h * .36, c.y + c.h * .36]) box(scene, band, c.x, y, c.z, c.w + .04, .09, c.d + .04, false);
    for (const x of [-.36, .36]) box(scene, band, c.x + c.w * x, c.y, c.z, .08, c.h + .03, c.d + .03, false);
    sign(scene, '↑ ↑', c.x, c.y, c.z + c.d / 2 + .024, c.w * .6, .55, { bg: '#a78d66', fg: '#494c43' });
  } else if (c.kind === 'building') {
    // Thin trim, painted columns, shutter doors and glazing on solid facades.
    box(scene, '#5a625b', c.x, top + .045, c.z, c.w + .1, .09, c.d + .1);
    box(scene, '#9c8d72', c.x, .17, c.z, c.w + .05, .34, c.d + .05, false);
    const frontZ = c.z + c.d / 2 + .03;
    box(scene, '#776c56', c.x, 1.2, frontZ, Math.min(3.2, c.w - 1), 2.4, .035, false);
    for (let y = .15; y < 2.4; y += .15) box(scene, '#8d846b', c.x, y, frontZ + .035, Math.min(3.1, c.w - 1.1), .045, .02, false);
    box(scene, '#dc7648', c.x - c.w / 2 + .22, c.y, c.z + c.d / 2 + .04, .44, c.h, .035, false);
    if (c.w > 7) {
      sign(scene, c.id.includes('west') ? '01' : c.id.includes('east') ? '02' : 'F', c.x + c.w / 2 - 1.25, 1.7, frontZ + .02, 1.8, 1.5, { bg: '#c5ad88', fg: '#72674e', sub: 'FOUNDRY' });
      sign(scene, 'NO TRESPASSING', c.x, top - .5, frontZ + .02, 3.2, .44, { bg: '#3d4945', fg: '#d7ceaa' });
    }
    // East/west faces give the main long lanes their industrial rhythm.
    for (const side of [-1, 1]) {
      const x = c.x + side * (c.w / 2 + .022);
      for (let z = c.z - c.d / 2 + 1.7; z < c.z + c.d / 2 - 1; z += 3.4) {
        box(scene, '#b19c7c', x, c.y, z, .055, c.h, .16, false);
        box(scene, '#3f5655', x + side * .012, Math.min(c.h - .6, 2.7), z, .045, .7, 1.9, false);
        box(scene, '#c7b996', x + side * .05, Math.min(c.h - .6, 2.7), z, .05, .73, .055, false);
      }
    }
  } else if (c.kind === 'wall' && c.h > 3) {
    box(scene, '#94876e', c.x, top, c.z, c.w + .08, .15, c.d + .08, false);
    const longAxis = c.w > c.d ? 'x' : 'z';
    const length = Math.max(c.w, c.d);
    for (let n = -length / 2 + 3; n < length / 2; n += 6) {
      box(scene, '#ab9677', c.x + (longAxis === 'x' ? n : 0), c.y, c.z + (longAxis === 'z' ? n : 0), longAxis === 'x' ? .4 : c.w + .2, c.h + .1, longAxis === 'z' ? .4 : c.d + .2, false);
    }
  } else if (c.kind === 'step') {
    const isRoof = c.id.includes('roof');
    box(scene, '#d7c09a', c.x, top + .007, c.z + (isRoof ? 0 : c.d / 2 - .1), isRoof ? c.w : c.w, .015, isRoof ? .08 : .2, false);
  }
}

function scenery(scene: THREE.Scene) {
  // Factory silhouettes beyond the playable perimeter.
  for (const [x, z, w, h, d] of [[-35, -10, 9, 15, 22], [34, -20, 12, 18, 12], [-19, -37, 17, 12, 10], [13, -38, 18, 19, 10], [36, 17, 12, 10, 20], [-35, 29, 12, 12, 10]] as number[][]) {
    box(scene, '#afa58c', x, h / 2, z, w, h, d);
    box(scene, '#7d8276', x, h + .22, z, w + .6, .44, d + .6);
    for (let y = 4; y < h - 1; y += 3.2) {
      box(scene, '#717e75', x, y, z + d / 2 + .02, w - 1.3, 1.4, .05, false);
      for (let x1 = -w / 2 + 1; x1 < w / 2; x1 += 1.5) box(scene, '#aba38b', x + x1, y, z + d / 2 + .06, .12, 1.5, .08, false);
    }
  }
  for (const [x, z] of [[-25, -38], [24, -38], [32, 26]]) {
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.3, 24, 10), material('#a78b74'));
    chimney.position.set(x, 12, z); chimney.castShadow = true; scene.add(chimney);
    for (const y of [15, 17, 19]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.11, 1.11, 1, 10), material('#d4c2a2'));
      band.position.set(x, y, z); scene.add(band);
    }
  }
  // A gantry and cables frame the north sky without obstructing routes.
  for (const x of [-24, 24]) {
    box(scene, '#626e64', x, 7.4, -25.8, .32, 14.8, .4);
    box(scene, '#626e64', x, 13.4, -21.4, .24, .24, 9);
  }
  box(scene, '#687368', 0, 14.8, -25.8, 49, .5, .44);
  for (let x = -24; x < 24; x += 3) {
    const brace = box(scene, '#687368', x + 1.5, 14.1, -25.8, 3.3, .16, .2, false); brace.rotation.z = .43;
  }
  for (const z of [-25.8, 25.8]) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-27, 7, z), new THREE.Vector3(0, 5.2, z), new THREE.Vector3(27, 7, z)]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .035, 4, false), material('#414a42'));
    scene.add(cable);
  }
  sign(scene, 'THE FOUNDRY', -4, 3.5, -27.45, 13, 2, { bg: '#aaa080', fg: '#414b43', sub: 'DRIFT INDUSTRIAL DISTRICT  /  EST. 1984' });
  sign(scene, 'DFT', 27.45, 3, -4, 5, 2, { bg: '#b8a385', fg: '#535b4e', rotate: -Math.PI / 2, sub: 'LIVE FIRE ZONE' });
}

export function createWorld(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b7c9c5');
  scene.fog = new THREE.FogExp2('#c5c6ac', .009);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#7fa6ad') }, bottom: { value: new THREE.Color('#e6d6b3') } },
    vertexShader: 'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top;uniform vec3 bottom;varying vec3 vPos;void main(){float f=pow(max(normalize(vPos).y,0.),.6);gl_FragColor=vec4(mix(bottom,top,f),1.);}',
  }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight('#d9e8df', '#a3956d', 2.35));
  const sun = new THREE.DirectionalLight('#ffe7b0', 3.6);
  sun.position.set(-22, 38, 16); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -43;
  sun.shadow.camera.right = sun.shadow.camera.top = 43;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 115;
  sun.shadow.normalBias = .035; sun.shadow.bias = -.0001; sun.shadow.radius = 3;
  scene.add(sun);
  makeGround(scene);
  MAP_COLLIDERS.forEach(c => decorateCollider(scene, c));
  scenery(scene);
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .05, 260);
  camera.rotation.order = 'YXZ';
  return { renderer, scene, camera, setQuality(quality: string) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1));
    renderer.shadowMap.enabled = quality === 'high';
  } };
}

export interface Avatar {
  group: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; torso: THREE.Group;
  label: THREE.Sprite; health: THREE.Mesh; target: PublicPlayer; walk: number;
}
export function createAvatar(player: PublicPlayer): Avatar {
  const group = new THREE.Group();
  const torso = new THREE.Group(); group.add(torso);
  const suit = '#414e50', dark = '#27383c', accent = player.color;
  box(torso, suit, 0, .98, 0, .55, .65, .32);
  box(torso, accent, 0, 1.18, -.18, .51, .28, .065);
  box(torso, dark, 0, .74, 0, .43, .22, .3);
  box(torso, '#d5c2a1', 0, 1.53, 0, .36, .34, .34);
  box(torso, accent, 0, 1.68, .01, .41, .17, .38);
  box(torso, '#24393d', 0, 1.55, -.179, .32, .115, .035);
  box(torso, '#b6d8ce', 0, 1.56, -.2, .24, .035, .015, false);
  box(torso, accent, -.36, 1.19, 0, .2, .29, .34);
  box(torso, accent, .36, 1.19, 0, .2, .29, .34);
  const leftArm = box(torso, suit, -.3, 1, -.23, .17, .22, .5); leftArm.rotation.x = -.2;
  box(torso, suit, .29, 1, -.2, .17, .22, .5);
  box(torso, dark, .18, 1.04, -.47, .12, .13, .65);
  box(torso, accent, .18, 1.08, -.34, .15, .1, .29);
  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.position.set(side * .16, .7, 0); group.add(pivot);
    box(pivot, suit, 0, -.27, 0, .22, .5, .26);
    box(pivot, dark, 0, -.6, -.045, .24, .18, .35);
    box(pivot, accent, 0, -.25, -.14, .14, .18, .04);
    return pivot;
  });
  const labelMap = canvasTexture(512, 80, ctx => {
    ctx.fillStyle = 'rgba(24,35,36,.78)'; ctx.fillRect(0, 0, 512, 80);
    ctx.fillStyle = '#f3ead9'; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${player.name}${player.isBot ? ' [BOT]' : ''}`, 256, 41, 480);
  });
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelMap, transparent: true, depthTest: true }));
  label.position.set(0, 2.13, 0); label.scale.set(1.65, .258, 1); group.add(label);
  const health = box(group, '#8fc0a1', 0, 1.92, 0, .7, .035, .035, false);
  return { group, leftLeg: legs[0], rightLeg: legs[1], torso, label, health, target: player, walk: 0 };
}

export function createViewmodel() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e8f6ed', '#726e5b', 3));
  const light = new THREE.DirectionalLight('#fff1ce', 4); light.position.set(-2, 4, 1); scene.add(light);
  const camera = new THREE.PerspectiveCamera(67, innerWidth / innerHeight, .01, 5);
  const rig = new THREE.Group(); scene.add(rig);
  const charcoal = '#273536', steel = '#576362', orange = '#cf7045';
  // An original, compact carbine with an open iron sight and angular receiver.
  box(rig, charcoal, 0, 0, .06, .13, .16, .46, false);
  box(rig, orange, 0, .055, -.04, .14, .105, .38, false);
  box(rig, steel, 0, .005, -.36, .1, .11, .31, false);
  for (let i = 0; i < 5; i++) box(rig, '#344342', 0, .055, -.25 - i * .045, .112, .025, .015, false);
  box(rig, '#1c2b2e', 0, .005, -.59, .055, .055, .2, false);
  box(rig, steel, 0, .005, -.7, .073, .074, .05, false);
  box(rig, charcoal, 0, -.025, .34, .105, .16, .28, false);
  box(rig, '#182b2b', 0, -.06, .48, .14, .21, .055, false);
  const grip = box(rig, charcoal, 0, -.17, .095, .085, .23, .115, false); grip.rotation.x = -.25;
  const magazine = box(rig, '#657068', 0, -.17, -.1, .095, .26, .13, false); magazine.rotation.x = .13;
  box(rig, '#1d2d2f', 0, .12, .08, .13, .05, .09, false);
  box(rig, '#16282c', -.05, .17, .08, .025, .08, .055, false);
  box(rig, '#16282c', .05, .17, .08, .025, .08, .055, false);
  box(rig, '#16282c', 0, .13, -.53, .035, .07, .04, false);
  box(rig, '#e4c27b', 0, .176, -.53, .012, .025, .02, false);
  const hand = box(rig, '#445554', .035, -.19, .14, .13, .2, .16, false); hand.rotation.x = -.25;
  const arm = box(rig, '#727968', .09, -.29, .31, .18, .19, .4, false); arm.rotation.x = -.4; arm.rotation.y = -.2;
  box(rig, '#445554', -.025, -.08, -.27, .16, .13, .2, false);
  const forearm = box(rig, '#727968', -.09, -.22, -.09, .17, .17, .43, false); forearm.rotation.x = -.55; forearm.rotation.y = .2;
  const flash = new THREE.Mesh(new THREE.ConeGeometry(.09, .26, 5), new THREE.MeshBasicMaterial({ color: '#ffe19b', transparent: true, opacity: .9, blending: THREE.AdditiveBlending }));
  flash.rotation.x = -Math.PI / 2; flash.position.set(0, 0, -.84); flash.visible = false; rig.add(flash);
  rig.position.set(.28, -.27, -.57);
  return { scene, camera, rig, flash };
}

export function addTracer(scene: THREE.Scene, from: Vec3, to: Vec3) {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ffd49c', transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(line);
  return { object: line, life: .09, dispose() { scene.remove(line); geometry.dispose(); (line.material as THREE.Material).dispose(); } };
}

export function disposeAvatar(avatar: Avatar) {
  avatar.group.parent?.remove(avatar.group);
  const material = avatar.label.material as THREE.SpriteMaterial;
  material.map?.dispose(); material.dispose();
}
