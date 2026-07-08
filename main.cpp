#include <Arduino.h>
#include <PZEM004Tv30.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <time.h>

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// --- KREDENSIAL ---
#define WIFI_SSID "bernadya"
#define WIFI_PASSWORD "mura0808" 
#define API_KEY "AIzaSyAr_jda1kVfNTSRo62th2kMpJ-vsHlCXVw" 
#define DATABASE_URL "https://smart-grid-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/"

// --- KONFIGURASI PIN ---
#define PIN_PZEM_RX     16
#define PIN_PZEM_TX     17
#define PIN_BUTTON      32
#define PIN_BUZZER      33
#define PIN_RELAY_LOAD  14 // IN4 (Beban Utama)
#define PIN_RELAY_RED   25 // IN1 (Bahaya)
#define PIN_RELAY_ORANGE 26 // IN2 (Waspada)
#define PIN_RELAY_GREEN  27 // IN3 (Normal)

// --- KUNCI LOGIKA RELAY (ACTIVE HIGH) ---
#define RELAY_ON  HIGH
#define RELAY_OFF LOW

PZEM004Tv30 pzem(Serial2, PIN_PZEM_RX, PIN_PZEM_TX);
LiquidCrystal_I2C lcd(0x27, 20, 4);
FirebaseData fbdo_stream, fbdo_upload; 
FirebaseAuth auth;
FirebaseConfig config;

// --- PARAMETER PROTEKSI ---
float vAmanMin = 198.0, vAmanMax = 231.0;
float vWaspadaL = 188.0, vWaspadaH = 241.0;
float vDangerL = 170.0, vDangerH = 250.0; 

enum SystemStatus { STATUS_NORMAL, STATUS_WASPADA, STATUS_BAHAYA, STATUS_OFF };
SystemStatus currentStatus = STATUS_OFF;
SystemStatus lastLcdStatus = STATUS_OFF; 

bool systemEnabled = true, lastSystemEnabled = true; 
unsigned long lastBtnPress = 0, lastFirebaseUpdate = 0;
unsigned long lastLcdUpdate = 0; 

String lastSavedHour = "";
unsigned long currentRecoveryInterval = 5000; 
unsigned long recoveryTimer = 0;

bool isWarmingUp = false;
unsigned long warmupStartTime = 0;
float lastFuzzyScore = 100.0; 

// --- PROTOTIPE FUNGSI ---
void handleButton();
void handleRulebase(float voltage);
void executeOutputs();
void handleBuzzer(); 
void updateLCD(float v, float i, float p, float va);
void uploadToFirebase(float v, float i, float p, float va);
void systemShutdown();
void systemBootSequence(); 
void loadFuzzySettings();
String getTimeString();
String getDateString();
String getHourString();

void setup() {
    Serial.begin(115200);

    pinMode(PIN_RELAY_RED, OUTPUT); 
    pinMode(PIN_RELAY_ORANGE, OUTPUT);
    pinMode(PIN_RELAY_GREEN, OUTPUT); 
    pinMode(PIN_RELAY_LOAD, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT); 
    pinMode(PIN_BUTTON, INPUT_PULLUP);

    digitalWrite(PIN_RELAY_RED, RELAY_OFF); 
    digitalWrite(PIN_RELAY_ORANGE, RELAY_OFF);
    digitalWrite(PIN_RELAY_GREEN, RELAY_OFF); 
    digitalWrite(PIN_RELAY_LOAD, RELAY_OFF);
    digitalWrite(PIN_BUZZER, LOW); 

    lcd.init(); lcd.backlight(); lcd.clear();

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    
    configTime(25200, 0, "pool.ntp.org"); 

    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;
    config.timeout.socketConnection = 10 * 1000; 
    fbdo_upload.setBSSLBufferSize(2048, 1024);   
    fbdo_upload.setResponseSize(1024);

    if (Firebase.signUp(&config, &auth, "", "")) {
        Serial.println("Firebase OK");
    }

    config.token_status_callback = tokenStatusCallback; 
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    Firebase.RTDB.beginStream(&fbdo_stream, "/SmartGrid/Settings"); 

    loadFuzzySettings();
    systemBootSequence();
}

