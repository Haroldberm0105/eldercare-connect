# Submission Guide – Frontend, Cloud, Middleware, Load Testing, CI/CD

How to run, demonstrate and explain each remaining part of ElderCare Connect.
For the proposal-by-section checklist see `PROPOSAL_TRACEABILITY.md`.

---

## 1. Frontend interfaces

### React web app – `frontend/web`
| View | File | Role | Gateway endpoints used |
|---|---|---|---|
| Login | `src/pages/Login.jsx` | all | `POST /oauth/token` |
| Caregiver Check-In | `src/pages/CaregiverCheckIn.jsx` | caregiver | `POST /api/checkins`, `GET /api/patients/:id/history` |
| Family Dashboard | `src/pages/FamilyDashboard.jsx` | family_member | `/history`, `GET /api/alerts/notifications` |
| Clinic Portal | `src/pages/ClinicQueue.jsx` | clinic_staff, system_admin | `GET/PATCH /api/clinic/queue`, `/emr-history`, `/alerts/weather-check` |
| Admin View | `src/pages/AdminView.jsx` | system_admin | `GET /api/admin/health`, `GET /api/admin/users` |

How tokens are handled (`src/api.js`):
- Login stores the access and refresh tokens in `sessionStorage`, which is cleared when the tab closes.
- Every request sends `Authorization: Bearer …`.
- On a 401 it uses the refresh token once, then retries.
- The role is read from the JWT, and `main.jsx` routes each role to its own home page.
- The server still enforces RBAC; client-side routing is only for convenience.

```powershell
cd frontend\web
npm install
npm run dev          # http://localhost:3000  (proxies /api and /oauth to the gateway on :8080)
npm run build        # production bundle in dist/
```
For production, serve `dist/` behind the same domain as the gateway, or set `VITE_API_BASE_URL` and add the site to the gateway's `CORS_ORIGINS`.

### React Native caregiver app – `frontend/mobile/App.js`
- Captures blood pressure, heart rate, temperature, SpO₂, medication taken/missed, fall flag and notes.
- **Offline-first:** if the phone has no connection, the check-in is saved on the device and synced when the app returns to the foreground.
- Every check-in carries an `idempotencyKey`, so a replay never duplicates.
```powershell
cd frontend\mobile
npm install
npx expo start       # scan the QR code with Expo Go
```
Set `expo.extra.apiBaseUrl` in `app.json` to your PC's LAN IP (e.g. `http://192.168.1.10:8080`). The phone and PC must be on the same Wi-Fi, and Windows Firewall must allow port 8080.

### SMS check-in (no app, no internet)
A caregiver whose number is registered in the alert service's subscribers table can text the Twilio number:
```
CHECKIN P-1001 BP 150/90 HR 80 T 36.8 O2 96 MED Y
```
They get an instant reply ("Saved check-in for P-1001. All readings normal." or the anomaly summary).
To set this up, in the Twilio console go to Phone Numbers → your number → "A message comes in" and set it to `https://<your-public-gateway>/webhooks/twilio/inbound`. Set the same URL in `TWILIO_INBOUND_WEBHOOK_URL`. Locally you can expose the gateway with a tunnel such as ngrok.

---

## 2. Cloud deployment

### Files
- `*/Dockerfile`: `node:20-alpine`, production dependencies only via `npm ci`, runs as the non-root `node` user, with a HEALTHCHECK.
- `docker-compose.yml`: local and demo stack. Three Postgres databases, Redis, six services; only developer ports are published.
- `docker-compose.cloud.yml`: production overrides for a single cloud VM.
  - Databases, Redis, adapter and mock are not reachable from outside.
  - The gateway binds to `127.0.0.1:8080` behind a TLS proxy.
  - `restart: always`, memory limits, log rotation.
  - Demo seed data is off by default.

### Single-VM deployment (AWS EC2 / Azure VM / GCP Compute Engine)
```bash
# on an Ubuntu VM with Docker installed
git clone https://github.com/<you>/eldercare-connect.git && cd eldercare-connect
cp .env.example .env && nano .env        # strong secrets, OPENWEATHER_API_KEY, TWILIO_*, SMS_DRY_RUN=false
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up -d --build
docker compose ps                         # all services "healthy"
```
Put HTTPS in front of the gateway. The simplest option is Caddy (`caddy reverse-proxy --from api.yourdomain.com --to 127.0.0.1:8080`), which gets a free TLS certificate automatically. This covers "data in transit" from Risk 2.

