const STORAGE_KEY = 'investment-scenarios';
const ACTIVE_SCENARIO_KEY = 'investment-active-scenario';

export const TAX_PERCENTAGE_RATES = [6, 12, 21];
export const BUILDING_VAT_RATES = TAX_PERCENTAGE_RATES;

export const CLOSING_COST_FIELDS = [
  { key: 'annexRegistrationFee', label: 'Registratierecht op bijlagen' },
  { key: 'notaryFee', label: 'Ereloon' },
  { key: 'administrativeCosts', label: 'Administratieve kosten' },
  { key: 'thirdPartyExpenses', label: 'Uitgaven aan derden' },
  { key: 'transferCosts', label: 'Kosten overschrijvingen' },
  { key: 'deedRegistrationFee', label: 'Recht op geschriften' },
  { key: 'servicesVat', label: 'BTW op diensten' },
];

export function getDefaultClosingCosts() {
  return {
    buildingVatRate: 6,
    landRegistrationTaxRate: 12,
    annexRegistrationFee: 0,
    notaryFee: 3000,
    administrativeCosts: 2000,
    thirdPartyExpenses: 0,
    transferCosts: 2500,
    deedRegistrationFee: 1500,
    servicesVat: 1000,
  };
}

export function getBuildingVatRate(apartment) {
  const rate = Number(apartment.closingCosts?.buildingVatRate);
  return BUILDING_VAT_RATES.includes(rate) ? rate : BUILDING_VAT_RATES[0];
}

export function getBuildingVatAmount(apartment) {
  return Math.round((apartment.buildingPrice || 0) * getBuildingVatRate(apartment) / 100);
}

export function getLandRegistrationTaxRate(apartment) {
  const rate = Number(apartment.closingCosts?.landRegistrationTaxRate);
  return TAX_PERCENTAGE_RATES.includes(rate) ? rate : TAX_PERCENTAGE_RATES[1];
}

export function getLandRegistrationTaxAmount(apartment) {
  return Math.round((apartment.landPrice || 0) * getLandRegistrationTaxRate(apartment) / 100);
}

export function getTotalClosingCosts(apartment) {
  const costs = apartment.closingCosts || {};
  const manualTotal = CLOSING_COST_FIELDS.reduce((sum, { key }) => sum + (Number(costs[key]) || 0), 0);
  return manualTotal + getBuildingVatAmount(apartment) + getLandRegistrationTaxAmount(apartment);
}

export function getDefaultConfig() {
  const apartment = {
    buildingPrice: 280000,
    landPrice: 70000,
    downPayment: 0,
    closingCosts: getDefaultClosingCosts(),
    loanPrincipalOverride: null,
    interestRate: 3.5,
    monthlyRent: 1400,
    rentGrowthRate: 2,
      appreciationRate: 3,
      propertyTaxYearly: 2000,
      insuranceYearly: 1000,
      maintenanceYearly: 1500,
      syndicYearly: 0,
      reserveFundYearly: 0,
      vacancyReserveYearly: 0,
      customCosts: [],
  };

  return {
    scenarioName: 'Vergelijking 20 jaar',
    scenarioNotes: '',
    global: {
      horizonYears: 20,
      inflationRate: 2.5,
      propertyExitMode: 'sell',
      sellingCostsPct: 3,
    },
    apartment,
    etf: {
      initialLumpSum: 0,
      contributionAmount: 0,
      contributionFrequency: 'monthly',
      mirrorApartmentCashflow: true,
      annualReturn: 7,
      managementFee: 0.2,
    },
  };
}

function coerceNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeNumericConfig(config, defaults) {
  config.global.horizonYears = Math.round(coerceNumber(config.global.horizonYears, defaults.global.horizonYears));
  config.global.inflationRate = coerceNumber(config.global.inflationRate, defaults.global.inflationRate);
  config.global.sellingCostsPct = coerceNumber(config.global.sellingCostsPct, defaults.global.sellingCostsPct);

  const a = config.apartment;
  const da = defaults.apartment;
  a.buildingPrice = coerceNumber(a.buildingPrice, da.buildingPrice);
  a.landPrice = coerceNumber(a.landPrice, da.landPrice);
  a.downPayment = coerceNumber(a.downPayment, da.downPayment);
  a.interestRate = coerceNumber(a.interestRate, da.interestRate);
  a.monthlyRent = coerceNumber(a.monthlyRent, da.monthlyRent);
  a.rentGrowthRate = coerceNumber(a.rentGrowthRate, da.rentGrowthRate);
  a.appreciationRate = coerceNumber(a.appreciationRate, da.appreciationRate);
  a.propertyTaxYearly = coerceNumber(a.propertyTaxYearly, da.propertyTaxYearly);
  a.insuranceYearly = coerceNumber(a.insuranceYearly, da.insuranceYearly);
  a.maintenanceYearly = coerceNumber(a.maintenanceYearly, da.maintenanceYearly);
  a.syndicYearly = coerceNumber(a.syndicYearly, da.syndicYearly);
  a.reserveFundYearly = coerceNumber(a.reserveFundYearly, da.reserveFundYearly);
  a.vacancyReserveYearly = coerceNumber(a.vacancyReserveYearly, da.vacancyReserveYearly);

  if (a.loanPrincipalOverride !== null && a.loanPrincipalOverride !== '') {
    const loan = Number(a.loanPrincipalOverride);
    a.loanPrincipalOverride = Number.isFinite(loan) ? loan : null;
  } else {
    a.loanPrincipalOverride = null;
  }

  const e = config.etf;
  const de = defaults.etf;
  e.initialLumpSum = coerceNumber(e.initialLumpSum, de.initialLumpSum);
  e.contributionAmount = coerceNumber(e.contributionAmount, de.contributionAmount);
  e.annualReturn = coerceNumber(e.annualReturn, de.annualReturn);
  e.managementFee = coerceNumber(e.managementFee, de.managementFee);
  if (typeof e.mirrorApartmentCashflow !== 'boolean') {
    e.mirrorApartmentCashflow = de.mirrorApartmentCashflow ?? true;
  }
  if (e.contributionFrequency !== 'monthly' && e.contributionFrequency !== 'semiannual') {
    e.contributionFrequency = de.contributionFrequency;
  }
  if (config.global.propertyExitMode !== 'sell' && config.global.propertyExitMode !== 'hold') {
    config.global.propertyExitMode = defaults.global.propertyExitMode;
  }

  return config;
}

export function normalizeConfig(raw) {
  const defaults = getDefaultConfig();
  const config = {
    scenarioName: raw?.scenarioName ?? defaults.scenarioName,
    scenarioNotes: typeof raw?.scenarioNotes === 'string' ? raw.scenarioNotes : defaults.scenarioNotes,
    global: { ...defaults.global, ...raw?.global },
    apartment: {
      ...defaults.apartment,
      ...raw?.apartment,
      closingCosts: normalizeClosingCosts(raw?.apartment),
      customCosts: Array.isArray(raw?.apartment?.customCosts)
        ? raw.apartment.customCosts.map(normalizeCustomCost)
        : [],
    },
    etf: { ...defaults.etf, ...raw?.etf },
  };

  if (config.apartment.loanPrincipalOverride === '' || config.apartment.loanPrincipalOverride === undefined) {
    config.apartment.loanPrincipalOverride = null;
  }

  if (raw?.apartment?.purchasePrice != null && raw?.apartment?.buildingPrice == null) {
    config.apartment.buildingPrice = Number(raw.apartment.purchasePrice);
    config.apartment.landPrice = Number(raw.apartment.landPrice ?? 0);
  }

  delete config.apartment.purchasePrice;
  delete config.apartment.loanTermYears;

  return sanitizeNumericConfig(config, defaults);
}

export function getPurchasePrice(apartment) {
  return (apartment.buildingPrice || 0) + (apartment.landPrice || 0);
}

export const ANNUAL_COST_FIELDS = [
  { key: 'propertyTaxYearly', label: 'Onroerende voorheffing' },
  { key: 'insuranceYearly', label: 'Brandverzekering' },
  { key: 'maintenanceYearly', label: 'Kleine herstellingen' },
  { key: 'syndicYearly', label: 'Syndicus' },
  { key: 'reserveFundYearly', label: 'Reservefonds' },
  { key: 'vacancyReserveYearly', label: 'Leegstandsreserve' },
];

export function getTotalAnnualCosts(apartment) {
  return ANNUAL_COST_FIELDS.reduce((sum, { key }) => sum + (Number(apartment[key]) || 0), 0);
}

