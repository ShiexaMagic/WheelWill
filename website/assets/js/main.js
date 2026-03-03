/* ============================================
   WheelWill – Main Script
   Vertical slide navigation + Spline 3D wheel
   ============================================ */
import { Application } from '@splinetool/runtime';

/* ---------- DOM refs ---------- */
const canvas   = document.getElementById('spline-canvas');
const wheel    = document.getElementById('wheel-wrapper');
const dots     = document.querySelectorAll('.dot');
const panels   = document.querySelectorAll('.panel');
const label    = document.getElementById('wheel-label');
const mobileNav= document.getElementById('mobile-nav');
const toggle   = document.querySelector('.nav-toggle');

/* ---------- State ---------- */
let currentIndex = 0;
const TOTAL      = panels.length;          // 6
let isTransitioning = false;
const TRANSITION_MS = 650;                 // matches CSS transition duration

/* Spline objects */
let splineApp = null;
let sphere    = null;
let cylinder  = null;
let sceneLight = null;

/* Lift / Gamma / Gain cubes */
let liftCube  = null;
let gammaCube = null;
let gainCube  = null;

/* Color grading state */
let activeGradeMode = null;   // 'lift' | 'gamma' | 'gain' | null
let gradeValues = { lift: 0, gamma: 0, gain: 0 };  // -1 to 1 range
const PUSH_DEPTH   = 30;      // how far the cube pushes in (Z units)
const PUSH_DUR     = 120;     // push duration ms
const SPRING_DUR   = 300;     // spring-back duration ms

/* Light orbit state */
let lightOrbitAngle  = 0;          // current angle in radians
let lightOrbitRadius = 0;          // auto-detected from initial light position
let lightBaseY       = 0;          // keep Y constant
let lightIdleRAF     = null;       // idle animation frame
const LIGHT_ORBIT_SPEED = 0.003;   // idle rotation speed (rad/frame)

/* Drag-to-rotate state */
let isDragging  = false;
let dragStartX  = 0;
let dragStartY  = 0;
let sphereRotX  = 0;
let sphereRotY  = 0;
let cylinderRotY= 0;

/* Section accent colours */
const sectionColors = [];
panels.forEach(p => sectionColors.push(p.dataset.color));

const sectionLabels = [];
panels.forEach(p => sectionLabels.push(p.dataset.label));

/* ---------- Helpers ---------- */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `${r},${g},${b}`;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/* ---------- Colour application ---------- */
function setAccentColor(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(hex));
}

/* ---------- Go to section ---------- */
function goToSection(index, direction) {
  if (index === currentIndex) return;
  if (isTransitioning) return;
  isTransitioning = true;

  const prev = currentIndex;
  currentIndex = index;

  /* Direction: 1 = scrolling down (next), -1 = scrolling up (prev) */
  const dir = direction != null ? direction : (index > prev ? 1 : -1);

  /* Outgoing panel */
  const outPanel = panels[prev];
  outPanel.classList.remove('active', 'exit-up', 'exit-down');
  outPanel.classList.add(dir > 0 ? 'exit-up' : 'exit-down');

  /* Incoming panel – start from opposite side */
  const inPanel = panels[currentIndex];
  inPanel.classList.remove('active', 'exit-up', 'exit-down');
  /* Immediately position off-screen on the incoming side (no transition) */
  inPanel.style.transition = 'none';
  inPanel.style.opacity = '0';
  inPanel.style.transform = dir > 0 ? 'translateY(60px)' : 'translateY(-60px)';

  /* Force reflow, then animate in */
  void inPanel.offsetHeight;
  inPanel.style.transition = '';
  inPanel.style.opacity = '';
  inPanel.style.transform = '';
  inPanel.classList.add('active');

  /* Move wheel: centered on landing, shifted left on color, hidden on others */
  if (currentIndex === 0) {
    wheel.classList.remove('wheel-moved', 'wheel-hidden');
    document.body.classList.remove('glow-moved');
  } else if (currentIndex === 1) {
    /* Color grading: wheel visible, shifted left */
    wheel.classList.add('wheel-moved');
    wheel.classList.remove('wheel-hidden');
    document.body.classList.add('glow-moved');
  } else {
    wheel.classList.add('wheel-moved', 'wheel-hidden');
    document.body.classList.add('glow-moved');
  }

  /* Show RGB scopes only on color grading page */
  const scopeEl = document.getElementById('rgb-scopes');
  if (scopeEl) {
    if (currentIndex === 1) {
      scopeEl.style.display = '';
      scopeEl.style.opacity = '1';
    } else {
      scopeEl.style.opacity = '0';
      setTimeout(() => { if (currentIndex !== 1) scopeEl.style.display = 'none'; }, 500);
    }
  }

  /* Update accent colour */
  setAccentColor(sectionColors[currentIndex]);

  /* Update dots */
  dots.forEach(d => d.classList.toggle('active', +d.dataset.index === currentIndex));

  /* Update label */
  if (label) label.textContent = sectionLabels[currentIndex];

  /* Rotate Spline cylinder */
  rotateCylinder(currentIndex);

  /* Orbit light around object */
  orbitLightToSection(currentIndex);

  /* Unlock after transition */
  setTimeout(() => {
    isTransitioning = false;
    /* Clean exit classes from old panel */
    outPanel.classList.remove('exit-up', 'exit-down');
  }, TRANSITION_MS);
}

/* ---------- Scroll / wheel ---------- */
let scrollAccumulator = 0;
const SCROLL_THRESHOLD = 50;

function handleWheel(e) {
  e.preventDefault();

  /* If grade mode is active, scroll adjusts the grade value directly */
  if (activeGradeMode) {
    const delta = e.deltaY * 0.003;
    gradeValues[activeGradeMode] = Math.max(-1, Math.min(1, gradeValues[activeGradeMode] + delta));
    /* Also rotate cylinder visually if available */
    if (cylinder) cylinder.rotation.y += e.deltaY * 0.002;
    applyGradeFilters();
    return;
  }

  if (isTransitioning) return;

  scrollAccumulator += e.deltaY;
  if (Math.abs(scrollAccumulator) < SCROLL_THRESHOLD) return;

  const dir = scrollAccumulator > 0 ? 1 : -1;
  scrollAccumulator = 0;

  const next = currentIndex + dir;
  if (next < 0 || next >= TOTAL) return;
  goToSection(next, dir);
}

window.addEventListener('wheel', handleWheel, { passive: false });

/* ---------- Touch ---------- */
let touchStartY = 0;
window.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', e => {
  const dy = touchStartY - e.changedTouches[0].clientY;
  if (Math.abs(dy) < 40) return;
  if (isTransitioning) return;
  const dir = dy > 0 ? 1 : -1;
  const next = currentIndex + dir;
  if (next < 0 || next >= TOTAL) return;
  goToSection(next, dir);
}, { passive: true });

/* ---------- Keyboard ---------- */
window.addEventListener('keydown', e => {
  if (isTransitioning) return;
  let dir = 0;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') dir = 1;
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') dir = -1;
  else return;
  e.preventDefault();
  const next = currentIndex + dir;
  if (next < 0 || next >= TOTAL) return;
  goToSection(next, dir);
});

