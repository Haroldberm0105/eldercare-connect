# Testing guide

Start the full stack first: `docker compose up --build` (from the project root).

## Unit tests (no services needed)
```bash
cd api-gateway && npm install && npm test
cd services/checkin-service && npm install && npm test
cd services/alert-service && npm install && npm test
cd services/clinic-risk-service && npm install && npm test
cd services/legacy-emr-adapter && npm install && npm test
```

## Postman – functional, security and integration
1. Postman → Import → `postman/ElderCare_Connect.postman_collection.json` and `postman/ElderCare_Connect.local.postman_environment.json`.
2. Select the **ElderCare Connect - Local** environment.
3. Run the whole collection in order with the Collection Runner (folder `0. Auth` stores the tokens the other folders use).

CLI (Newman):
```bash
npx newman run postman/ElderCare_Connect.postman_collection.json \
  -e postman/ElderCare_Connect.local.postman_environment.json \
  --reporters cli,htmlextra --reporter-htmlextra-export results/newman-report.html
```
(`htmlextra` needs `npm i -g newman-reporter-htmlextra`; drop it to use the plain CLI reporter.)

Folder **5. Integration** is the end-to-end chain from Section 4's objective:
caregiver check-in → Family Alert raised + SMS queued → Clinic Risk Queue item (P1/P2) → legacy EMR history via SOAP adapter → nurse updates triage status. The console prints the observed end-to-end time.

## SoapUI – legacy SOAP integration
1. Make sure the mock EMR (`:4005`) and the adapter (`:4004`) are running (both are published by docker compose).
2. SoapUI → File → Import Project → `soapui/ElderCare_Legacy_EMR-soapui-project.xml`.
3. Project properties: `emrEndpoint` (default `http://localhost:4005/emr`), `adapterUrl` (`http://localhost:4004`), `internalToken` (**set to your `INTERNAL_SERVICE_TOKEN`**).
4. Run the **Legacy EMR Integration Suite**:
   - TC1 – live GetPatientHistory: SOAP response valid, not a fault, WSDL schema compliance, XPath checks, SLA.
   - TC2 – unknown patient returns a `PatientNotFound` SOAP Fault.
   - TC3 – adapter `/legacy/translate`: SOAP/XML in → JSON contract out.
   - TC4 – adapter end-to-end call, including fault → HTTP 404 mapping.

CLI: `testrunner.sh -s"Legacy EMR Integration Suite" -PinternalToken=<token> soapui/ElderCare_Legacy_EMR-soapui-project.xml`

To point at a real RHU EMR, change `emrEndpoint` and set `LEGACY_EMR_URL` (and WS-Security credentials) on the adapter.

## JMeter – load and stress
Raise the gateway limits before load testing (in `.env`, then `docker compose up -d api-gateway`):
```
RATE_LIMIT_MAX=100000
JWT_ACCESS_TTL=120m
```

Load test (morning check-in rush + clinic reads, 5 minutes):
```bash
jmeter -n -t jmeter/ElderCare_Connect_Load_Stress.jmx \
  -Jhost=localhost -Jport=8080 -Jusers=50 -JclinicUsers=10 -JrampUp=60 -Jduration=300 \
  -l jmeter/results/load.jtl -e -o jmeter/results/load-report
```

Stress test (typhoon spike): open the plan in the JMeter GUI, enable **STRESS - Typhoon alert spike**, optionally disable the two LOAD groups, then:
```bash
jmeter -n -t jmeter/ElderCare_Connect_Load_Stress.jmx -JstressUsers=500 -JstressRampUp=120 -JstressDuration=600 \
  -l jmeter/results/stress.jtl -e -o jmeter/results/stress-report
```
Record the thread count at which error rate exceeds 1 % or p95 latency exceeds 2 s – that is the breaking point for the Section 14 scaling plan.

## Failure testing
| Scenario | How | Expected |
|---|---|---|
| Alert service down | `docker compose stop alert-service`, submit critical check-in, `docker compose start alert-service` | check-in 201; alert appears after restart (outbox retry) |
| Clinic service down | same with `clinic-risk-service` | gateway returns 503 fast for queue reads (circuit breaker); events delivered after restart |
| Twilio failing | set wrong `TWILIO_AUTH_TOKEN` with `SMS_DRY_RUN=false` | `notification_log` shows retries then `failed`; in-app alert still visible |
| OpenWeatherMap unreachable | set `OPENWEATHER_BASE_URL=http://10.255.255.1` after one successful run | mashup uses cache, logs "using stale cached weather data" |
| Slow legacy EMR | `MOCK_EMR_DELAY_MS=8000` on mock-legacy-emr | EMR history returns 502/503, queue keeps working |
| Flaky legacy EMR | `MOCK_EMR_FAIL_RATE=0.5` | adapter retries once, circuit opens after repeated failures |
