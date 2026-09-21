import {
  getDefaultConfig,
  normalizeConfig,
  validateConfig,
  getLoanPrincipal,
  getPurchasePrice,
  getTotalClosingCosts,
  getBuildingVatRate,
  getBuildingVatAmount,
  getLandRegistrationTaxRate,
  getLandRegistrationTaxAmount,
  getTotalAnnualCosts,
  CLOSING_COST_FIELDS,
  TAX_PERCENTAGE_RATES,
  createCustomCost,
  loadActiveConfig,
  saveActiveConfig,
  listScenarios,
  saveScenario,
  loadScenario,
  deleteScenario,
} from './models.js';
import { runComparison, findCrossoverYear, getApartmentMonthlyOutflowBreakdown } from './calculators.js';
import { renderCharts } from './charts.js';
import { initChatAssistant } from './chatAgent.js';

let config = loadActiveConfig();
let viewMode = 'nominal';
let debounceTimer = null;
let storageWarningShown = false;
let lastResults = null;

const CURRENCY = '€';

const FIELD_MAP = {
  scenarioName: { path: 'scenarioName', type: 'string' },
  scenarioNotes: { path: 'scenarioNotes', type: 'string' },
  horizonYears: { path: 'global.horizonYears', type: 'number' },
  inflationRate: { path: 'global.inflationRate', type: 'number' },
  propertyExitMode: { path: 'global.propertyExitMode', type: 'string' },
  buildingPrice: { path: 'apartment.buildingPrice', type: 'number' },
  landPrice: { path: 'apartment.landPrice', type: 'number' },
  downPayment: { path: 'apartment.downPayment', type: 'number' },
  loanPrincipalOverride: { path: 'apartment.loanPrincipalOverride', type: 'nullable-number' },
  interestRate: { path: 'apartment.interestRate', type: 'number' },
  monthlyRent: { path: 'apartment.monthlyRent', type: 'number' },
  rentGrowthRate: { path: 'apartment.rentGrowthRate', type: 'number' },
  appreciationRate: { path: 'apartment.appreciationRate', type: 'number' },
  propertyTaxYearly: { path: 'apartment.propertyTaxYearly', type: 'number' },
  insuranceYearly: { path: 'apartment.insuranceYearly', type: 'number' },
  maintenanceYearly: { path: 'apartment.maintenanceYearly', type: 'number' },
  syndicYearly: { path: 'apartment.syndicYearly', type: 'number' },
  reserveFundYearly: { path: 'apartment.reserveFundYearly', type: 'number' },
  vacancyReserveYearly: { path: 'apartment.vacancyReserveYearly', type: 'number' },
  initialLumpSum: { path: 'etf.initialLumpSum', type: 'number' },
  contributionAmount: { path: 'etf.contributionAmount', type: 'number' },
  contributionFrequency: { path: 'etf.contributionFrequency', type: 'string' },
  annualReturn: { path: 'etf.annualReturn', type: 'number' },
  managementFee: { path: 'etf.managementFee', type: 'number' },
  mirrorApartmentCashflow: { path: 'etf.mirrorApartmentCashflow', type: 'boolean' },
};

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

const VIEW_MODE_LABELS = {
  nominal: 'nominaal',
  real: 'reëel',
};

