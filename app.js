import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- 1. GAUGE INITIALIZATION ---
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

// --- 2. CHART INITIALIZATION (Baris per Baris) ---
const createChart = (id, datasets) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: datasets 
    },
    options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        scales: { 
            y: { grid: { color: '#1e293b' } },
            x: { grid: { color: '#1e293b' } }
        } 
    }
});

const chartV = createChart('chart-v', [{ label: 'Voltage', data: [], borderColor: '#38bdf8', tension: 0.3 }]);
const chartI = createChart('chart-i', [{ label: 'Current', data: [], borderColor: '#34d399', tension: 0.3 }]);
const chartPF = createChart('chart-pf', [{ label: 'PF', data: [], borderColor: '#0ea5e9', tension: 0.3 }]);
const chartPower = createChart('chart-power', [
    { label: 'P (Watt)', data: [], borderColor: '#fbbf24', tension: 0.3 },
    { label: 'S (VA)', data: [], borderColor: '#a78bfa', borderDash: [5,5], tension: 0.3 }
]);

// --- 3. REALTIME & ANALYSIS LOGIC ---
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        let p = d.power_nyata || 0; let s = d.power_semu || 0;
        gV.value = d.voltage; gI.value = d.current; gP.value = p; gS.value = s;

        // Analisa Faktor Daya (cos φ = P / S)
        let pf = s > 0 ? p / s : 0;
        gPF.value = parseFloat(pf.toFixed(2));

        // Update Analisa Pakar
        const listAnalisa = document.getElementById('analisa-list');
        const textRek = document.getElementById('rekomendasi-text');
        
        if (s > 0) {
            let analisaHtml = `<li>Selisih daya reaktif: ${(s-p).toFixed(1)} Var</li>`;
            if (pf >= 0.85) {
                analisaHtml += `<li>Efisiensi Tinggi (${pf.toFixed(2)})</li>`;
                textRek.innerText = "✅ Sistem SANGAT EFISIEN. Pertahankan kondisi ini.";
                textRek.style.color = "#10b981";
            } else {
                analisaHtml += `<li>Rugi Daya Besar (${pf.toFixed(2)})</li>`;
                textRek.innerText = "🛑 BURUK. Rekomendasi: Pasang Kapasitor Bank.";
                textRek.style.color = "#ef4444";
            }
            listAnalisa.innerHTML = analisaHtml;
        }

        // Status Fuzzy Sugeno
        document.getElementById('alert-text').innerText = d.status;
        document.getElementById('fuzzy-score-text').innerText = `Skor AI: ${parseFloat(d.fuzzy_score).toFixed(1)}%`;
    }
});

// --- 4. HISTORY RETRIEVAL ---
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const v=[], a=[], p=[], s=[], pf=[];
            for(let i=0; i<24; i++){
                const k = String(i).padStart(2,'0');
                let valP = h[k]?.p ?? null; let valS = h[k]?.s ?? null;
                v.push(h[k]?.v ?? null); a.push(h[k]?.a ?? null);
                p.push(valP); s.push(valS);
                pf.push((valP && valS) ? valP / valS : null);
            }
            chartV.data.datasets[0].data = v; chartV.update();
            chartI.data.datasets[0].data = a; chartI.update();
            chartPower.data.datasets[0].data = p; chartPower.data.datasets[1].data = s; chartPower.update();
            chartPF.data.datasets[0].data = pf; chartPF.update();
        }
    });
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
