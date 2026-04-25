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

// --- KONFIGURASI PIN (FIX MAPPING TERBARU) ---
#define PIN_PZEM_RX     16
#define PIN_PZEM_TX     17
#define PIN_BUTTON      32
#define PIN_BUZZER      33
#define PIN_RELAY_LOAD  14 // IN4 (Beban Utama)

// SWAP: Berdasarkan laporan user bahwa 27 dan 25 terbalik
#define PIN_RELAY_RED    25 // IN1 (Bahaya) - Sekarang di Pin 25
#define PIN_RELAY_ORANGE 26 // IN2 (Waspada)
#define PIN_RELAY_GREEN  27 // IN3 (Normal) - Sekarang di Pin 27

// --- OBJEK & GLOBAL ---
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
unsigned long lastBtnPress = 0, lastFirebaseUpdate = 0, recoveryTimer = 0;

// --- PROTOTIPE FUNGSI (PENTING: Menghilangkan error "not declared in scope") ---
void handleButton();
void handleRulebase(float voltage);
void executeOutputs();
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
    
    // Safety awal
    digitalWrite(PIN_RELAY_RED, LOW); digitalWrite(PIN_RELAY_ORANGE, LOW);
    digitalWrite(PIN_RELAY_GREEN, LOW); digitalWrite(PIN_RELAY_LOAD, LOW);

    Serial.begin(115200);
    lcd.init(); lcd.backlight(); lcd.clear();

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    configTime(25200, 0, "pool.ntp.org"); 

    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    Firebase.RTDB.beginStream(&fbdo_stream, "/SmartGrid/Settings"); 

    systemPowerOnSequence();
}

void loop() {
    handleButton();

    // Sinkronisasi Parameter dari Web secara Real-time
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
    float va = isnan(v) || isnan(i) ? 0 : v * i;

    // GUARD: Jika sensor error saat startup
    if (isnan(v) || (v < 10.0 && currentStatus != STATUS_BAHAYA)) { 
        lcd.setCursor(0, 0); lcd.print("READING PZEM...     "); 
        return; 
    }

    // LOGIKA RECOVERY: Cek tegangan PLN tiap 10 detik jika sedang Bahaya/Mati
    if (currentStatus == STATUS_BAHAYA && (v < 10.0 || isnan(v))) {
        if (millis() - recoveryTimer > 10000) {
            lcd.setCursor(0, 3); lcd.print("CHECKING RECOVERY...");
            digitalWrite(PIN_RELAY_LOAD, HIGH); 
            delay(800); 
            v = pzem.voltage();
            digitalWrite(PIN_RELAY_LOAD, LOW);
            recoveryTimer = millis();
        }
    }

    handleRulebase(v);
    executeOutputs();
    updateLCD(v, i, p, va);
    
    if (millis() - lastFirebaseUpdate > 1000) {
        uploadToFirebase(v, i, p, va);
        lastFirebaseUpdate = millis();
    }
    delay(50);
}

void uploadToFirebase(float v, float i, float p, float va) {
    if (!Firebase.ready()) return;
    String dStr = getDateString(); String tStr = getTimeString(); String hStr = getHourString();
    
    FirebaseJson json;
    String fullTime = dStr; fullTime.concat(" "); fullTime.concat(tStr);

    json.set(String("Realtime/voltage"), v); 
    json.set(String("Realtime/current"), i);
    json.set(String("Realtime/power_nyata"), p); 
    json.set(String("Realtime/power_semu"), va); 
    json.set(String("Realtime/last_update"), fullTime);
    json.set(String("Realtime/status"), (currentStatus == STATUS_NORMAL) ? "NORMAL" : "PROTEKSI");

    String bPath = "History/Hourly/"; bPath.concat(dStr); bPath.concat("/"); bPath.concat(hStr);
    String pV = bPath; pV.concat("/v");
    String pA = bPath; pA.concat("/a");
    String pP = bPath; pP.concat("/p");
    String pS = bPath; pS.concat("/s");

    json.set(pV, v); json.set(pA, i); json.set(pP, p); json.set(pS, va);
    Firebase.RTDB.updateNode(&fbdo_upload, "/SmartGrid", &json);
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

void handleRulebase(float v) {
    if (v >= vAmanMin && v <= vAmanMax) currentStatus = STATUS_NORMAL;
    else if ((v >= vWaspadaL && v < vAmanMin) || (v > vAmanMax && v <= vWaspadaH)) currentStatus = STATUS_WASPADA;
    else currentStatus = STATUS_BAHAYA;
}

void executeOutputs() {
    if (currentStatus == STATUS_NORMAL) {
        digitalWrite(PIN_RELAY_LOAD, HIGH); digitalWrite(PIN_RELAY_GREEN, HIGH);
        digitalWrite(PIN_RELAY_ORANGE, LOW); digitalWrite(PIN_RELAY_RED, LOW);
    } else if (currentStatus == STATUS_WASPADA) {
        digitalWrite(PIN_RELAY_ORANGE, HIGH); digitalWrite(PIN_RELAY_GREEN, LOW);
    } else {
        digitalWrite(PIN_RELAY_LOAD, LOW); digitalWrite(PIN_RELAY_RED, HIGH);
        digitalWrite(PIN_RELAY_GREEN, LOW); digitalWrite(PIN_RELAY_ORANGE, LOW);
    }
}

void systemPowerOnSequence() {
    currentStatus = STATUS_NORMAL; lcd.init(); lcd.clear();
    digitalWrite(PIN_RELAY_LOAD, HIGH); digitalWrite(PIN_RELAY_GREEN, HIGH);
    delay(4000); lcd.clear(); 
}

void systemShutdown() {
    digitalWrite(PIN_RELAY_LOAD, LOW); digitalWrite(PIN_RELAY_GREEN, LOW);
    digitalWrite(PIN_RELAY_ORANGE, LOW); digitalWrite(PIN_RELAY_RED, LOW);
    lcd.clear(); lcd.setCursor(0, 1); lcd.print("   SYSTEM STANDBY   ");
}

void handleButton() {
    if (digitalRead(PIN_BUTTON) == LOW && millis() - lastBtnPress > 800) {
        systemEnabled = !systemEnabled; lastBtnPress = millis();
    }
}

String getTimeString() { struct tm ti; getLocalTime(&ti); char b[10]; strftime(b, sizeof(b), "%H:%M:%S", &ti); return String(b); }
String getDateString() { struct tm ti; getLocalTime(&ti); char b[15]; strftime(b, sizeof(b), "%Y-%m-%d", &ti); return String(b); }
String getHourString() { struct tm ti; getLocalTime(&ti); char b[5]; strftime(b, sizeof(b), "%H", &ti); return String(b); }
