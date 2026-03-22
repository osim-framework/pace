require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const PDFParser = require('pdf2json');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', name: 'PACE' });
});

function parsePDF(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1);
    parser.on('pdfParser_dataReady', () => {
      resolve(parser.getRawTextContent());
    });
    parser.on('pdfParser_dataError', err => reject(err));
    parser.parseBuffer(buffer);
  });
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let text = '';
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    if (ext === '.pdf') {
      text = await parsePDF(req.file.buffer);
    } else {
      text = req.file.buffer.toString('utf-8');
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    res.json({ filename: req.file.originalname, size: req.file.size, wordCount, text });

  } catch (err) {
    res.status(500).json({ error: 'Could not parse file: ' + err.message });
  }
});

app.post('/api/teach', async (req, res) => {
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
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message });
    const text = data.content?.map(b => b.text || '').join('') || '';
    res.json({ result: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎓 PACE is running at http://localhost:${PORT}\n`);
});
