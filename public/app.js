// PACE — Profile Analyze Curate Educate
// v3 — LEARN / SOURCES tab layout

// ── Auth guard ──
const token = localStorage.getItem('pace_token');
const userRaw = localStorage.getItem('pace_user');
if (!token || !userRaw) window.location.href = '/login.html';

const currentUser = JSON.parse(userRaw || '{}');
const authHeaders = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

// ── PDF.js ──
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ──
let state = {
  view: 'learn',
  level: 'intermediate',
  activeDoc: null,
  timeBudget: null,
  sessionId: null,
  chunks: [],
  currentIdx: 0,
  correct: 0,
  total: 0,
  adaptScore: 0,
  sessionStartTime: null,
  documents: []
};

let pdfState = { doc: null, page: 1, total: 0, rendering: false };

// ── DOM ──
const $ = id => document.getElementById(id);

const tabLearn         = $('tabLearn');
const tabSources       = $('tabSources');
const viewLearn        = $('viewLearn');
const viewSources      = $('viewSources');
const sessionDocName   = $('sessionDocName');
const sessionControls  = $('sessionControls');
const timeCustom       = $('timeCustom');
const timeCustomRow    = $('timeCustomRow');
const timeCustomVal    = $('timeCustomVal');
const timeConfirmBtn   = $('timeConfirmBtn');
const teachBtn         = $('teachBtn');
const progressBar      = $('progressBar');
const chunkCounter     = $('chunkCounter');
const pdfEmpty         = $('pdfEmpty');
const pdfViewer        = $('pdfViewer');
const pdfCanvas        = $('pdfCanvas');
const pdfPageInfo      = $('pdfPageInfo');
const pdfPrev          = $('pdfPrev');
const pdfNext          = $('pdfNext');
const outputScroll     = $('outputScroll');
const emptyState       = $('emptyState');
const loadingState     = $('loadingState');
const loadingLabel     = $('loadingLabel');
const chunksContainer  = $('chunksContainer');
const adaptBadge       = $('adaptBadge');
const adaptText        = $('adaptText');
const healthDot        = $('healthDot');
const userEmail        = $('userEmail');
const logoutBtn        = $('logoutBtn');
const uploadBtn        = $('uploadBtn');
const fileInput        = $('fileInput');
const sourcesEmpty     = $('sourcesEmpty');
const sourcesList      = $('sourcesList');

// ── Init ──
userEmail.textContent = currentUser.email || '';
checkHealth();
loadDocuments();

// ── Health ──
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    healthDot.className = data.status === 'ok' ? 'health-dot online' : 'health-dot offline';
  } catch {
    healthDot.className = 'health-dot offline';
  }
}

// ── Logout ──
logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('pace_token');
  localStorage.removeItem('pace_user');
  window.location.href = '/login.html';
});

// ── View tabs ──
tabLearn.addEventListener('click', () => switchView('learn'));
tabSources.addEventListener('click', () => switchView('sources'));

function switchView(view) {
  state.view = view;
  if (view === 'learn') {
    tabLearn.classList.add('active');
    tabSources.classList.remove('active');
    viewLearn.style.display = 'flex';
    viewSources.style.display = 'none';
  } else {
    tabSources.classList.add('active');
    tabLearn.classList.remove('active');
    viewSources.style.display = 'flex';
    viewLearn.style.display = 'none';
    loadDocuments();
  }
}

// ── Level ──
document.querySelectorAll('.level-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.level-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.level = btn.dataset.level;
  });
});

// ── Load documents ──
async function loadDocuments() {
  try {
    const res = await fetch('/api/documents', { headers: authHeaders });
    if (res.status === 401) { logoutBtn.click(); return; }
    state.documents = await res.json();
    renderSourcesList();
  } catch (err) {
    console.error('Load docs failed:', err);
  }
}

