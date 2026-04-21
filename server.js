// server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));
const DB_PATH = process.env.DB_PATH || './dados.db';

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── DATABASE ───────────────────────────────────────────────
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Database error:', err);
  else console.log('✓ SQLite connected');
});

// Inicializar schema
function initDB() {
  db.serialize(() => {
    // Tabela Clientes
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      cnpj TEXT UNIQUE NOT NULL,
      regime TEXT NOT NULL,
      atividade TEXT NOT NULL,
      email TEXT,
      telefone TEXT,
      status TEXT DEFAULT 'Ativo',
      data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela Lançamentos
    db.run(`CREATE TABLE IF NOT EXISTS lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      data DATE NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL,
      categoria TEXT,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )`);

    // Tabela Senhas (Encrypted)
    db.run(`CREATE TABLE IF NOT EXISTS senhas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      cliente TEXT,
      login TEXT NOT NULL,
      senha TEXT NOT NULL,
      notas TEXT,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela Obrigações
    db.run(`CREATE TABLE IF NOT EXISTS obrigacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      data_vencimento DATE NOT NULL,
      status TEXT DEFAULT 'Pendente',
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )`);

    // Tabela Relatórios
    db.run(`CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      receita_bruta REAL,
      impostos REAL,
      deduções REAL,
      lucro_liquido REAL,
      data_geracao DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )`);

    console.log('✓ Database schema initialized');
  });
}

initDB();

// ── GOOGLE DRIVE INTEGRATION ───────────────────────────────
const driveService = {
  auth: null,
  drive: null,

  async init() {
    try {
      const keyFile = process.env.GOOGLE_CREDENTIALS || './credentials.json';
      if (!fs.existsSync(keyFile)) {
        console.warn('⚠ Google credentials not found. Drive integration disabled.');
        return false;
      }

      const credentials = JSON.parse(fs.readFileSync(keyFile, 'utf-8'));
      this.auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/drive']
      });

      this.drive = google.drive({ version: 'v3', auth: this.auth });
      console.log('✓ Google Drive service initialized');
      return true;
    } catch (e) {
      console.warn('⚠ Drive init error:', e.message);
      return false;
    }
  },

  async backupDatabase() {
    if (!this.drive) return false;
    try {
      const fileMetadata = {
        name: `backup-dados-${new Date().toISOString().split('T')[0]}.db`,
        parents: [process.env.DRIVE_FOLDER_ID || 'root'],
        mimeType: 'application/x-sqlite3'
      };

      const media = {
        mimeType: 'application/x-sqlite3',
        body: fs.createReadStream(DB_PATH)
      };

      const response = await this.drive.files.create({ requestBody: fileMetadata, media });
      console.log(`✓ Backup salvo: ${response.data.id}`);
      return response.data.id;
    } catch (e) {
      console.error('Backup error:', e.message);
      return false;
    }
  }
};

// ── ROTAS: CLIENTES ────────────────────────────────────────
app.get('/api/clientes', (req, res) => {
  db.all('SELECT * FROM clientes ORDER BY nome', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/clientes', (req, res) => {
  const { nome, cnpj, regime, atividade, email, telefone } = req.body;

  if (!nome || !cnpj || !regime) {
    return res.status(400).json({ error: 'Campos obrigatórios' });
  }

  db.run(
    'INSERT INTO clientes (nome, cnpj, regime, atividade, email, telefone) VALUES (?, ?, ?, ?, ?, ?)',
    [nome, cnpj, regime, atividade, email, telefone],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.status(201).json({ id: this.lastID, nome, cnpj, regime });
    }
  );
});

app.get('/api/clientes/:id', (req, res) => {
  db.get('SELECT * FROM clientes WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(row);
  });
});

app.put('/api/clientes/:id', (req, res) => {
  const { nome, regime, atividade, email, telefone } = req.body;
  db.run(
    'UPDATE clientes SET nome = ?, regime = ?, atividade = ?, email = ?, telefone = ? WHERE id = ?',
    [nome, regime, atividade, email, telefone, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Cliente atualizado' });
    }
  );
});

app.delete('/api/clientes/:id', (req, res) => {
  db.run('DELETE FROM clientes WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Cliente removido' });
  });
});

// ── ROTAS: LANÇAMENTOS ─────────────────────────────────────
app.get('/api/lancamentos', (req, res) => {
  const { cliente_id, mes, ano } = req.query;
  let query = 'SELECT * FROM lancamentos WHERE 1=1';
  const params = [];

  if (cliente_id) {
    query += ' AND cliente_id = ?';
    params.push(cliente_id);
  }
  if (mes && ano) {
    query += ` AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`;
    params.push(String(mes).padStart(2, '0'), ano);
  }

  query += ' ORDER BY data DESC';
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/lancamentos', (req, res) => {
  const { cliente_id, data, tipo, descricao, valor, categoria } = req.body;

  if (!cliente_id || !data || !tipo || !valor) {
    return res.status(400).json({ error: 'Campos obrigatórios' });
  }

  db.run(
    'INSERT INTO lancamentos (cliente_id, data, tipo, descricao, valor, categoria) VALUES (?, ?, ?, ?, ?, ?)',
    [cliente_id, data, tipo, descricao, valor, categoria],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.status(201).json({ id: this.lastID, cliente_id, data, tipo, valor });
    }
  );
});

app.delete('/api/lancamentos/:id', (req, res) => {
  db.run('DELETE FROM lancamentos WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Lançamento removido' });
  });
});

// ── ROTAS: RELATÓRIOS ──────────────────────────────────────
app.get('/api/relatorios/:cliente_id', (req, res) => {
  const { mes, ano } = req.query;
  const cliente_id = req.params.cliente_id;

  if (!mes || !ano) {
    return res.status(400).json({ error: 'Mês e ano obrigatórios' });
  }

  // Buscar lançamentos do mês
  db.all(
    `SELECT * FROM lancamentos 
     WHERE cliente_id = ? 
     AND strftime('%m', data) = ? 
     AND strftime('%Y', data) = ?`,
    [cliente_id, String(mes).padStart(2, '0'), ano],
    (err, lancamentos) => {
      if (err) return res.status(500).json({ error: err.message });

      const receita = lancamentos
        .filter(l => l.tipo !== 'Despesa')
        .reduce((a, l) => a + l.valor, 0);

      const despesas = lancamentos
        .filter(l => l.tipo === 'Despesa')
        .reduce((a, l) => a + l.valor, 0);

      // Calcular impostos (Simples Nacional simplificado)
      const impostos = receita * 0.08; // 8% base

      res.json({
        cliente_id,
        mes,
        ano,
        receita_bruta: receita,
        despesas,
        impostos,
        lucro_liquido: receita - despesas - impostos,
        lancamentos_count: lancamentos.length,
        data_geracao: new Date().toISOString()
      });
    }
  );
});

app.post('/api/relatorios', (req, res) => {
  const { cliente_id, mes, ano, receita_bruta, impostos, deducoes, lucro_liquido } = req.body;

  db.run(
    `INSERT INTO relatorios 
     (cliente_id, mes, ano, receita_bruta, impostos, deduções, lucro_liquido) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cliente_id, mes, ano, receita_bruta, impostos, deducoes, lucro_liquido],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    }
  );
});

