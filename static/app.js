const state = {
  stocks: [],
  selected: null,
  paper: JSON.parse(localStorage.getItem("paperTrades") || "[]"),
  baskets: [],
  tax: null,
  marketMode: "US",
  entryFilter: "ALL",
  analyzeRequestId: 0,
  page: 1,
  pageSize: 25,
};

const $ = (id) => document.getElementById(id);

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const krw = (value) => `${fmt(value, 0)}원`;
const money = (stock, value) => `${fmt(value)} ${stock?.currency || ""}`;
const compact = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
};

const pct = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const cls = value >= 0 ? "up" : "down";
  return `<span class="${cls}">${value >= 0 ? "+" : ""}${fmt(value)}%</span>`;
};

const badgeClass = (verdict) => {
  if (verdict === "위험") return "danger";
  if (verdict === "주의") return "warn";
  if (verdict === "관찰") return "watch";
  return "good";
};

const entryClass = (action) => {
  if (action === "진입 가능") return "good";
  if (action === "분할만") return "watch";
  if (action === "대기") return "warn";
  return "danger";
};

const verdictHelp = (verdict) => {
  if (verdict === "상대적 양호") return "현재 지표 기준으로 큰 경고가 적습니다.";
  if (verdict === "관찰") return "바로 매수보다 며칠 더 확인할 후보입니다.";
  if (verdict === "주의") return "나쁘다는 뜻이 아니라 진입 타이밍을 조심하라는 뜻입니다.";
  return "초보자는 일단 제외하거나 모의매수만 권장합니다.";
};

function isKoreanMode() {
  const market = $("market").value;
  const symbols = $("symbols").value;
  return market === "KR" || market === "KR_LISTED_300" || /\.K[QS]\b/i.test(symbols) || /[가-힣]/.test(symbols);
}

function displayTitle(stock) {
  return stock.displayName || stock.name || stock.symbol;
}

function displaySubtitle(stock) {
  const title = displayTitle(stock);
  return title === stock.symbol ? stock.name : stock.symbol;
}

function candidateScore(stock) {
  const month = stock.changes.month ?? 0;
  const year = stock.changes.year ?? 0;
  const divYield = stock.dividend.dividendYieldPct ?? 0;
  const rsi = stock.indicators.rsi14 ?? 50;
  const rsiPenalty = rsi > 70 ? 2 : rsi < 30 ? 1 : 0;
  return stock.riskScore * 3 + rsiPenalty - Math.min(divYield, 5) * 0.5 - Math.min(Math.max(month, -5), 8) * 0.15 - Math.min(Math.max(year, -20), 20) * 0.05;
}

function sortedCandidates(stocks) {
  return [...stocks].sort((a, b) => candidateScore(a) - candidateScore(b));
}

function allocationWeight(stock) {
  const month = stock.changes.month ?? 0;
  const year = stock.changes.year ?? 0;
  const divYield = stock.dividend.dividendYieldPct ?? 0;
  const rsi = stock.indicators.rsi14 ?? 50;
  const trendBonus = (month > 0 ? 0.8 : 0) + (year > 0 ? 0.6 : 0);
  const dividendBonus = Math.min(divYield, 5) * 0.22;
  const riskPenalty = stock.riskScore * 0.45;
  const rsiPenalty = rsi > 72 ? 1.2 : rsi < 28 ? 0.6 : 0;
  return Math.max(0.15, 4 + trendBonus + dividendBonus - riskPenalty - rsiPenalty);
}

function allocationCandidates(stocks) {
  return sortedCandidates(stocks)
    .filter((stock) => stock.verdict !== "위험")
    .filter((stock) => (stock.indicators.rsi14 ?? 50) < 78);
}

