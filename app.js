import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw",
    databaseURL: "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 1. GAUGE BUILDER (Hanya untuk Faktor Daya)
const gPF = new RadialGauge({
    renderTo: 'gauge-pf', width: 160, height: 160, units: "cos φ", minValue: 0, maxValue: 1,
    majorTicks: ["0","0.2","0.4","0.6","0.8","1.0"], minorTicks: 2,
    colorPlate: "#ffffff", colorTitle: "#06b6d4", colorValueText: "#06b6d4", 
    colorNeedle: "#06b6d4", borders: false, valueBox: true, animationRule: "linear"
}).draw();

// 2. CHART BUILDER
// Chart 1: Daya Nyata (Biru) vs Daya Semu (Merah)
const chartPower = new Chart(document.getElementById('chart-power').getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: [
            { label: 'Daya Nyata (W)', data: [], borderColor: '#3b82f6', backgroundColor: '#3b82f622', fill: true, tension: 0.3 },
            { label: 'Daya Semu (VA)', data: [], borderColor: '#ef4444', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.3 }
        ] 
    },
    options: { responsive: true, maintainAspectRatio: false }
});

// Chart 2: Tren Faktor Daya
const chartPF = new Chart(document.getElementById('chart-pf').getContext('2d'), {
    type: 'line',
    data: { 
        labels: Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`), 
        datasets: [{ label: 'Faktor Daya (cos φ)', data: [], borderColor: '#06b6d4', fill: true, backgroundColor: '#06b6d422', tension: 0.3 }] 
    },
    options: { responsive: true, maintainAspectRatio: false }
});

// 3. REALTIME LISTENER & EXPERT SYSTEM LOGIC
onValue(ref(db, 'SmartGrid/Realtime'), (snap) => {
    const d = snap.val();
    if(d) {
        let p = d.power_nyata || 0;
        let s = d.power_semu || 0;
        let fuzzyScore = d.fuzzy_score || 0;
        
        // Update Card 1 & 2
        document.getElementById('val-p').innerHTML = `${p} <span class="unit">Watt</span>`;
        document.getElementById('val-s').innerHTML = `${s} <span class="unit">VA</span>`;

        // Kalkulasi Card 3 (Faktor Daya)
        let pf = 0;
        if (s > 0) pf = p / s;
        gPF.value = parseFloat(pf.toFixed(2));

        // Update Card 4 (Status Fuzzy)
        const statusBox = document.getElementById('card-fuzzy');
        const statusText = document.getElementById('val-status');
        const scoreText = document.getElementById('val-score');
        
        let status = d.status || "UNKNOWN";
        statusText.innerText = status;
        scoreText.innerText = `Skor Fuzzy: ${parseFloat(fuzzyScore).toFixed(1)}%`;

        if(status === 'NORMAL') { statusBox.style.borderLeft = '6px solid #10b981'; statusText.style.color = '#10b981'; }
        else if(status === 'WASPADA') { statusBox.style.borderLeft = '6px solid #f59e0b'; statusText.style.color = '#f59e0b'; }
        else { statusBox.style.borderLeft = '6px solid #ef4444'; statusText.style.color = '#ef4444'; }

        // ==========================================
        // 🧠 LOGIKA ANALISA & REKOMENDASI OTOMATIS
        // ==========================================
        const listAnalisa = document.getElementById('analisa-list');
        const textRek = document.getElementById('rekomendasi-text');
        
        if (s === 0) {
            listAnalisa.innerHTML = "<li>Tidak mendeteksi adanya beban aktif.</li>";
            textRek.innerText = "Sistem dalam keadaan standby. Menunggu peralatan listrik dihidupkan.";
            textRek.style.color = "#64748b";
        } else {
            let analisaHtml = `<li>Daya dikonsumsi: ${p} W dari total ditarik ${s} VA.</li>`;
            let selisih = s - p;
            
            if (pf >= 0.90) {
                analisaHtml += `<li>Faktor daya luar biasa baik (${pf.toFixed(2)}).</li>`;
                analisaHtml += `<li>Rugi-rugi daya sangat kecil (${selisih.toFixed(1)} Var).</li>`;
                
                textRek.innerText = "✅ Sistem SANGAT EFISIEN. Beban resistif bekerja optimal. Pertahankan kondisi kelistrikan saat ini.";
                textRek.style.color = "#10b981"; // Hijau
            } 
            else if (pf >= 0.70 && pf < 0.90) {
                analisaHtml += `<li>Faktor daya menurun (${pf.toFixed(2)}).</li>`;
                analisaHtml += `<li>Beban induktif ringan mulai aktif membebani jaringan.</li>`;
                
                textRek.innerText = "⚠️ KESIMPULAN: Efisiensi cukup. REKOMENDASI: Lakukan monitoring berkala, hindari menyalakan motor listrik secara bersamaan.";
                textRek.style.color = "#f59e0b"; // Kuning
            } 
            else {
                analisaHtml += `<li>Selisih daya reaktif TERLALU BESAR (${selisih.toFixed(1)} Var).</li>`;
                analisaHtml += `<li>Faktor daya kritis (${pf.toFixed(2)}). Banyak arus terbuang sia-sia.</li>`;
                
                textRek.innerText = "🛑 BAHAYA: Sistem TIDAK EFISIEN dan memicu pemborosan. REKOMENDASI: Segera tambahkan Kapasitor Bank (Power Factor Correction) untuk meredam daya reaktif beban induktif!";
                textRek.style.color = "#ef4444"; // Merah
            }
            listAnalisa.innerHTML = analisaHtml;
        }
    }
});

// 4. LOAD HISTORY (Tarik Data Sesuai Format Baru)
document.getElementById('btn-load-hist').onclick = () => {
    const dateStr = document.getElementById('select-date').value;
    if(!dateStr) return alert("Pilih tanggal dahulu!");
    
    get(ref(db, `SmartGrid/History/Hourly/${dateStr}`)).then((snap) => {
        const h = snap.val();
        if(h) {
            const arrP=[], arrS=[], arrPF=[];
            for(let hr=0; hr<24; hr++){
                const k = String(hr).padStart(2, '0');
                let p = h[k]?.p ?? null;
                let s = h[k]?.s ?? null;
                
                arrP.push(p); arrS.push(s);
                
                // Hitung riwayat PF
                if(p !== null && s !== null && s > 0) {
                    arrPF.push(parseFloat((p/s).toFixed(2)));
                } else { arrPF.push(null); }
            }
            
            // Render Chart 1 (2 Garis)
            chartPower.data.datasets[0].data = arrP; 
            chartPower.data.datasets[1].data = arrS; 
            chartPower.update();
            
            // Render Chart 2 (PF)
            chartPF.data.datasets[0].data = arrPF; 
            chartPF.update();
            
            alert("Riwayat Analisa dimuat!");
        } else { alert("Data kosong untuk tanggal ini."); }
    });
};

setInterval(() => { document.getElementById('live-clock').innerText = new Date().toLocaleTimeString('id-ID'); }, 1000);
