const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const AdmZip = require('adm-zip');
const PDFDocument = require('pdfkit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static('build'));

const upload = multer({ dest: path.join(__dirname, 'uploads') });

// In-memory storage (for demo; use database in production)
const users = [];
const analyses = [];

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Auth Endpoints
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existingUser = users.find(u => u.email === email);
    if (existingUser) return res.status(400).json({ error: 'User already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = { id: Date.now().toString(), email, name, password: hashedPassword };
    users.push(user);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.sendStatus(404);
  res.json({ id: user.id, email: user.email, name: user.name });
});

// File upload and analysis
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const uploadedFilePath = req.file.path;
    let files = [];
    if (req.file.originalname.endsWith('.zip')) {
      const zip = new AdmZip(uploadedFilePath);
      const zipEntries = zip.getEntries();
      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          files.push({ path: entry.entryName, content: entry.getData().toString('utf8') });
        }
      }
    } else {
      const content = fs.readFileSync(uploadedFilePath, 'utf8');
      files.push({ path: req.file.originalname, content });
    }
    fs.unlinkSync(uploadedFilePath);

    const analysisResults = await analyzeCode(files);
    
    const analysis = {
      id: Date.now().toString(),
      userId: req.user.id,
      files,
      results: analysisResults,
      createdAt: new Date().toISOString(),
    };
    analyses.push(analysis);

    res.json(analysis);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

app.get('/api/analyses', authenticateToken, (req, res) => {
  const userAnalyses = analyses.filter(a => a.userId === req.user.id);
  res.json(userAnalyses);
});

app.get('/api/analyses/:id', authenticateToken, (req, res) => {
  const analysis = analyses.find(a => a.id === req.params.id && a.userId === req.user.id);
  if (!analysis) return res.sendStatus(404);
  res.json(analysis);
});

// PDF Report Generation
app.get('/api/analyses/:id/report', authenticateToken, (req, res) => {
  const analysis = analyses.find(a => a.id === req.params.id && a.userId === req.user.id);
  if (!analysis) return res.sendStatus(404);

  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="analysis-report-${analysis.id}.pdf"`);

  doc.pipe(res);
  doc.fontSize(24).text('Code Analysis Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).text(`Date: ${new Date(analysis.createdAt).toLocaleString()}`);
  doc.moveDown();
  doc.text(`Total Files: ${analysis.files.length}`);
  doc.moveDown();
  doc.text(`Overall Score: ${analysis.results.overallScore}/100`);
  doc.moveDown();

  doc.fontSize(18).text('Files Analyzed:', { underline: true });
  analysis.files.forEach((file, index) => {
    doc.moveDown();
    doc.fontSize(14).text(`${index + 1}. ${file.path}`);
    const fileResult = analysis.results.fileResults.find(fr => fr.path === file.path);
    if (fileResult) {
      doc.fontSize(12).text(`Score: ${fileResult.score}/100`);
      if (fileResult.suggestions.length > 0) {
        doc.text('Suggestions:');
        fileResult.suggestions.forEach(suggestion => {
          doc.text(`- ${suggestion}`);
        });
      }
    }
  });

  doc.end();
});

// AI Analysis with Hugging Face (free API)
const analyzeCode = async (files) => {
  const fileResults = [];
  let totalScore = 0;
  
  for (const file of files) {
    let score = 50;
    let suggestions = [];

    const ext = path.extname(file.path).toLowerCase();
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
      // Basic JavaScript/TypeScript checks
      if (file.content.includes('console.log(')) {
        suggestions.push('Remove console.log statements for production');
        score -= 5;
      }
      if (file.content.includes('var ')) {
        suggestions.push('Use let/const instead of var');
        score -= 5;
      }
      if (file.content.length > 500) {
        suggestions.push('Consider breaking large files into smaller modules');
        score -= 10;
      }
    } else if (['.py'].includes(ext)) {
      if (file.content.includes('print(')) {
        suggestions.push('Remove print statements for production');
        score -= 5;
      }
    }

    // Try to use free AI for better analysis (optional)
    try {
      // This would use Hugging Face API - for demo we'll skip to keep it simple
      // const response = await axios.post('...');
    } catch (e) {
      // Fallback to basic analysis
    }

    score = Math.max(0, Math.min(100, score));
    totalScore += score;
    fileResults.push({ path: file.path, score, suggestions });
  }

  const overallScore = files.length > 0 ? Math.round(totalScore / files.length) : 0;
  return { overallScore, fileResults };
};

// Original create-zip endpoint
app.post('/create-zip', (req, res) => {
  const { files } = req.body;
  if (!files || !Array.isArray(files)) return res.status(400).send('Invalid input format.');

  const tempId = Date.now().toString() + '-' + Math.round(Math.random() * 10000);
  const tempDir = path.join(__dirname, 'output', `temp-${tempId}`);
  const zipFilePath = path.join(__dirname, 'output', `project-${tempId}.zip`);
  
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  
  const output = fs.createWriteStream(zipFilePath);
  const archive = archiver('zip');

  output.on('close', () => {
    res.download(zipFilePath, 'project.zip', (err) => {
      if (err) console.error(err);
      try {
        if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
      } catch (e) { console.error('Error cleaning up zip', e); }
      try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) { console.error('Error cleaning up temp dir', e); }
    });
  });

  archive.on('error', (err) => {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(output);

  try {
    files.forEach(file => {
      if (!file.path) return;
      const safeRelativePath = path.normalize(file.path).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(tempDir, safeRelativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content || '');
      archive.file(filePath, { name: safeRelativePath });
    });
    archive.finalize();
  } catch (err) {
    console.error('Error creating files:', err);
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
    if (!res.headersSent) res.status(500).send({ error: 'Failed to create files' });
  }
});

// Serve React app in production
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;

