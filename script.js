/**
 * SubSage — subscription tracker
 * Data: array of { name, cost, usage, included, lastUpdated? }
 * usage: "high" (Frequently), "medium" (Occasionally), "low" (Not Used)
 */

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
const futureAmountEl = document.getElementById("future-amount");
const cancelList = document.getElementById("cancel-list");
const cancelEmpty = document.getElementById("cancel-empty");

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

  // Leakage message
  leakageMsg.textContent =
    "You are wasting " +
    formatMoney(wasteMonthly) +
    "/month on low-value subscriptions.";

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
      li.textContent =
        "Cancel " + s.name + " → save " + formatMoney(yearlySave) + "/year";
      cancelList.appendChild(li);
    }
  }
  cancelEmpty.style.display = hasSuggestions ? "none" : "block";

  updateCostBarChart(active);
  updateFutureGainLineChart(wasteMonthly);

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

// First paint
renderList();
