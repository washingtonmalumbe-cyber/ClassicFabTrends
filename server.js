const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

// ==========================================
// CSV / EXCEL HELPER UTILITY
// ==========================================
function appendCustomerToCSV(customerData) {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const csvFilePath = path.join(dataDir, 'customers.csv');
  const fileExists = fs.existsSync(csvFilePath);

  // Define CSV headers
  const headers = "ID,Full Name,NRC Number,Employee Number,Sector,Phone Number,Net Salary,Max Loan Eligibility,Created At\n";

  // Sanitize values to prevent CSV injection / breaking commas
  const sanitize = (text) => `"${String(text || '').replace(/"/g, '""')}"`;

  const row = [
    customerData.id || '',
    sanitize(customerData.full_name),
    sanitize(customerData.nrc_number),
    sanitize(customerData.employee_number),
    sanitize(customerData.sector),
    sanitize(customerData.phone_number),
    customerData.net_salary || 0,
    customerData.max_loan_eligibility || 0,
    customerData.created_at || new Date().toISOString()
  ].join(',') + '\n';

  try {
    if (!fileExists) {
      fs.writeFileSync(csvFilePath, headers + row, 'utf8');
    } else {
      fs.appendFileSync(csvFilePath, row, 'utf8');
    }
  } catch (err) {
    console.error('Non-critical CSV logging error:', err.message);
  }
}

// ==========================================
// FRONTDESK & BORROWER ROUTES
// ==========================================

// Register Borrower (Saves to SQLite + Appends to CSV)
app.post('/api/borrowers', (req, res) => {
  const { full_name, nrc_number, employee_number, sector, phone_number, net_salary, max_loan_eligibility } = req.body;

  if (!full_name || !nrc_number) {
    return res.status(400).json({ error: 'Full name and NRC number are required.' });
  }

  const sql = `INSERT INTO borrowers (full_name, nrc_number, employee_number, sector, phone_number, net_salary, max_loan_eligibility) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`;

  db.run(sql, [full_name, nrc_number, employee_number, sector, phone_number, net_salary, max_loan_eligibility], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const newCustomer = {
      id: this.lastID,
      full_name,
      nrc_number,
      employee_number,
      sector,
      phone_number,
      net_salary,
      max_loan_eligibility,
      created_at: new Date().toISOString()
    };

    // Auto-save to CSV asynchronously
    appendCustomerToCSV(newCustomer);

    res.json({ message: 'Customer registered successfully!', id: this.lastID });
  });
});

// Fetch all borrowers
app.get('/api/borrowers', (req, res) => {
  db.all(`SELECT * FROM borrowers ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// PMEC Affordability Calculation (40% Net Take-Home Limit)
app.post('/api/calculate-affordability', (req, res) => {
  const { net_salary, existing_deductions, proposed_installment } = req.body;

  const netSalaryNum = parseFloat(net_salary) || 0;
  const existingDeductionsNum = parseFloat(existing_deductions) || 0;
  const installmentNum = parseFloat(proposed_installment) || 0;

  const maxAllowableDeduction = netSalaryNum * 0.60; // 60% max total deductions
  const minRequiredTakeHome = netSalaryNum * 0.40;   // 40% statutory minimum retainable
  const newTotalDeduction = existingDeductionsNum + installmentNum;
  const projectedTakeHome = netSalaryNum - newTotalDeduction;

  const passed = projectedTakeHome >= minRequiredTakeHome;

  res.json({
    net_salary: netSalaryNum,
    existing_deductions: existingDeductionsNum,
    proposed_installment: installmentNum,
    projected_take_home: projectedTakeHome,
    min_required_take_home: minRequiredTakeHome,
    passed_pmec_rule: passed
  });
});

// Submit Loan Application (Enters Pending Status)
app.post('/api/loans', (req, res) => {
  const { borrower_id, principal_amount, duration_months, monthly_installment, interest_rate } = req.body;

  const sql = `INSERT INTO loans (borrower_id, principal_amount, duration_months, monthly_installment, interest_rate, status) 
               VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL')`;

  db.run(sql, [borrower_id, principal_amount, duration_months, monthly_installment, interest_rate || 15.0], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Loan application submitted for Admin approval.', loan_id: this.lastID });
  });
});

