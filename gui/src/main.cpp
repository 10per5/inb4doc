#include "args.h"
#include "config.h"
#include "app.h"
#include "platform.h"
#include <print>
#include <iostream>
#include <filesystem>
#include <optional>
namespace fs = std::filesystem;

static bool mode_ambiguous(const parsed_args &args)
{
    return !args.editor_root.empty() && !args.host.empty();
}

static std::optional<config> resolve_config(const parsed_args &args)
{
    config cfg;
    cfg.debug = args.debug;
    cfg.disable_gpu = args.disable_gpu;
    cfg.no_ignore = args.no_ignore;
    cfg.depth = args.depth;
    if (args.favicon.empty())
    {
        auto self = fs::path(exe_path());
        auto beside = self.parent_path() / "icon.png";
        std::error_code ec;
        if (!beside.empty() && fs::exists(beside, ec))
            cfg.favicon = beside.string();
    }
    else
    {
        cfg.favicon = args.favicon;
    }
    cfg.live_port = args.live_port;
    cfg.live_url = "http://127.0.0.1:" + std::to_string(args.live_port);

    if (mode_ambiguous(args))
    {
        std::cerr << "error: --editor-root and --host are mutually exclusive\n";
        return std::nullopt;
    }

    // -- remote mode (--host / --port) --

    if (!args.host.empty())
    {
        cfg.editor_url = "http://" + args.host + ":" + std::to_string(args.port);
        return cfg;
    }

    // -- local mode (--editor-root) --

    auto editor_root = args.editor_root;
    if (editor_root.empty())
    {
        editor_root = default_editor_root();
        if (!fs::exists(editor_root) || !fs::is_directory(editor_root))
            editor_root.clear();
    }

    if (editor_root.empty())
    {
        std::cerr << "error: specify either --editor-root <path> or "
                     "--host <addr> [--port <n>]\n";
        return std::nullopt;
    }

    if (!fs::exists(editor_root) || !fs::is_directory(editor_root))
    {
        std::cerr << "error: --editor-root '" << editor_root
                  << "' is not a valid directory\n";
        return std::nullopt;
    }

    cfg.editor_root = fs::canonical(editor_root).string();

    auto index_html = fs::path(cfg.editor_root) / "index.html";
    if (!fs::exists(index_html))
    {
        std::cerr << "error: --editor-root '" << cfg.editor_root
                  << "' does not contain 'index.html'\n";
        return std::nullopt;
    }

    auto content_root = args.content_root;
    if (content_root.empty())
    {
        // No content directory was passed. Default to the current directory
        // and let the editor fall back to local storage (e.g. browser
        // localStorage) when there are no markdown files to open — this is
        // no longer a fatal condition.
        content_root = ".";
        if (!fs::exists(content_root) || !fs::is_directory(content_root))
            content_root.clear();
    }

    if (!content_root.empty())
    {
        if (!fs::exists(content_root) || !fs::is_directory(content_root))
        {
            std::cerr << "error: --content-root '" << content_root
                      << "' is not a valid directory\n";
            return std::nullopt;
        }
        cfg.content_root = fs::canonical(content_root).string();
    }

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
        std::println(std::cerr, "  [debug]   no_ignore  = {}", cfg->no_ignore);
        std::println(std::cerr, "  [debug]   depth      = {}", cfg->depth);
    }

    return run_app(std::move(*cfg));
}