void loop() {
    handleButton();

    if (Firebase.ready() && fbdo_stream.streamAvailable()) {
        loadFuzzySettings(); 
        Serial.println("Parameter Diperbarui dari Web!");
    }

    if (systemEnabled && !lastSystemEnabled) { systemBootSequence(); lastSystemEnabled = true; }
    if (!systemEnabled) { if (lastSystemEnabled) { systemShutdown(); lastSystemEnabled = false; } return; }

    float v = pzem.voltage();
    float i = pzem.current();
    float p = pzem.power();

    if (isWarmingUp) {
        digitalWrite(PIN_RELAY_LOAD, RELAY_OFF); 
        digitalWrite(PIN_RELAY_GREEN, RELAY_OFF);
        digitalWrite(PIN_RELAY_ORANGE, RELAY_OFF);
        digitalWrite(PIN_RELAY_RED, RELAY_ON); 

        if (millis() - lastLcdUpdate > 500) {
            lcd.setCursor(0, 0); lcd.print("WARMUP SENSOR...    ");
            lcd.setCursor(0, 1);
            if (isnan(v) || v < 80.0) {
                lcd.print("V: WAIT...          ");
            } else {
                lcd.print("V: "); lcd.print(v, 1); lcd.print(" V          ");
            }
            lastLcdUpdate = millis();
        }

        if (!isnan(v) && v >= 80.0) {
            isWarmingUp = false; lcd.clear();
        } else if (millis() - warmupStartTime > 15000) {
            isWarmingUp = false; lcd.clear();
        } else {
            return; 
        }
    }

    if (isnan(v) || v < 80.0) { v = 0.0; i = 0.0; p = 0.0; }
    float va = v * i;

    handleRulebase(v);
    executeOutputs();
    handleBuzzer(); 
    
    // ANTI GLITCH & BLANK LCD EFFECT
    if (currentStatus != lastLcdStatus) {
        delay(50); 
        lcd.init();      
        lcd.backlight(); 
        lastLcdStatus = currentStatus;
    }

    // ANTI FLICKER LCD REFRESH 500MS
    if (millis() - lastLcdUpdate > 500) {
        updateLCD(v, i, p, va);
        lastLcdUpdate = millis();
    }
    
    if (millis() - lastFirebaseUpdate > 3000) {
        uploadToFirebase(v, i, p, va);
        lastFirebaseUpdate = millis();
    }
    delay(50);
}

void loadFuzzySettings() {
    if (Firebase.ready()) {
        if (Firebase.RTDB.getFloat(&fbdo_upload, "/SmartGrid/Settings/v_aman_min")) vAmanMin = fbdo_upload.floatData();
        if (Firebase.RTDB.getFloat(&fbdo_upload, "/SmartGrid/Settings/v_aman_max")) vAmanMax = fbdo_upload.floatData();
        if (Firebase.RTDB.getFloat(&fbdo_upload, "/SmartGrid/Settings/v_waspada_l")) vWaspadaL = fbdo_upload.floatData();
        if (Firebase.RTDB.getFloat(&fbdo_upload, "/SmartGrid/Settings/v_waspada_h")) vWaspadaH = fbdo_upload.floatData();
        if (Firebase.RTDB.getFloat(&fbdo_upload, "/SmartGrid/Settings/v_danger_l")) vDangerL = fbdo_upload.floatData();
        if (Firebase.RTDB.getFloat(&fbdo_upload, "/SmartGrid/Settings/v_danger_h")) vDangerH = fbdo_upload.floatData();
        
        // Proteksi bentrokan matematika nilai bertumpuk
        if (vWaspadaL <= vDangerL) vWaspadaL = vDangerL + 1.0;
        if (vAmanMin <= vWaspadaL) vAmanMin = vWaspadaL + 1.0;
        if (vAmanMax < vAmanMin) vAmanMax = vAmanMin + 1.0;
        if (vWaspadaH <= vAmanMax) vWaspadaH = vAmanMax + 1.0;
        if (vDangerH <= vWaspadaH) vDangerH = vWaspadaH + 1.0;
    }
}