// ── Render sources list ──
async function renderSourcesList() {
  sourcesList.innerHTML = '';

  if (state.documents.length === 0) {
    sourcesEmpty.style.display = 'flex';
    sourcesList.style.display = 'none';
    return;
  }

  sourcesEmpty.style.display = 'none';
  sourcesList.style.display = 'flex';

  for (const doc of state.documents) {
    let pct = 0;
    let remaining = doc.estimated_minutes || 0;
    try {
      const pRes = await fetch(`/api/documents/${doc.id}/progress`, { headers: authHeaders });
      const pData = await pRes.json();
      pct = pData.pct || 0;
      remaining = pData.minutesRemaining || 0;
    } catch {}

    const item = document.createElement('div');
    item.className = 'source-item';
    item.innerHTML = `
      <div class="source-icon">PDF</div>
      <div class="source-info">
        <div class="source-name">${doc.filename}</div>
        <div class="source-meta">${(doc.word_count || 0).toLocaleString()} WORDS · ~${doc.estimated_minutes} MIN TOTAL · ~${remaining} MIN REMAINING</div>
      </div>
      <div class="source-progress">
        <div class="source-progress-track">
          <div class="source-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="source-progress-label">${pct}% STUDIED</div>
      </div>
      <div class="source-actions">
        <button class="btn-study" data-id="${doc.id}">STUDY</button>
        <button class="btn-small-del" data-id="${doc.id}">DEL</button>
      </div>
    `;

    item.querySelector('.btn-study').addEventListener('click', () => selectDocumentForStudy(doc));
    item.querySelector('.btn-small-del').addEventListener('click', () => deleteDocument(doc.id));
    sourcesList.appendChild(item);
  }
}

// ── Select document for study ──
async function selectDocumentForStudy(doc) {
  state.activeDoc = doc;

  // Switch to learn view
  switchView('learn');

  // Update session bar
  sessionDocName.textContent = doc.filename;
  sessionControls.style.display = 'flex';
  teachBtn.style.display = 'none';

  // Load PDF viewer
  const isPDF = doc.filename.toLowerCase().endsWith('.pdf');
  if (isPDF) {
    pdfEmpty.style.display = 'none';
    pdfViewer.style.display = 'flex';
    loadPDFViewer(doc.id);
  } else {
    pdfEmpty.style.display = 'flex';
    pdfViewer.style.display = 'none';
  }
}

// ── PDF Viewer ──
async function loadPDFViewer(docId) {
  try {
    const res = await fetch(`/api/documents/${docId}/raw`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('No binary');
    const buffer = await res.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
    pdfState.doc = pdfDoc;
    pdfState.total = pdfDoc.numPages;
    pdfState.page = 1;
    await renderPDFPage(1);
  } catch (err) {
    console.error('PDF load failed:', err);
    pdfEmpty.style.display = 'flex';
    pdfViewer.style.display = 'none';
  }
}

async function renderPDFPage(pageNum) {
  if (!pdfState.doc || pdfState.rendering) return;
  pdfState.rendering = true;
  try {
    const page = await pdfState.doc.getPage(pageNum);
    const wrap = $('pdfCanvasWrap');
    const containerWidth = wrap.clientWidth - 32;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;

    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = '#f0ece4';
    ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    pdfState.page = pageNum;
    pdfPageInfo.textContent = `${pageNum} / ${pdfState.total}`;
    pdfPrev.disabled = pageNum <= 1;
    pdfNext.disabled = pageNum >= pdfState.total;
    wrap.scrollTop = 0;
  } catch (err) {
    console.error('Page render error:', err);
  } finally {
    pdfState.rendering = false;
  }
}

pdfPrev.addEventListener('click', () => { if (pdfState.page > 1) renderPDFPage(pdfState.page - 1); });
pdfNext.addEventListener('click', () => { if (pdfState.page < pdfState.total) renderPDFPage(pdfState.page + 1); });
window.addEventListener('resize', () => { if (pdfState.doc) renderPDFPage(pdfState.page); });

// ── Upload ──
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleUpload(e.target.files[0]); });

async function handleUpload(file) {
  const formData = new FormData();
  formData.append('file', file);
  uploadBtn.textContent = 'UPLOADING...';
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    await loadDocuments();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  } finally {
    uploadBtn.textContent = '+ UPLOAD FILE';
    fileInput.value = '';
  }
}

// ── Delete document ──
async function deleteDocument(id) {
  try {
    await fetch(`/api/documents/${id}`, { method: 'DELETE', headers: authHeaders });
    if (state.activeDoc?.id === id) {
      state.activeDoc = null;
      sessionDocName.textContent = 'NO SOURCE SELECTED — GO TO SOURCES';
      sessionControls.style.display = 'none';
      pdfEmpty.style.display = 'flex';
      pdfViewer.style.display = 'none';
    }
    await loadDocuments();
  } catch (err) {
    console.error('Delete failed:', err);
  }
}

// ── Time picker ──
document.querySelectorAll('.time-opt:not(.time-opt-custom)').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.timeBudget = parseInt(btn.dataset.minutes);
    timeCustomRow.style.display = 'none';
    teachBtn.style.display = 'inline-block';
  });
});

