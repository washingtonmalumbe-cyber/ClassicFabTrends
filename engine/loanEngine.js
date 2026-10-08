function checkPayrollAffordability(netMonthlyPay, existingDeductions = 0, proposedInstallment = 0) {
  const netPay = parseFloat(netMonthlyPay) || 0;
  const existing = parseFloat(existingDeductions) || 0;
  const proposed = parseFloat(proposedInstallment) || 0;

  // Maximum allowed total deductions is 40% of Net Monthly Pay (Zambian Rule)
  const maxAllowableDeductions = netPay * 0.40;
  const totalFutureDeductions = existing + proposed;
  const isAffordable = totalFutureDeductions <= maxAllowableDeductions;
  const availableCap = Math.max(0, maxAllowableDeductions - existing);

  return {
    isAffordable,
    netMonthlyPay: netPay.toFixed(2),
    maxAllowableDeductions: maxAllowableDeductions.toFixed(2),
    existingDeductions: existing.toFixed(2),
    proposedInstallment: proposed.toFixed(2),
    totalFutureDeductions: totalFutureDeductions.toFixed(2),
    availableCap: availableCap.toFixed(2)
  };
}

function calculateFlatRateLoan(principal, monthlyInterestRatePercent, tenureMonths, startDate = new Date()) {
  const p = parseFloat(principal);
  const r = parseFloat(monthlyInterestRatePercent) / 100;
  const n = parseInt(tenureMonths, 10);

  if (isNaN(p) || isNaN(r) || isNaN(n) || n <= 0) {
    throw new Error('Invalid loan parameters.');
  }

  const totalInterest = p * r * n;
  const totalRepayment = p + totalInterest;
  const monthlyInstallment = totalRepayment / n;
  const monthlyPrincipal = p / n;
  const monthlyInterest = totalInterest / n;

  const schedule = [];
  let currentDate = new Date(startDate);

  for (let i = 1; i <= n; i++) {
    currentDate.setMonth(currentDate.getMonth() + 1);
    schedule.push({
      installmentNumber: i,
      dueDate: currentDate.toISOString().split('T')[0],
      principalDue: parseFloat(monthlyPrincipal.toFixed(2)),
      interestDue: parseFloat(monthlyInterest.toFixed(2)),
      totalInstallment: parseFloat(monthlyInstallment.toFixed(2))
    });
  }

  return {
    principal: p.toFixed(2),
    monthlyInterestRatePercent,
    tenureMonths: n,
    totalInterest: totalInterest.toFixed(2),
    totalRepayment: totalRepayment.toFixed(2),
    monthlyInstallment: monthlyInstallment.toFixed(2),
    schedule
  };
}

module.exports = {
  checkPayrollAffordability,
  calculateFlatRateLoan
};