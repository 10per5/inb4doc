#pragma once
#include <string>

/// Full path to the current executable.
std::string exe_path();

/// Best guess for the editor frontend directory.
///
/// Tries locations relative to the executable first, then falls back to a
/// platform-specific default (e.g. /opt/predoc/editor on Linux).
/// Returns empty if no candidate was found (caller must still validate).
std::string default_editor_root();

/// Platform-standard writable data directory for predoc (e.g. ~/.local/share/predoc).
std::string default_data_dir();
