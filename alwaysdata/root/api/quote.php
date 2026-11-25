<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$symbol = strtoupper(trim((string) ($_GET['symbol'] ?? '')));
if (!preg_match('/^[A-Z0-9^=._-]{1,20}$/', $symbol)) {
    http_response_code(400);
    echo json_encode(['error' => '股票代號格式不正確'], JSON_UNESCAPED_UNICODE);
    exit;
}

$url = 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode($symbol)
    . '?range=5d&interval=1d&includePrePost=false';
$handle = curl_init($url);
curl_setopt_array($handle, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_USERAGENT => 'Mozilla/5.0 PortfolioAllocator/1.0',
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
]);
$body = curl_exec($handle);
$status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);

if ($body === false || $status !== 200) {
    http_response_code(502);
    echo json_encode(['error' => '暫時無法取得報價'], JSON_UNESCAPED_UNICODE);
    exit;
}

$result = json_decode($body, true)['chart']['result'][0] ?? null;
$meta = $result['meta'] ?? null;
$price = $meta['regularMarketPrice'] ?? null;
if (!is_numeric($price) || (float) $price <= 0) {
    http_response_code(404);
    echo json_encode(['error' => 'Yahoo Finance 找不到標的：' . $symbol], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'symbol' => $symbol,
    'price' => (float) $price,
    'currency' => (string) ($meta['currency'] ?? ''),
    'marketTime' => (int) ($meta['regularMarketTime'] ?? 0),
    'fetchedAt' => gmdate('c'),
], JSON_UNESCAPED_UNICODE);