void handleRulebase(float v) {
    // --- 1. KALKULASI SKOR FUZZY (UNTUK GRAFIK & PERSENTASE) ---
    if (v < 80.0) {
        lastFuzzyScore = 0.0;
    } else {
        float uNormal = 0.0, uWaspada = 0.0, uBahaya = 0.0;

        if (v >= vAmanMin && v <= vAmanMax) uNormal = 1.0;
        else if (v > vWaspadaL && v < vAmanMin) uNormal = (v - vWaspadaL) / (vAmanMin - vWaspadaL);
        else if (v > vAmanMax && v < vWaspadaH) uNormal = (vWaspadaH - v) / (vWaspadaH - vAmanMax);

        if (v > vDangerL && v <= vWaspadaL) uWaspada = (v - vDangerL) / (vWaspadaL - vDangerL);
        else if (v > vWaspadaL && v < vAmanMin) uWaspada = (vAmanMin - v) / (vAmanMin - vWaspadaL);
        else if (v > vAmanMax && v <= vWaspadaH) uWaspada = (v - vAmanMax) / (vWaspadaH - vAmanMax);
        else if (v > vWaspadaH && v < vDangerH) uWaspada = (vDangerH - v) / (vDangerH - vWaspadaH);

        if (v <= vDangerL || v >= vDangerH) uBahaya = 1.0;
        else if (v > vDangerL && v <= vWaspadaL) uBahaya = (vWaspadaL - v) / (vWaspadaL - vDangerL);
        else if (v > vWaspadaH && v < vDangerH) uBahaya = (v - vWaspadaH) / (vDangerH - vWaspadaH);

        float zNormal = 100.0, zWaspada = 50.0, zBahaya = 0.0;   
        float totalU = uNormal + uWaspada + uBahaya;
        if (totalU > 0.0) {
            lastFuzzyScore = ((uNormal * zNormal) + (uWaspada * zWaspada) + (uBahaya * zBahaya)) / totalU;
        }
    }

    // --- 2. PENENTUAN STATUS (CRISP STATE MAPPING - AKURASI 100% SESUAI WEB) ---
    SystemStatus targetStatus;
    
    if (v < 80.0 || v <= vDangerL || v > vWaspadaH) {
        // Kondisi Bahaya Bawah (<=199V) ATAU Bahaya Atas (>240V / Mulai 241V ke atas)
        targetStatus = STATUS_BAHAYA;
    } 
    else if ((v > vDangerL && v < vAmanMin) || (v > vAmanMax && v <= vWaspadaH)) {
        // Kondisi Waspada Bawah (200V-209V) ATAU Waspada Atas (231V-240V)
        targetStatus = STATUS_WASPADA;
    } 
    else {
        // Rentang Aman murni (210V - 230V)
        targetStatus = STATUS_NORMAL;
    }

    // --- 3. MANAJEMEN RECOVERY TIMER GUARD ---
    if (targetStatus == STATUS_BAHAYA) {
        if (currentStatus != STATUS_BAHAYA) {
            recoveryTimer = millis(); 
            if (currentRecoveryInterval < 3600000) currentRecoveryInterval *= 2; 
        }
        currentStatus = STATUS_BAHAYA;
    } else {
        if (currentStatus == STATUS_BAHAYA) {
            if (millis() - recoveryTimer > currentRecoveryInterval) {
                currentStatus = targetStatus;
                currentRecoveryInterval = 5000; 
            } 
        } else {
            currentStatus = targetStatus;
        }
    }
}

void executeOutputs() {
    if (currentStatus == STATUS_NORMAL) {
        digitalWrite(PIN_RELAY_LOAD, RELAY_ON);   
        digitalWrite(PIN_RELAY_GREEN, RELAY_ON);  
        digitalWrite(PIN_RELAY_ORANGE, RELAY_OFF);
        digitalWrite(PIN_RELAY_RED, RELAY_OFF);     
    } 
    else if (currentStatus == STATUS_WASPADA) {
        digitalWrite(PIN_RELAY_LOAD, RELAY_ON);   
        digitalWrite(PIN_RELAY_GREEN, RELAY_OFF);   
        digitalWrite(PIN_RELAY_ORANGE, RELAY_ON); 
        digitalWrite(PIN_RELAY_RED, RELAY_OFF);     
    } 
    else if (currentStatus == STATUS_BAHAYA) { 
        digitalWrite(PIN_RELAY_LOAD, RELAY_OFF);  
        digitalWrite(PIN_RELAY_GREEN, RELAY_ON); 
        digitalWrite(PIN_RELAY_ORANGE, RELAY_ON);
        digitalWrite(PIN_RELAY_RED, RELAY_ON);    
    } 
    else {
        digitalWrite(PIN_RELAY_LOAD, RELAY_OFF);
        digitalWrite(PIN_RELAY_GREEN, RELAY_OFF); 
        digitalWrite(PIN_RELAY_ORANGE, RELAY_OFF); 
        digitalWrite(PIN_RELAY_RED, RELAY_OFF);
    }
}

void systemBootSequence() {
    digitalWrite(PIN_RELAY_LOAD, LOW); 
    digitalWrite(PIN_RELAY_GREEN, LOW);
    digitalWrite(PIN_RELAY_ORANGE, LOW); 
    digitalWrite(PIN_RELAY_RED, LOW);
    
    delay(1500); 

    currentStatus = STATUS_NORMAL; 
    lcd.init(); lcd.clear();
    
    digitalWrite(PIN_BUZZER, HIGH); delay(150); digitalWrite(PIN_BUZZER, LOW); delay(100);  
    digitalWrite(PIN_BUZZER, HIGH); delay(150); digitalWrite(PIN_BUZZER, LOW);
    
    delay(500); 
    
    digitalWrite(PIN_RELAY_LOAD, HIGH); 
    digitalWrite(PIN_RELAY_GREEN, HIGH);
    
    isWarmingUp = true; 
    warmupStartTime = millis();
}

