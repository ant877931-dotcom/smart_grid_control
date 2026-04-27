#include <Arduino.h>
#include <PZEM004Tv30.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <time.h>

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// --- KREDENSIAL ---
#define WIFI_SSID "TECNO CAMON 40"
#define WIFI_PASSWORD "414c766532b1" 
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

PZEM004Tv30 pzem(Serial2, PIN_PZEM_RX, PIN_PZEM_TX);
LiquidCrystal_I2C lcd(0x27, 20, 4);
FirebaseData fbdo_stream, fbdo_upload; 
FirebaseAuth auth;
FirebaseConfig config;

float vAmanMin = 198.0, vAmanMax = 231.0;
float vWaspadaL = 188.0, vWaspadaH = 241.0;

enum SystemStatus { STATUS_NORMAL, STATUS_WASPADA, STATUS_BAHAYA, STATUS_OFF };
SystemStatus currentStatus = STATUS_NORMAL;
bool systemEnabled = true, lastSystemEnabled = true; 
unsigned long lastBtnPress = 0, lastFirebaseUpdate = 0;

// Variabel Auto-Reset & History
String lastSavedHour = "";
unsigned long currentRecoveryInterval = 5000;// Mulai dari 1 Menit
unsigned long recoveryTimer = 0;

// Flag Pemanasan Sensor (Smart Polling)
bool isWarmingUp = false;
unsigned long warmupStartTime = 0;

// --- PROTOTIPE FUNGSI ---
void handleButton();
void handleRulebase(float voltage);
void executeOutputs();
void handleBuzzer(); 
void updateLCD(float v, float i, float p, float va);
void uploadToFirebase(float v, float i, float p, float va);
void systemShutdown();
void systemPowerOnSequence();
String getTimeString();
String getDateString();
String getHourString();

void setup() {
    pinMode(PIN_RELAY_RED, OUTPUT); pinMode(PIN_RELAY_ORANGE, OUTPUT);
    pinMode(PIN_RELAY_GREEN, OUTPUT); pinMode(PIN_RELAY_LOAD, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT); pinMode(PIN_BUTTON, INPUT_PULLUP);
    
    digitalWrite(PIN_RELAY_RED, LOW); digitalWrite(PIN_RELAY_ORANGE, LOW);
    digitalWrite(PIN_RELAY_GREEN, LOW); digitalWrite(PIN_RELAY_LOAD, LOW);
    digitalWrite(PIN_BUZZER, LOW); 

    Serial.begin(115200);
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

    systemPowerOnSequence();
}

void loop() {
    handleButton();

    if (Firebase.ready() && fbdo_stream.streamAvailable()) {
        FirebaseJson &json = fbdo_stream.jsonObject();
        FirebaseJsonData res;
        if (json.get(res, "v_aman_min")) vAmanMin = res.floatValue;
        if (json.get(res, "v_aman_max")) vAmanMax = res.floatValue;
        if (json.get(res, "v_waspada_l")) vWaspadaL = res.floatValue;
        if (json.get(res, "v_waspada_h")) vWaspadaH = res.floatValue;
    }

    if (systemEnabled && !lastSystemEnabled) { systemPowerOnSequence(); lastSystemEnabled = true; }
    if (!systemEnabled) { if (lastSystemEnabled) { systemShutdown(); lastSystemEnabled = false; } return; }

    float v = pzem.voltage();
    float i = pzem.current();
    float p = pzem.power();

    if (isWarmingUp) {
        lcd.setCursor(0, 0); lcd.print("WARMUP SENSOR...    ");
        lcd.setCursor(0, 1);
        
        if (isnan(v) || v < 80.0) {
            lcd.print("V: WAIT...          ");
        } else {
            lcd.print("V: "); lcd.print(v, 1); lcd.print(" V          ");
        }

        if (!isnan(v) && v >= 80.0) {
            isWarmingUp = false; 
            lcd.clear();
        } 
        else if (millis() - warmupStartTime > 15000) {
            isWarmingUp = false; 
            lcd.clear();
        } 
        else {
            delay(1000); 
            return; 
        }
    }

    if (isnan(v) || v < 80.0) { v = 0.0; i = 0.0; p = 0.0; }
    float va = v * i;

    // --- LOGIKA AUTO RESET ---
    if (currentStatus == STATUS_BAHAYA && (millis() - recoveryTimer > currentRecoveryInterval)) {
        digitalWrite(PIN_BUZZER, LOW); 
        lcd.clear(); lcd.setCursor(0, 1); lcd.print("  AUTO RECOVERY...  ");
        
        systemPowerOnSequence(); 

        if (currentRecoveryInterval < 3600000) { 
            currentRecoveryInterval *= 2; 
        }
        recoveryTimer = millis(); 
        return; 
    }

    handleRulebase(v);
    executeOutputs();
    handleBuzzer(); 
    updateLCD(v, i, p, va);
    
    if (millis() - lastFirebaseUpdate > 3000) {
        uploadToFirebase(v, i, p, va);
        lastFirebaseUpdate = millis();
    }
    delay(50);
}

