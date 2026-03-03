/* ============================================
   WheelWill — Post-Production JS
   Simplified: Media Pool · Program · Timeline
   ============================================ */

/* ===== REFERENCE VIDEO DATA ===== */
const VIDEO_BASE_PATH = '../Videos/';

const ARTISTS = {
  reference: {
    name: 'Reference Videos',
    clips: [
      { id: 'rv1', name: 'Samsara - Guns Scene',                  file: 'Samsara - 2011 - Guns scene - Ayub Ogada - Nach M (360p, h264).mp4', icon: '<i class="lucide-film"></i>',              bg: 'linear-gradient(135deg,#1a3352,#2a5a8c)', dur: '00:03:00', frames: 4320 },
      { id: 'rv2', name: 'Ships in MASSIVE Storms',                file: 'Ships CAUGHT in MASSIVE Storms.mp4',                                  icon: '<i class="lucide-ship"></i>',              bg: 'linear-gradient(135deg,#1a4a5a,#2a7a9a)', dur: '00:05:00', frames: 7200 },
      { id: 'rv3', name: 'SHREDDED TAPES',                         file: 'SHREDDED TAPES.mp4',                                                  icon: '<i class="lucide-cassette-tape"></i>',     bg: 'linear-gradient(135deg,#3a1a1a,#6a2a2a)', dur: '00:04:00', frames: 5760 },
      { id: 'rv4', name: 'Skaterdater (1965)',                      file: 'Skaterdater (1965) _ The World\'s First Skateboard Movie.mp4',        icon: '<i class="lucide-clapperboard"></i>',      bg: 'linear-gradient(135deg,#2a3a1a,#4a6a2a)', dur: '00:04:30', frames: 6480 },
    ]
  }
};

/* Active <video> element for playback */
let activeVideoEl = null;

function getAllClips() {
  const all = [];
  for (const a of Object.values(ARTISTS)) a.clips.forEach(c => all.push(c));
  return all;
}

/* ===== DOM ===== */
const thumbsGrid    = document.getElementById('media-thumbs');
const programScreen = document.getElementById('program-screen');
const timecodeLbl   = document.getElementById('timecode');
const viewerTc      = document.getElementById('viewer-tc');
const tlNameLbl     = document.getElementById('timeline-name');
const tlRuler       = document.getElementById('tl-ruler');
const playheadEl    = document.getElementById('playhead');
const tlTrackLabels = document.getElementById('tl-track-labels');
const tlTracks      = document.getElementById('tl-tracks');
const fsOverlay     = document.getElementById('fullscreen-overlay');
const fsViewer      = document.getElementById('fs-viewer');
const fsTc          = document.getElementById('fs-timecode');

/* ===== STATE ===== */
let openTimeline = null;
let isPlaying    = false;
let playStart    = 0;
let playOffset   = 0;
let playRAF      = null;
let currentFrame = 0;
let totalFrames  = 0;
let zoomLevel    = 1;
let fsMode       = false;

const FPS = 24;
const PX_PER_FRAME = 0.12;

/* ===== INIT ===== */
renderThumbs('all');
buildRuler();

/* ===== PAGE TABS ===== */
document.getElementById('page-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.page-tab');
  if (!tab) return;
  document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('page-' + tab.dataset.page).classList.add('active');
});

/* Color btn in bottom bar */
document.getElementById('rp-color')?.addEventListener('click', () => {
  document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelector('.page-tab[data-page="color-grading"]').classList.add('active');
  document.getElementById('page-color-grading').classList.add('active');
});

/* ===== BIN FILTERING ===== */
document.getElementById('bins').addEventListener('click', e => {
  const btn = e.target.closest('.bin-item');
  if (!btn) return;
  document.querySelectorAll('.bin-item').forEach(b => b.classList.remove('active-bin'));
  btn.classList.add('active-bin');
  renderThumbs(btn.dataset.artist);
});

/* ===== RENDER THUMBNAILS ===== */
function renderThumbs(artist) {
  const clips = artist === 'all' ? getAllClips() : (ARTISTS[artist]?.clips || []);
  thumbsGrid.innerHTML = '';
  clips.forEach(clip => {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.draggable = true;
    el.dataset.clipId = clip.id;
    el.innerHTML = `
      <div class="thumb-vis" style="background:${clip.bg}">${clip.icon}
        <span class="thumb-dur">${clip.dur}</span>
      </div>
      <div class="thumb-name">${clip.name}</div>
    `;
    el.addEventListener('dblclick', () => openAsTimeline(clip));
    el.addEventListener('click', () => selectThumb(clip, el));
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', clip.id);
      const ghost = el.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.position = 'absolute';
      ghost.style.top = '-999px';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 55, 30);
      setTimeout(() => ghost.remove(), 0);
    });
    thumbsGrid.appendChild(el);
  });
}

