const subscriptions = [];

const ANNUAL_RATE = 0.1; // 10% per year
const YEARS = 5;

// DOM elements
const form = document.getElementById("sub-form");
const subListRight = document.getElementById("sub-list-right");
const emptyMsgRight = document.getElementById("empty-msg-right");
const editOverlay = document.getElementById("edit-overlay");
const editForm = document.getElementById("edit-form");
const editName = document.getElementById("edit-name");
const editCost = document.getElementById("edit-cost");
const editUsage = document.getElementById("edit-usage");
const editCancel = document.getElementById("edit-cancel");
const totalMonthlyEl = document.getElementById("total-monthly");
const totalYearlyEl = document.getElementById("total-yearly");
const healthScoreEl = document.getElementById("health-score");
const gaugeBar = document.getElementById("gauge-bar");
const leakageMsg = document.getElementById("leakage-msg");
const insightsCard = document.getElementById("insights");
const futureAmountEl = document.getElementById("future-amount");
const cancelList = document.getElementById("cancel-list");
const cancelEmpty = document.getElementById("cancel-empty");
const themeToggle = document.getElementById("theme-toggle");
const loadDemoBtn = document.getElementById("load-demo");
const demoToast = document.getElementById("demo-toast");

/** Remember light/dark choice between visits */
const THEME_STORAGE_KEY = "subsage-theme";

/** Sample rows for the "Load demo data" button (replaces current list) */
const DEMO_SUBSCRIPTIONS = [
  { name: "Netflix", cost: 499, usage: "medium" },
  { name: "Spotify", cost: 199, usage: "high" },
  { name: "Amazon Prime", cost: 299, usage: "high" },
  { name: "Hotstar", cost: 149, usage: "low" },
  { name: "Coursera", cost: 399, usage: "high" },
];

/** Chart.js bar chart: one bar per included subscription, color by usage */
let costBarChart = null;

const BAR_COLOR = {
  high: "#16a34a",
  medium: "#eab308",
  low: "#dc2626",
};

/** Line chart: projected balance by year (0–5) from investing monthly waste */
let futureGainLineChart = null;

/** Subscription currently being edited in the modal (null when closed) */
let editingSub = null;

/** Format rupees for display */
function formatMoney(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

/** Show when a subscription was last added or edited */
function formatLastUpdated(isoString) {
  if (!isoString) return "Last updated: —";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "Last updated: —";
  return "Last updated: " + d.toLocaleString();
}

/** Waste fraction: Not Used = 100%, Occasionally = 50%, Frequently = 0% */
function wasteFraction(usage) {
  if (usage === "low") return 1;
  if (usage === "medium") return 0.5;
  return 0;
}

/** Score for health: Frequently=3, Occasionally=2, Not Used=1 */
function usageScore(usage) {
  if (usage === "high") return 3;
  if (usage === "medium") return 2;
  return 1;
}

/**
 * Future value of monthly deposits with compound interest.
 * r = yearly rate, monthlyRate = r/12, n = months
 * FV = P * [((1 + monthlyRate)^n - 1) / monthlyRate]
 */
function futureValueOfMonthlySavings(monthlyPayment, yearlyRate, years) {
  if (monthlyPayment <= 0) return 0;
  const monthlyRate = yearlyRate / 12;
  const n = years * 12;
  if (monthlyRate === 0) return monthlyPayment * n;
  const factor = Math.pow(1 + monthlyRate, n) - 1;
  return monthlyPayment * (factor / monthlyRate);
}

/** Only rows checked (included) count toward totals */
function activeSubs() {
  return subscriptions.filter((s) => s.included);
}

function ensureCostBarChart() {
  if (costBarChart) return;
  const canvas = document.getElementById("cost-bar-chart");
  if (!canvas || typeof Chart === "undefined") return;
  costBarChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Monthly cost (₹)",
          data: [],
          backgroundColor: [],
          borderWidth: 0,
          borderRadius: 6,
          maxBarThickness: 56,
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
            label: function (ctx) {
              const v = ctx.parsed.y;
              return typeof v === "number" ? formatMoney(v) + "/mo" : "";
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 50,
            minRotation: 0,
            autoSkip: true,
            font: { size: 12 },
          },
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Monthly cost (₹)",
            font: { size: 12 },
          },
          ticks: {
            font: { size: 11 },
          },
        },
      },
    },
  });
}