### Managed AWS option (for the report)
| Proposal component | AWS service |
|---|---|
| API Gateway container | ECS Fargate service behind an Application Load Balancer (HTTPS via ACM) |
| 3 microservices + adapter | ECS Fargate services in private subnets, 2+ tasks each (Risk 4) |
| 3 PostgreSQL databases | Amazon RDS for PostgreSQL with storage encryption (AES-256, Risk 2) |
| BullMQ queue | ElastiCache for Redis |
| Secrets | AWS Secrets Manager → task environment variables |
| Logs | CloudWatch Logs (the services already emit structured JSON) |
| Legacy EMR at the RHU | stays on-prem; reached over Site-to-Site VPN (hybrid cloud, Section 14) |

---

## 3. Middleware and external integrations – verified data flows

All flows below were exercised end-to-end against the running stack (PostgreSQL 16 + Redis + all six services).

### A. Check-in → Alert → Clinic Queue (saga)
```
Caregiver ──POST /api/checkins──► Gateway (JWT ✓, role ✓, patient scope ✓)
   └─► Check-In service: validate → detect anomalies → ONE transaction { insert check-in, insert outbox rows }
          └─► outbox dispatcher ──► Alert service /internal/events  → alert + in-app + SMS jobs
                                └─► Clinic service /internal/events → upsert triage item, weighted score
```
- **Measured:** a critical check-in reached the family alert feed in 158 ms and the clinic queue (P1) in 170 ms. The objective is ≤ 2.0 s.
- **Resilience test:** the Alert service was stopped and a check-in was submitted. It still returned 201, the outbox recorded `pending, attempt 2, ECONNREFUSED`, and after restart it was delivered automatically on attempt 3.
- **Idempotency:** consumers ignore a repeated `eventId`, and the same `idempotencyKey` returns the original check-in instead of creating a duplicate.

### B. OpenWeatherMap × patient zip codes (server-side mashup)
```
scheduler / "Run weather check"
  └─► GET checkin-service /internal/locations          (distinct zip codes of monitored patients)
      for each zip:
        weather_cache fresh (< 60 min)? ── yes ─► use cache
                                          no ──► GET api.openweathermap.org/data/2.5/weather?zip=<zip>,PH
                                                  └─ fails? use cached data ≤ 24 h, log outage
        normalise → risk profile (heat index = max(OWM feels_like, NOAA formula))
        heat index > 40 °C   → patients with hypertension / cardiovascular / diabetes / kidney / COPD
        storm / wind ≥ 17.2 m/s → mobility-restricted patients
          └─► SMS warning (deduplicated per patient per day / 6 h) + clinic triage item (weather.risk_detected)
```
**Verified with the fake OWM server (`testing/mocks/fake-openweathermap.js`):**
| Zip | Fake weather | Result |
|---|---|---|
| 1012 | 34 °C, 70 % RH → heat index 46.8 °C | P-1001 (hypertension, cardiovascular): 3 notifications, clinic item P1 |
| 1119 | 24 m/s wind, heavy rain | P-1002 (mobility-restricted): 2 notifications, clinic item P2 |
| 1008 | normal | P-1003: no action |
| second run | | served from cache (no API call), duplicate alerts suppressed |
| fake OWM stopped, cache aged 3 h | | `cache=stale`, mashup still ran, outage logged |

**Demo it in the defense:**
```powershell
node testing\mocks\fake-openweathermap.js
# alert-service .env: OPENWEATHER_API_KEY=demo-key  and add  OPENWEATHER_BASE_URL=http://localhost:4999
# restart alert-service, then in the Clinic Portal click "Run weather check"
```

### C. Redis / BullMQ Twilio retry
```
dispatchAlert() → alerts row (in-app, delivered immediately)
               → notification_log row per subscriber (status queued)
               → BullMQ job { notificationId, to, body }   (attempts = SMS_MAX_ATTEMPTS, exponential backoff)
worker (rate limited to 1 SMS/s) → twilio.messages.create()
   success              → status sent  (later delivered / undelivered via /webhooks/twilio/status)
   transient failure    → throw → BullMQ retries after backoff
   permanent failure    → status failed immediately (invalid / opted-out number)
   attempts exhausted   → status failed; in-app alert remains the fallback channel
```
**Verified:** in live mode with Twilio unreachable, the log showed `sms failed, will retry` on attempts 1 and 2, then `permanently failed – in-app notification remains as fallback`. The database showed `sms | failed | attempts 3`, and the in-app alert stayed `delivered`.
Without Redis (`REDIS_URL=` blank) the same retry logic runs in memory, which is fine for local development but not durable across restarts.

