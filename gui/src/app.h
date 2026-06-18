#pragma once
#include "config.h"

/// Enter the Saucer event loop and display the window.
///
/// Owns the `start` coroutine: window creation, webview setup,
/// navigation policy, JS bridges, and the app:// scheme handler
/// registration.  Blocks until the window is closed.
int run_app(config cfg);
