package com.example.demo.service;

import com.example.demo.respository.UsersRepo;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class OurUserDetailsService implements UserDetailsService {
    private final UsersRepo usersRepo;

    public OurUserDetailsService(UsersRepo usersRepo) { this.usersRepo = usersRepo; }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        return usersRepo.findByEmail(email.toLowerCase())
                .orElseThrow(() -> new UsernameNotFoundException("找不到使用者"));
    }
}