/* ---------- Dot clicks ---------- */
dots.forEach(d => d.addEventListener('click', () => {
  const idx = +d.dataset.index;
  if (idx === currentIndex) return;
  goToSection(idx, idx > currentIndex ? 1 : -1);
}));

/* ---------- data-goto links ---------- */
document.querySelectorAll('[data-goto]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    const idx = +el.dataset.goto;
    if (idx === currentIndex) return;
    goToSection(idx, idx > currentIndex ? 1 : -1);
    if (mobileNav) mobileNav.classList.remove('open');
  });
});

/* ---------- Mobile menu toggle ---------- */
if (toggle) toggle.addEventListener('click', () => mobileNav.classList.toggle('open'));

/* ---------- Stat counter animation ---------- */
let countersAnimated = false;
function animateCounters() {
  if (countersAnimated) return;
  countersAnimated = true;
  document.querySelectorAll('.stat-num').forEach(el => {
    const target = +el.dataset.target;
    const duration = 1200;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * ease);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/* ---------- Spline ---------- */
async function loadSpline() {
  if (!canvas) return;
  try {
    splineApp = new Application(canvas);
    await splineApp.load('https://prod.spline.design/UMmApNFjVA3dpWc5/scene.splinecode?v=' + Date.now());

    /* Debug: list ALL objects in the scene */
    console.log('[WheelWill] === ALL SPLINE OBJECTS ===');
    const allObjects = splineApp.getAllObjects();
    allObjects.forEach(obj => {
      console.log(`  • "${obj.name}" (type: ${obj.type}, id: ${obj.id})`);
    });
    console.log('[WheelWill] === END OBJECTS ===');

    /* Find sphere */
    const sphereNames = ['Sphere', 'sphere', 'Ball', 'ball', 'Sphere 1'];
    for (const n of sphereNames) {
      sphere = splineApp.findObjectByName(n);
      if (sphere) break;
    }
    if (!sphere) {
      const all = splineApp.findObjectByName('');
      console.log('[WheelWill] Available Spline objects:', all);
      console.warn('[WheelWill] Sphere not found — drag-to-rotate disabled.');
    } else {
      sphereRotX = sphere.rotation.x;
      sphereRotY = sphere.rotation.y;
      initDragRotate();
    }

    /* Find light */
    const lightNames = [
      'Directional Light', 'directional light', 'Directional Light 1',
      'Point Light', 'point light', 'Point Light 1',
      'Spot Light', 'spot light', 'Spot Light 1',
      'Light', 'light', 'Light 1'
    ];
    for (const n of lightNames) {
      sceneLight = splineApp.findObjectByName(n);
      if (sceneLight) {
        console.log('[WheelWill] Found light:', n);
        break;
      }
    }
    if (sceneLight) {
      initLightOrbit();
    } else {
      console.warn('[WheelWill] No light found — orbit disabled.');
    }

    /* Find cylinder */
    const cylNames = ['Cylinder', 'cylinder', 'Cylinder 1', 'Ring', 'ring'];
    for (const n of cylNames) {
      cylinder = splineApp.findObjectByName(n);
      if (cylinder) break;
    }
    if (cylinder) {
      cylinderRotY = cylinder.rotation.y;
    } else {
      console.warn('[WheelWill] Cylinder not found — scroll rotation disabled.');
    }

    /* Find Lift / Gamma / Gain cubes */
    const liftNames  = ['Lift', 'lift', 'Lift 1'];
    const gammaNames = ['Gamma', 'gamma', 'Gamma 1'];
    const gainNames  = ['Gain', 'gain', 'Gain 1'];

    for (const n of liftNames)  { liftCube  = splineApp.findObjectByName(n); if (liftCube)  break; }
    for (const n of gammaNames) { gammaCube = splineApp.findObjectByName(n); if (gammaCube) break; }
    for (const n of gainNames)  { gainCube  = splineApp.findObjectByName(n); if (gainCube)  break; }

    console.log('[WheelWill] Lift:', liftCube?.name, '| Gamma:', gammaCube?.name, '| Gain:', gainCube?.name);

    /* Wire up click events for the cubes */
    initGradingButtons();

  } catch (err) {
    console.error('[WheelWill] Spline load error:', err);
  }
}

/* ---------- Drag-to-Rotate ---------- */
let cylinderDragStartRotY = 0;  // cylinder rotation at drag start

function initDragRotate() {
  if (!canvas || !sphere) return;

  let snapTimeout = null;

  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    if (cylinder) cylinderDragStartRotY = cylinder.rotation.y;
    if (snapTimeout) { clearTimeout(snapTimeout); snapTimeout = null; }
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    if (activeGradeMode) {
      /* Grade mode: horizontal drag adjusts grade value directly */
      const delta = (e.clientX - dragStartX) * 0.003;
      gradeValues[activeGradeMode] = Math.max(-1, Math.min(1, delta));
      if (cylinder) cylinder.rotation.y = cylinderDragStartRotY + dx * 0.005;
      applyGradeFilters();
    } else {
      /* Normal mode: drag rotates the sphere */
      sphere.rotation.y = sphereRotY + dx * 0.01;
      sphere.rotation.x = sphereRotX + dy * 0.01;
      dragToColor(dx, dy);
    }
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    sphereRotX = sphere.rotation.x;
    sphereRotY = sphere.rotation.y;

    if (!activeGradeMode) {
      /* Snap back to section colour */
      snapTimeout = setTimeout(() => setAccentColor(sectionColors[currentIndex]), 600);
    }
  });

  /* Touch */
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    isDragging = true;
    dragStartX = e.touches[0].clientX;
    dragStartY = e.touches[0].clientY;
    if (cylinder) cylinderDragStartRotY = cylinder.rotation.y;
    if (snapTimeout) { clearTimeout(snapTimeout); snapTimeout = null; }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (!isDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStartX;
    const dy = e.touches[0].clientY - dragStartY;

    if (activeGradeMode) {
      const dx = e.touches[0].clientX - dragStartX;
      gradeValues[activeGradeMode] = Math.max(-1, Math.min(1, dx * 0.003));
      if (cylinder) cylinder.rotation.y = cylinderDragStartRotY + dx * 0.005;
      applyGradeFilters();
    } else {
      sphere.rotation.y = sphereRotY + dx * 0.01;
      sphere.rotation.x = sphereRotX + dy * 0.01;
      dragToColor(dx, dy);
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    sphereRotX = sphere.rotation.x;
    sphereRotY = sphere.rotation.y;
    if (!activeGradeMode) {
      snapTimeout = setTimeout(() => setAccentColor(sectionColors[currentIndex]), 600);
    }
  });

  /* Scroll on canvas rotates cylinder when grade mode is active */
  canvas.addEventListener('wheel', e => {
    if (!activeGradeMode || !cylinder) return;
    e.preventDefault();
    e.stopPropagation();
    cylinder.rotation.y += e.deltaY * 0.002;
  }, { passive: false });
}

/* Live colour from drag offset */
function dragToColor(dx, dy) {
  const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  const dist  = Math.min(Math.sqrt(dx * dx + dy * dy), 200);
  const sat   = 55 + (dist / 200) * 35;
  const light = 50 + (dist / 200) * 10;
  setAccentColor(hslToHex(angle, sat, light));
}

