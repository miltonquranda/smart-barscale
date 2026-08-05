#include <Arduino.h>
#include <math.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "HX711.h"
#include <ArduinoJson.h>
#define FORCE_TEMPLATED_NOPS
#include "ESP32-USB-Soft-Host.h"

// ─── Pin assignments ───
const int LOADCELL_DOUT_PIN = 4;
const int LOADCELL_SCK_PIN  = 13;
const int USB_DP_PIN        = 16;
const int USB_DM_PIN        = 17;
const int BUZZER_PIN        = 25;

// ─── Scale config ───
const float REFERENCE_WEIGHT    = 500.0;
const float WEIGHT_ON_THRESHOLD = 10.0;
const float WEIGHT_OFF_THRESHOLD= 20.0;
const float MAX_WEIGHT          = 5000.0;

// ─── Buzzer PWM ───
const int BUZZER_CHANNEL = 0;
const int BUZZER_FREQ    = 2000;
const int BUZZER_RES     = 8;

// Demo hardware identity. The build environments in platformio.ini select
// the default serial for each physical demo unit. The BLE device-id
// characteristic can still override this value and persists it in NVS.
#ifndef SMARTBAR_DEFAULT_DEVICE_ID
#define SMARTBAR_DEFAULT_DEVICE_ID "SB_B017B2215788"
#endif
#ifndef SMARTBAR_DEFAULT_SERVER_URL
#define SMARTBAR_DEFAULT_SERVER_URL "https://smartbarscale.com"
#endif
const char* DEFAULT_DEMO_DEVICE_ID = SMARTBAR_DEFAULT_DEVICE_ID;
const char* DEFAULT_SERVER_URL = SMARTBAR_DEFAULT_SERVER_URL;

// ─── Objects ───
HX711 scale;
Preferences prefs;

// ─── Stored config ───
String wifiSSID;
String wifiPass;
String serverURL;
String deviceID;
String authToken;
float  calibration_factor = 427.5;

// ─── State ───
enum DeviceState { STATE_WAIT_BARCODE, STATE_WAIT_WEIGHT, STATE_PROCESSING };
volatile DeviceState deviceState = STATE_WAIT_BARCODE;

volatile bool barcodeReady = false;
char barcodeBuffer[256];
volatile uint8_t barcodeLen = 0;
volatile unsigned long lastBarcodeByteMs = 0;
char lastBarcode[256] = "";
float lastWeight = 0.0;
String lastStatus = "idle";
String lastError  = "";

bool wifiConnected = false;
bool usbHostStarted = false;
volatile bool usbTimerPaused = false;
volatile bool wifiScanRequested = false;
String wifiScanResults[64];
String wifiScanPayload;
uint8_t wifiScanResultCount = 0;
int wifiScanReadIndex = -1;
unsigned long wifiLastAttempt = 0;
const unsigned long WIFI_RETRY_MS = 10000;

// Power management
bool hx711_awake = true;
unsigned long lastActivityTime = 0;
const unsigned long SLEEP_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

// ─── BLE UUIDs ───
#define SERVICE_CONFIG_UUID   "b4e3a900-5a2b-4f1c-9d7a-000000000001"
#define CHAR_WIFI_SSID_UUID   "b4e3a901-5a2b-4f1c-9d7a-000000000001"
#define CHAR_WIFI_PASS_UUID   "b4e3a902-5a2b-4f1c-9d7a-000000000001"
#define CHAR_SERVER_URL_UUID  "b4e3a903-5a2b-4f1c-9d7a-000000000001"
#define CHAR_DEVICE_ID_UUID   "b4e3a904-5a2b-4f1c-9d7a-000000000001"
#define CHAR_AUTH_TOKEN_UUID  "b4e3a905-5a2b-4f1c-9d7a-000000000001"
#define CHAR_WIFI_STATUS_UUID "b4e3a906-5a2b-4f1c-9d7a-000000000001"
#define CHAR_WIFI_SCAN_UUID   "b4e3a907-5a2b-4f1c-9d7a-000000000001"

#define SERVICE_SCALE_UUID    "b4e3a900-5a2b-4f1c-9d7a-000000000002"
#define CHAR_WEIGHT_UUID      "b4e3a901-5a2b-4f1c-9d7a-000000000002"
#define CHAR_BARCODE_UUID     "b4e3a902-5a2b-4f1c-9d7a-000000000002"
#define CHAR_STATUS_UUID      "b4e3a903-5a2b-4f1c-9d7a-000000000002"
#define CHAR_COMMAND_UUID     "b4e3a904-5a2b-4f1c-9d7a-000000000002"

