#include "args.h"
#include "CLI11/CLI11.hpp"
#include <cstdlib>

parsed_args parse_args(int argc, char **argv)
{
    parsed_args args;

    CLI::App app("predoc - desktop GUI for the editor");

    app.add_option("--host", args.host,
                   "Remote editor host (default 127.0.0.1; use with --port)");
    app.add_option("--port", args.port,
                   "Remote editor port (default 3000; use with --host)");
    app.add_option("--editor-root", args.editor_root,
                   "Serve frontend from <path>/public/ via app:// scheme "
                   "(mutually exclusive with --host/--port)");
    app.add_option("--content-root", args.content_root,
                   "Content root for the file-tree & markdown API");
    app.add_option("--live-port", args.live_port,
                   "Live preview server port (default: 5000)");
    app.add_option("--favicon", args.favicon, "Window icon path");
    app.add_flag("--disable-gpu", args.disable_gpu,
                 "Disable hardware acceleration");
    app.add_flag("--debug", args.debug, "Verbose stderr logging");

    app.set_help_flag("--help,-h", "Show this help");

    try
    {
        app.parse(argc, argv);
    }
    catch (const CLI::ParseError &e)
    {
        std::exit(app.exit(e));
    }

    return args;
}
