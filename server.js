const express = require('express');
const sqlite3 = require('sqlite3-offline-next').verbose();
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const dbPath = isProduction ? ':memory:' : path.resolve(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('BetterLife Zambia DB Error:', err.message);
  } else {
    console.log(`BetterLife Zambia DB Connected (${isProduction ? 'Serverless Mode' : 'Local File Mode'}).`);
  }
});

// Database Schema Setup
db.serialize(() => {
  // Members / Clients Table
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nrc_number TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      client_type TEXT CHECK(client_type IN ('Civil Servant', 'Private Sector')) NOT NULL,
      employer_name TEXT,
      man_number TEXT,
      collateral_details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Loans Table
  db.run(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER,
      loan_type TEXT NOT NULL,
      amount REAL NOT NULL,
      tenure_months INTEGER NOT NULL,
      monthly_repayment REAL NOT NULL,
      status TEXT DEFAULT 'Pending Approval',
      disbursement_method TEXT DEFAULT 'Airtel Money',
      account_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id)
    )
  `);

  // Active User Sessions Tracker
  db.run(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      ip_address TEXT,
      login_time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// System Health Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    organization: 'BetterLife Zambia Limited',
    status: 'online',
    system: 'Civil Servant & Private Sector Payroll/Collateral Loan Engine',
    timestamp: new Date().toISOString()
  });
});

// Authentication Endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  const cleanUser = String(username).trim();
  const cleanPass = String(password).trim();

  // Master Admin Authentication (Rochester / manga)
  if (cleanUser === 'Rochester' && cleanPass === 'manga') {
    const sessionId = 'SESS-' + Date.now();
    db.run(`INSERT OR REPLACE INTO active_sessions (session_id, username, role) VALUES (?, ?, ?)`, [sessionId, 'Rochester', 'Admin']);

    return res.status(200).json({
      success: true,
      message: 'BetterLife Administrative Access Granted.',
      user: {
        username: 'Rochester',
        fullName: 'System Administrator',
        role: 'admin',
        sessionId: sessionId,
        organization: 'BetterLife Zambia Limited'
      }
    });
  }

  // Client Authentication
  const query = 'SELECT * FROM members WHERE phone = ? OR nrc_number = ?';
  db.get(query, [cleanUser, cleanUser], (err, member) => {
    if (err) return res.status(500).json({ success: false, error: 'Database error during authentication.' });

    if (member) {
      const sessionId = 'SESS-' + Date.now();
      db.run(`INSERT OR REPLACE INTO active_sessions (session_id, username, role) VALUES (?, ?, ?)`, [sessionId, member.full_name, 'Client']);

      return res.status(200).json({
        success: true,
        message: 'Member Login Successful.',
        user: {
          id: member.id,
          username: member.full_name,
          fullName: member.full_name,
          clientType: member.client_type,
          nrc: member.nrc_number,
          phone: member.phone,
          role: 'client',
          sessionId: sessionId
        }
      });
    }

    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  });
});

// Register New Client
app.post('/api/clients/register', (req, res) => {
  const { full_name, nrc_number, phone, email, client_type, employer_name, man_number, collateral_details } = req.body || {};

  if (!full_name || !nrc_number || !phone || !client_type) {
    return res.status(400).json({ success: false, error: 'Missing required client parameters.' });
  }

  const query = `INSERT INTO members (full_name, nrc_number, phone, email, client_type, employer_name, man_number, collateral_details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [full_name, nrc_number, phone, email, client_type, employer_name, man_number, collateral_details], function (err) {
    if (err) {
      return res.status(500).json({ success: false, error: 'NRC or Phone already registered.' });
    }
    res.status(201).json({ success: true, member_id: this.lastID, message: 'Client registered successfully.' });
  });
});

// Submit Loan Application
app.post('/api/loans/apply', (req, res) => {
  const { member_id, loan_type, amount, tenure_months, monthly_repayment, disbursement_method, account_number } = req.body || {};

  if (!amount || !tenure_months || !monthly_repayment) {
    return res.status(400).json({ success: false, error: 'Missing loan calculation parameters.' });
  }

  const query = `INSERT INTO loans (member_id, loan_type, amount, tenure_months, monthly_repayment, disbursement_method, account_number) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [member_id || 1, loan_type, amount, tenure_months, monthly_repayment, disbursement_method, account_number], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.status(201).json({ success: true, loan_id: this.lastID, message: 'Loan application submitted for BetterLife approval.' });
  });
});

// Admin: Get All Transactions & Loans
app.get('/api/admin/loans', (req, res) => {
  const query = `
    SELECT loans.*, members.full_name, members.nrc_number, members.client_type, members.phone 
    FROM loans 
    LEFT JOIN members ON loans.member_id = members.id 
    ORDER BY loans.created_at DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

// Admin: Approve / Reject Loan
app.post('/api/admin/loans/action', (req, res) => {
  const { loan_id, action } = req.body || {}; // action: 'Approved' or 'Rejected'
  if (!loan_id || !action) return res.status(400).json({ success: false, error: 'Invalid parameters.' });

  db.run(`UPDATE loans SET status = ? WHERE id = ?`, [action, loan_id], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: `Loan ${action} successfully.` });
  });
});

// Admin: Active Sessions Management
app.get('/api/admin/sessions', (req, res) => {
  db.all(`SELECT * FROM active_sessions ORDER BY login_time DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(rows);
  });
});

app.post('/api/admin/sessions/logout', (req, res) => {
  const { session_id } = req.body || {};
  db.run(`DELETE FROM active_sessions WHERE session_id = ?`, [session_id], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: 'Session terminated remotely.' });
  });
});

// SPA Fallback Route
app.get('*', (req, res) => {
  const indexFile = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err) res.status(200).send('BetterLife Zambia Limited Engine Running.');
  });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`BetterLife Zambia server live at http://localhost:${PORT}`);
  });
}

module.exports = app;