function selectThumb(clip, el) {
  document.querySelectorAll('.thumb').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
}

/* ===== OPEN AS TIMELINE ===== */
function openAsTimeline(clip) {
  stopPlayback();
  openTimeline = clip;
  currentFrame = 0;
  tlNameLbl.textContent = clip.name;

  const artist = findArtistForClip(clip.id);
  const clips = artist ? artist.clips : [clip];

  /* Build video viewer */
  if (clip.file) {
    const videoPath = VIDEO_BASE_PATH + clip.file;
    programScreen.innerHTML = `
      <video class="viewer-video" id="active-video" preload="metadata">
        <source src="${videoPath}" type="video/mp4">
      </video>
      <div class="viewer-clip-overlay">
        <span class="viewer-clip-icon">${clip.icon}</span>
        <span class="viewer-clip-title">${clip.name}</span>
      </div>
    `;
    activeVideoEl = document.getElementById('active-video');
    activeVideoEl.addEventListener('loadedmetadata', () => {
      const realDur = activeVideoEl.duration;
      totalFrames = Math.round(realDur * FPS);
      clip.frames = totalFrames;
      buildTimeline(clips, clip);
      buildRuler();
    });
    activeVideoEl.addEventListener('error', () => {
      /* Fallback if file can't load */
      totalFrames = clip.frames;
      buildTimeline(clips, clip);
      buildRuler();
    });
  } else {
    activeVideoEl = null;
    totalFrames = clip.frames;
    programScreen.innerHTML = `
      <div class="viewer-clip-bg" style="background:${clip.bg}"></div>
      <div class="viewer-clip">
        <span class="viewer-clip-icon">${clip.icon}</span>
        <span class="viewer-clip-title">${clip.name}</span>
      </div>
    `;
    buildTimeline(clips, clip);
    buildRuler();
  }

  updateTimecode(0);
  updatePlayhead(0);
}

function findArtistForClip(id) {
  for (const a of Object.values(ARTISTS)) {
    if (a.clips.find(c => c.id === id)) return a;
  }
  return null;
}

/* ===== BUILD TIMELINE ===== */
function buildTimeline(clips) {
  let maxEnd = 0;
  clips.forEach(c => { maxEnd += c.frames; });
  totalFrames = Math.max(totalFrames, maxEnd);

  tlTrackLabels.innerHTML = `
    <div class="track-label video">V2</div>
    <div class="track-label video">V1</div>
    <div class="track-label audio">A1</div>
    <div class="track-label audio">A2</div>
  `;

  const width = totalFrames * PX_PER_FRAME * zoomLevel;
  tlTracks.innerHTML = '';
  tlTracks.style.width = width + 'px';

  /* V2 */
  const v2 = mkTrack();
  let v2Off = 0;
  clips.forEach((c, i) => {
    if (i % 2 === 1) { v2.appendChild(mkClip(c, v2Off, c.frames, 'video-clip')); v2Off += c.frames; }
    else { v2Off += c.frames * 0.3; }
  });
  tlTracks.appendChild(v2);

  /* V1 */
  const v1 = mkTrack();
  let v1Off = 0;
  clips.forEach(c => { v1.appendChild(mkClip(c, v1Off, c.frames, 'video-clip')); v1Off += c.frames; });
  tlTracks.appendChild(v1);

  /* A1 */
  const a1 = mkTrack();
  let a1Off = 0;
  clips.forEach(c => { a1.appendChild(mkClip(c, a1Off, c.frames, 'audio-clip')); a1Off += c.frames; });
  tlTracks.appendChild(a1);

  /* A2 */
  const a2 = mkTrack();
  a2.appendChild(mkClip({ name: 'Music Score for Trailer.wav', icon: '', bg: '#1a2a1a' }, 0, totalFrames * 0.8, 'audio-clip'));
  tlTracks.appendChild(a2);

  /* Playhead line */
  const pl = document.createElement('div');
  pl.className = 'playhead-line';
  pl.id = 'playhead-line';
  pl.style.left = '0px';
  tlTracks.appendChild(pl);
}

function mkTrack() {
  const d = document.createElement('div');
  d.className = 'tl-track';
  return d;
}