void handleRulebase(float v) {
    if (v < 80.0) {
        if (currentStatus != STATUS_BAHAYA) recoveryTimer = millis(); 
        currentStatus = STATUS_BAHAYA;
        return;
    }

    if (v >= vAmanMin && v <= vAmanMax) {
        currentStatus = STATUS_NORMAL;
        currentRecoveryInterval = 5000; 
    } 
    else if ((v >= vWaspadaL && v < vAmanMin) || (v > vAmanMax && v <= vWaspadaH)) {
        currentStatus = STATUS_WASPADA;
        currentRecoveryInterval = 5000; 
    } 
    else {
        if (currentStatus != STATUS_BAHAYA) recoveryTimer = millis(); 
        currentStatus = STATUS_BAHAYA;
    }
}

void executeOutputs() {
    if (currentStatus == STATUS_NORMAL) {
        digitalWrite(PIN_RELAY_LOAD, HIGH); digitalWrite(PIN_RELAY_GREEN, HIGH);
        digitalWrite(PIN_RELAY_ORANGE, LOW); digitalWrite(PIN_RELAY_RED, LOW);
    } else if (currentStatus == STATUS_WASPADA) {
        digitalWrite(PIN_RELAY_LOAD, HIGH); digitalWrite(PIN_RELAY_ORANGE, HIGH);
        digitalWrite(PIN_RELAY_GREEN, LOW); digitalWrite(PIN_RELAY_RED, LOW);
    } else {
        digitalWrite(PIN_RELAY_LOAD, LOW); digitalWrite(PIN_RELAY_RED, HIGH);
        digitalWrite(PIN_RELAY_GREEN, LOW); digitalWrite(PIN_RELAY_ORANGE, LOW);
    }
}

void systemPowerOnSequence() {
    // --- [INJEKSI IDE BRILIAN] FASE HARD RESET (POWER CYCLE) ---
    // Mematikan semua perangkat daya secara total layaknya menekan tombol off
    digitalWrite(PIN_RELAY_LOAD, LOW); 
    digitalWrite(PIN_RELAY_GREEN, LOW);
    digitalWrite(PIN_RELAY_ORANGE, LOW); 
    digitalWrite(PIN_RELAY_RED, LOW);
    
    // Memberikan jeda 1.5 detik agar listrik di dalam kapasitor perangkat benar-benar habis ("Cold Boot")
    delay(1500); 
    // -----------------------------------------------------------

    currentStatus = STATUS_NORMAL; 
    lcd.init(); lcd.clear();
    
    // Bunyi Beep Beep
    digitalWrite(PIN_BUZZER, HIGH); delay(150); digitalWrite(PIN_BUZZER, LOW); delay(100);  
    digitalWrite(PIN_BUZZER, HIGH); delay(150); digitalWrite(PIN_BUZZER, LOW);
    
    delay(500); 
    
    // Menyalakan ulang sistem (seperti menekan tombol on)
    digitalWrite(PIN_RELAY_LOAD, HIGH); 
    digitalWrite(PIN_RELAY_GREEN, HIGH);
    
    isWarmingUp = true; 
    warmupStartTime = millis();
}

void systemShutdown() {
    isWarmingUp = false; 
    digitalWrite(PIN_RELAY_LOAD, LOW); digitalWrite(PIN_RELAY_GREEN, LOW);
    digitalWrite(PIN_RELAY_ORANGE, LOW); digitalWrite(PIN_RELAY_RED, LOW);
    digitalWrite(PIN_BUZZER, LOW); 
    lcd.clear(); lcd.setCursor(0, 1); lcd.print("   SYSTEM STANDBY   ");
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
    else {
        digitalWrite(PIN_BUZZER, LOW);
    }
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
    lcd.setCursor(0,0); snprintf(buf, sizeof(buf), "V:%-5.1fV I:%-5.2fA ", v, i); lcd.print(buf);
    lcd.setCursor(0,1); snprintf(buf, sizeof(buf), "P.Nyata: %-6.0f W ", p); lcd.print(buf);
    lcd.setCursor(0,2); snprintf(buf, sizeof(buf), "P.Semu : %-6.0f VA", va); lcd.print(buf);
    lcd.setCursor(0,3); lcd.print("STATUS: ");
    if (currentStatus == STATUS_NORMAL) lcd.print("NORMAL ");
    else if (currentStatus == STATUS_WASPADA) lcd.print("WASPADA");
    else lcd.print("BAHAYA ");
    lcd.print("      ");
}

void handleButton() {
    if (digitalRead(PIN_BUTTON) == LOW && millis() - lastBtnPress > 800) {
        systemEnabled = !systemEnabled; lastBtnPress = millis();
    }
}

String getTimeString() { struct tm ti; getLocalTime(&ti); char b[10]; strftime(b, sizeof(b), "%H:%M:%S", &ti); return String(b); }
String getDateString() { struct tm ti; getLocalTime(&ti); char b[15]; strftime(b, sizeof(b), "%Y-%m-%d", &ti); return String(b); }
String getHourString() { struct tm ti; getLocalTime(&ti); char b[5]; strftime(b, sizeof(b), "%H", &ti); return String(b); }
