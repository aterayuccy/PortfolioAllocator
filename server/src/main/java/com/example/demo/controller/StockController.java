package com.example.demo.controller;

import com.example.demo.service.YahooFinanceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/stocks")
public class StockController {
    private final YahooFinanceService yahooFinanceService;

    public StockController(YahooFinanceService yahooFinanceService) {
        this.yahooFinanceService = yahooFinanceService;
    }

    @GetMapping("/quote/{symbol}")
    public ResponseEntity<?> quote(@PathVariable String symbol) {
        try {
            return ResponseEntity.ok(yahooFinanceService.quote(symbol));
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(Map.of("error", exception.getMessage()));
        } catch (Exception exception) {
            return ResponseEntity.internalServerError().body(Map.of("error", exception.getMessage()));
        }
    }

    @GetMapping("/{symbol}")
    public ResponseEntity<?> research(@PathVariable String symbol,
                                      @RequestParam(defaultValue = "1") int periodYears) {
        try {
            return ResponseEntity.ok(yahooFinanceService.research(symbol, periodYears));
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(Map.of("error", exception.getMessage()));
        } catch (Exception exception) {
            return ResponseEntity.internalServerError().body(Map.of("error", exception.getMessage()));
        }
    }
}
