import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 1. GAUGE BUILDER (5 Instrumen)
const buildG = (id, title, max, ticks, color) => new RadialGauge({
    renderTo: id, width: 220, height: 220, title: title, minValue: 0, maxValue: max,
    majorTicks: ticks, minorTicks: 2, colorPlate: "#0b1120", colorTitle: color, colorValueText: color,
    colorNumbers: "#cbd5e1", colorNeedle: color, borders: true, valueBox: true, animationDuration: 1000, animationRule: "linear"
}).draw();

const gV = buildG('gauge-v', 'VOLT', 300, ["0","50","100","150","200","250","300"], '#38bdf8');
const gI = buildG('gauge-i', 'AMPERE', 20, ["0","4","8","12","16","20"], '#34d399');
const gP = buildG('gauge-p', 'WATT', 2000, ["0","400","800","1200","1600","2000"], '#fbbf24');
const gS = buildG('gauge-s', 'VA', 2000, ["0","400","800","1200","1600","2000"], '#a78bfa');
const gPF = buildG('gauge-pf', 'COS φ', 1, ["0","0.2","0.4","0.6","0.8","1.0"], '#0ea5e9');

// 2. CHART BUILDER (4 Grafik)
const createChart = (id, datasets) => new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), datasets: datasets },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } } }
});

const chartV = createChart('chart-v', [{ label: 'Voltage (V)', data: [], borderColor: '#38bdf8', fill: true, backgroundColor: '#38bdf822', tension: 0.3 }]);
const chartI = createChart('chart-i', [{ label: 'Current (A)', data: [], borderColor: '#34d399', fill: true, backgroundColor: '#34d39922', tension: 0.3 }]);
const chartPF = createChart('chart-pf', [{ label: 'Faktor Daya (cos φ)', data: [], borderColor: '#0ea5e9', fill: true, backgroundColor: '#0ea5e922', tension: 0.3 }]);

// Kombinasi P vs S dalam satu grafik
const chartPower = createChart('chart-power', [
    { label: 'Daya Nyata (W)', data: [], borderColor: '#fbbf24', backgroundColor: '#fbbf2422', fill: true, tension: 0.3 },
    { label: 'Daya Semu (VA)', data: [], borderColor: '#a78bfa', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.3 }
]);

// 3. PUSH CONFIGURATION LOGIC
const setPanel = document.getElementById('settings-panel');
const btnToggle = document.getElementById('btn-toggle-settings');
btnToggle.onclick = () => {
    if(setPanel.classList.contains('hidden')){
        setPanel.classList.remove('hidden'); btnToggle.innerHTML = '❌ TUTUP'; btnToggle.style.color = '#ef4444'; btnToggle.style.borderColor = '#ef4444';
    } else {
        setPanel.classList.add('hidden'); btnToggle.innerHTML = '⚙️ CONFIG FUZZY'; btnToggle.style.color = ''; btnToggle.style.borderColor = '';
    }
};

document.getElementById('btn-save-settings').onclick = () => {
    const dataSet = {
        v_aman_min: parseFloat(document.getElementById('v-aman-min').value), v_aman_max: parseFloat(document.getElementById('v-aman-max').value),
        v_waspada_l: parseFloat(document.getElementById('v-waspada-l').value), v_waspada_h: parseFloat(document.getElementById('v-waspada-h').value),
        v_danger_l: parseFloat(document.getElementById('v-danger-l').value), v_danger_h: parseFloat(document.getElementById('v-danger-h').value)
    };
    update(ref(db, 'SmartGrid/Settings'), dataSet).then(() => { alert("Parameter Disimpan!"); btnToggle.click(); }).catch(err => alert("Gagal: " + err));
};