function mkClip(clip, startFrame, durFrames, cls) {
  const d = document.createElement('div');
  d.className = 'tl-clip ' + cls;
  d.style.left = (startFrame * PX_PER_FRAME * zoomLevel) + 'px';
  d.style.width = (durFrames * PX_PER_FRAME * zoomLevel) + 'px';
  d.textContent = clip.name;
  d.title = clip.name;
  d.addEventListener('click', () => {
    document.querySelectorAll('.tl-clip').forEach(c => c.classList.remove('selected-clip'));
    d.classList.add('selected-clip');
  });
  return d;
}

/* ===== RULER ===== */
function buildRuler() {
  tlRuler.querySelectorAll('.ruler-tick, .ruler-tick-label').forEach(e => e.remove());
  const total = totalFrames || 10000;
  const px = PX_PER_FRAME * zoomLevel;
  const majorEvery = FPS * 5;
  const minorEvery = FPS;
  for (let f = 0; f < total; f += minorEvery) {
    const isMajor = f % majorEvery === 0;
    const tick = document.createElement('div');
    tick.className = 'ruler-tick' + (isMajor ? ' major' : '');
    tick.style.left = (f * px) + 'px';
    tick.style.height = isMajor ? '100%' : '40%';
    tlRuler.appendChild(tick);
    if (isMajor) {
      const lbl = document.createElement('span');
      lbl.className = 'ruler-tick-label';
      lbl.style.left = (f * px) + 'px';
      lbl.textContent = framesToTC(f);
      tlRuler.appendChild(lbl);
    }
  }
  tlRuler.style.width = (total * px) + 'px';
}