/* ---------- Cylinder rotation ---------- */
let cylinderGradeBaseY = 0;   // cylinder Y rotation when a grade mode activates

function rotateCylinder(index) {
  if (!cylinder) return;
  /* Only do section rotation when no grading mode is active */
  if (activeGradeMode) return;
  const target = cylinderRotY + (Math.PI / 3) * (index + 1);
  const start  = cylinder.rotation.y;
  const diff   = target - start;
  const dur    = 800;
  const t0     = performance.now();

  function tick(now) {
    const t = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    cylinder.rotation.y = start + diff * ease;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- Light Orbit ---------- */
function initLightOrbit() {
  if (!sceneLight) return;
  /* Compute orbit radius from the light's initial XZ distance to origin */
  const lx = sceneLight.position.x;
  const lz = sceneLight.position.z;
  lightOrbitRadius = Math.sqrt(lx * lx + lz * lz);
  lightBaseY       = sceneLight.position.y;
  lightOrbitAngle  = Math.atan2(lz, lx);  // start angle from current position

  /* If light is at origin (radius ≈ 0), set a default orbit radius */
  if (lightOrbitRadius < 10) lightOrbitRadius = 300;

  console.log(`[WheelWill] Light orbit — radius: ${lightOrbitRadius.toFixed(1)}, startAngle: ${(lightOrbitAngle * 180 / Math.PI).toFixed(1)}°`);

  /* Start subtle idle orbit */
  startIdleOrbit();
}

/* Smoothly orbit light to a target angle based on section index */
function orbitLightToSection(index) {
  if (!sceneLight) return;
  /* Each section offsets the light by a fraction of a full circle */
  const targetAngle = lightOrbitAngle + (Math.PI * 2 / TOTAL) * index;
  const startAngle  = Math.atan2(sceneLight.position.z, sceneLight.position.x);
  let diff = targetAngle - startAngle;
  /* Normalise to shortest path */
  while (diff > Math.PI)  diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  const dur = 900;
  const t0  = performance.now();

  /* Pause idle orbit during animated transition */
  stopIdleOrbit();

  function tick(now) {
    const t = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 3);  // ease-out cubic
    const angle = startAngle + diff * ease;
    sceneLight.position.x = Math.cos(angle) * lightOrbitRadius;
    sceneLight.position.z = Math.sin(angle) * lightOrbitRadius;
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      /* Resume idle orbit from new position */
      startIdleOrbit();
    }
  }
  requestAnimationFrame(tick);
}

/* Continuous slow idle orbit for ambient feel */
function startIdleOrbit() {
  if (!sceneLight || lightIdleRAF) return;
  function idleTick() {
    const cx = sceneLight.position.x;
    const cz = sceneLight.position.z;
    const angle = Math.atan2(cz, cx) + LIGHT_ORBIT_SPEED;
    sceneLight.position.x = Math.cos(angle) * lightOrbitRadius;
    sceneLight.position.z = Math.sin(angle) * lightOrbitRadius;
    lightIdleRAF = requestAnimationFrame(idleTick);
  }
  lightIdleRAF = requestAnimationFrame(idleTick);
}

function stopIdleOrbit() {
  if (lightIdleRAF) {
    cancelAnimationFrame(lightIdleRAF);
    lightIdleRAF = null;
  }
}

/* ---------- Contact form ---------- */
const form = document.getElementById('contact-form');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = 'Sent';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = 'Send Message →'; btn.disabled = false; form.reset(); }, 2500);
  });
}

/* ---------- Portfolio Video Preview ---------- */
document.querySelectorAll('.folio-card[data-video], .pp-thumb[data-video]').forEach(card => {
  const video = card.querySelector('.folio-video');
  if (!video) return;
  card.addEventListener('mouseenter', () => {
    video.currentTime = 0;
    video.play().catch(() => {});
    card.classList.add('playing');
  });
  card.addEventListener('mouseleave', () => {
    video.pause();
    card.classList.remove('playing');
  });
});

/* ---------- Media Pool Click → Load into Viewer ---------- */
document.querySelectorAll('.pp-thumb[data-video]').forEach(thumb => {
  thumb.addEventListener('click', () => {
    const videoSrc = thumb.dataset.video;
    if (!videoSrc) return;

    const section = thumb.closest('.panel');
    if (!section) return;
    const viewer = section.querySelector('.viewer-video');
    if (!viewer) return;

    /* Highlight active thumb */
    section.querySelectorAll('.pp-thumb').forEach(t => t.classList.remove('active-thumb'));
    thumb.classList.add('active-thumb');

    /* Hide placeholder, load and play */
    const placeholder = viewer.parentElement.querySelector('.pp-viewer-empty');
    if (placeholder) placeholder.style.display = 'none';

    viewer.src = videoSrc;
    viewer.load();
    safeAutoplay(viewer);

    /* Rebuild timeline to match the selected clip */
    const clipName = thumb.querySelector('.pp-thumb-name')?.textContent || 'Clip';
    rebuildTimeline(section, clipName, videoSrc);
  });
});

/* ---------- Editor Folder Toggles ---------- */
document.querySelectorAll('.editor-folder .folder-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const folder = tab.closest('.editor-folder');
    const wasOpen = folder.classList.contains('open');
    const icon = tab.querySelector('i:first-child');

    /* Toggle this folder */
    folder.classList.toggle('open');

    /* Swap folder icon */
    if (icon) {
      if (folder.classList.contains('open')) {
        icon.className = icon.className.replace('lucide-folder', 'lucide-folder-open');
      } else {
        icon.className = icon.className.replace('lucide-folder-open', 'lucide-folder');
      }
    }
  });
});

/* ---------- Init ---------- */
setAccentColor(sectionColors[0]);
applyGradeFilters();
loadSpline();
initVideoErrorHandling();
initWipeViewer();
initSoundMeters();
initLandingHover();

/* ============================================
   Safe autoplay — only plays if video loaded
   ============================================ */
function safeAutoplay(video) {
  if (!video) return;
  /* If already has sufficient data, play */
  if (video.readyState >= 2) {
    video.play().catch(() => {});
    return;
  }
  /* Wait for enough data */
  const onCanPlay = () => {
    video.play().catch(() => {});
    video.removeEventListener('canplay', onCanPlay);
  };
  video.addEventListener('canplay', onCanPlay);
  /* On error — pause, show poster if any */
  video.addEventListener('error', () => {
    video.pause();
    video.removeAttribute('autoplay');
    console.warn('[WheelWill] Video failed to load:', video.src);
  }, { once: true });
}

/* ============================================
   Video error handling — log errors, no autoplay
   ============================================ */
function initVideoErrorHandling() {
  document.querySelectorAll('video.viewer-video').forEach(video => {
    video.addEventListener('error', () => {
      video.pause();
      console.warn('[WheelWill] Video load error:', video.src);
    }, { once: true });
  });
}

/* ============================================
   Before/After Wipe Viewer — Color Grading
   ============================================ */
