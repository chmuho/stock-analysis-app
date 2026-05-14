import json
import html
import mimetypes
import os
import re
import statistics
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
PORT = int(os.environ.get("PORT", "8501"))

KRW_DEDUCTION = 2_500_000
OVERSEAS_GAIN_TAX_RATE = 0.22
US_DIVIDEND_WITHHOLDING_RATE = 0.15
KR_DIVIDEND_WITHHOLDING_RATE = 0.154

KR_SYMBOL_NAMES = {
    "005930.KS": "삼성전자",
    "000660.KS": "SK하이닉스",
    "373220.KS": "LG에너지솔루션",
    "207940.KS": "삼성바이오로직스",
    "005380.KS": "현대차",
    "000270.KS": "기아",
    "068270.KS": "셀트리온",
    "105560.KS": "KB금융",
    "035420.KS": "NAVER",
    "005490.KS": "POSCO홀딩스",
    "012330.KS": "현대모비스",
    "055550.KS": "신한지주",
    "028260.KS": "삼성물산",
    "035720.KS": "카카오",
    "032830.KS": "삼성생명",
    "086790.KS": "하나금융지주",
    "066570.KS": "LG전자",
    "015760.KS": "한국전력",
    "009540.KS": "HD한국조선해양",
    "051910.KS": "LG화학",
    "096770.KS": "SK이노베이션",
    "034730.KS": "SK",
    "003550.KS": "LG",
    "017670.KS": "SK텔레콤",
    "247540.KQ": "에코프로비엠",
    "196170.KQ": "알테오젠",
    "028300.KQ": "HLB",
}

KR_NAME_TO_SYMBOL = {name.upper(): symbol for symbol, name in KR_SYMBOL_NAMES.items()}
NEWS_ALIASES = {
    "005930.KS": ["삼성전자", "samsung", "samsung electronics"],
    "000660.KS": ["sk하이닉스", "hynix", "sk hynix"],
    "035420.KS": ["naver", "네이버"],
    "035720.KS": ["kakao", "카카오"],
    "005380.KS": ["hyundai", "현대차"],
    "000270.KS": ["kia", "기아"],
    "068270.KS": ["celltrion", "셀트리온"],
}

LOCAL_SEARCH_ITEMS = [
    {"symbol": symbol, "name": name, "market": "KR", "type": "주식"}
    for symbol, name in KR_SYMBOL_NAMES.items()
] + [
    {"symbol": "AAPL", "name": "Apple", "market": "US", "type": "주식"},
    {"symbol": "MSFT", "name": "Microsoft", "market": "US", "type": "주식"},
    {"symbol": "NVDA", "name": "NVIDIA", "market": "US", "type": "주식"},
    {"symbol": "TSLA", "name": "Tesla", "market": "US", "type": "주식"},
    {"symbol": "AMZN", "name": "Amazon", "market": "US", "type": "주식"},
    {"symbol": "GOOGL", "name": "Alphabet", "market": "US", "type": "주식"},
    {"symbol": "META", "name": "Meta", "market": "US", "type": "주식"},
    {"symbol": "VOO", "name": "Vanguard S&P 500 ETF", "market": "US", "type": "ETF"},
    {"symbol": "VTI", "name": "Vanguard Total Stock Market ETF", "market": "US", "type": "ETF"},
    {"symbol": "SCHD", "name": "Schwab US Dividend Equity ETF", "market": "US", "type": "ETF"},
    {"symbol": "QQQM", "name": "Invesco NASDAQ 100 ETF", "market": "US", "type": "ETF"},
]

