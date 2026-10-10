const express = require('express');
const sqlite3 = require('sqlite3-offline-next').verbose();
const path = require('path');
const cors = require('cors');

const app = express();

// Middleware Setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const dbPath = isProduction ? ':memory:' : path.resolve(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('BetterLife DB Connection Error:', err.message);
  } else {
    console.log(`BetterLife Capital Engine Active (${isProduction ? 'Serverless' : 'Local File'}).`);
  }
});

// Initialize Schema with Self-Healing Column Validation
db.serialize(() => {
  // 1. Create Members Table
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
      basic_pay REAL DEFAULT 0,
      existing_deductions REAL DEFAULT 0,
      collateral_details TEXT,
      registered_by_teller TEXT DEFAULT 'Online Portal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Create Loans Table
  db.run(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER,
      loan_type TEXT NOT NULL,
      amount REAL NOT NULL,
      tenure_months INTEGER NOT NULL,
      monthly_repayment REAL NOT NULL,
      net_take_home_percentage REAL DEFAULT 40.0,
      status TEXT DEFAULT 'Pending Manager Approval',
      disbursement_method TEXT DEFAULT 'Airtel Money',
      processed_by_teller TEXT DEFAULT 'Online Portal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id)
    )
  `);

  // 3. Create Active Sessions Table
  db.run(`
    CREATE TABLE IF NOT EXISTS active_sessions (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      login_time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Automated Self-Healing Migrations
  db.all(`PRAGMA table_info(loans)`, [], (err, columns) => {
    if (!err && columns) {
      const colNames = columns.map(c => c.name);
      if (!colNames.includes('member_id')) {
        db.run(`ALTER TABLE loans ADD COLUMN member_id INTEGER`);
      }
      if (!colNames.includes('net_take_home_percentage')) {
        db.run(`ALTER TABLE loans ADD COLUMN net_take_home_percentage REAL DEFAULT 40.0`);
      }
      if (!colNames.includes('processed_by_teller')) {
        db.run(`ALTER TABLE loans ADD COLUMN processed_by_teller TEXT DEFAULT 'Online Portal'`);
      }
    }
  });

  db.all(`PRAGMA table_info(members)`, [], (err, columns) => {
    if (!err && columns) {
      const colNames = columns.map(c => c.name);
      if (!colNames.includes('registered_by_teller')) {
        db.run(`ALTER TABLE members ADD COLUMN registered_by_teller TEXT DEFAULT 'Online Portal'`);
      }
      if (!colNames.includes('man_number')) {
        db.run(`ALTER TABLE members ADD COLUMN man_number TEXT`);
      }
    }
  });
});

// Authentication Endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, error: 'Credentials required.' });

  const cleanUser = String(username).trim();
  const cleanPass = String(password).trim();

  // Master Branch Manager Login (Rochester / manga)
  if (cleanUser === 'Rochester' && cleanPass === 'manga') {
    const sessId = 'SESS-' + Date.now();
    db.run(`INSERT OR REPLACE INTO active_sessions (session_id, username, role) VALUES (?, ?, ?)`, [sessId, 'Rochester (Manager)', 'Manager']);
    return res.json({
      success: true,
      user: { username: 'Rochester', fullName: 'Branch Manager', role: 'admin', sessionId: sessId }
    });
  }

  // Client Check
  db.get('SELECT * FROM members WHERE phone = ? OR nrc_number = ?', [cleanUser, cleanUser], (err, member) => {
    if (err) return res.status(500).json({ success: false, error: 'Database error.' });
    if (member) {
      const sessId = 'SESS-' + Date.now();
      db.run(`INSERT OR REPLACE INTO active_sessions (session_id, username, role) VALUES (?, ?, ?)`, [sessId, member.full_name, 'Client']);
      return res.json({
        success: true,
        user: { id: member.id, fullName: member.full_name, clientType: member.client_type, manNumber: member.man_number, role: 'client', sessionId: sessId }
      });
    }
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  });
});