function setMarketMode() {
  state.marketMode = isKoreanMode() ? "KR" : "US";
  const isKr = state.marketMode === "KR";
  document.body.dataset.market = state.marketMode;
  $("usPlanner").classList.toggle("hidden", isKr);
  $("krPlanner").classList.toggle("hidden", !isKr);
  $("basketButtons").classList.toggle("hidden", isKr);
  $("symbolsLabel").textContent = isKr ? "한국 종목명 또는 6자리 코드" : "미국 티커 또는 ETF 코드";
  $("safetyTitle").textContent = isKr ? "한국주식 초보자 안전장치" : "초보자 안전장치";
  $("safetyRules").innerHTML = isKr
    ? `
      <li>종목명만 보고 사지 말고 업종, 실적, 배당, 최근 급등 여부를 같이 봅니다.</li>
      <li>코스닥 중소형주는 변동성이 커서 처음에는 대표주/ETF 중심으로 봅니다.</li>
      <li>국내 배당은 보통 15.4% 원천징수 후 입금된다고 단순 가정합니다.</li>
      <li>테마주, 뉴스 급등주는 모의매수로 먼저 관찰합니다.</li>
    `
    : `
      <li>처음부터 목돈을 한 번에 넣지 말고 3~6회로 나눠서 진입합니다.</li>
      <li>개별주는 전체 투자금의 작은 일부로 제한하고, 핵심은 ETF로 둡니다.</li>
      <li>위험/주의 판정 종목은 “왜 사야 하는지”를 기록하기 전에는 매수하지 않습니다.</li>
      <li>대출, 생활비, 1년 안에 쓸 돈은 투자금에서 제외합니다.</li>
    `;
  document.querySelectorAll("[data-market-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.marketTab === $("market").value);
  });
}

