const express = require('express');
const sqlite3 = require('sqlite3-offline-next').verbose();
const path = require('path');
const cors = require('cors');

const app = express();

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database setup - Serverless memory fallback for Vercel + File mode for local
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const dbPath = isProduction ? ':memory:' : path.resolve(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('BetterLife Zambia DB Error:', err.message);
  } else {
    console.log(`BetterLife Zambia DB Connected (${isProduction ? 'Serverless Mode' : 'Local File Mode'}).`);
  }
});

// Database Schema Initialization
db.serialize(() => {
  // Members / Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nrc_number TEXT UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'client',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Loan Applications Table
  db.run(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER,
      amount REAL NOT NULL,
      tenure_months INTEGER NOT NULL,
      monthly_repayment REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      disbursement_method TEXT DEFAULT 'Airtel Money',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id)
    )
  `);
});

// System Health Check
app.get('/api/health', (req, res) => {
  res.json({
    organization: 'BetterLife Zambia Limited',
    status: 'online',
    system: 'Financial & Loan Services Portal',
    timestamp: new Date().toISOString()
  });
});

// Master Authentication Route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  const cleanUser = username.trim();
  const cleanPass = password.trim();

  // 1. Master Admin Login (Nagto / Minato@86)
  if (cleanUser === 'Nagto' && cleanPass === 'Minato@86') {
    return res.status(200).json({
      success: true,
      message: 'BetterLife Administrative Access Granted.',
      user: {
        username: 'Nagto',
        fullName: 'System Administrator',
        role: 'admin',
        organization: 'BetterLife Zambia Limited'
      }
    });
  }

  // 2. Member/Client Login Check
  const query = 'SELECT * FROM members WHERE phone = ? OR nrc_number = ?';
  db.get(query, [cleanUser, cleanUser], (err, member) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error during authentication.' });
    }

    if (member) {
      return res.status(200).json({
        success: true,
        message: 'Member Login Successful.',
        user: {
          username: member.full_name,
          fullName: member.full_name,
          phone: member.phone,
          role: member.role || 'client'
        }
      });
    }

    return res.status(401).json({ success: false, error: 'Invalid BetterLife credentials.' });
  });
});

// Loan Application Endpoint
app.post('/api/loans/apply', (req, res) => {
  const { member_id, amount, tenure_months, repayment, payment_method } = req.body;

  if (!amount || !tenure_months) {
    return res.status(400).json({ error: 'Loan amount and duration are required.' });
  }

  const query = `INSERT INTO loans (member_id, amount, tenure_months, monthly_repayment, disbursement_method) VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [member_id || 1, amount, tenure_months, repayment, payment_method || 'Airtel Money'], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({
      success: true,
      loan_id: this.lastID,
      message: 'Loan application submitted for BetterLife approval.'
    });
  });
});

// SPA Route Fallback
app.get('*', (req, res) => {
  const indexFile = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err) {
      res.status(200).send('BetterLife Zambia Limited API Service Active.');
    }
  });
});

// Server Initialization
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`BetterLife Zambia server live at http://localhost:${PORT}`);
  });
}

module.exports = app;