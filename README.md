# Portfolio Allocator

## Local development

Prerequisites:

- Java 21
- Node.js and npm
- Docker with Docker Compose

Start PostgreSQL from the repository root:

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
```

Start the Spring Boot API:

```powershell
cd server
.\start.ps1
```

On Windows with PostgreSQL installed, the startup script automatically creates
and starts an isolated project database at `127.0.0.1:55432`. Its files live
under the ignored `.runtime/postgres-data` directory. The cluster accepts only
local loopback connections and is intended for development use.

To connect to another PostgreSQL instance, pass its JDBC URL and role. The
script securely prompts for that instance's password:

```powershell
.\start.ps1 -DatabaseUrl jdbc:postgresql://localhost:5432/portfolio_allocator -DatabaseUser postgres
```

On Windows, the Maven Wrapper automatically uses a Java 21 runtime under
`.runtime/jdk21` when present, even if the system `PATH` still points to Java 8.

Start the Vite client in another terminal:

```powershell
cd client
npm run dev
```

The client runs at `http://localhost:5173` and the API runs at
`http://localhost:1010`.

The default development database settings are defined in `.env.example` and
match `server/src/main/resources/application.properties`. For deployed
environments, provide `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` through the
hosting platform's secret or environment-variable settings.

The previous H2 files under `server/data/` are not read by PostgreSQL. Migrating
existing local data requires a separate one-time export/import step.

## Cloud deployment

The `client` directory can be deployed to OpenAI Sites. Its Cloudflare Worker
serves the React application and API, while Cloudflare D1 stores users and
portfolio holdings.

Required runtime variables:

- `JWT_SECRET`
- `ADMIN_BOOTSTRAP_USERNAME`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `USER_BOOTSTRAP_USERNAME`
- `USER_BOOTSTRAP_PASSWORD`

Passwords and signing secrets must be configured in the hosting environment;
do not commit them to this repository.
