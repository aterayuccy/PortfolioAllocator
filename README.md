# Portfolio Allocator

Enter multiple stocks, target weights, existing shares, deposits and withdrawals to calculate portfolio rebalancing trades. No account is required. Prices and TWD exchange rates can be fetched or entered manually. Target weights must total 100%. Whole-share mode rounds target holdings down and reports residual cash; fractional mode computes theoretical exact weights. Fees and taxes are excluded.

Inputs remain only in the current page session and reset when the page reloads. The former fundamental scoring and automatic weight allocation interface has been removed.

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
node --test src/rebalance.test.js
npm run build
cd ../server
.\mvnw.cmd test
```

## Deployment

Run `docker compose up --build` to serve the application at `http://localhost:1010`.

Railway builds the root Dockerfile into one web service. The React client is packaged into Spring Boot. Railway supplies PORT; no database, JWT secret, or bootstrap accounts are required.

Previous account databases are no longer used. Existing browser-saved watchlists and holdings are cleared when the updated site opens.