function initWipeViewer() {
  const handle = document.getElementById('cg-wipe-handle');
  const viewer = document.querySelector('.cg-viewer-inner');
  const before = document.getElementById('cg-before');
  const after  = document.getElementById('cg-after');
  if (!handle || !viewer || !before) return;

  let wipeDragging = false;

  function setWipePosition(clientX) {
    const rect = viewer.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(2, Math.min(98, pct));
    handle.style.left = pct + '%';
    before.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  }

  handle.addEventListener('pointerdown', (e) => {
    wipeDragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!wipeDragging) return;
    setWipePosition(e.clientX);
  });

  window.addEventListener('pointerup', () => { wipeDragging = false; });
  window.addEventListener('pointercancel', () => { wipeDragging = false; });

  /* Media pool item clicks — swap video in the wipe viewer */
  document.querySelectorAll('.cg-pool-item').forEach(item => {
    item.addEventListener('click', () => {
      const videoSrc = item.dataset.video;
      if (!videoSrc) return;
      document.querySelectorAll('.cg-pool-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      /* Update both before and after videos */
      if (before) {
        before.src = videoSrc;
        before.load();
        safeAutoplay(before);
      }
      if (after) {
        after.src = videoSrc;
        after.load();
        safeAutoplay(after);
      }
    });
  });

  /* Auto-play the wipe viewer videos — DISABLED, user must pick from pool */
  // Videos start paused; user clicks a pool item to start playback
}

/* ============================================
   Sound Mixer — Animated meters
   ============================================ */
function initSoundMeters() {
  const meters = document.querySelectorAll('.ch-meter-fill, .pp-ch-meter-fill');
  if (!meters.length) return;

  /* Animate meter levels subtly */
  function animateMeters() {
    meters.forEach(meter => {
      const base = parseFloat(meter.style.height) || 50;
      const variation = (Math.random() - 0.5) * 8;
      const newH = Math.max(10, Math.min(95, base + variation));
      meter.style.height = newH + '%';
    });
    requestAnimationFrame(animateMeters);
  }

  /* Only animate when sound section is visible */
  let meterRAF = null;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (!meterRAF) meterRAF = requestAnimationFrame(function tick() {
          meters.forEach(meter => {
            const base = parseFloat(meter.style.height) || 50;
            const variation = (Math.random() - 0.5) * 6;
            const newH = Math.max(10, Math.min(95, base + variation));
            meter.style.height = newH + '%';
          });
          meterRAF = requestAnimationFrame(tick);
        });
      } else {
        if (meterRAF) { cancelAnimationFrame(meterRAF); meterRAF = null; }
      }
    });
  });

  const soundSection = document.querySelector('.sound-mixer, .pp-mixer');
  if (soundSection) observer.observe(soundSection);

  /* Fader inputs update meter heights */
  document.querySelectorAll('.fader-input, .pp-fader').forEach(fader => {
    fader.addEventListener('input', () => {
      const meter = fader.closest('.mixer-ch, .pp-mixer-ch')?.querySelector('.ch-meter-fill, .pp-ch-meter-fill');
      if (meter) meter.style.height = fader.value + '%';
    });
  });
}

/* ============================================
   Landing Page — Hover effect (mirror sync)
   ============================================ */
function initLandingHover() {
  const title = document.getElementById('landing-title');
  const mirror = document.getElementById('landing-mirror');
  if (!title || !mirror) return;

  /* Sync mirror hover state with title */
  title.addEventListener('mouseenter', () => mirror.classList.add('hovered'));
  title.addEventListener('mouseleave', () => mirror.classList.remove('hovered'));
}

/* ============================================
   RGB Scopes — Real-time color grading display
   ============================================ */

const scopeR    = document.getElementById('scope-r');
const scopeG    = document.getElementById('scope-g');
const scopeB    = document.getElementById('scope-b');
const scopeLuma = document.getElementById('scope-luma');
const scopeValLift  = document.getElementById('scope-val-lift');
const scopeValGamma = document.getElementById('scope-val-gamma');
const scopeValGain  = document.getElementById('scope-val-gain');
const scopeToggleBtn = document.getElementById('scope-toggle');
const scopeContainer = document.getElementById('rgb-scopes');

let scopeAnimRAF = null;
let currentAccentHex = '#D4A843';

/* Cached histogram data for smooth rendering */
let cachedRHist = new Float32Array(256);
let cachedGHist = new Float32Array(256);
let cachedBHist = new Float32Array(256);
let cachedGradedColors = [];
let lastScopeCompute = 0;
const SCOPE_INTERVAL = 120; /* ms between recomputes (~8fps) */

function initScopes() {
  /* Toggle collapse */
  const header = scopeContainer?.querySelector('.scope-header');
  if (header) {
    header.addEventListener('click', () => {
      scopeContainer.classList.toggle('collapsed');
    });
  }

  /* Start drawing immediately — no capture needed */
  startScopeAnimation();
  initScopeDrag();
  console.log('[WheelWill] Scopes initialised — drawing from page colors');
}

function startScopeAnimation() {
  function tick(now) {
    if (!scopeContainer?.classList.contains('collapsed')) {
      const needsRecompute = (now - lastScopeCompute) > SCOPE_INTERVAL;
      if (needsRecompute) {
        recomputeScopeData();
        lastScopeCompute = now;
      }
      drawCachedScopes();
    }
    scopeAnimRAF = requestAnimationFrame(tick);
  }
  /* Compute once immediately */
  recomputeScopeData();
  scopeAnimRAF = requestAnimationFrame(tick);
}

/* ---- Collect page colors and draw scopes directly (no capture needed) ---- */

/* Sample all colors present on the page */
function samplePageColors() {
  const colors = [];

  /* 1. Background — dominant dark color */
  colors.push({ r: 10, g: 10, b: 10, weight: 50 });

  /* 2. Current accent color */
  const style = getComputedStyle(document.documentElement);
  const accentRgb = style.getPropertyValue('--accent-rgb').trim();
  if (accentRgb) {
    const parts = accentRgb.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length >= 3) {
      const [r, g, b] = parts;
      colors.push({ r: r || 0, g: g || 0, b: b || 0, weight: 20 });
      colors.push({ r: (r * 0.3) | 0, g: (g * 0.3) | 0, b: (b * 0.3) | 0, weight: 10 });
      colors.push({ r: (r * 0.6) | 0, g: (g * 0.6) | 0, b: (b * 0.6) | 0, weight: 8 });
    }
  }

  /* 3. Text colors (white/gray) */
  colors.push({ r: 245, g: 245, b: 245, weight: 8 });
  colors.push({ r: 138, g: 138, b: 142, weight: 12 });

  /* 4. Near-black shadow areas */
  colors.push({ r: 3, g: 3, b: 3, weight: 15 });
  colors.push({ r: 26, g: 26, b: 28, weight: 10 });

  /* 5. Sample active panel elements */
  const selectors = [
    '.panel.active .tag', '.panel.active .desc', '.panel.active .btn-primary',
    '.panel.active .btn-outline', '.panel.active .stat-num',
    '.panel.active .svc', '.panel.active .folio-tag'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    try {
      const cs = getComputedStyle(el);
      const parseFn = (str) => {
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
      };
      const fgc = parseFn(cs.color);
      if (fgc) colors.push({ ...fgc, weight: 3 });
      const bgc = parseFn(cs.backgroundColor);
      if (bgc && (bgc.r + bgc.g + bgc.b) > 5) colors.push({ ...bgc, weight: 3 });
    } catch (e) { /* skip */ }
  }

  return colors;
}

