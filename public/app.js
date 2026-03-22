// ── PACE — Profile Analyze Curate Educate ──
// Frontend logic — talks to local Express server

const API = {
  health: '/api/health',
  upload: '/api/upload',
  teach:  '/api/teach'
};

// ── State ──
let state = {
  level: 'intermediate',
  rawText: '',
  filename: '',
  chunks: [],
  currentIdx: 0,
  correct: 0,
  total: 0,
  adaptScore: 0
};

// ── DOM refs ──
const $ = id => document.getElementById(id);
const uploadBtn   = $('uploadBtn');
const fileInput   = $('fileInput');
const dropZone    = $('dropZone');
const sourceScroll = $('sourceScroll');
const sourceContent = $('sourceContent');
const fileBar     = $('fileBar');
const fileName    = $('fileName');
const fileWords   = $('fileWords');
const clearBtn    = $('clearBtn');
const teachRow    = $('teachRow');
const teachBtn    = $('teachBtn');
const emptyState  = $('emptyState');
const loadingState = $('loadingState');
const loadingLabel = $('loadingLabel');
const chunksContainer = $('chunksContainer');
const progressBar = $('progressBar');
const chunkCounter = $('chunkCounter');
const adaptBadge  = $('adaptBadge');
const adaptText   = $('adaptText');
const healthDot   = $('healthDot');

// ── Health check ──
async function checkHealth() {
  try {
    const res = await fetch(API.health);
    const data = await res.json();
    if (data.status === 'ok') {
      healthDot.className = 'health-dot online';
      healthDot.title = 'PACE server online';
    }
  } catch {
    healthDot.className = 'health-dot offline';
    healthDot.title = 'Server offline — run: npm start';
  }
}
checkHealth();

// ── Level pills ──
document.querySelectorAll('.level-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.level-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.level = btn.dataset.level;
  });
});

// ── File upload ──
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(API.upload, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { showError(data.error); return; }

    state.rawText = data.text;
    state.filename = data.filename;

    sourceContent.textContent = data.text;
    fileName.textContent = data.filename;
    fileWords.textContent = `${data.wordCount.toLocaleString()} words`;

    dropZone.style.display = 'none';
    sourceScroll.style.display = 'block';
    fileBar.style.display = 'flex';
    teachRow.style.display = 'block';

  } catch (err) {
    showError('Upload failed: ' + err.message);
  }
}

// ── Clear ──
clearBtn.addEventListener('click', resetAll);

function resetAll() {
  state = { level: state.level, rawText: '', filename: '', chunks: [], currentIdx: 0, correct: 0, total: 0, adaptScore: 0 };
  sourceContent.textContent = '';
  dropZone.style.display = 'flex';
  sourceScroll.style.display = 'none';
  fileBar.style.display = 'none';
  teachRow.style.display = 'none';
  emptyState.style.display = 'flex';
  loadingState.classList.remove('visible');
  chunksContainer.innerHTML = '';
  progressBar.style.width = '0%';
  chunkCounter.textContent = '';
  fileInput.value = '';
  updateAdaptBadge();
}

// ── Teach ──
teachBtn.addEventListener('click', startLesson);

async function startLesson() {
  if (!state.rawText) return;

  teachBtn.disabled = true;
  teachBtn.innerHTML = '<span class="teach-icon">⏳</span> Profiling…';

  emptyState.style.display = 'none';
  chunksContainer.innerHTML = '';
  loadingState.classList.add('visible');
  loadingLabel.textContent = 'Profiling your material…';

  state.chunks = [];
  state.currentIdx = 0;
  state.correct = 0;
  state.total = 0;
  state.adaptScore = 0;

  try {
    loadingLabel.textContent = 'Curating your lesson…';
    const { system, user } = buildPrompt(state.rawText, state.level);
    const res = await fetch(API.teach, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, user })
    });
    const data = await res.json();
    if (data.error) { showError(data.error); return; }

    const parsed = safeParseJSON(data.result);
    state.chunks = parsed.chunks || [];

    loadingState.classList.remove('visible');

    if (state.chunks.length === 0) {
      showError('Could not parse lesson. Try a different file.');
      return;
    }

    updateProgress();
    renderChunk(0);

  } catch (err) {
    loadingState.classList.remove('visible');
    showError('Error: ' + err.message);
  } finally {
    teachBtn.disabled = false;
    teachBtn.innerHTML = '<span class="teach-icon">✦</span> Teach Me This';
  }
}

