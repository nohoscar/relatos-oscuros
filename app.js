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

// Velocidad y volumen de la narración (persistidos)
const SPEEDS = [1, 1.25, 1.5, 0.75];
let playbackRate = 1;
let narrationVolume = 1;
try {
  const r = parseFloat(localStorage.getItem("relatos-rate"));
  if (!isNaN(r) && SPEEDS.includes(r)) playbackRate = r;
  const v = parseFloat(localStorage.getItem("relatos-volume"));
  if (!isNaN(v)) narrationVolume = Math.min(Math.max(v, 0), 1);
} catch {}

// Estado de UI: historia sonando, carga, búsqueda y hint de primera vez
let playingStoryId = null;
let isLoading = false;
let searchQuery = "";
const HINT_KEY = "relatos-hint-seen";
let hintSeen = false;
try { hintSeen = localStorage.getItem(HINT_KEY) === "1"; } catch {}

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
// Escapa texto antes de meterlo en innerHTML
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Normaliza texto (sin acentos, minúsculas) para búsqueda
function norm(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Duración estimada de una historia a partir del texto (~13 caracteres/seg)
function estimateMinutes(story) {
  const chars = story.fragments.reduce((n, f) => n + (f.text ? f.text.length : 0), 0);
  return Math.max(1, Math.round(chars / 13 / 60));
}

function renderStories() {
  const container = document.getElementById("stories-list");
  const q = norm(searchQuery.trim());
  const list = q ? STORIES.filter(s => norm(s.title).includes(q)) : STORIES;

  if (list.length === 0) {
    container.innerHTML = `<div class="list-empty">No encontré relatos con "${escapeHTML(searchQuery.trim())}"</div>`;
    return;
  }

  const hintHTML = (!hintSeen && !q)
    ? `<div class="list-hint">👆 Toca un relato para escuchar</div>`
    : "";

  container.innerHTML = hintHTML + list.map(story => {
    const hasAudio = story.fragments.some(f => f.audioFile);
    const isActive = currentStory && currentStory.id === story.id;
    const mins = estimateMinutes(story);

    const coverHTML = story.cover
      ? `<div class="story-card-cover" style="background-image: url('${story.cover}')"></div>`
      : `<div class="story-card-cover no-cover">🕯️</div>`;

    return `
      <div class="story-card ${isActive ? 'active' : ''}" data-story-id="${story.id}" role="button" tabindex="0" aria-label="Abrir ${escapeHTML(story.title)}" onclick="openStory(${story.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openStory(${story.id})}">
        <div class="story-card-inner">
          ${coverHTML}
          <div class="story-card-info">
            <div class="story-card-title">${story.title}</div>
            <div class="story-card-meta">
              <span>${story.fragments.length} fragmentos</span>
              <span>·</span>
              <span>~${mins} min</span>
              ${hasAudio ? '<span class="badge-audio">AUDIO</span>' : ''}
              <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  updatePlayingUI();
}

// Marca la tarjeta que está sonando (ecualizador), sin re-renderizar la lista
function updatePlayingUI() {
  document.querySelectorAll(".story-card").forEach(card => {
    const id = Number(card.dataset.storyId);
    const playing = id === playingStoryId;
    card.classList.toggle("playing", playing);
    card.classList.toggle("paused", playing && !isPlaying);
  });
}

// ============================================
// Open story in reader
// ============================================
function openStory(id) {
  currentStory = STORIES.find(s => s.id === id);
  if (!currentStory) return;

  if (!hintSeen) {
    hintSeen = true;
    try { localStorage.setItem(HINT_KEY, "1"); } catch {}
  }

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
    const audioIdx = currentStory.fragments.slice(0, i + 1).filter(x => x.audioFile).length - 1;
    const jump = f.audioFile
      ? ` role="button" tabindex="0" title="Escuchar desde aquí" onclick="jumpToFragment(${audioIdx})" onkeydown="if(event.key==='Enter'){jumpToFragment(${audioIdx})}"`
      : "";
    return `
      <div class="fragment ${f.audioFile ? 'can-jump' : ''}" id="fragment-${i}"${jump}>
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
  retryCount = 0;
  showPlayer();
  setupMediaSession();

  // Reanudar desde donde se quedó, si hay progreso guardado
  const saved = getProgress()[currentStory.id];
  const start = (typeof saved === "number" && saved > 0 && saved < audioQueue.length) ? saved : 0;

  btn.textContent = "▶ Reproduciendo...";
  playFragment(start);
}

// Tocar un fragmento: escuchar desde ahí
function jumpToFragment(audioIndex) {
  if (!currentStory) return;
  if (playingStoryId !== currentStory.id) {
    audioQueue = currentStory.fragments.map(f => f.audioFile).filter(Boolean);
    if (audioQueue.length === 0) return;
    preloadedAudio = {};
    retryCount = 0;
    showPlayer();
    setupMediaSession();
    const btn = document.getElementById("btn-listen");
    if (btn) btn.textContent = "▶ Reproduciendo...";
  }
  playFragment(Math.min(Math.max(audioIndex, 0), audioQueue.length - 1));
}

// Un solo elemento de audio para toda la narración.
// En iPhone, crear un Audio nuevo por fragmento hace que la narración se corte
// con la pantalla bloqueada; reusar el mismo elemento la mantiene sonando.
const narration = new Audio();
narration.preload = "auto";
// Elemento aparte solo para calentar la caché del siguiente fragmento
const preloader = new Audio();
preloader.preload = "auto";
preloader.muted = true;

let retryCount = 0;
let retryTimer = null;

function preloadNext(index) {
  if (index >= audioQueue.length) return;
  const url = new URL(audioQueue[index], location.href).href;
  if (preloader.src !== url) {
    preloader.src = url;
    preloader.load();
  }
}

function playFragment(index) {
  if (index >= audioQueue.length) {
    if (currentStory) clearProgress(currentStory.id); // relato terminado
    stopPlayback();
    return;
  }

  clearTimeout(retryTimer);
  hideAudioError();
  if (index !== currentFragmentIndex) retryCount = 0;

  currentFragmentIndex = index;
  highlightFragment(index);
  updatePlayerInfo(index);
  if (currentStory) saveProgress(currentStory.id, index);

  currentAudio = narration;
  narration.pause();
  narration.src = audioQueue[index];
  narration.playbackRate = playbackRate;
  narration.defaultPlaybackRate = playbackRate;
  narration.volume = narrationVolume;

  isPlaying = true;
  playingStoryId = currentStory ? currentStory.id : null;
  isLoading = true;
  updatePlayButton();
  updateMediaSession(index);
  updatePlayingUI();

  narration.ontimeupdate = () => {
    if (narration.duration) {
      const pct = (narration.currentTime / narration.duration) * 100;
      document.getElementById("progress-fill").style.width = pct + "%";
    }
  };

  // Spinner de carga mientras el audio bufferea
  narration.onplaying = () => { isLoading = false; retryCount = 0; updatePlayButton(); };
  narration.oncanplay = () => { isLoading = false; updatePlayButton(); };
  narration.onwaiting = () => { isLoading = true; updatePlayButton(); };
  narration.onerror = () => onNarrationError(index);

  narration.onended = () => {
    if (sleepAtEnd) { sleepAtEnd = false; clearSleepTimer(); pauseNarration(); return; }
    playFragment(index + 1);
  };
  narration.play().catch((err) => {
    // El navegador bloqueó el autoplay: dejar listo para que el usuario toque ▶
    if (err && err.name === "NotAllowedError") {
      isPlaying = false; isLoading = false;
      updatePlayButton(); updatePlayingUI();
    }
  });
  duckAmbient(); // el ambiente se agacha mientras habla la narración

  // Precargar el siguiente fragmento mientras suena el actual
  preloadNext(index + 1);
}

// Si un audio falla (red cortada, archivo dañado): reintentar una vez y luego avisar
function onNarrationError(index) {
  if (index !== currentFragmentIndex || !playingStoryId) return;
  if (retryCount < 1) {
    retryCount++;
    isLoading = true; updatePlayButton();
    retryTimer = setTimeout(() => playFragment(index), 1500);
    return;
  }
  isPlaying = false; isLoading = false;
  updatePlayButton(); updatePlayingUI(); unduckAmbient();
  showAudioError(index);
}

function showAudioError(index) {
  hideAudioError();
  const toast = document.createElement("div");
  toast.id = "audio-error-toast";
  toast.className = "update-toast audio-error-toast";
  toast.setAttribute("role", "alert");
  toast.innerHTML = `<span>⚠️ No se pudo cargar el audio. Revisa tu conexión.</span><button type="button">Reintentar</button>`;
  toast.querySelector("button").addEventListener("click", () => {
    retryCount = 0;
    playFragment(index);
  });
  document.body.appendChild(toast);
}

function hideAudioError() {
  const t = document.getElementById("audio-error-toast");
  if (t) t.remove();
}

function pauseNarration() {
  if (!currentAudio) return;
  currentAudio.pause();
  isPlaying = false;
  unduckAmbient();
  updatePlayButton();
  updatePlayingUI();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
}

function resumeNarration() {
  if (!currentAudio) return;
  currentAudio.play().catch(() => {});
  isPlaying = true;
  duckAmbient();
  updatePlayButton();
  updatePlayingUI();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
}

// ============================================
// Temporizador para dormir
// ============================================
// Ciclo: apagado → 15 → 30 → 60 min → al terminar el fragmento → apagado
const SLEEP_STEPS = [0, 15, 30, 60, "fin"];
let sleepStep = 0;
let sleepTimer = null;
let sleepAtEnd = false;

function clearSleepTimer() {
  clearTimeout(sleepTimer);
  sleepTimer = null;
  sleepAtEnd = false;
  sleepStep = 0;
  updateSleepButton();
}

function updateSleepButton() {
  const btn = document.getElementById("btn-sleep");
  if (!btn) return;
  const v = SLEEP_STEPS[sleepStep];
  btn.textContent = v === 0 ? "🌙" : v === "fin" ? "🌙⏹" : `🌙${v}`;
  btn.classList.toggle("on", v !== 0);
  btn.title = v === 0 ? "Temporizador para dormir"
    : v === "fin" ? "Se detiene al terminar este fragmento"
    : `Se detiene en ${v} min`;
}

// Bajar el volumen poco a poco antes de pausar, para no despertar de golpe
function fadeOutAndPause() {
  if (!currentAudio) { clearSleepTimer(); return; }
  const a = currentAudio;
  const start = a.volume;
  const t0 = performance.now();
  function step(now) {
    const k = Math.min((now - t0) / 8000, 1);
    a.volume = start * (1 - k);
    if (k < 1) requestAnimationFrame(step);
    else { pauseNarration(); a.volume = narrationVolume; clearSleepTimer(); }
  }
  requestAnimationFrame(step);
}

function cycleSleepTimer() {
  clearTimeout(sleepTimer);
  sleepTimer = null;
  sleepStep = (sleepStep + 1) % SLEEP_STEPS.length;
  const v = SLEEP_STEPS[sleepStep];
  sleepAtEnd = v === "fin";
  if (typeof v === "number" && v > 0) {
    sleepTimer = setTimeout(fadeOutAndPause, v * 60 * 1000);
  }
  updateSleepButton();
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
  const btn = document.getElementById("btn-play");
  btn.classList.toggle("loading", isLoading);
  btn.textContent = isLoading ? "" : (isPlaying ? "⏸" : "▶");
}

function showPlayer() {
  document.getElementById("player").classList.remove("hidden");
}

function stopPlayback() {
  clearTimeout(retryTimer);
  hideAudioError();
  clearSleepTimer();
  narration.onended = null;
  narration.onerror = null;
  narration.pause();
  narration.removeAttribute("src");
  narration.load();
  currentAudio = null;
  preloadedAudio = {};
  unduckAmbient(); // el ambiente vuelve a su volumen normal
  isPlaying = false;
  isLoading = false;
  playingStoryId = null;
  document.getElementById("player").classList.add("hidden");
  document.querySelectorAll(".fragment").forEach(el => el.classList.remove("active"));
  updatePlayingUI();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
  const btn = document.getElementById("btn-listen");
  if (btn) { btn.disabled = false; btn.textContent = "▶ Escuchar Relato"; }
}

// ============================================
// MediaSession (controles en pantalla de bloqueo)
// ============================================
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("play", () => resumeNarration());
  navigator.mediaSession.setActionHandler("pause", () => pauseNarration());

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
  if (isPlaying) pauseNarration();
  else resumeNarration();
});

const btnSleepEl = document.getElementById("btn-sleep");
if (btnSleepEl) btnSleepEl.addEventListener("click", cycleSleepTimer);

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

// Velocidad: botón que cicla entre las velocidades disponibles
function updateSpeedButton() {
  document.getElementById("btn-speed").textContent = playbackRate + "x";
}

document.getElementById("btn-speed").addEventListener("click", () => {
  const idx = SPEEDS.indexOf(playbackRate);
  playbackRate = SPEEDS[(idx + 1) % SPEEDS.length];
  if (currentAudio) currentAudio.playbackRate = playbackRate;
  updateSpeedButton();
  try { localStorage.setItem("relatos-rate", String(playbackRate)); } catch {}
});

// Volumen de la narración: botón con slider emergente
const volumeControlEl = document.querySelector(".volume-control");
const btnVolumeEl = document.getElementById("btn-volume");
const volumeSliderEl = document.getElementById("volume-slider");

function updateVolumeButton() {
  btnVolumeEl.textContent = narrationVolume === 0 ? "🔇" : narrationVolume < 0.5 ? "🔈" : "🔊";
}

btnVolumeEl.addEventListener("click", (e) => {
  e.stopPropagation();
  volumeControlEl.classList.toggle("open");
});

volumeSliderEl.addEventListener("input", () => {
  narrationVolume = parseFloat(volumeSliderEl.value);
  if (currentAudio) currentAudio.volume = narrationVolume;
  updateVolumeButton();
  try { localStorage.setItem("relatos-volume", String(narrationVolume)); } catch {}
});

// Cerrar el slider al tocar fuera
document.addEventListener("click", (e) => {
  if (!volumeControlEl.contains(e.target)) volumeControlEl.classList.remove("open");
});

// Buscador de historias
const searchInputEl = document.getElementById("story-search");
if (searchInputEl) {
  searchInputEl.addEventListener("input", () => {
    searchQuery = searchInputEl.value;
    renderStories();
  });
}

// Estado inicial de los controles
updateSpeedButton();
updateVolumeButton();
volumeSliderEl.value = narrationVolume;

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
      // Si ya hay una versión esperando de una visita anterior, avisar de una vez
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateToast(reg);
      }
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
      // Forzar chequeo de actualización al cargar
      reg.update();
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