function renderSearchResults(items) {
  const target = $("searchResults");
  if (!items.length) {
    target.classList.remove("hidden");
    target.innerHTML = `<div class="search-empty">검색 결과가 없습니다. 종목명이나 티커를 조금 다르게 입력해보세요.</div>`;
    return;
  }
  target.classList.remove("hidden");
  target.innerHTML = items.map((item) => `
    <button class="search-item" data-search-symbol="${item.symbol}">
      <strong>${item.name}</strong>
      <span>${item.symbol} · ${item.market || "-"} · ${item.type || "종목"}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-search-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      $("market").value = "custom";
      $("symbols").disabled = false;
      $("symbols").value = button.dataset.searchSymbol;
      $("searchResults").classList.add("hidden");
      setMarketMode();
      analyze();
    });
  });
}

async function searchStocks() {
  const query = $("stockSearch").value.trim();
  if (!query) {
    $("searchResults").classList.add("hidden");
    return;
  }
  $("searchResults").classList.remove("hidden");
  $("searchResults").innerHTML = `<div class="search-empty">검색 중...</div>`;
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    renderSearchResults(data.results || []);
  } catch (error) {
    $("searchResults").innerHTML = `<div class="search-empty">검색에 실패했습니다. 잠시 후 다시 시도해주세요.</div>`;
  }
}

function savePaper() {
  localStorage.setItem("paperTrades", JSON.stringify(state.paper));
}

function filteredStocks() {
  const hideRisky = $("hideRisky").checked;
  const minMonth = Number($("minMonth").value || -100);
  const maxRsi = Number($("maxRsi").value || 100);
  const minYield = Number($("minYield").value || 0);
  const maxRisk = Number($("maxRisk").value || 99);
  const minPrice = $("minPrice").value === "" ? 0 : Number($("minPrice").value);
  const maxPrice = $("maxPrice").value === "" ? Infinity : Number($("maxPrice").value);
  return state.stocks.filter((stock) => {
    const month = stock.changes.month ?? -999;
    const rsi = stock.indicators.rsi14 ?? 0;
    const divYield = stock.dividend.dividendYieldPct ?? 0;
    if (hideRisky && stock.verdict === "위험") return false;
    if (state.entryFilter === "CANDIDATE" && !["진입 가능", "분할만"].includes(stock.entry?.action)) return false;
    if (state.entryFilter !== "ALL" && state.entryFilter !== "CANDIDATE" && stock.entry?.action !== state.entryFilter) return false;
    return month >= minMonth
      && rsi <= maxRsi
      && divYield >= minYield
      && stock.riskScore <= maxRisk
      && stock.price >= minPrice
      && stock.price <= maxPrice;
  });
}

function pagedStocks(rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const start = (state.page - 1) * state.pageSize;
  return {
    totalPages,
    start,
    rows: rows.slice(start, start + state.pageSize),
  };
}

function resetPageAndRender() {
  state.page = 1;
  renderTable();
}

function setEntryFilter(value) {
  state.entryFilter = value;
  document.querySelectorAll("[data-entry-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.entryFilter === value);
  });
  resetPageAndRender();
}

function portfolioTaxEstimate(rawProfit) {
  const usedDeduction = Number($("usedDeduction").value || 0);
  const available = Math.max(2500000 - usedDeduction, 0);
  const taxable = Math.max(rawProfit - available, 0);
  return taxable * 0.22;
}

function updateMetrics(stocks = filteredStocks()) {
  $("countMetric").textContent = `${stocks.length}/${state.stocks.length}`;
  $("riskMetric").textContent = stocks.filter((s) => ["위험", "주의"].includes(s.verdict)).length;
  const monthValues = stocks.map((s) => s.changes.month).filter((v) => v !== null && v !== undefined);
  const avg = monthValues.length ? monthValues.reduce((a, b) => a + b, 0) / monthValues.length : null;
  $("avgMetric").innerHTML = avg === null ? "-" : pct(avg);

  const investment = Number($("investmentKrw").value || 0);
  const perStock = stocks.length ? investment / stocks.length : 0;
  const expectedDiv = stocks.reduce((sum, stock) => {
    const y = stock.dividend.dividendYieldPct || 0;
    const withholding = stock.currency === "USD" ? 0.85 : 0.846;
    return sum + perStock * (y / 100) * withholding;
  }, 0);
  $("divMetric").textContent = expectedDiv ? krw(expectedDiv) : "-";

  const totalProfit = state.paper.reduce((sum, trade) => {
    const stock = state.stocks.find((item) => item.symbol === trade.symbol);
    if (!stock) return sum;
    return sum + (stock.price - trade.buyPrice) * trade.quantity * (stock.currency === "USD" ? trade.fxRate || 1350 : 1);
  }, 0);
  const tax = portfolioTaxEstimate(totalProfit);
  const afterTax = totalProfit - tax;
  $("paperMetric").innerHTML = totalProfit === 0 ? "-" : `<span class="${afterTax >= 0 ? "up" : "down"}">${krw(afterTax)}</span>`;
  renderAllocationPlan(stocks);
}

function drawReturnChart(stocks) {
  const container = $("returnChart");
  if (!container) return;
  if (!stocks.length) {
    container.innerHTML = `<div class="chart-empty">표시할 종목이 없습니다.</div>`;
    return;
  }
  const ordered = [...stocks].sort((a, b) => (b.changes.month ?? -999) - (a.changes.month ?? -999)).slice(0, 18);
  const maxAbs = Math.max(1, ...ordered.map((stock) => Math.abs(stock.changes.month ?? 0)));
  container.innerHTML = ordered.map((stock) => {
    const value = stock.changes.month ?? 0;
    const width = Math.max(4, Math.abs(value) / maxAbs * 100);
    return `
      <button class="bar-row" data-chart-symbol="${stock.symbol}" title="${displayTitle(stock)} 최근 1개월 ${fmt(value)}%">
        <span class="bar-name"><strong>${displayTitle(stock)}</strong><em>${stock.symbol}</em></span>
        <span class="bar-track ${value < 0 ? "negative" : "positive"}"><span class="bar-fill" style="width:${width}%"></span></span>
        <span class="bar-value ${value >= 0 ? "up" : "down"}">${value >= 0 ? "+" : ""}${fmt(value)}%</span>
      </button>
    `;
  }).join("");
  bindChartButtons();
}

function drawRiskYieldChart(stocks) {
  const container = $("riskYieldChart");
  if (!container) return;
  if (!stocks.length) {
    container.innerHTML = `<div class="chart-empty">표시할 종목이 없습니다.</div>`;
    return;
  }
  const groups = [
    { title: "낮은 위험 · 배당 있음", test: (s) => s.riskScore <= 3 && (s.dividend.dividendYieldPct || 0) >= 1 },
    { title: "낮은 위험 · 성장형", test: (s) => s.riskScore <= 3 && (s.dividend.dividendYieldPct || 0) < 1 },
    { title: "주의 · 배당 있음", test: (s) => s.riskScore > 3 && s.riskScore <= 6 && (s.dividend.dividendYieldPct || 0) >= 1 },
    { title: "주의 · 성장형", test: (s) => s.riskScore > 3 && s.riskScore <= 6 && (s.dividend.dividendYieldPct || 0) < 1 },
  ];
  container.innerHTML = groups.map((group) => {
    const items = stocks.filter(group.test).slice(0, 6);
    return `
      <div class="risk-bucket">
        <h3>${group.title}</h3>
        ${items.length ? items.map((stock) => `
          <button data-chart-symbol="${stock.symbol}" class="risk-item">
            <strong>${displayTitle(stock)}</strong>
            <span>위험 ${stock.riskScore} · 배당 ${fmt(stock.dividend.dividendYieldPct)}%</span>
          </button>
        `).join("") : `<p>해당 없음</p>`}
      </div>
    `;
  }).join("");
  bindChartButtons();
}

function drawDividendChart(stocks) {
  const container = $("dividendChart");
  if (!container) return;
  if (!stocks.length) {
    container.innerHTML = `<div class="chart-empty">표시할 종목이 없습니다.</div>`;
    return;
  }
  const investment = Number($("investmentKrw").value || 0);
  const perStock = stocks.length ? investment / stocks.length : 0;
  const rows = stocks.map((stock) => {
    const y = stock.dividend.dividendYieldPct || 0;
    const withholding = stock.currency === "USD" ? 0.85 : 0.846;
    return { stock, value: perStock * (y / 100) * withholding };
  }).sort((a, b) => b.value - a.value).slice(0, 18);
  const max = Math.max(1, ...rows.map((row) => row.value));
  container.innerHTML = rows.map(({ stock, value }) => `
    <button class="bar-row" data-chart-symbol="${stock.symbol}" title="${displayTitle(stock)} 예상 세후 연 배당 ${krw(value)}">
      <span class="bar-name"><strong>${displayTitle(stock)}</strong><em>${stock.symbol}</em></span>
      <span class="bar-track dividend"><span class="bar-fill" style="width:${Math.max(4, value / max * 100)}%"></span></span>
      <span class="bar-value">${krw(value)}</span>
    </button>
  `).join("");
  bindChartButtons();
}

function renderOverviewCharts(stocks = filteredStocks()) {
  drawReturnChart(stocks);
  drawRiskYieldChart(stocks);
  drawDividendChart(stocks);
  renderCandidatePicks(stocks);
}

function bindChartButtons() {
  document.querySelectorAll("[data-chart-symbol]").forEach((button) => {
    button.addEventListener("click", () => selectStock(button.dataset.chartSymbol));
  });
}

function renderCandidatePicks(stocks = filteredStocks()) {
  const target = $("candidatePicks");
  if (!target) return;
  if (!stocks.length) {
    target.innerHTML = `<div class="empty">조건에 맞는 후보가 없습니다. 필터를 조금 느슨하게 해보세요.</div>`;
    return;
  }
  target.innerHTML = sortedCandidates(stocks).slice(0, 5).map((stock, index) => `
    <button class="candidate-card" data-chart-symbol="${stock.symbol}">
      <span class="candidate-rank">${index + 1}</span>
      <span class="candidate-title"><strong>${displayTitle(stock)}</strong><em>${displaySubtitle(stock)}</em></span>
      <span class="badge ${badgeClass(stock.verdict)}">${stock.verdict}</span>
      <p>${verdictHelp(stock.verdict)}</p>
      <span class="candidate-stats">위험 ${stock.riskScore} · 1개월 ${stock.changes.month === null ? "-" : `${fmt(stock.changes.month)}%`} · 배당 ${fmt(stock.dividend.dividendYieldPct)}%</span>
    </button>
  `).join("");
  bindChartButtons();
}

function renderAllocationPlan(stocks = filteredStocks()) {
  const target = $("allocationPlan");
  if (!target) return;
  const amount = Number($("allocationAmount")?.value || $("investmentKrw").value || 0);
  const count = Math.max(2, Math.min(10, Number($("allocationCount")?.value || 5)));
  const maxPct = Math.max(10, Math.min(60, Number($("maxPositionPct")?.value || 35)));
  const candidates = allocationCandidates(stocks).slice(0, count);

  if (!amount || amount <= 0) {
    target.innerHTML = `<div class="empty">투자할 금액을 입력하면 배분 예시가 나옵니다.</div>`;
    return;
  }
  if (!candidates.length) {
    target.innerHTML = `<div class="empty">현재 필터 기준으로 배분할 만한 후보가 부족합니다. 위험 제외를 풀거나 ETF/대표주 목록을 다시 분석해보세요.</div>`;
    return;
  }

  let weights = candidates.map((stock) => allocationWeight(stock));
  let total = weights.reduce((sum, value) => sum + value, 0);
  let pcts = weights.map((value) => value / total * 100);
  for (let loop = 0; loop < 6; loop += 1) {
    const overflow = pcts.reduce((sum, pctValue) => sum + Math.max(0, pctValue - maxPct), 0);
    if (overflow <= 0.01) break;
    pcts = pcts.map((pctValue) => Math.min(pctValue, maxPct));
    const under = pcts.map((pctValue, index) => ({ index, room: Math.max(0, maxPct - pctValue) })).filter((item) => item.room > 0);
    const roomTotal = under.reduce((sum, item) => sum + item.room, 0);
    under.forEach((item) => {
      pcts[item.index] += overflow * (item.room / roomTotal);
    });
  }
  const pctTotal = pcts.reduce((sum, value) => sum + value, 0);
  pcts = pcts.map((value) => value / pctTotal * 100);

  target.innerHTML = `
    <div class="allocation-note">
      <strong>추천 방식</strong>
      <span>위험 종목은 제외하고, 위험점수·RSI·최근 추세·배당률을 섞어 분산했습니다. 수익 보장이 아니라 첫 매수 계획용 가이드입니다.</span>
    </div>
    ${candidates.map((stock, index) => {
      const pctValue = pcts[index];
      const won = amount * pctValue / 100;
      const qty = stock.currency === "KRW" ? Math.floor(won / stock.price) : Math.floor(won / ((stock.price || 1) * 1350));
      return `
        <button class="allocation-row" data-chart-symbol="${stock.symbol}">
          <span class="allocation-main"><strong>${displayTitle(stock)}</strong><em>${displaySubtitle(stock)}</em></span>
          <span class="allocation-bar"><span style="width:${pctValue}%"></span></span>
          <span class="allocation-money">${krw(won)}</span>
          <span class="allocation-pct">${fmt(pctValue, 1)}%</span>
          <span class="allocation-qty">대략 ${qty.toLocaleString("ko-KR")}주</span>
        </button>
      `;
    }).join("")}
  `;
  bindChartButtons();
}

function renderBaskets() {
  if (state.marketMode === "KR") {
    $("basketButtons").innerHTML = "";
    return;
  }
  $("basketButtons").innerHTML = state.baskets.map((basket) => `
    <button class="basket-btn" data-symbols="${basket.symbols.join(", ")}">
      <strong>${basket.name}</strong>
      <span>${basket.note}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-symbols]").forEach((button) => {
    button.addEventListener("click", () => {
      $("market").value = "custom";
      $("symbols").disabled = false;
      $("symbols").value = button.dataset.symbols;
      analyze();
    });
  });
}