/* Apply Lift/Gamma/Gain to a color */
function applyLGG(r, g, b) {
  const { lift, gamma, gain } = gradeValues;
  const lm = 1 + lift * 1.0;
  const gm = 1 + gamma * 1.0;
  const bm = 1 + gain * 1.0;

  /* Lift affects shadows (low values more) */
  const liftR = r + (lm - 1) * (255 - r) * 0.3;
  const liftG = g + (lm - 1) * (255 - g) * 0.3;
  const liftB = b + (lm - 1) * (255 - b) * 0.3;

  /* Gamma affects midtones via power curve */
  const safe = (v) => Math.max(0.001, v / 255);
  const gammaR = 255 * Math.pow(safe(liftR), 1 / gm);
  const gammaG = 255 * Math.pow(safe(liftG), 1 / gm);
  const gammaB = 255 * Math.pow(safe(liftB), 1 / gm);

  /* Gain affects highlights (multiply) */
  return {
    r: Math.min(255, Math.max(0, gammaR * bm)) | 0,
    g: Math.min(255, Math.max(0, gammaG * bm)) | 0,
    b: Math.min(255, Math.max(0, gammaB * bm)) | 0,
  };
}

/* Simple hash-based stable noise (same seed = same values) */
let noiseSeed = 42;
function stableRandom() {
  noiseSeed = (noiseSeed * 1664525 + 1013904223) & 0x7fffffff;
  return (noiseSeed / 0x7fffffff) - 0.5;
}

/* Recompute histogram data (called at throttled rate) */
function recomputeScopeData() {
  const pageColors = samplePageColors();
  const gradedColors = pageColors.map(c => {
    const graded = applyLGG(c.r, c.g, c.b);
    return { ...graded, weight: c.weight };
  });

  /* Build new histograms with stable noise */
  const newR = new Float32Array(256);
  const newG = new Float32Array(256);
  const newB = new Float32Array(256);
  noiseSeed = 42;  /* Reset seed so noise is deterministic */

  for (const c of gradedColors) {
    const spread = 12;
    for (let i = 0; i < c.weight; i++) {
      const noiseR = stableRandom() * spread * 2;
      const noiseG = stableRandom() * spread * 2;
      const noiseB = stableRandom() * spread * 2;
      const ri = Math.min(255, Math.max(0, (c.r + noiseR) | 0));
      const gi = Math.min(255, Math.max(0, (c.g + noiseG) | 0));
      const bi = Math.min(255, Math.max(0, (c.b + noiseB) | 0));
      newR[ri] += 1;
      newG[gi] += 1;
      newB[bi] += 1;
    }
  }

  /* Smooth blend: lerp cached toward new values */
  const blend = 0.3;
  for (let i = 0; i < 256; i++) {
    cachedRHist[i] += (newR[i] - cachedRHist[i]) * blend;
    cachedGHist[i] += (newG[i] - cachedGHist[i]) * blend;
    cachedBHist[i] += (newB[i] - cachedBHist[i]) * blend;
  }

  cachedGradedColors = gradedColors;
}

/* Draw from cached data (runs every RAF for smooth display) */
function drawCachedScopes() {
  const { lift, gamma, gain } = gradeValues;

  /* Update value readouts */
  if (scopeValLift)  scopeValLift.textContent  = 'Lift: ' + (lift >= 0 ? '+' : '') + lift.toFixed(2);
  if (scopeValGamma) scopeValGamma.textContent = 'Gamma: ' + (gamma >= 0 ? '+' : '') + gamma.toFixed(2);
  if (scopeValGain)  scopeValGain.textContent  = 'Gain: ' + (gain >= 0 ? '+' : '') + gain.toFixed(2);

  /* Draw the three parade channels from cached histograms */
  drawParade(scopeR, cachedRHist, 'rgba(255,60,60,');
  drawParade(scopeG, cachedGHist, 'rgba(60,255,60,');
  drawParade(scopeB, cachedBHist, 'rgba(60,120,255,');

  /* Draw luma waveform */
  drawLuma(scopeLuma, cachedGradedColors);
}

/* Draw a parade channel from histogram data */
function drawParade(cvs, hist, rgbaBase) {
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.width;
  const H = cvs.height;
  ctx.clearRect(0, 0, W, H);

  /* Grid lines */
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i / 4) * H);
    ctx.lineTo(W, (i / 4) * H);
    ctx.stroke();
  }

  /* Find max for normalization */
  let maxVal = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] > maxVal) maxVal = hist[i];
  }
  if (maxVal === 0) return;

  /* Draw histogram as vertical bars from bottom */
  const barW = W / 256;

  for (let i = 0; i < 256; i++) {
    const val = hist[i];
    if (val === 0) continue;

    const norm = val / maxVal;
    const x = (i / 255) * (W - barW);
    const barH = norm * (H - 4);
    const y = H - barH - 2;

    /* Gradient bar */
    const alpha = 0.15 + norm * 0.7;
    ctx.fillStyle = rgbaBase + alpha.toFixed(2) + ')';
    ctx.fillRect(x, y, Math.max(barW, 1.5), barH);

    /* Bright cap */
    if (norm > 0.1) {
      ctx.fillStyle = rgbaBase + Math.min(1, alpha + 0.3).toFixed(2) + ')';
      ctx.fillRect(x, y, Math.max(barW, 1.5), 1.5);
    }

    /* Glow for peaks */
    if (norm > 0.5) {
      ctx.fillStyle = rgbaBase + '0.08)';
      ctx.fillRect(x - 1, y - 2, Math.max(barW, 1.5) + 2, barH + 4);
    }
  }

  /* 50 IRE reference line */
  ctx.strokeStyle = rgbaBase + '0.15)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* Draw luma waveform from graded colors */
function drawLuma(cvs, gradedColors) {
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.width;
  const H = cvs.height;
  ctx.clearRect(0, 0, W, H);

  /* Grid */
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i / 4) * H);
    ctx.lineTo(W, (i / 4) * H);
    ctx.stroke();
  }

  /* IRE labels */
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '7px Inter, sans-serif';
  ctx.fillText('100', 2, 9);
  ctx.fillText('50', 4, H / 2 + 3);
  ctx.fillText('0', 4, H - 2);

  /* Build luma histogram with stable noise */
  const lumaHist = new Float32Array(256);
  let lumaSeed = 7;
  for (const c of gradedColors) {
    for (let i = 0; i < c.weight; i++) {
      lumaSeed = (lumaSeed * 1664525 + 1013904223) & 0x7fffffff;
      const noise = (lumaSeed / 0x7fffffff - 0.5) * 20;
      const luma = Math.min(255, Math.max(0, (0.299 * c.r + 0.587 * c.g + 0.114 * c.b + noise) | 0));
      lumaHist[luma] += 1;
    }
  }

  /* Find max */
  let maxVal = 0;
  for (let i = 0; i < 256; i++) if (lumaHist[i] > maxVal) maxVal = lumaHist[i];
  if (maxVal === 0) return;

  /* Draw as waveform bars (stable, no random dot placement) */
  for (let i = 0; i < 256; i++) {
    const val = lumaHist[i];
    if (val === 0) continue;
    const norm = val / maxVal;
    const y = H - (i / 255) * (H - 6) - 3;

    /* Draw a horizontal bar centered in the canvas */
    const barWidth = norm * W * 0.6;
    const x = (W - barWidth) / 2;
    const alpha = 0.08 + norm * 0.45;
    ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(2) + ')';
    ctx.fillRect(x, y, barWidth, 1);

    /* Brighter core for strong values */
    if (norm > 0.3) {
      const coreW = barWidth * 0.4;
      const coreX = (W - coreW) / 2;
      ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 1.5).toFixed(2) + ')';
      ctx.fillRect(coreX, y, coreW, 1);
    }
  }
}