NimBLECharacteristic* charWifiStatus = nullptr;
NimBLECharacteristic* charWifiScan   = nullptr;
NimBLECharacteristic* charDeviceID   = nullptr;
NimBLECharacteristic* charWeight     = nullptr;
NimBLECharacteristic* charBarcode    = nullptr;
NimBLECharacteristic* charStatus     = nullptr;

// ─── HID keycode to ASCII ───
static const char HID_KEY_MAP[] = {
  0,0,0,0,                          // 0x00-0x03
  'a','b','c','d','e','f','g','h',   // 0x04-0x0B
  'i','j','k','l','m','n','o','p',   // 0x0C-0x13
  'q','r','s','t','u','v','w','x',   // 0x14-0x1B
  'y','z',                           // 0x1C-0x1D
  '1','2','3','4','5','6','7','8','9','0', // 0x1E-0x27
};

static const char HID_KEY_MAP_SHIFT[] = {
  0,0,0,0,
  'A','B','C','D','E','F','G','H',
  'I','J','K','L','M','N','O','P',
  'Q','R','S','T','U','V','W','X',
  'Y','Z',
  '!','@','#','$','%','^','&','*','(',')',
};

static const char HID_SYMBOL_MAP[] = {
  // 0x28-0x38
  '\n',  // Enter
  0x1B,  // Escape
  '\b',  // Backspace
  '\t',  // Tab
  ' ',   // Space
  '-',   // 0x2D
  '=',   // 0x2E
  '[',   // 0x2F
  ']',   // 0x30
  '\\',  // 0x31
  '#',   // 0x32
  ';',   // 0x33
  '\'',  // 0x34
  '`',   // 0x35
  ',',   // 0x36
  '.',   // 0x37
  '/',   // 0x38
};

char hidToAscii(uint8_t key, uint8_t modifier) {
  bool shift = (modifier & 0x22) != 0;
  if (key >= 0x04 && key <= 0x27) {
    return shift ? HID_KEY_MAP_SHIFT[key] : HID_KEY_MAP[key];
  }
  if (key >= 0x28 && key <= 0x38) {
    return HID_SYMBOL_MAP[key - 0x28];
  }
  return 0;
}

// ─── Buzzer (8 ohm Speaker) ───
// Use a very low duty cycle to prevent drawing too much current from the ESP32 GPIO pin 
// and to control the volume on an 8-ohm speaker.
const int SPEAKER_VOLUME = 80; // Duty cycle out of 255 (for 8-bit resolution)

void beepShort(int count = 1) {
  for (int i = 0; i < count; i++) {
    if (i > 0) delay(80);
    ledcWrite(BUZZER_CHANNEL, SPEAKER_VOLUME);
    delay(80);
    ledcWrite(BUZZER_CHANNEL, 0);
  }
}

void beepLong() {
  ledcWrite(BUZZER_CHANNEL, SPEAKER_VOLUME);
  delay(400);
  ledcWrite(BUZZER_CHANNEL, 0);
}

void beepBarcode() { beepShort(2); }
void beepWeighDone() { beepLong(); }
void beepError() { beepShort(3); }

// ─── USB Host callback ───
static uint8_t lastKeys[6] = {0};

void onUSBData(uint8_t usbNum, uint8_t byte_depth, uint8_t* data, uint8_t data_len) {
  if (data_len < 8) return;

  // Check if all keys are released (data[2] through data[7] are 0)
  bool allReleased = true;
  for (int i = 2; i < 8; i++) {
    if (data[i] != 0) {
      allReleased = false;
      break;
    }
  }

  // If all keys are released, clear lastKeys and return
  if (allReleased) {
    memset(lastKeys, 0, 6);
    return;
  }

  // Only accept barcode scans when we are actually waiting for a barcode
  if (deviceState != STATE_WAIT_BARCODE) {
    // Still update lastKeys so we don't get stuck keys when we return to waiting
    memcpy(lastKeys, &data[2], 6);
    return;
  }
  
  if (barcodeReady) return;

  if (barcodeLen > 0 && millis() - lastBarcodeByteMs > 1200) {
    barcodeLen = 0;
    memset(barcodeBuffer, 0, sizeof(barcodeBuffer));
    memset(lastKeys, 0, sizeof(lastKeys));
    Serial.println("USB barcode buffer reset after timeout");
  }

  for (int i = 2; i < 8; i++) {
    uint8_t key = data[i];
    if (key == 0) continue;

    bool wasPressed = false;
    for (int j = 0; j < 6; j++) {
      if (lastKeys[j] == key) { wasPressed = true; break; }
    }
    if (wasPressed) continue;

    if (key == 0x28 || key == 0x58) {
      if (barcodeLen > 0) {
        barcodeBuffer[barcodeLen] = '\0';
        barcodeReady = true;
      }
      // Do NOT clear lastKeys here, otherwise held/replayed Enter keys will trigger infinite loops!
      break; 
    }
    
    char c = hidToAscii(key, data[0]);
    if (c) {
      if (barcodeLen < sizeof(barcodeBuffer) - 1) {
        barcodeBuffer[barcodeLen++] = c;
        lastBarcodeByteMs = millis();
      }
    }
  }
  memcpy(lastKeys, &data[2], 6);
}

