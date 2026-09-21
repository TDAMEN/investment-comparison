import { findCrossoverYear } from './calculators.js';

let netWorthChart = null;
let comparisonChart = null;

const CHART_COLORS = {
  apartment: '#3b82f6',
  etf: '#10b981',
  invested: '#94a3b8',
  apartmentBg: 'rgba(59, 130, 246, 0.1)',
  etfBg: 'rgba(16, 185, 129, 0.1)',
  crossover: 'rgba(245, 158, 11, 0.85)',
};

const VIEW_SUBTITLES = {
  nominal: 'Nominaal (niet gecorrigeerd voor inflatie)',
  real: 'Gecorrigeerd voor inflatie (reëel)',
};

function crossoverLinePlugin(crossoverYear) {
  return {
    id: 'crossoverLine',
    afterDraw(chart) {
      if (crossoverYear === null || crossoverYear === undefined) return;

      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const labelIndex = chart.data.labels.indexOf(`J${crossoverYear}`);
      if (labelIndex < 0) return;

      const x = xScale.getPixelForValue(labelIndex);
      if (x < chartArea.left || x > chartArea.right) return;

      ctx.save();
      ctx.strokeStyle = CHART_COLORS.crossover;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = CHART_COLORS.crossover;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Kruispunt J${crossoverYear}`, x, chartArea.top + 12);
      ctx.restore();
    },
  };
}

export function renderCharts(results, viewMode, currencySymbol, crossoverYear) {
  const crossover = crossoverYear ?? findCrossoverYear(results.apartment, results.etf, viewMode);
  renderNetWorthChart(results, viewMode, currencySymbol, crossover);
  renderComparisonChart(results, viewMode, currencySymbol);
}

function formatCurrency(value, symbol) {
  return `${symbol}${Math.round(value).toLocaleString('nl-NL')}`;
}

function getSeriesData(result, viewMode) {
  const snapshots = viewMode === 'real' ? result.real.yearlySnapshots : result.yearlySnapshots;
  return snapshots.map((s) => s.netWorth);
}

function getMetrics(result, viewMode) {
  if (viewMode === 'real') {
    return {
      cashInvested: result.real.cashInvested,
      finalNetWorth: result.real.finalNetWorth,
    };
  }
  return {
    cashInvested: result.cashInvested,
    finalNetWorth: result.finalNetWorth,
  };
}

function renderNetWorthChart(results, viewMode, currencySymbol, crossoverYear) {
  const canvas = document.getElementById('netWorthChart');
  if (!canvas) return;

  const subtitleEl = document.getElementById('netWorthChartSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = VIEW_SUBTITLES[viewMode] || '';
  }

  const labels = results.apartment.yearlySnapshots.map((s) => `J${s.year}`);
  const apartmentData = getSeriesData(results.apartment, viewMode);
  const etfData = getSeriesData(results.etf, viewMode);

  if (netWorthChart) {
    netWorthChart.destroy();
  }

  netWorthChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Huurappartement',
          data: apartmentData,
          borderColor: CHART_COLORS.apartment,
          backgroundColor: CHART_COLORS.apartmentBg,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHitRadius: 8,
        },
        {
          label: 'ETF-tracker',
          data: etfData,
          borderColor: CHART_COLORS.etf,
          backgroundColor: CHART_COLORS.etfBg,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHitRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, currencySymbol)}`,
            afterBody: (items) => {
              if (items.length < 2) return [];
              const aptVal = items.find((i) => i.dataset.label === 'Huurappartement')?.parsed.y;
              const etfVal = items.find((i) => i.dataset.label === 'ETF-tracker')?.parsed.y;
              if (aptVal === undefined || etfVal === undefined) return [];
              const diff = aptVal - etfVal;
              const sign = diff >= 0 ? '+' : '';
              return [`Voordeel appartement: ${sign}${formatCurrency(diff, currencySymbol)}`];
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => formatCurrency(v, currencySymbol),
          },
        },
      },
    },
    plugins: [crossoverLinePlugin(crossoverYear)],
  });
}

function renderComparisonChart(results, viewMode, currencySymbol) {
  const canvas = document.getElementById('comparisonChart');
  if (!canvas) return;

  const aptMetrics = getMetrics(results.apartment, viewMode);
  const etfMetrics = getMetrics(results.etf, viewMode);

  const footnoteEl = document.getElementById('comparisonChartFootnote');
  if (footnoteEl) {
    footnoteEl.textContent =
      `Geïnvesteerd: appartement ${formatCurrency(aptMetrics.cashInvested, currencySymbol)} · ETF ${formatCurrency(etfMetrics.cashInvested, currencySymbol)}`;
  }

  if (comparisonChart) {
    comparisonChart.destroy();
  }

  comparisonChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Huurappartement', 'ETF-tracker'],
      datasets: [
        {
          label: 'Eindvermogen',
          data: [aptMetrics.finalNetWorth, etfMetrics.finalNetWorth],
          backgroundColor: [CHART_COLORS.apartment, CHART_COLORS.etf],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, currencySymbol)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => formatCurrency(v, currencySymbol),
          },
        },
      },
    },
  });
}

export function destroyCharts() {
  if (netWorthChart) netWorthChart.destroy();
  if (comparisonChart) comparisonChart.destroy();
  netWorthChart = null;
  comparisonChart = null;
}
