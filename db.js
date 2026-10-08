const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let dbInstance = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await dbInstance.run('PRAGMA foreign_keys = ON;');

  // Initialize Tables
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS borrowers (
      id TEXT PRIMARY KEY,
      borrowerType TEXT NOT NULL,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      nrcNumber TEXT NOT NULL,
      phoneNumber TEXT NOT NULL,
      manNumber TEXT DEFAULT 'N/A',
      employer TEXT DEFAULT 'N/A',
      netMonthlyPay REAL DEFAULT 0,
      collateralDescription TEXT DEFAULT 'N/A',
      collateralValue REAL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      borrowerId TEXT NOT NULL,
      borrowerName TEXT NOT NULL,
      borrowerType TEXT NOT NULL,
      principal REAL NOT NULL,
      interestRatePerMonth REAL NOT NULL,
      tenureMonths INTEGER NOT NULL,
      monthlyInstallment REAL NOT NULL,
      totalRepayment REAL NOT NULL,
      outstandingBalance REAL NOT NULL,
      status TEXT NOT NULL,
      statusReason TEXT NOT NULL,
      appliedAt TEXT NOT NULL,
      FOREIGN KEY (borrowerId) REFERENCES borrowers(id)
    );

    CREATE TABLE IF NOT EXISTS repayments (
      id TEXT PRIMARY KEY,
      loanId TEXT NOT NULL,
      borrowerName TEXT NOT NULL,
      amountPaid REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      referenceNumber TEXT DEFAULT 'N/A',
      paidAt TEXT NOT NULL,
      remainingBalance REAL NOT NULL,
      FOREIGN KEY (loanId) REFERENCES loans(id)
    );
  `);

  // Seed default borrower if table is empty
  const count = await dbInstance.get('SELECT COUNT(*) as cnt FROM borrowers');
  if (count.cnt === 0) {
    await dbInstance.run(`
      INSERT INTO borrowers (id, borrowerType, firstName, lastName, nrcNumber, phoneNumber, manNumber, employer, netMonthlyPay, createdAt)
      VALUES ('b1', 'CIVIL_SERVANT', 'Chanda', 'Mulenga', '294810/11/1', '+260977123456', 'PMEC-88392', 'Ministry of Education', 12500.00, ?)
    `, new Date().toISOString());
  }

  return dbInstance;
}

module.exports = getDb;