/** X = subscription names, Y = monthly ₹, colors by usage (included rows only) */
function updateCostBarChart(active) {
  ensureCostBarChart();
  if (!costBarChart) return;

  const labels = [];
  const data = [];
  const colors = [];

  for (const s of active) {
    labels.push(s.name);
    data.push(s.cost);
    colors.push(BAR_COLOR[s.usage] || BAR_COLOR.low);
  }

  costBarChart.data.labels = labels;
  costBarChart.data.datasets[0].data = data;
  costBarChart.data.datasets[0].backgroundColor = colors;
  costBarChart.update();
}

/**
 * Future gain line chart: one point per year 0…5.
 * Uses the same formula as the big number: each year y is the future value of
 * depositing `wasteMonthly` every month for y years at ANNUAL_RATE (compound).
 * Year 0 = ₹0 (no months invested yet).
 */
function futureGainPointsByYear(wasteMonthly) {
  const labels = [];
  const data = [];
  for (let y = 0; y <= YEARS; y++) {
    labels.push(String(y));
    data.push(futureValueOfMonthlySavings(wasteMonthly, ANNUAL_RATE, y));
  }
  return { labels, data };
}

function ensureFutureGainLineChart() {
  if (futureGainLineChart) return;
  const canvas = document.getElementById("future-line-chart");
  if (!canvas || typeof Chart === "undefined") return;
  futureGainLineChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: ["0", "1", "2", "3", "4", "5"],
      datasets: [
        {
          label: "Projected balance",
          data: [0, 0, 0, 0, 0, 0],
          borderColor: "#15803d",
          backgroundColor: "rgba(21, 128, 61, 0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: 4,
          pointHoverRadius: 6,
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
            label: function (ctx) {
              const v = ctx.parsed.y;
              return typeof v === "number" ? formatMoney(v) : "";
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Years", font: { size: 11 } },
          ticks: { font: { size: 11 } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Amount (₹)", font: { size: 11 } },
          ticks: { font: { size: 10 } },
        },
      },
    },
  });
}

function updateFutureGainLineChart(wasteMonthly) {
  ensureFutureGainLineChart();
  if (!futureGainLineChart) return;
  const { labels, data } = futureGainPointsByYear(wasteMonthly);
  futureGainLineChart.data.labels = labels;
  futureGainLineChart.data.datasets[0].data = data;
  futureGainLineChart.update();
}

/** Match chart text/line colors to light vs dark (body.dark-mode) */
function applyChartTheme() {
  const dark = document.body.classList.contains("dark-mode");
  const tick = dark ? "#a8a8a8" : "#64748b";
  const titleColor = dark ? "#c4c4c4" : "#475569";

  if (costBarChart) {
    costBarChart.options.scales.x.ticks.color = tick;
    costBarChart.options.scales.y.ticks.color = tick;
    if (costBarChart.options.scales.y.title) {
      costBarChart.options.scales.y.title.color = titleColor;
    }
    costBarChart.update("none");
  }

  if (futureGainLineChart) {
    futureGainLineChart.options.scales.x.ticks.color = tick;
    futureGainLineChart.options.scales.y.ticks.color = tick;
    if (futureGainLineChart.options.scales.x.title) {
      futureGainLineChart.options.scales.x.title.color = titleColor;
    }
    if (futureGainLineChart.options.scales.y.title) {
      futureGainLineChart.options.scales.y.title.color = titleColor;
    }
    futureGainLineChart.data.datasets[0].borderColor = dark ? "#4ade80" : "#15803d";
    futureGainLineChart.data.datasets[0].backgroundColor = dark
      ? "rgba(74, 222, 128, 0.12)"
      : "rgba(21, 128, 61, 0.12)";
    futureGainLineChart.update("none");
  }
}

function updateThemeToggleButton() {
  if (!themeToggle) return;
  const dark = document.body.classList.contains("dark-mode");
  themeToggle.textContent = dark ? "☀️" : "🌙";
  themeToggle.setAttribute(
    "aria-label",
    dark ? "Switch to light mode" : "Switch to dark mode"
  );
}