function renderTable() {
  const rows = filteredStocks();
  const pageData = pagedStocks(rows);
  $("stockRows").innerHTML = pageData.rows.length ? pageData.rows.map((stock) => `
    <tr data-symbol="${stock.symbol}">
      <td>
        <div class="symbol-cell">
          <strong>${displayTitle(stock)}</strong>
          <span>${displaySubtitle(stock)}</span>
        </div>
      </td>
      <td><span class="badge ${badgeClass(stock.verdict)}">${stock.verdict}</span></td>
      <td><span class="entry-pill ${entryClass(stock.entry?.action)}">${stock.entry?.action || "-"}</span></td>
      <td>${money(stock, stock.price)}</td>
      <td>${pct(stock.changes.month)}</td>
      <td>${pct(stock.changes.year)}</td>
      <td>${fmt(stock.indicators.rsi14)}</td>
      <td>${compact(stock.indicators.currentVolume)}</td>
      <td>${fmt(stock.dividend.dividendYieldPct)}%</td>
      <td>${stock.riskScore}</td>
      <td><button class="mini-btn" data-paper="${stock.symbol}">모의매수</button></td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="11">
        <div class="loading-row">조건에 맞는 종목이 없습니다. 가격이나 위험 필터를 조금 넓혀보세요.</div>
      </td>
    </tr>
  `;

  document.querySelectorAll("tr[data-symbol]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.dataset.paper) return;
      selectStock(row.dataset.symbol);
    });
  });

  document.querySelectorAll("[data-paper]").forEach((button) => {
    button.addEventListener("click", () => addPaperTrade(button.dataset.paper));
  });

  renderPagination(rows.length, pageData.totalPages, pageData.start, pageData.rows.length);
  updateMetrics(rows);
  renderOverviewCharts(rows);
}