void onUSBDetect(uint8_t usbNum, void* dev) {
  Serial.printf("USB device connected on port %d\n", usbNum);
}

void onUSBDisconnect(uint8_t usbNum) {
  Serial.printf("USB device disconnected from port %d\n", usbNum);
}

// ─── NVS storage ───
void saveConfig();

void loadConfig() {
  prefs.begin("config", true);
  wifiSSID  = prefs.getString("wifi_ssid", "");
  wifiPass  = prefs.getString("wifi_pass", "");
  serverURL = prefs.getString("server_url", "");
  deviceID  = prefs.getString("device_id", "");
  authToken = prefs.getString("auth_token", "");
  calibration_factor = prefs.getFloat("cal_factor", 427.5);
  prefs.end();

  wifiSSID.trim();
  wifiPass.trim();
  serverURL.trim();
  deviceID.trim();
  for (int i = wifiSSID.length() - 1; i >= 0; i--) {
    if (wifiSSID.charAt(i) < 32 || wifiSSID.charAt(i) > 126) wifiSSID.remove(i, 1);
  }

  // Recover from malformed values left by older BLE clients. Never attempt
  // device authentication with an invalid serial or server URL.
  if (!deviceID.startsWith("SB_") || deviceID.length() < 8) {
    deviceID = DEFAULT_DEMO_DEVICE_ID;
    authToken = "";
    saveConfig();
    Serial.printf("Invalid device ID recovered; using %s\n", deviceID.c_str());
  }
  if (!serverURL.startsWith("http://") && !serverURL.startsWith("https://")) {
    serverURL = DEFAULT_SERVER_URL;
    authToken = "";
    saveConfig();
    Serial.printf("Invalid server URL recovered; using %s\n", serverURL.c_str());
  }

  // Use the assigned demo identity on a fresh device. The second demo unit
  // can be changed over BLE without changing the firmware binary.
  if (deviceID.isEmpty()) {
    deviceID = DEFAULT_DEMO_DEVICE_ID;
    saveConfig();
    Serial.printf("Default Demo Device ID: %s\n", deviceID.c_str());
  }

  // Default server URL if not configured
  if (serverURL.isEmpty()) {
    serverURL = DEFAULT_SERVER_URL;
    saveConfig();
    Serial.println("Default server URL set.");
  }
}

void pauseUSBTimer() {
  if (usbHostStarted && !usbTimerPaused) {
    USH.TimerPause();
    usbTimerPaused = true;
  }
}

void resumeUSBTimer() {
  if (usbHostStarted && usbTimerPaused) {
    USH.TimerResume();
    usbTimerPaused = false;
  }
}

void saveConfig() {
  bool localPause = usbHostStarted && !usbTimerPaused;
  if (localPause) pauseUSBTimer();
  prefs.begin("config", false);
  prefs.putString("wifi_ssid", wifiSSID);
  prefs.putString("wifi_pass", wifiPass);
  prefs.putString("server_url", serverURL);
  prefs.putString("device_id", deviceID);
  prefs.putString("auth_token", authToken);
  prefs.putFloat("cal_factor", calibration_factor);
  prefs.end();
  if (localPause) resumeUSBTimer();
}

// Forward declarations
bool deviceLogin();
void updateWifiStatusChar();

// ─── WiFi ───
void connectWiFi() {
  if (wifiSSID.isEmpty()) return;
  if (wifiPass.isEmpty()) {
    Serial.println("WiFi password not set. Use BLE app to configure.");
    return;
  }
  Serial.printf("Connecting to WiFi: %s (pass: %c***)\n",
                wifiSSID.c_str(), wifiPass.charAt(0));
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
    yield();
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.printf("WiFi connected. IP: %s\n", WiFi.localIP().toString().c_str());
    deviceLogin();
  } else {
    wifiConnected = false;
    Serial.printf("WiFi failed. Status: %d\n", WiFi.status());
    beepError();
  }
}