POPULAR_SYMBOLS = {
    "US": ["VOO", "VTI", "SCHD", "AAPL", "MSFT", "NVDA", "KO", "PEP", "JNJ", "PG"],
    "US_LARGE": [
        "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "JPM",
        "LLY", "V", "MA", "NFLX", "XOM", "COST", "WMT", "UNH", "HD", "PG",
        "JNJ", "ABBV", "BAC", "KO", "PM", "CRM", "ORCL", "CSCO", "CVX", "ABT",
        "MCD", "IBM", "GE", "LIN", "AMD", "INTU", "DIS", "WFC", "MS", "AXP",
        "NOW", "QCOM", "TXN", "AMGN", "CAT", "NEE", "UBER", "PFE", "GS", "T",
        "VZ", "LOW", "SPGI", "UNP", "RTX", "HON", "BKNG", "COP", "BLK", "SCHW",
    ],
    "US_WIDE": [
        "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "JPM",
        "LLY", "V", "MA", "NFLX", "XOM", "COST", "WMT", "UNH", "HD", "PG",
        "JNJ", "ABBV", "BAC", "KO", "PM", "CRM", "ORCL", "CSCO", "CVX", "ABT",
        "MCD", "IBM", "GE", "LIN", "AMD", "INTU", "DIS", "WFC", "MS", "AXP",
        "NOW", "QCOM", "TXN", "AMGN", "CAT", "NEE", "UBER", "PFE", "GS", "T",
        "VZ", "LOW", "SPGI", "UNP", "RTX", "HON", "BKNG", "COP", "BLK", "SCHW",
        "BA", "DE", "LMT", "MDT", "SYK", "TJX", "ISRG", "VRTX", "REGN", "ADI",
        "PANW", "MU", "PLTR", "ADBE", "GILD", "SBUX", "ELV", "C", "CB", "MMC",
        "ETN", "PGR", "SO", "DUK", "MO", "CL", "MDLZ", "NKE", "UPS", "FDX",
        "TMO", "DHR", "BSX", "CI", "CVS", "ZTS", "EQIX", "AMT", "O", "PLD",
        "PYPL", "INTC", "MRK", "BMY", "MMM", "GEV", "ANET", "KLAC", "LRCX", "SNPS",
        "CDNS", "MELI", "SHOP", "CRWD", "ARM", "APP", "COIN", "RBLX", "NET", "DDOG",
    ],
    "US_LISTED_300": [],
    "KR_LISTED_300": [],
    "KR": [
        "005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS", "000270.KS",
        "068270.KS", "105560.KS", "035420.KS", "005490.KS", "012330.KS", "055550.KS",
        "028260.KS", "035720.KS", "032830.KS", "086790.KS", "066570.KS", "015760.KS",
        "009540.KS", "051910.KS", "096770.KS", "034730.KS", "003550.KS", "017670.KS",
    ],
    "ETF": [
        "VOO", "VTI", "SPLG", "SPY", "IVV", "SCHD", "QQQM", "QQQ", "DIA", "IWM",
        "VEA", "VWO", "VXUS", "BND", "AGG", "TLT", "SHY", "GLD", "SLV", "VNQ",
    ],
    "DIVIDEND": [
        "SCHD", "VYM", "DGRO", "HDV", "NOBL", "KO", "PEP", "JNJ", "PG", "MCD",
        "O", "VZ", "T", "XOM", "CVX", "ABBV", "PM", "MO", "IBM", "KMB",
    ],
}


BEGINNER_BASKETS = [
    {
        "name": "초보자 핵심 ETF",
        "symbols": ["VOO", "VTI", "SPLG", "SCHD"],
        "note": "개별 기업 맞히기보다 시장 전체에 오래 나눠 투자하는 후보입니다.",
    },
    {
        "name": "배당 관찰 후보",
        "symbols": ["SCHD", "KO", "PEP", "JNJ", "PG", "MCD"],
        "note": "배당은 안정감을 주지만 주가 하락을 막아주지는 않습니다.",
    },
    {
        "name": "변동성 큰 성장주",
        "symbols": ["NVDA", "TSLA", "AMD", "META", "AMZN"],
        "note": "수익 기회도 크지만 초보자는 비중 제한과 분할 매수가 필요합니다.",
    },
]


def pct_change(start, end):
    if start in (None, 0) or end is None:
        return None
    return ((end - start) / start) * 100


def sma(values, window):
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def rsi(values, period=14):
    if len(values) <= period:
        return None
    gains = []
    losses = []
    for i in range(-period, 0):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0))
        losses.append(abs(min(diff, 0)))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def max_drawdown(values):
    peak = None
    worst = 0
    for value in values:
        if peak is None or value > peak:
            peak = value
        if peak:
            worst = min(worst, (value - peak) / peak * 100)
    return worst


def request_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=14) as response:
        return json.loads(response.read().decode("utf-8"))


def cache_path(name):
    DATA_DIR.mkdir(exist_ok=True)
    return DATA_DIR / name