/** Apply theme class + save preference + refresh charts */
function setDarkMode(on) {
  if (on) document.body.classList.add("dark-mode");
  else document.body.classList.remove("dark-mode");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, on ? "dark" : "light");
  } catch (e) {
    /* ignore private mode / storage blocked */
  }
  updateThemeToggleButton();
  applyChartTheme();
}

function loadSavedTheme() {
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === "dark") {
      document.body.classList.add("dark-mode");
    }
  } catch (e) {
    /* ignore */
  }
  updateThemeToggleButton();
}

/** Fills app with demo subscriptions and refreshes all UI (clears list first) */
function loadDemoData() {
  subscriptions.length = 0;
  const now = new Date().toISOString();
  DEMO_SUBSCRIPTIONS.forEach(function (row) {
    subscriptions.push({
      name: row.name,
      cost: row.cost,
      usage: row.usage,
      included: true,
      lastUpdated: now,
    });
  });
  renderList();
  applyChartTheme();

  if (demoToast) {
    demoToast.hidden = false;
    window.clearTimeout(window._subsageDemoToast);
    window._subsageDemoToast = window.setTimeout(function () {
      demoToast.hidden = true;
    }, 4000);
  }
}

function recalculate() {
  const active = activeSubs();

  // Totals
  let monthly = 0;
  let wasteMonthly = 0;
  let scoreSum = 0;

  for (const s of active) {
    monthly += s.cost;
    wasteMonthly += s.cost * wasteFraction(s.usage);
    scoreSum += usageScore(s.usage);
  }

  const yearly = monthly * 12;
  totalMonthlyEl.textContent = formatMoney(monthly);
  totalYearlyEl.textContent = formatMoney(yearly);

  // Health: average score 1–3 → percentage of max (3)
  let healthPct = 0;
  if (active.length > 0) {
    const avg = scoreSum / active.length;
    healthPct = (avg / 3) * 100;
  }
  healthScoreEl.textContent = Math.round(healthPct) + "%";
  gaugeBar.style.width = healthPct + "%";

  // Insights: negative if any monthly waste, else positive encouragement
  if (wasteMonthly > 0) {
    leakageMsg.textContent =
      "You are wasting " +
      formatMoney(wasteMonthly) +
      "/month on low-value subscriptions.";
    if (insightsCard) {
      insightsCard.classList.remove("insights--positive");
      insightsCard.classList.add("insights--negative");
    }
  } else {
    leakageMsg.textContent =
      "Great job! You're using your subscriptions efficiently.";
    if (insightsCard) {
      insightsCard.classList.remove("insights--negative");
      insightsCard.classList.add("insights--positive");
    }
  }

  // Future gain from investing monthly waste
  const fv = futureValueOfMonthlySavings(wasteMonthly, ANNUAL_RATE, YEARS);
  futureAmountEl.textContent = formatMoney(fv);

  // Cancel suggestions: low or medium usage, only if included
  cancelList.innerHTML = "";
  let hasSuggestions = false;
  for (const s of active) {
    if (s.usage === "low" || s.usage === "medium") {
      hasSuggestions = true;
      const yearlySave = s.cost * 12;
      const li = document.createElement("li");
      li.className = "suggestion-item";
      li.textContent =
        "Cancel " + s.name + " → save " + formatMoney(yearlySave) + "/year";
      cancelList.appendChild(li);
    }
  }
  cancelEmpty.style.display = hasSuggestions ? "none" : "block";

  updateCostBarChart(active);
  updateFutureGainLineChart(wasteMonthly);
  applyChartTheme();

  // Light visual cue when dashboard numbers refresh
  pulseValues([
    totalMonthlyEl,
    totalYearlyEl,
    healthScoreEl,
    futureAmountEl,
  ]);
}

/** Subtle flash on stat elements after recalculate (CSS transition) */
function pulseValues(elements) {
  elements.forEach(function (el) {
    if (!el) return;
    el.classList.remove("value-flash");
  });
  requestAnimationFrame(function () {
    elements.forEach(function (el) {
      if (!el) return;
      el.classList.add("value-flash");
      window.setTimeout(function () {
        el.classList.remove("value-flash");
      }, 350);
    });
  });
}

