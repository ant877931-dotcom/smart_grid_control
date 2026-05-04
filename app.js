import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- GAUGE ---
const buildG = (id, title, max, color) => new RadialGauge({
    renderTo: id, width: 200, height: 200, title: title, minValue: 0, maxValue: max,
    colorPlate: "#0b1120", colorTitle: color, colorValueText: color, colorNumbers: "#cbd5e1",
    colorNeedle: color, borders: false, valueBox: true, animationDuration: 1000
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, '#38bdf8');
const gI = buildG('gauge-i', 'AMPERE', 20, '#34d399');
const gP = buildG('gauge-p', 'WATT', 2000, '#fbbf24');
const gS = buildG('gauge-s', 'VA', 2000, '#a78bfa');
const gPF = buildG('gauge-pf', 'COS φ', 1, '#0ea5e9');

// --- CHARTS (Satu per baris) ---
const createChart = (id, label, color, isDashed = false) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: [{ 
            label: label, data: [], borderColor: color, 
            borderDash: isDashed ? [5, 5] : [], 
            backgroundColor: color + '22', fill: true, tension: 0.3 
        }] 
    },
    options: { 
        responsive: true, maintainAspectRatio: false, 
        scales: { y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' } }, x: { ticks: { color: '#94a3b8' } } } 
    }
});

const chartV = createChart('chart-v', 'Voltage (V)', '#38bdf8');
const chartI = createChart('chart-i', 'Current (A)', '#34d399');
const chartPF = createChart('chart-pf', 'Faktor Daya', '#0ea5e9');

// Khusus Power (P vs S)
const chartPower = new Chart(document.getElementById('chart-power').getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: [
            { label: 'P (Watt)', data: [], borderColor: '#fbbf24', tension: 0.3 },
            { label: 'S (VA)', data: [], borderColor: '#a78bfa', borderDash: [5, 5], tension: 0.3 }
        ] 
    },
    options: { responsive: true, maintainAspectRatio: false }
});

// --- REALTIME & ANALISA ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        let p = d.power_nyata || 0; let s = d.power_semu || 0;
        gV.value = d.voltage; gI.value = d.current; gP.value = p; gS.value = s;

        let pf = s > 0 ? p / s : 0;
        gPF.value = parseFloat(pf.toFixed(2));

        // Update Analisa Pakar
        const listAnalisa = document.getElementById('analisa-list');
        const textRek = document.getElementById('rekomendasi-text');
        
        if (s > 0) {
            let analisaHtml = `<li>Daya Aktif: ${p}W | Daya Semu: ${s}VA</li>`;
            if (pf >= 0.85) {
                analisaHtml += `<li>Sistem Efisien (PF: ${pf.toFixed(2)})</li>`;
                textRek.innerText = "✅ Kondisi Ideal. Tidak perlu tindakan.";
                textRek.style.color = "#10b981";
            } else {
                analisaHtml += `<li>Rugi Daya Tinggi (PF: ${pf.toFixed(2)})</li>`;
                textRek.innerText = "🛑 Buruk. Disarankan pasang Kapasitor Bank.";
                textRek.style.color = "#ef4444";
            }
            listAnalisa.innerHTML = analisaHtml;
        }

        document.getElementById('alert-text').innerText = d.status;
        document.getElementById('fuzzy-score-text').innerText = `Skor AI: ${parseFloat(d.fuzzy_score).toFixed(1)}%`;
    }
});

// --- TOGGLE & SAVE CONFIG ---
const btnToggle = document.getElementById('btn-toggle-settings');
const panel = document.getElementById('settings-panel');

btnToggle.onclick = () => {
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        btnToggle.innerText = '✕ TUTUP'; // Gambar 3
        btnToggle.style.color = '#ef4444';
    } else {
        panel.classList.add('hidden');
        btnToggle.innerText = '⚙️ CONFIG FUZZY';
        btnToggle.style.color = '';
    }
};

document.getElementById('btn-save-settings').onclick = () => {
    const dataSet = {
        v_aman_min: parseFloat(document.getElementById('v-aman-min').value),
        v_aman_max: parseFloat(document.getElementById('v-aman-max').value),
        v_danger_l: parseFloat(document.getElementById('v-danger-l').value),
        v_danger_h: parseFloat(document.getElementById('v-danger-h').value)
    };
    update(ref(db, 'SmartGrid/Settings'), dataSet).then(() => alert("Parameter Disimpan!"));
};

// --- HISTORY ---
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const v=[], a=[], p=[], s=[], pf=[];
            for(let i=0; i<24; i++){
                const k = String(i).padStart(2,'0');
                v.push(h[k]?.v ?? null); a.push(h[k]?.a ?? null);
                p.push(h[k]?.p ?? null); s.push(h[k]?.s ?? null);
                pf.push((h[k]?.p && h[k]?.s) ? h[k].p / h[k].s : null);
            }
            chartV.data.datasets[0].data = v; chartV.update();
            chartI.data.datasets[0].data = a; chartI.update();
            chartPower.data.datasets[0].data = p; chartPower.data.datasets[1].data = s; chartPower.update();
            chartPF.data.datasets[0].data = pf; chartPF.update();
        }
    });
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