---

## 4. Load and stress testing with JMeter

Plan file: `testing/jmeter/ElderCare_Connect_Load_Stress.jmx`

| Thread group | Simulates | Default |
|---|---|---|
| setUp | obtains caregiver and nurse tokens once, shared via JMeter properties | 1 thread |
| LOAD – Caregiver check-in rush | morning/evening check-ins with random vitals | 50 users, 60 s ramp-up, 300 s |
| LOAD – Clinic queue reads | nurses refreshing the queue and history | 10 users |
| STRESS – Typhoon spike (disabled) | abnormal vitals → alerts + queue updates | 500 users, 120 s ramp-up, 600 s |

Assertions: HTTP 201/200 and response time ≤ 2000 ms (Section 4 objective).

**Before you run it:**
1. The gateway allows 300 requests/min per IP by default. For the test, set `RATE_LIMIT_MAX=100000` and `JWT_ACCESS_TTL=120m` in `api-gateway\.env`, then restart the gateway. Set them back afterwards.
2. Close other heavy apps. JMeter and all six services share your CPU, so record your machine specs in the report.

```powershell
# Load test (CLI mode = accurate numbers; the GUI is only for editing)
jmeter -n -t testing\jmeter\ElderCare_Connect_Load_Stress.jmx -Jusers=50 -JclinicUsers=10 -Jduration=300 -l testing\jmeter\results\load.jtl -e -o testing\jmeter\results\load-report
```
For the stress test, open the plan in the GUI, enable **STRESS – Typhoon alert spike**, disable the two LOAD groups, save, then:
```powershell
jmeter -n -t testing\jmeter\ElderCare_Connect_Load_Stress.jmx -JstressUsers=300 -JstressRampUp=120 -JstressDuration=300 -l testing\jmeter\results\stress.jtl -e -o testing\jmeter\results\stress-report
```
Increase `stressUsers` (300 → 500 → 800) until the error rate rises above 1 % or p95 latency goes above 2 s.

**What to report** (from `load-report/index.html`):
- Throughput (requests/s)
- Average, p90, p95 and p99 latency per endpoint
- Error %
- The user count where the system started to degrade, which is your breaking point

Link the breaking point to Section 14: "beyond N concurrent users we would scale the check-in service horizontally".

---

## 5. CI/CD – `.github/workflows/ci.yml`

Runs on every push and pull request to `main`:

| Job | What it proves |
|---|---|
| `unit-tests` (matrix of 5 backend packages) | `npm ci` from the lockfiles + `npm test` (38 unit tests in total) |
| `frontend-build` | the React web app compiles (`vite build`) |
| `docker-build` (after unit tests) | every Dockerfile builds |
| `integration` (after docker-build) | starts the full stack with Docker Compose and runs the Postman collection with Newman |

To show it in the defense:
1. Push to GitHub.
2. Open the **Actions** tab and show the green run.
3. Optionally, protect `main` (Settings → Branches → require status checks) so pull requests can only merge when CI passes. This matches the workflow in Section 16.

---

## Demo script (about 10 minutes)

1. **Admin View:** all services up, circuit breakers closed, users and roles.
2. **Caregiver** (phone app or web): submit normal vitals, then BP 186/118 with medication missed.
3. **Family Dashboard:** the critical alert appears; show that the SMS was queued (dry-run log in the alert-service terminal).
4. **Clinic Portal:** P1 item at the top with its score breakdown. Open it to show the legacy EMR history (SOAP translated to JSON), then move it to *in review* with a note.
5. **Weather:** start the fake OWM server and click "Run weather check". A heat warning and a typhoon warning appear in the queue.
6. **Resilience:** stop the alert service, submit a check-in (still 201), restart it, and watch the alert arrive.
7. **Security:** in Postman, show family → clinic queue = 403, and a tampered token = 401.
8. **CI:** show the green GitHub Actions run.
