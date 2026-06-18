#pragma once
#include <cstddef>
#include <string>

/// Resolved configuration driving the entire application.
///
/// Produced by main.cpp from CLI arguments.  All fields are
/// final — no mutation after the app coroutine starts.
struct config
{
    std::string editor_url;       ///< URL the webview loads first
    std::string live_url;         ///< Live-preview server base URL
    std::string editor_root;      ///< Path to editor frontend (has public/)
    std::string content_root;     ///< Path to markdown content root
    std::string favicon;          ///< Optional window icon path
    std::size_t live_port = 5000; ///< Port for internal_url() whitelist
    bool disable_gpu = false;     ///< --disable-gpu
    bool debug = false;           ///< --debug
    bool use_app_scheme = false;  ///< true when --editor-root was given
};
