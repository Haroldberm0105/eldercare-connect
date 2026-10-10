-- Demo subscribers (only loaded when SEED_DEMO_DATA=true). Replace with real, consented numbers.
-- In Twilio trial mode, SMS can only be sent to numbers you have verified in the Twilio console.
INSERT INTO subscribers (patient_id, user_id, name, relation, phone_e164) VALUES
  ('P-1001', 'U-FM-001', 'Jose Reyes',   'family',    '+639175550101'),
  ('P-1001', 'U-CG-001', 'Maria Santos', 'caregiver', '+639175550102'),
  ('P-1002', 'U-CG-001', 'Maria Santos', 'caregiver', '+639175550102'),
  ('P-1003', NULL,       'Carmen Ramos', 'family',    '+639175550103')
ON CONFLICT (patient_id, phone_e164) DO NOTHING;
