#include "app.h"
#include "platform.h"
#include "scheme.h"
#include "security.h"
#include <saucer/smartview.hpp>
#include <saucer/icon.hpp>
#include <saucer/webview.hpp>
#include <saucer/navigation.hpp>
#include <print>
#include <string>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <memory>
#if defined(__linux__)
#include <QClipboard>
#include <QGuiApplication>
#include <QShortcut>
#include <saucer/modules/stable/qt.hpp>
#elif defined(_WIN32)
#include <saucer/modules/stable/webview2.hpp>
#endif

#if defined(__APPLE__)
#include <objc/runtime.h>
#include <objc/message.h>
#include "mac_shortcuts.h"
#elif defined(_WIN32)
#include <windows.h>

static std::filesystem::path g_data_dir;

static void save_zoom(const std::filesystem::path &data_dir, float zoom);

static LRESULT CALLBACK HotkeyProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_HOTKEY)
    {
        if (auto *a = static_cast<saucer::application *>(
                GetPropW(hwnd, L"PD_APP")))
        {
            if (wp == 1)
            {
                if (auto *w = static_cast<saucer::smartview *>(
                        GetPropW(hwnd, L"PD_WV")))
                {
                    double zoom;
                    w->native<true>().controller->get_ZoomFactor(&zoom);
                    save_zoom(g_data_dir, static_cast<float>(zoom));
                }
                a->quit();
                return 0;
            }
            if (wp == 2)
            {
                if (auto *w = static_cast<saucer::smartview *>(
                        GetPropW(hwnd, L"PD_WV")))
                    static_cast<saucer::webview &>(*w).execute(
                        "window.inb4docUI?.openFind?.()");
                return 0;
            }
            if (wp == 3)
            {
                if (auto *w = static_cast<saucer::smartview *>(
                        GetPropW(hwnd, L"PD_WV")))
                    static_cast<saucer::webview &>(*w).execute(
                        "window.inb4docUI?.findNext?.()");
                return 0;
            }
            if (wp == 4)
            {
                if (auto *w = static_cast<saucer::smartview *>(
                        GetPropW(hwnd, L"PD_WV")))
                    static_cast<saucer::webview &>(*w).execute(
                        "window.inb4docUI?.findPrev?.()");
                return 0;
            }
        }
    }
    auto *orig = static_cast<WNDPROC>(GetPropW(hwnd, L"PD_ORIG"));
    return CallWindowProcW(orig, hwnd, msg, wp, lp);
}
#endif

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
    auto js = "window.inb4docUI.showToast('" + escaped + "')";
    static_cast<saucer::webview &>(wv).execute(js.c_str());
}

static float load_zoom(const std::filesystem::path &data_dir)
{
    auto path = data_dir / "zoom";
    std::ifstream ifs(path);
    if (!ifs)
        return 1.0f;
    float v{};
    ifs >> v;
    return ifs.fail() ? 1.0f : v;
}

static void save_zoom(const std::filesystem::path &data_dir, float zoom)
{
    if (auto ofs = std::ofstream(data_dir / "zoom"))
        ofs << zoom;
}

static bool is_allowed(const saucer::url &url)
{
    return security::check(security::parse_url(url.string()))
           != security::verdict::block;
}

