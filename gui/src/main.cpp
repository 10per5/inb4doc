#include "args.h"
#include "config.h"
#include "app.h"
#include <print>
#include <iostream>
#include <filesystem>
#include <optional>
namespace fs = std::filesystem;

static bool mode_missing(const parsed_args &args)
{
    return args.editor_root.empty() && args.host.empty();
}

static bool mode_ambiguous(const parsed_args &args)
{
    return !args.editor_root.empty() && !args.host.empty();
}

static std::optional<config> resolve_config(const parsed_args &args)
{
    config cfg;
    cfg.debug = args.debug;
    cfg.disable_gpu = args.disable_gpu;
    cfg.favicon = args.favicon;
    cfg.live_port = args.live_port;
    cfg.live_url = "http://127.0.0.1:" + std::to_string(args.live_port);

    if (mode_ambiguous(args))
    {
        std::cerr << "error: --editor-root and --host are mutually exclusive\n";
        return std::nullopt;
    }

    if (mode_missing(args))
    {
        std::cerr << "error: specify either --editor-root <path> or "
                     "--host <addr> [--port <n>]\n";
        return std::nullopt;
    }

    // -- remote mode (--host / --port) --

    if (!args.host.empty())
    {
        cfg.editor_url = "http://" + args.host + ":" + std::to_string(args.port);
        return cfg;
    }

    // -- local mode (--editor-root) --

    if (!fs::exists(args.editor_root) || !fs::is_directory(args.editor_root))
    {
        std::cerr << "error: --editor-root '" << args.editor_root
                  << "' is not a valid directory\n";
        return std::nullopt;
    }

    cfg.editor_root = fs::canonical(args.editor_root);

    auto index_html = fs::path(cfg.editor_root) / "index.html";
    if (!fs::exists(index_html))
    {
        std::cerr << "error: --editor-root '" << cfg.editor_root
                  << "' does not contain 'index.html'\n";
        return std::nullopt;
    }

    if (args.content_root.empty())
    {
        std::cerr << "error: --content-root is required when using "
                     "--editor-root\n";
        return std::nullopt;
    }

    if (!fs::exists(args.content_root) || !fs::is_directory(args.content_root))
    {
        std::cerr << "error: --content-root '" << args.content_root
                  << "' is not a valid directory\n";
        return std::nullopt;
    }

    cfg.content_root = fs::canonical(args.content_root);

    cfg.editor_url = "app://_/";
    cfg.use_app_scheme = true;

    return cfg;
}

int main(int argc, char **argv)
{
    auto args = parse_args(argc, argv);

    auto cfg = resolve_config(args);
    if (!cfg)
        return 1;

    if (cfg->debug)
    {
        std::println(std::cerr, "  [debug] final config:");
        std::println(std::cerr, "  [debug]   editor_url  = {}", cfg->editor_url);
        std::println(std::cerr, "  [debug]   live_url    = {}", cfg->live_url);
        std::println(std::cerr, "  [debug]   favicon     = {}",
                     cfg->favicon.empty() ? "(none)" : cfg->favicon);
        std::println(std::cerr, "  [debug]   disable_gpu = {}", cfg->disable_gpu);
    }

    return run_app(std::move(*cfg));
}