def read_cached_json(path, max_age_seconds):
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > max_age_seconds:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_cached_json(path, data):
    try:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def fetch_text(url, encoding="utf-8"):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=18) as response:
        return response.read().decode(encoding, errors="replace")


def is_yahoo_friendly_symbol(symbol):
    if not symbol:
        return False
    blocked = ["$", "^", "/", " "]
    return not any(char in symbol for char in blocked)


def fetch_us_listed_symbols(limit=300):
    path = cache_path("us_listed_symbols.json")
    cached = read_cached_json(path, 12 * 60 * 60)
    if cached:
        return [row["symbol"] for row in cached[:limit]]

    rows = []
    sources = [
        ("NASDAQ", "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"),
        ("OTHER", "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"),
    ]
    for source, url in sources:
        try:
            text = fetch_text(url)
        except Exception:
            continue
        lines = [line for line in text.splitlines() if "|" in line]
        if len(lines) < 2:
            continue
        headers = lines[0].split("|")
        for line in lines[1:]:
            if line.startswith("File Creation Time"):
                continue
            parts = line.split("|")
            item = dict(zip(headers, parts))
            symbol = item.get("Symbol") or item.get("ACT Symbol") or item.get("NASDAQ Symbol") or ""
            name = item.get("Security Name", "")
            test_issue = item.get("Test Issue", "N")
            etf = item.get("ETF", "N")
            if test_issue != "N" or etf == "Y" or not is_yahoo_friendly_symbol(symbol):
                continue
            rows.append({
                "symbol": symbol.replace(".", "-"),
                "name": name,
                "source": source,
            })

    seen = set()
    unique = []
    for row in rows:
        if row["symbol"] in seen:
            continue
        seen.add(row["symbol"])
        unique.append(row)

    priority = {symbol: index for index, symbol in enumerate(POPULAR_SYMBOLS["US_WIDE"])}
    unique.sort(key=lambda row: (priority.get(row["symbol"], 10_000), row["symbol"]))
    write_cached_json(path, unique)
    return [row["symbol"] for row in unique[:limit]]


def is_kr_fund_like(name):
    upper = name.upper()
    prefixes = (
        "KODEX", "TIGER", "ACE", "RISE", "SOL", "PLUS", "HANARO", "KIWOOM",
        "TIME", "KBSTAR", "ARIRANG", "KOSEF", "히어로즈",
    )
    keywords = (" ETF", "ETN", "레버리지", "인버스", "선물", "커버드콜", "액티브", "합성")
    return upper.startswith(prefixes) or any(keyword in upper for keyword in keywords)