/* ===== TIMECODE ===== */
function framesToTC(f) {
  const s = Math.floor(f / FPS);
  const fr = f % FPS;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}:${pad(fr)}`;
}
function pad(n) { return n.toString().padStart(2, '0'); }

function updateTimecode(frame) {
  currentFrame = frame;
  const tc = framesToTC(frame);
  timecodeLbl.textContent = tc;
  if (viewerTc) viewerTc.textContent = tc;
  if (fsTc) fsTc.textContent = tc;
}

function updatePlayhead(frame) {
  const px = frame * PX_PER_FRAME * zoomLevel;
  playheadEl.style.left = px + 'px';
  const pl = document.getElementById('playhead-line');
  if (pl) pl.style.left = px + 'px';
}

/* ===== PLAYBACK ===== */
function togglePlay() {
  isPlaying ? stopPlayback() : startPlayback();
}

function startPlayback() {
  if (!openTimeline) return;
  isPlaying = true;
  playStart = performance.now();
  playOffset = currentFrame;
  updatePlayBtns(true);
  meterLoop();
  if (activeVideoEl) {
    activeVideoEl.currentTime = currentFrame / FPS;
    activeVideoEl.play().catch(() => {});
  }
  rafTick();
}

function stopPlayback() {
  isPlaying = false;
  if (playRAF) cancelAnimationFrame(playRAF);
  playRAF = null;
  if (activeVideoEl) {
    activeVideoEl.pause();
  }
  updatePlayBtns(false);
}

function rafTick() {
  if (!isPlaying) return;
  let frame;
  if (activeVideoEl) {
    frame = Math.floor(activeVideoEl.currentTime * FPS);
  } else {
    const elapsed = performance.now() - playStart;
    frame = playOffset + Math.floor((elapsed / 1000) * FPS);
  }
  if (frame >= totalFrames) {
    currentFrame = 0;
    stopPlayback();
    if (activeVideoEl) activeVideoEl.currentTime = 0;
    updateTimecode(0);
    updatePlayhead(0);
    return;
  }
  updateTimecode(frame);
  updatePlayhead(frame);
  /* Auto-scroll */
  const wrap = document.getElementById('tl-tracks-wrap');
  if (wrap) {
    const vis = wrap.clientWidth - 64;
    const px = frame * PX_PER_FRAME * zoomLevel;
    if (px > wrap.scrollLeft + vis - 60) wrap.scrollLeft = px - 100;
  }
  playRAF = requestAnimationFrame(rafTick);
}

function updatePlayBtns(playing) {
  [document.getElementById('pgm-play-btn'), document.getElementById('fs-play-btn')].forEach(b => {
    if (b) { b.innerHTML = playing ? '<i class="lucide-pause"></i>' : '<i class="lucide-play"></i>'; b.classList.toggle('playing', playing); }
  });
}

function meterLoop() {
  if (!isPlaying) return;
  document.querySelectorAll('.meter-fill').forEach(m => {
    m.style.height = (40 + Math.random() * 50) + '%';
  });
  setTimeout(meterLoop, 120);
}

/* ===== CONTROLS ===== */
document.addEventListener('click', e => {
  const btn = e.target.closest('.vc-btn');
  if (!btn) return;
  const a = btn.dataset.action;
  if (!a) return;
  switch (a) {
    case 'pgm-play': case 'fs-play': togglePlay(); break;
    case 'pgm-prev': case 'fs-prev': seekRel(-FPS * 5); break;
    case 'pgm-next': case 'fs-next': seekRel(FPS * 5); break;
    case 'pgm-fullscreen': openFS(); break;
    case 'fs-close': closeFS(); break;
  }
});

function seekRel(frames) {
  if (!openTimeline) return;
  const was = isPlaying;
  if (was) stopPlayback();
  currentFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame + frames));
  if (activeVideoEl) {
    activeVideoEl.currentTime = currentFrame / FPS;
  }
  updateTimecode(currentFrame);
  updatePlayhead(currentFrame);
  if (was) startPlayback();
}

/* ===== FULLSCREEN ===== */
function openFS() {
  if (!openTimeline) return;
  fsMode = true;
  fsOverlay.classList.add('open');
  if (activeVideoEl) {
    fsViewer.innerHTML = `<video class="viewer-video" id="fs-video" autoplay muted style="width:100%;height:100%;object-fit:contain;">
      <source src="${activeVideoEl.querySelector('source').src}" type="video/mp4">
    </video>`;
    const fsVid = document.getElementById('fs-video');
    fsVid.currentTime = activeVideoEl.currentTime;
    if (isPlaying) fsVid.play().catch(() => {});
  } else {
    fsViewer.innerHTML = programScreen.innerHTML;
  }
  fsTc.textContent = timecodeLbl.textContent;
}
function closeFS() {
  fsMode = false;
  fsOverlay.classList.remove('open');
  const fsVid = document.getElementById('fs-video');
  if (fsVid) fsVid.pause();
}

document.getElementById('btn-fullscreen')?.addEventListener('click', () => { fsMode ? closeFS() : openFS(); });

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && fsMode) closeFS();
  if (e.key === ' ' && openTimeline) { e.preventDefault(); togglePlay(); }
});

/* ===== DRAG & DROP ===== */
const tlArea = document.getElementById('timeline-area');
tlArea.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
tlArea.addEventListener('drop', e => {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  const clip = findClipById(id);
  if (clip) openAsTimeline(clip);
});

function findClipById(id) {
  for (const a of Object.values(ARTISTS)) {
    const c = a.clips.find(c => c.id === id);
    if (c) return c;
  }
  return null;
}

/* ===== RULER SEEK ===== */
tlRuler.addEventListener('click', e => {
  if (!openTimeline) return;
  const rect = tlRuler.getBoundingClientRect();
  const x = e.clientX - rect.left + tlRuler.parentElement.scrollLeft;
  const frame = Math.max(0, Math.round(x / (PX_PER_FRAME * zoomLevel)));
  const was = isPlaying;
  if (was) stopPlayback();
  currentFrame = Math.min(frame, totalFrames - 1);
  updateTimecode(currentFrame);
  updatePlayhead(currentFrame);
  if (was) startPlayback();
});

/* ===== ZOOM ===== */
const zoomSlider = document.getElementById('zoom-slider');
document.getElementById('zoom-in')?.addEventListener('click', () => {
  zoomLevel = Math.min(4, zoomLevel + 0.2);
  zoomSlider.value = zoomLevel;
  rebuildZoom();
});
document.getElementById('zoom-out')?.addEventListener('click', () => {
  zoomLevel = Math.max(0.5, zoomLevel - 0.2);
  zoomSlider.value = zoomLevel;
  rebuildZoom();
});
zoomSlider.addEventListener('input', e => { zoomLevel = parseFloat(e.target.value); rebuildZoom(); });

function rebuildZoom() {
  if (openTimeline) {
    const artist = findArtistForClip(openTimeline.id);
    buildTimeline(artist ? artist.clips : [openTimeline]);
    updatePlayhead(currentFrame);
  }
  buildRuler();
}

/* ===== TOOLS ===== */
document.querySelector('.timeline-toolbar')?.addEventListener('click', e => {
  const t = e.target.closest('.tl-tool');
  if (!t) return;
  document.querySelectorAll('.tl-tool').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
});

/* ===== RESOLVE BAR ===== */
document.getElementById('resolve-pages')?.addEventListener('click', e => {
  const btn = e.target.closest('.rp-btn');
  if (!btn) return;
  document.querySelectorAll('.rp-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
});
