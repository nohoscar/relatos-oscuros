// ============================================
// Relatos Oscuros - App v2
// ============================================

let STORIES = [];

const VOICE_LABELS = {
  narrador: "Narrador",
  hombre: "Hombre",
  mujer: "Mujer",
  anciano: "Anciano",
  nina: "Niña",
  entidad: "Entidad",
  anciana: "Anciana",
};

let currentStory = null;
let currentFragmentIndex = 0;
let audioQueue = [];        // URLs de los fragmentos con audio (en orden)
let preloadedAudio = {};    // index -> elemento Audio precargado
let isPlaying = false;
let currentAudio = null;
let ambientAudio = null;
let storyAmbientAudio = null;
const isMobile = () => window.innerWidth <= 768;

// ============================================
// Progreso de escucha (localStorage)
// ============================================
const PROGRESS_KEY = "relatos-progress";

function getProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(storyId, index) {
  const p = getProgress();
  p[storyId] = index;
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
}

function clearProgress(storyId) {
  const p = getProgress();
  delete p[storyId];
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
}

// ============================================
// Ambient audio
// ============================================
function startAmbient() {
  if (ambientAudio) return;
  ambientAudio = new Audio("audio/ambient-menu.mp3");
  ambientAudio.loop = true;
  ambientAudio.volume = 0.3;
  ambientAudio.play().catch(() => {});
  updateAmbientButton();
}

function stopAmbient() {
  if (!ambientAudio) return;
  ambientAudio.pause();
  ambientAudio.currentTime = 0;
  ambientAudio = null;
  updateAmbientButton();
}

function toggleAmbient() {
  if (ambientAudio) {
    stopAmbient();
    ambientMuted = true;
  } else {
    startAmbient();
    ambientMuted = false;
  }
}

let ambientMuted = false;

function updateAmbientButton() {
  const btn = document.getElementById("btn-ambient-toggle");
  if (!btn) return;
  if (ambientAudio) {
    btn.textContent = "🔊";
    btn.classList.remove("muted");
  } else {
    btn.textContent = "🔇";
    btn.classList.add("muted");
  }
}

// ============================================
// Splash screen
// ============================================
function enterApp() {
  const splash = document.getElementById("splash");
  splash.classList.add("fade-out");
  document.getElementById("app").classList.remove("hidden");
  startAmbient();
  setTimeout(() => splash.remove(), 800);
}

// Volumen normal del ambiente y volumen "agachado" cuando habla la narración
const AMBIENT_STORY_VOLUME = 0.15;
const AMBIENT_STORY_DUCKED = 0.05;

function startStoryAmbient(url) {
  stopStoryAmbient();
  if (!url) return;
  storyAmbientAudio = new Audio(url);
  storyAmbientAudio.loop = true;
  storyAmbientAudio.volume = AMBIENT_STORY_VOLUME;
  storyAmbientAudio.play().catch(() => {});
}

function stopStoryAmbient() {
  if (!storyAmbientAudio) return;
  storyAmbientAudio.pause();
  storyAmbientAudio.currentTime = 0;
  storyAmbientAudio = null;
}