// ── ROTAS: SENHAS (VAULT) ──────────────────────────────────
app.get('/api/senhas', (req, res) => {
  db.all(
    'SELECT id, titulo, cliente, login, notas FROM senhas ORDER BY data_criacao DESC',
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.post('/api/senhas', (req, res) => {
  const { titulo, cliente, login, senha, notas } = req.body;

  if (!titulo || !login || !senha) {
    return res.status(400).json({ error: 'Campos obrigatórios' });
  }

  // Encrypt senha (simples - usar crypto em produção)
  const senhaEncriptada = Buffer.from(senha).toString('base64');

  db.run(
    'INSERT INTO senhas (titulo, cliente, login, senha, notas) VALUES (?, ?, ?, ?, ?)',
    [titulo, cliente, login, senhaEncriptada, notas],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.status(201).json({ id: this.lastID, titulo, cliente });
    }
  );
});

app.delete('/api/senhas/:id', (req, res) => {
  db.run('DELETE FROM senhas WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Senha removida' });
  });
});

// ── ROTAS: DADOS GERAIS ────────────────────────────────────
app.get('/api/data', (req, res) => {
  const data = {};

  db.all('SELECT * FROM clientes', (err, clientes) => {
    if (err) return res.status(500).json({ error: err.message });
    data.clientes = clientes || [];

    db.all('SELECT * FROM lancamentos ORDER BY data DESC LIMIT 100', (err, lancamentos) => {
      if (err) return res.status(500).json({ error: err.message });
      data.lancamentos = lancamentos || [];

      db.all('SELECT id, titulo, cliente, login, notas FROM senhas', (err, senhas) => {
        if (err) return res.status(500).json({ error: err.message });
        data.passwords = senhas || [];
        res.json(data);
      });
    });
  });
});

// ── ROTAS: OBRIGAÇÕES ──────────────────────────────────────
app.get('/api/obrigacoes/:cliente_id', (req, res) => {
  db.all(
    'SELECT * FROM obrigacoes WHERE cliente_id = ? ORDER BY data_vencimento',
    [req.params.cliente_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.post('/api/obrigacoes', (req, res) => {
  const { cliente_id, tipo, descricao, data_vencimento } = req.body;

  db.run(
    'INSERT INTO obrigacoes (cliente_id, tipo, descricao, data_vencimento) VALUES (?, ?, ?, ?)',
    [cliente_id, tipo, descricao, data_vencimento],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    }
  );
});

// ── ROTAS: BACKUP ──────────────────────────────────────────
app.post('/api/backup', async (req, res) => {
  try {
    const fileId = await driveService.backupDatabase();
    if (fileId) {
      res.json({ success: true, fileId, message: 'Backup realizado com sucesso' });
    } else {
      res.status(500).json({ error: 'Falha ao fazer backup' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROTAS: HEALTH CHECK ────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: 'SQLite',
    drive: driveService.drive ? 'connected' : 'disconnected'
  });
});

// ── ROTAS: ESTATÍSTICAS ────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const stats = {};

  db.get('SELECT COUNT(*) as count FROM clientes', (err, row) => {
    if (!err) stats.totalClientes = row.count;

    db.get('SELECT SUM(valor) as total FROM lancamentos WHERE tipo != "Despesa"', (err, row) => {
      if (!err) stats.receitaTotal = row.total || 0;

      db.get('SELECT COUNT(*) as count FROM lancamentos', (err, row) => {
        if (!err) stats.totalLancamentos = row.count;
        res.json(stats);
      });
    });
  });
});

// ── INICIALIZAR SERVIDOR ───────────────────────────────────
app.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════╗
║  Sempre Assessoria Contábil - API v2.0         ║
║  Servidor rodando em http://localhost:${PORT}   ║
╚════════════════════════════════════════════════╝
  `);

  // Tentar conectar ao Google Drive
  await driveService.init();

  // Auto-backup diário
  setInterval(() => {
    driveService.backupDatabase();
  }, 24 * 60 * 60 * 1000);
});

// ── GRACEFUL SHUTDOWN ──────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n✓ Encerrando servidor...');
  db.close();
  process.exit(0);
});

module.exports = app;
