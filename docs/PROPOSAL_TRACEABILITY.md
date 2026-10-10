# Proposal → Implementation Traceability

Every commitment in the project proposal (*ElderCare Connect – Project Proposal*, TIP Manila, SIA 1)
mapped to where it is implemented and how it was verified.

Legend: ✅ implemented and verified · ◑ implemented, verification is manual or deployment-time · ⬜ documented only (out of scope for a prototype)

## Section 4 – Specific objectives

| Objective | Status | Where / evidence |
|---|---|---|
| Integrate the 3 microservices with REST + JSON | ✅ | `services/*/src/routes.js`; services call each other only via REST (`/internal/*`) and events |
| API Gateway as single secure entry point | ✅ | `api-gateway/server.js`, `src/routes/index.js`, `src/lib/proxy.js` |
| API mashup with an external weather API | ✅ | `services/alert-service/src/weatherAlertMashup.js` – verified with heatwave + typhoon scenarios |
| RBAC + OAuth 2.0 / JWT on all services | ✅ | `authMiddleware.js`, `roleMiddleware.js`; 13 gateway tests (forged, expired, `alg=none`, refresh-as-access, spoofed headers) |
| Evaluate resilience, mediation, load, degradation with Postman, JMeter, SoapUI | ✅ | `testing/postman`, `testing/jmeter`, `testing/soapui`, failure scenarios in `testing/README.md` |
| End-to-end check-in → family alert → clinic queue **≤ 2.0 s** | ✅ | Measured **~170 ms** (`npm run smoke`, Postman folder 5) |
| Each service owns its data; exposed only via REST | ✅ | Separate DB per service; no cross-database queries anywhere in the code |

## Section 5 – Stakeholders → interfaces

| Stakeholder | Interface | Status |
|---|---|---|
| Primary Caregiver | React Native app (`frontend/mobile`), web check-in page, **SMS check-in** | ✅ |
| Family Member / Sponsor | Family Dashboard (`FamilyDashboard.jsx`) + SMS alerts | ✅ |
| Clinic Staff / Nurse | Clinic Portal risk queue + legacy EMR history (`ClinicQueue.jsx`) | ✅ |
| System Administrator | Admin View: service health, circuit breakers, user accounts and roles (`AdminView.jsx`) | ✅ |

## Section 7 – TO-BE architecture (including the "Note on Diagram Flow")

| Item | Status | Notes |
|---|---|---|
| Client tier → API Gateway → 3 services → 3 databases | ✅ | `docker-compose.yml` shows the exact topology |
| Legacy EMR flow is **inbound** (EMR → Adapter → Clinic Risk Queue) | ✅ | Clinic service pulls history through the adapter (`GET /api/clinic/patients/:id/emr-history`) |
| OpenWeatherMap mashup result feeds the **Clinic Risk Queue** | ✅ | The Alert service queries OWM (Section 11) and sends `weather.risk_detected` to the Clinic service, which creates the preventive triage item |
| Rate limiting and request validation at the gateway | ✅ | `express-rate-limit` (API + brute-force login limits), JSON size limits, per-service validation |

> **Defense tip:** the OpenWeatherMap calls live in the **Family Alert & Notification Service**, exactly as Section 11 says
> ("Periodically queries the OpenWeatherMap API…"). The Clinic Risk Queue **receives** the environmental trigger and
> scores it. Describe it this way, not as "the Clinic service calls OpenWeatherMap".

## Section 9 – Service decomposition

| Service | Responsibility from proposal | Status |
|---|---|---|
| Daily Check-In Logger | validate vitals with range checks, timestamp, trend analysis | ✅ `validation.js`, `anomaly.js`, `/history` trends |
| Family Alert & Notification | SMS/push from internal anomalies **and** weather data; missed check-ins | ✅ events + mashup + `missedCheckinJob.js` |
| Clinic Risk Queue | weighted score: internal severity + environmental exposure | ✅ `riskScore.js` (base + compounding + vulnerability + EMR) |
| Legacy EMR Adapter | stateless SOAP/XML → JSON | ✅ owns no tables |

## Section 10 – API plan

| Endpoint | Status |
|---|---|
| `POST /api/checkins` | ✅ |
| `GET /api/patients/{id}/history` | ✅ |
| `POST /api/alerts/dispatch` | ✅ |
| `GET /api/clinic/queue` | ✅ |
| SOAP `GetPatientHistory` (XML in → JSON out) | ✅ WSDL at `services/mock-legacy-emr/GetPatientHistory.wsdl` |

## Section 11 – External API and mashup

| Commitment | Status | Evidence |
|---|---|---|
| Heat index > 40 °C → dehydration SMS to caregivers + preventive clinic item | ✅ | Heat index 46.8 °C → hypertensive patient warned, P1 item |
| Storm advisory → flag **mobility-restricted** patients + clinic item | ✅ | 24 m/s wind → only the mobility-restricted patient flagged, P2 item |
| Cache per zip code to respect rate limits | ✅ | 60-minute cache; second run makes no API call |
| OWM unreachable → last cached data, outage logged | ✅ | Stale data up to 24 h used; "using stale cached weather data" logged |
| Twilio failure → queued retry + in-app fallback | ✅ | BullMQ retried 3× with backoff, then `failed`; in-app alert already delivered |

