#pragma once
#include <cstddef>
#include <string>

/// Raw CLI flags before any validation / defaulting.
///
/// Only parsing, no I/O or filesystem access.
struct parsed_args
{
    std::string host;             ///< --host (remote editor, default 127.0.0.1)
    std::size_t port = 3000;      ///< --port (remote editor, default 3000)
    std::size_t live_port = 5000; ///< --live-port
    std::string editor_root;      ///< --editor-root (local app:// mode)
    std::string content_root;     ///< --content-root
    std::string favicon;          ///< --favicon
    bool disable_gpu = false;     ///< --disable-gpu
    bool debug = false;           ///< --debug
};

/// Parse argc/argv via CLI11.  Prints help & exits on --help/-h.
parsed_args parse_args(int argc, char **argv);
