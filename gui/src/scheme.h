#pragma once
#include "config.h"
#include <saucer/scheme.hpp>

/// Serve one app:// request (static files + content CRUD + file tree).
///
/// Dispatched by the webview's custom scheme handler when
/// cfg.use_app_scheme is true.  No webview reference needed —
/// only reads cfg.editor_root + cfg.content_root.
saucer::scheme::response handle_app_request(
    const config &cfg,
    const saucer::scheme::request &req);
