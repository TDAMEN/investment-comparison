import {
  getPurchasePrice,
  getTotalClosingCosts,
  getTotalAnnualCosts,
  ANNUAL_COST_FIELDS,
} from './models.js';
import {
  getApartmentMonthlyOutflowBreakdown,
  getMortgageDetails,
  findCrossoverYear,
} from './calculators.js';

function formatCurrency(value, symbol = '€') {
  return `${symbol}${Math.round(value).toLocaleString('nl-NL')}`;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeQuestion(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/app\./g, 'app ')
    .replace(/j(\d+)/g, 'jaar $1');
}

function parseYearFromQuestion(q) {
  const m = q.match(/jaar\s*(\d+)|\bin\s*(\d+)\s*jaar|\by\s*(\d+)\b/);
  if (!m) return null;
  return Number(m[1] ?? m[2] ?? m[3]);
}

function isApartmentQuery(q) {
  return /\bapp\b|appartement|huurappartement|woning|huur/.test(q);
}

function isEtfQuery(q) {
  return /\betf\b|tracker|belegging/.test(q);
}

function isDashboardQuestion(q) {
  return /vermogen|geïnvesteerd|invest|etf|app|appartement|lening|hypotheek|huur|kosten|roi|cagr|rendement|compound|accumuler|kruispunt|winnaar|verschil|voordeel|inflatie|nominaal|reëel|jaar|terugverdien|syndicus|notaris|btw|eindvermogen|winst|kpi|dashboard|simul|bereken|formule|jaarlijkse|bijkomende|eigen inbreng|inleg|compound|koppeling|maandlast|aflossing/.test(q);
}

function getYearSnapshot(results, viewMode, which, year) {
  const entity = which === 'etf' ? results.etf : results.apartment;
  const snaps = viewMode === 'real' ? entity.real.yearlySnapshots : entity.yearlySnapshots;
  return snaps.find((s) => s.year === year) ?? null;
}

function explainYearSnapshot(ctx, year, which) {
  const { results, viewMode, config } = ctx;
  if (!results) return answerWithNoResults();

  const label = which === 'etf' ? 'ETF' : 'Appartement (App.)';
  const snap = getYearSnapshot(results, viewMode, which, year);
  if (!snap) {
    return `Jaar ${year} staat niet in de simulatie (horizon is ${config.global.horizonYears} jaar).`;
  }

  const viewLabel = viewMode === 'real' ? 'reëel' : 'nominaal';

  if (which === 'etf') {
    return `**${label} vermogen in jaar ${year}** (${viewLabel}):

• Vermogen: **${formatCurrency(snap.netWorth)}**
• Geïnvesteerd tot dan: ${formatCurrency(snap.cashInvested)}

**Berekening:** start ${formatCurrency(config.etf.initialLumpSum)}, daarna elke maand eerst rendement op het saldo (accumulerend/compound), dan je inleg. Jaar ${year} = snapshot na ${year * 12} maanden in de simulatie.`;
  }

  const equity = snap.equity ?? (snap.propertyValue - snap.loanBalance);
  const purchase = getPurchasePrice(config.apartment);
  const closing = getTotalClosingCosts(config.apartment);

  let year0Note = '';
  if (year === 0) {
    year0Note = `**Jaar 0 (start):** nog geen huur/leningaflossing verwerkt in die maand.
• Woningwaarde = aankoopprijs ${formatCurrency(purchase)}
• Restschuld = leningbedrag ${formatCurrency(snap.loanBalance ?? getMortgageDetails(config).loanPrincipal)}
• Equity = waarde − schuld = ${formatCurrency(equity)}
• Cash-overschot huur = ${formatCurrency(snap.cashSurplus ?? 0)}
• **Vermogen** = equity + overschot = **${formatCurrency(snap.netWorth)}**

Geïnvesteerd tot dan: eigen inbreng ${formatCurrency(config.apartment.downPayment)} + bijkomende kosten ${formatCurrency(closing)} = ${formatCurrency(snap.cashInvested)}.`;
  }

  return `**${label} vermogen in jaar ${year}** (${viewLabel}):

• Vermogen: **${formatCurrency(snap.netWorth)}**
• Geïnvesteerd tot dan: ${formatCurrency(snap.cashInvested)}
${snap.propertyValue != null ? `• Woningwaarde: ${formatCurrency(snap.propertyValue)}, restschuld: ${formatCurrency(snap.loanBalance)}, equity: ${formatCurrency(equity)}` : ''}

**Formule:** vermogen = (woningwaarde − restschuld) + opgebouwd huuroverschot.
${year0Note}`;
}