int run_app(config cfg)
{
    if (cfg.use_app_scheme)
        saucer::webview::register_scheme("app");

    auto safe = std::make_shared<config>(std::move(cfg));

    return saucer::application::create({.id = "inb4doc"})->run(
        [safe](saucer::application *app) -> coco::stray
        {
            auto window = saucer::window::create(app).value();

            auto data_dir = default_data_dir();
            if (!data_dir.empty())
                std::filesystem::create_directories(data_dir);

            saucer::smartview::options opts{
                .window = window,
                .storage_path = data_dir.empty() ? std::nullopt : std::optional<std::filesystem::path>(data_dir),
            };
            if (safe->disable_gpu)
                opts.hardware_acceleration = false;
            opts.browser_flags.insert("--no-sandbox");
            if (safe->disable_gpu)
                opts.browser_flags.insert("--disable-gpu");

            auto wv = saucer::smartview::create(opts).value();

            {
                auto zoom = load_zoom(data_dir);
                if (zoom != 1.0f)
                {
#if defined(__linux__)
                    wv.native<true>().webview->page()->setZoomFactor(zoom);
#elif defined(_WIN32)
                    wv.native<true>().controller->put_ZoomFactor(zoom);
#endif
                }
            }

            if (safe->debug)
            {
                wv.set_dev_tools(true);
#if defined(__linux__)
                qputenv("QTWEBENGINE_REMOTE_DEBUGGING", "9222");
#endif
            }

            if (!safe->favicon.empty())
                if (auto ico = saucer::icon::from(safe->favicon))
                    window->set_icon(*ico);

            window->set_title("inb4doc");
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

                    if (is_allowed(nav.url()))
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

            wv.expose("_nativeCopy", [](const std::string &text)
            {
#if defined(__APPLE__)
                auto send = reinterpret_cast<id (*)(id, SEL, ...)>(
                    &objc_msgSend);
                id pb = send(objc_getClass("NSPasteboard"),
                    sel_getUid("generalPasteboard"));
                send(pb, sel_getUid("clearContents"));
                id str = send(
                    send(objc_getClass("NSString"),
                        sel_getUid("alloc")),
                    sel_getUid("initWithUTF8String:"),
                    text.c_str());
                send(pb, sel_getUid("setString:forType:"),
                    str,
                    send(objc_getClass("NSPasteboard"),
                        sel_getUid("typeString")));
#elif defined(__linux__)
                QGuiApplication::clipboard()->setText(
                    QString::fromStdString(text));
#elif defined(_WIN32)
                if (OpenClipboard(nullptr))
                {
                    EmptyClipboard();
                    auto h = GlobalAlloc(GMEM_MOVEABLE,
                                         text.size() + 1);
                    if (h)
                    {
                        memcpy(GlobalLock(h), text.c_str(),
                               text.size() + 1);
                        GlobalUnlock(h);
                        SetClipboardData(CF_TEXT, h);
                    }
                    CloseClipboard();
                }
#endif
            });

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

                if (is_allowed(*parsed))
                    wv.set_url(url);
                else
                    toast(wv, "This website is external, open it in your "
                              "navigator\n" + url);
            });

            wv.expose("log", [](const std::string &msg)
            {
                std::println(std::cerr, "  [js] {}\n", msg);
            });

            // -- keyboard shortcuts --

            window->on<saucer::window::event::closed>({{
                .func = [&wv, data_dir]
                {
#if defined(__linux__)
                    save_zoom(data_dir, wv.native<true>().webview->page()->zoomFactor());
#elif defined(_WIN32)
                    double zoom;
                    wv.native<true>().controller->get_ZoomFactor(&zoom);
                    save_zoom(data_dir, static_cast<float>(zoom));
#endif
                },
                .clearable = false,
            }});

#if defined(__linux__)
            {
                auto *main_win = window->native<true>().window;

                auto *sq = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_Q), main_win);
                QObject::connect(sq, &QShortcut::activated, [&wv, app, data_dir]()
                {
                    save_zoom(data_dir, wv.native<true>().webview->page()->zoomFactor());
                    app->quit();
                });

                auto *sf = new QShortcut(QKeySequence(Qt::CTRL | Qt::Key_F), main_win);
                QObject::connect(sf, &QShortcut::activated, [&wv]()
                {
                    static_cast<saucer::webview &>(wv).execute(
                        "window.inb4docUI?.openFind?.()");
                });

                auto *f3 = new QShortcut(QKeySequence(Qt::Key_F3), main_win);
                QObject::connect(f3, &QShortcut::activated, [&wv]()
                {
                    static_cast<saucer::webview &>(wv).execute(
                        "window.inb4docUI?.findNext?.()");
                });

                auto *sf3 = new QShortcut(QKeySequence(Qt::SHIFT | Qt::Key_F3), main_win);
                QObject::connect(sf3, &QShortcut::activated, [&wv]()
                {
                    static_cast<saucer::webview &>(wv).execute(
                        "window.inb4docUI?.findPrev?.()");
                });
            }
#elif defined(_WIN32)
            {
                g_data_dir = data_dir;
                auto hwnd = window->native<true>().hwnd;

                SetPropW(hwnd, L"PD_APP", reinterpret_cast<HANDLE>(app));
                SetPropW(hwnd, L"PD_WV", reinterpret_cast<HANDLE>(&wv));

                auto orig = reinterpret_cast<WNDPROC>(
                    GetWindowLongPtrW(hwnd, GWLP_WNDPROC));
                SetPropW(hwnd, L"PD_ORIG", reinterpret_cast<HANDLE>(orig));

                SetWindowLongPtrW(hwnd, GWLP_WNDPROC,
                    reinterpret_cast<LONG_PTR>(HotkeyProc));

                RegisterHotKey(hwnd, 1, MOD_CONTROL | MOD_NOREPEAT, 'Q');
                RegisterHotKey(hwnd, 2, MOD_CONTROL | MOD_NOREPEAT, 'F');
                RegisterHotKey(hwnd, 3, MOD_NOREPEAT, VK_F3);
                RegisterHotKey(hwnd, 4, MOD_SHIFT | MOD_NOREPEAT, VK_F3);
            }
#elif defined(__APPLE__)
            setup_mac_shortcuts(app, &static_cast<saucer::webview &>(wv));
#endif

            // -- launch --

            if (safe->debug)
                std::println(std::cerr, "  [debug] initial URL: {}\n",
                             safe->editor_url);

            wv.set_url(safe->editor_url);
            window->show();

            co_await app->finish();

            wv.remove_scheme("app");
        }
    );
}
