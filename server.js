const express = require('express');
const sqlite3 = require('sqlite3-offline-next').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON Parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Database File Setup
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database via sqlite3-offline-next.');
    }
});

// Initialize Database Tables
db.serialize(() => {
    // Users Table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT,
            email TEXT UNIQUE,
            phone TEXT,
            password TEXT,
            role TEXT DEFAULT 'client',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Loans Table
    db.run(`
        CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            duration INTEGER,
            interest_rate REAL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Repayments Table
    db.run(`
        CREATE TABLE IF NOT EXISTS repayments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER,
            amount_paid REAL,
            payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (loan_id) REFERENCES loans(id)
        )
    `);

    // Seed Default Admin User if empty
    db.get("SELECT * FROM users WHERE email = 'admin@classicfabtrends.com'", (err, row) => {
        if (!row) {
            db.run(`
                INSERT INTO users (full_name, email, phone, password, role)
                VALUES ('System Admin', 'admin@classicfabtrends.com', '0970000000', 'admin123', 'admin')
            `);
            console.log('Default admin account created.');
        }
    });
});

// ==========================================
// API ROUTES
// ==========================================

// Health Check Route for Render
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend service is running smoothly.' });
});

// Register User
app.post('/api/register', (req, res) => {
    const { full_name, email, phone, password } = req.body;
    
    if (!full_name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Please provide all required fields.' });
    }

    const query = `INSERT INTO users (full_name, email, phone, password) VALUES (?, ?, ?, ?)`;
    db.run(query, [full_name, email, phone, password], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(400).json({ success: false, message: 'Email address already registered.' });
            }
            return res.status(500).json({ success: false, message: 'Database error occurred.' });
        }
        res.json({ success: true, userId: this.lastID, message: 'Registration successful!' });
    });
});

// User Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    const query = `SELECT id, full_name, email, phone, role FROM users WHERE email = ? AND password = ?`;
    db.get(query, [email, password], (err, user) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (user) {
            res.json({ success: true, user, message: 'Login successful!' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }
    });
});

// Submit Loan Application
app.post('/api/loans/apply', (req, res) => {
    const { user_id, amount, duration, interest_rate } = req.body;

    if (!user_id || !amount || !duration) {
        return res.status(400).json({ success: false, message: 'Missing loan application details.' });
    }

    const query = `INSERT INTO loans (user_id, amount, duration, interest_rate) VALUES (?, ?, ?, ?)`;
    db.run(query, [user_id, amount, duration, interest_rate || 10], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Failed to record loan application.' });
        }
        res.json({ success: true, loanId: this.lastID, message: 'Loan application submitted successfully.' });
    });
});

// Get User Loans
app.get('/api/loans/user/:userId', (req, res) => {
    const userId = req.params.userId;
    const query = `SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC`;

    db.all(query, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error retrieving user loans.' });
        }
        res.json({ success: true, loans: rows });
    });
});

// Get All Loans (Admin)
app.get('/api/admin/loans', (req, res) => {
    const query = `
        SELECT loans.*, users.full_name, users.email, users.phone 
        FROM loans 
        JOIN users ON loans.user_id = users.id 
        ORDER BY loans.created_at DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error retrieving all loans.' });
        }
        res.json({ success: true, loans: rows });
    });
});

// Update Loan Status (Approve/Reject)
app.post('/api/admin/loans/status', (req, res) => {
    const { loan_id, status } = req.body;

    const query = `UPDATE loans SET status = ? WHERE id = ?`;
    db.run(query, [status, loan_id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Failed to update loan status.' });
        }
        res.json({ success: true, message: `Loan status updated to ${status}.` });
    });
});

// Record Repayment
app.post('/api/repayments/pay', (req, res) => {
    const { loan_id, amount_paid } = req.body;

    const query = `INSERT INTO repayments (loan_id, amount_paid) VALUES (?, ?)`;
    db.run(query, [loan_id, amount_paid], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error saving repayment record.' });
        }
        res.json({ success: true, repaymentId: this.lastID, message: 'Payment recorded successfully.' });
    });
});

// Catch-All Route to serve frontend index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server Listener
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});