function formatCurrency(value, symbol) {
  return `${symbol}${Math.round(value).toLocaleString('nl-NL')}`;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function readConfigFromForm() {
  const updated = normalizeConfig(config);

  for (const [id, meta] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(id);
    if (!el) continue;

    let value;
    if (meta.type === 'string') {
      value = el.value;
    } else if (meta.type === 'boolean') {
      value = el.checked;
    } else if (meta.type === 'nullable-number') {
      value = el.value === '' ? null : Number(el.value);
    } else {
      value = Number(el.value);
    }
    setNestedValue(updated, meta.path, value);
  }

  updated.apartment.closingCosts = readClosingCostsFromForm();

  return updated;
}

function readClosingCostsFromForm() {
  const buildingVatRateEl = document.getElementById('closing_buildingVatRate');
  const landRegistrationTaxRateEl = document.getElementById('closing_landRegistrationTaxRate');
  const closingCosts = {
    buildingVatRate: buildingVatRateEl ? Number(buildingVatRateEl.value) : getBuildingVatRate(config.apartment),
    landRegistrationTaxRate: landRegistrationTaxRateEl
      ? Number(landRegistrationTaxRateEl.value)
      : getLandRegistrationTaxRate(config.apartment),
  };

  for (const { key } of CLOSING_COST_FIELDS) {
    const el = document.getElementById(`closing_${key}`);
    closingCosts[key] = el ? Number(el.value) || 0 : 0;
  }
  return closingCosts;
}

function populateForm() {
  for (const [id, meta] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const value = getNestedValue(config, meta.path);
    if (meta.type === 'nullable-number') {
      el.value = value === null ? '' : value;
    } else if (meta.type === 'boolean') {
      el.checked = Boolean(value);
    } else {
      el.value = value ?? '';
    }
  }

  populateClosingCosts();
  updateComputedFields();
  renderCustomCosts();
  updateNotesButtonLabel();
}

function renderComputedRateRow({ label, rateId, amountId, rateAriaLabel, amountAriaLabel }) {
  return `
    <div class="input-group closing-vat-row">
      <label for="${rateId}">${label}</label>
      <div class="closing-vat-controls">
        <select id="${rateId}" class="closing-vat-rate" aria-label="${rateAriaLabel}">
          ${TAX_PERCENTAGE_RATES.map((rate) => `<option value="${rate}">${rate}%</option>`).join('')}
        </select>
        <input type="text" id="${amountId}" class="closing-vat-amount" readonly tabindex="-1" aria-label="${amountAriaLabel}">
      </div>
    </div>
  `;
}

function initClosingCostsGrid() {
  const grid = document.getElementById('closingCostsGrid');
  if (!grid || grid.childElementCount > 0) return;

  const computedRowsHtml = [
    renderComputedRateRow({
      label: 'BTW op het gebouw',
      rateId: 'closing_buildingVatRate',
      amountId: 'closing_buildingVatAmount',
      rateAriaLabel: 'BTW-percentage op het gebouw',
      amountAriaLabel: 'Berekend BTW-bedrag op het gebouw',
    }),
    renderComputedRateRow({
      label: 'Registratiebelasting op de grond',
      rateId: 'closing_landRegistrationTaxRate',
      amountId: 'closing_landRegistrationTaxAmount',
      rateAriaLabel: 'Registratiebelasting-percentage op de grond',
      amountAriaLabel: 'Berekend registratiebelasting-bedrag op de grond',
    }),
  ].join('');

  grid.innerHTML = computedRowsHtml + CLOSING_COST_FIELDS.map(({ key, label }) => `
    <div class="input-group">
      <label for="closing_${key}">${label}</label>
      <input type="number" id="closing_${key}" min="0" step="50" data-closing-key="${key}">
    </div>
  `).join('');

  document.getElementById('closing_buildingVatRate')?.addEventListener('change', onInputChange);
  document.getElementById('closing_landRegistrationTaxRate')?.addEventListener('change', onInputChange);

  grid.querySelectorAll('input[type="number"]').forEach((el) => {
    el.addEventListener('input', onInputChange);
    el.addEventListener('change', onInputChange);
  });
}

function populateClosingCosts() {
  const buildingVatRateEl = document.getElementById('closing_buildingVatRate');
  if (buildingVatRateEl) {
    buildingVatRateEl.value = String(getBuildingVatRate(config.apartment));
  }

  const landRegistrationTaxRateEl = document.getElementById('closing_landRegistrationTaxRate');
  if (landRegistrationTaxRateEl) {
    landRegistrationTaxRateEl.value = String(getLandRegistrationTaxRate(config.apartment));
  }

  for (const { key } of CLOSING_COST_FIELDS) {
    const el = document.getElementById(`closing_${key}`);
    if (el) {
      el.value = config.apartment.closingCosts?.[key] ?? 0;
    }
  }
  updateClosingCostsDisplay();
}

function updateComputedClosingCostDisplays() {
  const buildingVatAmountEl = document.getElementById('closing_buildingVatAmount');
  if (buildingVatAmountEl) {
    buildingVatAmountEl.value = formatCurrency(getBuildingVatAmount(config.apartment), CURRENCY);
  }

  const landRegistrationTaxAmountEl = document.getElementById('closing_landRegistrationTaxAmount');
  if (landRegistrationTaxAmountEl) {
    landRegistrationTaxAmountEl.value = formatCurrency(getLandRegistrationTaxAmount(config.apartment), CURRENCY);
  }
}

function updateClosingCostsDisplay() {
  updateComputedClosingCostDisplays();
  const total = getTotalClosingCosts(config.apartment);
  const totalEl = document.getElementById('totalClosingCosts');
  const summaryEl = document.getElementById('closingCostsSummary');
  if (totalEl) totalEl.value = formatCurrency(total, CURRENCY);
  if (summaryEl) summaryEl.textContent = formatCurrency(total, CURRENCY);
}

function openClosingCostsDrawer() {
  closeAnnualCostsDrawer();
  closeNotesDrawer();
  const drawer = document.getElementById('closingCostsDrawer');
  drawer.hidden = false;
  document.body.classList.add('drawer-open');
  document.getElementById('closeClosingCostsBtn')?.focus();
}

function closeClosingCostsDrawer() {
  const drawer = document.getElementById('closingCostsDrawer');
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  document.body.classList.remove('drawer-open');
  document.getElementById('openClosingCostsBtn')?.focus();
}

function openAnnualCostsDrawer() {
  closeClosingCostsDrawer();
  closeNotesDrawer();
  const drawer = document.getElementById('annualCostsDrawer');
  drawer.hidden = false;
  document.body.classList.add('drawer-open');
  document.getElementById('closeAnnualCostsBtn')?.focus();
}

function closeAnnualCostsDrawer() {
  const drawer = document.getElementById('annualCostsDrawer');
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  document.body.classList.remove('drawer-open');
  document.getElementById('openAnnualCostsBtn')?.focus();
}

function updateNotesButtonLabel() {
  const btn = document.getElementById('openNotesBtn');
  if (!btn) return;
  const hasNotes = Boolean(config.scenarioNotes?.trim());
  btn.textContent = hasNotes ? 'Aantekeningen •' : 'Aantekeningen';
  btn.title = hasNotes ? 'Aantekeningen (notities aanwezig)' : 'Aantekeningen openen';
}

function openNotesDrawer() {
  closeClosingCostsDrawer();
  closeAnnualCostsDrawer();
  const drawer = document.getElementById('notesDrawer');
  if (!drawer) return;
  drawer.hidden = false;
  document.body.classList.add('drawer-open');
  document.getElementById('scenarioNotes')?.focus();
}

function closeNotesDrawer() {
  const drawer = document.getElementById('notesDrawer');
  if (!drawer || drawer.hidden) return;
  persistConfigFromForm();
  updateNotesButtonLabel();
  drawer.hidden = true;
  document.body.classList.remove('drawer-open');
  document.getElementById('openNotesBtn')?.focus();
}

function updateAnnualCostsDisplay() {
  const total = getTotalAnnualCosts(config.apartment);
  const totalEl = document.getElementById('totalAnnualCosts');
  const summaryEl = document.getElementById('annualCostsSummary');
  if (totalEl) totalEl.value = formatCurrency(total, CURRENCY);
  if (summaryEl) summaryEl.textContent = formatCurrency(total, CURRENCY);
}

function updateComputedFields() {
  const loanPrincipal = getLoanPrincipal(config.apartment);
  const purchasePrice = getPurchasePrice(config.apartment);

  document.getElementById('totalPurchasePrice').value = formatCurrency(purchasePrice, CURRENCY);
  document.getElementById('computedLoanPrincipal').value = formatCurrency(loanPrincipal, CURRENCY);
  updateClosingCostsDisplay();
  updateAnnualCostsDisplay();
}

function renderCustomCosts() {
  const container = document.getElementById('customCostsList');
  container.innerHTML = '';

  if (config.apartment.customCosts.length === 0) {
    container.innerHTML = '<p class="hint">Geen aangepaste kosten toegevoegd. Klik op "Kosten toevoegen" om terugkerende uitgaven toe te voegen.</p>';
    return;
  }

  config.apartment.customCosts.forEach((cost, index) => {
    const row = document.createElement('div');
    row.className = 'custom-cost-row';
    row.dataset.index = index;
    row.innerHTML = `
      <div class="input-group">
        <label>Naam</label>
        <input type="text" class="cost-name" value="${escapeHtml(cost.name)}">
      </div>
      <div class="input-group">
        <label>Bedrag</label>
        <input type="number" class="cost-amount" min="0" step="100" value="${cost.amount}">
      </div>
      <div class="input-group">
        <label>Frequentie</label>
        <select class="cost-frequency">
          <option value="monthly" ${cost.frequency === 'monthly' ? 'selected' : ''}>Maandelijks</option>
          <option value="yearly" ${cost.frequency === 'yearly' ? 'selected' : ''}>Jaarlijks</option>
          <option value="interval" ${cost.frequency === 'interval' ? 'selected' : ''}>Elke N jaar</option>
        </select>
      </div>
      <div class="input-group cost-interval-group" style="${cost.frequency === 'interval' ? '' : 'opacity:0.4'}">
        <label>Elke N jaar</label>
        <input type="number" class="cost-interval" min="1" max="30" value="${cost.intervalYears}" ${cost.frequency === 'interval' ? '' : 'disabled'}>
      </div>
      <div class="input-group">
        <label>Startjaar</label>
        <input type="number" class="cost-start" min="0" max="40" value="${cost.startYear}">
      </div>
      <button type="button" class="btn-icon delete-cost" title="Verwijderen">✕</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('.cost-name, .cost-amount, .cost-frequency, .cost-interval, .cost-start').forEach((el) => {
    el.addEventListener('input', onCustomCostChange);
    el.addEventListener('change', onCustomCostChange);
  });

  container.querySelectorAll('.delete-cost').forEach((btn) => {
    btn.addEventListener('click', onDeleteCustomCost);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function onCustomCostChange(e) {
  const row = e.target.closest('.custom-cost-row');
  const index = Number(row.dataset.index);

  const frequency = row.querySelector('.cost-frequency').value;
  const intervalGroup = row.querySelector('.cost-interval-group');
  const intervalInput = row.querySelector('.cost-interval');

  if (frequency === 'interval') {
    intervalGroup.style.opacity = '1';
    intervalInput.disabled = false;
  } else {
    intervalGroup.style.opacity = '0.4';
    intervalInput.disabled = true;
  }

  config.apartment.customCosts[index] = {
    ...config.apartment.customCosts[index],
    name: row.querySelector('.cost-name').value,
    amount: Number(row.querySelector('.cost-amount').value),
    frequency,
    intervalYears: Number(row.querySelector('.cost-interval').value) || 1,
    startYear: Number(row.querySelector('.cost-start').value) || 0,
  };

  scheduleRecalculate();
}

function onDeleteCustomCost(e) {
  const row = e.target.closest('.custom-cost-row');
  const index = Number(row.dataset.index);
  config.apartment.customCosts.splice(index, 1);
  renderCustomCosts();
  scheduleRecalculate();
}

function onAddCustomCost() {
  config.apartment.customCosts.push(createCustomCost());
  renderCustomCosts();
  scheduleRecalculate();
}

function applyApartmentMirrorToEtf(cfg) {
  const breakdown = getApartmentMonthlyOutflowBreakdown(cfg);
  cfg.etf.initialLumpSum = Math.max(0, Number(cfg.apartment.downPayment) || 0);
  cfg.etf.contributionAmount = Math.round(breakdown.netMonthlyOutflow * 100) / 100;
  cfg.etf.contributionFrequency = 'monthly';
  return breakdown;
}

function updateEtfMirrorFormFields(breakdown) {
  const initialEl = document.getElementById('initialLumpSum');
  const contributionEl = document.getElementById('contributionAmount');
  const frequencyEl = document.getElementById('contributionFrequency');
  if (initialEl) initialEl.value = config.etf.initialLumpSum;
  if (contributionEl) contributionEl.value = config.etf.contributionAmount;
  if (frequencyEl) frequencyEl.value = 'monthly';
  renderEtfMirrorExplanation(breakdown);
}

function renderEtfMirrorExplanation(breakdown) {
  const el = document.getElementById('etfMirrorExplanation');
  if (!el) return;

  if (!config.etf.mirrorApartmentCashflow) {
    el.hidden = true;
    return;
  }

  el.hidden = false;
  const sym = CURRENCY;
  const surplusNote = breakdown.netCashflow > 0
    ? `<p class="hint">Huur dekt de lasten in maand 1; netto bijleg is €0 (overschot in appartement-simulatie: ${formatCurrency(breakdown.netCashflow, sym)}/maand).</p>`
    : '';

  el.innerHTML = `
    <p class="etf-mirror-title">Redenering maandelijkse ETF-inleg (gekoppeld aan appartement)</p>
    <ol class="etf-mirror-steps">
      <li><strong>Leningaflossing</strong> (annuïteit over ${config.global.horizonYears} jaar): ${formatCurrency(breakdown.mortgageOutflow, sym)}/maand</li>
      <li><strong>− Huuropbrengst</strong> (startmaand, vóór huurgroei): ${formatCurrency(breakdown.monthlyRent, sym)}/maand</li>
      <li><strong>+ Jaarlijkse kosten</strong> (totaal ÷ 12): ${formatCurrency(breakdown.monthlyAnnualCosts, sym)}/maand</li>
      <li><strong>+ Aangepaste kosten</strong> in maand 1: ${formatCurrency(breakdown.monthlyCustomCosts, sym)}/maand</li>
    </ol>
    <p class="etf-mirror-result"><strong>Netto uit eigen pocket (ETF-inleg)</strong> = max(0, lening + kosten − huur) = <strong>${formatCurrency(breakdown.netMonthlyOutflow, sym)}/maand</strong></p>
    <p class="hint"><strong>Initieel ETF-bedrag (dag 0)</strong> = eigen inbreng appartement: <strong>${formatCurrency(config.apartment.downPayment, sym)}</strong>. Bij €0 eigen inbreng start de ETF ook op €0. Bijkomende kosten bij aankoop tellen alleen mee in het appartement-pad.</p>
    <p class="hint">Later wijken maandlasten af door huurgroei; de ETF-inleg blijft dit startbedrag tot je de koppeling uitzet.</p>
    ${surplusNote}
  `;
}

function onMatchApartmentOutflow() {
  config.etf.mirrorApartmentCashflow = true;
  const mirrorEl = document.getElementById('mirrorApartmentCashflow');
  if (mirrorEl) mirrorEl.checked = true;
  const breakdown = applyApartmentMirrorToEtf(config);
  updateEtfMirrorFormFields(breakdown);
  scheduleRecalculate();
}

function showErrors(errors) {
  const banner = document.getElementById('errorsBanner');
  if (errors.length === 0) {
    if (!banner.dataset.bootMessage) {
      banner.classList.remove('visible');
      banner.innerHTML = '';
    }
    return;
  }
  banner.dataset.bootMessage = '';
  banner.classList.add('visible');
  banner.innerHTML = `<strong>Validatiefouten:</strong><ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showStorageWarning() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  const banner = document.getElementById('errorsBanner');
  if (!banner) return;
  banner.dataset.bootMessage = '1';
  banner.classList.add('visible');
  banner.innerHTML =
    '<strong>Opslag niet beschikbaar:</strong> je invoer wordt niet bewaard na verversen. Open de pagina via <code>http://localhost</code> (lokale webserver), geen privévenster, en geen bestand-URL.';
}

function renderKpiPlaceholder(message) {
  const html = `<p class="hint kpi-placeholder">${escapeHtml(message)}</p>`;
  document.getElementById('apartmentKpis').innerHTML = html;
  document.getElementById('etfKpis').innerHTML = html;
}

function persistConfigFromForm() {
  config = normalizeConfig(readConfigFromForm());
  let mirrorBreakdown = null;
  if (config.etf.mirrorApartmentCashflow) {
    mirrorBreakdown = applyApartmentMirrorToEtf(config);
  }
  if (!saveActiveConfig(config)) {
    showStorageWarning();
  }
  if (mirrorBreakdown) {
    updateEtfMirrorFormFields(mirrorBreakdown);
  } else {
    renderEtfMirrorExplanation(null);
    const el = document.getElementById('etfMirrorExplanation');
    if (el) el.hidden = true;
  }
  updateNotesButtonLabel();
  return config;
}

function getViewModeWinner(results) {
  const apt = results.apartment;
  const etf = results.etf;
  const aptFinal = viewMode === 'real' ? apt.real.finalNetWorth : apt.finalNetWorth;
  const etfFinal = viewMode === 'real' ? etf.real.finalNetWorth : etf.finalNetWorth;
  if (Math.abs(aptFinal - etfFinal) < 1) return 'tie';
  return aptFinal >= etfFinal ? 'apartment' : 'etf';
}

function updateHeaderSubtitle() {
  const el = document.getElementById('headerSubtitle');
  if (!el) return;
  const years = config.global?.horizonYears ?? '—';
  el.textContent = `Vergelijking over ${years} jaar`;
}

function renderVerdict(results) {
  const strip = document.getElementById('verdictStrip');
  if (!strip) return;

  const apt = results.apartment;
  const etf = results.etf;
  const viewApt = viewMode === 'real' ? apt.real : apt;
  const viewEtf = viewMode === 'real' ? etf.real : etf;
  const diff = viewApt.finalNetWorth - viewEtf.finalNetWorth;
  const winner = getViewModeWinner(results);
  const viewLabel = VIEW_MODE_LABELS[viewMode] || viewMode;
  const crossoverYear = findCrossoverYear(apt, etf, viewMode);

  strip.hidden = false;
  strip.classList.remove('verdict-apartment', 'verdict-etf', 'verdict-tie');
  if (winner === 'apartment') strip.classList.add('verdict-apartment');
  else if (winner === 'etf') strip.classList.add('verdict-etf');
  else strip.classList.add('verdict-tie');

  const winnerLabel = document.getElementById('verdictWinnerLabel');
  const differenceEl = document.getElementById('verdictDifference');
  const horizonEl = document.getElementById('verdictHorizon');
  const crossoverEl = document.getElementById('verdictCrossover');

  if (winner === 'tie') {
    winnerLabel.textContent = 'Gelijk eindresultaat';
    differenceEl.textContent = formatCurrency(0, CURRENCY);
  } else if (winner === 'apartment') {
    winnerLabel.textContent = 'Huurappartement wint';
    differenceEl.textContent = `+${formatCurrency(diff, CURRENCY)} t.o.v. ETF`;
  } else {
    winnerLabel.textContent = 'ETF-tracker wint';
    differenceEl.textContent = `+${formatCurrency(-diff, CURRENCY)} t.o.v. appartement`;
  }

  horizonEl.textContent = `Horizon: ${config.global.horizonYears} jaar · ${viewLabel}`;
  crossoverEl.textContent = crossoverYear !== null
    ? `Kruispunt: jaar ${crossoverYear}`
    : 'Geen kruispunt in deze periode';
}

function renderSummary(results) {
  const symbol = CURRENCY;
  const apt = results.apartment;
  const etf = results.etf;
  const winner = getViewModeWinner(results);

  renderVerdict(results);

  const aptCard = document.getElementById('apartmentSummary');
  const etfCard = document.getElementById('etfSummary');
  const aptBadge = document.getElementById('apartmentWinnerBadge');
  const etfBadge = document.getElementById('etfWinnerBadge');

  aptCard.classList.toggle('winner', winner === 'apartment');
  etfCard.classList.toggle('winner', winner === 'etf');
  aptBadge.style.display = winner === 'apartment' ? 'inline' : 'none';
  etfBadge.style.display = winner === 'etf' ? 'inline' : 'none';

  const viewApt = viewMode === 'real' ? apt.real : apt;
  const viewEtf = viewMode === 'real' ? etf.real : etf;

  document.getElementById('apartmentKpis').innerHTML = buildKpiHtml(viewApt, apt, symbol);
  document.getElementById('etfKpis').innerHTML = buildKpiHtml(viewEtf, etf, symbol);
}

function buildKpiHtml(viewMetrics, fullMetrics, symbol) {
  const roiClass = viewMetrics.totalRoi >= 0 ? 'positive' : 'negative';
  const profit = viewMetrics.finalNetWorth - viewMetrics.cashInvested;
  const viewLabel = VIEW_MODE_LABELS[viewMode] || viewMode;

  return `
    <div class="kpi">
      <div class="kpi-label">Geïnvesteerd bedrag</div>
      <div class="kpi-value">${formatCurrency(viewMetrics.cashInvested, symbol)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Eindvermogen</div>
      <div class="kpi-value">${formatCurrency(viewMetrics.finalNetWorth, symbol)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Totale ROI (${viewLabel})</div>
      <div class="kpi-value ${roiClass}">${formatPct(viewMetrics.totalRoi)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Jaargemiddeld rendement (${viewLabel})</div>
      <div class="kpi-value ${roiClass}">${formatPct(viewMetrics.cagr)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Winst</div>
      <div class="kpi-value ${profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(profit, symbol)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Terugverdientijd</div>
      <div class="kpi-value">${fullMetrics.breakEvenYear !== null ? `Jaar ${fullMetrics.breakEvenYear}` : '—'}</div>
    </div>
  `;
}

function renderYearlyTable(results) {
  const symbol = CURRENCY;
  const tbody = document.getElementById('yearlyTableBody');
  const aptSnaps = viewMode === 'real' ? results.apartment.real.yearlySnapshots : results.apartment.yearlySnapshots;
  const etfSnaps = viewMode === 'real' ? results.etf.real.yearlySnapshots : results.etf.yearlySnapshots;
  const crossoverYear = findCrossoverYear(results.apartment, results.etf, viewMode);

  tbody.innerHTML = aptSnaps.map((apt, i) => {
    const etf = etfSnaps[i];
    const diff = apt.netWorth - etf.netWorth;
    const diffClass = diff >= 0 ? 'positive' : 'negative';
    const rowClass = crossoverYear !== null && apt.year === crossoverYear ? 'crossover-row' : '';
    return `
      <tr class="${rowClass}">
        <td>Jaar ${apt.year}</td>
        <td>${formatCurrency(apt.netWorth, symbol)}</td>
        <td>${formatCurrency(apt.cashInvested, symbol)}</td>
        <td>${formatCurrency(etf.netWorth, symbol)}</td>
        <td>${formatCurrency(etf.cashInvested, symbol)}</td>
        <td class="${diffClass}">${diff >= 0 ? '+' : ''}${formatCurrency(diff, symbol)}</td>
      </tr>
    `;
  }).join('');
}

function recalculate() {
  config = persistConfigFromForm();

  const errors = validateConfig(config);
  showErrors(errors);

  updateComputedFields();
  updateHeaderSubtitle();

  if (errors.length > 0) {
    const strip = document.getElementById('verdictStrip');
    if (strip) strip.hidden = true;
    lastResults = null;
    renderKpiPlaceholder('Los de validatiefouten hierboven op om KPI-bedragen te zien.');
    return;
  }

  const results = runComparison(config);
  lastResults = results;
  const crossoverYear = findCrossoverYear(results.apartment, results.etf, viewMode);
  renderSummary(results);
  renderCharts(results, viewMode, CURRENCY, crossoverYear);
  renderYearlyTable(results);
}

function scheduleRecalculate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(recalculate, 300);
}

function onInputChange() {
  persistConfigFromForm();
  updateComputedFields();
  scheduleRecalculate();
}

function flushPendingChanges() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  persistConfigFromForm();
  updateComputedFields();
}

function onViewTabClick(e) {
  document.querySelectorAll('.view-tab').forEach((tab) => tab.classList.remove('active'));
  e.target.classList.add('active');
  viewMode = e.target.dataset.view;
  recalculate();
}

function onSaveScenario() {
  const name = config.scenarioName.trim() || 'Naamloos scenario';
  saveScenario(name, config);
  alert(`Scenario "${name}" opgeslagen.`);
}

function onLoadScenario() {
  const scenarios = listScenarios();
  const names = Object.keys(scenarios);

  const list = document.getElementById('scenarioList');
  list.innerHTML = '';

  if (names.length === 0) {
    list.innerHTML = '<li>Nog geen opgeslagen scenario\'s.</li>';
  } else {
    names.forEach((name) => {
      const li = document.createElement('li');
      const savedAt = new Date(scenarios[name].savedAt).toLocaleString('nl-NL');
      li.innerHTML = `
        <span>${escapeHtml(name)} <small style="color:var(--text-muted)">(${savedAt})</small></span>
        <div>
          <button class="load-scenario-btn" data-name="${escapeHtml(name)}">Laden</button>
          <button class="delete-scenario-btn" data-name="${escapeHtml(name)}">Verwijderen</button>
        </div>
      `;
      list.appendChild(li);
    });
  }

  document.getElementById('loadModal').classList.add('visible');

  list.querySelectorAll('.load-scenario-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const loaded = loadScenario(btn.dataset.name);
      if (loaded) {
        config = loaded;
        populateForm();
        recalculate();
        closeModal();
      }
    });
  });

  list.querySelectorAll('.delete-scenario-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm(`Scenario "${btn.dataset.name}" verwijderen?`)) {
        deleteScenario(btn.dataset.name);
        onLoadScenario();
      }
    });
  });
}

