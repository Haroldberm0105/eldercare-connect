-- Demo patients (only loaded when SEED_DEMO_DATA=true). Patient IDs match api-gateway/data/users.json.
INSERT INTO patients (id, full_name, birth_date, address_line, zip_code, country_code, latitude, longitude, conditions, mobility_restricted, baseline, assigned_clinic)
VALUES
  ('P-1001', 'Lola Remedios Dela Cruz', '1946-03-14', 'Tondo, Manila',      '1012', 'PH', 14.6190, 120.9680, '{hypertension,cardiovascular}', FALSE,
   '{"systolic":135,"diastolic":85,"heartRate":76,"temperatureC":36.6,"spo2":97}', 'RHU-MNL-01'),
  ('P-1002', 'Lolo Ernesto Villanueva', '1941-11-02', 'Bagong Silangan, Quezon City', '1119', 'PH', 14.7000, 121.1000, '{diabetes,osteoarthritis}', TRUE,
   '{"systolic":125,"diastolic":80,"heartRate":72,"temperatureC":36.5,"spo2":96}', 'RHU-QC-03'),
  ('P-1003', 'Lola Felicidad Ramos', '1950-07-21', 'Sampaloc, Manila', '1008', 'PH', 14.6100, 120.9900, '{copd}', FALSE,
   '{"systolic":120,"diastolic":78,"heartRate":80,"temperatureC":36.7,"spo2":94}', 'RHU-MNL-01')
ON CONFLICT (id) DO NOTHING;

-- Demo prescriptions (inserted once per patient; matches the mock legacy EMR records).
INSERT INTO patient_medications (patient_id, name, dosage, frequency, times, instructions, prescribed_by)
SELECT v.patient_id, v.name, v.dosage, v.frequency, v.times, v.instructions, v.prescribed_by
FROM (VALUES
  ('P-1001', 'Amlodipine', '10 mg', 'Once daily', ARRAY['08:00'], 'Take after breakfast', 'Dr. L. Reyes, RHU-MNL-01'),
  ('P-1001', 'Losartan', '50 mg', 'Once daily', ARRAY['20:00'], 'Take at the same time every evening', 'Dr. L. Reyes, RHU-MNL-01'),
  ('P-1001', 'Aspirin', '80 mg', 'Once daily', ARRAY['08:00'], 'Take with food', 'Dr. L. Reyes, RHU-MNL-01'),
  ('P-1002', 'Metformin', '500 mg', 'Twice daily', ARRAY['08:00','18:00'], 'Take with meals', 'Dr. M. Santos, RHU-QC-03'),
  ('P-1003', 'Tiotropium', '18 mcg', 'Once daily', ARRAY['07:00'], 'One inhalation each morning', 'Dr. L. Reyes, RHU-MNL-01'),
  ('P-1003', 'Salbutamol inhaler', '100 mcg', 'As needed', ARRAY[]::text[], 'Up to 2 puffs when short of breath', 'Dr. L. Reyes, RHU-MNL-01')
) AS v(patient_id, name, dosage, frequency, times, instructions, prescribed_by)
WHERE EXISTS (SELECT 1 FROM patients p WHERE p.id = v.patient_id)
  AND NOT EXISTS (SELECT 1 FROM patient_medications m WHERE m.patient_id = v.patient_id);
