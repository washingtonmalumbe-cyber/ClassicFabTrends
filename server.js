const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists for CSV exports
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const csvFilePath = path.join(dataDir, 'customers.csv');

// Initialize CSV header if file doesn't exist
if (!fs.existsSync(csvFilePath)) {
  const headers = 'ID,Full Name,NRC/ID,Phone,Gross Salary,Net Salary,Affordability Limit,Status,Created At\n';
  fs.writeFileSync(csvFilePath, headers, 'utf8');
}

// Database Connection
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Database Initialization & Automatic Admin Seeding
db.serialize(() => {
  // Users Table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT
  )`);

  // Customers Table
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    nrc TEXT UNIQUE NOT NULL,
    phone TEXT,
    gross_salary REAL,
    net_salary REAL,
    affordability_limit REAL,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed Default Admin User if missing (username: admin, password: admin123)
  const defaultAdminUser = 'admin';
  const defaultAdminPass = 'admin123';
  const hash = bcrypt.hashSync(defaultAdminPass, 10);

  db.run(
    `INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'ADMIN')`,
    [defaultAdminUser, hash],
    (err) => {
      if (err) console.error('Error seeding admin user:', err.message);
      else console.log('Admin account ready (admin / admin123).');
    }
  );
});

// Non-blocking CSV logger
function appendCustomerToCSV(customer) {
  setImmediate(() => {
    const row = `"${customer.id}","${customer.full_name}","${customer.nrc}","${customer.phone}","${customer.gross_salary}","${customer.net_salary}","${customer.affordability_limit}","${customer.status}","${new Date().toISOString()}"\n`;
    fs.appendFile(csvFilePath, row, 'utf8', (err) => {
      if (err) console.error('Failed to append customer to CSV:', err);
    });
  });
}

// --- API ENDPOINTS ---

// 1. Admin Login Verification
app.post('/api/admin/verify-passcode', (req, res) => {
  const { username, passcode } = req.body;

  if (!username || !passcode) {
    return res.status(400).json({ authenticated: false, message: 'Username and passcode are required.' });
  }

  db.get(`SELECT * FROM users WHERE username = ? AND role = 'ADMIN'`, [username], (err, user) => {
    if (err) {
      return res.status(500).json({ authenticated: false, message: 'Database query error.' });
    }
    if (!user) {
      return res.status(401).json({ authenticated: false, message: 'Invalid administrative credentials.' });
    }

    const isValid = bcrypt.compareSync(passcode, user.password_hash);
    if (isValid) {
      return res.json({ authenticated: true, token: 'session_token_' + user.id, username: user.username });
    } else {
      return res.status(401).json({ authenticated: false, message: 'Invalid administrative credentials.' });
    }
  });
});

// 2. Borrower Registration & Affordability Assessment
app.post('/api/customers/register', (req, res) => {
  const { full_name, nrc, phone, gross_salary, net_salary } = req.body;

  if (!full_name || !nrc || !gross_salary || !net_salary) {
    return res.status(400).json({ error: 'Missing required customer details.' });
  }

  // Calculate 40% Affordability Cap according to microfinance guidance
  const affordability_limit = parseFloat(net_salary) * 0.40;

  const sql = `INSERT INTO customers (full_name, nrc, phone, gross_salary, net_salary, affordability_limit) VALUES (?, ?, ?, ?, ?, ?)`;
  const params = [full_name, nrc, phone, gross_salary, net_salary, affordability_limit];

  db.run(sql, function (err) {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const newCustomer = {
      id: this.lastID,
      full_name,
      nrc,
      phone,
      gross_salary,
      net_salary,
      affordability_limit,
      status: 'PENDING'
    };

    // Asynchronously log to CSV without blocking main HTTP response
    appendCustomerToCSV(newCustomer);

    res.json({ message: 'Customer registered successfully', customer: newCustomer });
  });
});

// 3. Export Customer CSV / Excel Download
app.get('/api/admin/export-customers-csv', (req, res) => {
  if (fs.existsSync(csvFilePath)) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="better_life_customers.csv"');
    return res.sendFile(csvFilePath);
  }
  res.status(404).json({ error: 'CSV data log file not found.' });
});

// 4. Bank of Zambia (BOZ) Prudential Return Export Endpoint
app.get('/api/admin/regulatory/boz-return', (req, res) => {
  db.all(`SELECT * FROM customers`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let bozCsv = 'Customer ID,Full Name,NRC,Net Salary,Affordability Cap,Status,Registration Date\n';
    rows.forEach((r) => {
      bozCsv += `"${r.id}","${r.full_name}","${r.nrc}","${r.net_salary}","${r.affordability_limit}","${r.status}","${r.created_at}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="BOZ_Prudential_Return.csv"');
    res.send(bozCsv);
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});