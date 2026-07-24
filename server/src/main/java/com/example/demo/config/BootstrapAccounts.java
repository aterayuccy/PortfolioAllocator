package com.example.demo.config;

import com.example.demo.entity.OurUsers;
import com.example.demo.respository.UsersRepo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.regex.Pattern;

@Component
public class BootstrapAccounts implements ApplicationRunner {
    private static final Pattern USERNAME_PATTERN =
            Pattern.compile("^[\\p{L}][\\p{L}\\p{N}_-]{2,31}$");
    private static final Pattern PASSWORD_PATTERN =
            Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z\\d]{8,64}$");

    private final UsersRepo usersRepo;
    private final PasswordEncoder passwordEncoder;

    @Value("${ADMIN_BOOTSTRAP_USERNAME:}")
    private String adminUsername;

    @Value("${ADMIN_BOOTSTRAP_PASSWORD:}")
    private String adminPassword;

    @Value("${USER_BOOTSTRAP_USERNAME:}")
    private String userUsername;

    @Value("${USER_BOOTSTRAP_PASSWORD:}")
    private String userPassword;

    public BootstrapAccounts(UsersRepo usersRepo, PasswordEncoder passwordEncoder) {
        this.usersRepo = usersRepo;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        bootstrap(adminUsername, adminPassword, "ROLE_ADMIN", true);
        bootstrap(userUsername, userPassword, "ROLE_USER", false);
    }

    private void bootstrap(String rawUsername, String password, String role, boolean enforceRole) {
        String username = rawUsername == null ? "" : rawUsername.strip().toLowerCase(Locale.ROOT);
        if (!USERNAME_PATTERN.matcher(username).matches()
                || password == null
                || !PASSWORD_PATTERN.matcher(password).matches()) {
            return;
        }

        usersRepo.findByUsername(username).ifPresentOrElse(existing -> {
            if (enforceRole && !role.equals(existing.getRole())) {
                existing.setRole(role);
                usersRepo.save(existing);
            }
        }, () -> {
            OurUsers user = new OurUsers();
            user.setUsername(username);
            user.setPassword(passwordEncoder.encode(password));
            user.setRole(role);
            usersRepo.save(user);
        });
    }
}