/* --- Start scopes --- */
initScopes();

/* Make scopes panel draggable by its header */
function initScopeDrag() {
  const panel = scopeContainer;
  const header = panel?.querySelector('.scope-header');
  if (!panel || !header) return;

  let dragging = false;
  let startX, startY, startLeft, startTop;

  header.addEventListener('pointerdown', (e) => {
    /* Ignore toggle button clicks */
    if (e.target.closest('.scope-toggle')) return;
    dragging = true;
    header.setPointerCapture(e.pointerId);

    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    /* Switch from bottom/right to top/left positioning for drag */
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = startLeft + 'px';
    panel.style.top = startTop + 'px';
    panel.style.transition = 'none';
    e.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + dx));
    const newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + dy));
    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';
  });

  header.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
  });

  header.addEventListener('pointercancel', () => {
    dragging = false;
    panel.style.transition = '';
  });
}

/* Push animation: move cube on its local Z, then spring back */
function pushCube(cube, callback) {
  if (!cube) return;
  const startZ = cube.position.z;
  const t0 = performance.now();

  function pushDown(now) {
    const t = Math.min((now - t0) / PUSH_DUR, 1);
    const ease = t * t;  // ease-in
    cube.position.z = startZ - PUSH_DEPTH * ease;
    if (t < 1) {
      requestAnimationFrame(pushDown);
    } else {
      /* Spring back */
      const t1 = performance.now();
      function springBack(now2) {
        const t = Math.min((now2 - t1) / SPRING_DUR, 1);
        /* Damped spring: overshoot then settle */
        const spring = 1 - Math.exp(-4 * t) * Math.cos(6 * t);
        cube.position.z = (startZ - PUSH_DEPTH) + PUSH_DEPTH * spring;
        if (t < 1) {
          requestAnimationFrame(springBack);
        } else {
          cube.position.z = startZ;
          if (callback) callback();
        }
      }
      requestAnimationFrame(springBack);
    }
  }
  requestAnimationFrame(pushDown);
}

/* Activate a grading mode or toggle it off */
function activateGradeMode(mode) {
  if (activeGradeMode === mode) {
    /* Toggle off — deactivate */
    activeGradeMode = null;
    stopCylinderGradeTracking();
    document.body.removeAttribute('data-grade-mode');
    syncLggButtons();
    console.log('[WheelWill] Grade mode OFF');
    return;
  }
  activeGradeMode = mode;
  document.body.setAttribute('data-grade-mode', mode);
  syncLggButtons();
  if (cylinder) {
    cylinderGradeBaseY = cylinder.rotation.y;
  }
  startCylinderGradeTracking();
  console.log(`[WheelWill] Grade mode: ${mode}`);
}

/* Keep HTML LGG buttons in sync with active mode */
function syncLggButtons() {
  document.querySelectorAll('.lgg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === activeGradeMode);
  });
}

/* Track cylinder rotation and map it to the active grade value */
let gradeTrackRAF = null;

function startCylinderGradeTracking() {
  stopCylinderGradeTracking();
  if (!cylinder) return;

  function tick() {
    if (!activeGradeMode || !cylinder) { gradeTrackRAF = null; return; }
    const delta = cylinder.rotation.y - cylinderGradeBaseY;
    /* Map rotation to -1..1 range (full turn = full range) */
    const value = Math.max(-1, Math.min(1, delta / Math.PI));
    gradeValues[activeGradeMode] = value;
    applyGradeFilters();
    gradeTrackRAF = requestAnimationFrame(tick);
  }
  gradeTrackRAF = requestAnimationFrame(tick);
}

function stopCylinderGradeTracking() {
  if (gradeTrackRAF) {
    cancelAnimationFrame(gradeTrackRAF);
    gradeTrackRAF = null;
  }
}

/* Apply Lift / Gamma / Gain as CSS filters on the page */
function applyGradeFilters() {
  const { lift, gamma, gain } = gradeValues;

  /* Double-strength ranges: 0..2x multiplier (was 0.5, now 1.0) */
  /* Lift = shadow brightness: 0.0 to 2.0, default 1 */
  const liftBrightness = 1 + lift * 1.0;
  /* Gamma = midtone contrast: 0.0 to 2.0, default 1 */
  const gammaContrast = 1 + gamma * 1.0;
  /* Gain = overall brightness: 0.0 to 2.0, default 1 */
  const gainBrightness = 1 + gain * 1.0;

  document.documentElement.style.setProperty('--grade-lift', liftBrightness.toFixed(3));
  document.documentElement.style.setProperty('--grade-gamma', gammaContrast.toFixed(3));
  document.documentElement.style.setProperty('--grade-gain', gainBrightness.toFixed(3));

  /* Apply combined filter to the ENTIRE page (body) */
  const filterStr = `brightness(${gainBrightness.toFixed(3)}) contrast(${gammaContrast.toFixed(3)})`;
  document.body.style.filter = filterStr;

  /* Shadows overlay for lift (vignette-style darken/lighten) */
  const overlay = document.getElementById('grade-overlay');
  if (overlay) {
    const shadowOpacity = Math.max(0, -lift * 0.8);
    const shadowLift    = Math.max(0,  lift * 0.3);
    overlay.style.boxShadow = `inset 0 0 ${200 + shadowOpacity * 500}px rgba(0,0,0,${shadowOpacity.toFixed(2)})`;
    overlay.style.background = `rgba(255,255,255,${shadowLift.toFixed(3)})`;
  }

  /* Exempt the scopes panel from the body filter by counter-filtering */
  const scopesPanel = document.getElementById('rgb-scopes');
  if (scopesPanel && (gainBrightness !== 1 || gammaContrast !== 1)) {
    const inv = `brightness(${(1 / gainBrightness).toFixed(3)}) contrast(${(1 / gammaContrast).toFixed(3)})`;
    scopesPanel.style.filter = inv;
  } else if (scopesPanel) {
    scopesPanel.style.filter = '';
  }
}

