import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw",
    authDomain: "smart-grid-monitor.firebaseapp.com",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "smart-grid-monitor"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- GAUGE BUILDER (Ukuran Diperbesar ke 240px) ---
const buildG = (id, title, max, ticks, color) => new RadialGauge({
    renderTo: id, width: 240, height: 240, title: title, minValue: 0, maxValue: max,
    majorTicks: ticks, minorTicks: 2, strokeTicks: true,
    colorPlate: "#fff", colorMajorTicks: "#444", colorMinorTicks: "#666",
    colorTitle: color, colorNumbers: "#444", colorNeedle: color, colorNeedleEnd: color,
    borders: true, borderOuterWidth: 10, colorBorderOuter: "#f8fafc",
    needleType: "arrow", needleWidth: 3, valueBox: true,
    colorValueText: "#fff", colorValueBoxRect: "#888",
    animationDuration: 1000, animationRule: "linear"
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, ["0","50","100","150","200","250","300"], '#2563eb');
const gI = buildG('gauge-i', 'AMPERE', 20, ["0","4","8","12","16","20"], '#10b981');
const gP = buildG('gauge-p', 'WATT', 5000, ["0","1k","2k","3k","4k","5k"], '#f59e0b');
const gS = buildG('gauge-s', 'VA', 5000, ["0","1k","2k","3k","4k","5k"], '#8b5cf6');

// --- CHART BUILDER ---
const createChart = (id, label, color) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), datasets: [{ label, data: [], borderColor: color, fill: true, backgroundColor: color + '1A', tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false }
});

const chartV = createChart('chart-v', 'Voltage (V)', '#2563eb');
const chartI = createChart('chart-i', 'Current (A)', '#10b981');
const chartP = createChart('chart-p', 'Real Power (W)', '#f59e0b');
const chartS = createChart('chart-s', 'Apparent Power (VA)', '#8b5cf6');

// --- CONFIGURATION LOGIC ---
const setPanel = document.getElementById('settings-panel');
document.getElementById('btn-toggle-settings').onclick = () => setPanel.classList.toggle('hidden');

onValue(ref(db, 'SmartGrid/Settings'), (snap) => {
    const s = snap.val();
    if(s) {
        document.getElementById('v-aman-min').value = s.v_aman_min || 198;
        document.getElementById('v-aman-max').value = s.v_aman_max || 231;
        document.getElementById('v-waspada-l').value = s.v_waspada_l || 188;
        document.getElementById('v-waspada-h').value = s.v_waspada_h || 241;
        document.getElementById('v-danger-l').value = s.v_danger_l || 170;
        document.getElementById('v-danger-h').value = s.v_danger_h || 250;
    }
});

document.getElementById('btn-save-settings').onclick = () => {
    const dataSet = {
        v_aman_min: parseFloat(document.getElementById('v-aman-min').value),
        v_aman_max: parseFloat(document.getElementById('v-aman-max').value),
        v_waspada_l: parseFloat(document.getElementById('v-waspada-l').value),
        v_waspada_h: parseFloat(document.getElementById('v-waspada-h').value),
        v_danger_l: parseFloat(document.getElementById('v-danger-l').value),
        v_danger_h: parseFloat(document.getElementById('v-danger-h').value)
    };
    update(ref(db, 'SmartGrid/Settings'), dataSet).then(() => alert("Konfigurasi Berhasil Disimpan!"));
};

// --- REAL-TIME MONITORING (Murni Sinkron dengan Database) ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        // Mengambil key yang sudah sama persis dengan yang dikirim ESP32
        gV.value = d.voltage || 0; 
        gI.value = d.current || 0; 
        gP.value = d.power_nyata || 0; 
        gS.value = d.power_semu || 0;
        
        document.getElementById('alert-text').innerText = "SISTEM " + (d.status || "UNKNOWN");
        document.querySelector('.status-box').style.borderLeftColor = 
            d.status === 'NORMAL' ? '#22c55e' : (d.status === 'WASPADA' ? '#f59e0b' : '#ef4444');
    }
});

// --- LOAD HISTORY DATA (Murni Sinkron dengan Database) ---
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    if(!dateStr) return alert("Pilih tanggal terlebih dahulu!");
    
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const v=[], a=[], p=[], s=[];
            for(let hr=0; hr<24; hr++){
                const k = String(hr).padStart(2, '0');
                // Menarik data histori sesuai struktur v, a, p, s dari ESP32
                v.push(h[k]?.v ?? null); 
                a.push(h[k]?.a ?? null); 
                p.push(h[k]?.p ?? null); 
                s.push(h[k]?.s ?? null);
            }
            chartV.data.datasets[0].data = v; chartV.update();
            chartI.data.datasets[0].data = a; chartI.update();
            chartP.data.datasets[0].data = p; chartP.update();
            chartS.data.datasets[0].data = s; chartS.update();
            alert("Riwayat berhasil dimuat!");
        } else {
            alert("Tidak ada data riwayat untuk tanggal tersebut.");
        }
    }).catch(err => alert("Gagal memuat data: " + err));
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