function normalizeClosingCosts(apartmentRaw) {
  const defaults = getDefaultClosingCosts();

  if (typeof apartmentRaw?.closingCosts === 'number') {
    return {
      ...defaults,
      administrativeCosts: apartmentRaw.closingCosts,
    };
  }

  if (apartmentRaw?.closingCosts && typeof apartmentRaw.closingCosts === 'object') {
    const normalized = { ...defaults };
    for (const { key } of CLOSING_COST_FIELDS) {
      normalized[key] = Number(apartmentRaw.closingCosts[key]) || 0;
    }
    const buildingVatRate = Number(apartmentRaw.closingCosts.buildingVatRate);
    normalized.buildingVatRate = TAX_PERCENTAGE_RATES.includes(buildingVatRate)
      ? buildingVatRate
      : defaults.buildingVatRate;
    const landRegistrationTaxRate = Number(apartmentRaw.closingCosts.landRegistrationTaxRate);
    normalized.landRegistrationTaxRate = TAX_PERCENTAGE_RATES.includes(landRegistrationTaxRate)
      ? landRegistrationTaxRate
      : defaults.landRegistrationTaxRate;
    return normalized;
  }

  return defaults;
}

function normalizeCustomCost(cost) {
  return {
    id: cost.id || crypto.randomUUID(),
    name: cost.name || 'Aangepaste kost',
    amount: Number(cost.amount) || 0,
    frequency: cost.frequency || 'yearly',
    intervalYears: Number(cost.intervalYears) || 1,
    startYear: Number(cost.startYear) || 0,
  };
}

export function validateConfig(config) {
  const errors = [];
  const { global, apartment, etf } = config;

  if (global.horizonYears < 1 || global.horizonYears > 40) {
    errors.push('De horizon moet tussen 1 en 40 jaar liggen.');
  }

  if (global.sellingCostsPct < 0 || global.sellingCostsPct > 30) {
    errors.push('Verkoopkosten moeten tussen 0% en 30% liggen.');
  }

  const purchasePrice = getPurchasePrice(apartment);
  if (apartment.downPayment > purchasePrice + getTotalClosingCosts(apartment)) {
    errors.push('Eigen inbreng mag de totale aankoopprijs plus bijkomende kosten niet overschrijden.');
  }

  const loanPrincipal = getLoanPrincipal(apartment);
  if (loanPrincipal < 0) {
    errors.push('Het leningbedrag kan niet negatief zijn.');
  }

  if (apartment.interestRate < 0 || apartment.interestRate > 30) {
    errors.push('De rente moet tussen 0% en 30% liggen.');
  }

  if (etf.annualReturn < -50 || etf.annualReturn > 50) {
    errors.push('Het jaarlijkse ETF-rendement moet tussen -50% en 50% liggen.');
  }

  return errors;
}

export function getLoanPrincipal(apartment) {
  if (apartment.loanPrincipalOverride !== null && apartment.loanPrincipalOverride !== '') {
    return Number(apartment.loanPrincipalOverride);
  }
  return Math.max(0, getPurchasePrice(apartment) + getTotalClosingCosts(apartment) - apartment.downPayment);
}

export function getDay0Cash(apartment) {
  return apartment.downPayment + getTotalClosingCosts(apartment);
}

export function createCustomCost() {
  return normalizeCustomCost({
    id: crypto.randomUUID(),
    name: 'Nieuwe kost',
    amount: 0,
    frequency: 'yearly',
    intervalYears: 1,
    startYear: 0,
  });
}

export function loadActiveConfig() {
  try {
    const stored = localStorage.getItem(ACTIVE_SCENARIO_KEY);
    if (stored) {
      const config = normalizeConfig(JSON.parse(stored));
      if (validateConfig(config).length === 0) {
        return config;
      }
    }
  } catch {
    // ignore parse / storage errors
  }
  return getDefaultConfig();
}

export function saveActiveConfig(config) {
  try {
    localStorage.setItem(ACTIVE_SCENARIO_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function listScenarios() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return {};
}

export function saveScenario(name, config) {
  const scenarios = listScenarios();
  scenarios[name] = {
    savedAt: new Date().toISOString(),
    config: normalizeConfig({ ...config, scenarioName: name }),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
    return true;
  } catch {
    return false;
  }
}

export function loadScenario(name) {
  const scenarios = listScenarios();
  if (scenarios[name]) {
    return normalizeConfig(scenarios[name].config);
  }
  return null;
}

export function deleteScenario(name) {
  const scenarios = listScenarios();
  delete scenarios[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}
