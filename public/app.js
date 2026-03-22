// PACE — Profile Analyze Curate Educate
// Frontend logic

const API = {
  health: '/api/health',
  upload: '/api/upload',
  teach:  '/api/teach'
};

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

const $ = id => document.getElementById(id);

const uploadBtn      = $('uploadBtn');
const fileInput      = $('fileInput');
const dropZone       = $('dropZone');
const sourceScroll   = $('sourceScroll');
const sourceContent  = $('sourceContent');
const fileBar        = $('fileBar');
const fileName       = $('fileName');
const fileWords      = $('fileWords');
const clearBtn       = $('clearBtn');
const teachRow       = $('teachRow');
const teachBtn       = $('teachBtn');
const emptyState     = $('emptyState');
const loadingState   = $('loadingState');
const loadingLabel   = $('loadingLabel');
const chunksContainer = $('chunksContainer');
const progressBar    = $('progressBar');
const chunkCounter   = $('chunkCounter');
const adaptBadge     = $('adaptBadge');
const adaptText      = $('adaptText');
const healthDot      = $('healthDot');

// ── Health ──
async function checkHealth() {
  try {
    const res = await fetch(API.health);
    const data = await res.json();
    if (data.status === 'ok') {
      healthDot.className = 'health-dot online';
      healthDot.title = 'PACE online';
    }
  } catch {
    healthDot.className = 'health-dot offline';
    healthDot.title = 'Server offline';
  }
}
checkHealth();

// ── Level ──
document.querySelectorAll('.level-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.level-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.level = btn.dataset.level;
  });
});

// ── Upload ──
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
    fileWords.textContent = `${(data.wordCount || 0).toLocaleString()} WORDS`;

    dropZone.style.display = 'none';
    sourceScroll.style.display = 'block';
    fileBar.style.display = 'flex';
    teachRow.style.display = 'block';
  } catch (err) {
    showError('UPLOAD FAILED: ' + err.message);
  }
}

// ── Clear ──
clearBtn.addEventListener('click', resetAll);

function resetAll() {
  state = { ...state, rawText: '', filename: '', chunks: [], currentIdx: 0, correct: 0, total: 0, adaptScore: 0 };
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
  teachBtn.textContent = 'PROFILING...';

  emptyState.style.display = 'none';
  chunksContainer.innerHTML = '';
  loadingState.classList.add('visible');
  loadingLabel.textContent = 'PROFILING';

  state.chunks = [];
  state.currentIdx = 0;
  state.correct = 0;
  state.total = 0;
  state.adaptScore = 0;

  try {
    loadingLabel.textContent = 'CURATING';
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
      showError('COULD NOT PARSE LESSON. TRY ANOTHER FILE.');
      return;
    }

    updateProgress();
    renderChunk(0);

  } catch (err) {
    loadingState.classList.remove('visible');
    showError('ERROR: ' + err.message);
  } finally {
    teachBtn.disabled = false;
    teachBtn.textContent = 'TEACH ME THIS';
  }
}