timeCustom.addEventListener('click', () => {
  document.querySelectorAll('.time-opt').forEach(b => b.classList.remove('active'));
  timeCustom.classList.add('active');
  timeCustomRow.style.display = 'flex';
  teachBtn.style.display = 'none';
});

timeConfirmBtn.addEventListener('click', () => {
  const val = parseInt(timeCustomVal.value);
  if (!val || val < 5) { alert('MINIMUM 5 MINUTES'); return; }
  state.timeBudget = val;
  teachBtn.style.display = 'inline-block';
});

// ── Teach ──
teachBtn.addEventListener('click', startLesson);

async function startLesson() {
  if (!state.activeDoc || !state.timeBudget) return;

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
  state.sessionStartTime = Date.now();

  try {
    const sessRes = await fetch('/api/sessions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ document_id: state.activeDoc.id, time_budget_minutes: state.timeBudget })
    });
    const sessData = await sessRes.json();
    state.sessionId = sessData.id;

    loadingLabel.textContent = 'CURATING';

    const docRes = await fetch(`/api/documents/${state.activeDoc.id}`, { headers: authHeaders });
    const docData = await docRes.json();

    const { system, user } = buildPrompt(docData.content, state.level, state.timeBudget);
    const res = await fetch('/api/teach', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ system, user })
    });
    const data = await res.json();
    if (data.error) { showError(data.error); return; }

    const parsed = safeParseJSON(data.result);
    state.chunks = parsed.chunks || [];
    loadingState.classList.remove('visible');

    if (state.chunks.length === 0) { showError('COULD NOT PARSE LESSON. TRY A SMALLER FILE.'); return; }

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
function buildPrompt(text, level, timeBudget) {
  const levelGuide = {
    beginner:     'Use simple language. Define all jargon. Use relatable analogies. Never assume prior knowledge.',
    intermediate: 'Assume basic familiarity. Clarify complex concepts. Be concise but thorough.',
    advanced:     'Be precise and technical. Skip basics. Focus on nuance, edge cases, and best practices.'
  }[level];
  const chunkCount = Math.max(2, Math.min(8, Math.round(timeBudget / 15)));
  return {
    system: `You are PACE — an expert adaptive educator. Transform content into a time-boxed lesson.
The user has ${timeBudget} minutes. Split into exactly ${chunkCount} chunks in sequential order.
Return ONLY valid JSON. No text before or after. No markdown fences. Start with { and end with }.
{
  "chunks": [
    {
      "id": 1,
      "title": "SHORT TITLE",
      "estimated_minutes": 10,
      "body": "markdown content",
      "callouts": [{"title": "KEY CONCEPT", "text": "explanation"}],
      "highlights": [{"title": "REMEMBER", "text": "key takeaway"}],
      "quiz": { "question": "...", "options": ["A","B","C","D"], "correct": 0, "explanation": "..." }
    }
  ]
}
Rules:
- ${chunkCount} chunks. Sequential order from beginning.
- estimated_minutes adds up to ~${timeBudget} total.
- Level "${level}": ${levelGuide}
- body: clean markdown. Fenced code blocks for code.
- callouts: 1-2 per chunk. highlights: 1 per chunk.
- quiz: 4 options. correct = 0-indexed integer.
- Keep body concise.`,
    user: `Create a ${timeBudget}-minute PACE lesson from this content:\n\n${text.slice(0, 7000)}`
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
    <div class="callout"><div class="callout-title">${c.title}</div><p>${c.text}</p></div>`).join('');
  const highlightsHTML = (chunk.highlights || []).map(h => `
    <div class="highlight-box"><div class="highlight-title">${h.title}</div><p>${h.text}</p></div>`).join('');

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
            <button class="quiz-option" data-qidx="${i}" data-correct="${chunk.quiz.correct}"
              data-chunk="${idx}" data-expl="${encodeURIComponent(chunk.quiz.explanation || '')}">
              ${String.fromCharCode(65 + i)}. ${opt}
            </button>`).join('')}
        </div>
        <div class="quiz-feedback" id="${qid}-fb"></div>
      </div>`;
  }

  const isLast = idx === state.chunks.length - 1;
  const estMin = chunk.estimated_minutes ? ` · ~${chunk.estimated_minutes} MIN` : '';

  el.innerHTML = `
    <div class="chunk-num">${String(idx+1).padStart(2,'0')} / ${String(state.chunks.length).padStart(2,'0')}${estMin}</div>
    <div class="chunk-title">${chunk.title || ''}</div>
    <div class="chunk-body">${bodyHTML}</div>
    ${calloutsHTML}${highlightsHTML}${quizHTML}
    <button class="continue-btn" id="cont-${idx}">${isLast ? 'COMPLETE' : 'CONTINUE'}</button>
  `;

  chunksContainer.appendChild(el);

  if (chunk.quiz) {
    el.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', function() { handleAnswer(this, idx); });
    });
  } else {
    el.querySelector(`#cont-${idx}`).classList.add('show');
  }

  el.querySelector(`#cont-${idx}`).addEventListener('click', () => {
    el.classList.add('done');
    saveProgress(idx, null);
    renderChunk(idx + 1);
    setTimeout(() => outputScroll.scrollTo({ top: outputScroll.scrollHeight, behavior: 'smooth' }), 120);
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

  saveProgress(chunkIdx, isCorrect);
  updateAdaptBadge();
  $(`cont-${chunkIdx}`).classList.add('show');
}

// ── Save progress ──
async function saveProgress(chunkIdx, quizCorrect) {
  if (!state.sessionId) return;
  const elapsed = state.sessionStartTime ? (Date.now() - state.sessionStartTime) / 60000 : 0;
  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        session_id: state.sessionId,
        chunk_index: chunkIdx,
        time_minutes: Math.round(elapsed * 10) / 10,
        quiz_correct: quizCorrect
      })
    });
  } catch (err) { console.error('Progress save failed:', err); }
}

