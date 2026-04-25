import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpj-vsHlCXVw",
    authDomain: "smart-grid-monitor.firebaseapp.com",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "smart-grid-monitor",
    storageBucket: "smart-grid-monitor.firebasestorage.app",
    messagingSenderId: "47111062559",
    appId: "1:47111062559:web:8eb78537d603afd5bf412a"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- GAUGE BUILDER ---
const buildG = (id, title, max, ticks, color) => new RadialGauge({
    renderTo: id, width: 220, height: 220, title: title, minValue: 0, maxValue: max,
    majorTicks: ticks, minorTicks: 2, strokeTicks: true,
    colorPlate: "#fff", colorTitle: color, colorNeedle: color,
    animationDuration: 1500, valueBox: true
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, ["0","100","200","300"], '#2563eb');
const gI = buildG('gauge-i', 'AMPERE', 20, ["0","10","20"], '#10b981');
const gP = buildG('gauge-p', 'WATT', 5000, ["0","2k","5k"], '#f59e0b');
const gS = buildG('gauge-s', 'VA', 5000, ["0","2k","5k"], '#8b5cf6');

// --- REAL-TIME MONITORING (Sesuai Path ESP32) ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        gV.value = d.voltage;
        gI.value = d.current;
        gP.value = d.power;
        gS.value = (d.voltage * d.current).toFixed(1);
        
        document.getElementById('alert-text').innerText = "SISTEM " + d.status;
        const statusBox = document.querySelector('.status-box');
        statusBox.style.borderLeftColor = d.status === 'NORMAL' ? '#22c55e' : (d.status === 'WASPADA' ? '#f59e0b' : '#ef4444');
    }
});

// --- SETTINGS LOGIC (Kirim ke ESP32) ---
document.getElementById('btn-toggle-settings').onclick = () => document.getElementById('settings-panel').classList.toggle('hidden');

document.getElementById('btn-save-settings').onclick = () => {
    const settings = {
        v_aman_min: parseFloat(document.getElementById('v-aman-min').value),
        v_aman_max: parseFloat(document.getElementById('v-aman-max').value),
        v_waspada_l: parseFloat(document.getElementById('v-waspada-l').value),
        v_waspada_h: parseFloat(document.getElementById('v-waspada-h').value),
        v_danger_l: parseFloat(document.getElementById('v-danger-l').value),
        v_danger_h: parseFloat(document.getElementById('v-danger-h').value)
    };
    update(ref(db, 'SmartGrid/Settings'), settings).then(() => alert("Parameter Berhasil Dikirim ke ESP32!"));
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