// ── Prompt builder ──
function buildPrompt(text, level) {
  const levelGuide = {
    beginner:     'Use simple language. Define all jargon. Use relatable analogies. Never assume prior knowledge.',
    intermediate: 'Assume basic familiarity. Clarify complex concepts. Be concise but thorough.',
    advanced:     'Be precise and technical. Skip basics. Focus on nuance, edge cases, and best practices.'
  }[level];

  return {
    system: `You are PACE — an expert adaptive educator. Transform raw technical content into a structured bite-sized lesson for the specified level. Return ONLY valid JSON, no markdown fences, no preamble.

JSON structure:
{
  "chunks": [
    {
      "id": 1,
      "title": "short title",
      "body": "markdown content",
      "callouts": [{"title": "Key Concept", "text": "explanation"}],
      "highlights": [{"title": "Remember", "text": "key takeaway"}],
      "quiz": {
        "question": "...",
        "options": ["A", "B", "C", "D"],
        "correct": 0,
        "explanation": "why this is correct"
      }
    }
  ]
}

Rules:
- Split into 4–8 chunks. Each chunk = one focused idea.
- Level "${level}": ${levelGuide}
- body: clean markdown. Use fenced code blocks for code.
- callouts: 1–2 per chunk. Key concepts, warnings, pro tips.
- highlights: 1 per chunk. Most important single takeaway.
- quiz: ONE multiple choice question (4 options). correct = 0-indexed integer.
- Tone: direct, warm, confident. Like a senior engineer teaching a colleague.`,
    user: `Transform this into an adaptive PACE lesson:\n\n${text.slice(0, 8000)}`
  };
}

// ── Render chunk ──
function renderChunk(idx) {
  if (idx >= state.chunks.length) { showDone(); return; }
  state.currentIdx = idx;
  updateProgress();

  const chunk = state.chunks[idx];
  const el = document.createElement('div');
  el.className = 'chunk';
  el.id = `chunk-${idx}`;

  const bodyHTML = marked.parse(chunk.body || '');

  const calloutsHTML = (chunk.callouts || []).map(c => `
    <div class="callout">
      <div class="callout-title">// ${c.title}</div>
      <p>${c.text}</p>
    </div>`).join('');

  const highlightsHTML = (chunk.highlights || []).map(h => `
    <div class="highlight-box">
      <div class="highlight-title">★ ${h.title}</div>
      <p>${h.text}</p>
    </div>`).join('');

  let quizHTML = '';
  if (chunk.quiz) {
    state.total++;
    const qid = `quiz-${idx}`;
    quizHTML = `
      <div class="quiz-block" id="${qid}">
        <div class="quiz-label">✦ Check Understanding</div>
        <div class="quiz-q">${chunk.quiz.question}</div>
        <div class="quiz-options" id="${qid}-opts">
          ${chunk.quiz.options.map((opt, i) => `
            <button class="quiz-option"
              data-qidx="${i}"
              data-correct="${chunk.quiz.correct}"
              data-chunk="${idx}"
              data-expl="${encodeURIComponent(chunk.quiz.explanation || '')}">
              <strong>${String.fromCharCode(65 + i)}.</strong> ${opt}
            </button>`).join('')}
        </div>
        <div class="quiz-feedback" id="${qid}-fb"></div>
      </div>`;
  }

  const isLast = idx === state.chunks.length - 1;

  el.innerHTML = `
    <div class="chunk-num">Part ${idx + 1} of ${state.chunks.length} &nbsp;·&nbsp; ${chunk.title || ''}</div>
    <div class="chunk-body">${bodyHTML}</div>
    ${calloutsHTML}
    ${highlightsHTML}
    ${quizHTML}
    <button class="continue-btn" id="cont-${idx}">${isLast ? '✦ Finish Lesson' : '→ Continue'}</button>
  `;

  chunksContainer.appendChild(el);

  // Quiz listeners
  if (chunk.quiz) {
    el.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', function () { handleAnswer(this, idx); });
    });
  } else {
    el.querySelector(`#cont-${idx}`).classList.add('show');
  }

  el.querySelector(`#cont-${idx}`).addEventListener('click', () => {
    el.classList.add('done');
    renderChunk(idx + 1);
    setTimeout(() => {
      $('outputScroll').scrollTo({ top: $('outputScroll').scrollHeight, behavior: 'smooth' });
    }, 120);
  });

  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ── Quiz answer ──