// Record Collection / Repayment
app.post('/api/collections', (req, res) => {
  const { loan_id, amount_paid, payment_method, receipt_number } = req.body;

  const sql = `INSERT INTO collections (loan_id, amount_paid, payment_method, receipt_number, payment_date) 
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;

  db.run(sql, [loan_id, amount_paid, payment_method, receipt_number], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    // Update Vault Balance upon collection
    db.run(`UPDATE vault SET balance = balance + ? WHERE id = 1`, [amount_paid]);

    res.json({ message: 'Collection logged successfully!', collection_id: this.lastID });
  });
});

// ==========================================
// ADMIN PORTAL & APPROVAL GATES
// ==========================================

// Master Admin Auth Gate
app.post('/api/admin/verify-passcode', (req, res) => {
  const { username, passcode } = req.body;

  db.get(`SELECT * FROM users WHERE username = ? AND role = 'ADMIN'`, [username], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ authenticated: false, message: 'Invalid Admin Credentials' });
    }

    const passwordIsValid = bcrypt.compareSync(passcode, user.password_hash);
    if (!passwordIsValid) {
      return res.status(401).json({ authenticated: false, message: 'Invalid Master Key' });
    }

    res.json({ authenticated: true, token: 'NAGATO_MASTER_ADMIN_SESSION' });
  });
});

// Get Vault & Liquidity Overview
app.get('/api/admin/liquidity', (req, res) => {
  db.get(`SELECT balance, bank_sync_status, last_synced FROM vault WHERE id = 1`, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { balance: 0.00, bank_sync_status: 'DISCONNECTED', last_synced: null });
  });
});

// Trigger Bank API Balance Sync Simulation
app.post('/api/admin/sync-bank-api', (req, res) => {
  const simulatedBankBalance = 250000.00 + (Math.random() * 5000);
  const now = new Date().toISOString();

  db.run(`UPDATE vault SET balance = ?, bank_sync_status = 'CONNECTED_LIVE', last_synced = ? WHERE id = 1`, 
    [simulatedBankBalance, now], 
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Live Bank API Sync Complete', new_balance: simulatedBankBalance, timestamp: now });
    }
  );
});

// Fetch Pending Loan Approvals
app.get('/api/admin/pending-loans', (req, res) => {
  const sql = `SELECT loans.*, borrowers.full_name, borrowers.nrc_number, borrowers.sector 
               FROM loans 
               JOIN borrowers ON loans.borrower_id = borrowers.id 
               WHERE loans.status = 'PENDING_APPROVAL'`;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Admin Approve / Reject Loan Gate
app.post('/api/admin/decision-loan', (req, res) => {
  const { loan_id, decision } = req.body; // 'APPROVED' or 'REJECTED'

  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid decision type.' });
  }

  db.get(`SELECT * FROM loans WHERE id = ?`, [loan_id], (err, loan) => {
    if (err || !loan) return res.status(404).json({ error: 'Loan not found.' });

    if (decision === 'APPROVED') {
      // Check liquidity reserve before disbursing
      db.get(`SELECT balance FROM vault WHERE id = 1`, [], (vErr, vault) => {
        if (vErr || vault.balance < loan.principal_amount) {
          return res.status(400).json({ error: 'Insufficient Vault Liquidity for Loan Disbursement.' });
        }

        // Deduct from vault balance and update status
        db.run(`UPDATE vault SET balance = balance - ? WHERE id = 1`, [loan.principal_amount]);
        db.run(`UPDATE loans SET status = 'APPROVED' WHERE id = ?`, [loan_id]);
        return res.json({ message: `Loan #${loan_id} Approved & Disbursed.` });
      });
    } else {
      db.run(`UPDATE loans SET status = 'REJECTED' WHERE id = ?`, [loan_id]);
      return res.json({ message: `Loan #${loan_id} Rejected.` });
    }
  });
});

// ==========================================
// REGULATORY EXPORT ENDPOINTS
// ==========================================

// Download Customer CSV Data File
app.get('/api/admin/export-customers-csv', (req, res) => {
  const csvFilePath = path.join(__dirname, 'data', 'customers.csv');

  if (!fs.existsSync(csvFilePath)) {
    return res.status(404).json({ error: 'No customer CSV file generated yet.' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="BetterLife_Customers.csv"');
  res.sendFile(csvFilePath);
});

// BOZ Prudential Return (.CSV)
app.get('/api/admin/regulatory/boz-return', (req, res) => {
  db.all(`SELECT * FROM loans`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let csvContent = "BOZ Return Code,Loan ID,Principal Amount,Status,Interest Rate\n";
    rows.forEach(r => {
      csvContent += `BOZ-2026,${r.id},${r.principal_amount},${r.status},${r.interest_rate}%\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="BOZ_Prudential_Return_2026.csv"');
    res.send(csvContent);
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Better Life Zambia System running on port ${PORT}`);
});