// ── Progress ──
function updateProgress() {
  const pct = state.chunks.length > 0 ? Math.round((state.currentIdx / state.chunks.length) * 100) : 0;
  progressBar.style.width = pct + '%';
  chunkCounter.textContent = state.chunks.length > 0
    ? `${String(state.currentIdx+1).padStart(2,'0')} / ${String(state.chunks.length).padStart(2,'0')}` : '';
}

// ── Adapt badge ──
function updateAdaptBadge() {
  if (state.adaptScore >= 2) { adaptBadge.className = 'adapt-badge active'; adaptText.textContent = 'ON A ROLL'; }
  else if (state.adaptScore <= -2) { adaptBadge.className = 'adapt-badge'; adaptText.textContent = 'KEEP GOING'; }
  else { adaptBadge.className = 'adapt-badge active'; adaptText.textContent = 'ADAPTING'; }
}

// ── Done ──
async function showDone() {
  progressBar.style.width = '100%';
  chunkCounter.textContent = 'COMPLETE';

  if (state.sessionId) {
    try { await fetch(`/api/sessions/${state.sessionId}/complete`, { method: 'PATCH', headers: authHeaders }); }
    catch (err) { console.error(err); }
  }

  const pct = state.total > 0 ? Math.round((state.correct / state.total) * 100) : null;
  const elapsed = state.sessionStartTime ? Math.round((Date.now() - state.sessionStartTime) / 60000) : null;
  const hint = pct !== null && pct < 60
    ? `CONSIDER SWITCHING TO ${state.level === 'advanced' ? 'INTERMEDIATE' : 'BEGINNER'} LEVEL.`
    : pct === 100 ? `PERFECT SCORE. TRY ${state.level === 'beginner' ? 'INTERMEDIATE' : 'ADVANCED'} NEXT.` : null;

  const banner = document.createElement('div');
  banner.className = 'done-banner';
  banner.innerHTML = `
    <div class="done-title">COMPLETE</div>
    <div class="done-sub">${state.activeDoc?.filename || ''} · ${state.timeBudget} MIN SESSION</div>
    ${pct !== null ? `<div class="score-display">${state.correct} / ${state.total} CORRECT · ${pct}%${elapsed ? ` · ${elapsed} MIN` : ''}</div>` : ''}
    ${hint ? `<span class="done-hint">${hint}</span>` : ''}
  `;
  chunksContainer.appendChild(banner);
  setTimeout(() => banner.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// ── Helpers ──
function safeParseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return { chunks: [] };
  }
}

function showError(msg) {
  loadingState.classList.remove('visible');
  emptyState.style.display = 'none';
  chunksContainer.innerHTML = `
    <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:1px;color:var(--gray-4);padding:20px 0;border-top:1px solid var(--gray-3);">${msg}</div>`;
}