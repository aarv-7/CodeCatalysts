const subscriptions = [];

const ANNUAL_RATE = 0.1;
const YEARS = 5;

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

let costBarChart = null;

const BAR_COLOR = {
  high: "#16a34a",
  medium: "#eab308",
  low: "#dc2626",
};

function formatMoney(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}


function wasteFraction(usage) {
  if (usage === "low") return 1;
  if (usage === "medium") return 0.5;
  return 0;
}


function usageScore(usage) {
  if (usage === "high") return 3;
  if (usage === "medium") return 2;
  return 1;
}


function futureValueOfMonthlySavings(monthlyPayment, yearlyRate, years) {
  if (monthlyPayment <= 0) return 0;
  const monthlyRate = yearlyRate / 12;
  const n = years * 12;
  if (monthlyRate === 0) return monthlyPayment * n;
  const factor = Math.pow(1 + monthlyRate, n) - 1;
  return monthlyPayment * (factor / monthlyRate);
}

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

function recalculate() {
  const active = activeSubs();

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

  leakageMsg.textContent =
    "You are wasting " +
    formatMoney(wasteMonthly) +
    "/month on low-value subscriptions.";

  const fv = futureValueOfMonthlySavings(wasteMonthly, ANNUAL_RATE, YEARS);
  futureAmountEl.textContent = formatMoney(fv);

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

    cb.addEventListener("change", () => {
      s.included = cb.checked;
      recalculate();
    });

    const meta = document.createElement("span");
    meta.className = "sub-meta";
    const label =
      s.usage === "high"
        ? "Frequently"
        : s.usage === "medium"
          ? "Occasionally"
          : "Not Used";
    meta.textContent =
      s.name + " — " + formatMoney(s.cost) + "/mo — " + label;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const i = subscriptions.indexOf(s);
      if (i !== -1) subscriptions.splice(i, 1);
      renderList();
    });

    li.appendChild(cb);
    li.appendChild(meta);
    li.appendChild(removeBtn);
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
    usage,
    included: true,
  });

  form.reset();
  document.getElementById("sub-usage").value = "high";
  renderList();
});

renderList();