## Section 12 – Security

| Commitment | Status | Notes |
|---|---|---|
| OAuth 2.0 + JWT bearer tokens, stateless | ✅ | `/oauth/token` (password + refresh_token grants) |
| RBAC with role claims, domain isolation | ✅ | Family member → clinic queue = 403 (tested) |
| API keys in environment variables | ✅ | Never in code or browser; `.env` git-ignored; logs redact secrets |
| 4 roles | ✅ | caregiver, family_member, clinic_staff, system_admin |
| PII/PHI protection | ◑ | Patient scoping per token; TLS + AES-256 at rest are deployment settings (load balancer + RDS encryption) – see `docs/SUBMISSION_GUIDE.md` §2 |

## Section 13 – Testing strategy

| Layer | Tool | Status |
|---|---|---|
| Functional | Postman | ✅ folders 0–4 |
| Integration | Postman / Newman | ✅ folder 5 (+ `npm run smoke`, 21 checks) |
| Legacy/protocol | SoapUI | ✅ 4 test cases incl. WSDL schema compliance and fault mapping |
| Failure | mock servers + JMeter | ✅ fake OpenWeatherMap (`testing/mocks`), mock EMR delay/failure knobs, service-down scenarios |
| Load | JMeter | ◑ plan provided; run on your machine and record results |
| Stress | JMeter | ◑ plan provided (typhoon spike group) |

## Section 14 – Cloud

| Commitment | Status |
|---|---|
| Containerised services, independently deployable | ✅ one Dockerfile per service |
| Cloud deployment (AWS / Azure / GCP) | ◑ `docker-compose.cloud.yml` for a single VM; ECS/RDS outline in the guide |
| Each service keeps its own DB in the cloud | ✅ |
| Hybrid: legacy EMR stays on-prem behind a secured integration layer | ◑ set `LEGACY_EMR_URL` to the RHU endpoint over VPN / private link |

## Section 15 – EAI and middleware

| Concern | Status | Implementation |
|---|---|---|
| Routing | ✅ | Gateway; clients never see internal addresses |
| Protocol mediation (OWM JSON → risk profile; SOAP → JSON) | ✅ | `weatherRisk.toRiskProfile()`, `emrMapper.js` |
| Message queue for Twilio retry | ✅ | BullMQ on Redis (in-memory fallback for local dev) |
| Logging / monitoring in Admin View | ✅ | Structured JSON logs with request IDs; Admin View health + circuit breakers. A central log store (e.g. CloudWatch) is a deployment choice. |
| Saga across services | ✅ | Transactional outbox + idempotent consumers; verified surviving a downed service |
| Authentication centralised at the gateway | ✅ | Services trust `X-Internal-Token` and gateway-forwarded identity |

## Section 16 – Git / DevOps

| Item | Status |
|---|---|
| Feature branches, PR to `main`, automated tests, build verification | ✅ `.github/workflows/ci.yml` (unit tests ×5, web build, Docker build, Newman integration run) |

## Section 17 – Interfaces

| Interface | Status |
|---|---|
| Login View | ✅ |
| Caregiver Check-In | ✅ web + React Native + SMS |
| Family Dashboard | ✅ trends, sparklines, alert feed, auto-refresh |
| Clinic Risk Queue | ✅ priority summary, score breakdown, reasons, triage actions, EMR panel |
| Admin View | ✅ service health, circuit breakers, **user accounts & roles** |

## Section 20 – Risks

| Risk | Mitigation promised | Status |
|---|---|---|
| 1. External API downtime | 1-day weather store, SMS resend, in-app backup | ✅ |
| 2. Privacy / breaches | OAuth/JWT, TLS, AES-256 at rest, DPIA, weekly log audits | ◑ code-side done; TLS/encryption/DPIA are deployment and process tasks |
| 3. Rural connectivity | offline-first app, sync later, **SMS-based check-in** | ✅ offline queue in the app (AsyncStorage, functionally equivalent to SQLite for this queue) + SMS check-in via Twilio inbound webhook |
| 4. Cascading failures | 2+ instances, circuit breakers, queues, 99 % SLA | ✅ circuit breakers + outbox + queues in code; ◑ replicas at deployment |
| 5. Rate limits | 1-hour cache, throttling, usage monitoring | ✅ cache, SMS rate limiter (1/s), gateway rate limits |

## Known prototype limits (state them openly in the defense)

- Clinical thresholds are screening heuristics; they need sign-off from a licensed physician.
- Users are stored in `api-gateway/data/users.json`; a production system would use an identity provider (Keycloak, Auth0, Cognito) with RS256 – already supported via `JWT_ALGORITHM=RS256`.
- Push notifications to phones are represented by the in-app alert feed; native push (FCM/APNs) is not wired.
- JMeter load/stress numbers depend on your hardware – run the plan and put your own results in the report.
