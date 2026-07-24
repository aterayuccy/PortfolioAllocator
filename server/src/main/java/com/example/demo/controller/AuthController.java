package com.example.demo.controller;

import com.example.demo.entity.OurUsers;
import com.example.demo.respository.UsersRepo;
import com.example.demo.service.JWTUtils;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final Pattern USERNAME_PATTERN =
            Pattern.compile("^[\\p{L}][\\p{L}\\p{N}_-]{2,31}$");
    private static final Pattern PASSWORD_PATTERN =
            Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z\\d]{8,64}$");

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
        String username = normalizeUsername(request.username());
        if (username == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "使用者名稱需為 3–32 個字，以中英文字開頭，可使用數字、底線或連字號"));
        }
        if (request.password() == null || !PASSWORD_PATTERN.matcher(request.password()).matches()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "密碼需為 8–64 個字元，只能使用英文字母與數字，且兩者都要包含"));
        }
        if (!request.password().equals(request.confirmPassword())) {
            return ResponseEntity.badRequest().body(Map.of("error", "兩次輸入的密碼不一致"));
        }
        if (usersRepo.existsByUsername(username)) {
            return ResponseEntity.status(409).body(Map.of("error", "這個使用者名稱已被使用"));
        }

        OurUsers user = new OurUsers();
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(request.password()));
        user.setRole("ROLE_USER");
        try {
            usersRepo.saveAndFlush(user);
            return ResponseEntity.ok(response(user));
        } catch (DataIntegrityViolationException exception) {
            return ResponseEntity.status(409).body(Map.of("error", "這個使用者名稱已被使用"));
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody AuthRequest request) {
        try {
            String username = normalizeLoginUsername(request.username());
            if (username == null || request.password() == null) {
                throw new IllegalArgumentException("Missing credentials");
            }
            authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(username, request.password()));
            OurUsers user = usersRepo.findByUsername(username).orElseThrow();
            return ResponseEntity.ok(response(user));
        } catch (Exception exception) {
            return ResponseEntity.status(401).body(Map.of("error", "使用者名稱或密碼錯誤"));
        }
    }

    private Map<String, Object> response(OurUsers user) {
        return Map.of("token", jwtUtils.generateToken(user.getUsername()), "username", user.getUsername());
    }

    private String normalizeUsername(String username) {
        String normalized = normalizeLoginUsername(username);
        return normalized != null && USERNAME_PATTERN.matcher(normalized).matches() ? normalized : null;
    }

    private String normalizeLoginUsername(String username) {
        if (username == null || username.isBlank()) return null;
        return username.strip().toLowerCase(Locale.ROOT);
    }

    public record AuthRequest(String username, String password, String confirmPassword) {}
}
