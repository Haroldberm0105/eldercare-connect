// ElderCare Connect - Caregiver mobile check-in app (React Native / Expo)
// Offline-first (Risk 3): check-ins that fail for network reasons are saved on the device and
// synced later. Each check-in carries an idempotencyKey, so a replay never creates a duplicate.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

const API = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.apiBaseUrl) || 'http://localhost:8080';
const QUEUE_KEY = 'eldercare.offlineQueue';

let tokens = null;

async function login(username, password) {
  const res = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'password', username, password }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Login failed');
  tokens = { access: data.access_token, refresh: data.refresh_token };
  const claims = JSON.parse(globalThis.atob(data.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.role !== 'caregiver') throw new Error('This app is for caregivers');
  return { name: claims.name, patients: claims.patients || [] };
}

async function refreshTokens() {
  if (!tokens) return false;
  const res = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokens.refresh }) });
  if (!res.ok) return false;
  const data = await res.json();
  tokens = { access: data.access_token, refresh: data.refresh_token };
  return true;
}

/** Returns {ok, status, data}; throws only on network failure (=> queue offline). */
async function postCheckin(body, retried = false) {
  const res = await fetch(`${API}/api/checkins`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access}` }, body: JSON.stringify(body) });
  if (res.status === 401 && !retried && (await refreshTokens())) return postCheckin(body, true);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function readQueue() { try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]'); } catch { return []; } }
async function writeQueue(q) { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

const EMPTY = { systolic: '', diastolic: '', heartRate: '', temperatureC: '', spo2: '', notes: '' };

export default function App() {
  const [user, setUser] = useState(null);
  const [creds, setCreds] = useState({ username: '', password: '' });
  const [patientId, setPatientId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [medsTaken, setMedsTaken] = useState(true);
  const [fall, setFall] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const sync = useCallback(async () => {
    if (!tokens) return;
    const q = await readQueue();
    const left = [];
    for (const item of q) {
      try {
        const r = await postCheckin(item);
        if (!r.ok && r.status >= 500) left.push(item); // server issue - try later; 4xx = drop (invalid)
      } catch { left.push(item); }
    }
    await writeQueue(left);
    setPending(left.length);
    if (q.length && left.length < q.length) setMsg({ kind: 'ok', text: `Synced ${q.length - left.length} saved check-in(s).` });
  }, []);

  useEffect(() => {
    readQueue().then((q) => setPending(q.length));
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') sync(); });
    return () => sub.remove();
  }, [sync]);

  async function doLogin() {
    setBusy(true); setMsg(null);
    try {
      const u = await login(creds.username.trim(), creds.password);
      setUser(u); setPatientId(u.patients[0] || ''); sync();
    } catch (e) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }

  async function submit() {
    const n = (v) => (v === '' ? undefined : Number(v));
    const body = {
      patientId,
      idempotencyKey: `mob-${Crypto.randomUUID()}`,
      recordedAt: new Date().toISOString(),
      vitals: { systolic: n(form.systolic), diastolic: n(form.diastolic), heartRate: n(form.heartRate), temperatureC: n(form.temperatureC), spo2: n(form.spo2) },
      medication: { taken: medsTaken },
      mobilityStatus: fall ? 'fall_reported' : 'normal',
      notes: form.notes || undefined,
    };
    setBusy(true); setMsg(null);
    try {
      const r = await postCheckin(body);
      if (r.ok) {
        const c = r.data.checkin;
        setMsg({ kind: c.severity === 'none' ? 'ok' : 'warn', text: c.severity === 'none' ? 'Check-in saved. All readings normal.' : `Saved — ${c.severity.toUpperCase()}: ${c.anomalies.map((a) => a.message).join('; ')}. Family and health center notified.` });
        setForm(EMPTY); setMedsTaken(true); setFall(false);
      } else {
        setMsg({ kind: 'err', text: (r.data.details && r.data.details.join('\n')) || r.data.message || `Error ${r.status}` });
      }
    } catch {
      const q = await readQueue();
      q.push(body);
      await writeQueue(q);
      setPending(q.length);
      setMsg({ kind: 'warn', text: 'No connection. Check-in saved on this phone and will sync automatically.' });
      setForm(EMPTY);
    } finally { setBusy(false); }
  }

  const field = (key, label, kb = 'numeric') => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} keyboardType={kb} value={form[key]} onChangeText={(v) => setForm({ ...form, [key]: v })} />
    </View>
  );

  if (!user) {
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="auto" />
        <View style={s.card}>
          <Text style={s.title}>ElderCare Connect</Text>
          <Text style={s.muted}>Caregiver sign-in</Text>
          <TextInput style={s.input} placeholder="Username" autoCapitalize="none" value={creds.username} onChangeText={(v) => setCreds({ ...creds, username: v })} />
          <TextInput style={s.input} placeholder="Password" secureTextEntry value={creds.password} onChangeText={(v) => setCreds({ ...creds, password: v })} />
          {msg && <Text style={[s.msg, s[msg.kind]]}>{msg.text}</Text>}
          <Pressable style={s.button} onPress={doLogin} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Sign in</Text>}</Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.title}>Hi, {user.name.split(' ')[0]}</Text>
        {pending > 0 && <Pressable onPress={sync}><Text style={[s.msg, s.warn]}>{pending} check-in(s) waiting to sync — tap to retry</Text></Pressable>}
        <Text style={s.label}>Patient</Text>
        <View style={s.row}>
          {user.patients.map((p) => (
            <Pressable key={p} onPress={() => setPatientId(p)} style={[s.chip, patientId === p && s.chipOn]}><Text style={patientId === p ? s.chipTextOn : null}>{p}</Text></Pressable>
          ))}
        </View>
        <View style={s.row}>{field('systolic', 'Systolic')}{field('diastolic', 'Diastolic')}</View>
        <View style={s.row}>{field('heartRate', 'Heart rate')}{field('temperatureC', 'Temp °C', 'decimal-pad')}{field('spo2', 'SpO₂ %')}</View>
        <View style={s.row}>
          <Pressable onPress={() => setMedsTaken(!medsTaken)} style={[s.chip, !medsTaken && s.chipWarn]}><Text>{medsTaken ? 'Medication taken ✓' : 'Medication missed ✗'}</Text></Pressable>
          <Pressable onPress={() => setFall(!fall)} style={[s.chip, fall && s.chipWarn]}><Text>{fall ? 'Fall reported ⚠' : 'No falls'}</Text></Pressable>
        </View>
        <Text style={s.label}>Notes</Text>
        <TextInput style={[s.input, { height: 80 }]} multiline value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} />
        {msg && <Text style={[s.msg, s[msg.kind]]}>{msg.text}</Text>}
        <Pressable style={s.button} onPress={submit} disabled={busy || !patientId}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Submit check-in</Text>}</Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1', justifyContent: 'center' },
  card: { margin: 20, padding: 20, backgroundColor: '#fff', borderRadius: 12, gap: 10 },
  title: { fontSize: 22, fontWeight: '700', color: '#1f6f5c', marginBottom: 8 },
  muted: { color: '#6a716d' },
  label: { color: '#6a716d', fontSize: 13, marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e3e1da', borderRadius: 8, padding: 10, backgroundColor: '#fff', fontSize: 16 },
  field: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginVertical: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#e3e1da', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1f6f5c', borderColor: '#1f6f5c' },
  chipTextOn: { color: '#fff' },
  chipWarn: { backgroundColor: '#fde7d9', borderColor: '#d0661b' },
  button: { backgroundColor: '#1f6f5c', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  msg: { padding: 10, borderRadius: 8, marginVertical: 8 },
  ok: { backgroundColor: '#e3f2e8', color: '#2f7d4f' },
  warn: { backgroundColor: '#fdf1d8', color: '#8a6512' },
  err: { backgroundColor: '#fbe4e2', color: '#b3261e' },
});
