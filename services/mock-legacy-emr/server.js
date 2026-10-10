'use strict';

/**
 * Mock Legacy Clinic EMR (SOAP 1.1) - stands in for a partner RHU's on-prem EMR during
 * development, Postman integration runs and SoapUI tests. Zero dependencies (plain node:http).
 *
 *   GET  /emr?wsdl   -> WSDL
 *   POST /emr        -> GetPatientHistory (SOAPAction http://rhu.health.gov.ph/emr/v1/GetPatientHistory)
 *
 * Fault simulation for failure testing:  MOCK_EMR_DELAY_MS=8000  or  MOCK_EMR_FAIL_RATE=0.5
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4005);
const NS = 'http://rhu.health.gov.ph/emr/v1';
const WSDL = fs.readFileSync(path.join(__dirname, 'GetPatientHistory.wsdl'), 'utf8')
  .replace('http://localhost:4005/emr', process.env.PUBLIC_URL || `http://localhost:${PORT}/emr`);

// Legacy-style data: MM/DD/YYYY dates, code-style visit types, "Y"/"N" flags.
const PATIENTS = {
  'P-1001': {
    facility: 'RHU-MNL-01', name: 'DELA CRUZ, REMEDIOS', birth: '03/14/1946', sex: 'F',
    diagnoses: [['I10', 'Essential (primary) hypertension', '06/02/2015', 'Y'], ['I25.10', 'Atherosclerotic heart disease', '01/19/2020', 'Y']],
    visits: [
      ['V-88121', '08/22/2026', 'CONSULT', 'RHU Tondo', 'Dizziness', '162/98', 'Adjusted amlodipine dose'],
      ['V-87002', '04/03/2026', 'ADMIT', 'Gat Andres Bonifacio Memorial MC', 'Hypertensive urgency', '188/112', 'Admitted 2 days'],
      ['V-85510', '11/15/2025', 'FOLLOWUP', 'RHU Tondo', 'BP monitoring', '140/88', ''],
    ],
    meds: [['Amlodipine', '10 mg', 'Once daily', 'Y'], ['Losartan', '50 mg', 'Once daily', 'Y'], ['Aspirin', '80 mg', 'Once daily', 'Y']],
    allergies: ['Penicillin'],
  },
  'P-1002': {
    facility: 'RHU-QC-03', name: 'VILLANUEVA, ERNESTO', birth: '11/02/1941', sex: 'M',
    diagnoses: [['E11.9', 'Type 2 diabetes mellitus without complications', '09/10/2012', 'Y'], ['M17.0', 'Bilateral primary osteoarthritis of knee', '02/27/2019', 'Y']],
    visits: [['V-90311', '09/05/2026', 'HOMEVISIT', 'RHU Bagong Silangan', 'Mobility assessment', '128/80', 'Uses walker']],
    meds: [['Metformin', '500 mg', 'Twice daily', 'Y'], ['Celecoxib', '200 mg', 'As needed', 'N']],
    allergies: [],
  },
  'P-1003': {
    facility: 'RHU-MNL-01', name: 'RAMOS, FELICIDAD', birth: '07/21/1950', sex: 'F',
    diagnoses: [['J44.9', 'Chronic obstructive pulmonary disease, unspecified', '03/30/2018', 'Y']],
    visits: [['V-89900', '07/14/2026', 'ER', 'Ospital ng Sampaloc', 'Shortness of breath', '134/84', 'Nebulized, sent home']],
    meds: [['Salbutamol inhaler', '100 mcg', 'As needed', 'Y'], ['Tiotropium', '18 mcg', 'Once daily', 'Y']],
    allergies: ['Sulfa drugs'],
  },
};

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function envelope(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:emr="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
${body}
  </soapenv:Body>
</soapenv:Envelope>`;
}

function fault(code, message) {
  return envelope(`    <soapenv:Fault>
      <faultcode>${esc(code)}</faultcode>
      <faultstring>${esc(message)}</faultstring>
    </soapenv:Fault>`);
}

function historyResponse(id, p) {
  const diag = p.diagnoses.map(([c, d, on, chr]) => `          <emr:Diagnosis><emr:IcdCode>${esc(c)}</emr:IcdCode><emr:Description>${esc(d)}</emr:Description><emr:DiagnosedOn>${on}</emr:DiagnosedOn><emr:Chronic>${chr === 'Y'}</emr:Chronic></emr:Diagnosis>`).join('\n');
  const visits = p.visits.map(([vid, date, type, fac, cc, bp, rem]) => `          <emr:Visit><emr:VisitId>${vid}</emr:VisitId><emr:VisitDate>${date}</emr:VisitDate><emr:VisitType>${type}</emr:VisitType><emr:Facility>${esc(fac)}</emr:Facility><emr:ChiefComplaint>${esc(cc)}</emr:ChiefComplaint><emr:BloodPressure>${bp}</emr:BloodPressure><emr:Remarks>${esc(rem)}</emr:Remarks></emr:Visit>`).join('\n');
  const meds = p.meds.map(([n, d, f, a]) => `          <emr:Medication><emr:DrugName>${esc(n)}</emr:DrugName><emr:Dosage>${esc(d)}</emr:Dosage><emr:Frequency>${esc(f)}</emr:Frequency><emr:Active>${a === 'Y'}</emr:Active></emr:Medication>`).join('\n');
  const allergies = p.allergies.map((a) => `          <emr:Allergy>${esc(a)}</emr:Allergy>`).join('\n');
  return envelope(`    <emr:GetPatientHistoryResponse>
      <emr:PatientHistory>
        <emr:PatientId>${esc(id)}</emr:PatientId>
        <emr:FacilityCode>${p.facility}</emr:FacilityCode>
        <emr:FullName>${esc(p.name)}</emr:FullName>
        <emr:BirthDate>${p.birth}</emr:BirthDate>
        <emr:Sex>${p.sex}</emr:Sex>
        <emr:Diagnoses>
${diag}
        </emr:Diagnoses>
        <emr:Visits>
${visits}
        </emr:Visits>
        <emr:Medications>
${meds}
        </emr:Medications>
        <emr:Allergies>
${allergies}
        </emr:Allergies>
      </emr:PatientHistory>
    </emr:GetPatientHistoryResponse>`);
}

function send(res, status, xml, type = 'text/xml; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(xml) });
  res.end(xml);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, '{"status":"up","service":"mock-legacy-emr"}', 'application/json');
  if (url.pathname !== '/emr') return send(res, 404, fault('soapenv:Client', 'Unknown endpoint'));
  if (req.method === 'GET' && url.searchParams.has('wsdl')) return send(res, 200, WSDL);
  if (req.method !== 'POST') return send(res, 405, fault('soapenv:Client', 'Use POST'));

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    const respond = () => {
      if (Math.random() < Number(process.env.MOCK_EMR_FAIL_RATE || 0)) return send(res, 503, 'Service Unavailable', 'text/plain');
      if (!/GetPatientHistory/.test(String(req.headers.soapaction || '')) && !/GetPatientHistoryRequest/.test(body)) {
        return send(res, 500, fault('soapenv:Client', 'Unsupported operation'));
      }
      const m = /<(?:\w+:)?PatientId>\s*([^<]+?)\s*<\/(?:\w+:)?PatientId>/.exec(body);
      if (!m) return send(res, 500, fault('soapenv:Client.InvalidRequest', 'PatientId is required'));
      const p = PATIENTS[m[1]];
      if (!p) return send(res, 500, fault('soapenv:Client.PatientNotFound', `Patient ${m[1]} not found`));
      console.log(`${new Date().toISOString()} GetPatientHistory ${m[1]}`);
      return send(res, 200, historyResponse(m[1], p));
    };
    const delay = Number(process.env.MOCK_EMR_DELAY_MS || 0);
    return delay ? setTimeout(respond, delay) : respond();
  });
  return undefined;
});

server.listen(PORT, () => console.log(`mock-legacy-emr listening on :${PORT} (WSDL: http://localhost:${PORT}/emr?wsdl)`));