def fetch_kr_listed_rows(limit=300):
    path = cache_path("kr_listed_symbols.json")
    cached = read_cached_json(path, 12 * 60 * 60)
    if cached and any(str(row.get("symbol", "")).endswith(".KQ") for row in cached):
        for row in cached[:limit]:
            if row.get("symbol") and row.get("name"):
                KR_SYMBOL_NAMES.setdefault(row["symbol"], row["name"])
        return cached[:limit]

    rows_by_market = []
    seen = set()
    markets = [
        ("KOSPI", "KS", 0),
        ("KOSDAQ", "KQ", 1),
    ]
    per_market_limit = max(1, limit // len(markets))
    for market_name, suffix, sosok in markets:
        market_rows = []
        for page in range(1, 13):
            url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
            try:
                text = fetch_text(url, encoding="cp949")
            except Exception:
                continue
            matches = re.findall(
                r'<a href="/item/main\.naver\?code=(\d{6})"[^>]*>(.*?)</a>',
                text,
                flags=re.S,
            )
            if not matches:
                continue
            for code, raw_name in matches:
                if code in seen:
                    continue
                seen.add(code)
                name = html.unescape(re.sub(r"<.*?>", "", raw_name)).strip()
                if not name:
                    continue
                if is_kr_fund_like(name):
                    continue
                row = {
                    "symbol": f"{code}.{suffix}",
                    "name": name,
                    "market": market_name,
                    "type": "주식",
                }
                KR_SYMBOL_NAMES.setdefault(f"{code}.{suffix}", name)
                market_rows.append(row)
                if len(market_rows) >= per_market_limit:
                    break
            if len(market_rows) >= per_market_limit:
                break
        rows_by_market.extend(market_rows)

    write_cached_json(path, rows_by_market)
    return rows_by_market[:limit]


def fetch_kr_listed_symbols(limit=300):
    return [row["symbol"] for row in fetch_kr_listed_rows(limit)]


def kr_dynamic_name(symbol):
    if symbol in KR_SYMBOL_NAMES:
        return KR_SYMBOL_NAMES[symbol]
    cached = read_cached_json(cache_path("kr_listed_symbols.json"), 30 * 24 * 60 * 60)
    for row in cached or []:
        if row.get("symbol") == symbol:
            KR_SYMBOL_NAMES.setdefault(symbol, row.get("name", symbol))
            return KR_SYMBOL_NAMES[symbol]
    return None


def normalize_symbol(raw):
    value = raw.strip()
    upper = value.upper()
    if upper in KR_NAME_TO_SYMBOL:
        return KR_NAME_TO_SYMBOL[upper]
    compact = value.replace(" ", "")
    if compact.upper() in KR_NAME_TO_SYMBOL:
        return KR_NAME_TO_SYMBOL[compact.upper()]
    if compact.isdigit() and len(compact) == 6:
        return f"{compact}.KS"
    return upper


def search_symbols(query):
    text = query.strip()
    if not text:
        return []
    normalized = text.upper().replace(" ", "")
    results = []
    seen = set()

    for item in LOCAL_SEARCH_ITEMS:
        haystack = f"{item['symbol']} {item['name']}".upper().replace(" ", "")
        if normalized in haystack:
            results.append(item)
            seen.add(item["symbol"])

    if re.search(r"[가-힣]", text) or normalized.isdigit():
        try:
            for row in fetch_kr_listed_rows(300):
                haystack = f"{row['symbol']} {row['name']}".upper().replace(" ", "")
                if normalized in haystack and row["symbol"] not in seen:
                    results.append(row)
                    seen.add(row["symbol"])
                if len(results) >= 12:
                    return results[:12]
        except Exception:
            pass

    try:
        params = urllib.parse.urlencode({"q": text, "quotesCount": 8, "newsCount": 0})
        payload = request_json(f"https://query1.finance.yahoo.com/v1/finance/search?{params}")
        for quote in payload.get("quotes", []):
            symbol = quote.get("symbol")
            if not symbol or symbol in seen:
                continue
            quote_type = quote.get("quoteType", "")
            if quote_type not in {"EQUITY", "ETF", "MUTUALFUND"}:
                continue
            results.append({
                "symbol": symbol,
                "name": quote.get("shortname") or quote.get("longname") or symbol,
                "market": quote.get("exchange") or quote.get("exchDisp") or "",
                "type": "ETF" if quote_type == "ETF" else "주식",
            })
            seen.add(symbol)
    except Exception:
        pass

    return results[:12]


def classify_news(title):
    lower = title.lower()
    positive_words = [
        "beat", "beats", "surge", "rally", "upgrade", "upgraded", "record", "profit", "growth",
        "buy", "bullish", "strong", "호재", "상승", "급등", "실적", "수주", "증가", "상향", "최대",
    ]
    negative_words = [
        "miss", "falls", "fall", "drop", "drops", "downgrade", "downgraded", "lawsuit", "probe",
        "recall", "weak", "bearish", "risk", "warning", "악재", "하락", "급락", "부진", "감소", "소송", "리콜", "하향",
    ]
    if any(word in lower for word in positive_words):
        return "호재"
    if any(word in lower for word in negative_words):
        return "악재"
    return "중립"


def news_aliases(symbol, display_name):
    aliases = set(NEWS_ALIASES.get(symbol, []))
    aliases.add(symbol.split(".")[0].lower())
    for part in display_name.replace(",", " ").split():
        if len(part) >= 3:
            aliases.add(part.lower())
    if display_name:
        aliases.add(display_name.lower())
    return [alias for alias in aliases if alias]


def fetch_news(symbol, display_name):
    queries = [symbol, display_name]
    items = []
    seen = set()
    aliases = news_aliases(symbol, display_name)
    for query in queries:
        try:
            params = urllib.parse.urlencode({"q": query, "quotesCount": 0, "newsCount": 6})
            payload = request_json(f"https://query1.finance.yahoo.com/v1/finance/search?{params}")
            for news in payload.get("news", []):
                title = news.get("title") or ""
                link = news.get("link") or ""
                if not title or title in seen:
                    continue
                title_lower = title.lower()
                if aliases and not any(alias in title_lower for alias in aliases):
                    continue
                seen.add(title)
                provider = news.get("publisher") or news.get("providerPublishTime") or ""
                items.append({
                    "title": title,
                    "summary": title,
                    "sentiment": classify_news(title),
                    "publisher": news.get("publisher") or "",
                    "link": link,
                    "publishedAt": news.get("providerPublishTime"),
                })
                if len(items) >= 6:
                    return items
        except Exception:
            continue
    return items


def fetch_chart(symbol, chart_range="5y", interval="1d"):
    encoded = urllib.parse.quote(symbol, safe="")
    params = urllib.parse.urlencode({
        "range": chart_range,
        "interval": interval,
        "includePrePost": "false",
        "events": "div",
    })
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?{params}"
    payload = request_json(url)

    result = payload.get("chart", {}).get("result")
    if not result:
        error = payload.get("chart", {}).get("error") or {}
        raise ValueError(error.get("description") or f"No data for {symbol}")

    result = result[0]
    meta = result.get("meta", {})
    quote = result.get("indicators", {}).get("quote", [{}])[0]
    timestamps = result.get("timestamp") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    rows = []
    for ts, close, volume in zip(timestamps, closes, volumes):
        if close is None:
            continue
        rows.append({
            "date": time.strftime("%Y-%m-%d", time.localtime(ts)),
            "close": round(float(close), 4),
            "volume": int(volume or 0),
        })

    dividends = []
    for item in (result.get("events", {}).get("dividends") or {}).values():
        dividends.append({
            "date": time.strftime("%Y-%m-%d", time.localtime(item.get("date", 0))),
            "amount": float(item.get("amount", 0) or 0),
        })
    dividends.sort(key=lambda row: row["date"])

    if not rows:
        raise ValueError(f"No valid price rows for {symbol}")
    return {"symbol": symbol.upper(), "meta": meta, "rows": rows, "dividends": dividends}


def dividend_summary(dividends, latest_price):
    now = time.time()
    one_year_ago = now - 365 * 24 * 60 * 60
    ttm = 0
    for div in dividends:
        ts = time.mktime(time.strptime(div["date"], "%Y-%m-%d"))
        if ts >= one_year_ago:
            ttm += div["amount"]
    yield_pct = (ttm / latest_price * 100) if latest_price else None
    return {
        "annualDividend": ttm,
        "dividendYieldPct": yield_pct,
        "afterTaxAnnualDividend": ttm * (1 - US_DIVIDEND_WITHHOLDING_RATE),
        "recentDividends": dividends[-8:],
    }


def tax_snapshot(price, currency):
    if currency == "KRW":
        return {
            "market": "KR",
            "capitalGainTaxNote": "일반 소액투자자는 국내 상장주식 양도세가 보통 없지만, 대주주/특정 ETF/파생상품은 예외가 있습니다.",
            "dividendTaxNote": "국내 배당은 보통 15.4% 원천징수되고 금융소득이 커지면 종합과세를 확인해야 합니다.",
        }
    return {
        "market": "US_OR_OVERSEAS",
        "capitalGainTaxNote": "해외주식 매도차익은 연간 손익통산 후 250만원 공제, 초과분 22%가 기본 가정입니다.",
        "dividendTaxNote": "미국 배당은 보통 현지 15% 원천징수 후 입금됩니다. 금융소득 2,000만원 초과 여부도 확인해야 합니다.",
    }


def entry_decision(risk, latest, sma20, sma60, rsi14, changes, distance_from_high, volume_ratio):
    reasons = []
    blockers = []
    score = 0

    if sma20 and latest >= sma20:
        score += 2
        reasons.append("현재가가 20일선 위라 단기 추세가 살아 있습니다.")
    else:
        blockers.append("20일선 아래라 지금 바로 들어가면 하락 흐름에 올라탈 수 있습니다.")

    if sma60 and latest >= sma60:
        score += 2
        reasons.append("60일선 위라 중기 추세가 아직 버티고 있습니다.")
    else:
        blockers.append("60일선 아래라 중기 추세가 약합니다.")

    if rsi14 is not None:
        if 40 <= rsi14 <= 62:
            score += 2
            reasons.append("RSI가 과열도 침체도 아닌 중립 구간입니다.")
        elif 62 < rsi14 <= 70:
            score += 1
            reasons.append("RSI가 다소 높지만 과열 직전은 아닙니다.")
        elif rsi14 > 72:
            blockers.append("RSI가 높아 추격매수 위험이 있습니다.")
        elif rsi14 < 32:
            blockers.append("RSI가 낮아 싸 보이지만 하락 추세일 수 있습니다.")

    month = changes.get("month")
    week = changes.get("week")
    if month is not None:
        if -3 <= month <= 12:
            score += 1
            reasons.append("최근 1개월 움직임이 과도하지 않습니다.")
        elif month > 20:
            blockers.append("최근 1개월 급등 폭이 커서 조정 위험이 있습니다.")
    if week is not None and week > 10:
        blockers.append("최근 1주 상승률이 커서 단기 진입 타이밍은 부담스럽습니다.")

    if distance_from_high is not None:
        if distance_from_high <= -8:
            score += 1
            reasons.append("52주 고점에서 어느 정도 떨어져 있어 추격 부담이 덜합니다.")
        elif distance_from_high > -3:
            blockers.append("52주 고점 근처라 한 번에 사기엔 부담스럽습니다.")

    if volume_ratio is not None and 0.8 <= volume_ratio <= 1.8:
        score += 1
        reasons.append("거래량이 평균 범위라 과도한 쏠림은 아닙니다.")

    if risk >= 8 or len(blockers) >= 4:
        action = "피하기"
        summary = "지금은 초보자가 신규 진입하기엔 위험 신호가 많습니다."
    elif risk >= 5 or len(blockers) >= 2:
        action = "대기"
        summary = "관심종목에 두고 조정이나 추세 회복을 기다리는 쪽이 낫습니다."
    elif score >= 6 and risk <= 3:
        action = "진입 가능"
        summary = "지표상 큰 과열은 적지만, 그래도 분할 매수가 기본입니다."
    else:
        action = "분할만"
        summary = "완전히 나쁘진 않지만 한 번에 크게 사기보다는 작게 나눠보는 구간입니다."

    return {
        "action": action,
        "score": score,
        "summary": summary,
        "reasons": reasons[:4],
        "blockers": blockers[:4],
    }


def analyze_symbol(symbol):
    chart = fetch_chart(symbol)
    rows = chart["rows"]
    closes = [row["close"] for row in rows]
    volumes = [row["volume"] for row in rows]
    latest = closes[-1]
    previous = closes[-2] if len(closes) > 1 else None
    sma20 = sma(closes, 20)
    sma60 = sma(closes, 60)
    sma120 = sma(closes, 120)
    rsi14 = rsi(closes, 14)
    vol20 = statistics.mean(volumes[-20:]) if len(volumes) >= 20 else None
    current_volume = volumes[-1] if volumes else None
    volume_ratio = (current_volume / vol20) if vol20 else None
    high_52w = max(closes[-252:]) if len(closes) >= 252 else max(closes)
    low_52w = min(closes[-252:]) if len(closes) >= 252 else min(closes)

    changes = {
        "day": pct_change(previous, latest),
        "week": pct_change(closes[-6], latest) if len(closes) >= 6 else None,
        "month": pct_change(closes[-22], latest) if len(closes) >= 22 else None,
        "quarter": pct_change(closes[-64], latest) if len(closes) >= 64 else None,
        "year": pct_change(closes[-253], latest) if len(closes) >= 253 else pct_change(closes[0], latest),
        "fiveYear": pct_change(closes[0], latest),
    }

    risk = 0
    positives = []
    warnings = []
    beginner_notes = []

    if sma20 and latest > sma20:
        positives.append("현재가가 20일 평균선 위에 있어 단기 흐름은 양호합니다.")
    elif sma20:
        risk += 2
        warnings.append("현재가가 20일 평균선 아래라 단기 하락 압력이 있습니다.")

    if sma60 and latest > sma60:
        positives.append("60일 평균선 위에 있어 중기 추세가 아직 무너지진 않았습니다.")
    elif sma60:
        risk += 2
        warnings.append("60일 평균선 아래라 중기 추세 확인이 필요합니다.")

    if sma20 and sma60 and sma20 < sma60:
        risk += 2
        warnings.append("20일 평균선이 60일 평균선보다 낮아 상승 탄력이 약합니다.")

    if rsi14 is not None and rsi14 >= 75:
        risk += 3
        warnings.append("RSI가 75 이상으로 단기 과열 구간일 수 있습니다.")
    elif rsi14 is not None and rsi14 >= 65:
        risk += 1
        warnings.append("RSI가 높은 편이라 추격 매수는 조심해야 합니다.")
    elif rsi14 is not None and rsi14 <= 30:
        risk += 1
        warnings.append("RSI가 낮습니다. 싸 보이지만 하락 추세가 이어질 수 있습니다.")

    if changes["week"] is not None and changes["week"] >= 12:
        risk += 2
        warnings.append("최근 1주 상승률이 커서 단기 급등 후 조정 위험이 있습니다.")
    if changes["month"] is not None and changes["month"] >= 25:
        risk += 2
        warnings.append("최근 1개월 상승률이 매우 높아 과열 여부를 봐야 합니다.")
    if changes["year"] is not None and changes["year"] <= -25:
        risk += 1
        warnings.append("최근 1년 수익률이 크게 낮아 회복 전까지 관찰이 필요합니다.")

    if volume_ratio is not None and volume_ratio >= 2:
        positives.append("거래량이 20일 평균보다 크게 늘어 시장 관심이 높습니다.")
    elif volume_ratio is not None and volume_ratio <= 0.6:
        risk += 1
        warnings.append("거래량이 평균보다 낮아 움직임의 신뢰도가 약할 수 있습니다.")

    distance_from_high = pct_change(high_52w, latest)
    distance_from_low = pct_change(low_52w, latest)
    drawdown = max_drawdown(closes[-252:])
    if distance_from_high is not None and distance_from_high > -5:
        risk += 1
        warnings.append("52주 고점 근처라 신규 진입은 분할 접근이 낫습니다.")
    if drawdown <= -35:
        risk += 1
        warnings.append("1년 내 큰 낙폭을 겪은 종목이라 변동성이 큽니다.")

    div = dividend_summary(chart["dividends"], latest)
    if div["dividendYieldPct"] and div["dividendYieldPct"] >= 2.5:
        positives.append("최근 1년 배당수익률이 높은 편입니다. 배당 지속성도 따로 확인하세요.")
    elif div["annualDividend"] == 0:
        beginner_notes.append("최근 1년 배당 기록이 거의 없습니다. 이 종목은 배당보다 가격 상승 기대가 중심입니다.")

    if risk >= 7:
        verdict = "위험"
    elif risk >= 4:
        verdict = "주의"
    elif risk >= 2:
        verdict = "관찰"
    else:
        verdict = "상대적 양호"

    currency = chart["meta"].get("currency", "")
    display_name = kr_dynamic_name(chart["symbol"]) or chart["meta"].get("shortName") or chart["meta"].get("longName") or chart["symbol"]
    after_tax_dividend = div["annualDividend"] * (1 - (KR_DIVIDEND_WITHHOLDING_RATE if currency == "KRW" else US_DIVIDEND_WITHHOLDING_RATE))
    div["afterTaxAnnualDividend"] = after_tax_dividend
    entry = entry_decision(risk, latest, sma20, sma60, rsi14, changes, distance_from_high, volume_ratio)
    news = fetch_news(chart["symbol"], display_name)

    return {
        "symbol": chart["symbol"],
        "name": display_name,
        "displayName": display_name,
        "currency": currency,
        "exchange": chart["meta"].get("exchangeName", ""),
        "price": latest,
        "changes": changes,
        "indicators": {
            "sma20": sma20,
            "sma60": sma60,
            "sma120": sma120,
            "rsi14": rsi14,
            "currentVolume": current_volume,
            "avgVolume20": vol20,
            "volumeRatio": volume_ratio,
            "high52w": high_52w,
            "low52w": low_52w,
            "distanceFromHighPct": distance_from_high,
            "distanceFromLowPct": distance_from_low,
            "maxDrawdownPct": drawdown,
        },
        "dividend": div,
        "tax": tax_snapshot(latest, chart["meta"].get("currency", "")),
        "riskScore": risk,
        "verdict": verdict,
        "entry": entry,
        "news": news,
        "warnings": warnings,
        "positives": positives,
        "beginnerNotes": beginner_notes,
        "history": rows[-260:],
    }


def calculate_us_tax(query):
    investment_krw = float(query.get("investmentKrw", ["10000000"])[0] or 0)
    expected_return_pct = float(query.get("expectedReturnPct", ["10"])[0] or 0)
    used_deduction = float(query.get("usedDeduction", ["0"])[0] or 0)
    fee_pct = float(query.get("feePct", ["0.25"])[0] or 0)

    gross_gain = investment_krw * expected_return_pct / 100
    estimated_fees = investment_krw * fee_pct / 100
    available_deduction = max(KRW_DEDUCTION - used_deduction, 0)
    taxable_gain = max(gross_gain - available_deduction, 0)
    tax = taxable_gain * OVERSEAS_GAIN_TAX_RATE
    net_gain = gross_gain - tax - estimated_fees
    net_return_pct = (net_gain / investment_krw * 100) if investment_krw else 0
    break_even_return_pct = (estimated_fees / investment_krw * 100) if investment_krw else 0
    target_net_gain = investment_krw * 0.05
    target_gross_after_deduction = (target_net_gain + estimated_fees - available_deduction) / (1 - OVERSEAS_GAIN_TAX_RATE)
    required_for_5pct_net = max(target_net_gain + estimated_fees, target_gross_after_deduction + available_deduction)
    required_return_for_5pct_net = (required_for_5pct_net / investment_krw * 100) if investment_krw else 0

    return {
        "investmentKrw": investment_krw,
        "grossGain": gross_gain,
        "estimatedFees": estimated_fees,
        "availableDeduction": available_deduction,
        "taxableGain": taxable_gain,
        "tax": tax,
        "netGain": net_gain,
        "netReturnPct": net_return_pct,
        "breakEvenReturnPct": break_even_return_pct,
        "requiredReturnFor5PctNet": required_return_for_5pct_net,
        "assumptions": {
            "deductionKrw": KRW_DEDUCTION,
            "capitalGainTaxRate": OVERSEAS_GAIN_TAX_RATE,
            "usDividendWithholdingRate": US_DIVIDEND_WITHHOLDING_RATE,
        },
    }


def analyze_symbols(symbols):
    results_by_symbol = {}
    errors = []
    max_workers = 8 if len(symbols) > 40 else 4

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(analyze_symbol, symbol): symbol for symbol in symbols}
        for future in as_completed(future_map):
            symbol = future_map[future]
            try:
                results_by_symbol[symbol] = future.result()
            except Exception as exc:
                errors.append({"symbol": symbol, "message": str(exc)})

    results = [results_by_symbol[symbol] for symbol in symbols if symbol in results_by_symbol]
    return results, errors


