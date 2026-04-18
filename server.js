const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const forge = require('node-forge');

const app = express();
// Usa a porta automática do Render ou a 3000 no seu computador
const PORT = process.env.PORT || 3000; 
const DB_PATH = path.join(__dirname, 'database.json');
const CERT_DIR = path.join(__dirname, 'certificados');

// 🔐 CREDENCIAIS DE ACESSO DO SISTEMA (Você pode mudar depois)
const EMAIL_ACESSO = 'admin@sempreassessoria.com.br';
const SENHA_ACESSO = 'sempre2026';

// Cria pasta /certificados se não existir
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

// ─── Multer (optional – only used when multer is installed) ──────────────────
let upload = null;
try {
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CERT_DIR),
    filename: (req, file, cb) => {
      const safe = decodeURIComponent(req.params.name || 'cliente')
        .replace(/[^a-zA-Z0-9À-ÿ\s\-_]/g, '_').trim();
      cb(null, `${safe}${path.extname(file.originalname).toLowerCase()}`);
    },
  });
  upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      ['.pfx', '.cer', '.p12', '.pem'].includes(ext) ? cb(null, true) : cb(new Error('Formato inválido.'));
    },
  });
} catch (_) {
  console.warn('⚠  multer não instalado — rota de certificado desabilitada.');
}

// ─── Middleware Base ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🛡️ O GUARDA-COSTAS (Middleware de Autenticação)
app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path === '/api/login') {
    return next();
  }
  const cookies = req.headers.cookie || '';
  const temCracha = cookies.includes('auth_sempre=autorizado');

  if (!temCracha && (req.path === '/' || req.path === '/index.html')) {
    return res.redirect('/login.html');
  }
  if (!temCracha && req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Acesso negado. Faça login.' });
  }
  next();
});

app.use(express.static(__dirname));

// ─── Rotas de Autenticação ───────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === EMAIL_ACESSO && password === SENHA_ACESSO) {
    res.cookie('auth_sempre', 'autorizado', { maxAge: 86400000, httpOnly: true });
    return res.json({ message: "Acesso Liberado" });
  } else {
    return res.status(401).json({ message: "E-mail ou senha inválidos." });
  }
});

// ─── Helpers do Banco de Dados ───────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  // 👇 AQUI ESTÁ A GAVETA DE HONORÁRIOS CRIADA 👇
  catch { return { clients: {}, passwords: [], honorarios: [] }; }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function emptyMeses(regime) {
  const meses = {};
  const base =
    regime === 'MEI'
      ? { fat: 0, das: 0, inss: 0, fgts: 0, folha: 0, prolabore: 0, status: 'Pendente' }
      : regime === 'Lucro Presumido'
        ? { servicos: 0, vendas: 0, total: 0, iss: 0, pis: 0, cofins: 0, inss: 0, fgts: 0, folha: 0, prolabore: 0, status: 'Pendente' }
        : { vendas: 0, servicos: 0, total: 0, das: 0, inss: 0, fgts: 0, folha: 0, prolabore: 0, status: 'Pendente' };
  MESES.forEach(m => (meses[m] = { ...base }));
  return meses;
}

// ─── Routes da API ───────────────────────────────────────────────────────────

app.get('/api/data', (_req, res) => res.json(readDB()));

