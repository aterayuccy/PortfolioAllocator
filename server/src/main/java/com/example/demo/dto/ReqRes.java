package com.example.demo.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.example.demo.entity.OurUsers;
import java.util.List;
import lombok.Data;

@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)



public class ReqRes {
    private int Statuscode;
    private String error;
    private String message;
    private String token;
    private String refreshToken;
    private String expirationTime;
    private String username;
    private String role;
    private String password;
    private String confirmPassword;
    private OurUsers ourUsers;
    private List<OurUsers> ourUsersList;


    
}