function openEditModal(s) {
  editingSub = s;
  editName.value = s.name;
  editCost.value = String(s.cost);
  editUsage.value = s.usage;
  editOverlay.hidden = false;
  editName.focus();
}

function closeEditModal() {
  editingSub = null;
  editOverlay.hidden = true;
  editForm.reset();
}

/**
 * Apply modal fields to the subscription object, then refresh UI and charts.
 * Using a small form avoids browser issues with chained prompt() dialogs.
 */
function saveEditFromModal() {
  if (!editingSub) return;
  const name = editName.value.trim();
  const cost = parseFloat(editCost.value);
  const usage = editUsage.value;

  if (!name) {
    alert("Please enter a name.");
    return;
  }
  if (isNaN(cost) || cost < 0) {
    alert("Please enter a valid cost (0 or more).");
    return;
  }
  if (usage !== "high" && usage !== "medium" && usage !== "low") {
    alert("Please pick a usage option.");
    return;
  }

  editingSub.name = name;
  editingSub.cost = cost;
  editingSub.usage = usage;
  editingSub.lastUpdated = new Date().toISOString();
  closeEditModal();
  renderList();
}

editForm.addEventListener("submit", function (e) {
  e.preventDefault();
  saveEditFromModal();
});

editCancel.addEventListener("click", closeEditModal);

editOverlay.addEventListener("click", function (e) {
  if (e.target === editOverlay) closeEditModal();
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !editOverlay.hidden) closeEditModal();
});

function usageLabel(usage) {
  if (usage === "high") return "Frequently";
  if (usage === "medium") return "Occasionally";
  return "Not Used";
}

function renderList() {
  subListRight.innerHTML = "";
  const isEmpty = subscriptions.length === 0;
  emptyMsgRight.style.display = isEmpty ? "block" : "none";

  subscriptions.forEach((s) => {
    const card = document.createElement("article");
    card.className = "sub-card sub-card--" + s.usage;
    card.setAttribute("role", "listitem");

    const top = document.createElement("div");
    top.className = "sub-card__top";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "sub-card__check";
    cb.checked = s.included;
    cb.title = "Include in calculations (what-if)";
    cb.setAttribute("aria-label", "Include " + s.name + " in calculations");
    cb.addEventListener("change", function () {
      s.included = cb.checked;
      recalculate();
    });

    const nameEl = document.createElement("strong");
    nameEl.className = "sub-card__name";
    nameEl.textContent = s.name;

    top.appendChild(cb);
    top.appendChild(nameEl);

    const costEl = document.createElement("p");
    costEl.className = "sub-card__cost money-display";
    costEl.textContent = formatMoney(s.cost) + " / month";

    const pill = document.createElement("span");
    pill.className = "usage-pill usage-pill--" + s.usage;
    pill.textContent = usageLabel(s.usage);

    const updated = document.createElement("p");
    updated.className = "sub-card__updated";
    updated.textContent = formatLastUpdated(s.lastUpdated);

    const actions = document.createElement("div");
    actions.className = "sub-card__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn--small btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", function () {
      openEditModal(s);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--small btn--ghost";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", function () {
      const i = subscriptions.indexOf(s);
      if (i !== -1) subscriptions.splice(i, 1);
      renderList();
    });

    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);

    card.appendChild(top);
    card.appendChild(costEl);
    card.appendChild(pill);
    card.appendChild(updated);
    card.appendChild(actions);
    subListRight.appendChild(card);
  });

  recalculate();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("sub-name").value.trim();
  const cost = parseFloat(document.getElementById("sub-cost").value);
  const usage = document.getElementById("sub-usage").value;

  if (!name || isNaN(cost) || cost < 0) return;

  subscriptions.push({
    name,
    cost,
    usage, // "high" | "medium" | "low"
    included: true,
    lastUpdated: new Date().toISOString(),
  });

  form.reset();
  document.getElementById("sub-usage").value = "high";
  renderList();
});

if (themeToggle) {
  themeToggle.addEventListener("click", function () {
    setDarkMode(!document.body.classList.contains("dark-mode"));
  });
}

if (loadDemoBtn) {
  loadDemoBtn.addEventListener("click", loadDemoData);
}

// Restore theme from localStorage, then paint
loadSavedTheme();
renderList();
applyChartTheme();
