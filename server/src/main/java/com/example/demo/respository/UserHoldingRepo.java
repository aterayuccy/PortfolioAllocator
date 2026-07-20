package com.example.demo.respository;

import com.example.demo.entity.OurUsers;
import com.example.demo.entity.UserHolding;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface UserHoldingRepo extends JpaRepository<UserHolding, Long> {
    List<UserHolding> findByUserOrderByIdAsc(OurUsers user);

    @Transactional
    void deleteByUser(OurUsers user);
}
