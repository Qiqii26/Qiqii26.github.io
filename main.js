/*
 * main.js
 *
 * 这是一个使用 Three.js 构建的简单 3D 开放世界冒险游戏示例。
 * 它演示了如何使用 PointerLockControls 实现第一人称移动、
 * 程序生成地形、散布可拾取物品以及保存游戏进度。
 *
 * 为了使代码结构清晰，我们将所有逻辑封装在一个立即执行的异步
 * 函数中。该函数在文档加载完成后运行。
 *
 * 学习资源：
 * - Discover Three.js 关于通过 CDN 引入 Three.js 的文档，指出
 *   可以直接从 skypack 等 CDN 加载模块，并建议锁定版本【516051025726045†L143-L160】。
 * - jsDelivr 提供的 PointerLockControls 模块注释指出它
 *   非常适合第一人称 3D 游戏，并提供了使用示例【789272000289292†L38-L46】。
 */

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Clock,
  Vector3,
  DirectionalLight,
  AmbientLight,
  Fog,
  PlaneGeometry,
  MeshStandardMaterial,
  Mesh,
  IcosahedronGeometry,
  MeshBasicMaterial,
  Color,
  Raycaster,
  AxesHelper
} from 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';

import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/controls/PointerLockControls.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/controls/OrbitControls.js';
import { ImprovedNoise } from 'https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/math/ImprovedNoise.js';

