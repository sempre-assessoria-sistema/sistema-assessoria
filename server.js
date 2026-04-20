const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');
const CERT_DIR = path.join(__dirname, 'certificados');

// 🔐 CREDENCIAIS DE ACESSO
const EMAIL_ACESSO = 'admin@sempreassessoria.com.br';
const SENHA_ACESSO = 'sempre2026';

// 💰 CHAVE DE INTEGRAÇÃO ASAAS (AGORA SEGURA NA NUVEM!)
const ASAAS_API_KEY = process.env.ASAAS_API_KEY; 
const ASAAS_BASE_URL = "https://api.asaas.com/v3";

if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware Autenticação
app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path === '/api/login') return next();
  const cookies = req.headers.cookie || '';
  const temCracha = cookies.includes('auth_sempre=autorizado');
  if (!temCracha && (req.path === '/' || req.path === '/index.html')) return res.redirect('/login.html');
  if (!temCracha && req.path.startsWith('/api/')) return res.status(401).json({ error: 'Acesso negado.' });
  next();
});

app.use(express.static(__dirname));

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === EMAIL_ACESSO && password === SENHA_ACESSO) {
    res.cookie('auth_sempre', 'autorizado', { maxAge: 86400000, httpOnly: true });
    return res.json({ message: "Acesso Liberado" });
  }
  return res.status(401).json({ message: "Inválido" });
});

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { clients: {}, passwords: [], honorarios: [] }; }
}
function writeDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8'); }

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
function emptyMeses(regime) {
  const meses = {};
  const base = regime === 'MEI' ? { fat: 0, das: 0, inss: 0, fgts: 0, folha: 0, prolabore: 0, status: 'Pendente' } : { vendas: 0, servicos: 0, total: 0, das: 0, iss: 0, icms: 0, pis: 0, cofins: 0, irpj: 0, csll: 0, inss: 0, fgts: 0, folha: 0, prolabore: 0, status: 'Pendente' };
  MESES.forEach(m => (meses[m] = { ...base })); return meses;
}

app.get('/api/data', (_req, res) => res.json(readDB()));
app.post('/api/data', (req, res) => { writeDB(req.body); res.json({ ok: true }); });

app.post('/api/clients', (req, res) => {
  const db = readDB(); const { nome, regime, tipo, cadastro } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
  db.clients[nome] = { regime, tipo: tipo || 'COMERCIO', meses: emptyMeses(regime), cadastro: { razaoSocial: '', cnpj: '', historico2025: {}, ...(cadastro || {}) } };
  writeDB(db); res.json({ ok: true, client: db.clients[nome] });
});

app.put('/api/clients/:name/cadastro', (req, res) => {
  const db = readDB(); const name = decodeURIComponent(req.params.name);
  if (!db.clients[name]) return res.status(404).json({ error: 'Não encontrado' });
  db.clients[name].cadastro = { ...(db.clients[name].cadastro || {}), ...req.body };
  writeDB(db); res.json({ ok: true });
});

app.patch('/api/data/client/:name/month/:month', (req, res) => {
  const db = readDB(); const name = decodeURIComponent(req.params.name); const month = req.params.month;
  if (!db.clients[name]) return res.status(404).json({ error: 'Não encontrado' });
  db.clients[name].meses[month] = { ...db.clients[name].meses[month], ...req.body };
  writeDB(db); res.json({ ok: true });
});

app.get('/api/data/passwords', (_req, res) => res.json(readDB().passwords || []));
app.post('/api/data/passwords', (req, res) => {
  const db = readDB(); if (!db.passwords) db.passwords = [];
  const entry = { id: Date.now(), ...req.body }; db.passwords.push(entry);
  writeDB(db); res.json({ ok: true, entry });
});
app.delete('/api/data/passwords/:id', (req, res) => {
  const db = readDB(); db.passwords = (db.passwords || []).filter(p => p.id !== parseInt(req.params.id));
  writeDB(db); res.json({ ok: true });
});

// ASAAS API - LIGAÇÃO SEGURA
app.get('/api/asaas/clientes', async (req, res) => {
  try {
    if (!ASAAS_API_KEY) return res.status(400).json({ error: "Chave API do Asaas não configurada no Render." });
    const response = await fetch(`${ASAAS_BASE_URL}/customers?limit=100`, { method: 'GET', headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' } });
    res.json(await response.json());
  } catch (error) { res.status(500).json({ error: 'Falha no Asaas.' }); }
});

app.post('/api/asaas/cobrancas', async (req, res) => {
  try {
    if (!ASAAS_API_KEY) return res.status(400).json({ error: "Chave API do Asaas não configurada no Render." });
    const response = await fetch(`${ASAAS_BASE_URL}/payments`, { method: 'POST', headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    const data = await response.json();
    if (data.errors) return res.status(400).json({ error: data.errors[0].description });
    res.json({ ok: true, cobranca: data });
  } catch (error) { res.status(500).json({ error: 'Falha ao emitir.' }); }
});

app.post('/api/honorarios/importar', (req, res) => {
  const db = readDB(); db.honorarios = req.body; writeDB(db); res.json({ ok: true });
});

app.listen(PORT, () => { console.log(`🚀 ONLINE na porta ${PORT}`); });