/* Wire Spline mouseDown events on the cubes */
function initGradingButtons() {
  if (!splineApp) return;

  /* Method 1 & 2 REMOVED — only HTML overlay buttons and keyboard work */

  /* Method 3: HTML overlay buttons (always works) */
  const lggBtns = document.querySelectorAll('.lgg-btn');
  lggBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.dataset.mode;
      if (!mode) return;
      const cube = mode === 'lift' ? liftCube : mode === 'gamma' ? gammaCube : gainCube;
      pushCube(cube, () => {});
      activateGradeMode(mode);
      /* Update button active states */
      lggBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode && activeGradeMode === mode));
    });
  });

  /* Method 4: Keyboard shortcuts (always works) — L, G, B */
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const key = e.key.toLowerCase();
    if (key === 'l') {
      pushCube(liftCube, () => activateGradeMode('lift'));
    } else if (key === 'g') {
      pushCube(gammaCube, () => activateGradeMode('gamma'));
    } else if (key === 'b') {
      pushCube(gainCube, () => activateGradeMode('gain'));
    } else if (key === 'escape' && activeGradeMode) {
      activateGradeMode(activeGradeMode);  // toggle off
    }
  });

  console.log('[WheelWill] Grading buttons initialised (HTML + keyboard only)');
  console.log('[WheelWill] Keyboard: L=Lift, G=Gamma, B=Gain (brightness), Esc=deactivate');
}

/* Approximate world-to-screen projection for Spline objects */
function worldToScreen(obj, canvasRect) {
  if (!obj || !splineApp) return null;
  try {
    /* Spline Application exposes ._scene._camera or we estimate from object positions */
    /* Use the object's position relative to others to estimate screen placement */
    const allCubes = [liftCube, gammaCube, gainCube].filter(Boolean);
    if (allCubes.length === 0) return null;

    /* Get min/max X bounds of the cubes to map to screen */
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const c of allCubes) {
      if (c.position.x < minX) minX = c.position.x;
      if (c.position.x > maxX) maxX = c.position.x;
      if (c.position.y < minY) minY = c.position.y;
      if (c.position.y > maxY) maxY = c.position.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    /* Map object position to screen coords (normalized 0-1 within canvas) */
    const nx = (obj.position.x - minX) / rangeX;
    const ny = (obj.position.y - minY) / rangeY;

    /* Map to screen: X goes left→right, Y goes top→bottom (inverted) */
    const screenX = canvasRect.left + canvasRect.width * (0.3 + nx * 0.4);
    const screenY = canvasRect.top + canvasRect.height * (0.6 - ny * 0.2);

    return { x: screenX, y: screenY };
  } catch {
    return null;
  }
}

/* ============================================
   Real Timeline System — synced to video
   ============================================ */

/* --- Per-clip timeline layouts (realistic NLE structure) --- */
const clipTimelineData = {
  'Samsara': {
    name: 'Samsara — Guns Scene',
    tracks: [
      { label: 'V2', type: 'video', clips: [{ left: 5, width: 22, name: 'Titles' }, { left: 62, width: 18, name: 'Credits' }] },
      { label: 'V1', type: 'video', clips: [{ left: 0, width: 35, name: 'Guns Scene' }, { left: 38, width: 30, name: 'Ceremony' }, { left: 72, width: 26, name: 'Mud Men' }] },
      { label: 'A1', type: 'audio', clips: [{ left: 0, width: 98, name: 'Ayub Ogada — Nach M' }] },
      { label: 'A2', type: 'audio', clips: [{ left: 5, width: 30, name: 'Ambience' }, { left: 60, width: 25, name: 'Drums' }] }
    ]
  },
  'Ships': {
    name: 'Ships in Massive Storms',
    tracks: [
      { label: 'V2', type: 'video', clips: [{ left: 10, width: 20, name: 'Title Card' }] },
      { label: 'V1', type: 'video', clips: [{ left: 0, width: 25, name: 'Storm #1' }, { left: 28, width: 22, name: 'Storm #2' }, { left: 53, width: 20, name: 'Storm #3' }, { left: 76, width: 22, name: 'Rescue' }] },
      { label: 'A1', type: 'audio', clips: [{ left: 0, width: 97, name: 'Storm Audio' }] },
      { label: 'A2', type: 'audio', clips: [{ left: 0, width: 50, name: 'Wind SFX' }, { left: 53, width: 45, name: 'Wave SFX' }] },
      { label: 'A3', type: 'audio', clips: [{ left: 15, width: 70, name: 'Music Score' }] }
    ]
  },
  'SHREDDED': {
    name: 'Shredded Tapes',
    tracks: [
      { label: 'V3', type: 'video', clips: [{ left: 20, width: 15, name: 'Glitch FX' }, { left: 60, width: 12, name: 'Glitch FX' }] },
      { label: 'V2', type: 'video', clips: [{ left: 0, width: 18, name: 'Overlay' }, { left: 45, width: 20, name: 'VHS Filter' }] },
      { label: 'V1', type: 'video', clips: [{ left: 0, width: 40, name: 'Shredded A' }, { left: 43, width: 30, name: 'Shredded B' }, { left: 76, width: 22, name: 'Shredded C' }] },
      { label: 'A1', type: 'audio', clips: [{ left: 0, width: 96, name: 'Tape Hiss + Audio' }] },
      { label: 'A2', type: 'audio', clips: [{ left: 10, width: 35, name: 'Noise Texture' }, { left: 55, width: 30, name: 'Drone' }] }
    ]
  },
  'Skaterdater': {
    name: 'Skaterdater (1965)',
    tracks: [
      { label: 'V2', type: 'video', clips: [{ left: 0, width: 12, name: 'Open Titles' }, { left: 85, width: 13, name: 'End Credits' }] },
      { label: 'V1', type: 'video', clips: [{ left: 0, width: 30, name: 'School' }, { left: 33, width: 25, name: 'Race' }, { left: 61, width: 20, name: 'Girl' }, { left: 84, width: 14, name: 'Finale' }] },
      { label: 'A1', type: 'audio', clips: [{ left: 0, width: 97, name: 'Dialogue + SFX' }] },
      { label: 'A2', type: 'audio', clips: [{ left: 2, width: 45, name: 'Surf Rock Score' }, { left: 50, width: 48, name: 'Jazz Score' }] }
    ]
  },
  '_default': {
    name: 'Main Edit',
    tracks: [
      { label: 'V2', type: 'video', clips: [{ left: 8, width: 18, name: 'Titles' }, { left: 55, width: 25, name: 'B-Roll' }] },
      { label: 'V1', type: 'video', clips: [{ left: 2, width: 28, name: 'Samsara' }, { left: 32, width: 22, name: 'Ships' }, { left: 56, width: 25, name: 'Skater' }] },
      { label: 'A1', type: 'audio', clips: [{ left: 2, width: 78, name: 'Main Audio' }] },
      { label: 'A2', type: 'audio', clips: [{ left: 15, width: 35, name: 'SFX' }, { left: 55, width: 30, name: 'Music' }] }
    ]
  }
};

/* Resolve clip key from video source path */
function resolveClipKey(videoSrc) {
  if (!videoSrc) return '_default';
  const src = videoSrc.toLowerCase();
  if (src.includes('samsara')) return 'Samsara';
  if (src.includes('ships')) return 'Ships';
  if (src.includes('shredded')) return 'SHREDDED';
  if (src.includes('skaterdater')) return 'Skaterdater';
  return '_default';
}