(function () {
  // 获取 DOM 元素
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const missionDiv = document.getElementById('mission');
  const instructionsDiv = document.getElementById('instructions');
  const crosshair = document.getElementById('crosshair');

  // 移动端虚拟按键元素
  const mobileControls = document.getElementById('mobileControls');
  const mcUp = document.getElementById('mc-up');
  const mcDown = document.getElementById('mc-down');
  const mcLeft = document.getElementById('mc-left');
  const mcRight = document.getElementById('mc-right');
  const mcJump = document.getElementById('mc-jump');
  const mcPick = document.getElementById('mc-pick');

  // 检测是否为移动设备或不支持指针锁定
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
  const supportsPointerLock = 'pointerLockElement' in document;
  let usingPointerLock = false;

  // 声明 Three.js 相关变量
  let scene, camera, renderer, controls, clock;
  let terrainMesh;
  let collectibles = [];
  let collectedCount = 0;
  const TOTAL_COLLECTIBLES = 5;
  const worldSize = 500; // 平面地形一边的大小（正方形），单位：米

  // 高度图相关
  const noise = new ImprovedNoise();
  const noiseScale = 0.15;
  const noiseAmplitude = 20;

  // 玩家状态
  let velocity = new Vector3();
  let direction = new Vector3();
  let canJump = false;
  const gravity = 9.8;
  let prevTime = performance.now();

  // 从本地存储恢复游戏进度
  function loadSave() {
    const raw = localStorage.getItem('eow3d_save');
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data;
    } catch (_) {
      return null;
    }
  }

  // 保存游戏进度
  function saveGame() {
    const data = {
      position: camera.position.toArray(),
      collected: collectibles.map(c => c.collected),
      collectedCount
    };
    localStorage.setItem('eow3d_save', JSON.stringify(data));
  }

  // 生成高度值
  function getHeight(x, z) {
    // 将世界坐标映射到噪声空间
    const h = noise.noise(x * noiseScale, z * noiseScale, 0);
    return h * noiseAmplitude;
  }

  // 创建地形
  function createTerrain() {
    const segments = 256;
    const geometry = new PlaneGeometry(worldSize, worldSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    // 遍历顶点设定高度
    const vertices = geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const vx = vertices.getX(i);
      const vz = vertices.getZ(i);
      const y = getHeight(vx, vz);
      vertices.setY(i, y);
    }
    vertices.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new MeshStandardMaterial({ color: new Color(0x556d3d), flatShading: false });
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  // 创建星核碎片
  function createCollectibles() {
    const positions = [];
    // 根据种子生成固定位置，使每次加载相同
    for (let i = 0; i < TOTAL_COLLECTIBLES; i++) {
      const angle = (i / TOTAL_COLLECTIBLES) * Math.PI * 2;
      const radius = worldSize * 0.35;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions.push([x, z]);
    }
    return positions.map(pos => {
      const geom = new IcosahedronGeometry(2.5, 1);
      const mat = new MeshStandardMaterial({ color: new Color(0xffe57a), emissive: new Color(0xffd76a) });
      const mesh = new Mesh(geom, mat);
      mesh.position.set(pos[0], getHeight(pos[0], pos[1]) + 3, pos[1]);
      mesh.castShadow = true;
      mesh.collected = false;
      scene.add(mesh);
      return mesh;
    });
  }

  // 初始化场景
  function initScene(saved) {
    scene = new Scene();
    scene.background = new Color(0xaecce3);
    scene.fog = new Fog(0xaecce3, 50, 400);

    camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    clock = new Clock();

    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // 根据设备选择控制方式：桌面使用 PointerLockControls，移动端或不支持指针锁定时使用 OrbitControls
    if (isMobile || !supportsPointerLock) {
      usingPointerLock = false;
      controls = new OrbitControls(camera, renderer.domElement);
      // 禁止缩放和平移，启用阻尼使视角更平滑
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
    } else {
      usingPointerLock = true;
      controls = new PointerLockControls(camera, document.body);
      controls.pointerSpeed = 1.0;
    }

    // 添加光源
    const sun = new DirectionalLight(0xffffff, 1.0);
    sun.position.set(100, 200, 100);
    sun.castShadow = true;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    scene.add(sun);
    scene.add(new AmbientLight(0x888888));

    // 创建地形并添加到场景
    terrainMesh = createTerrain();
    scene.add(terrainMesh);

    // 创建星核碎片
    collectibles = createCollectibles();

    // 如果有存档，则恢复玩家位置和拾取状态
    if (saved) {
      const [px, py, pz] = saved.position;
      camera.position.set(px, py, pz);
      collectedCount = saved.collectedCount || 0;
      collectibles.forEach((c, i) => {
        const collected = saved.collected && saved.collected[i];
        if (collected) {
          c.collected = true;
          scene.remove(c);
        }
      });
    } else {
      // 初始位置设定在世界中心
      const x = 0;
      const z = 0;
      const y = getHeight(x, z) + 5;
      camera.position.set(x, y, z);
    }

    // 添加坐标辅助（可选）
    // const axes = new AxesHelper(20);
    // scene.add(axes);

    updateMissionText();
  }

  // 更新任务文本
  function updateMissionText() {
    if (!missionDiv) return;
    missionDiv.style.display = 'block';
    if (collectedCount < TOTAL_COLLECTIBLES) {
      missionDiv.innerHTML = `任务：收集星核碎片 <strong>${collectedCount}/${TOTAL_COLLECTIBLES}</strong>。\n到达每个碎片附近并按 <kbd>E</kbd> 键拾取。`;
    } else {
      missionDiv.innerHTML = `任务完成！您已收集所有星核碎片。随意探索世界或刷新页面重新开始。`;
    }
  }

  // 游戏循环
  function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    // 根据当前控制方式更新移动和交互
    const active = !usingPointerLock || (controls && controls.isLocked === true);
    if (active) {
      direction.set(0, 0, 0);
      const moveForward = keys['w'] || keys['arrowup'];
      const moveBackward = keys['s'] || keys['arrowdown'];
      const moveLeft = keys['a'] || keys['arrowleft'];
      const moveRight = keys['d'] || keys['arrowright'];
      const running = keys['shift'];

      // 设置方向向量
      direction.z = Number(moveForward) - Number(moveBackward);
      direction.x = Number(moveRight) - Number(moveLeft);
      direction.normalize();

      // 基于 Running 增加速度
      const speed = running ? 400 : 200;
      if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
      if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

      // 跳跃
      if (canJump && keys['space']) {
        velocity.y = 350;
        canJump = false;
      }

      // 应用重力
      velocity.y -= gravity * 50.0 * delta;

      // 阻尼
      velocity.x -= velocity.x * 10.0 * delta;
      velocity.z -= velocity.z * 10.0 * delta;

      // 计算新的位置，根据控制方式移动
      const dx = -velocity.x * delta;
      const dz = -velocity.z * delta;

      if (usingPointerLock) {
        // PointerLockControls 提供 moveForward/moveRight 用于根据相机方向移动
        controls.moveRight(dx);
        controls.moveForward(dz);
      } else {
        // OrbitControls 情况下，根据相机朝向计算移动向量
        const forward = new Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const rightVec = new Vector3();
        rightVec.crossVectors(forward, new Vector3(0, 1, 0)).normalize();
        camera.position.addScaledVector(rightVec, dx);
        camera.position.addScaledVector(forward, dz);
      }

      // 垂直移动
      camera.position.y += velocity.y * delta;

      // 地形高度限制
      const groundY = getHeight(camera.position.x, camera.position.z) + 3;
      if (camera.position.y < groundY) {
        velocity.y = 0;
        camera.position.y = groundY;
        canJump = true;
      }

      // 限制在世界边界内
      const halfSize = worldSize / 2 - 5;
      camera.position.x = Math.min(Math.max(camera.position.x, -halfSize), halfSize);
      camera.position.z = Math.min(Math.max(camera.position.z, -halfSize), halfSize);

      // 按 E 拾取星核
      if (keys['e']) {
        keys['e'] = false; // 避免重复拾取
        for (const item of collectibles) {
          if (!item.collected) {
            const dist = camera.position.distanceTo(item.position);
            if (dist < 6) {
              item.collected = true;
              scene.remove(item);
              collectedCount++;
              updateMissionText();
              saveGame();
              break;
            }
          }
        }
      }
    }

    // 如果使用 OrbitControls，则让控制器追踪相机位置并更新阻尼
    if (!usingPointerLock && controls) {
      controls.target.copy(camera.position);
      controls.update();
    }

    renderer.render(scene, camera);
  }

  // 键盘事件
  const keys = {};
  function onKeyDown(event) {
    keys[event.key.toLowerCase()] = true;
  }
  function onKeyUp(event) {
    keys[event.key.toLowerCase()] = false;
  }

  // 为移动端绑定虚拟按键触摸事件
  function setupMobileControls() {
    if (!mobileControls) return;
    function bindButton(btn, key) {
      if (!btn) return;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        keys[key] = true;
      }, { passive: false });
      const endHandler = (e) => {
        e.preventDefault();
        keys[key] = false;
      };
      btn.addEventListener('touchend', endHandler, { passive: false });
      btn.addEventListener('touchcancel', endHandler, { passive: false });
    }
    bindButton(mcUp, 'w');
    bindButton(mcDown, 's');
    bindButton(mcLeft, 'a');
    bindButton(mcRight, 'd');
    bindButton(mcJump, 'space');
    bindButton(mcPick, 'e');
  }

  // 启动游戏，进入第一人称控制
  function startGame() {
    overlay.style.display = 'none';
    instructionsDiv.style.display = 'block';
    crosshair.style.display = 'block';
    if (isMobile || !supportsPointerLock) {
      // 显示移动端控制按钮并直接开始动画
      if (mobileControls) mobileControls.style.display = 'flex';
      animate();
    } else {
      controls.lock();
      animate();
    }
  }

  // 初始化函数
  function init() {
    // 读取存档
    const saveData = loadSave();
    initScene(saveData);

    // 侦听窗口大小变化
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 按钮事件
    startBtn.addEventListener('click', () => {
      startGame();
    });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // 如果是移动端或不支持指针锁定，初始化虚拟按键
    if (isMobile || !supportsPointerLock) {
      setupMobileControls();
    }

    // 当鼠标锁定被解除时，显示暂停界面
    controls.addEventListener('unlock', () => {
      overlay.style.display = 'flex';
      instructionsDiv.style.display = 'none';
      crosshair.style.display = 'none';
      if (mobileControls) mobileControls.style.display = 'none';
      // 保存当前进度
      saveGame();
    });

    /*
     * 在移动设备或不支持 Pointer Lock API 的浏览器中，我们无法通过用户点击来获取鼠标锁定。
     * 为了使游戏在这些环境下自动开始，这里直接调用 startGame()。
     * Desktop 环境依然需要点击开始按钮以触发 pointer lock 请求。
     */
    if (isMobile || !supportsPointerLock) {
      startGame();
    }

    // 自动进入游戏：页面加载完成后直接启动游戏，无需点击开始按钮
    // 这样可避免部分浏览器无法响应按钮点击的情况（例如 iPad Safari 不支持 Pointer Lock）。
    startGame();
  }

  // 在页面完全加载后初始化
  window.addEventListener('DOMContentLoaded', () => {
    init();
  });
})();