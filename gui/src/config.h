#pragma once
#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include "settings.h"

/// Mutable content root.
///
/// `config` is otherwise final after the app coroutine starts; this is the one
/// deliberate exception — setContentRoot (File → Open Project…) switches the
/// content root at runtime. The bridge and scheme callbacks run on different
/// threads, so the path is guarded by a mutex.
struct content_root_state
{
    std::string get() const
    {
        std::lock_guard<std::mutex> lock(m);
        return path;
    }

    void set(std::string p)
    {
        std::lock_guard<std::mutex> lock(m);
        path = std::move(p);
    }

private:
    mutable std::mutex m;
    std::string path;
};

/// Resolved configuration driving the entire application.
///
/// Produced by main.cpp from CLI arguments.  All fields are
/// final — no mutation after the app coroutine starts — except the
/// content root, which lives behind `root_state` so File → Open Project…
/// can reselect it at runtime, and `settings`, which the app and bridge
/// persist on change.
struct config
{
    std::string editor_url;         ///< URL the webview loads first
    std::string live_url;           ///< Live-preview server base URL
    std::string editor_root;        ///< Path to editor frontend (has public/)
    std::string favicon;            ///< Optional window icon path
    std::size_t live_port = 5000;   ///< Port for live preview server
    std::size_t max_content_size = 10 * 1024 * 1024; ///< Max PUT body / upload file (bytes)
    bool disable_gpu = false;       ///< --disable-gpu
    bool no_ignore = false;         ///< --no-ignore
    int depth = 0;                  ///< --depth (0 = unlimited)
    bool debug = false;             ///< --debug
    bool use_app_scheme = false;    ///< true when --editor-root was given

    /// Mutable content root (runtime reselection). Always set in local mode.
    std::shared_ptr<content_root_state> root_state;

    /// inb4.config.toml parsed once at startup (zoom, last content_root).
    std::shared_ptr<::settings> settings;

    /// Current content root path (canonical). Empty when no root is configured
    /// (remote mode, or local mode before a root was resolved).
    std::string root() const;
};