/* Rebuild timeline tracks to match the chosen clip */
function rebuildTimeline(section, clipName, videoSrc) {
  const timeline = section.querySelector('.pp-timeline');
  if (!timeline) return;

  const tracksContainer = timeline.querySelector('.pp-tracks');
  if (!tracksContainer) return;

  const key = resolveClipKey(videoSrc);
  const data = clipTimelineData[key] || clipTimelineData['_default'];

  /* Update timeline header name */
  const tlName = timeline.querySelector('.pp-tl-name');
  if (tlName) tlName.textContent = 'Timeline 1 — ' + data.name;

  /* Update ruler once video duration is known */
  const viewer = section.querySelector('.viewer-video');
  if (viewer) {
    const updateRuler = () => {
      const ruler = timeline.querySelector('.pp-tl-ruler');
      if (!ruler) return;
      const dur = viewer.duration;
      if (!dur || !isFinite(dur)) return;
      ruler.innerHTML = '';
      const segments = 6;
      for (let i = 0; i < segments; i++) {
        const t = (dur / segments) * i;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        const span = document.createElement('span');
        span.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        ruler.appendChild(span);
      }
    };
    if (viewer.readyState >= 1 && isFinite(viewer.duration)) {
      updateRuler();
    } else {
      viewer.addEventListener('loadedmetadata', updateRuler, { once: true });
    }
  }

  /* Clear existing tracks but keep playhead */
  const playhead = tracksContainer.querySelector('.pp-playhead');
  tracksContainer.innerHTML = '';
  if (playhead) tracksContainer.appendChild(playhead);

  /* Build new tracks */
  data.tracks.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'pp-track';

    const label = document.createElement('span');
    label.className = 'pp-track-label ' + track.type;
    label.textContent = track.label;
    trackEl.appendChild(label);

    const clipsEl = document.createElement('div');
    clipsEl.className = 'pp-track-clips';

    track.clips.forEach(clip => {
      const clipEl = document.createElement('div');
      clipEl.className = 'pp-clip ' + track.type + '-clip';
      clipEl.style.left = clip.left + '%';
      clipEl.style.width = clip.width + '%';
      clipEl.textContent = clip.name;
      clipsEl.appendChild(clipEl);
    });

    trackEl.appendChild(clipsEl);
    tracksContainer.appendChild(trackEl);
  });
}

/* --- Fullscreen buttons --- */
document.querySelectorAll('.fs-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    /* Find the viewer screen to fullscreen */
    const panel = btn.closest('.panel') || btn.closest('.mac-window');
    let target = null;

    /* Color grading viewer */
    if (btn.classList.contains('cg-fs-btn')) {
      target = document.querySelector('.cg-viewer-inner');
    } else {
      /* Regular viewer screen */
      target = panel?.querySelector('.pp-viewer-screen');
    }
    if (!target) return;

    const icon = btn.querySelector('i');

    if (!document.fullscreenElement) {
      target.requestFullscreen().then(() => {
        if (icon) icon.className = 'lucide-minimize';
      }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => {
        if (icon) icon.className = 'lucide-maximize';
      }).catch(() => {});
    }
  });
});

/* Reset icon when exiting fullscreen via Escape */
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    document.querySelectorAll('.fs-btn i').forEach(icon => {
      icon.className = 'lucide-maximize';
    });
  }
});

/* --- Playhead driven by actual video playback --- */
(function initRealPlayhead() {
  const panels = document.querySelectorAll('.panel');

  panels.forEach(panel => {
    const timeline = panel.querySelector('.pp-timeline');
    if (!timeline) return;

    const tracks = timeline.querySelector('.pp-tracks');
    const playhead = timeline.querySelector('.pp-playhead');
    if (!tracks || !playhead) return;

    const viewer = panel.querySelector('.viewer-video');
    const tcDisplay = panel.querySelector('.vc-tc') || panel.querySelector('.transport-tc');
    const playBtn = panel.querySelector('.play-btn');

    /* Label offset — the track-label column is ~26px, tracks area starts after */
    const LABEL_W = 26;

    /* --- Format seconds → timecode HH:MM:SS:FF (24fps) --- */
    function formatTC(seconds) {
      if (!seconds || !isFinite(seconds)) return '00:00:00:00';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const f = Math.floor((seconds % 1) * 24);
      return (
        String(h).padStart(2, '0') + ':' +
        String(m).padStart(2, '0') + ':' +
        String(s).padStart(2, '0') + ':' +
        String(f).padStart(2, '0')
      );
    }

    /* --- Update playhead position from video time --- */
    function syncPlayhead() {
      if (!viewer || !viewer.duration || !isFinite(viewer.duration)) {
        requestAnimationFrame(syncPlayhead);
        return;
      }
      const pct = viewer.currentTime / viewer.duration;
      const maxLeft = tracks.clientWidth - LABEL_W - 2;
      playhead.style.left = (LABEL_W + pct * maxLeft) + 'px';

      if (tcDisplay) tcDisplay.textContent = formatTC(viewer.currentTime);
      requestAnimationFrame(syncPlayhead);
    }
    requestAnimationFrame(syncPlayhead);

    /* --- Click on timeline → seek video --- */
    tracks.addEventListener('click', (e) => {
      if (!viewer || !viewer.duration || !isFinite(viewer.duration)) return;
      const rect = tracks.getBoundingClientRect();
      const clickX = e.clientX - rect.left - LABEL_W;
      const trackWidth = rect.width - LABEL_W;
      const pct = Math.max(0, Math.min(1, clickX / trackWidth));
      viewer.currentTime = pct * viewer.duration;

      /* If paused, still update playhead immediately */
      const maxLeft = tracks.clientWidth - LABEL_W - 2;
      playhead.style.left = (LABEL_W + pct * maxLeft) + 'px';
      if (tcDisplay) tcDisplay.textContent = formatTC(viewer.currentTime);
    });

    /* --- Drag on timeline → scrub --- */
    let scrubbing = false;
    tracks.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      tracks.setPointerCapture(e.pointerId);
    });
    tracks.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      if (!viewer || !viewer.duration || !isFinite(viewer.duration)) return;
      const rect = tracks.getBoundingClientRect();
      const clickX = e.clientX - rect.left - LABEL_W;
      const trackWidth = rect.width - LABEL_W;
      const pct = Math.max(0, Math.min(1, clickX / trackWidth));
      viewer.currentTime = pct * viewer.duration;
    });
    tracks.addEventListener('pointerup', () => { scrubbing = false; });
    tracks.addEventListener('pointercancel', () => { scrubbing = false; });

    /* --- Play / Pause button --- */
    if (playBtn && viewer) {
      playBtn.addEventListener('click', () => {
        if (viewer.paused) {
          viewer.play().catch(() => {});
          playBtn.innerHTML = '<i class="lucide-pause"></i>';
        } else {
          viewer.pause();
          playBtn.innerHTML = '<i class="lucide-play"></i>';
        }
      });
      viewer.addEventListener('play', () => {
        playBtn.innerHTML = '<i class="lucide-pause"></i>';
      });
      viewer.addEventListener('pause', () => {
        playBtn.innerHTML = '<i class="lucide-play"></i>';
      });
    }
  });
})();
