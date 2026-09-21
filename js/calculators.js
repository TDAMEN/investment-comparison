import { getLoanPrincipal, getPurchasePrice, getTotalClosingCosts, getTotalAnnualCosts } from './models.js';

function monthlyRate(annualRate) {
  return annualRate / 100 / 12;
}

function mortgagePayment(principal, annualRate, termMonths) {
  if (principal <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return principal * (r * factor) / (factor - 1);
}

/**
 * Netto maandlast appartement in maand 1 (zelfde logica als simulateApartment):
 * huur − leningaflossing − (jaarlijkse kosten / 12) − aangepaste kosten in die maand.
 * Positief bedrag = wat je zelf per maand bijlegt (ETF-inleg).
 */
export function getApartmentMonthlyOutflowBreakdown(config) {
  const { global, apartment } = config;
  const loanPrincipal = getLoanPrincipal(apartment);
  const loanTermMonths = global.horizonYears * 12;
  const mortgagePaymentMonthly = mortgagePayment(loanPrincipal, apartment.interestRate, loanTermMonths);

  const monthlyRent = apartment.monthlyRent;
  const monthlyAnnualCosts = getTotalAnnualCosts(apartment) / 12;
  const monthlyCustomCosts = getCustomCostForMonth(apartment.customCosts, 1);

  const mortgageOutflow = loanPrincipal > 0 && loanTermMonths > 0 ? mortgagePaymentMonthly : 0;
  const netCashflow = monthlyRent - mortgageOutflow - monthlyAnnualCosts - monthlyCustomCosts;
  const netMonthlyOutflow = Math.max(0, -netCashflow);

  return {
    mortgageOutflow,
    monthlyRent,
    monthlyAnnualCosts,
    monthlyCustomCosts,
    netCashflow,
    netMonthlyOutflow,
  };
}

export function getApartmentNetMonthlyOutflow(config) {
  return getApartmentMonthlyOutflowBreakdown(config).netMonthlyOutflow;
}

function isCustomCostDue(cost, monthIndex) {
  const year = Math.floor(monthIndex / 12);
  if (year < cost.startYear) return false;

  if (cost.frequency === 'monthly') return true;
  if (cost.frequency === 'yearly') return monthIndex % 12 === 0 && monthIndex > 0;
  if (cost.frequency === 'interval') {
    const intervalYears = Math.max(1, cost.intervalYears);
    const yearsSinceStart = year - cost.startYear;
    return monthIndex % 12 === 0 && monthIndex > 0 && yearsSinceStart >= 0 && yearsSinceStart % intervalYears === 0;
  }
  return false;
}

function getCustomCostForMonth(customCosts, monthIndex) {
  return customCosts.reduce((sum, cost) => {
    if (isCustomCostDue(cost, monthIndex)) {
      if (cost.frequency === 'monthly') return sum + cost.amount;
      return sum + cost.amount;
    }
    return sum;
  }, 0);
}

function deflate(value, inflationRate, years) {
  const factor = Math.pow(1 + inflationRate / 100, years);
  return value / factor;
}

export function simulateApartment(config) {
  const { global, apartment } = config;
  const horizonMonths = global.horizonYears * 12;
  const loanPrincipal = getLoanPrincipal(apartment);
  const loanTermMonths = global.horizonYears * 12;
  const payment = mortgagePayment(loanPrincipal, apartment.interestRate, loanTermMonths);

  let propertyValue = getPurchasePrice(apartment);
  let loanBalance = loanPrincipal;
  let cashSurplus = 0;
  let cashInvested = apartment.downPayment + getTotalClosingCosts(apartment);
  let realCashInvested = cashInvested / Math.pow(1 + global.inflationRate / 100, 0);

  const monthlySnapshots = [];
  const yearlySnapshots = [];

  for (let m = 0; m <= horizonMonths; m++) {
    const year = Math.floor(m / 12);

    if (m > 0) {
      // Property appreciation (annual, at start of each year)
      if (m % 12 === 0) {
        propertyValue *= 1 + apartment.appreciationRate / 100;
      }

      // Rent income (grown annually)
      const rentGrowthFactor = Math.pow(1 + apartment.rentGrowthRate / 100, year);
      const monthlyRent = apartment.monthlyRent * rentGrowthFactor;

      // Built-in yearly costs spread monthly
      const monthlyBuiltIn = getTotalAnnualCosts(apartment) / 12;

      const customCost = getCustomCostForMonth(apartment.customCosts, m);

      // Mortgage payment (only while loan active)
      let mortgageOutflow = 0;
      if (loanBalance > 0 && m <= loanTermMonths) {
        const r = monthlyRate(apartment.interestRate);
        const interest = loanBalance * r;
        const principalPaid = Math.min(payment - interest, loanBalance);
        loanBalance = Math.max(0, loanBalance - principalPaid);
        mortgageOutflow = payment;
      }

      const netCashflow = monthlyRent - mortgageOutflow - monthlyBuiltIn - customCost;

      if (netCashflow < 0) {
        const outflow = Math.abs(netCashflow);
        cashInvested += outflow;
        realCashInvested += outflow / Math.pow(1 + global.inflationRate / 100, m / 12);
      } else {
        cashSurplus += netCashflow;
      }
    }

    const equity = propertyValue - loanBalance;
    const netWorth = equity + cashSurplus;
    const realNetWorth = deflate(netWorth, global.inflationRate, m / 12);

    monthlySnapshots.push({
      month: m,
      year,
      propertyValue,
      loanBalance,
      equity,
      cashSurplus,
      cashInvested,
      realCashInvested,
      netWorth,
      realNetWorth,
    });

    if (m % 12 === 0) {
      yearlySnapshots.push({
        year,
        propertyValue,
        loanBalance,
        equity,
        cashSurplus,
        cashInvested,
        realCashInvested,
        netWorth,
        realNetWorth,
      });
    }
  }

  const last = monthlySnapshots[monthlySnapshots.length - 1];
  let finalNetWorth;

  if (global.propertyExitMode === 'sell') {
    const saleProceeds = last.propertyValue * (1 - global.sellingCostsPct / 100);
    finalNetWorth = saleProceeds - last.loanBalance + last.cashSurplus;
  } else {
    finalNetWorth = last.propertyValue - last.loanBalance + last.cashSurplus;
  }

  const realFinalNetWorth = deflate(finalNetWorth, global.inflationRate, global.horizonYears);

  return buildResult({
    id: 'apartment',
    label: 'Huurappartement',
    horizonYears: global.horizonYears,
    inflationRate: global.inflationRate,
    cashInvested: last.cashInvested,
    realCashInvested: last.realCashInvested,
    finalNetWorth,
    realFinalNetWorth,
    monthlySnapshots,
    yearlySnapshots,
  });
}

export function getMortgageDetails(config) {
  const { global, apartment } = config;
  const loanPrincipal = getLoanPrincipal(apartment);
  const termMonths = global.horizonYears * 12;
  return {
    loanPrincipal,
    monthlyPayment: mortgagePayment(loanPrincipal, apartment.interestRate, termMonths),
    termMonths,
    annualRate: apartment.interestRate,
  };
}

export function simulateEtf(config) {
  const { global, etf } = config;
  const horizonMonths = global.horizonYears * 12;
  const netAnnualReturn = etf.annualReturn - etf.managementFee;
  // Geometrisch maandrendement: samengestelde groei over het jaar (accumulerend = alles herbelegd).
  const monthlyReturn = Math.pow(1 + netAnnualReturn / 100, 1 / 12) - 1;

  let portfolioValue = 0;
  let cashInvested = 0;
  let realCashInvested = 0;

  const monthlySnapshots = [];
  const yearlySnapshots = [];

  const contributionInterval = etf.contributionFrequency === 'semiannual' ? 6 : 1;

  for (let m = 0; m <= horizonMonths; m++) {
    const year = Math.floor(m / 12);

    if (m === 0) {
      if (etf.initialLumpSum > 0) {
        portfolioValue += etf.initialLumpSum;
        cashInvested += etf.initialLumpSum;
        realCashInvested += etf.initialLumpSum;
      }
    } else {
      // Eerst rendement op volledige portefeuille (compound), daarna nieuwe inleg.
      portfolioValue *= 1 + monthlyReturn;

      if (etf.contributionAmount > 0 && m % contributionInterval === 0) {
        portfolioValue += etf.contributionAmount;
        cashInvested += etf.contributionAmount;
        realCashInvested += etf.contributionAmount / Math.pow(1 + global.inflationRate / 100, m / 12);
      }
    }

    const netWorth = portfolioValue;
    const realNetWorth = deflate(netWorth, global.inflationRate, m / 12);

    monthlySnapshots.push({
      month: m,
      year,
      portfolioValue,
      cashInvested,
      realCashInvested,
      netWorth,
      realNetWorth,
    });

    if (m % 12 === 0) {
      yearlySnapshots.push({
        year,
        portfolioValue,
        cashInvested,
        realCashInvested,
        netWorth,
        realNetWorth,
      });
    }
  }

  const last = monthlySnapshots[monthlySnapshots.length - 1];
  const realFinalNetWorth = deflate(last.netWorth, global.inflationRate, global.horizonYears);

  return buildResult({
    id: 'etf',
    label: 'ETF-tracker',
    horizonYears: global.horizonYears,
    inflationRate: global.inflationRate,
    cashInvested: last.cashInvested,
    realCashInvested: last.realCashInvested,
    finalNetWorth: last.netWorth,
    realFinalNetWorth,
    monthlySnapshots,
    yearlySnapshots,
  });
}

function buildResult({
  id,
  label,
  horizonYears,
  inflationRate,
  cashInvested,
  realCashInvested,
  finalNetWorth,
  realFinalNetWorth,
  monthlySnapshots,
  yearlySnapshots,
}) {
  const totalRoi = cashInvested > 0 ? (finalNetWorth - cashInvested) / cashInvested : 0;
  const cagr = cashInvested > 0 && finalNetWorth > 0
    ? Math.pow(finalNetWorth / cashInvested, 1 / horizonYears) - 1
    : 0;

  const realRoi = realCashInvested > 0 ? (realFinalNetWorth - realCashInvested) / realCashInvested : 0;
  const realCagr = realCashInvested > 0 && realFinalNetWorth > 0
    ? Math.pow(realFinalNetWorth / realCashInvested, 1 / horizonYears) - 1
    : 0;

  const breakEvenYear = findBreakEvenYear(yearlySnapshots);

  const realYearly = yearlySnapshots.map((s) => ({
    ...s,
    netWorth: s.realNetWorth,
    cashInvested: s.realCashInvested,
  }));

  return {
    id,
    label,
    cashInvested,
    finalNetWorth,
    totalRoi,
    cagr,
    breakEvenYear,
    monthlySnapshots,
    yearlySnapshots,
    real: {
      finalNetWorth: realFinalNetWorth,
      cashInvested: realCashInvested,
      totalRoi: realRoi,
      cagr: realCagr,
      yearlySnapshots: realYearly,
    },
  };
}

function findBreakEvenYear(yearlySnapshots) {
  for (const snap of yearlySnapshots) {
    if (snap.netWorth >= snap.cashInvested && snap.cashInvested > 0) {
      return snap.year;
    }
  }
  return null;
}

export function findCrossoverYear(apartment, etf, viewMode = 'nominal') {
  const aptSnaps = viewMode === 'real' ? apartment.real.yearlySnapshots : apartment.yearlySnapshots;
  const etfSnaps = viewMode === 'real' ? etf.real.yearlySnapshots : etf.yearlySnapshots;

  for (let i = 1; i < aptSnaps.length; i++) {
    const prevDiff = aptSnaps[i - 1].netWorth - etfSnaps[i - 1].netWorth;
    const diff = aptSnaps[i].netWorth - etfSnaps[i].netWorth;
    if ((prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0)) {
      return aptSnaps[i].year;
    }
  }
  return null;
}

export function runComparison(config) {
  const apartment = simulateApartment(config);
  const etf = simulateEtf(config);

  const winner = apartment.finalNetWorth >= etf.finalNetWorth ? 'apartment' : 'etf';
  const roiWinner = apartment.totalRoi >= etf.totalRoi ? 'apartment' : 'etf';

  return {
    apartment,
    etf,
    winner,
    roiWinner,
    labels: Array.from({ length: config.global.horizonYears + 1 }, (_, i) => `Year ${i}`),
  };
}
