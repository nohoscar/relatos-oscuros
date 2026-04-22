// ============================================
// Relatos Oscuros - App Frontend (Estático)
// ============================================

let STORIES = [];

const VOICE_LABELS = {
  narrador: { label: "Narrador", emoji: "📖" },
  hombre: { label: "Hombre", emoji: "🧔" },
  mujer: { label: "Mujer", emoji: "👩" },
  anciano: { label: "Anciano", emoji: "👴" },
  nina: { label: "Niña", emoji: "👧" },
};

let currentStory = null;
let currentFragmentIndex = 0;
let audioQueue = [];
let isPlaying = false;
let currentAudio = null;

// Hash MD5 simple para generar el nombre del archivo de audio
async function md5(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").substring(0, 32);
}

// Verifica si un archivo de audio existe
async function audioExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch { return false; }
}

// Checa si la historia tiene audios pregenerados
async function storyHasAudio(story) {
  if (!story.fragments || story.fragments.length === 0) return false;
  const f = story.fragments[0];
  if (f.audioFile) return true;
  return false;
}

// ============================================
// Render stories list
// ============================================
function renderStories() {
  const container = document.getElementById("stories-list");
  container.innerHTML = STORIES.map(story => {
    const preview = story.fragments[0].text.substring(0, 150) + "...";
    const voices = [...new Set(story.fragments.map(f => f.voice))];
    const charTags = voices.map(v => {
      const info = VOICE_LABELS[v] || { label: v, emoji: "🎭" };
      return `<span class="character-tag ${v}">${info.label}</span>`;
    }).join("");

    const hasAudio = story.fragments.some(f => f.audioFile);
    const audioIcon = hasAudio ? '<span class="audio-badge">🎧</span>' : '';

    return `
      <div class="story-card" onclick="openStory(${story.id})">
        <div class="story-card-content">
          <h2>${story.title} ${audioIcon}</h2>
          <div class="story-meta">${story.fragments.length} fragmentos · ${story.author}</div>
          <div class="story-preview">${preview}</div>
          <div class="characters">${charTags}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================
// Open a story
// ============================================
function openStory(id) {
  currentStory = STORIES.find(s => s.id === id);
  if (!currentStory) return;

  const container = document.getElementById("stories-list");
  const fragmentsHTML = currentStory.fragments.map((f, i) => {
    const info = VOICE_LABELS[f.voice] || { label: f.voice, emoji: "🎭" };
    const imgHTML = f.image
      ? `<div class="fragment-image"><img src="${f.image}" alt="" loading="lazy" /></div>`
      : '';
    return `
      <div class="fragment" id="fragment-${i}">
        ${imgHTML}
        <div class="fragment-voice">${info.label}</div>
        <div class="fragment-text">${f.text}</div>
      </div>
    `;
  }).join("");

  const coverHTML = currentStory.cover
    ? `<div class="story-expanded-cover" style="background-image: url('${currentStory.cover}')"></div>`
    : '';

  const hasAudio = currentStory.fragments.some(f => f.audioFile);
  const listenBtn = hasAudio
    ? `<button class="btn-listen" id="btn-listen" onclick="listenStory()">▶ Escuchar Relato</button>`
    : `<div class="no-audio">Audio próximamente...</div>`;

  container.innerHTML = `
    <div class="story-expanded">
      <button class="btn-back" onclick="goBack()">← Volver</button>
      ${coverHTML}
      <h2>${currentStory.title}</h2>
      <div class="story-author">${currentStory.author}</div>
      ${listenBtn}
      ${fragmentsHTML}
    </div>
  `;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goBack() {
  stopPlayback();
  currentStory = null;
  renderStories();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================
// Audio playback (desde archivos estáticos)
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
        if (!res.ok) throw new Error("Audio no encontrado: " + f.audioFile);
        const blob = await res.blob();
        audioQueue.push(blob);
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
    alert("Error cargando el audio.");
  }
}

function playFragment(index) {
  if (index >= audioQueue.length) {
    stopPlayback();
    return;
  }

  currentFragmentIndex = index;
  highlightFragment(index);
  updatePlayerInfo(index);

  const url = URL.createObjectURL(audioQueue[index]);
  if (currentAudio) {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src);
  }

  currentAudio = new Audio(url);
  isPlaying = true;
  updatePlayButton();

  currentAudio.addEventListener("timeupdate", () => {
    if (currentAudio.duration) {
      const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
      document.getElementById("progress-fill").style.width = pct + "%";
    }
  });

  currentAudio.addEventListener("ended", () => {
    playFragment(index + 1);
  });

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
  const info = VOICE_LABELS[frag.voice] || { label: frag.voice };
  document.getElementById("player-title").textContent = currentStory.title;
  document.getElementById("player-fragment").textContent =
    `${info.label}: ${frag.text.substring(0, 60)}...`;
}

function updatePlayButton() {
  document.getElementById("btn-play").textContent = isPlaying ? "⏸" : "▶";
}

function showPlayer() {
  document.getElementById("player").classList.remove("hidden");
}

function stopPlayback() {
  if (currentAudio) {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src);
    currentAudio = null;
  }
  isPlaying = false;
  document.getElementById("player").classList.add("hidden");
  document.querySelectorAll(".fragment").forEach(el => el.classList.remove("active"));

  const btn = document.getElementById("btn-listen");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "▶ Escuchar Relato";
  }
}

// ============================================
// Player controls
// ============================================
document.getElementById("btn-play").addEventListener("click", () => {
  if (!currentAudio) return;
  if (isPlaying) {
    currentAudio.pause();
    isPlaying = false;
  } else {
    currentAudio.play();
    isPlaying = true;
  }
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
