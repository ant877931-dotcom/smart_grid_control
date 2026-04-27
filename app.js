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

// --- GAUGE BUILDER (TEMA GELAP LED) ---
const buildG = (id, title, max, ticks, color) => new RadialGauge({
    renderTo: id, width: 240, height: 240, title: title, minValue: 0, maxValue: max,
    majorTicks: ticks, minorTicks: 2, strokeTicks: true,
    
    // Latar Piringan Hitam Pekat agar nyaman di mata
    colorPlate: "#0b1120", 
    
    // Warna Teks, Nilai, dan Batas mengikuti Karakter
    colorTitle: color, 
    colorValueText: color, 
    colorMajorTicks: color, colorMinorTicks: color,
    
    // Angka penunjuk abu-abu gelap
    colorNumbers: "#cbd5e1", 
    
    // Jarum warna karakter
    colorNeedle: color, colorNeedleEnd: color,
    colorValueBoxRect: "#1e293b",
    
    borders: true, borderOuterWidth: 10, colorBorderOuter: "#1e293b",
    needleType: "arrow", needleWidth: 4, valueBox: true,
    animationDuration: 1000, animationRule: "linear"
}).draw();

// Inisialisasi dengan warna Karakter yang Nyaman di Mata Gelap
const gV = buildG('gauge-v', 'VOLT', 300, ["0","50","100","150","200","250","300"], '#38bdf8'); // Biru Muda
const gI = buildG('gauge-i', 'AMPERE', 20, ["0","4","8","12","16","20"], '#34d399'); // Hijau Terang
const gP = buildG('gauge-p', 'WATT', 5000, ["0","1k","2k","3k","4k","5k"], '#fbbf24'); // Kuning Emas
const gS = buildG('gauge-s', 'VA', 5000, ["0","1k","2k","3k","4k","5k"], '#a78bfa'); // Ungu Terang

// --- CHART BUILDER ---
const createChart = (id, label, color) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: [{ 
            label, data: [], borderColor: color, fill: true, backgroundColor: color + '22', tension: 0.3 
        }] 
    },
    options: { 
        responsive: true, maintainAspectRatio: false,
        color: '#f8fafc', // Teks legenda putih
        scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, 
            y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
        }
    }
});

const chartV = createChart('chart-v', 'Voltage (V)', '#38bdf8');
const chartI = createChart('chart-i', 'Current (A)', '#34d399');
const chartP = createChart('chart-p', 'Real Power (W)', '#fbbf24');
const chartS = createChart('chart-s', 'Apparent Power (VA)', '#a78bfa');

// --- SMART CONFIGURATION LOGIC ---
const setPanel = document.getElementById('settings-panel');
const btnToggle = document.getElementById('btn-toggle-settings');

btnToggle.onclick = () => {
    if (setPanel.classList.contains('hidden')) {
        setPanel.classList.remove('hidden');
        btnToggle.innerHTML = '❌ TUTUP';
        btnToggle.style.borderColor = '#ef4444'; 
        btnToggle.style.color = '#ef4444';       
    } else {
        setPanel.classList.add('hidden');
        btnToggle.innerHTML = '⚙️ CONFIG';
        btnToggle.style.borderColor = ''; 
        btnToggle.style.color = '';       
    }
};

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
    
    update(ref(db, 'SmartGrid/Settings'), dataSet).then(() => {
        alert("Konfigurasi Berhasil Disimpan!");
        // Auto-close setelah save
        setPanel.classList.add('hidden');
        btnToggle.innerHTML = '⚙️ CONFIG';
        btnToggle.style.borderColor = '';
        btnToggle.style.color = '';
    }).catch(err => alert("Gagal menyimpan konfigurasi: " + err));
};

// --- REAL-TIME MONITORING ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        gV.value = d.voltage || 0; 
        gI.value = d.current || 0; 
        gP.value = d.power_nyata || 0; 
        gS.value = d.power_semu || 0;
        
        document.getElementById('alert-text').innerText = "SISTEM " + (d.status || "UNKNOWN");
        document.querySelector('.status-box').style.borderLeftColor = 
            d.status === 'NORMAL' ? '#22c55e' : (d.status === 'WASPADA' ? '#fbbf24' : '#ef4444');
    }
});

// --- LOAD HISTORY DATA ---
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    if(!dateStr) return alert("Pilih tanggal terlebih dahulu!");
    
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const v=[], a=[], p=[], s=[];
            for(let hr=0; hr<24; hr++){
                const k = String(hr).padStart(2, '0');
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