// Transición suave de volumen del ambiente (ducking)
function rampAmbient(target, ms = 450) {
  if (!storyAmbientAudio) return;
  const audio = storyAmbientAudio;
  const startVol = audio.volume;
  const startTime = performance.now();
  function step(now) {
    // Cancelar si el ambiente cambió de historia o se detuvo
    if (storyAmbientAudio !== audio) return;
    const t = Math.min((now - startTime) / ms, 1);
    audio.volume = startVol + (target - startVol) * t;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function duckAmbient() { rampAmbient(AMBIENT_STORY_DUCKED); }
function unduckAmbient() { rampAmbient(AMBIENT_STORY_VOLUME); }

// ============================================
// Render sidebar story list
// ============================================
function renderStories() {
  const container = document.getElementById("stories-list");
  container.innerHTML = STORIES.map(story => {
    const hasAudio = story.fragments.some(f => f.audioFile);
    const isActive = currentStory && currentStory.id === story.id;

    const coverHTML = story.cover
      ? `<div class="story-card-cover" style="background-image: url('${story.cover}')"></div>`
      : `<div class="story-card-cover no-cover">🕯️</div>`;

    return `
      <div class="story-card ${isActive ? 'active' : ''}" onclick="openStory(${story.id})">
        <div class="story-card-inner">
          ${coverHTML}
          <div class="story-card-info">
            <div class="story-card-title">${story.title}</div>
            <div class="story-card-meta">
              <span>${story.fragments.length} fragmentos</span>
              ${hasAudio ? '<span class="badge-audio">AUDIO</span>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================
// Open story in reader
// ============================================
function openStory(id) {
  currentStory = STORIES.find(s => s.id === id);
  if (!currentStory) return;

  const reader = document.getElementById("reader");
  const empty = document.getElementById("reader-empty");
  const content = document.getElementById("reader-content");

  // Mobile: show reader, hide sidebar
  if (isMobile()) {
    document.getElementById("sidebar").classList.add("hidden-mobile");
    reader.classList.add("active-mobile");
  }

  stopAmbient();

  // Start story-specific ambient
  if (currentStory.ambient && !ambientMuted) {
    startStoryAmbient(currentStory.ambient);
  }

  empty.classList.add("hidden");
  content.classList.remove("hidden");

  const coverHTML = currentStory.cover
    ? `<div class="reader-cover" style="background-image: url('${currentStory.cover}')"></div>`
    : '';

  const voices = [...new Set(currentStory.fragments.map(f => f.voice))];
  const voiceTags = voices.map(v =>
    `<span class="voice-tag ${v}">${VOICE_LABELS[v] || v}</span>`
  ).join("");

  const hasAudio = currentStory.fragments.some(f => f.audioFile);
  const totalAudio = currentStory.fragments.filter(f => f.audioFile).length;
  const savedIndex = getProgress()[currentStory.id];
  const isResuming = typeof savedIndex === "number" && savedIndex > 0 && savedIndex < totalAudio;
  const listenLabel = isResuming
    ? `▶ Reanudar (${savedIndex + 1}/${totalAudio})`
    : "▶ Escuchar Relato";
  const listenBtn = hasAudio
    ? `<button class="btn-listen" id="btn-listen" onclick="listenStory()">${listenLabel}</button>`
    : `<div class="no-audio">🎧 Audio próximamente...</div>`;

  const fragmentsHTML = currentStory.fragments.map((f, i) => {
    const imgHTML = f.image
      ? `<div class="fragment-image"><img src="${f.image}" alt="" loading="lazy" /></div>`
      : '';
    return `
      <div class="fragment" id="fragment-${i}">
        ${imgHTML}
        <div class="fragment-voice ${f.voice}">${VOICE_LABELS[f.voice] || f.voice}</div>
        <div class="fragment-text">${f.text}</div>
      </div>
    `;
  }).join("");

  content.innerHTML = `
    <button class="btn-back-mobile" onclick="goBack()">← Volver</button>
    ${coverHTML}
    <div class="reader-header">
      <h2 class="reader-title">${currentStory.title}</h2>
      <div class="reader-voices">${voiceTags}</div>
    </div>
    ${listenBtn}
    ${fragmentsHTML}
  `;

  content.scrollTop = 0;
  reader.scrollTop = 0;
  renderStories(); // Update active state
}

function goBack() {
  stopPlayback();
  stopStoryAmbient();
  currentStory = null;

  if (isMobile()) {
    document.getElementById("sidebar").classList.remove("hidden-mobile");
    document.getElementById("reader").classList.remove("active-mobile");
  }

  document.getElementById("reader-empty").classList.remove("hidden");
  document.getElementById("reader-content").classList.add("hidden");
  document.getElementById("reader-content").innerHTML = "";
  renderStories();
  if (!ambientMuted) startAmbient();
}

// ============================================
// Audio playback
// ============================================
function listenStory() {
  if (!currentStory) return;

  const btn = document.getElementById("btn-listen");

  // Lista de URLs de los fragmentos que tienen audio (en orden)
  audioQueue = currentStory.fragments.map(f => f.audioFile).filter(Boolean);
  if (audioQueue.length === 0) return;

  preloadedAudio = {};
  showPlayer();
  setupMediaSession();

  // Reanudar desde donde se quedó, si hay progreso guardado
  const saved = getProgress()[currentStory.id];
  const start = (typeof saved === "number" && saved > 0 && saved < audioQueue.length) ? saved : 0;

  btn.textContent = "▶ Reproduciendo...";
  playFragment(start);
}

function preloadNext(index) {
  if (index >= audioQueue.length || preloadedAudio[index]) return;
  const a = new Audio();
  a.preload = "auto";
  a.src = audioQueue[index];
  preloadedAudio[index] = a;
}

function playFragment(index) {
  if (index >= audioQueue.length) {
    if (currentStory) clearProgress(currentStory.id); // relato terminado
    stopPlayback();
    return;
  }

  currentFragmentIndex = index;
  highlightFragment(index);
  updatePlayerInfo(index);
  if (currentStory) saveProgress(currentStory.id, index);

  if (currentAudio) { currentAudio.pause(); currentAudio.onended = null; }

  // Usar el audio precargado si está disponible; si no, cargar por URL directa
  currentAudio = preloadedAudio[index] || new Audio(audioQueue[index]);
  preloadedAudio = {};
  currentAudio.currentTime = 0;

  isPlaying = true;
  updatePlayButton();
  updateMediaSession(index);

  currentAudio.ontimeupdate = () => {
    if (currentAudio.duration) {
      const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
      document.getElementById("progress-fill").style.width = pct + "%";
    }
  };

  currentAudio.onended = () => playFragment(index + 1);
  currentAudio.play().catch(() => {});
  duckAmbient(); // el ambiente se agacha mientras habla la narración

  // Precargar el siguiente fragmento mientras suena el actual
  preloadNext(index + 1);
}

function highlightFragment(index) {
  document.querySelectorAll(".fragment").forEach((el, i) => {
    el.classList.toggle("active", i === index);
  });
  const el = document.getElementById(`fragment-${index}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function updatePlayerInfo(index) {
  if (!currentStory) return;
  const frag = currentStory.fragments[index];
  document.getElementById("player-title").textContent = currentStory.title;
  document.getElementById("player-fragment").textContent =
    `${VOICE_LABELS[frag.voice] || frag.voice}: ${frag.text.substring(0, 50)}...`;
}

function updatePlayButton() {
  document.getElementById("btn-play").textContent = isPlaying ? "⏸" : "▶";
}

function showPlayer() {
  document.getElementById("player").classList.remove("hidden");
}

function stopPlayback() {
  if (currentAudio) { currentAudio.pause(); currentAudio.onended = null; currentAudio = null; }
  preloadedAudio = {};
  unduckAmbient(); // el ambiente vuelve a su volumen normal
  isPlaying = false;
  document.getElementById("player").classList.add("hidden");
  document.querySelectorAll(".fragment").forEach(el => el.classList.remove("active"));
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  const btn = document.getElementById("btn-listen");
  if (btn) { btn.disabled = false; btn.textContent = "▶ Escuchar Relato"; }
}

// ============================================
// MediaSession (controles en pantalla de bloqueo)
// ============================================
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("play", () => {
    if (!currentAudio) return;
    currentAudio.play().catch(() => {});
    isPlaying = true;
    duckAmbient();
    updatePlayButton();
    navigator.mediaSession.playbackState = "playing";
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    if (!currentAudio) return;
    currentAudio.pause();
    isPlaying = false;
    unduckAmbient();
    updatePlayButton();
    navigator.mediaSession.playbackState = "paused";
  });

  navigator.mediaSession.setActionHandler("previoustrack", () => {
    if (currentFragmentIndex > 0) playFragment(currentFragmentIndex - 1);
  });

  navigator.mediaSession.setActionHandler("nexttrack", () => {
    if (currentFragmentIndex < audioQueue.length - 1) playFragment(currentFragmentIndex + 1);
  });
}

function updateMediaSession(index) {
  if (!("mediaSession" in navigator) || !currentStory) return;

  const frag = currentStory.fragments[index];
  const artwork = currentStory.cover
    ? [{ src: new URL(currentStory.cover, location.href).href, sizes: "512x512", type: "image/png" }]
    : [];

  navigator.mediaSession.metadata = new MediaMetadata({
    title: currentStory.title,
    artist: `${VOICE_LABELS[frag.voice] || frag.voice} · ${index + 1}/${audioQueue.length}`,
    album: "Relatos Oscuros",
    artwork,
  });
  navigator.mediaSession.playbackState = "playing";
}

// ============================================
// Player controls
// ============================================
document.getElementById("btn-play").addEventListener("click", () => {
  if (!currentAudio) return;
  if (isPlaying) { currentAudio.pause(); isPlaying = false; unduckAmbient(); }
  else { currentAudio.play().catch(() => {}); isPlaying = true; duckAmbient(); }
  updatePlayButton();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }
});

// Barra de progreso: clic (o arrastre) para saltar dentro del fragmento
const progressBarEl = document.getElementById("progress-bar");

function seekFromEvent(clientX) {
  if (!currentAudio || !currentAudio.duration) return;
  const rect = progressBarEl.getBoundingClientRect();
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  currentAudio.currentTime = ratio * currentAudio.duration;
  document.getElementById("progress-fill").style.width = (ratio * 100) + "%";
}

progressBarEl.addEventListener("click", (e) => seekFromEvent(e.clientX));

// Arrastre para hacer scrubbing
let isScrubbing = false;
progressBarEl.addEventListener("pointerdown", (e) => {
  isScrubbing = true;
  progressBarEl.setPointerCapture(e.pointerId);
  seekFromEvent(e.clientX);
});
progressBarEl.addEventListener("pointermove", (e) => {
  if (isScrubbing) seekFromEvent(e.clientX);
});
progressBarEl.addEventListener("pointerup", () => { isScrubbing = false; });

document.getElementById("btn-prev").addEventListener("click", () => {
  if (currentFragmentIndex > 0) playFragment(currentFragmentIndex - 1);
});

document.getElementById("btn-next").addEventListener("click", () => {
  if (currentFragmentIndex < audioQueue.length - 1) playFragment(currentFragmentIndex + 1);
});

// ============================================
// Init
// ============================================
async function init() {
  try {
    const res = await fetch("stories.json");
    STORIES = await res.json();
  } catch (e) {
    console.error("Error cargando historias:", e);
    STORIES = [];
  }
  renderStories();
}

init();

// ============================================
// PWA: registro del service worker + auto-actualización
// ============================================
function showUpdateToast(registration) {
  if (document.getElementById("update-toast")) return;
  const toast = document.createElement("div");
  toast.id = "update-toast";
  toast.className = "update-toast";
  toast.innerHTML = `<span>🔄 Nueva versión disponible</span><button type="button">Actualizar</button>`;
  toast.querySelector("button").addEventListener("click", () => {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    toast.remove();
  });
  document.body.appendChild(toast);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          // Hay una versión nueva lista y ya existía una controlando: avisar
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast(reg);
          }
        });
      });
    }).catch(() => {});

    // Cuando el nuevo SW toma control, recargar una vez para aplicar la actualización
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