function closeModal() {
  document.getElementById('loadModal').classList.remove('visible');
}

function onReset() {
  if (confirm('Alle invoervelden terugzetten naar standaardwaarden?')) {
    config = getDefaultConfig();
    populateForm();
    recalculate();
  }
}

function initLinkedOptionPanels() {
  const apartmentDetails = document.getElementById('optionApartmentDetails');
  const etfDetails = document.getElementById('optionEtfDetails');
  if (!apartmentDetails || !etfDetails) return;

  let syncing = false;

  const syncOpenState = (source, target) => {
    if (syncing) return;
    syncing = true;
    target.open = source.open;
    syncing = false;
  };

  apartmentDetails.addEventListener('toggle', () => {
    syncOpenState(apartmentDetails, etfDetails);
  });

  etfDetails.addEventListener('toggle', () => {
    syncOpenState(etfDetails, apartmentDetails);
  });
}

function init() {
  const closingDrawer = document.getElementById('closingCostsDrawer');
  if (closingDrawer) {
    document.body.appendChild(closingDrawer);
    closingDrawer.hidden = true;
  }

  const annualDrawer = document.getElementById('annualCostsDrawer');
  if (annualDrawer) {
    document.body.appendChild(annualDrawer);
    annualDrawer.hidden = true;
  }

  const notesDrawer = document.getElementById('notesDrawer');
  if (notesDrawer) {
    document.body.appendChild(notesDrawer);
    notesDrawer.hidden = true;
  }

  initClosingCostsGrid();
  initLinkedOptionPanels();
  populateForm();

  for (const id of Object.keys(FIELD_MAP)) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', onInputChange);
      el.addEventListener('change', onInputChange);
    }
  }

  document.getElementById('addCustomCostBtn').addEventListener('click', onAddCustomCost);
  document.getElementById('matchApartmentOutflowBtn').addEventListener('click', onMatchApartmentOutflow);
  document.getElementById('saveScenarioBtn').addEventListener('click', onSaveScenario);
  document.getElementById('loadScenarioBtn').addEventListener('click', onLoadScenario);
  document.getElementById('resetBtn').addEventListener('click', onReset);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', onViewTabClick);
  });

  document.getElementById('loadModal').addEventListener('click', (e) => {
    if (e.target.id === 'loadModal') closeModal();
  });

  document.getElementById('openClosingCostsBtn').addEventListener('click', openClosingCostsDrawer);
  document.getElementById('closeClosingCostsBtn').addEventListener('click', closeClosingCostsDrawer);
  document.getElementById('applyClosingCostsBtn').addEventListener('click', closeClosingCostsDrawer);
  document.getElementById('closingCostsBackdrop').addEventListener('click', closeClosingCostsDrawer);

  document.getElementById('openAnnualCostsBtn').addEventListener('click', openAnnualCostsDrawer);
  document.getElementById('closeAnnualCostsBtn').addEventListener('click', closeAnnualCostsDrawer);
  document.getElementById('applyAnnualCostsBtn').addEventListener('click', closeAnnualCostsDrawer);
  document.getElementById('annualCostsBackdrop').addEventListener('click', closeAnnualCostsDrawer);

  document.getElementById('openNotesBtn').addEventListener('click', openNotesDrawer);
  document.getElementById('closeNotesBtn').addEventListener('click', closeNotesDrawer);
  document.getElementById('applyNotesBtn').addEventListener('click', closeNotesDrawer);
  document.getElementById('notesBackdrop').addEventListener('click', closeNotesDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const closingDrawer = document.getElementById('closingCostsDrawer');
    const annualDrawer = document.getElementById('annualCostsDrawer');
    const notesDrawerEl = document.getElementById('notesDrawer');
    if (closingDrawer && !closingDrawer.hidden) {
      closeClosingCostsDrawer();
    } else if (annualDrawer && !annualDrawer.hidden) {
      closeAnnualCostsDrawer();
    } else if (notesDrawerEl && !notesDrawerEl.hidden) {
      closeNotesDrawer();
    }
  });

  window.addEventListener('pagehide', flushPendingChanges);
  window.addEventListener('beforeunload', flushPendingChanges);

  recalculate();

  initChatAssistant({
    getContext: () => ({
      config,
      results: lastResults,
      viewMode,
    }),
  });

  window.__dashboardReady = true;
}

init();