function handleAnswer(btn, chunkIdx) {
  const qid = `quiz-${chunkIdx}`;
  const chosen = parseInt(btn.dataset.qidx);
  const correct = parseInt(btn.dataset.correct);
  const isCorrect = chosen === correct;
  const expl = decodeURIComponent(btn.dataset.expl);

  document.querySelectorAll(`#${qid}-opts .quiz-option`).forEach(b => {
    b.disabled = true;
    if (parseInt(b.dataset.qidx) === correct) b.classList.add('correct');
  });
  if (!isCorrect) btn.classList.add('wrong');

  const fb = $(`${qid}-fb`);
  fb.textContent = isCorrect ? `✓  Correct — ${expl}` : `✗  Not quite — ${expl}`;
  fb.classList.add('show');

  if (isCorrect) { state.correct++; state.adaptScore++; }
  else { state.adaptScore--; }

  updateAdaptBadge();

  document.getElementById(`cont-${chunkIdx}`).classList.add('show');
}

// ── Progress ──
function updateProgress() {
  const pct = state.chunks.length > 0
    ? Math.round((state.currentIdx / state.chunks.length) * 100)
    : 0;
  progressBar.style.width = pct + '%';
  chunkCounter.textContent = state.chunks.length > 0
    ? `${Math.min(state.currentIdx + 1, state.chunks.length)} / ${state.chunks.length}`
    : '';
}

// ── Adapt badge ──
function updateAdaptBadge() {
  if (state.adaptScore >= 2) {
    adaptBadge.className = 'adapt-badge active';
    adaptText.textContent = 'On a Roll';
  } else if (state.adaptScore <= -2) {
    adaptBadge.className = 'adapt-badge';
    adaptText.textContent = 'Keep Going';
  } else {
    adaptBadge.className = 'adapt-badge active';
    adaptText.textContent = 'Adapting';
  }
}

// ── Done ──
function showDone() {
  progressBar.style.width = '100%';
  chunkCounter.textContent = 'Complete ✓';

  const pct = state.total > 0 ? Math.round((state.correct / state.total) * 100) : null;
  const hint = pct !== null && pct < 60
    ? `Consider switching to <strong>${state.level === 'advanced' ? 'Intermediate' : 'Beginner'}</strong> level for a deeper walkthrough.`
    : pct === 100
    ? `Perfect score. Consider pushing to <strong>${state.level === 'beginner' ? 'Intermediate' : 'Advanced'}</strong> next time.`
    : null;

  const banner = document.createElement('div');
  banner.className = 'done-banner';
  banner.innerHTML = `
    <div class="done-title">Lesson Complete</div>
    <div class="done-sub">You worked through all ${state.chunks.length} sections of ${state.filename}</div>
    ${pct !== null ? `<div class="score-display">${state.correct} / ${state.total} correct &nbsp;·&nbsp; ${pct}%</div>` : ''}
    ${hint ? `<div class="done-hint">${hint}</div>` : ''}
  `;
  chunksContainer.appendChild(banner);

  setTimeout(() => {
    banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ── Helpers ──
function safeParseJSON(text) {
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return { chunks: [] };
  }
}

function showError(msg) {
  loadingState.classList.remove('visible');
  emptyState.style.display = 'none';
  chunksContainer.innerHTML = `
    <div style="padding:24px;font-family:var(--font-mono);font-size:12px;color:var(--accent-red);border:1px dashed var(--accent-red);border-radius:4px;">
      ✗ ${msg}
    </div>`;
}