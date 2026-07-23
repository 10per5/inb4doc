---
title: Android Debugging
weight: 1
---

# Android Debugging

## Logcat

WebView console output is forwarded to Android logcat via `WebChromeClient.onConsoleMessage`.

```bash
# Filter by tag
adb logcat -s inb4doc-js

# Broader filter (catches all inb4doc output)
adb logcat | grep -i inb4doc

# Show only errors
adb logcat *:E | grep inb4doc
```

The JS bridge (`NativeBridge.log`) also pipes console output to logcat under the `inb4doc` tag.

## Connecting via adb

1. Enable **Developer options** on the device (tap Build Number 7 times)
2. Enable **USB debugging**
3. Connect via USB and accept the authorization dialog
4. Verify with `adb devices`

If `adb devices` shows "waiting for device":

* Switch USB mode from "Charge only" to **"File Transfer"**

* Try a different USB cable (some are charge-only)

* Run `adb kill-server && adb start-server`
