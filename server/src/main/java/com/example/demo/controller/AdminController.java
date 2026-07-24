package com.example.demo.controller;

import com.example.demo.respository.UserHoldingRepo;
import com.example.demo.respository.UsersRepo;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final UsersRepo usersRepo;
    private final UserHoldingRepo holdingRepo;

    public AdminController(UsersRepo usersRepo, UserHoldingRepo holdingRepo) {
        this.usersRepo = usersRepo;
        this.holdingRepo = holdingRepo;
    }

    @GetMapping("/summary")
    public AdminSummary summary() {
        List<UserSummary> users = usersRepo.findAll(Sort.by(Sort.Direction.ASC, "id")).stream()
                .map(user -> new UserSummary(user.getId(), user.getUsername(), user.getRole()))
                .toList();
        long adminCount = users.stream().filter(user -> "ROLE_ADMIN".equals(user.role())).count();
        return new AdminSummary(users.size(), adminCount, holdingRepo.count(), users);
    }

    public record UserSummary(Integer id, String username, String role) {}

    public record AdminSummary(long totalUsers, long adminCount, long totalHoldings, List<UserSummary> users) {}
}