// ── Prompt ──
function buildPrompt(text, level) {
  const levelGuide = {
    beginner:     'Use simple language. Define all jargon. Use relatable analogies. Never assume prior knowledge.',
    intermediate: 'Assume basic familiarity. Clarify complex concepts. Be concise but thorough.',
    advanced:     'Be precise and technical. Skip basics. Focus on nuance, edge cases, and best practices.'
  }[level];

  return {
    system: `You are PACE — an expert adaptive educator. Transform raw technical content into a structured bite-sized lesson. Return ONLY valid JSON, no markdown fences, no preamble.

JSON structure:
{
  "chunks": [
    {
      "id": 1,
      "title": "SHORT TITLE",
      "body": "markdown content",
      "callouts": [{"title": "KEY CONCEPT", "text": "explanation"}],
      "highlights": [{"title": "REMEMBER", "text": "key takeaway"}],
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
- Split into 4-8 chunks. Each chunk = one focused idea.
- Level "${level}": ${levelGuide}
- body: clean markdown. Fenced code blocks for code.
- callouts: 1-2 per chunk.
- highlights: 1 per chunk. Most important takeaway.
- quiz: ONE multiple choice (4 options). correct = 0-indexed integer.
- Tone: direct, precise, no filler.`,
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
      <div class="callout-title">${c.title}</div>
      <p>${c.text}</p>
    </div>`).join('');

  const highlightsHTML = (chunk.highlights || []).map(h => `
    <div class="highlight-box">
      <div class="highlight-title">${h.title}</div>
      <p>${h.text}</p>
    </div>`).join('');

  let quizHTML = '';
  if (chunk.quiz) {
    state.total++;
    const qid = `quiz-${idx}`;
    quizHTML = `
      <div class="quiz-block" id="${qid}">
        <div class="quiz-label">CHECK UNDERSTANDING</div>
        <div class="quiz-q">${chunk.quiz.question}</div>
        <div class="quiz-options" id="${qid}-opts">
          ${chunk.quiz.options.map((opt, i) => `
            <button class="quiz-option"
              data-qidx="${i}"
              data-correct="${chunk.quiz.correct}"
              data-chunk="${idx}"
              data-expl="${encodeURIComponent(chunk.quiz.explanation || '')}">
              ${String.fromCharCode(65 + i)}. ${opt}
            </button>`).join('')}
        </div>
        <div class="quiz-feedback" id="${qid}-fb"></div>
      </div>`;
  }

  const isLast = idx === state.chunks.length - 1;

  el.innerHTML = `
    <div class="chunk-num">${String(idx + 1).padStart(2, '0')} / ${String(state.chunks.length).padStart(2, '0')}</div>
    <div class="chunk-title">${chunk.title || ''}</div>
    <div class="chunk-body">${bodyHTML}</div>
    ${calloutsHTML}
    ${highlightsHTML}
    ${quizHTML}
    <button class="continue-btn" id="cont-${idx}">${isLast ? 'COMPLETE' : 'CONTINUE'}</button>
  `;

  chunksContainer.appendChild(el);

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

  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// ── Quiz ──
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
  fb.textContent = isCorrect ? `CORRECT — ${expl}` : `INCORRECT — ${expl}`;
  fb.classList.add('show');

  if (isCorrect) { state.correct++; state.adaptScore++; }
  else { state.adaptScore--; }

  updateAdaptBadge();
  document.getElementById(`cont-${chunkIdx}`).classList.add('show');
}

// ── Progress ──
function updateProgress() {
  const pct = state.chunks.length > 0
    ? Math.round((state.currentIdx / state.chunks.length) * 100) : 0;
  progressBar.style.width = pct + '%';
  chunkCounter.textContent = state.chunks.length > 0
    ? `${String(state.currentIdx + 1).padStart(2,'0')} / ${String(state.chunks.length).padStart(2,'0')}` : '';
}

// ── Adapt badge ──
function updateAdaptBadge() {
  if (state.adaptScore >= 2) {
    adaptBadge.className = 'adapt-badge active';
    adaptText.textContent = 'ON A ROLL';
  } else if (state.adaptScore <= -2) {
    adaptBadge.className = 'adapt-badge';
    adaptText.textContent = 'KEEP GOING';
  } else {
    adaptBadge.className = 'adapt-badge active';
    adaptText.textContent = 'ADAPTING';
  }
}

// ── Done ──
function showDone() {
  progressBar.style.width = '100%';
  chunkCounter.textContent = 'COMPLETE';

  const pct = state.total > 0 ? Math.round((state.correct / state.total) * 100) : null;
  const hint = pct !== null && pct < 60
    ? `CONSIDER SWITCHING TO ${state.level === 'advanced' ? 'INTERMEDIATE' : 'BEGINNER'} LEVEL.`
    : pct === 100 ? `PERFECT SCORE. TRY ${state.level === 'beginner' ? 'INTERMEDIATE' : 'ADVANCED'} NEXT.`
    : null;

  const banner = document.createElement('div');
  banner.className = 'done-banner';
  banner.innerHTML = `
    <div class="done-title">COMPLETE</div>
    <div class="done-sub">${state.filename} — ${state.chunks.length} SECTIONS</div>
    ${pct !== null ? `<div class="score-display">${state.correct} / ${state.total} CORRECT · ${pct}%</div>` : ''}
    ${hint ? `<span class="done-hint">${hint}</span>` : ''}
  `;
  chunksContainer.appendChild(banner);
  setTimeout(() => banner.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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
    <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:1px;color:var(--gray-4);padding:20px 0;border-top:1px solid var(--gray-3);">
      ${msg}
    </div>`;
}