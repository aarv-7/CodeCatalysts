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
const subList = document.getElementById("sub-list");
const emptyMsg = document.getElementById("empty-msg");
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
}

/**
 * Edit: prompts for new values, then updates the object and re-renders.
 * Cancel any prompt (Esc) to leave everything unchanged.
 */
function editSubscription(s) {
  const nameIn = prompt("Subscription name:", s.name);
  if (nameIn === null) return;
  const name = nameIn.trim();
  if (!name) {
    alert("Name cannot be empty.");
    return;
  }

  const costIn = prompt("Monthly cost (₹):", String(s.cost));
  if (costIn === null) return;
  const cost = parseFloat(costIn);
  if (isNaN(cost) || cost < 0) {
    alert("Please enter a valid cost (0 or more).");
    return;
  }

  const currentChoice =
    s.usage === "high" ? "1" : s.usage === "medium" ? "2" : "3";
  const usageIn = prompt(
    "Usage — enter 1 = Frequently, 2 = Occasionally, 3 = Not used:",
    currentChoice
  );
  if (usageIn === null) return;
  const u = usageIn.trim();
  let usage = s.usage;
  if (u === "1") usage = "high";
  else if (u === "2") usage = "medium";
  else if (u === "3") usage = "low";
  else {
    alert("Please enter 1, 2, or 3.");
    return;
  }

  s.name = name;
  s.cost = cost;
  s.usage = usage;
  s.lastUpdated = new Date().toISOString();
  renderList();
}

function renderList() {
  subList.innerHTML = "";
  emptyMsg.style.display = subscriptions.length === 0 ? "block" : "none";

  subscriptions.forEach((s) => {
    const li = document.createElement("li");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = s.included;
    cb.title = "Include in calculations (what-if)";
    cb.setAttribute("aria-label", "Include " + s.name + " in calculations");
    // Live update when toggled
    cb.addEventListener("change", () => {
      s.included = cb.checked;
      recalculate();
    });

    const meta = document.createElement("div");
    meta.className = "sub-meta";
    const main = document.createElement("div");
    main.className = "sub-main";
    const label =
      s.usage === "high"
        ? "Frequently"
        : s.usage === "medium"
          ? "Occasionally"
          : "Not Used";
    main.textContent =
      s.name + " — " + formatMoney(s.cost) + "/mo — " + label;
    const updated = document.createElement("div");
    updated.className = "sub-updated";
    updated.textContent = formatLastUpdated(s.lastUpdated);
    meta.appendChild(main);
    meta.appendChild(updated);

    const actions = document.createElement("div");
    actions.className = "sub-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editSubscription(s));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const i = subscriptions.indexOf(s);
      if (i !== -1) subscriptions.splice(i, 1);
      renderList(); // ends with recalculate()
    });

    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);

    li.appendChild(cb);
    li.appendChild(meta);
    li.appendChild(actions);
    subList.appendChild(li);
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
