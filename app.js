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
let audioQueue = [];
let isPlaying = false;
let currentAudio = null;
let ambientAudio = null;
let storyAmbientAudio = null;
const isMobile = () => window.innerWidth <= 768;

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

function startStoryAmbient(url) {
  stopStoryAmbient();
  if (!url) return;
  storyAmbientAudio = new Audio(url);
  storyAmbientAudio.loop = true;
  storyAmbientAudio.volume = 0.15;
  storyAmbientAudio.play().catch(() => {});
}

function stopStoryAmbient() {
  if (!storyAmbientAudio) return;
  storyAmbientAudio.pause();
  storyAmbientAudio.currentTime = 0;
  storyAmbientAudio = null;
}

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
              <span>·</span>
              <span>${story.author}</span>
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
  const listenBtn = hasAudio
    ? `<button class="btn-listen" id="btn-listen" onclick="listenStory()">▶ Escuchar Relato</button>`
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
      <div class="reader-author">${currentStory.author}</div>
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
async function listenStory() {
  if (!currentStory) return;

  const btn = document.getElementById("btn-listen");
  btn.disabled = true;
  btn.textContent = "⏳ Cargando audio...";

  try {
    audioQueue = [];
    for (const f of currentStory.fragments) {
      if (f.audioFile) {
        const res = await fetch(f.audioFile);
        if (!res.ok) throw new Error("Audio no encontrado");
        audioQueue.push(await res.blob());
      }
    }
    if (audioQueue.length === 0) throw new Error("No hay audios");

    btn.textContent = "▶ Reproduciendo...";
    currentFragmentIndex = 0;
    showPlayer();
    playFragment(0);
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "▶ Escuchar Relato";
  }
}

function playFragment(index) {
  if (index >= audioQueue.length) { stopPlayback(); return; }

  currentFragmentIndex = index;
  highlightFragment(index);
  updatePlayerInfo(index);

  const url = URL.createObjectURL(audioQueue[index]);
  if (currentAudio) { currentAudio.pause(); URL.revokeObjectURL(currentAudio.src); }

  currentAudio = new Audio(url);
  isPlaying = true;
  updatePlayButton();

  currentAudio.addEventListener("timeupdate", () => {
    if (currentAudio.duration) {
      const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
      document.getElementById("progress-fill").style.width = pct + "%";
    }
  });

  currentAudio.addEventListener("ended", () => playFragment(index + 1));
  currentAudio.play();
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
  if (currentAudio) { currentAudio.pause(); URL.revokeObjectURL(currentAudio.src); currentAudio = null; }
  isPlaying = false;
  document.getElementById("player").classList.add("hidden");
  document.querySelectorAll(".fragment").forEach(el => el.classList.remove("active"));
  const btn = document.getElementById("btn-listen");
  if (btn) { btn.disabled = false; btn.textContent = "▶ Escuchar Relato"; }
}

// ============================================
// Player controls
// ============================================
document.getElementById("btn-play").addEventListener("click", () => {
  if (!currentAudio) return;
  if (isPlaying) { currentAudio.pause(); isPlaying = false; }
  else { currentAudio.play(); isPlaying = true; }
  updatePlayButton();
});

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
