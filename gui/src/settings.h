#pragma once
#include <string>

/// inb4.config.toml (data-dir root), parsed once at startup.
///
/// Flat `key = value` toml-ish file:
///   zoom = 1.05
///   content_root = /path/to/content
///
/// `load` parses the file a single time; `save` rewrites the whole file from
/// the struct. The app shares one instance via config.settings so the bridge
/// (setContentRoot) and the app (zoom on quit) update + persist it.
struct settings
{
    float zoom = 1.0f;
    std::string content_root;

    static settings load(const std::string &data_dir);
    void save(const std::string &data_dir) const;
};