function renderPagination(totalRows, totalPages, start, pageCount) {
  const target = $("pagination");
  if (!target) return;
  if (!totalRows) {
    target.innerHTML = `
      <span>표시할 종목이 없습니다.</span>
      <div class="pagination-buttons">
        <button type="button" disabled>이전</button>
        <button type="button" disabled>다음</button>
      </div>
    `;
    return;
  }

  const end = start + pageCount;
  target.innerHTML = `
    <span>${start + 1}-${end} / ${totalRows}개 · ${state.page}/${totalPages}페이지</span>
    <div class="pagination-buttons">
      <button id="prevPage" type="button" ${state.page <= 1 ? "disabled" : ""}>이전</button>
      <button id="nextPage" type="button" ${state.page >= totalPages ? "disabled" : ""}>다음</button>
    </div>
  `;

  $("prevPage")?.addEventListener("click", () => {
    state.page -= 1;
    renderTable();
  });
  $("nextPage")?.addEventListener("click", () => {
    state.page += 1;
    renderTable();
  });
}

function renderLoadingState(message) {
  $("stockRows").innerHTML = `
    <tr>
      <td colspan="11">
        <div class="loading-row">${message}</div>
      </td>
    </tr>
  `;
  $("detail").className = "detail-empty";
  $("detail").textContent = state.marketMode === "KR"
    ? "한국 종목 분석 결과를 불러오는 중입니다. 종목명은 삼성전자처럼 표시됩니다."
    : "분석 결과를 불러오는 중입니다. 미국 300개 샘플은 5~8분 정도 걸릴 수 있습니다.";
  $("countMetric").textContent = "0";
  $("riskMetric").textContent = "0";
  $("avgMetric").textContent = "-";
  $("divMetric").textContent = "-";
  $("pagination").innerHTML = "";
  $("candidatePicks").innerHTML = `<div class="empty">분석 중입니다.</div>`;
  $("returnChart").innerHTML = `<div class="chart-empty">분석 중...</div>`;
  $("riskYieldChart").innerHTML = `<div class="chart-empty">분석 중...</div>`;
  $("dividendChart").innerHTML = `<div class="chart-empty">분석 중...</div>`;
}

