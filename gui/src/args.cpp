#include "args.h"
#include "CLI11/CLI11.hpp"
#include <cstdlib>

parsed_args parse_args(int argc, char **argv)
{
    parsed_args args;

    // Firefox / the desktop handler pass an `inb4doc://…` deep link as `%u`,
    // i.e. a bare positional argument. Pull those out before handing argv to
    // CLI11 so they aren't mistaken for a content-root file/dir (and don't
    // trip the "not a .md file" validation).
    std::vector<std::string> filtered;
    filtered.reserve(static_cast<std::size_t>(argc));
    for (int i = 0; i < argc; ++i)
    {
        std::string a = argv[i];
        if (a.rfind("inb4doc://", 0) == 0)
        {
            args.open_uri = a;
            continue;
        }
        filtered.push_back(std::move(a));
    }

    std::vector<char *> argv2;
    argv2.reserve(filtered.size());
    for (auto &s : filtered)
        argv2.push_back(s.data());

    CLI::App app("inb4doc - desktop GUI for the editor");

    app.add_option("--host", args.host,
                   "Remote editor host (default 127.0.0.1; use with --port)");
    app.add_option("--port", args.port,
                   "Remote editor port (default 3000; use with --host)");
    app.add_option("--editor-root", args.editor_root,
                   "Serve frontend from <path>/public/ via app:// scheme "
                   "(mutually exclusive with --host/--port)");
    app.add_option("content-root", args.content_root,
                   "Content directory, or a single .md file to open directly "
                   "(first positional arg)");
    app.add_option("--live-port", args.live_port,
                   "Live preview server port (default: 5000)");
    app.add_option("--favicon", args.favicon, "Window icon path");
    app.add_flag("--disable-gpu", args.disable_gpu,
                 "Disable hardware acceleration");
    app.add_flag("--no-ignore", args.no_ignore,
                 "Do not respect .gitignore files when building file tree");
    app.add_option("--depth", args.depth,
                   "Directory scan depth limit (0 = unlimited)");
    app.add_flag("--debug", args.debug, "Verbose stderr logging");

    app.set_help_flag("--help,-h", "Show this help");

    try
    {
        app.parse(static_cast<int>(argv2.size()), argv2.data());
    }
    catch (const CLI::ParseError &e)
    {
        std::exit(app.exit(e));
    }

    return args;
}
