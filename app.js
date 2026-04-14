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

const buildG = (id, title, max, ticks, color) => new RadialGauge({
    renderTo: id, width: 220, height: 220, title: title, minValue: 0, maxValue: max,
    majorTicks: ticks, minorTicks: 2, strokeTicks: true,
    colorPlate: "#fff", colorMajorTicks: "#444", colorMinorTicks: "#666",
    colorTitle: color, colorNumbers: "#444", colorNeedle: color, colorNeedleEnd: color,
    borders: true, borderOuterWidth: 10, colorBorderOuter: "#ccc",
    needleType: "arrow", needleWidth: 3, valueBox: true,
    colorValueText: "#fff", colorValueBoxRect: "#888",
    animationDuration: 1500, animationRule: "linear"
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, ["0","50","100","150","200","250","300"], '#2563eb');
const gI = buildG('gauge-i', 'AMPERE', 20, ["0","4","8","12","16","20"], '#10b981');
const gP = buildG('gauge-p', 'WATT', 5000, ["0","1k","2k","3k","4k","5k"], '#f59e0b');
const gS = buildG('gauge-s', 'VA', 5000, ["0","1k","2k","3k","4k","5k"], '#8b5cf6');

const createChart = (id, label, color) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), datasets: [{ label, data: [], borderColor: color, fill: true, backgroundColor: color + '1A', tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false }
});

const chartV = createChart('chart-v', 'Voltage', '#2563eb');
const chartI = createChart('chart-i', 'Current', '#10b981');
const chartP = createChart('chart-p', 'Real Power', '#f59e0b');
const chartS = createChart('chart-s', 'Apparent', '#8b5cf6');

const setPanel = document.getElementById('settings-panel');
document.getElementById('btn-toggle-settings').onclick = () => setPanel.classList.toggle('hidden');

onValue(ref(db, 'Monitoring/settings'), (snap) => {
    const s = snap.val();
    if(s) {
        document.getElementById('v-aman-min').value = s.v_aman_min;
        document.getElementById('v-aman-max').value = s.v_aman_max;
        document.getElementById('v-waspada-l-min').value = s.v_waspada_l_min;
        document.getElementById('v-waspada-l-max').value = s.v_waspada_l_max;
        document.getElementById('v-waspada-h-min').value = s.v_waspada_h_min;
        document.getElementById('v-waspada-h-max').value = s.v_waspada_h_max;
        document.getElementById('v-danger-l').value = s.v_danger_l;
        document.getElementById('v-danger-h').value = s.v_danger_h;
        document.getElementById('durasi-th').value = s.durasi_threshold;
    }
});

document.getElementById('btn-save-settings').onclick = () => {
    const dataSet = {
        v_aman_min: parseInt(document.getElementById('v-aman-min').value),
        v_aman_max: parseInt(document.getElementById('v-aman-max').value),
        v_waspada_l_min: parseInt(document.getElementById('v-waspada-l-min').value),
        v_waspada_l_max: parseInt(document.getElementById('v-waspada-l-max').value),
        v_waspada_h_min: parseInt(document.getElementById('v-waspada-h-min').value),
        v_waspada_h_max: parseInt(document.getElementById('v-waspada-h-max').value),
        v_danger_l: parseInt(document.getElementById('v-danger-l').value),
        v_danger_h: parseInt(document.getElementById('v-danger-h').value),
        durasi_threshold: parseInt(document.getElementById('durasi-th').value)
    };
    update(ref(db, 'Monitoring/settings'), dataSet).then(() => alert("Konfigurasi Berhasil Disimpan!"));
};

onValue(ref(db, 'Monitoring/monitoring'), (snap) => {
    const d = snap.val();
    if(d) {
        gV.value = d.voltage; gI.value = d.current; gP.value = d.real_power; gS.value = d.apparent_power;
        document.getElementById('alert-text').innerText = "SISTEM " + d.status;
        document.querySelector('.status-box').style.borderLeftColor = d.status === 'AMAN' ? '#22c55e' : (d.status === 'WASPADA' ? '#f59e0b' : '#ef4444');
    }
});

document.getElementById('btn-load-hist').onclick = () => {
    const d = document.getElementById('select-date').value.split('-');
    if(d.length < 3) return alert("Pilih tanggal!");
    get(ref(db, `Monitoring/history/${d[0]}/${d[1]}/${d[2]}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const v=[], i=[], p=[], s=[];
            for(let hr=0; hr<24; hr++){
                const k = String(hr).padStart(2, '0');
                v.push(h[k]?.v || null); i.push(h[k]?.i || null); p.push(h[k]?.p || null); s.push(h[k]?.s || null);
            }
            chartV.data.datasets[0].data = v; chartV.update();
            chartI.data.datasets[0].data = i; chartI.update();
            chartP.data.datasets[0].data = p; chartP.update();
            chartS.data.datasets[0].data = s; chartS.update();
        }
    });
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
