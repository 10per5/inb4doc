#include "scheme.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <print>
#include <filesystem>
#include <vector>
#include <algorithm>
namespace fs = std::filesystem;

static saucer::stash stash_from_file(const std::string &path)
{
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f)
        return saucer::stash::empty();
    auto sz = f.tellg();
    if (sz <= 0)
        return saucer::stash::empty();
    f.seekg(0);
    std::string content(static_cast<std::size_t>(sz), '\0');
    f.read(content.data(), sz);
    return saucer::stash::from_str(content);
}

static std::string guess_mime(const std::string &path)
{
    auto dot = path.rfind('.');
    if (dot == std::string::npos)
        return "application/octet-stream";
    auto ext = path.substr(dot);

    if (ext == ".html" || ext == ".htm")
        return "text/html";
    if (ext == ".js")
        return "application/javascript";
    if (ext == ".css")
        return "text/css";
    if (ext == ".json")
        return "application/json";
    if (ext == ".md")
        return "text/markdown";
    if (ext == ".png")
        return "image/png";
    if (ext == ".jpg" || ext == ".jpeg")
        return "image/jpeg";
    if (ext == ".svg")
        return "image/svg+xml";
    if (ext == ".ico")
        return "image/x-icon";
    if (ext == ".woff2")
        return "font/woff2";
    if (ext == ".woff")
        return "font/woff";
    if (ext == ".ttf")
        return "font/ttf";
    if (ext == ".map")
        return "application/json";
    return "application/octet-stream";
}

static void build_tree(const fs::path &dir, std::ostringstream &out,
                       const std::string &prefix)
{
    std::vector<fs::path> entries;
    for (auto &e : fs::directory_iterator(dir))
        entries.push_back(e.path());
    std::sort(entries.begin(), entries.end());

    bool first = true;
    for (auto &p : entries)
    {
        auto name = p.filename().string();

        if (!first)
            out << ",\n";
        first = false;

        out << prefix << "  ";

        if (fs::is_directory(p))
        {
            out << "\"" << name << "\": {\n";
            build_tree(p, out, prefix + "  ");
            out << "\n" << prefix << "  }";
        }
        else
            out << "\"" << name << "\": null";
    }
}

