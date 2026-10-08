require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const getDb = require('./db');
const { checkPayrollAffordability, calculateFlatRateLoan } = require('./engine/loanEngine');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API ROUTES ---

// 1. Check PMEC Affordability
app.post('/api/v1/loans/check-affordability', (req, res) => {
  try {
    const { netMonthlyPay, existingDeductions, proposedInstallment } = req.body;
    const result = checkPayrollAffordability(netMonthlyPay, existingDeductions, proposedInstallment);
    res.json({ success: true, affordability: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 2. Calculate Loan Schedule
app.post('/api/v1/loans/calculate', (req, res) => {
  try {
    const { principal, interestRatePerMonth, tenureMonths } = req.body;
    const calculation = calculateFlatRateLoan(principal, interestRatePerMonth, tenureMonths);
    res.json({ success: true, loanCalculation: calculation });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 3. Get All Borrowers
app.get('/api/v1/borrowers', async (req, res) => {
  try {
    const db = await getDb();
    const borrowers = await db.all('SELECT * FROM borrowers ORDER BY createdAt DESC');
    res.json({ success: true, borrowers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Register Borrower
app.post('/api/v1/borrowers', async (req, res) => {
  try {
    const { borrowerType, firstName, lastName, nrcNumber, phoneNumber, manNumber, employer, netMonthlyPay, collateralDescription, collateralValue } = req.body;

    if (!firstName || !lastName || !nrcNumber || !phoneNumber) {
      return res.status(400).json({ success: false, message: "Missing required personal details." });
    }

    const db = await getDb();
    const count = await db.get('SELECT COUNT(*) as cnt FROM borrowers');
    const newId = `b${count.cnt + 1}`;
    const createdAt = new Date().toISOString();

    await db.run(`
      INSERT INTO borrowers (id, borrowerType, firstName, lastName, nrcNumber, phoneNumber, manNumber, employer, netMonthlyPay, collateralDescription, collateralValue, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      newId,
      borrowerType,
      firstName,
      lastName,
      nrcNumber,
      phoneNumber,
      manNumber || 'N/A',
      employer || 'N/A',
      netMonthlyPay ? parseFloat(netMonthlyPay) : 0,
      collateralDescription || 'N/A',
      collateralValue ? parseFloat(collateralValue) : 0,
      createdAt
    ]);

    const borrower = await db.get('SELECT * FROM borrowers WHERE id = ?', newId);
    res.status(201).json({ success: true, borrower });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Process & Issue Loan
app.post('/api/v1/loans/apply', async (req, res) => {
  try {
    const { borrowerId, principal, interestRatePerMonth, tenureMonths, existingDeductions } = req.body;

    const db = await getDb();
    const borrower = await db.get('SELECT * FROM borrowers WHERE id = ?', borrowerId);

    if (!borrower) {
      return res.status(404).json({ success: false, message: "Borrower not found." });
    }

    const calculation = calculateFlatRateLoan(principal, interestRatePerMonth, tenureMonths);
    let status = "APPROVED";
    let statusReason = "Passed risk check.";

    if (borrower.borrowerType === "CIVIL_SERVANT") {
      const affordability = checkPayrollAffordability(
        borrower.netMonthlyPay,
        existingDeductions || 0,
        calculation.monthlyInstallment
      );

      if (!affordability.isAffordable) {
        status = "REJECTED";
        statusReason = `Failed PMEC 40% rule. Max allowed: ZMW ${affordability.maxAllowableDeductions}`;
      }
    }

    const newLoanId = `LN-${Date.now().toString().slice(-5)}`;
    const appliedAt = new Date().toISOString();
    const borrowerName = `${borrower.firstName} ${borrower.lastName}`;

    await db.run(`
      INSERT INTO loans (id, borrowerId, borrowerName, borrowerType, principal, interestRatePerMonth, tenureMonths, monthlyInstallment, totalRepayment, outstandingBalance, status, statusReason, appliedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      newLoanId,
      borrower.id,
      borrowerName,
      borrower.borrowerType,
      parseFloat(principal),
      parseFloat(interestRatePerMonth),
      parseInt(tenureMonths),
      calculation.monthlyInstallment,
      calculation.totalRepayment,
      calculation.totalRepayment,
      status,
      statusReason,
      appliedAt
    ]);

    const loan = await db.get('SELECT * FROM loans WHERE id = ?', newLoanId);
    res.status(201).json({ success: true, loan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 6. Get All Loans
app.get('/api/v1/loans', async (req, res) => {
  try {
    const db = await getDb();
    const loans = await db.all('SELECT * FROM loans ORDER BY appliedAt DESC');
    res.json({ success: true, loans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Record Repayment
app.post('/api/v1/repayments', async (req, res) => {
  try {
    const { loanId, amountPaid, paymentMethod, referenceNumber } = req.body;

    const db = await getDb();
    const loan = await db.get('SELECT * FROM loans WHERE id = ?', loanId);

    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan not found." });
    }

    if (loan.status !== "APPROVED") {
      return res.status(400).json({ success: false, message: "Cannot accept payment for non-approved loan." });
    }

    const paid = parseFloat(amountPaid);
    if (isNaN(paid) || paid <= 0) {
      return res.status(400).json({ success: false, message: "Invalid payment amount." });
    }

    const newBalance = Math.max(0, +(loan.outstandingBalance - paid).toFixed(2));
    let newStatus = loan.status;
    let newStatusReason = loan.statusReason;

    if (newBalance === 0) {
      newStatus = "CLOSED";
      newStatusReason = "Loan fully repaid.";
    }

    await db.run('UPDATE loans SET outstandingBalance = ?, status = ?, statusReason = ? WHERE id = ?', [
      newBalance,
      newStatus,
      newStatusReason,
      loan.id
    ]);

    const repaymentId = `PAY-${Date.now().toString().slice(-5)}`;
    const paidAt = new Date().toISOString();

    await db.run(`
      INSERT INTO repayments (id, loanId, borrowerName, amountPaid, paymentMethod, referenceNumber, paidAt, remainingBalance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      repaymentId,
      loan.id,
      loan.borrowerName,
      paid,
      paymentMethod || "PMEC_DEDUCTION",
      referenceNumber || "N/A",
      paidAt,
      newBalance
    ]);

    const repayment = await db.get('SELECT * FROM repayments WHERE id = ?', repaymentId);
    const updatedLoan = await db.get('SELECT * FROM loans WHERE id = ?', loan.id);

    res.status(201).json({ success: true, repayment, loan: updatedLoan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Get Repayments History
app.get('/api/v1/repayments', async (req, res) => {
  try {
    const db = await getDb();
    const repayments = await db.all('SELECT * FROM repayments ORDER BY paidAt DESC');
    res.json({ success: true, repayments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Serve Frontend
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🏦 Better Life Zambia Limited System LIVE on http://localhost:${PORT}`);
  console.log(`===================================================`);
});