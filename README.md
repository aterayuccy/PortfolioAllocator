# ShareBalance

[Live app](https://sharebalance.alwaysdata.net/) · [GitHub repository](https://github.com/aterayuccy/ShareBalance)

Search and add multiple stocks in the left settings panel, then enter target weights and existing shares in the right rebalancing table. Select TWD or USD as the valuation currency and enter a signed cash change in that same currency. Positive cash adds funds, negative cash withdraws funds, and zero rebalances existing holdings only. Current and adjusted portfolio values, stock values, and target values use the selected currency. Stock prices stay in their quoted currencies; the table shows each stock currency's exchange rate into the selected currency. Prices and exchange rates are fetched when a stock is added and can be refreshed with the update button. No account is required. Target weights must total 100%. Results update automatically and show fractional share estimates, as in the original rebalancing step. Fees and taxes are excluded.

Inputs remain only in the current page session and reset when the page reloads. The former fundamental scoring and automatic weight allocation interface has been removed.

## Local development

Prerequisites: Java 21 and Node.js with npm. No database is required.

The Windows checkout is located at `D:\project\ShareBalance`. Open a terminal in that directory before running the commands below.

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

The alwaysdata deployment is built by `./alwaysdata/build.ps1` for the live site, with document root `/home/sharebalance/portfolioallocator/alwaysdata/root`. This server path is separate from the Windows checkout. It uses a small PHP endpoint for Yahoo Finance quotes instead of running a Java process. A quote is required for the calculator to show results. The free account is for noncommercial use only; a paid plan is required before offering paid features.

After pushing a new build, enable the paused manual update task in the `sharebalance` alwaysdata account for one run, check the live site, then pause it again. The task runs `git -C /home/sharebalance/portfolioallocator pull --ff-only origin main`.

Previous account databases are no longer used. Existing browser-saved watchlists and holdings are cleared when the updated site opens.