const WELCOME_MESSAGE = `Hallo! Ik beantwoord **alleen vragen over dit dashboard** (formules en jouw cijfers).

Voorbeelden: "App. vermogen jaar 0", "ETF maandlast", "kruispunt", "ROI appartement".`;

const OFF_TOPIC_MESSAGE = `Ik beantwoord alleen vragen over **dit investeringsdashboard** (appartement vs ETF, KPI's, tabellen, formules).

Herformuleer met een term uit het dashboard, bv. vermogen, lening, huur, ETF-inleg, kruispunt.`;

const UNKNOWN_DASHBOARD_MESSAGE = `Dat herken ik niet binnen dit dashboard. Probeer bv.:
• "App. vermogen jaar 5"
• "Hoe wordt ETF eindvermogen berekend?"
• "Waar komt maandelijkse ETF-inleg vandaan?"`;

function viewMetrics(results, viewMode, which) {
  if (!results) return null;
  const entity = which === 'etf' ? results.etf : results.apartment;
  return viewMode === 'real' ? entity.real : entity;
}

function answerWithNoResults() {
  return 'Er zijn nog geen berekende cijfers (validatiefouten of dashboard laadt nog). Los eerst eventuele fouten op of wacht tot de KPI\'s zichtbaar zijn.';
}

