package com.example.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class YahooFinanceService {
    private static final Duration CACHE_TTL = Duration.ofMinutes(3);
    private static final String[] FUNDAMENTAL_TYPES = {
            "quarterlyTotalRevenue", "quarterlyGrossProfit", "quarterlyOperatingIncome",
            "quarterlyNetIncome", "quarterlyDilutedEPS", "quarterlyTotalAssets",
            "quarterlyStockholdersEquity", "quarterlyTotalDebt", "quarterlyOperatingCashFlow",
            "quarterlyFreeCashFlow", "quarterlyTaxProvision", "quarterlyPretaxIncome",
            "quarterlyCashCashEquivalentsAndShortTermInvestments",
            "quarterlyCashAndCashEquivalents",
            "annualTotalRevenue", "annualGrossProfit", "annualOperatingIncome", "annualTaxProvision", "annualPretaxIncome",
            "annualStockholdersEquity",
            "annualTotalDebt", "annualCashCashEquivalentsAndShortTermInvestments",
            "annualCashAndCashEquivalents", "annualInterestExpense", "annualDilutedAverageShares"
    };

    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private final ConcurrentHashMap<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private RateCache riskFreeRateCache;

    public YahooFinanceService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public Map<String, Object> research(String inputSymbol) throws Exception {
        return research(inputSymbol, 1);
    }

    public Map<String, Object> research(String inputSymbol, int requestedPeriodYears) throws Exception {
        String symbol = normalizeSymbol(inputSymbol);
        int periodYears = Math.max(1, Math.min(10, requestedPeriodYears));
        String cacheKey = symbol + "|" + periodYears;
        CacheEntry cached = cache.get(cacheKey);
        if (cached != null && cached.createdAt.plus(CACHE_TTL).isAfter(Instant.now())) return cached.payload;

        JsonNode chart = fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/" + encode(symbol)
                + "?range=2y&interval=1d&includePrePost=false&events=div%2Csplits");
        JsonNode result = chart.path("chart").path("result").path(0);
        if (result.isMissingNode() || result.isNull()) throw new IllegalArgumentException("Yahoo Finance 找不到標的：" + symbol);

        long period2 = Instant.now().plus(Duration.ofDays(2)).getEpochSecond();
        long period1 = Instant.now().minus(Duration.ofDays(4200)).getEpochSecond();
        String types = String.join(",", FUNDAMENTAL_TYPES);
        JsonNode fundamentals = fetchJson("https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"
                + encode(symbol) + "?symbol=" + encode(symbol) + "&type=" + encode(types)
                + "&merge=false&period1=" + period1 + "&period2=" + period2);

        JsonNode search = fetchJson("https://query1.finance.yahoo.com/v1/finance/search?q=" + encode(symbol)
                + "&quotesCount=1&newsCount=8&enableFuzzyQuery=false&region=US&lang=en-US");

        String benchmark = symbol.endsWith(".TW") ? "^TWII" : "^GSPC";
        String assetType = classifyAssetType(search, symbol);
        if (!"STOCK".equals(assetType)) {
            throw new IllegalArgumentException("目前只支援個股，ETF、期貨、外匯與加密貨幣不列入研究清單。");
        }
        JsonNode profile = "STOCK".equals(assetType) ? null : fetchOptionalJson(
                "https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encode(symbol)
                        + "?modules=summaryDetail,defaultKeyStatistics,fundProfile");
        Map<YearMonth, Double> stockMonthly = monthlyCloses(symbol);
        Map<YearMonth, Double> marketMonthly = monthlyCloses(benchmark);
        Double beta = calculateBeta(stockMonthly, marketMonthly);
        double riskFreeRate = currentRiskFreeRate();

        Map<String, Object> payload = buildPayload(symbol, result, parseFundamentals(fundamentals), search,
                profile, assetType, beta, benchmark, riskFreeRate, periodYears);
        cache.put(cacheKey, new CacheEntry(Instant.now(), payload));
        return payload;
    }

    public Map<String, Object> quote(String inputSymbol) throws Exception {
        String symbol = normalizeSymbol(inputSymbol);
        JsonNode root = fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/" + encode(symbol)
                + "?range=5d&interval=1d&includePrePost=false");
        JsonNode result = root.path("chart").path("result").path(0);
        if (result.isMissingNode() || result.isNull()) throw new IllegalArgumentException("Yahoo Finance 找不到標的：" + symbol);
        JsonNode meta = result.path("meta");
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("symbol", symbol);
        output.put("price", meta.path("regularMarketPrice").asDouble());
        output.put("currency", meta.path("currency").asText(""));
        output.put("marketTime", meta.path("regularMarketTime").asLong());
        output.put("fetchedAt", Instant.now().toString());
        return output;
    }

    private Map<String, Object> buildPayload(String symbol, JsonNode chart,
                                              Map<String, List<FinancialPoint>> financials, JsonNode search,
                                              JsonNode profile, String assetType,
                                              Double beta, String benchmark, double riskFreeRate,
                                              int periodYears) {
        JsonNode meta = chart.path("meta");
        JsonNode quote = chart.path("indicators").path("quote").path(0);
        List<Double> closes = numericSeries(quote.path("close"));
        List<Double> volumes = numericSeries(quote.path("volume"));
        Double latestVolume = lastNullable(volumes);
        Double average20Volume = averageTail(volumes, 20);

        double price = meta.path("regularMarketPrice").asDouble(last(closes));
        double previousClose = meta.path("chartPreviousClose").asDouble(closes.size() > 1 ? closes.get(closes.size() - 2) : price);
        double change = previousClose == 0 ? 0 : (price - previousClose) / previousClose * 100;

        Map<String, Object> overview = new LinkedHashMap<>();
        overview.put("symbol", symbol);
        overview.put("name", meta.path("longName").asText(meta.path("shortName").asText(symbol)));
        overview.put("assetType", assetType);
        overview.put("assetTypeLabel", assetTypeLabel(assetType));
        overview.put("exchange", meta.path("fullExchangeName").asText(meta.path("exchangeName").asText("")));
        overview.put("currency", meta.path("currency").asText(""));
        overview.put("price", round(price, 4));
        overview.put("previousClose", round(previousClose, 4));
        overview.put("changePercent", round(change, 2));
        overview.put("marketTime", meta.path("regularMarketTime").asLong());
        overview.put("dayHigh", nullable(meta, "regularMarketDayHigh"));
        overview.put("dayLow", nullable(meta, "regularMarketDayLow"));
        overview.put("fiftyTwoWeekHigh", nullable(meta, "fiftyTwoWeekHigh"));
        overview.put("fiftyTwoWeekLow", nullable(meta, "fiftyTwoWeekLow"));

        Double revenue = latest(financials, "quarterlyTotalRevenue");
        Double grossProfit = latest(financials, "quarterlyGrossProfit");
        Double operatingIncome = latest(financials, "quarterlyOperatingIncome");
        Double netIncome = latest(financials, "quarterlyNetIncome");
        Double equity = latest(financials, "quarterlyStockholdersEquity");
        Double debt = latest(financials, "quarterlyTotalDebt");
        Double cash = firstNonNull(latest(financials, "quarterlyCashCashEquivalentsAndShortTermInvestments"),
                latest(financials, "quarterlyCashAndCashEquivalents"));
        Double revenueGrowth = changeFromYearAgo(financials, "quarterlyTotalRevenue");
        Double grossMargin = divide(grossProfit, revenue);

        Map<String, Object> fundamental = new LinkedHashMap<>();
        fundamental.put("latestQuarter", latestDate(financials));
        fundamental.put("revenue", revenue);
        fundamental.put("revenueGrowth", percent(revenueGrowth));
        fundamental.put("grossMargin", percent(grossMargin));
        fundamental.put("operatingMargin", percent(divide(operatingIncome, revenue)));
        fundamental.put("netMargin", percent(divide(netIncome, revenue)));
        fundamental.put("netIncome", netIncome);
        fundamental.put("eps", latest(financials, "quarterlyDilutedEPS"));
        fundamental.put("totalAssets", latest(financials, "quarterlyTotalAssets"));
        fundamental.put("equity", equity);
        fundamental.put("totalDebt", debt);
        fundamental.put("debtToEquity", roundNullable(divide(debt, equity), 2));
        fundamental.put("operatingCashFlow", latest(financials, "quarterlyOperatingCashFlow"));
        fundamental.put("freeCashFlow", latest(financials, "quarterlyFreeCashFlow"));

        Double investedCapital = investedCapital(equity, debt, cash);
        Double investedCapitalYearAgo = investedCapital(
                yearAgo(financials, "quarterlyStockholdersEquity"), yearAgo(financials, "quarterlyTotalDebt"),
                yearAgo(financials, "quarterlyCashCashEquivalentsAndShortTermInvestments"));
        Double averageInvestedCapital = average(investedCapital, investedCapitalYearAgo);
        Double ttmOperatingIncome = sumLatest(financials, "quarterlyOperatingIncome", 4);
        Double ttmTax = sumLatest(financials, "quarterlyTaxProvision", 4);
        Double ttmPretax = sumLatest(financials, "quarterlyPretaxIncome", 4);
        Double taxRate = divide(ttmTax, ttmPretax);
        if (taxRate == null || taxRate < 0 || taxRate > 0.5) taxRate = 0.21;
        Double roic = divide(ttmOperatingIncome == null ? null : ttmOperatingIncome * (1 - taxRate), averageInvestedCapital);

        Double annualInvestedLatest = annualInvestedCapitalForYears(financials, 0);
        Double annualInvestedPrevious = annualInvestedCapitalForYears(financials, periodYears);
        Double investedCapitalGrowth = growth(annualInvestedLatest, annualInvestedPrevious);
        Double annualRevenueLatest = annualValueForYears(financials, "annualTotalRevenue", 0);
        Double annualRevenuePrevious = annualValueForYears(financials, "annualTotalRevenue", periodYears);
        Double latestYearRevenueGrowth = growth(annualRevenueLatest, annualRevenuePrevious);
        Double grossMarginYearAgo = divide(annualValueForYears(financials, "annualGrossProfit", periodYears), annualRevenuePrevious);
        Double grossMarginCurrent = divide(annualValueForYears(financials, "annualGrossProfit", 0), annualRevenueLatest);
        Double grossMarginYoYChange = grossMarginCurrent == null || grossMarginYearAgo == null
                ? null : grossMarginCurrent - grossMarginYearAgo;

        NewsAnalysis newsAnalysis = analyzeNews(search);
        StructureAnalysis structureAnalysis = analyzeStructure(assetType, profile, average20Volume, price, meta);

        double marketRiskPremium = 0.055;
        Double costOfEquity = beta == null ? null : riskFreeRate + beta * marketRiskPremium;
        Double shares = annualValue(financials, "annualDilutedAverageShares", 0);
        Double marketCap = shares == null ? null : shares * price;
        Double annualDebt = annualValue(financials, "annualTotalDebt", 0);
        Double priorAnnualDebt = annualValue(financials, "annualTotalDebt", 1);
        Double averageDebt = average(annualDebt, priorAnnualDebt);
        Double interestExpense = annualValue(financials, "annualInterestExpense", 0);
        Double costOfDebt = divide(interestExpense == null ? null : Math.abs(interestExpense), averageDebt);
        boolean debtCostFallback = costOfDebt == null || costOfDebt <= 0 || costOfDebt > 0.30;
        if (debtCostFallback) costOfDebt = riskFreeRate + 0.02;
        Double totalCapital = marketCap == null || annualDebt == null ? null : marketCap + annualDebt;
        Double wacc = totalCapital == null || totalCapital == 0 || costOfEquity == null ? null
                : marketCap / totalCapital * costOfEquity + annualDebt / totalCapital * costOfDebt * (1 - taxRate);

        Double economicSpreadLatest = roic == null || wacc == null ? null : roic - wacc;
        Double historicalRoic = annualRoicForYears(financials, periodYears);
        Double economicSpreadHistorical = historicalRoic == null || wacc == null ? null : historicalRoic - wacc;
        Double economicSpreadChange = growthDifference(economicSpreadLatest, economicSpreadHistorical);
        int availableYears = availableAnnualYears(financials);
        int latestYear = latestAnnualYear(financials);
        int comparisonYear = latestYear == 0 ? 0 : latestYear - periodYears;

        boolean stockFundamentalComplete = availableYears >= periodYears && economicSpreadLatest != null && economicSpreadChange != null
                && investedCapitalGrowth != null && latestYearRevenueGrowth != null && grossMarginYoYChange != null;
        boolean stockFundamentalPassed = stockFundamentalComplete && economicSpreadLatest > 0 && investedCapitalGrowth > 0
                && latestYearRevenueGrowth > 0 && grossMarginYoYChange >= 0;
        boolean fundamentalComplete = "STOCK".equals(assetType) ? stockFundamentalComplete
                : structureAnalysis != null && structureAnalysis.dataComplete;
        boolean fundamentalPassed = "STOCK".equals(assetType) ? stockFundamentalPassed
                : structureAnalysis != null && structureAnalysis.dataComplete && structureAnalysis.score >= 50;
        Double fundamentalScore = "STOCK".equals(assetType) ? null
                : structureAnalysis == null ? null : structureAnalysis.score;
        StringBuilder passReason = new StringBuilder();
        if (!fundamentalComplete) passReason.append("基本／結構面資料不足；");
        else if (!fundamentalPassed) passReason.append("基本／結構面未達門檻；");
        if (!newsAnalysis.dataComplete) passReason.append("消息面新聞不足；");
        else if (newsAnalysis.score < 50) passReason.append("消息面低於50分；");
        if (passReason.length() == 0) passReason.append("三面皆達到最低門檻。 ");

        Map<String, Object> bookScreen = new LinkedHashMap<>();
        bookScreen.put("assetType", assetType);
        bookScreen.put("assetTypeLabel", assetTypeLabel(assetType));
        bookScreen.put("fundamentalMethod", "STOCK".equals(assetType) ? "公司財務品質" : "資產結構品質代理");
        bookScreen.put("roic", percent(roic));
        bookScreen.put("wacc", percent(wacc));
        bookScreen.put("economicSpreadLatest", percent(economicSpreadLatest));
        bookScreen.put("economicSpreadHistorical", percent(economicSpreadHistorical));
        bookScreen.put("economicSpreadChange", percent(economicSpreadChange));
        bookScreen.put("roicWaccChange", percent(economicSpreadChange));
        bookScreen.put("economicSpreadNote", "歷史 ROIC 依指定年度估算；歷史 WACC 以目前可取得的市場參數估算");
        bookScreen.put("waccHurdle", percent(wacc));
        bookScreen.put("roicAboveHurdle", roic == null || wacc == null ? null : roic > wacc);
        bookScreen.put("beta", roundNullable(beta, 2));
        bookScreen.put("benchmark", benchmark);
        bookScreen.put("riskFreeRate", percent(riskFreeRate));
        bookScreen.put("marketRiskPremium", percent(marketRiskPremium));
        bookScreen.put("costOfEquity", percent(costOfEquity));
        bookScreen.put("costOfDebt", percent(costOfDebt));
        bookScreen.put("debtCostFallback", debtCostFallback);
        bookScreen.put("waccQuality", beta == null || marketCap == null || annualDebt == null ? "資料不足"
                : debtCostFallback ? "中等（負債成本採替代值）" : "較完整");
        bookScreen.put("investedCapital", investedCapital);
        bookScreen.put("investedCapitalLatest", annualInvestedLatest);
        bookScreen.put("investedCapitalHistorical", annualInvestedPrevious);
        bookScreen.put("investedCapitalGrowth", percent(investedCapitalGrowth));
        bookScreen.put("investedCapitalGrowthPeriod", percent(investedCapitalGrowth));
        bookScreen.put("investedCapitalIncreasing", investedCapitalGrowth == null ? null : investedCapitalGrowth > 0);
        bookScreen.put("latestYearRevenueGrowth", percent(latestYearRevenueGrowth));
        bookScreen.put("revenueGrowth5y", percent(latestYearRevenueGrowth));
        bookScreen.put("revenueGrowthPeriod", percent(latestYearRevenueGrowth));
        bookScreen.put("revenueLatest", annualRevenueLatest);
        bookScreen.put("revenueHistorical", annualRevenuePrevious);
        bookScreen.put("revenueGrowing", latestYearRevenueGrowth == null ? null : latestYearRevenueGrowth > 0);
        bookScreen.put("grossMarginYoYChange", percent(grossMarginYoYChange));
        bookScreen.put("grossMarginChangePeriod", percent(grossMarginYoYChange));
        bookScreen.put("grossMarginRange", grossMarginYoYChange == null ? null : percent(Math.abs(grossMarginYoYChange)));
        bookScreen.put("grossMarginCurrent", percent(grossMarginCurrent));
        bookScreen.put("grossMarginYearAgo", percent(grossMarginYearAgo));
        bookScreen.put("grossMarginHistorical", percent(grossMarginYearAgo));
        bookScreen.put("grossMarginStable", grossMarginYoYChange == null ? null : grossMarginYoYChange >= 0);
        bookScreen.put("historyBasis", "最新年度與前一年度比較");
        bookScreen.put("periodYears", periodYears);
        bookScreen.put("availableYears", availableYears);
        bookScreen.put("latestYear", latestYear == 0 ? null : latestYear);
        bookScreen.put("comparisonYear", comparisonYear == 0 ? null : comparisonYear);
        bookScreen.put("fundamentalScore", fundamentalScore);
        bookScreen.put("fundamentalDataComplete", fundamentalComplete);
        bookScreen.put("fundamentalPassed", fundamentalPassed);
        bookScreen.put("structureScore", structureAnalysis == null ? null : structureAnalysis.score);
        bookScreen.put("structureMethod", structureAnalysis == null ? null : structureAnalysis.method);
        bookScreen.put("structureExpenseRatio", structureAnalysis == null ? null : percent(structureAnalysis.expenseRatio));
        bookScreen.put("structureAssets", structureAnalysis == null ? null : structureAnalysis.totalAssets);
        bookScreen.put("newsScore", newsAnalysis.score);
        bookScreen.put("newsSentimentScore", newsAnalysis.sentimentScore);
        bookScreen.put("newsRecencyScore", newsAnalysis.recencyScore);
        bookScreen.put("newsCoverageScore", newsAnalysis.coverageScore);
        bookScreen.put("newsInternalWeights", Map.of("sentiment", 60, "recency", 25, "coverage", 15));
        bookScreen.put("newsDataComplete", newsAnalysis.dataComplete);
        bookScreen.put("newsPassed", newsAnalysis.dataComplete && newsAnalysis.score >= 50);
        bookScreen.put("newsScoringMode", newsAnalysis.mode);
        bookScreen.put("newsCount", newsAnalysis.count);
        bookScreen.put("newsPositiveCount", newsAnalysis.positiveCount);
        bookScreen.put("newsNegativeCount", newsAnalysis.negativeCount);
        bookScreen.put("dataComplete", fundamentalComplete);
        bookScreen.put("passed", fundamentalPassed);
        bookScreen.put("passReason", !fundamentalComplete ? "基本面資料不足，無法判斷。"
                : fundamentalPassed ? "四項基本面資料完整且達標。" : "四項基本面未達篩選條件。");
        bookScreen.put("methodNote", "STOCK".equals(assetType)
                ? "ROIC 使用最近四季 NOPAT 與本期、去年同期平均投入資本；WACC 使用最新年度財務資料及五年月報酬 Beta 估算。投入資本與營收比較最新年度和前一年度；本季毛利率必須大於或等於去年同期。"
                : "非個股不使用 ROIC／WACC；優先以基金費用率、資產規模與近20日平均成交量評估，若 Yahoo 摘要端點不可用則改用流動性、52週波動幅度與上市歷史代理；資料仍不足時不會通過。");

        Map<String, Object> chips = new LinkedHashMap<>();
        chips.put("volume", latestVolume == null ? null : latestVolume.longValue());
        chips.put("average20Volume", average20Volume == null ? null : Math.round(average20Volume));
        chips.put("volumeRatio", roundNullable(divide(latestVolume, average20Volume), 2));
        chips.put("pricePosition52Week", percent(position(price,
                meta.path("fiftyTwoWeekLow").asDouble(Double.NaN), meta.path("fiftyTwoWeekHigh").asDouble(Double.NaN))));
        chips.put("note", "Yahoo Finance 公開介面未提供一致的台股三大法人與券資比資料；此區目前呈現量價籌碼代理指標。");

        List<Map<String, Object>> news = new ArrayList<>();
        for (JsonNode item : search.path("news")) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("title", item.path("title").asText(""));
            row.put("publisher", item.path("publisher").asText(""));
            row.put("link", item.path("link").asText(""));
            row.put("publishedAt", item.path("providerPublishTime").asLong());
            row.put("type", item.path("type").asText(""));
            news.add(row);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("overview", overview);
        payload.put("fundamental", fundamental);
        payload.put("chips", chips);
        payload.put("bookScreen", bookScreen);
        payload.put("news", news);
        payload.put("source", "Yahoo Finance");
        payload.put("fetchedAt", Instant.now().toString());
        payload.put("cacheSeconds", CACHE_TTL.toSeconds());
        return payload;
    }

    private Map<String, List<FinancialPoint>> parseFundamentals(JsonNode root) {
        Map<String, List<FinancialPoint>> output = new LinkedHashMap<>();
        for (JsonNode result : root.path("timeseries").path("result")) {
            JsonNode types = result.path("meta").path("type");
            if (!types.isArray() || types.isEmpty()) continue;
            String type = types.path(0).asText();
            List<FinancialPoint> points = new ArrayList<>();
            for (JsonNode item : result.path(type)) {
                if (item.path("reportedValue").has("raw")) {
                    points.add(new FinancialPoint(item.path("asOfDate").asText(), item.path("reportedValue").path("raw").asDouble()));
                }
            }
            output.put(type, points);
        }
        return output;
    }

    private JsonNode fetchJson(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15))
                .header("User-Agent", "Mozilla/5.0 (compatible; MarketLens/1.0)")
                .header("Accept", "application/json").GET().build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 429) throw new IllegalStateException("Yahoo Finance 請求過於頻繁，請稍後再試");
        if (response.statusCode() < 200 || response.statusCode() >= 300)
            throw new IllegalStateException("Yahoo Finance 回傳 HTTP " + response.statusCode());
        return mapper.readTree(response.body());
    }

    private JsonNode fetchOptionalJson(String url) {
        try {
            return fetchJson(url);
        } catch (Exception ignored) {
            return null;
        }
    }

    private synchronized double currentRiskFreeRate() {
        if (riskFreeRateCache != null && riskFreeRateCache.createdAt.plus(Duration.ofMinutes(30)).isAfter(Instant.now()))
            return riskFreeRateCache.value;
        try {
            double value = ((Number) quote("^TNX").get("price")).doubleValue() / 100;
            if (value > 0 && value < 0.20) {
                riskFreeRateCache = new RateCache(Instant.now(), value);
                return value;
            }
        } catch (Exception ignored) { }
        return 0.04;
    }

    private Map<YearMonth, Double> monthlyCloses(String symbol) throws Exception {
        JsonNode root = fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/" + encode(symbol)
                + "?range=5y&interval=1mo&includePrePost=false");
        JsonNode result = root.path("chart").path("result").path(0);
        JsonNode timestamps = result.path("timestamp");
        JsonNode closes = result.path("indicators").path("quote").path(0).path("close");
        Map<YearMonth, Double> output = new LinkedHashMap<>();
        int count = Math.min(timestamps.size(), closes.size());
        for (int i = 0; i < count; i++) {
            if (!closes.path(i).isNumber()) continue;
            YearMonth month = YearMonth.from(Instant.ofEpochSecond(timestamps.path(i).asLong()).atZone(ZoneOffset.UTC));
            output.put(month, closes.path(i).asDouble());
        }
        return output;
    }

    private Double calculateBeta(Map<YearMonth, Double> stock, Map<YearMonth, Double> market) {
        List<YearMonth> commonMonths = stock.keySet().stream().filter(market::containsKey).sorted().toList();
        if (commonMonths.size() < 25) return null;
        List<Double> stockReturns = new ArrayList<>();
        List<Double> marketReturns = new ArrayList<>();
        for (int i = 1; i < commonMonths.size(); i++) {
            YearMonth previous = commonMonths.get(i - 1), current = commonMonths.get(i);
            double previousStock = stock.get(previous), previousMarket = market.get(previous);
            if (previousStock == 0 || previousMarket == 0) continue;
            stockReturns.add(stock.get(current) / previousStock - 1);
            marketReturns.add(market.get(current) / previousMarket - 1);
        }
        double marketMean = marketReturns.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double stockMean = stockReturns.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double covariance = 0, variance = 0;
        for (int i = 0; i < stockReturns.size(); i++) {
            covariance += (stockReturns.get(i) - stockMean) * (marketReturns.get(i) - marketMean);
            variance += Math.pow(marketReturns.get(i) - marketMean, 2);
        }
        return variance == 0 ? null : covariance / variance;
    }

    private String normalizeSymbol(String raw) {
        if (raw == null || raw.isBlank()) throw new IllegalArgumentException("請輸入標的代號");
        String symbol = raw.trim().toUpperCase();
        if (!symbol.matches("[A-Z0-9.^=-]{1,24}")) throw new IllegalArgumentException("標的代號格式不正確");
        return symbol.matches("\\d{4,6}") ? symbol + ".TW" : symbol;
    }

    private String classifyAssetType(JsonNode search, String symbol) {
        String quoteType = search.path("quotes").path(0).path("quoteType").asText("").toUpperCase(Locale.ROOT);
        if (quoteType.contains("ETF")) return "ETF";
        if (quoteType.contains("CRYPTO")) return "CRYPTO";
        if (quoteType.contains("FUTURE")) return "FUTURE";
        if (quoteType.contains("CURRENCY")) return "CURRENCY";
        return "STOCK";
    }

    private String assetTypeLabel(String assetType) {
        return switch (assetType) {
            case "ETF" -> "ETF／基金";
            case "CRYPTO" -> "加密貨幣";
            case "FUTURE" -> "期貨";
            case "CURRENCY" -> "外匯";
            default -> "個股";
        };
    }

    private NewsAnalysis analyzeNews(JsonNode search) {
        int count = 0, positiveCount = 0, negativeCount = 0;
        double sentimentTotal = 0, recencyTotal = 0;
        long now = Instant.now().getEpochSecond();
        for (JsonNode item : search.path("news")) {
            String title = item.path("title").asText("");
            if (title.isBlank()) continue;
            String normalized = title.toLowerCase(Locale.ROOT);
            int positive = countKeywords(normalized, new String[]{
                    "beat", "growth", "profit", "record", "upgrade", "approval", "approved",
                    "partnership", "strong", "bullish", "buyback", "dividend", "raised", "surge", "expands"
            });
            int negative = countKeywords(normalized, new String[]{
                    "miss", "decline", "loss", "cut", "downgrade", "lawsuit", "investigation",
                    "warning", "weak", "recall", "layoff", "fraud", "debt", "slump", "falls"
            });
            if (positive > negative) positiveCount++;
            if (negative > positive) negativeCount++;
            double sentiment = clamp(0.5 + (positive - negative) * 0.12, 0.05, 0.95);
            long published = item.path("providerPublishTime").asLong(now);
            double ageDays = Math.max(0, (now - published) / 86400.0);
            sentimentTotal += sentiment * 100;
            recencyTotal += clamp(Math.exp(-ageDays / 45.0) * 100, 0, 100);
            count++;
        }
        boolean complete = count >= 3;
        Double sentimentScore = count == 0 ? null : round(sentimentTotal / count, 1);
        Double recencyScore = count == 0 ? null : round(recencyTotal / count, 1);
        Double coverageScore = count == 0 ? null : round(clamp(count / 8.0 * 100, 0, 100), 1);
        Double score = sentimentScore == null ? null
                : round(sentimentScore * 0.60 + recencyScore * 0.25 + coverageScore * 0.15, 1);
        String mode = "規則估算（未使用 LLM）";
        return new NewsAnalysis(score, sentimentScore, recencyScore, coverageScore,
                complete, count, positiveCount, negativeCount, mode);
    }

    private int countKeywords(String text, String[] keywords) {
        int count = 0;
        for (String keyword : keywords) if (text.contains(keyword)) count++;
        return count;
    }

    private StructureAnalysis analyzeStructure(String assetType, JsonNode profile, Double averageVolume,
                                               double price, JsonNode meta) {
        if ("STOCK".equals(assetType)) return null;
        Double expenseRatio = firstNonNull(rawProfile(profile, "summaryDetail", "annualReportExpenseRatio"),
                rawProfile(profile, "defaultKeyStatistics", "annualReportExpenseRatio"));
        Double totalAssets = firstNonNull(rawProfile(profile, "summaryDetail", "totalAssets"),
                rawProfile(profile, "defaultKeyStatistics", "totalAssets"));
        if (expenseRatio != null && totalAssets != null && averageVolume != null && averageVolume > 0) {
            double expenseScore = clamp(100 - expenseRatio * 100 * 45, 0, 100);
            double liquidityScore = clamp((Math.log10(averageVolume) - 3) / 4 * 100, 0, 100);
            double sizeScore = clamp((Math.log10(totalAssets) - 6) / 7 * 100, 0, 100);
            double score = round(expenseScore * 0.45 + liquidityScore * 0.35 + sizeScore * 0.20, 1);
            return new StructureAnalysis(score, expenseRatio, totalAssets, true, "費用率、資產規模與流動性");
        }

        Double high = meta.path("fiftyTwoWeekHigh").isNumber() ? meta.path("fiftyTwoWeekHigh").asDouble() : null;
        Double low = meta.path("fiftyTwoWeekLow").isNumber() ? meta.path("fiftyTwoWeekLow").asDouble() : null;
        Double firstTradeDate = meta.path("firstTradeDate").isNumber() ? meta.path("firstTradeDate").asDouble() : null;
        boolean proxyComplete = averageVolume != null && averageVolume > 0 && high != null && low != null
                && high > low && price > 0 && firstTradeDate != null;
        if (!proxyComplete) return new StructureAnalysis(null, expenseRatio, totalAssets, false, "結構資料不足");
        double liquidityScore = clamp((Math.log10(averageVolume) - 3) / 4 * 100, 0, 100);
        double volatilityScore = clamp(100 - ((high - low) / price * 100) * 2, 0, 100);
        double historyYears = Math.max(0, (Instant.now().getEpochSecond() - firstTradeDate) / (365.25 * 86400));
        double historyScore = clamp(historyYears / 10 * 100, 0, 100);
        double score = round(liquidityScore * 0.50 + volatilityScore * 0.30 + historyScore * 0.20, 1);
        return new StructureAnalysis(score, expenseRatio, totalAssets, true, "流動性、52週波動幅度與上市歷史代理");
    }

    private Double rawProfile(JsonNode profile, String section, String field) {
        if (profile == null) return null;
        JsonNode value = profile.path("quoteSummary").path("result").path(0).path(section).path(field);
        return value.path("raw").isNumber() ? value.path("raw").asDouble() : value.isNumber() ? value.asDouble() : null;
    }

    private double clamp(double value, double min, double max) {
        return Math.min(max, Math.max(min, value));
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private List<Double> numericSeries(JsonNode array) {
        List<Double> output = new ArrayList<>();
        array.forEach(node -> output.add(node.isNumber() ? node.asDouble() : null));
        return output;
    }

    private Double latest(Map<String, List<FinancialPoint>> all, String type) {
        List<FinancialPoint> points = all.get(type);
        return points == null || points.isEmpty() ? null : points.get(points.size() - 1).value;
    }

    private Double changeFromYearAgo(Map<String, List<FinancialPoint>> all, String type) {
        List<FinancialPoint> points = all.get(type);
        if (points == null || points.size() < 5) return null;
        double current = points.get(points.size() - 1).value;
        double previous = points.get(points.size() - 5).value;
        return previous == 0 ? null : (current - previous) / Math.abs(previous);
    }

    private Double yearAgo(Map<String, List<FinancialPoint>> all, String type) {
        List<FinancialPoint> points = all.get(type);
        return points == null || points.size() < 5 ? null : points.get(points.size() - 5).value;
    }

    private Double annualValue(Map<String, List<FinancialPoint>> all, String type, int offsetFromLatest) {
        List<FinancialPoint> points = all.get(type);
        int index = points == null ? -1 : points.size() - 1 - offsetFromLatest;
        return index < 0 ? null : points.get(index).value;
    }

    private Double annualValueForYears(Map<String, List<FinancialPoint>> all, String type, int yearsAgo) {
        List<FinancialPoint> points = all.get(type);
        if (points == null || points.isEmpty()) return null;
        if (yearsAgo <= 0) return points.get(points.size() - 1).value;
        int targetYear = latestAnnualYear(all) - Math.max(0, yearsAgo);
        FinancialPoint selected = null;
        for (FinancialPoint point : points) {
            int year = parseYear(point.date);
            if (year == targetYear) selected = point;
        }
        return selected == null ? null : selected.value;
    }

    private Double annualInvestedCapitalForYears(Map<String, List<FinancialPoint>> all, int yearsAgo) {
        return investedCapital(annualValueForYears(all, "annualStockholdersEquity", yearsAgo),
                annualValueForYears(all, "annualTotalDebt", yearsAgo),
                firstNonNull(annualValueForYears(all, "annualCashCashEquivalentsAndShortTermInvestments", yearsAgo),
                        annualValueForYears(all, "annualCashAndCashEquivalents", yearsAgo)));
    }

    private Double annualRoicForYears(Map<String, List<FinancialPoint>> all, int yearsAgo) {
        Double operatingIncome = annualValueForYears(all, "annualOperatingIncome", yearsAgo);
        Double tax = annualValueForYears(all, "annualTaxProvision", yearsAgo);
        Double pretax = annualValueForYears(all, "annualPretaxIncome", yearsAgo);
        Double taxRate = divide(tax, pretax);
        if (taxRate == null || taxRate < 0 || taxRate > 0.5) taxRate = 0.21;
        Double invested = annualInvestedCapitalForYears(all, yearsAgo);
        Double previousInvested = annualInvestedCapitalForYears(all, yearsAgo + 1);
        Double averageInvested = average(invested, previousInvested);
        return divide(operatingIncome == null ? null : operatingIncome * (1 - taxRate), averageInvested);
    }

    private Double growthDifference(Double current, Double previous) {
        return current == null || previous == null ? null : current - previous;
    }

    private int latestAnnualYear(Map<String, List<FinancialPoint>> all) {
        return all.entrySet().stream().filter(entry -> entry.getKey().startsWith("annual"))
                .flatMap(entry -> entry.getValue().stream()).map(point -> parseYear(point.date))
                .filter(year -> year > 0).max(Integer::compareTo).orElse(0);
    }

    private int availableAnnualYears(Map<String, List<FinancialPoint>> all) {
        List<Integer> years = all.entrySet().stream().filter(entry -> entry.getKey().startsWith("annual"))
                .flatMap(entry -> entry.getValue().stream()).map(point -> parseYear(point.date))
                .filter(year -> year > 0).toList();
        if (years.isEmpty()) return 0;
        return Math.max(1, years.stream().max(Integer::compareTo).orElse(0) - years.stream().min(Integer::compareTo).orElse(0));
    }

    private int parseYear(String date) {
        if (date == null || date.length() < 4) return 0;
        try { return Integer.parseInt(date.substring(0, 4)); } catch (NumberFormatException exception) { return 0; }
    }

    private Double annualInvestedCapital(Map<String, List<FinancialPoint>> all, int offset) {
        return investedCapital(annualValue(all, "annualStockholdersEquity", offset),
                annualValue(all, "annualTotalDebt", offset),
                firstNonNull(annualValue(all, "annualCashCashEquivalentsAndShortTermInvestments", offset),
                        annualValue(all, "annualCashAndCashEquivalents", offset)));
    }

    private Double quarterlyInvestedCapital(Map<String, List<FinancialPoint>> all, int offset) {
        return investedCapital(valueAtOffset(all, "quarterlyStockholdersEquity", offset),
                valueAtOffset(all, "quarterlyTotalDebt", offset),
                firstNonNull(valueAtOffset(all, "quarterlyCashCashEquivalentsAndShortTermInvestments", offset),
                        valueAtOffset(all, "quarterlyCashAndCashEquivalents", offset)));
    }

    private List<Double> annualGrossMargins(Map<String, List<FinancialPoint>> all, int count) {
        List<Double> margins = new ArrayList<>();
        for (int offset = count - 1; offset >= 0; offset--) {
            Double margin = divide(annualValue(all, "annualGrossProfit", offset),
                    annualValue(all, "annualTotalRevenue", offset));
            if (margin != null) margins.add(margin);
        }
        return margins;
    }

    private Double sumLatest(Map<String, List<FinancialPoint>> all, String type, int count) {
        List<FinancialPoint> points = all.get(type);
        if (points == null || points.size() < count) return null;
        double total = 0;
        for (int i = points.size() - count; i < points.size(); i++) total += points.get(i).value;
        return total;
    }

    private Double sumWindow(Map<String, List<FinancialPoint>> all, String type, int offsetFromLatest, int count) {
        List<FinancialPoint> points = all.get(type);
        if (points == null || points.size() < offsetFromLatest + count) return null;
        double total = 0;
        int endExclusive = points.size() - offsetFromLatest;
        for (int i = endExclusive - count; i < endExclusive; i++) total += points.get(i).value;
        return total;
    }

    private Double valueAtOffset(Map<String, List<FinancialPoint>> all, String type, int offsetFromLatest) {
        List<FinancialPoint> points = all.get(type);
        int index = points == null ? -1 : points.size() - 1 - offsetFromLatest;
        return index < 0 ? null : points.get(index).value;
    }

    private Double firstNonNull(Double first, Double second) { return first != null ? first : second; }

    private Double average(Double first, Double second) {
        return first == null || second == null ? null : (first + second) / 2;
    }

    private Double range(List<Double> values) {
        if (values.isEmpty()) return null;
        return values.stream().mapToDouble(Double::doubleValue).max().orElse(0)
                - values.stream().mapToDouble(Double::doubleValue).min().orElse(0);
    }

    private Double investedCapital(Double equity, Double debt, Double cash) {
        return equity == null || debt == null || cash == null ? null : equity + debt - cash;
    }

    private Double growth(Double current, Double previous) {
        return current == null || previous == null || previous == 0 ? null : (current - previous) / Math.abs(previous);
    }

    private String latestDate(Map<String, List<FinancialPoint>> all) {
        return all.values().stream().filter(list -> !list.isEmpty())
                .map(list -> list.get(list.size() - 1).date).max(String::compareTo).orElse(null);
    }

    private Double averageTail(List<Double> values, int count) {
        double sum = 0; int used = 0;
        for (int i = values.size() - 1; i >= 0 && used < count; i--) {
            Double value = values.get(i);
            if (value != null) { sum += value; used++; }
        }
        return used < count ? null : sum / used;
    }

    private Double divide(Double top, Double bottom) { return top == null || bottom == null || bottom == 0 ? null : top / bottom; }
    private Double position(double value, double low, double high) { return Double.isFinite(low) && Double.isFinite(high) && high != low ? (value - low) / (high - low) : null; }
    private Double percent(Double value) { return value == null ? null : round(value * 100, 2); }
    private Double roundNullable(Double value, int digits) { return value == null ? null : round(value, digits); }
    private double round(double value, int digits) { double scale = Math.pow(10, digits); return Math.round(value * scale) / scale; }
    private double last(List<Double> values) { Double value = lastNullable(values); return value == null ? 0 : value; }
    private Double lastNullable(List<Double> values) { for (int i = values.size() - 1; i >= 0; i--) if (values.get(i) != null) return values.get(i); return null; }
    private Object nullable(JsonNode node, String field) { return node.path(field).isNumber() ? node.path(field).asDouble() : null; }

    private record FinancialPoint(String date, double value) {}
    private record NewsAnalysis(Double score, Double sentimentScore, Double recencyScore,
                                Double coverageScore, boolean dataComplete, int count,
                                int positiveCount, int negativeCount, String mode) {}
    private record StructureAnalysis(Double score, Double expenseRatio, Double totalAssets,
                                     boolean dataComplete, String method) {}
    private record CacheEntry(Instant createdAt, Map<String, Object> payload) {}
    private record RateCache(Instant createdAt, double value) {}
}
