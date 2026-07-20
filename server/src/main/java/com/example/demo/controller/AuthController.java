package com.example.demo.controller;

import com.example.demo.entity.OurUsers;
import com.example.demo.respository.UsersRepo;
import com.example.demo.service.JWTUtils;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final UsersRepo usersRepo;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JWTUtils jwtUtils;

    public AuthController(UsersRepo usersRepo, PasswordEncoder passwordEncoder,
                          AuthenticationManager authenticationManager, JWTUtils jwtUtils) {
        this.usersRepo = usersRepo;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
        this.jwtUtils = jwtUtils;
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody AuthRequest request) {
        String email = normalizeEmail(request.email());
        if (email == null || request.password() == null || request.password().length() < 8)
            return ResponseEntity.badRequest().body(Map.of("error", "請輸入有效 Email，密碼至少8個字元"));
        if (usersRepo.findByEmail(email).isPresent())
            return ResponseEntity.badRequest().body(Map.of("error", "這個 Email 已經註冊"));
        OurUsers user = new OurUsers();
        user.setEmail(email);
        user.setName(request.name() == null || request.name().isBlank() ? email.split("@")[0] : request.name().trim());
        user.setPassword(passwordEncoder.encode(request.password()));
        user.setRole("ROLE_USER");
        usersRepo.save(user);
        return ResponseEntity.ok(response(user));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody AuthRequest request) {
        try {
            String email = normalizeEmail(request.email());
            authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(email, request.password()));
            OurUsers user = usersRepo.findByEmail(email).orElseThrow();
            return ResponseEntity.ok(response(user));
        } catch (Exception exception) {
            return ResponseEntity.status(401).body(Map.of("error", "Email 或密碼錯誤"));
        }
    }

    private Map<String, Object> response(OurUsers user) {
        return Map.of("token", jwtUtils.generateToken(user.getEmail()), "email", user.getEmail(), "name", user.getName());
    }

    private String normalizeEmail(String email) {
        if (email == null || !email.trim().toLowerCase().matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) return null;
        return email.trim().toLowerCase();
    }

    public record AuthRequest(String email, String password, String name) {}
}
