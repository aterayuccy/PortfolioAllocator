package com.example.demo.controller;

import com.example.demo.entity.OurUsers;
import com.example.demo.entity.UserHolding;
import com.example.demo.respository.UserHoldingRepo;
import jakarta.transaction.Transactional;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/portfolio")
public class PortfolioController {
    private final UserHoldingRepo holdingRepo;

    public PortfolioController(UserHoldingRepo holdingRepo) { this.holdingRepo = holdingRepo; }

    @GetMapping
    public List<HoldingResponse> get(@AuthenticationPrincipal OurUsers user) {
        return holdingRepo.findByUserOrderByIdAsc(user).stream()
                .map(item -> new HoldingResponse(item.getSymbol(), item.getName(), item.getQuantity())).toList();
    }

    @PutMapping
    @Transactional
    public ResponseEntity<?> replace(@AuthenticationPrincipal OurUsers user, @RequestBody List<HoldingRequest> requests) {
        if (requests.size() > 200) return ResponseEntity.badRequest().body(Map.of("error", "標的清單最多200筆"));
        holdingRepo.deleteByUser(user);
        holdingRepo.flush();
        List<UserHolding> holdings = new ArrayList<>();
        for (HoldingRequest request : requests) {
            if (request.symbol() == null || !request.symbol().toUpperCase().matches("[A-Z0-9.^=-]{1,24}")) continue;
            UserHolding holding = new UserHolding();
            holding.setUser(user);
            holding.setSymbol(request.symbol().trim().toUpperCase());
            holding.setName(request.name() == null ? request.symbol() : request.name().trim());
            holding.setQuantity(Math.max(0, request.quantity()));
            holdings.add(holding);
        }
        holdingRepo.saveAll(holdings);
        return ResponseEntity.ok(Map.of("saved", holdings.size()));
    }

    public record HoldingRequest(String symbol, String name, double quantity) {}
    public record HoldingResponse(String symbol, String name, double quantity) {}
}
