package com.example.demo.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "user_holdings", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "symbol"}))
@Data
public class UserHolding {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private OurUsers user;

    @Column(nullable = false, length = 24)
    private String symbol;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private double quantity;
}