void systemShutdown() {
    isWarmingUp = false; 
    digitalWrite(PIN_RELAY_LOAD, LOW); digitalWrite(PIN_RELAY_GREEN, LOW);
    digitalWrite(PIN_RELAY_ORANGE, LOW); digitalWrite(PIN_RELAY_RED, HIGH);
    digitalWrite(PIN_BUZZER, LOW); 
    lcd.clear(); 
    lcd.setCursor(0, 0); lcd.print("   STANDBY MODE    ");
    lcd.setCursor(0, 1); lcd.print("     LOAD OFF      ");
    lcd.setCursor(0, 2); lcd.print("   INDICATOR ON   ");
    lcd.setCursor(0, 3); lcd.print("  PRESS TO START   ");
}

void handleBuzzer() {
    unsigned long currentMillis = millis();
    if (currentStatus == STATUS_WASPADA) {
        if (currentMillis % 1000 < 200) digitalWrite(PIN_BUZZER, HIGH);
        else digitalWrite(PIN_BUZZER, LOW);
    } 
    else if (currentStatus == STATUS_BAHAYA) {
        if (currentMillis % 1000 < 800) digitalWrite(PIN_BUZZER, HIGH);
        else digitalWrite(PIN_BUZZER, LOW);
    } 
    else { digitalWrite(PIN_BUZZER, LOW); }
}

void uploadToFirebase(float v, float i, float p, float va) {
    if (!Firebase.ready()) return;
    String dStr = getDateString(); String tStr = getTimeString(); String hStr = getHourString();
    FirebaseJson rtJson;
    String fullTime = dStr; fullTime.concat(" "); fullTime.concat(tStr);

    rtJson.set("voltage", v); rtJson.set("current", i);
    rtJson.set("power_nyata", p); rtJson.set("power_semu", va); 
    rtJson.set("last_update", fullTime);
    rtJson.set("status", (currentStatus == STATUS_NORMAL) ? "NORMAL" : (currentStatus == STATUS_WASPADA ? "WASPADA" : "PROTEKSI"));
    rtJson.set("fuzzy_score", lastFuzzyScore);

    Firebase.RTDB.updateNodeAsync(&fbdo_upload, "/SmartGrid/Realtime", &rtJson);

    if (hStr != lastSavedHour) {
        FirebaseJson histJson;
        histJson.set("v", v); histJson.set("a", i); histJson.set("p", p); histJson.set("s", va);
        String histPath = "/SmartGrid/History/Hourly/"; 
        histPath.concat(dStr); histPath.concat("/"); histPath.concat(hStr);
        if (Firebase.RTDB.updateNodeAsync(&fbdo_upload, histPath, &histJson)) {
            lastSavedHour = hStr; 
        }
    }
}

void updateLCD(float v, float i, float p, float va) {
    char buf[21];
    
    snprintf(buf, sizeof(buf), "V:%-5.1fV I:%-5.2fA  ", v, i);
    lcd.setCursor(0,0); lcd.print(buf);
    
    snprintf(buf, sizeof(buf), "P:%-5.0fW Fz:%-3.0f%% ", p, lastFuzzyScore);
    lcd.setCursor(0,1); lcd.print(buf);
    
    snprintf(buf, sizeof(buf), "S:%-5.0fVA          ", va);
    lcd.setCursor(0,2); lcd.print(buf);
    
    lcd.setCursor(0,3); 
    if (currentStatus == STATUS_NORMAL) lcd.print("STATUS: NORMAL      ");
    else if (currentStatus == STATUS_WASPADA) lcd.print("STATUS: WASPADA     ");
    else if (currentStatus == STATUS_BAHAYA) {
        lcd.print("STATUS: BAHAYA      ");
    }
    else lcd.print("STATUS: MATI        ");
}

void handleButton() {
    if (digitalRead(PIN_BUTTON) == LOW && millis() - lastBtnPress > 800) {
        systemEnabled = !systemEnabled; lastBtnPress = millis();
    }
}

String getTimeString() { struct tm ti; getLocalTime(&ti); char b[10]; strftime(b, sizeof(b), "%H:%M:%S", &ti); return String(b); }
String getDateString() { struct tm ti; getLocalTime(&ti); char b[15]; strftime(b, sizeof(b), "%Y-%m-%d", &ti); return String(b); }
String getHourString() { struct tm ti; getLocalTime(&ti); char b[5]; strftime(b, sizeof(b), "%H", &ti); return String(b); }
