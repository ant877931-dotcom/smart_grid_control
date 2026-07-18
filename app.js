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

// --- GAUGE BUILDER ---
const buildG = (id, title, max, ticks, color) => new RadialGauge({
    renderTo: id, width: 220, height: 220, title: title, minValue: 0, maxValue: max,
    majorTicks: ticks, minorTicks: 2, strokeTicks: true,
    colorPlate: "#ffffff", // Latar meteran menjadi putih
    colorTitle: color, colorValueText: color, 
    colorMajorTicks: color, colorMinorTicks: color, 
    colorNumbers: "#1e3a8a", // Angka skala menjadi biru tua agar terbaca
    colorNeedle: color, colorNeedleEnd: color, 
    colorValueBoxRect: "#eff6ff", // Kotak angka digital di bawah jarum
    borders: true, borderOuterWidth: 10, 
    colorBorderOuter: "#dbeafe", // Warna bingkai luar meteran
    needleType: "arrow", needleWidth: 4, valueBox: true,
    animationDuration: 1000, animationRule: "linear"
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, ["0","50","100","150","200","250","300"], '#38bdf8'); 
const gI = buildG('gauge-i', 'AMPERE', 20, ["0","4","8","12","16","20"], '#34d399'); 
const gP = buildG('gauge-p', 'WATT', 2000, ["0","400","800","1200","1600","2000"], '#fbbf24'); 
const gS = buildG('gauge-s', 'VA', 2000, ["0","400","800","1200","1600","2000"], '#a78bfa'); 

// --- CHART BUILDER ---
const createChart = (id, label, color) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: [{ label, data: [], borderColor: color, fill: true, backgroundColor: color + '22', tension: 0.3 }] 
    },
    options: { 
        responsive: true, maintainAspectRatio: false, color: '#1e3a8a',
        scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } }
    }
});

const chartV = createChart('chart-v', 'Voltage (V)', '#38bdf8');
const chartI = createChart('chart-i', 'Current (A)', '#34d399');
const chartP = createChart('chart-p', 'Real Power (W)', '#fbbf24');
const chartS = createChart('chart-s', 'Apparent Power (VA)', '#a78bfa');

// --- CONFIGURATION LOGIC ---
const setPanel = document.getElementById('settings-panel');
const btnToggle = document.getElementById('btn-toggle-settings');

const closeConfig = () => {
    setPanel.classList.add('hidden');
    btnToggle.innerHTML = '⚙️ CONFIG'; btnToggle.style.color = ''; btnToggle.style.borderColor = '';
};

const openConfig = () => {
    setPanel.classList.remove('hidden');
    btnToggle.innerHTML = '❌ TUTUP'; btnToggle.style.color = '#ef4444'; btnToggle.style.borderColor = '#ef4444';
};

btnToggle.onclick = () => setPanel.classList.contains('hidden') ? openConfig() : closeConfig();
window.addEventListener('load', () => closeConfig());

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
        alert("Konfigurasi Berhasil Disimpan & Sinkron ke ESP32!"); closeConfig();
    }).catch(err => alert("Gagal: " + err));
};

// =========================================================================
// TARIK DATA SETINGAN DARI FIREBASE AGAR TIDAK KEMBALI DEFAULT
// =========================================================================
onValue(ref(db, 'SmartGrid/Settings'), (snap) => {
    const s = snap.val();
    if(s) {
        document.getElementById('v-aman-min').value = s.v_aman_min ?? 198;
        document.getElementById('v-aman-max').value = s.v_aman_max ?? 231;
        document.getElementById('v-waspada-l').value = s.v_waspada_l ?? 188;
        document.getElementById('v-waspada-h').value = s.v_waspada_h ?? 241;
        document.getElementById('v-danger-l').value = s.v_danger_l ?? 170;
        document.getElementById('v-danger-h').value = s.v_danger_h ?? 250;
    }
});

// --- REAL-TIME MONITORING & EXPERT SYSTEM ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        let p = d.power_nyata || 0;
        let s = d.power_semu || 0;
        
        gV.value = d.voltage || 0; gI.value = d.current || 0; 
        gP.value = p; gS.value = s;

        // Kalkulasi PF hanya untuk teks analisa di bagian bawah
        let pf = 0; if (s > 0) pf = p / s;

        // Update Status Footer
        document.getElementById('alert-text').innerText = "SISTEM " + (d.status || "UNKNOWN");
        document.querySelector('.status-box').style.borderLeftColor = 
            d.status === 'NORMAL' ? '#22c55e' : (d.status === 'WASPADA' ? '#fbbf24' : '#ef4444');

        // --- RINCIAN ANALISA ---
        const listAnalisa = document.getElementById('analisa-list');
        
        if (s === 0) {
            listAnalisa.innerHTML = "<li>Tidak mendeteksi adanya beban aktif. Sistem dalam keadaan siaga.</li>";
        } else {
            let selisih = s - p;
            let analisaHtml = `<li>Daya ditarik (Semu): <strong>${s} VA</strong>, Daya digunakan (Aktif): <strong>${p} W</strong>.</li>`;
            
            if (pf >= 0.90) {
                analisaHtml += `<li>Faktor daya: <span style="color:#34d399; font-weight:bold;">${pf.toFixed(2)}</span> (Sangat Ideal).</li>`;
                analisaHtml += `<li>Rugi daya reaktif: <strong>${selisih.toFixed(1)} Var</strong> (Efisiensi Tinggi).</li>`;
            } else if (pf >= 0.70) {
                analisaHtml += `<li>Faktor daya: <span style="color:#fbbf24; font-weight:bold;">${pf.toFixed(2)}</span> (Menurun).</li>`;
                analisaHtml += `<li>Terdapat daya terbuang sebesar: <strong>${selisih.toFixed(1)} Var</strong>.</li>`;
            } else {
                analisaHtml += `<li>Faktor daya: <span style="color:#ef4444; font-weight:bold;">${pf.toFixed(2)}</span> (Kritis/Buruk).</li>`;
                analisaHtml += `<li>Rugi daya reaktif: <strong>${selisih.toFixed(1)} Var</strong> (Indikasi pemborosan tinggi).</li>`;
            }
            listAnalisa.innerHTML = analisaHtml;
        }
    }
});

// --- LOAD HISTORY DATA ---
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    if(!dateStr) return alert("Pilih tanggal terlebih dahulu!");
    
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const arrV=[], arrI=[], arrP=[], arrS=[];
            for(let hr=0; hr<24; hr++){
                const k = String(hr).padStart(2, '0');
                let valP = h[k]?.p ?? null; let valS = h[k]?.s ?? null;
                arrV.push(h[k]?.v ?? null); arrI.push(h[k]?.a ?? null);
                arrP.push(valP); arrS.push(valS);
            }
            chartV.data.datasets[0].data = arrV; chartV.update();
            chartI.data.datasets[0].data = arrI; chartI.update();
            chartP.data.datasets[0].data = arrP; chartP.update();
            chartS.data.datasets[0].data = arrS; chartS.update();
            
            alert("Riwayat berhasil dimuat!");
        } else {
            alert("Tidak ada data riwayat untuk tanggal tersebut.");
        }
    }).catch(err => alert("Gagal memuat data: " + err));
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
