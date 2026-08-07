#pragma once
#include "config.h"
#include <memory>
#include <saucer/smartview.hpp>

/// Register native fs bridge functions, exposed as
/// `window.saucer.exposed.<name>(...)` and callable from the editor JS.
///
/// These replace the equivalent `app://` scheme routes that carry a request
/// body (PUT/POST): Qt WebEngine's custom-scheme body transport hangs, so a
/// JS `fetch` with a body to `app://` never resolves. GET/HEAD/DELETE scheme
/// routes have no body and keep working, so only body-carrying ops live here.
///
/// Every exposed function returns a JSON string `{ok, status?, error?, data?}`
/// so the JS `backendError(status, msg)` + status->toast mapping still works.
///
/// `cfg` is captured via shared_ptr so the webview outlives this call.
void register_bridge(saucer::smartview &wv, const std::shared_ptr<config> &cfg);