// 4. REALTIME BINDING & EXPERT ANALYSIS
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        let v = d.voltage || 0; let i = d.current || 0;
        let p = d.power_nyata || 0; let s = d.power_semu || 0;
        let fuzzyScore = d.fuzzy_score || 0;
        
        gV.value = v; gI.value = i; gP.value = p; gS.value = s;

        // Kalkulasi PF
        let pf = 0; if (s > 0) pf = p / s;
        gPF.value = parseFloat(pf.toFixed(2));

        // Update Footer Status
        document.getElementById('alert-text').innerText = d.status || "UNKNOWN";
        document.getElementById('fuzzy-score-text').innerText = `Skor AI: ${parseFloat(fuzzyScore).toFixed(1)}%`;
        const alertBox = document.getElementById('alert-box');
        
        if(d.status === 'NORMAL') { alertBox.style.borderLeftColor = '#10b981'; document.getElementById('alert-text').style.color = '#10b981'; }
        else if(d.status === 'WASPADA') { alertBox.style.borderLeftColor = '#f59e0b'; document.getElementById('alert-text').style.color = '#f59e0b'; }
        else { alertBox.style.borderLeftColor = '#ef4444'; document.getElementById('alert-text').style.color = '#ef4444'; }

        // LOGIKA ANALISA & REKOMENDASI PAKAR
        const listAnalisa = document.getElementById('analisa-list');
        const textRek = document.getElementById('rekomendasi-text');
        
        if (s === 0) {
            listAnalisa.innerHTML = "<li>Tidak mendeteksi adanya beban kelistrikan aktif.</li>";
            textRek.innerText = "Sistem dalam keadaan siaga. Menunggu peralatan listrik dihidupkan.";
            textRek.style.color = "#cbd5e1";
        } else {
            let selisih = s - p;
            let analisaHtml = `<li>Daya dikonsumsi: ${p} W dari total ditarik ${s} VA.</li>`;
            
            if (pf >= 0.90) {
                analisaHtml += `<li>Faktor daya luar biasa baik (<span style="color:#34d399">${pf.toFixed(2)}</span>).</li>`;
                analisaHtml += `<li>Rugi daya (reaktif) sangat kecil: ${selisih.toFixed(1)} Var.</li>`;
                textRek.innerText = "✅ Sistem SANGAT EFISIEN. Beban resistif bekerja optimal. Pertahankan kondisi kelistrikan saat ini.";
                textRek.style.color = "#34d399"; 
            } 
            else if (pf >= 0.70 && pf < 0.90) {
                analisaHtml += `<li>Faktor daya menurun (<span style="color:#fbbf24">${pf.toFixed(2)}</span>).</li>`;
                analisaHtml += `<li>Terdapat daya terbuang: ${selisih.toFixed(1)} Var akibat beban induktif ringan.</li>`;
                textRek.innerText = "⚠️ KESIMPULAN: Efisiensi Cukup. REKOMENDASI: Lakukan monitoring berkala, hindari menyalakan motor listrik secara bersamaan.";
                textRek.style.color = "#fbbf24"; 
            } 
            else {
                analisaHtml += `<li>Faktor daya sangat buruk (<span style="color:#ef4444">${pf.toFixed(2)}</span>).</li>`;
                analisaHtml += `<li>Rugi daya reaktif TERLALU BESAR: ${selisih.toFixed(1)} Var.</li>`;
                textRek.innerText = "🛑 BAHAYA: Sistem TIDAK EFISIEN dan memicu pemborosan tagihan. REKOMENDASI: Segera tambahkan Kapasitor Bank (PFC) untuk meredam daya reaktif!";
                textRek.style.color = "#ef4444"; 
            }
            listAnalisa.innerHTML = analisaHtml;
        }
    }
});

// 5. EXTRACTOR LOGGER HISTORIS
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    if(!dateStr) return alert("Pilih tanggal dahulu!");
    
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const arrV=[], arrI=[], arrP=[], arrS=[], arrPF=[];
            for(let hr=0; hr<24; hr++){
                const k = String(hr).padStart(2, '0');
                let v = h[k]?.v ?? null; let i = h[k]?.a ?? null;
                let p = h[k]?.p ?? null; let s = h[k]?.s ?? null;
                
                arrV.push(v); arrI.push(i); arrP.push(p); arrS.push(s);
                
                if(p !== null && s !== null && s > 0) { arrPF.push(parseFloat((p/s).toFixed(2))); } 
                else { arrPF.push(null); }
            }
            
            chartV.data.datasets[0].data = arrV; chartV.update();
            chartI.data.datasets[0].data = arrI; chartI.update();
            chartPower.data.datasets[0].data = arrP; chartPower.data.datasets[1].data = arrS; chartPower.update();
            chartPF.data.datasets[0].data = arrPF; chartPF.update();
            
            alert("Riwayat 4 Instrumen dan Analisa dimuat!");
        } else { alert("Data kosong untuk tanggal ini."); }
    });
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