saucer::scheme::response handle_app_request(
    const config &cfg,
    const saucer::scheme::request &req)
{
    auto method = req.method();
    auto req_url = req.url();

    std::string path = req_url.path().string();
    if (!path.empty() && path[0] == '/')
        path = path.substr(1);

    if (path == ".")
        path.clear();

    if (cfg.debug)
        std::println(std::cerr, "  [debug] scheme: method={}, url={}, "
                     "scheme={}, host={}, path={}\n",
                     method, req_url.string(), req_url.scheme(),
                     req_url.host().value_or("(null)"),
                     path.empty() ? "(root)" : path);

    // -- API: tree --

    if (path == "api/tree" && method == "GET")
    {
        if (!fs::exists(cfg.content_root))
            return {.data = saucer::stash::from_str("{}"),
                    .mime = "application/json", .status = 200};

        std::ostringstream out;
        out << "{\n";
        build_tree(cfg.content_root, out, "");
        out << "\n}\n";

        return {.data = saucer::stash::from_str(out.str()),
                .mime = "application/json", .status = 200};
    }

    // -- API: move --

    if (path == "api/move" && method == "POST")
    {
        std::string body(req.content().str());

        auto find_val = [&](const std::string &key) -> std::string
        {
            auto pos = body.find("\"" + key + "\"");
            if (pos == std::string::npos)
                return "";
            pos = body.find('"', pos + key.size() + 3);
            if (pos == std::string::npos)
                return "";
            auto end = body.find('"', pos + 1);
            if (end == std::string::npos)
                return "";
            return std::string(body.substr(pos + 1, end - pos - 1));
        };

        auto from = find_val("from");
        auto to = find_val("to");

        if (from.empty() || to.empty())
            return {.data = saucer::stash::from_str("Missing from/to"),
                    .mime = "text/plain", .status = 400};

        if (from[0] == '/')
            from = from.substr(1);
        if (to[0] == '/')
            to = to.substr(1);

        if (from.find("..") != std::string::npos ||
            to.find("..") != std::string::npos)
            return {.data = saucer::stash::from_str("Invalid path"),
                    .mime = "text/plain", .status = 400};

        auto src = fs::path(cfg.content_root) / from;
        auto dst = fs::path(cfg.content_root) / to;

        if (!fs::exists(src))
            return {.data = saucer::stash::from_str("Source not found"),
                    .mime = "text/plain", .status = 404};

        if (fs::exists(dst))
            return {.data = saucer::stash::from_str("Destination exists"),
                    .mime = "text/plain", .status = 409};

        fs::create_directories(dst.parent_path());
        fs::rename(src, dst);

        auto parent = src.parent_path();
        while (parent != fs::path(cfg.content_root) && fs::is_empty(parent))
        {
            fs::remove(parent);
            parent = parent.parent_path();
        }

        return {.data = saucer::stash::from_str("ok"),
                .mime = "text/plain", .status = 200};
    }

    // -- Content API: /content/{path} --

    const std::string content_prefix = "content/";
    if (path.size() > content_prefix.size() &&
        path.substr(0, content_prefix.size()) == content_prefix)
    {
        auto spath = path.substr(content_prefix.size());
        auto qm = spath.find('?');
        if (qm != std::string::npos)
            spath = spath.substr(0, qm);

        auto fpath = fs::path(cfg.content_root) / spath;

        if (method == "GET")
        {
            if (!fs::exists(fpath) || fs::is_directory(fpath))
                return {.data = saucer::stash::from_str(""),
                        .mime = "text/markdown", .status = 404};

            return {.data = stash_from_file(fpath.string()),
                    .mime = "text/markdown; charset=utf-8", .status = 200};
        }

        if (method == "HEAD")
        {
            if (!fs::exists(fpath) || !fs::is_regular_file(fpath))
                return {.data = saucer::stash::from_str(""),
                        .mime = "text/markdown", .status = 404};

            return {.data = saucer::stash::from_str(""),
                    .mime = "text/markdown; charset=utf-8", .status = 200};
        }

        if (method == "PUT")
        {
            std::string body(req.content().str());
            if (fpath.string().find("..") != std::string::npos)
                return {.data = saucer::stash::from_str("Invalid path"),
                        .mime = "text/plain", .status = 400};

            fs::create_directories(fpath.parent_path());
            std::ofstream f(fpath, std::ios::binary);
            if (!f)
                return {.data = saucer::stash::from_str("Write failed"),
                        .mime = "text/plain", .status = 500};
            f << body;
            f.close();

            return {.data = saucer::stash::from_str("ok"),
                    .mime = "text/plain", .status = 200};
        }

        if (method == "DELETE")
        {
            if (!fs::exists(fpath))
                return {.data = saucer::stash::from_str("Not found"),
                        .mime = "text/plain", .status = 404};

            fs::remove(fpath);

            auto parent = fpath.parent_path();
            while (parent != fs::path(cfg.content_root) && fs::is_empty(parent))
            {
                fs::remove(parent);
                parent = parent.parent_path();
            }

            return {.data = saucer::stash::from_str("ok"),
                    .mime = "text/plain", .status = 200};
        }

        return {.data = saucer::stash::from_str("Method not allowed"),
                .mime = "text/plain", .status = 405};
    }

    // -- Static files --

    std::string file_path;
    if (path.empty() || path == "index.html")
        file_path = cfg.editor_root + "/index.html";
    else
        file_path = cfg.editor_root + "/" + path;

    if (file_path.find("..") != std::string::npos)
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    if (!fs::exists(file_path) || !fs::is_regular_file(file_path))
        return {.data = saucer::stash::from_str("Not Found"),
                .mime = "text/plain", .status = 404};

    return {.data = stash_from_file(file_path),
            .mime = guess_mime(file_path), .status = 200};
}
