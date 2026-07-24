import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

public final class MigrateH2ToPostgres {
    private static final Pattern VALID_USERNAME =
            Pattern.compile("^[\\p{L}][\\p{L}\\p{N}_-]{2,31}$");

    private MigrateH2ToPostgres() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 3 || args.length > 4) {
            throw new IllegalArgumentException(
                    "Usage: MigrateH2ToPostgres <h2-file-without-extension> <postgres-url> <postgres-user> [postgres-password]");
        }

        Class.forName("org.h2.Driver");
        Class.forName("org.postgresql.Driver");

        String h2Url = "jdbc:h2:file:" + args[0] + ";ACCESS_MODE_DATA=r";
        String postgresPassword = args.length == 4 ? args[3] : "";
        try (Connection source = DriverManager.getConnection(h2Url, "sa", "");
             Connection target = DriverManager.getConnection(args[1], args[2], postgresPassword)) {
            target.setAutoCommit(false);
            try {
                Map<Integer, Integer> userIds = migrateUsers(source, target);
                int holdingCount = migrateHoldings(source, target, userIds);
                target.commit();
                System.out.printf("Migrated %d user(s) and %d holding(s).%n", userIds.size(), holdingCount);
            } catch (Exception exception) {
                target.rollback();
                throw exception;
            }
        }
    }

    private static Map<Integer, Integer> migrateUsers(Connection source, Connection target) throws Exception {
        Map<Integer, Integer> userIds = new HashMap<>();
        try (PreparedStatement select = source.prepareStatement(
                "SELECT ID, EMAIL, NAME, PASSWORD, ROLE FROM OURUSERS ORDER BY ID");
             ResultSet users = select.executeQuery()) {
            while (users.next()) {
                String password = users.getString("PASSWORD");
                String preferred = preferredUsername(users.getString("NAME"), users.getString("EMAIL"));
                ExistingUser existing = findExistingUser(target, preferred);
                int targetId;
                String username;
                if (existing != null && existing.password().equals(password)) {
                    username = existing.username();
                    targetId = existing.id();
                    System.out.printf("User '%s' already migrated; reusing it.%n", username);
                } else {
                    username = uniqueUsername(target, preferred);
                    try (PreparedStatement insert = target.prepareStatement(
                            "INSERT INTO ourusers (username, password, role) VALUES (?, ?, ?) RETURNING id")) {
                        insert.setString(1, username);
                        insert.setString(2, password);
                        insert.setString(3, normalizeRole(users.getString("ROLE")));
                        try (ResultSet inserted = insert.executeQuery()) {
                            inserted.next();
                            targetId = inserted.getInt(1);
                        }
                    }
                    System.out.printf("Migrated user as '%s'.%n", username);
                }
                userIds.put(users.getInt("ID"), targetId);
            }
        }
        return userIds;
    }

    private static int migrateHoldings(Connection source, Connection target,
                                       Map<Integer, Integer> userIds) throws Exception {
        int count = 0;
        try (PreparedStatement select = source.prepareStatement(
                "SELECT NAME, QUANTITY, SYMBOL, USER_ID FROM USER_HOLDINGS ORDER BY ID");
             ResultSet holdings = select.executeQuery();
             PreparedStatement upsert = target.prepareStatement("""
                     INSERT INTO user_holdings (name, quantity, symbol, user_id)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT (user_id, symbol)
                     DO UPDATE SET name = EXCLUDED.name, quantity = EXCLUDED.quantity
                     """)) {
            while (holdings.next()) {
                Integer targetUserId = userIds.get(holdings.getInt("USER_ID"));
                if (targetUserId == null) continue;
                upsert.setString(1, holdings.getString("NAME"));
                upsert.setDouble(2, holdings.getDouble("QUANTITY"));
                upsert.setString(3, holdings.getString("SYMBOL"));
                upsert.setInt(4, targetUserId);
                upsert.addBatch();
                count++;
            }
            upsert.executeBatch();
        }
        return count;
    }

    private static String preferredUsername(String name, String email) {
        String candidate = name == null ? "" : name.strip().toLowerCase(Locale.ROOT);
        if (VALID_USERNAME.matcher(candidate).matches()) return candidate;

        String localPart = email == null ? "user" : email.split("@", 2)[0];
        candidate = localPart.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}_-]", "");
        if (candidate.isEmpty() || !Character.isLetter(candidate.codePointAt(0))) candidate = "user" + candidate;
        if (candidate.length() < 3) candidate = candidate + "user";
        return candidate.substring(0, Math.min(candidate.length(), 28));
    }

    private static String uniqueUsername(Connection target, String base) throws Exception {
        String candidate = base;
        int suffix = 2;
        while (usernameExists(target, candidate)) {
            candidate = base.substring(0, Math.min(base.length(), 27)) + suffix++;
        }
        return candidate;
    }

    private static boolean usernameExists(Connection target, String username) throws Exception {
        return findExistingUser(target, username) != null;
    }

    private static ExistingUser findExistingUser(Connection target, String username) throws Exception {
        try (PreparedStatement query = target.prepareStatement(
                "SELECT id, username, password FROM ourusers WHERE LOWER(username) = LOWER(?)")) {
            query.setString(1, username);
            try (ResultSet result = query.executeQuery()) {
                return result.next()
                        ? new ExistingUser(result.getInt("id"), result.getString("username"), result.getString("password"))
                        : null;
            }
        }
    }

    private static String normalizeRole(String role) {
        return "ROLE_ADMIN".equals(role) ? "ROLE_ADMIN" : "ROLE_USER";
    }

    private record ExistingUser(int id, String username, String password) {}
}