function drawChart(canvas, history) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth * window.devicePixelRatio;
  const height = canvas.height = canvas.clientHeight * window.devicePixelRatio;
  ctx.clearRect(0, 0, width, height);

  const values = history.map((row) => row.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 18 * window.devicePixelRatio;
  const span = max - min || 1;

  ctx.strokeStyle = "#dce3dd";
  ctx.lineWidth = 1 * window.devicePixelRatio;
  for (let i = 1; i < 4; i++) {
    const y = pad + ((height - pad * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = values[values.length - 1] >= values[0] ? "#1e7a46" : "#b93b3b";
  ctx.lineWidth = 2.5 * window.devicePixelRatio;
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function selectStock(symbol) {
  const stock = state.stocks.find((item) => item.symbol === symbol);
  if (!stock) return;
  state.selected = stock;
  const dividend = stock.dividend;
  $("detail").className = "detail";
  $("detail").innerHTML = `
    <div class="price-line">
      <div>
        <h2>${displayTitle(stock)}</h2>
        <p class="muted">${displaySubtitle(stock)}</p>
      </div>
      <strong>${money(stock, stock.price)}</strong>
    </div>
    <canvas id="chart" class="chart"></canvas>
    <div class="stat-grid">
      <div><span>진입 판단</span><strong>${stock.entry?.action || "-"}</strong></div>
      <div><span>판정</span><strong>${stock.verdict}</strong></div>
      <div><span>위험점수</span><strong>${stock.riskScore}</strong></div>
      <div><span>거래량</span><strong>${compact(stock.indicators.currentVolume)}</strong></div>
      <div><span>최근 1년</span><strong>${stock.changes.year === null ? "-" : `${fmt(stock.changes.year)}%`}</strong></div>
      <div><span>세후 배당률</span><strong>${fmt((dividend.dividendYieldPct || 0) * (stock.currency === "USD" ? 0.85 : 0.846))}%</strong></div>
    </div>
    <div class="insight-list">
      <div class="entry-box ${entryClass(stock.entry?.action)}">
        <strong>${stock.entry?.action || "판단 없음"}</strong>
        <span>${stock.entry?.summary || "판단할 데이터가 부족합니다."}</span>
      </div>
      ${(stock.entry?.reasons || []).map((text) => `<div class="insight positive">${text}</div>`).join("")}
      ${(stock.entry?.blockers || []).map((text) => `<div class="insight warning">${text}</div>`).join("")}
      <div class="insight">최근 1년 주당 배당은 ${money(stock, dividend.annualDividend)}이고, ${stock.currency === "KRW" ? "국내 배당은 단순 계산상 15.4% 원천징수 후" : "미국 배당은 단순 계산상 15% 원천징수 후"} ${money(stock, dividend.afterTaxAnnualDividend)} 정도입니다.</div>
      <div class="insight">최근 거래량은 ${compact(stock.indicators.currentVolume)}주, 20일 평균 대비 ${stock.indicators.volumeRatio ? `${fmt(stock.indicators.volumeRatio)}배` : "-"} 수준입니다.</div>
      <div class="news-box">
        <strong>최근 뉴스 빠른 요약</strong>
        ${(stock.news || []).length ? stock.news.map((item) => `
          <a class="news-item ${item.sentiment === "호재" ? "good" : item.sentiment === "악재" ? "danger" : "neutral"}" href="${item.link}" target="_blank" rel="noreferrer">
            <span>${item.sentiment}</span>
            <em>${item.summary}</em>
          </a>
        `).join("") : `<p>가져온 최근 뉴스가 없습니다.</p>`}
      </div>
      <div class="insight">${stock.tax.capitalGainTaxNote}</div>
      <div class="insight">${stock.tax.dividendTaxNote}</div>
      ${stock.warnings.map((text) => `<div class="insight warning">${text}</div>`).join("")}
      ${stock.positives.map((text) => `<div class="insight positive">${text}</div>`).join("")}
      ${stock.beginnerNotes.map((text) => `<div class="insight">${text}</div>`).join("")}
      <div class="insight">초보자 기준: 이 종목을 사야 하는 이유 3개와 틀렸을 때 팔 기준 1개를 적지 못하면 아직 매수하지 않는 편이 낫습니다.</div>
    </div>
  `;
  drawChart($("chart"), stock.history);
}

function addPaperTrade(symbol) {
  const stock = state.stocks.find((item) => item.symbol === symbol);
  if (!stock) return;
  const quantity = Number(prompt(`${symbol} 모의 매수 수량`, "1"));
  if (!quantity || quantity <= 0) return;
  const fxRate = stock.currency === "USD" ? Number(prompt("적용 환율(원/달러)", "1350")) || 1350 : 1;
  state.paper.push({
    id: crypto.randomUUID(),
    symbol,
    buyPrice: stock.price,
    quantity,
    fxRate,
    currency: stock.currency,
    date: new Date().toISOString().slice(0, 10),
  });
  savePaper();
  renderPaper();
  updateMetrics();
  renderOverviewCharts();
}

function renderPaper() {
  if (!state.paper.length) {
    $("paperTrades").innerHTML = `<div class="empty">아직 모의투자 기록이 없습니다. 종목 옆의 모의매수 버튼으로 시작해보세요.</div>`;
    return;
  }
  $("paperTrades").innerHTML = state.paper.map((trade) => {
    const stock = state.stocks.find((item) => item.symbol === trade.symbol);
    const current = stock?.price;
    const profitPct = current ? ((current - trade.buyPrice) / trade.buyPrice) * 100 : null;
    const rawProfit = current ? (current - trade.buyPrice) * trade.quantity * (trade.currency === "USD" ? trade.fxRate || 1350 : 1) : null;
    const tax = rawProfit && trade.currency === "USD" ? portfolioTaxEstimate(rawProfit) : 0;
    const afterTax = rawProfit === null ? null : rawProfit - tax;
    return `
      <div class="paper-item">
        <strong>${trade.symbol}</strong>
        <span>매수가 ${fmt(trade.buyPrice)}</span>
        <span>수량 ${fmt(trade.quantity, 0)}</span>
        <span>${profitPct === null ? "현재가 갱신 필요" : pct(profitPct)}</span>
        <span>${afterTax === null ? "-" : krw(afterTax)} 세후</span>
        <button class="mini-btn ghost" data-remove="${trade.id}">삭제</button>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.paper = state.paper.filter((trade) => trade.id !== button.dataset.remove);
      savePaper();
      renderPaper();
      updateMetrics();
      renderOverviewCharts();
    });
  });
}

async function calculateTax() {
  const params = new URLSearchParams({
    investmentKrw: $("investmentKrw").value,
    expectedReturnPct: $("expectedReturnPct").value,
    usedDeduction: $("usedDeduction").value,
    feePct: $("feePct").value,
  });
  const response = await fetch(`/api/tax/us?${params.toString()}`);
  state.tax = await response.json();
  $("taxResult").innerHTML = `
    <div><span>예상 총수익</span><strong>${krw(state.tax.grossGain)}</strong></div>
    <div><span>예상 세금</span><strong>${krw(state.tax.tax)}</strong></div>
    <div><span>세후 수익</span><strong>${krw(state.tax.netGain)}</strong></div>
    <div><span>세후 수익률</span><strong>${fmt(state.tax.netReturnPct)}%</strong></div>
    <p>현재 가정에서는 비용 때문에 약 ${fmt(state.tax.breakEvenReturnPct)}% 이상 올라야 손익분기점을 넘고, 세후 5% 수익을 원하면 대략 ${fmt(state.tax.requiredReturnFor5PctNet)}% 수익률이 필요합니다.</p>
  `;
  updateMetrics();
  renderOverviewCharts();
}

async function analyze() {
  const requestId = ++state.analyzeRequestId;
  const startedAt = Date.now();
  setMarketMode();
  $("loading").textContent = "분석 요청 중...";
  $("analyzeBtn").disabled = true;
  $("analyzeBtn").textContent = "분석 중...";
  const market = $("market").value;
  const symbols = market === "custom" ? $("symbols").value : "";
  const label = $("market").selectedOptions[0]?.textContent || "직접 입력";
  renderLoadingState(`${label} 데이터를 불러오고 있습니다. 잠시만 기다려주세요.`);
  try {
    const params = new URLSearchParams();
    if (symbols) params.set("symbols", symbols);
    if (market !== "custom") params.set("market", market);
    const response = await fetch(`/api/analyze?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (requestId !== state.analyzeRequestId) return;
    state.stocks = data.results || [];
    state.page = 1;
    state.baskets = data.baskets || [];
    setMarketMode();
    renderBaskets();
    renderTable();
    renderPaper();
    if (state.stocks[0]) selectStock(state.stocks[0].symbol);
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const requested = data.requestedCount || state.stocks.length + (data.errors?.length || 0);
    $("loading").textContent = data.errors?.length
      ? `${state.stocks.length}/${requested}개 완료, ${data.errors.length}개 오류 (${elapsed}초)`
      : `${state.stocks.length}/${requested}개 분석 완료 (${elapsed}초)`;
  } catch (error) {
    if (requestId !== state.analyzeRequestId) return;
    $("loading").textContent = "데이터를 불러오지 못했습니다.";
    $("detail").className = "detail-empty";
    $("detail").textContent = "네트워크나 종목 코드를 확인해주세요. 한국 종목은 예: 005930.KS 형식입니다.";
  } finally {
    if (requestId === state.analyzeRequestId) {
      $("analyzeBtn").disabled = false;
      $("analyzeBtn").textContent = "분석하기";
    }
  }
}

$("analyzeBtn").addEventListener("click", analyze);
$("searchBtn").addEventListener("click", searchStocks);
$("stockSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchStocks();
});
$("stockSearch").addEventListener("input", () => {
  clearTimeout(window.__stockSearchTimer);
  window.__stockSearchTimer = setTimeout(searchStocks, 450);
});
$("market").addEventListener("change", () => {
  $("symbols").disabled = $("market").value !== "custom";
  setMarketMode();
  if ($("market").value !== "custom") analyze();
});
$("symbols").addEventListener("input", setMarketMode);
document.querySelectorAll("[data-market-tab]").forEach((button) => {
  button.addEventListener("click", () => {
      $("market").value = button.dataset.marketTab;
      $("symbols").disabled = true;
    setMarketMode();
    analyze();
  });
});
["hideRisky", "minMonth", "maxRsi", "minYield", "maxRisk", "minPrice", "maxPrice"].forEach((id) => {
  $(id).addEventListener("input", resetPageAndRender);
});
document.querySelectorAll("[data-entry-filter]").forEach((button) => {
  button.addEventListener("click", () => setEntryFilter(button.dataset.entryFilter));
});
["investmentKrw", "expectedReturnPct", "usedDeduction", "feePct"].forEach((id) => {
  $(id).addEventListener("input", calculateTax);
});
["allocationAmount", "allocationCount", "maxPositionPct"].forEach((id) => {
  $(id).addEventListener("input", () => renderAllocationPlan());
});
$("clearPaper").addEventListener("click", () => {
  state.paper = [];
  savePaper();
  renderPaper();
  updateMetrics();
  renderOverviewCharts();
});

renderPaper();
setMarketMode();
calculateTax();
analyze();

window.addEventListener("resize", () => {
  if (state.selected) {
    const canvas = $("chart");
    if (canvas) drawChart(canvas, state.selected.history);
  }
});
