const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./database.sqlite');

db.serialize(async () => {
    console.log("Rebuilding database tables for Frontdesk, Vault & Admin Approvals...");

    // 1. Users Table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT CHECK(role IN ('operator', 'branch_manager', 'admin')) DEFAULT 'operator',
            manager_pin_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 2. Active Sessions Table
    db.run(`
        CREATE TABLE IF NOT EXISTS active_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pc_name TEXT NOT NULL,
            ip_address TEXT,
            login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'ACTIVE',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 3. Institutional Vault / Capital Table
    db.run(`
        CREATE TABLE IF NOT EXISTS institution_vault (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            capital_available DECIMAL(12,2) DEFAULT 450000.00,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Initialize Vault Balance if empty
    db.get(`SELECT COUNT(*) as count FROM institution_vault`, [], (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO institution_vault (capital_available) VALUES (450000.00)`);
        }
    });

    // 4. Loans Table
    db.run(`
        CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_name TEXT NOT NULL,
            nrc_number TEXT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            duration_months INTEGER NOT NULL,
            status TEXT CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED')) DEFAULT 'PENDING',
            created_by_user_id INTEGER NOT NULL,
            approved_by_user_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id),
            FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
        )
    `);

    // 5. Repayments Table
    db.run(`
        CREATE TABLE IF NOT EXISTS repayments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER NOT NULL,
            amount_paid DECIMAL(10,2) NOT NULL,
            payment_method TEXT NOT NULL,
            recorded_by_user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (loan_id) REFERENCES loans(id),
            FOREIGN KEY (recorded_by_user_id) REFERENCES users(id)
        )
    `);

    // ------------------------------------------------------------------
    // MASTER ACCOUNT CONFIGURATION: Nagato / Minato@86
    // ------------------------------------------------------------------
    const masterPasswordHash = await bcrypt.hash('Minato@86', 10);

    db.run(`
        INSERT INTO users (username, password_hash, full_name, role, manager_pin_hash)
        VALUES ('Nagato', ?, 'Master System Administrator', 'admin', ?)
        ON CONFLICT(username) DO UPDATE SET 
            password_hash = excluded.password_hash,
            manager_pin_hash = excluded.manager_pin_hash
    `, [masterPasswordHash, masterPasswordHash]);

    // Default Frontdesk Operator Account
    const pc1PasswordHash = await bcrypt.hash('123456', 10);
    db.run(`
        INSERT OR IGNORE INTO users (username, password_hash, full_name, role)
        VALUES ('frontdesk_pc1', ?, 'Front Desk Workstation 01', 'operator')
    `, [pc1PasswordHash]);

    console.log("Database initialized successfully!");
    console.log("Frontdesk & Admin Liquidity Suites: Fully Operational");
});