class AppHandler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/analyze":
            query = urllib.parse.parse_qs(parsed.query)
            raw = query.get("symbols", [""])[0]
            symbols = [normalize_symbol(part) for part in raw.split(",") if part.strip()]
            if not symbols:
                market = query.get("market", ["US"])[0].upper()
                if market == "US_LISTED_300":
                    symbols = fetch_us_listed_symbols(300)
                elif market == "KR_LISTED_300":
                    symbols = fetch_kr_listed_symbols(300)
                else:
                    symbols = POPULAR_SYMBOLS.get(market, POPULAR_SYMBOLS["US"])
            symbols = symbols[:320]

            results, errors = analyze_symbols(symbols)
            self.send_json({
                "results": results,
                "errors": errors,
                "requestedCount": len(symbols),
                "baskets": BEGINNER_BASKETS,
            })
            return

        if parsed.path == "/api/search":
            query = urllib.parse.parse_qs(parsed.query)
            self.send_json({"results": search_symbols(query.get("q", [""])[0])})
            return

        if parsed.path == "/api/tax/us":
            query = urllib.parse.parse_qs(parsed.query)
            self.send_json(calculate_us_tax(query))
            return

        path = parsed.path.strip("/") or "index.html"
        target = (STATIC_DIR / path).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.exists() or target.is_dir():
            self.send_response(404)
            self.end_headers()
            return

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), AppHandler)
    print(f"Stock helper is running: http://127.0.0.1:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