const INTENTS = [
  {
    id: 'year-snapshot',
    test: (q) => /vermogen|geïnvesteerd|verschil/.test(q) && (parseYearFromQuestion(q) !== null || /jaar\s*0|start|dag\s*0/.test(q)),
    answer: (ctx, q) => {
      let year = parseYearFromQuestion(q);
      if (year === null && /jaar\s*0|start|dag\s*0/.test(q)) year = 0;
      const which = isEtfQuery(q) && !isApartmentQuery(q) ? 'etf' : isApartmentQuery(q) || /\bapp\b/.test(q) ? 'apartment' : 'apartment';
      if (isEtfQuery(q) && isApartmentQuery(q)) {
        return explainYearSnapshot(ctx, year, 'apartment') + '\n\n---\n\n' + explainYearSnapshot(ctx, year, 'etf');
      }
      return explainYearSnapshot(ctx, year, which);
    },
  },
  {
    id: 'year-snapshot-table',
    test: (q) => /jaarlijkse uitsplitsing|jaartabel|kolom|app\.\s*vermogen/.test(q),
    answer: (ctx, q) => {
      const year = parseYearFromQuestion(q) ?? 0;
      if (/etf/.test(q)) return explainYearSnapshot(ctx, year, 'etf');
      return explainYearSnapshot(ctx, year, 'apartment');
    },
  },
  {
    id: 'etf-compound',
    test: (q) => /compound|samengesteld|accumuler|herbeleg|rente op rente/.test(q),
    answer: (ctx) => {
      const { config } = ctx;
      const net = config.etf.annualReturn - config.etf.managementFee;
      return `**Accumulerende ETF (compound):**
Elke maand groeit de volledige portefeuille met het netto maandrendement, daarna komt je inleg erbij.

• Bruto rendement: ${config.etf.annualReturn}%
• Beheerskosten: ${config.etf.managementFee}%
• Netto jaar: ${net.toFixed(2)}%
• Maandrendement: (1 + net/100)^(1/12) − 1 → rendement blijft in het fonds (geen uitkerende dividenden).

Zo compoundt elke euro mee tot aan jaar ${config.global.horizonYears}.`;
    },
  },
  {
    id: 'etf-contribution',
    test: (q) => /etf.*inleg|inleg.*etf|maandelijkse inleg|netto maandlast|mirror|koppeling/.test(q),
    answer: (ctx) => {
      const b = getApartmentMonthlyOutflowBreakdown(ctx.config);
      return `**Maandelijkse ETF-inleg** (bij koppeling aan appartement):

Formule startmaand: max(0, lening + kosten − huur)

• Leningaflossing: ${formatCurrency(b.mortgageOutflow)}/maand
• − Huur: ${formatCurrency(b.monthlyRent)}/maand
• + Jaarlijkse kosten ÷ 12: ${formatCurrency(b.monthlyAnnualCosts)}/maand
• + Aangepaste kosten maand 1: ${formatCurrency(b.monthlyCustomCosts)}/maand

**→ Inleg in dashboard:** ${formatCurrency(ctx.config.etf.contributionAmount)}/maand  
Initieel ETF-bedrag: ${formatCurrency(ctx.config.etf.initialLumpSum)} (= eigen inbreng appartement ${formatCurrency(ctx.config.apartment.downPayment)}).`;
    },
  },
  {
    id: 'etf-final',
    test: (q) => /etf.*(eind|vermogen|waarde)|eindvermogen.*etf/.test(q),
    answer: (ctx) => {
      const { results, viewMode } = ctx;
      if (!results) return answerWithNoResults();
      const m = viewMetrics(results, viewMode, 'etf');
      return `**ETF eindvermogen** (${viewMode === 'real' ? 'reëel' : 'nominaal'}):

• Geïnvesteerd totaal: ${formatCurrency(m.cashInvested)}
• Eindvermogen: ${formatCurrency(m.finalNetWorth)}
• Winst: ${formatCurrency(m.finalNetWorth - m.cashInvested)}

Berekening: start ${formatCurrency(ctx.config.etf.initialLumpSum)}, elke maand compound groei op het saldo + vaste inleg ${formatCurrency(ctx.config.etf.contributionAmount)} (${ctx.config.etf.contributionFrequency === 'semiannual' ? 'elke 6 maanden' : 'maandelijks'}) over ${ctx.config.global.horizonYears} jaar.`;
    },
  },
  {
    id: 'apartment-final',
    test: (q) => (isApartmentQuery(q) || /\bapp\b.*vermogen|vermogen.*\bapp\b/.test(q)) && /eind|vermogen|waarde|totaal/.test(q) && parseYearFromQuestion(q) === null && !/jaar\s*0/.test(q),
    answer: (ctx) => {
      const { results, viewMode, config } = ctx;
      if (!results) return answerWithNoResults();
      const m = viewMetrics(results, viewMode, 'apartment');
      const exit = config.global.propertyExitMode === 'sell'
        ? `Woning wordt verkocht (− ${config.global.sellingCostsPct}% verkoopkosten).`
        : 'Woning wordt niet verkocht; waarde blijft in vermogen.';
      return `**Appartement eindvermogen** (${viewMode === 'real' ? 'reëel' : 'nominaal'}):

• Geïnvesteerd (eigen geld): ${formatCurrency(m.cashInvested)}
• Eindvermogen: ${formatCurrency(m.finalNetWorth)}

**Opbouw:** net worth = equity (waarde − restschuld) + opgebouwd huur-overschot.  
${exit}`;
    },
  },
  {
    id: 'loan',
    test: (q) => /lening|hypotheek|aflossing|rente.*lening|maandlast.*lening/.test(q),
    answer: (ctx) => {
      const md = getMortgageDetails(ctx.config);
      const purchase = getPurchasePrice(ctx.config.apartment);
      const closing = getTotalClosingCosts(ctx.config.apartment);
      return `**Lening appartement:**

• Aankoopprijs: ${formatCurrency(purchase)}
• Bijkomende kosten: ${formatCurrency(closing)}
• Eigen inbreng: ${formatCurrency(ctx.config.apartment.downPayment)}
• **Leningbedrag:** ${formatCurrency(md.loanPrincipal)}

**Maandelijkse annuïteit:** ${formatCurrency(md.monthlyPayment)}  
(Rente ${md.annualRate}%, looptijd ${ctx.config.global.horizonYears} jaar = ${md.termMonths} maanden)

Formule: klassieke annuïteit; elke maand rente over restschuld + aflossing.`;
    },
  },
  {
    id: 'annual-costs',
    test: (q) => /jaarlijkse kosten|syndicus|reservefonds|leegstand|onroerende|brandverzekering|herstelling/.test(q),
    answer: (ctx) => {
      const apt = ctx.config.apartment;
      const lines = ANNUAL_COST_FIELDS.map(({ key, label }) => {
        const v = Number(apt[key]) || 0;
        return `• ${label}: ${formatCurrency(v)}`;
      });
      const total = getTotalAnnualCosts(apt);
      return `**Jaarlijkse kosten appartement** (totaal ${formatCurrency(total)}/jaar):

${lines.join('\n')}

In de simulatie: totaal ÷ 12 per maand, plus eventuele aangepaste kosten.`;
    },
  },
  {
    id: 'closing-costs',
    test: (q) => /bijkomende kosten|notaris|btw.*gebouw|registratie/.test(q),
    answer: (ctx) => {
      const total = getTotalClosingCosts(ctx.config.apartment);
      return `**Bijkomende kosten** (totaal ${formatCurrency(total)}):

BTW op gebouw, registratiebelasting grond, notaris, administratie, enz. (zie drawer "Bijkomende kosten").

• Dag 0 appartement: eigen inbreng + bijkomende kosten telt mee als geïnvesteerd.
• Lening = aankoopprijs + bijkomende kosten − eigen inbreng (tenzij handmatig overschreven).`;
    },
  },
  {
    id: 'roi-cagr',
    test: (q) => /roi|rendement|cagr|jaargemiddeld/.test(q),
    answer: (ctx) => {
      const { results, viewMode } = ctx;
      if (!results) return answerWithNoResults();
      const apt = viewMetrics(results, viewMode, 'apartment');
      const etf = viewMetrics(results, viewMode, 'etf');
      return `**ROI & CAGR** (${viewMode === 'real' ? 'reëel' : 'nominaal'}):

**Appartement**
• ROI = (eindvermogen − geïnvesteerd) / geïnvesteerd = ${formatPct(apt.totalRoi)}
• CAGR ≈ ${formatPct(apt.cagr)} over ${ctx.config.global.horizonYears} jaar

**ETF**
• ROI = ${formatPct(etf.totalRoi)}
• CAGR ≈ ${formatPct(etf.cagr)}

CAGR: (eind/start)^(1/jaren) − 1 op geïnvesteerd vs eindvermogen.`;
    },
  },
  {
    id: 'invested',
    test: (q) => /geïnvesteerd|eigen geld|cash invested|uit pocket/.test(q),
    answer: (ctx) => {
      const { results, viewMode } = ctx;
      if (!results) return answerWithNoResults();
      const apt = viewMetrics(results, viewMode, 'apartment');
      const etf = viewMetrics(results, viewMode, 'etf');
      return `**Geïnvesteerd bedrag** = cumulatief uit eigen pocket:

**Appartement:** ${formatCurrency(apt.cashInvested)}  
(start: eigen inbreng + bijkomende kosten; daarna maanden met negatieve kasstroom)

**ETF:** ${formatCurrency(etf.cashInvested)}  
(start + alle maandelijkse inleggen)`;
    },
  },
  {
    id: 'breakeven',
    test: (q) => /terugverdien|break.?even|wanneer.*winst/.test(q),
    answer: (ctx) => {
      const { results } = ctx;
      if (!results) return answerWithNoResults();
      const apt = results.apartment.breakEvenYear;
      const etf = results.etf.breakEvenYear;
      return `**Terugverdientijd** = eerste jaar waarin vermogen ≥ cumulatief geïnvesteerd:

• Appartement: ${apt !== null ? `jaar ${apt}` : 'niet binnen horizon'}
• ETF: ${etf !== null ? `jaar ${etf}` : 'niet binnen horizon'}`;
    },
  },
  {
    id: 'crossover-winner',
    test: (q) => /kruispunt|winnaar|verschil|voordeel|wie wint/.test(q),
    answer: (ctx) => {
      const { results, viewMode } = ctx;
      if (!results) return answerWithNoResults();
      const aptM = viewMetrics(results, viewMode, 'apartment');
      const etfM = viewMetrics(results, viewMode, 'etf');
      const diff = aptM.finalNetWorth - etfM.finalNetWorth;
      const cross = findCrossoverYear(results.apartment, results.etf, viewMode);
      const winner = diff >= 0 ? 'Huurappartement' : 'ETF-tracker';
      return `**Vergelijking** (${viewMode === 'real' ? 'reëel' : 'nominaal'}):

• Winnaar eindvermogen: **${winner}**
• Verschil: ${formatCurrency(Math.abs(diff))} in het voordeel van ${winner}
• Kruispunt (wissel leider): ${cross !== null ? `jaar ${cross}` : 'geen wissel in deze periode'}`;
    },
  },
  {
    id: 'real-nominal',
    test: (q) => /nominaal|reëel|inflatie|gecorrigeerd/.test(q),
    answer: (ctx) => {
      const inf = ctx.config.global.inflationRate;
      return `**Nominaal vs reëel:**

• **Nominaal:** bedragen zoals berekend in toekomstige euro's.
• **Reëel:** gedeeld door (1 + inflatie%)^tijd → koopkracht van vandaag.

Inflatie in scenario: ${inf}%/jaar.  
Tab "Gecorrigeerd voor inflatie" toont reële KPI's en grafieken.`;
    },
  },
  {
    id: 'rent',
    test: (q) => /huur|huuropbrengst|huurgroei/.test(q),
    answer: (ctx) => {
      const a = ctx.config.apartment;
      return `**Huur appartement:**

• Start: ${formatCurrency(a.monthlyRent)}/maand
• Huurgroei: ${a.rentGrowthRate}%/jaar (jaarlijks opgeteld in simulatie)
• Netto kasstroom: huur − lening − kosten (zie maandlast-formule)`;
    },
  },
  {
    id: 'help',
    test: (q) => /^(help|hallo|hoi|menu|\?)$/,
    answer: () => WELCOME_MESSAGE,
  },
];