// Register New Client
app.post('/api/clients/register', (req, res) => {
  const { full_name, nrc_number, phone, email, client_type, employer_name, man_number, basic_pay, existing_deductions, collateral_details, teller_name } = req.body || {};

  if (!full_name || !nrc_number || !phone) {
    return res.status(400).json({ success: false, error: 'Missing required registration details.' });
  }

  const query = `INSERT INTO members (full_name, nrc_number, phone, email, client_type, employer_name, man_number, basic_pay, existing_deductions, collateral_details, registered_by_teller) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [full_name, nrc_number, phone, email, client_type, employer_name, man_number || 'N/A', basic_pay || 0, existing_deductions || 0, collateral_details || 'N/A', teller_name || 'Online Portal'], function(err) {
    if (err) {
      db.get('SELECT id FROM members WHERE nrc_number = ? OR phone = ?', [nrc_number, phone], (getErr, row) => {
        if (row) {
          return res.status(200).json({ success: true, member_id: row.id, message: 'Existing client profile retrieved.' });
        }
        return res.status(500).json({ success: false, error: 'Registration error.' });
      });
    } else {
      res.status(201).json({ success: true, member_id: this.lastID, message: 'Client registered successfully.' });
    }
  });
});

// Submit Loan Application
app.post('/api/loans/apply', (req, res) => {
  const { member_id, loan_type, amount, tenure_months, basic_pay, existing_deductions, disbursement_method, teller_name } = req.body || {};

  const principal = parseFloat(amount) || 0;
  const tenure = parseInt(tenure_months) || 1;
  const grossPay = parseFloat(basic_pay) || 1;
  const currentDeductions = parseFloat(existing_deductions) || 0;

  const rate = String(loan_type).includes('Civil Servant') ? 0.15 : 0.25;
  const totalInterest = principal * rate * (tenure / 12);
  const monthlyRepayment = (principal + totalInterest) / tenure;

  const totalNewDeductions = currentDeductions + monthlyRepayment;
  const netTakeHome = grossPay - totalNewDeductions;
  const netTakeHomePercentage = (netTakeHome / grossPay) * 100;

  if (netTakeHomePercentage < 40) {
    return res.status(400).json({
      success: false,
      error: `PAMEC 40% Rule Violation: Net take-home pay would drop to ${netTakeHomePercentage.toFixed(1)}%. Minimum allowed take-home is 40.0%.`
    });
  }

  const query = `INSERT INTO loans (member_id, loan_type, amount, tenure_months, monthly_repayment, net_take_home_percentage, disbursement_method, processed_by_teller) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [member_id || 1, loan_type, principal, tenure, monthlyRepayment, netTakeHomePercentage, disbursement_method || 'Airtel Money', teller_name || 'Online Portal'], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.status(201).json({
      success: true,
      loan_id: this.lastID,
      monthly_repayment: monthlyRepayment,
      net_take_home_percentage: netTakeHomePercentage,
      message: 'Loan application passed PAMEC validation and submitted for Manager approval.'
    });
  });
});

// Manager Command Center Endpoints
app.get('/api/admin/overview', (req, res) => {
  const query = `
    SELECT loans.*, members.full_name, members.nrc_number, members.client_type, members.man_number, members.registered_by_teller 
    FROM loans 
    LEFT JOIN members ON loans.member_id = members.id 
    ORDER BY loans.created_at DESC
  `;
  db.all(query, [], (err, loans) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all('SELECT * FROM active_sessions ORDER BY login_time DESC', [], (err, sessions) => {
      res.json({ loans: loans || [], sessions: sessions || [] });
    });
  });
});

app.post('/api/admin/loans/action', (req, res) => {
  const { loan_id, action } = req.body || {};
  db.run('UPDATE loans SET status = ? WHERE id = ?', [action, loan_id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: `Loan ${action} successfully.` });
  });
});

// SPA Route Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`BetterLife Capital server live at http://localhost:${PORT}`));
}

module.exports = app;