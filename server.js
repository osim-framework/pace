require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const PDFParser = require('pdf2json');
const { initDB, pool } = require('./db');
const { router: authRouter, requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth routes ──
app.use('/api/auth', authRouter);

// ── File upload ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      '.md', '.txt', '.js', '.ts', '.py', '.html',
      '.css', '.json', '.jsx', '.tsx', '.rs', '.go',
      '.java', '.cpp', '.c', '.yaml', '.yml', '.pdf'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not supported`));
  }
});

// ── Health ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', name: 'PACE' });
});

// ── PDF text extractor ──
function parsePDF(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
    parser.on('pdfParser_dataError', err => reject(err));
    parser.parseBuffer(buffer);
  });
}

// ── Upload + save to DB ──
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let text = '';
  const ext = path.extname(req.file.originalname).toLowerCase();
  const isPDF = ext === '.pdf';

  try {
    if (isPDF) {
      text = await parsePDF(req.file.buffer);
    } else {
      text = req.file.buffer.toString('utf-8');
    }

    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const estimatedMinutes = Math.ceil(wordCount / 200);

    // Store raw binary for PDFs, null for text files
    const rawData = isPDF ? req.file.buffer : null;

    const result = await pool.query(
      `INSERT INTO documents (user_id, filename, content, word_count, estimated_minutes, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, word_count, estimated_minutes, uploaded_at`,
      [req.user.userId, req.file.originalname, text, wordCount, estimatedMinutes, rawData]
    );

    res.json({
      ...result.rows[0],
      text,
      wordCount,
      estimatedMinutes
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Could not parse file: ' + err.message });
  }
});

// ── Get user documents ──
app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, word_count, estimated_minutes, uploaded_at
       FROM documents WHERE user_id = $1 ORDER BY uploaded_at DESC`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get single document (text only) ──
app.get('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, word_count, estimated_minutes, uploaded_at, content
       FROM documents WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Serve raw PDF binary for viewer ──
app.get('/api/documents/:id/raw', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT filename, raw_data FROM documents WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });

    const { filename, raw_data } = result.rows[0];

    if (!filename.toLowerCase().endsWith('.pdf') || !raw_data) {
      return res.status(404).json({ error: 'No PDF binary available' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(raw_data);

  } catch (err) {
    console.error('Raw PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Delete document ──
app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM documents WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Document progress ──
app.get('/api/documents/:id/progress', requireAuth, async (req, res) => {
  try {
    const doc = await pool.query(
      'SELECT estimated_minutes FROM documents WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (!doc.rows[0]) return res.status(404).json({ error: 'Not found' });

    const sessions = await pool.query(
      `SELECT SUM(chunks_completed) as done, SUM(chunks_total) as total
       FROM sessions WHERE document_id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );

    const done = parseInt(sessions.rows[0].done) || 0;
    const total = parseInt(sessions.rows[0].total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const estMinutes = doc.rows[0].estimated_minutes || 0;
    const minutesRemaining = Math.round(estMinutes * (1 - pct / 100));

    res.json({ pct, minutesRemaining, estMinutes, done, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create session ──
app.post('/api/sessions', requireAuth, async (req, res) => {
  const { document_id, time_budget_minutes } = req.body;
  if (!document_id || !time_budget_minutes) {
    return res.status(400).json({ error: 'document_id and time_budget_minutes required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO sessions (user_id, document_id, time_budget_minutes)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.userId, document_id, time_budget_minutes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get sessions for document ──
app.get('/api/sessions/:document_id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sessions WHERE user_id = $1 AND document_id = $2 ORDER BY created_at DESC`,
      [req.user.userId, req.params.document_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Save chunk progress ──
app.post('/api/progress', requireAuth, async (req, res) => {
  const { session_id, chunk_index, time_minutes, quiz_correct } = req.body;
  try {
    await pool.query(
      `INSERT INTO chunk_progress (session_id, chunk_index, time_minutes, quiz_correct)
       VALUES ($1, $2, $3, $4)`,
      [session_id, chunk_index, time_minutes, quiz_correct]
    );
    await pool.query(
      `UPDATE sessions SET
         chunks_completed = chunks_completed + 1,
         quiz_correct = quiz_correct + $1,
         quiz_total = quiz_total + $2,
         last_active = NOW()
       WHERE id = $3`,
      [quiz_correct ? 1 : 0, quiz_correct !== null ? 1 : 0, session_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Complete session ──
app.patch('/api/sessions/:id/complete', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE sessions SET completed = TRUE, last_active = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Teach (AI) ──
app.post('/api/teach', requireAuth, async (req, res) => {
  const { system, user } = req.body;
  if (!system || !user) return res.status(400).json({ error: 'Missing prompts' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not set' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: system + '\n\nCRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown. No code fences. Start with { and end with }.',
        messages: [{ role: 'user', content: user }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    let raw = data.content?.map(b => b.text || '').join('') || '';
    console.log('AI raw length:', raw.length);

    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) raw = jsonMatch[0];

    try {
      JSON.parse(raw);
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr.message);
      console.error('Raw sample:', raw.slice(0, 500));
      return res.status(500).json({ error: 'AI returned invalid JSON. Try a smaller file or different level.' });
    }

    res.json({ result: raw });

  } catch (err) {
    console.error('Teach error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎓 PACE is running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});