app.post('/api/data', (req, res) => {
  try {
    const d = req.body;
    if (!d || typeof d !== 'object') return res.status(400).json({ error: 'Payload inválido.' });
    writeDB(d);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

app.post('/api/clients', (req, res) => {
  try {
    const db = readDB();
    const { nome, regime, tipo, cadastro } = req.body;
    if (!nome || !regime) return res.status(400).json({ error: 'Nome e regime são obrigatórios.' });
    if (db.clients[nome]) return res.status(409).json({ error: `Cliente "${nome}" já existe.` });

    db.clients[nome] = {
      regime,
      tipo: tipo || 'COMERCIO',
      meses: emptyMeses(regime),
      cadastro: {
        razaoSocial: '', cnpj: '', inscMunicipal: '', inscEstadual: '',
        responsavel: '', cpfResponsavel: '', sefaz: '', prefeitura: '',
        govbr: '', codigoSimples: '', certificado: '', ...(cadastro || {}),
      },
    };
    writeDB(db);
    res.json({ ok: true, client: db.clients[nome] });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

app.put('/api/clients/:name/cadastro', (req, res) => {
  try {
    const db = readDB();
    const name = decodeURIComponent(req.params.name);
    if (!db.clients[name]) return res.status(404).json({ error: `Cliente "${name}" não encontrado.` });
    if (!db.clients[name].cadastro) db.clients[name].cadastro = {};
    db.clients[name].cadastro = { ...db.clients[name].cadastro, ...req.body };
    writeDB(db);
    res.json({ ok: true, cadastro: db.clients[name].cadastro });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

app.delete('/api/clients/:name', (req, res) => {
  try {
    const db = readDB();
    const name = decodeURIComponent(req.params.name);
    if (!db.clients[name]) return res.status(404).json({ error: 'Cliente não encontrado.' });
    delete db.clients[name];
    writeDB(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

app.patch('/api/data/client/:name/month/:month', (req, res) => {
  try {
    const { name, month } = req.params;
    const db = readDB();
    const dName = decodeURIComponent(name);
    if (!db.clients[dName]) return res.status(404).json({ error: `Cliente "${dName}" não encontrado.` });
    if (!db.clients[dName].meses[month]) return res.status(404).json({ error: `Mês "${month}" não encontrado.` });
    db.clients[dName].meses[month] = { ...db.clients[dName].meses[month], ...req.body };
    writeDB(db);
    res.json({ ok: true, data: db.clients[dName].meses[month] });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

if (upload) {
  app.post('/api/clients/:name/certificado', upload.single('certificado'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Arquivo inválido ou não enviado.' });
      const name = decodeURIComponent(req.params.name);
      const db = readDB();
      if (!db.clients[name]) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (!db.clients[name].cadastro) db.clients[name].cadastro = {};
      db.clients[name].cadastro.certificado = req.file.filename;
      writeDB(db);
      res.json({ ok: true, filename: req.file.filename });
    } catch (e) { res.status(500).json({ error: e.message || 'Erro interno.' }); }
  });
} else {
  app.post('/api/clients/:name/certificado', (_req, res) =>
    res.status(503).json({ error: 'multer não instalado.' }));
}

app.get('/api/certificados/:filename', (req, res) => {
  const fp = path.join(CERT_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.download(fp);
});

app.get('/api/data/passwords', (_req, res) => res.json(readDB().passwords || []));

app.post('/api/data/passwords', (req, res) => {
  try {
    const db = readDB();
    if (!db.passwords) db.passwords = [];
    const entry = { id: Date.now(), ...req.body };
    db.passwords.push(entry);
    writeDB(db);
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

app.delete('/api/data/passwords/:id', (req, res) => {
  try {
    const db = readDB();
    const id = parseInt(req.params.id, 10);
    db.passwords = (db.passwords || []).filter(p => p.id !== id);
    writeDB(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro interno.' }); }
});

// 👇 NOVAS ROTAS DO FINANCEIRO (ASAAS) 👇
app.get('/api/honorarios', (_req, res) => res.json(readDB().honorarios || []));

app.post('/api/honorarios/importar', (req, res) => {
  try {
    const db = readDB();
    db.honorarios = req.body; 
    writeDB(db);
    res.json({ ok: true, total: req.body.length });
  } catch (e) { res.status(500).json({ error: 'Erro ao importar.' }); }
});

// CÓDIGO PARA LER O CERTIFICADO
const uploadMemoria = require('multer')({ storage: require('multer').memoryStorage() });
app.post('/ler-certificado', uploadMemoria.single('certificado'), async (req, res) => {
  try {
    const password = req.body.password;
    const p12Der = req.file.buffer.toString('binary');
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const cert = bags[forge.pki.oids.certBag][0].cert;
    const subject = cert.subject.getField('CN').value;

    const partes = subject.split(':');
    res.json({
      sucesso: true,
      razaoSocial: partes[0] || "",
      cnpj: subject.match(/\d{14}/) ? subject.match(/\d{14}/)[0] : ""
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: "Senha incorreta ou certificado inválido." });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('##############################################');
  console.log('🚀 SISTEMA SEMPRE ASSESSORIA: ONLINE COM SEGURANÇA');
  console.log(`🌍 ACESSE: http://localhost:${PORT}`);
  console.log('##############################################');
});