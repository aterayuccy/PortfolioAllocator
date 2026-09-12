package com.example.demo;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DemoApplicationTests {
    @Autowired
    private MockMvc mvc;

    @Test
    void publicApiWorksWithoutLogin() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk());
    }

    @Test
    void accountEndpointsAreRemoved() throws Exception {
        mvc.perform(post("/api/auth/login")).andExpect(status().isNotFound());
        mvc.perform(post("/api/auth/register")).andExpect(status().isNotFound());
        mvc.perform(get("/api/portfolio")).andExpect(status().isNotFound());
        mvc.perform(get("/api/admin/summary")).andExpect(status().isNotFound());
    }

	@Test
	void contextLoads() {
	}

}
