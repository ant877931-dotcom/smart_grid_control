import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "smart-grid-monitor"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- BUILDER GAUGE ---
const buildG = (id, title, max, color) => new RadialGauge({
    renderTo: id, width: 220, height: 220, title: title, minValue: 0, maxValue: max,
    majorTicks: ["0",max/2,max], colorPlate: "#fff", colorNeedle: color, valueBox: true
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, '#2563eb');
const gI = buildG('gauge-i', 'AMP', 20, '#10b981');
const gP = buildG('gauge-p', 'WATT', 5000, '#f59e0b');
const gS = buildG('gauge-s', 'VA', 5000, '#8b5cf6');

// --- REAL-TIME LISTENER ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        gV.value = d.voltage;
        gI.value = d.current;
        gP.value = d.power_nyata;
        gS.value = d.power_semu;
        document.getElementById('alert-text').innerText = "KONDISI: " + d.status;
        document.querySelector('.status-box').style.borderLeftColor = 
            d.status === 'NORMAL' ? '#22c55e' : (d.status === 'WASPADA' ? '#f59e0b' : '#ef4444');
    }
});

// --- SETTINGS HANDLER ---
document.getElementById('btn-toggle-settings').onclick = () => document.getElementById('settings-panel').classList.toggle('hidden');
document.getElementById('btn-save-settings').onclick = () => {
    const s = {
        v_aman_min: parseFloat(document.getElementById('v-aman-min').value),
        v_aman_max: parseFloat(document.getElementById('v-aman-max').value),
        v_waspada_l: parseFloat(document.getElementById('v-waspada-l').value),
        v_waspada_h: parseFloat(document.getElementById('v-waspada-h').value)
    };
    update(ref(db, 'SmartGrid/Settings'), s).then(() => alert("Parameter Terkirim!"));
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
