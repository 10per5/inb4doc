#include "app.h"
#include "scheme.h"
#include <saucer/smartview.hpp>
#include <saucer/icon.hpp>
#include <saucer/webview.hpp>
#include <saucer/navigation.hpp>
#include <print>
#include <string>
#include <iostream>
#include <optional>
#include <memory>

static void toast(saucer::smartview &wv, const std::string &msg)
{
    std::string escaped;
    for (char c : msg)
    {
        if (c == '\'')
            escaped += "\\'";
        else if (c == '\\')
            escaped += "\\\\";
        else if (c == '\n')
            escaped += "\\n";
        else if (c == '\r')
            escaped += "\\r";
        else
            escaped += c;
    }
    auto js = "predocUI.showToast('" + escaped + "')";
    static_cast<saucer::webview &>(wv).execute(js.c_str());
}

static bool internal_url(std::size_t live_port,
                         const std::string &scheme,
                         const std::optional<std::string> &host,
                         const std::optional<std::size_t> &port)
{
    if (scheme == "app")
        return true;
    if (!host.has_value() || host->empty())
        return true;
    if (!port.has_value())
        return false;
    return (*host == "localhost" || *host == "127.0.0.1") &&
           (*port == live_port);
}

int run_app(config cfg)
{
    if (cfg.use_app_scheme)
        saucer::webview::register_scheme("app");

    auto safe = std::make_shared<config>(std::move(cfg));

    return saucer::application::create({.id = "predoc"})->run(
        [safe](saucer::application *app) -> coco::stray
        {
            auto window = saucer::window::create(app).value();

            saucer::smartview::options opts{.window = window};
            if (safe->disable_gpu)
            {
                opts.hardware_acceleration = false;
                opts.browser_flags = {"--disable-gpu"};
            }
            auto wv = saucer::smartview::create(opts).value();

            if (!safe->favicon.empty())
                if (auto ico = saucer::icon::from(safe->favicon))
                    window->set_icon(*ico);

            window->set_title("predoc");
            window->set_size({.w = 1200, .h = 800});

            // -- app:// scheme handler (local mode only) --

            if (safe->use_app_scheme)
            {
                wv.handle_scheme("app", [safe](const auto &req)
                {
                    return handle_app_request(*safe, req);
                });
            }

            // -- navigation policy --

            wv.on<saucer::webview::event::navigate>(
                [safe, &wv](const auto &nav)
                {
                    auto url_str = nav.url().string();
                    auto scheme = nav.url().scheme();
                    auto host = nav.url().host();
                    auto port = nav.url().port();

                    if (safe->debug)
                        std::println(std::cerr,
                            "  [debug] navigate: url={}, scheme={}, "
                            "host={}, port={}\n", url_str, scheme,
                            host.value_or("(null)"),
                            port.has_value() ? std::to_string(*port) : "(null)");

                    if (internal_url(safe->live_port, scheme, host, port))
                    {
                        if (nav.new_window())
                        {
                            if (safe->debug)
                                std::println(std::cerr,
                                    "  [debug]   -> redirect to existing view\n");
                            wv.set_url(nav.url());
                            return saucer::policy::block;
                        }
                        if (safe->debug)
                            std::println(std::cerr, "  [debug]   -> allow\n");
                        return saucer::policy::allow;
                    }

                    if (safe->debug)
                        std::println(std::cerr, "  [debug]   -> block (external)\n");
                    toast(wv, "This website is external, open it in your "
                              "navigator\n" + url_str);
                    return saucer::policy::block;
                }
            );

            // -- JS bridges --

            wv.expose("navigateToEditor", [safe, &wv]()
            {
                if (safe->debug)
                    std::println(std::cerr,
                        "  [debug] JS callback: navigateToEditor -> {}\n",
                        safe->editor_url);
                wv.set_url(safe->editor_url);
            });

            wv.expose("navigateToPreview", [safe, &wv](const std::string &path)
            {
                auto url = safe->live_url + path;
                if (safe->debug)
                    std::println(std::cerr,
                        "  [debug] JS callback: navigateToPreview({}) -> {}\n",
                        path, url);
                wv.set_url(url);
            });

            wv.expose("handleExternalNav", [safe, &wv](const std::string &url)
            {
                if (safe->debug)
                    std::println(std::cerr,
                        "  [debug] JS callback: handleExternalNav({})\n", url);

                auto parsed = saucer::url::parse(url);
                if (!parsed)
                {
                    toast(wv, "Could not open link");
                    return;
                }
                auto scheme = parsed->scheme();
                auto host = parsed->host();
                auto port = parsed->port();

                if (internal_url(safe->live_port, scheme, host, port))
                    wv.set_url(url);
                else
                    toast(wv, "This website is external, open it in your "
                              "navigator\n" + url);
            });

            // -- launch --

            if (safe->debug)
                std::println(std::cerr, "  [debug] initial URL: {}\n",
                             safe->editor_url);

            wv.set_url(safe->editor_url);
            window->show();

            co_await app->finish();
        }
    );
}