void checkWiFi() {
  if (wifiSSID.isEmpty()) return;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wifiConnected) {
    wifiConnected = connected;
    updateWifiStatusChar();
    if (connected) {
      Serial.printf("WiFi reconnected. IP: %s\n", WiFi.localIP().toString().c_str());
      deviceLogin();
    } else if (millis() - wifiLastAttempt > WIFI_RETRY_MS) {
      wifiLastAttempt = millis();
      WiFi.reconnect();
    }
  }
}

// ─── BLE notify helpers ───
void notifyStatus(const String& status) {
  lastStatus = status;
  if (charStatus) {
    charStatus->setValue((uint8_t*)status.c_str(), status.length());
    charStatus->notify();
  }
}

void notifyError(const String& err) {
  lastError = err;
  String msg = "error:" + err;
  notifyStatus(msg);
  beepError();
}

void notifyWeight(float w) {
  if (charWeight) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", w);
    charWeight->setValue((uint8_t*)buf, strlen(buf));
    charWeight->notify();
  }
}

void notifyBarcode(const char* code) {
  if (charBarcode) {
    charBarcode->setValue((uint8_t*)code, strlen(code));
    charBarcode->notify();
  }
}

void updateWifiStatusChar() {
  if (!charWifiStatus) return;
  char buf[64];
  if (wifiConnected) {
    snprintf(buf, sizeof(buf), "connected:%s", WiFi.localIP().toString().c_str());
  } else {
    snprintf(buf, sizeof(buf), "disconnected");
  }
  charWifiStatus->setValue((uint8_t*)buf, strlen(buf));
  Serial.printf("BLE WiFi status set to: %s\n", buf);
  if (charWifiStatus->getSubscribedCount() > 0) {
    charWifiStatus->notify();
  }
}

// Results are sent as line-oriented BLE notifications:
// SCAN_BEGIN, SSID|RSSI|SECURE, ..., SCAN_END.
void notifyWifiScanMessage(const String& message) {
  if (charWifiScan) {
    charWifiScan->setValue(message.c_str());
    charWifiScan->notify();
  }
  // Also mirror the messages on the original status characteristic for
  // clients that were released before the dedicated scan characteristic.
  if (charWifiStatus) {
    charWifiStatus->setValue(message.c_str());
    charWifiStatus->notify();
  }
}

void scanWifiNetworks() {
  if (!charWifiScan) return;
  // Stop any pending connection/reconnect attempt before starting a scan.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false); // keep credentials in NVS
  delay(250);
  wifiScanResultCount = 0;
  wifiScanPayload = "";
  wifiScanReadIndex = -1;
  notifyWifiScanMessage("SCAN_BEGIN");
  delay(50);
  int count = WiFi.scanNetworks(false, true, false, 300);
  Serial.printf("WiFi scan found %d networks\n", count);
  if (count < 0) {
    notifyWifiScanMessage("SCAN_ERROR");
    delay(50);
  }
  for (int i = 0; i < count; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.isEmpty()) continue;
    String result = ssid + "|" + String(WiFi.RSSI(i)) + "|" +
                    String(WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? "1" : "0");
    if (wifiScanResultCount < 64) wifiScanResults[wifiScanResultCount++] = result;
    // Keep compact readback payload for mobile clients.
    if (wifiScanPayload.length() + result.length() + 1 < 1000) {
      wifiScanPayload += result;
      wifiScanPayload += '\n';
    }
    notifyWifiScanMessage(result);
    delay(50);
  }
  WiFi.scanDelete();
  notifyWifiScanMessage("SCAN_END");
  delay(100);
  updateWifiStatusChar();
}

// ─── BLE callbacks ───
class ConfigCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar) override {
    String uuid = pChar->getUUID().toString().c_str();
    String val  = pChar->getValue().c_str();