export function answerQuestion(question, context) {
  const q = normalizeQuestion(question);
  if (!q) return 'Stel een vraag over een cijfer of berekening in het dashboard.';

  if (!isDashboardQuestion(q)) {
    return OFF_TOPIC_MESSAGE;
  }

  for (const intent of INTENTS) {
    if (intent.test(q)) {
      try {
        return intent.answer(context, q);
      } catch {
        return 'Ik kon die uitleg niet genereren door een ontbrekend cijfer. Controleer of het dashboard geldige KPI\'s toont.';
      }
    }
  }

  const year = parseYearFromQuestion(q);
  if (year !== null && /vermogen|geïnvesteerd/.test(q)) {
    const which = isEtfQuery(q) && !isApartmentQuery(q) ? 'etf' : 'apartment';
    return explainYearSnapshot(context, year, which);
  }

  if (/\bapp\b|app vermogen/.test(q) && /vermogen|geïnvesteerd|berekend|hoe/.test(q)) {
    if (/jaar\s*0|start|begin/.test(q)) return explainYearSnapshot(context, 0, 'apartment');
    return INTENTS.find((i) => i.id === 'apartment-final').answer(context);
  }

  if (/etf/.test(q)) return INTENTS.find((i) => i.id === 'etf-final').answer(context);
  if (isApartmentQuery(q)) return INTENTS.find((i) => i.id === 'apartment-final').answer(context);
  if (/lening|leningbedrag/.test(q)) return INTENTS.find((i) => i.id === 'loan').answer(context);
  if (/vermogen/.test(q) && /hoe|berekend|waarom/.test(q)) {
    return `Bedoel je **App. vermogen** of **ETF vermogen**? Specificeer bv. "App. vermogen jaar 0" of "ETF eindvermogen".`;
  }

  return UNKNOWN_DASHBOARD_MESSAGE;
}

function renderMarkdownLite(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

export function initChatAssistant({ getContext }) {
  const toggle = document.getElementById('chatAssistantToggle');
  const panel = document.getElementById('chatAssistantPanel');
  const closeBtn = document.getElementById('chatAssistantClose');
  const messagesEl = document.getElementById('chatAssistantMessages');
  const form = document.getElementById('chatAssistantForm');
  const input = document.getElementById('chatAssistantInput');

  if (!toggle || !panel || !messagesEl || !form || !input) return;

  function appendMessage(role, html) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg-${role}`;
    div.innerHTML = role === 'assistant' ? renderMarkdownLite(html) : escapeHtml(html);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  closeBtn?.addEventListener('click', closePanel);

  appendMessage('assistant', WELCOME_MESSAGE);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    appendMessage('user', text);
    input.value = '';
    const reply = answerQuestion(text, getContext());
    appendMessage('assistant', reply);
  });
}
