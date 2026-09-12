# Portfolio Allocator

Research stock fundamentals, calculate quality scores, and mix equal-weight and quality-based portfolio allocations. No account is required.

Watchlists, holdings, and scoring settings are saved in the current browser using localStorage. They are not synchronized between browsers or devices. Clearing browser site data removes these saved values.

## Local development

Prerequisites: Java 21 and Node.js with npm. No database is required.

Start the Spring Boot API:

```powershell
cd server
.\start.ps1
```

On Windows, the Maven Wrapper uses `.runtime/jdk21` when available.

Start the Vite client in another terminal:

```powershell
cd client
npm ci
npm run dev
```

The client runs at `http://localhost:5173` and the API at `http://localhost:1010`.

## Verification

```powershell
cd client
npm run build
cd ../server
.\mvnw.cmd test
```

## Deployment

Run `docker compose up --build` to serve the application at `http://localhost:1010`.

Railway builds the root Dockerfile into one web service. The React client is packaged into Spring Boot. Railway supplies PORT; no database, JWT secret, or bootstrap accounts are required.

Previous account databases are no longer used. This change does not delete any existing database or migrate its holdings; data already saved in the browser remains available locally.