    if (uuid == CHAR_WIFI_SSID_UUID) {
      wifiSSID = val;
      saveConfig();
      Serial.printf("BLE: WiFi SSID set to '%s'\n", wifiSSID.c_str());
    } else if (uuid == CHAR_WIFI_PASS_UUID) {
      wifiPass = val;
      saveConfig();
      Serial.printf("BLE: WiFi password updated (len=%d)\n", wifiPass.length());
      connectWiFi();
      updateWifiStatusChar();
    } else if (uuid == CHAR_SERVER_URL_UUID) {
      serverURL = val;
      saveConfig();
      Serial.printf("BLE: Server URL set to '%s'\n", serverURL.c_str());
    } else if (uuid == CHAR_DEVICE_ID_UUID) {
      deviceID = val;
      authToken = "";
      saveConfig();
      Serial.printf("BLE: Device ID set to '%s'\n", deviceID.c_str());
      if (wifiConnected) deviceLogin();
    } else if (uuid == CHAR_AUTH_TOKEN_UUID) {
      authToken = val;
      saveConfig();
      Serial.println("BLE: Auth token updated");
    } else if (uuid == CHAR_WIFI_SCAN_UUID && val == "scan") {
      wifiScanRequested = true;
      Serial.println("BLE: WiFi scan requested");
    } else if (uuid == CHAR_WIFI_SCAN_UUID && val.startsWith("get:")) {
      if (val == "get:all") {
        wifiScanReadIndex = -2;
        Serial.printf("BLE WiFi scan get request: all (%d bytes)\n", wifiScanPayload.length());
      } else {
        wifiScanReadIndex = val.substring(4).toInt();
        Serial.printf("BLE WiFi scan get request: %d\n", wifiScanReadIndex);
      }
    }
  }

  void onRead(NimBLECharacteristic* pChar) override {
    String uuid = pChar->getUUID().toString().c_str();
    if (uuid == CHAR_WIFI_SSID_UUID) {
      pChar->setValue((uint8_t*)wifiSSID.c_str(), wifiSSID.length());
      Serial.printf("BLE onRead SSID: '%s'\n", wifiSSID.c_str());
    } else if (uuid == CHAR_SERVER_URL_UUID) {
      pChar->setValue((uint8_t*)serverURL.c_str(), serverURL.length());
      Serial.printf("BLE onRead URL: '%s'\n", serverURL.c_str());
    } else if (uuid == CHAR_DEVICE_ID_UUID) {
      pChar->setValue((uint8_t*)deviceID.c_str(), deviceID.length());
      Serial.printf("BLE onRead deviceID: '%s' (len=%d)\n", deviceID.c_str(), deviceID.length());
    } else if (uuid == CHAR_WIFI_STATUS_UUID) {
      char buf[64];
      if (wifiConnected) {
        snprintf(buf, sizeof(buf), "connected:%s", WiFi.localIP().toString().c_str());
      } else {
        snprintf(buf, sizeof(buf), "disconnected");
      }
      pChar->setValue((uint8_t*)buf, strlen(buf));
      Serial.printf("BLE onRead wifi status: %s\n", buf);
    } else if (uuid == CHAR_WIFI_SCAN_UUID) {
      if (wifiScanReadIndex == -2) {
        pChar->setValue(wifiScanPayload.c_str());
        Serial.printf("BLE WiFi scan read all: %d bytes\n", wifiScanPayload.length());
      } else if (wifiScanReadIndex >= 0 && wifiScanReadIndex < wifiScanResultCount) {
        pChar->setValue(wifiScanResults[wifiScanReadIndex].c_str());
        Serial.printf("BLE WiFi scan read %d/%d: %s\n", wifiScanReadIndex,
                      wifiScanResultCount, wifiScanResults[wifiScanReadIndex].c_str());
      } else {
        pChar->setValue("EMPTY");
        Serial.printf("BLE WiFi scan read %d: EMPTY (count=%d)\n",
                      wifiScanReadIndex, wifiScanResultCount);
      }
    }
  }
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar) override {
    String cmd = pChar->getValue().c_str();
    if (cmd == "tare") {
      Serial.println("BLE: Tare command");
      scale.set_scale();
      delay(500);
      scale.tare(20);
      scale.set_scale(calibration_factor);
      notifyStatus("tare_done");
    } else if (cmd.startsWith("calibrate:")) {
      float refWeight = cmd.substring(10).toFloat();
      if (refWeight > 0) {
        float rawValue = scale.get_value(50);
        calibration_factor = roundf(rawValue / refWeight);
        scale.set_scale(calibration_factor);
        saveConfig();
        Serial.printf("BLE: Calibrated. Factor: %.0f\n", calibration_factor);
        notifyStatus("calibrated");
      }
    }
  }
};

ConfigCallbacks  configCB;
CommandCallbacks commandCB;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer) override {
    Serial.println("BLE client connected.");
    // Push device ID via notification after delay so client can subscribe first
    if (charDeviceID && !deviceID.isEmpty()) {
      xTaskCreate([](void*) {
        vTaskDelay(pdMS_TO_TICKS(2000));
        if (charDeviceID && charDeviceID->getSubscribedCount() > 0) {
          charDeviceID->setValue(deviceID.c_str());
          charDeviceID->notify();
          Serial.printf("BLE: notified deviceID '%s'\n", deviceID.c_str());
        } else {
          Serial.println("BLE: no subscribers for deviceID, skipping notify");
        }
        vTaskDelete(nullptr);
      }, "bleNotify", 2048, nullptr, 1, nullptr);
    }
  }
  void onDisconnect(NimBLEServer* pServer) override {
    Serial.println("BLE client disconnected.");
    NimBLEDevice::startAdvertising();
  }
};

ServerCallbacks serverCB;

void setupBLE() {
  String bleName = "OmniScale-" + deviceID;
  NimBLEDevice::init(bleName.c_str());
  Serial.printf("BLE name: %s\n", bleName.c_str());
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

  NimBLEServer* pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(&serverCB);

  // Config service
  NimBLEService* cfgSvc = pServer->createService(SERVICE_CONFIG_UUID);

  auto* cSSID = cfgSvc->createCharacteristic(CHAR_WIFI_SSID_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE);
  cSSID->setCallbacks(&configCB);

  auto* cPass = cfgSvc->createCharacteristic(CHAR_WIFI_PASS_UUID,
    NIMBLE_PROPERTY::WRITE);
  cPass->setCallbacks(&configCB);

  auto* cURL = cfgSvc->createCharacteristic(CHAR_SERVER_URL_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE);
  cURL->setCallbacks(&configCB);

  charDeviceID = cfgSvc->createCharacteristic(CHAR_DEVICE_ID_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  charDeviceID->setCallbacks(&configCB);

  auto* cAuth = cfgSvc->createCharacteristic(CHAR_AUTH_TOKEN_UUID,
    NIMBLE_PROPERTY::WRITE);
  cAuth->setCallbacks(&configCB);

  charWifiStatus = cfgSvc->createCharacteristic(CHAR_WIFI_STATUS_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  charWifiStatus->setCallbacks(&configCB);

  charWifiScan = cfgSvc->createCharacteristic(CHAR_WIFI_SCAN_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  charWifiScan->setCallbacks(&configCB);

  cfgSvc->start();

  // Scale service
  NimBLEService* scaleSvc = pServer->createService(SERVICE_SCALE_UUID);

  charWeight = scaleSvc->createCharacteristic(CHAR_WEIGHT_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  charBarcode = scaleSvc->createCharacteristic(CHAR_BARCODE_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  charStatus = scaleSvc->createCharacteristic(CHAR_STATUS_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  auto* cCmd = scaleSvc->createCharacteristic(CHAR_COMMAND_UUID,
    NIMBLE_PROPERTY::WRITE);
  cCmd->setCallbacks(&commandCB);

  scaleSvc->start();

  // Set initial characteristic values
  charWifiStatus->setValue("disconnected");
  charWifiScan->setValue("ready");
  charWeight->setValue("--");
  charBarcode->setValue("--");
  charStatus->setValue("ready");
  charDeviceID->setValue(deviceID.c_str());
  cURL->setValue(serverURL.c_str());

  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_CONFIG_UUID);
  pAdv->addServiceUUID(SERVICE_SCALE_UUID);
  pAdv->setScanResponse(true);
  pAdv->start();

  Serial.println("BLE advertising started.");
}

// ─── Device login ───
bool deviceLogin() {
  if (!wifiConnected || serverURL.isEmpty() || deviceID.isEmpty()) return false;
  if (!authToken.isEmpty()) return true;

  String base = serverURL;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  String loginURL = base + "/api/device/login";
  Serial.printf("Device login: %s\n", loginURL.c_str());

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, loginURL);
  http.addHeader("Content-Type", "application/json");

  char body[256];
  snprintf(body, sizeof(body), "{\"serialNumber\":\"%s\"}", deviceID.c_str());

  int code = http.POST(body);
  if (code >= 200 && code < 300) {
    String response = http.getString();
    http.end();
    Serial.printf("Login response: %s\n", response.c_str());

    JsonDocument doc;
    if (deserializeJson(doc, response) == DeserializationError::Ok && !doc["token"].isNull()) {
      authToken = doc["token"].as<String>();
    } else {
      authToken = response;
    }
    authToken.trim();
    saveConfig();
    Serial.println("Auth token acquired and saved.");
    return true;
  } else {
    String response = http.getString();
    http.end();
    Serial.printf("Login failed (%d): %s\n", code, response.c_str());
    notifyError("login_failed");
    return false;
  }
}

// ─── HTTPS POST ───
bool postData(const char* barcode, float weight) {
  if (!wifiConnected || serverURL.isEmpty()) {
    Serial.println("Cannot POST: no WiFi or no server URL configured.");
    return false;
  }

  if (authToken.isEmpty()) {
    if (!deviceLogin()) {
      Serial.println("Cannot POST: login failed.");
      return false;
    }
  }

  String base = serverURL;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  String url = base + "/api/bottle-stats";

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);

  char payload[512];
  snprintf(payload, sizeof(payload),
    "{\"barcode\":\"%s\",\"weight\":%.1f,\"date\":\"%lu\",\"device_id\":\"%s\"}",
    barcode, weight, (unsigned long)(millis() / 1000), deviceID.c_str());

  Serial.printf("POST %s\n", url.c_str());
  Serial.printf("Body: %s\n", payload);

  int code = http.POST(payload);
  String response = http.getString();
  http.end();

  if (code >= 200 && code < 300) {
    Serial.printf("POST success (%d): %s\n", code, response.c_str());
    return true;
  }

  // If 401/403, token may have expired -- re-login and retry once
  if (code == 401 || code == 403) {
    Serial.println("Auth rejected, re-authenticating...");
    authToken = "";
    saveConfig();
    if (deviceLogin()) {
      WiFiClientSecure retryClient;
      retryClient.setInsecure();
      http.begin(retryClient, url);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", "Bearer " + authToken);

      code = http.POST(payload);
      response = http.getString();
      http.end();

      if (code >= 200 && code < 300) {
        Serial.printf("POST retry success (%d): %s\n", code, response.c_str());
        return true;
      }
    }
  }

  Serial.printf("POST failed (%d): %s\n", code, response.c_str());
  return false;
}

// ─── Scale ───
float measureStableWeight() {
  const int TOTAL = 21;
  const int TRIM = 5;
  float samples[TOTAL];

  for (int i = 0; i < TOTAL; i++) {
    samples[i] = scale.get_units(1);
    yield();
  }

  for (int i = 1; i < TOTAL; i++) {
    float key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  float sum = 0;
  for (int i = TRIM; i < TOTAL - TRIM; i++) {
    sum += samples[i];
  }
  return sum / (TOTAL - 2 * TRIM);
}

void doTare() {
  Serial.println("Taring...");
  scale.set_scale();
  delay(2000);
  scale.tare(20);
  scale.set_scale(calibration_factor);
  Serial.println("Tare done.");
}

void wakeScale() {
  if (!hx711_awake) {
    Serial.println("Waking up HX711...");
    scale.power_up();
    hx711_awake = true;
    delay(500); // Give it time to stabilize
    doTare();
  }
}

void sleepScale() {
  if (hx711_awake) {
    Serial.println("Powering down HX711...");
    scale.power_down();
    hx711_awake = false;
    notifyStatus("sleeping");
  }
}

// ─── Setup ───
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[BOOT] Starting...");
  Serial.flush();

  // Buzzer
  ledcSetup(BUZZER_CHANNEL, BUZZER_FREQ, BUZZER_RES);
  ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
  beepShort(1);

  Serial.println("\n========================================");
  Serial.println("      *** OMNIDIRECTIONAL SCALE ***");
  Serial.println("========================================");
  Serial.flush();

  // Load config from NVS
  loadConfig();
  Serial.printf("Device ID:  %s\n", deviceID.c_str());
  Serial.printf("Server URL: %s\n", serverURL.c_str());
  Serial.printf("WiFi SSID:  %s\n", wifiSSID.c_str());
  Serial.printf("Cal factor: %.1f\n", calibration_factor);

  // HX711
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN, 128);
  delay(500);
  if (!scale.is_ready()) {
    Serial.println("ERROR: HX711 not responding!");
    beepError();
    while (!scale.is_ready()) delay(500);
  }
  Serial.println("HX711 connected.");
  doTare();
  lastActivityTime = millis();

  // Initialize the software USB host before starting WiFi/BLE.  The host's
  // timer/ISR setup is timing-sensitive and can trip the ESP32 watchdog when
  // it is started after the networking stack has taken over core 0.
  Serial.println("Initializing USB Host...");
  Serial.flush();
  usb_pins_config_t pins = { USB_DP_PIN, USB_DM_PIN, -1, -1, -1, -1, -1, -1 };
  USH.setTaskCore(0);
  USH.setISRAllocFlag(ESP_INTR_FLAG_LEVEL1);
  USH.init(pins, onUSBDetect, onUSBData, nullptr, onUSBDisconnect);
  usbHostStarted = true;
  Serial.println("USB Host started.");
  delay(250);
  yield();

  // BLE
  setupBLE();

  // WiFi
  if (!wifiSSID.isEmpty()) {
    connectWiFi();
    updateWifiStatusChar();
  } else {
    Serial.println("No WiFi configured. Use BLE app to set credentials.");
  }

  beepShort(2);
  Serial.println("\nReady. Scan a barcode to begin.");
  notifyStatus("ready");
}

// ─── Main loop ───
void loop() {
  if (wifiScanRequested) {
    wifiScanRequested = false;
    scanWifiNetworks();
  }
  checkWiFi();

  // Check for global idle timeout
  if (hx711_awake && (millis() - lastActivityTime > SLEEP_TIMEOUT_MS)) {
    Serial.println("Idle timeout reached.");
    sleepScale();
    if (deviceState != STATE_WAIT_BARCODE) {
      deviceState = STATE_WAIT_BARCODE;
      barcodeReady = false;
      barcodeLen = 0;
      memset(barcodeBuffer, 0, sizeof(barcodeBuffer));
      memset(lastKeys, 0, sizeof(lastKeys));
      notifyStatus("ready");
      Serial.println("\nReady. Scan a barcode to begin.");
    }
  }

  // Serial commands for debugging
  if (Serial.available()) {
    char c = Serial.read();
    while (Serial.available()) Serial.read();
    if (c == 't' || c == 'T') {
      wakeScale();
      doTare();
      lastActivityTime = millis();
      notifyStatus("tare_done");
      beepShort(1);
    }
  }

  // State machine
  switch (deviceState) {

    case STATE_WAIT_BARCODE: {
      if (barcodeReady) {
        barcodeReady = false;
        strncpy(lastBarcode, barcodeBuffer, sizeof(lastBarcode) - 1);
        lastBarcode[sizeof(lastBarcode) - 1] = '\0';
        barcodeLen = 0;

        lastActivityTime = millis(); // Reset idle timer
        wakeScale(); // Wake up the scale if sleeping

        // Print barcode with extra newlines and a clear prefix so it's impossible to miss
        Serial.println("\n----------------------------------------");
        Serial.printf(">>> SCANNED BARCODE: %s <<<\n", lastBarcode);
        Serial.println("----------------------------------------\n");
        
        notifyBarcode(lastBarcode);
        beepBarcode();

        notifyStatus("place_weight");
        Serial.println("Place item on the scale...");
        deviceState = STATE_WAIT_WEIGHT;
      }
      break;
    }

    case STATE_WAIT_WEIGHT: {
      if (!hx711_awake) break; // If it went to sleep, wait for next barcode
      float check = scale.get_units(5);
      if (fabsf(check) > WEIGHT_ON_THRESHOLD) {
        delay(500);
        lastWeight = measureStableWeight();

        if (fabsf(lastWeight) > MAX_WEIGHT) {
          notifyError("bad_reading");
          delay(1000);
          scale.tare(20);
          lastActivityTime = millis(); // Reset idle timer so they have time to try again
          notifyStatus("place_weight");
          break;
        }

        Serial.printf(">> Weight: %.1f g\n", lastWeight);
        notifyWeight(lastWeight);
        beepWeighDone();

        deviceState = STATE_PROCESSING;
      }
      break;
    }

    case STATE_PROCESSING: {
      notifyStatus("sending");

      bool posted = false;
      if (wifiConnected && !serverURL.isEmpty()) {
        posted = postData(lastBarcode, lastWeight);
        if (!posted) {
          notifyError("post_failed");
        }
      }

      String result = posted ? "sent" : (wifiConnected ? "post_failed" : "offline");
      Serial.printf("Result: %s | Barcode: %s | Weight: %.1f g\n",
                     result.c_str(), lastBarcode, lastWeight);

      if (posted) {
        notifyStatus("success");
        beepShort(1);
      } else if (!wifiConnected) {
        notifyStatus("offline:" + String(lastBarcode) + ":" + String(lastWeight, 1));
      }

      // Wait for weight removal
      Serial.println("Remove item...");
      lastActivityTime = millis(); // Reset timer so they have 3 mins to remove it
      bool removed = false;
      
      while (true) {
        if (!hx711_awake) break; // In case something else put it to sleep
        
        float val = scale.get_units(3);
        // Look for weight being near zero (less than the off threshold)
        // By NOT using fabsf(), we also correctly handle negative values (e.g. if scale drifts or tare was wrong)
        if (val < WEIGHT_OFF_THRESHOLD) {
          removed = true;
          break;
        }
        
        if (millis() - lastActivityTime > SLEEP_TIMEOUT_MS) {
          Serial.println("Item left on scale. Powering down...");
          break; // Break loop, will sleep at top of next loop()
        }
        
        delay(200);
        yield();
      }

      if (removed) {
        delay(2000);
        scale.tare(20);
      }

      deviceState = STATE_WAIT_BARCODE;
      lastActivityTime = millis(); // Reset idle timer so it stays awake 3 mins after removal
      notifyStatus("ready");
      Serial.println("\nReady. Scan a barcode to begin.");
      
      // Long beep to signal the device is ready for the next scan
      beepLong();
      
      break;
    }
  }

  delay(50);
}
