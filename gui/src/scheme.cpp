#include "scheme.h"
#include "config.h"
#include "gitignore.h"
#include "search.h"
#include "images.h"
#include "json.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <print>
#include <filesystem>
#include <vector>
#include <algorithm>
#include <string>
namespace fs = std::filesystem;

static std::string extract_query(const std::string &url)
{
    auto qm = url.find('?');
    if (qm == std::string::npos)
        return {};
    return url.substr(qm + 1);
}

// ── ─────────────────────────────────────────────────────────────────────

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
    if (ext == ".gif")
        return "image/gif";
    if (ext == ".webp")
        return "image/webp";
    if (ext == ".bmp")
        return "image/bmp";
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

// ── ─────────────────────────────────────────────────────────────────────

static int extract_weight(const fs::path &file)
{
    std::ifstream f(file);
    if (!f)
        return -1;
    std::string line;
    if (!std::getline(f, line) || line != "---")
        return -1;
    while (std::getline(f, line))
    {
        if (line == "---")
            break;
        if (line.starts_with("weight:"))
        {
            try
            {
                auto val = line.substr(7);
                val.erase(0, val.find_first_not_of(" \t"));
                return std::stoi(val);
            }
            catch (...) { return -1; }
        }
    }
    return -1;
}

static void build_tree(const fs::path &dir, std::ostringstream &out_paths,
                       std::ostringstream &out_children,
                       std::ostringstream &out_folder_weights,
                       const std::vector<GitIgnorePattern> &gi_patterns,
                       int depth, int current_depth,
                       bool no_ignore,
                       const std::string &rel_prefix = "")
{
    struct dir_entry { std::string name; std::string rel_path; int weight; };
    struct file_entry { std::string name; std::string rel_path; int weight; };
    std::vector<dir_entry> dirs;
    std::vector<file_entry> files;
    bool recurse = depth == 0 || current_depth < depth;

    std::error_code ec;
    for (auto &e : fs::directory_iterator(dir, ec))
    {
        auto name = e.path().filename().string();
        auto rel_path = rel_prefix.empty() ? name : rel_prefix + "/" + name;

        if (name[0] == '.')
            continue;

        auto estatus = e.status(ec);
        if (ec) continue;
        auto is_dir = fs::is_directory(estatus);

        if (!no_ignore && is_ignored(rel_path, is_dir, gi_patterns))
            continue;

        if (is_dir)
        {
            if (!recurse)
                continue;
            auto child_gi = load_gitignore(e.path());
            std::vector<GitIgnorePattern> merged = gi_patterns;
            merged.insert(merged.end(), child_gi.begin(), child_gi.end());
            build_tree(e.path(), out_paths, out_children, out_folder_weights,
                       merged, depth, current_depth + 1, no_ignore, rel_path);

            // Collect folder weight from _index.md if present
            int folder_weight = -1;
            auto index_file = e.path() / "_index.md";
            if (fs::exists(index_file))
                folder_weight = extract_weight(index_file);

            dirs.push_back({name, rel_path, folder_weight});
        }
        else if (name.ends_with(".md"))
        {
            auto w = extract_weight(e.path());
            files.push_back({name, rel_path, w});
        }
    }

    // Emit paths for files in this directory
    for (auto &f : files)
    {
        auto page_path = f.rel_path;
        // Strip .md extension
        if (page_path.size() > 3)
            page_path = page_path.substr(0, page_path.size() - 3);
        out_paths << "    \"" << page_path << "\",\n";
    }

    // Emit folder weights for directories with _index.md
    for (auto &d : dirs)
    {
        if (d.weight >= 0)
            out_folder_weights << "    \"" << d.rel_path << "\": " << d.weight << ",\n";
    }

    // Sort and emit children for this prefix
    std::sort(dirs.begin(), dirs.end(), [](auto &a, auto &b) { return a.name < b.name; });
    std::sort(files.begin(), files.end(), [](auto &a, auto &b) { return a.name < b.name; });

    if (!dirs.empty() || !files.empty())
    {
        out_children << "    \"" << rel_prefix << "\": [\n";
        bool first = true;
        for (auto &d : dirs)
        {
            if (!first) out_children << ",\n";
            first = false;
            int w = d.weight >= 0 ? d.weight : 1000000;
            out_children << "      {\"name\": \"" << d.name
                         << "\", \"path\": \"" << d.rel_path
                         << "\", \"isDir\": true, \"weight\": " << w << "}";
        }
        for (auto &f : files)
        {
            if (!first) out_children << ",\n";
            first = false;
            auto page_path = f.rel_path;
            if (page_path.size() > 3)
                page_path = page_path.substr(0, page_path.size() - 3);
            int w = f.weight >= 0 ? f.weight : 1000000;
            out_children << "      {\"name\": \"" << f.name
                         << "\", \"path\": \"" << page_path
                         << "\", \"isDir\": false, \"weight\": " << w << "}";
        }
        out_children << "\n    ],\n";
    }
}

// ── ─────────────────────────────────────────────────────────────────────

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

        auto gi_patterns = cfg.no_ignore
            ? std::vector<GitIgnorePattern>{}
            : load_gitignore(cfg.content_root);

        std::ostringstream out_paths;
        std::ostringstream out_children;
        std::ostringstream out_folder_weights;
        build_tree(cfg.content_root, out_paths, out_children, out_folder_weights,
                   gi_patterns, cfg.depth, 0, cfg.no_ignore);

        // Strip trailing commas and wrap in proper JSON containers
        auto strip_trail = [](std::ostringstream &ss) -> std::string {
            auto s = ss.str();
            // Remove trailing comma (last comma in the string)
            auto pos = s.rfind(',');
            if (pos != std::string::npos)
                s.erase(pos, 1);
            return s;
        };

        auto paths_str = strip_trail(out_paths);
        auto children_str = strip_trail(out_children);
        auto fw_str = strip_trail(out_folder_weights);

        // Build the flat JSON: { "paths": [...], "children": {...}, "folderWeights": {...} }
        std::ostringstream result;
        result << "{\"paths\": [" << paths_str << "]"
               << ", \"children\": {" << children_str << "}"
               << ", \"folderWeights\": {" << fw_str << "}}\n";

        return {.data = saucer::stash::from_str(result.str()),
                .mime = "application/json", .status = 200};
    }

    // -- API: move --

    if (path == "api/move" && method == "POST")
    {
        std::string body(req.content().str());

        auto from = json_string_value(body, "from");
        auto to = json_string_value(body, "to");

        if (from.empty() || to.empty())
            return {.data = saucer::stash::from_str("Missing from/to"),
                    .mime = "text/plain", .status = 400};

        if (from[0] == '/')
            from = from.substr(1);
        if (to[0] == '/')
            to = to.substr(1);

        if (!from.ends_with(".md") || !to.ends_with(".md"))
            return {.data = saucer::stash::from_str("Invalid path"),
                    .mime = "text/plain", .status = 400};

        fs::path src, dst;
        if (!resolve_within(fs::path(cfg.content_root) / from, cfg.content_root, src) ||
            !resolve_within(fs::path(cfg.content_root) / to, cfg.content_root, dst))
            return {.data = saucer::stash::from_str("Invalid path"),
                    .mime = "text/plain", .status = 403};

        if (!fs::exists(src))
            return {.data = saucer::stash::from_str("Source not found"),
                    .mime = "text/plain", .status = 404};

        fs::create_directories(dst.parent_path());

        std::error_code rename_ec;
        fs::rename(src, dst, rename_ec);
        if (rename_ec)
        {
            // Cross-device fallback: copy + delete (handles EXDEV)
            std::ifstream src_f(src, std::ios::binary);
            if (!src_f)
                return {.data = saucer::stash::from_str("Read failed"),
                        .mime = "text/plain", .status = 500};
            std::string content((std::istreambuf_iterator<char>(src_f)),
                                std::istreambuf_iterator<char>());
            src_f.close();
            std::ofstream dst_f(dst, std::ios::binary);
            if (!dst_f)
                return {.data = saucer::stash::from_str("Write failed"),
                        .mime = "text/plain", .status = 500};
            dst_f << content;
            dst_f.close();
            fs::remove(src);
        }

        auto parent = src.parent_path();
        while (parent != fs::path(cfg.content_root) && fs::is_empty(parent))
        {
            fs::remove(parent);
            parent = parent.parent_path();
        }

        return {.data = saucer::stash::from_str("ok"),
                .mime = "text/plain", .status = 200};
    }

    // -- API: search --

    if (path == "api/search" && method == "POST")
    {
        return handle_search(cfg, req.content().str());
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

        // Auto-append .md if the path has no extension (matching Node.js behavior)
        if (fpath.extension().empty())
            fpath += ".md";

        if (fpath.extension() != ".md")
            return {.data = saucer::stash::from_str("Not Found"),
                    .mime = "text/plain", .status = 404};

        // Path traversal guard
        fs::path resolved;
        if (!resolve_within(fpath, cfg.content_root, resolved))
            return {.data = saucer::stash::from_str("Forbidden"),
                    .mime = "text/plain", .status = 403};

        if (method == "GET")
        {
            if (!fs::exists(resolved) || fs::is_directory(resolved))
                return {.data = saucer::stash::from_str(""),
                        .mime = "text/markdown", .status = 404};

            return {.data = stash_from_file(resolved.string()),
                    .mime = "text/markdown; charset=utf-8", .status = 200};
        }

        if (method == "HEAD")
        {
            if (!fs::exists(resolved) || !fs::is_regular_file(resolved))
                return {.data = saucer::stash::from_str(""),
                        .mime = "text/markdown", .status = 404};

            return {.data = saucer::stash::from_str(""),
                    .mime = "text/markdown; charset=utf-8", .status = 200};
        }

        if (method == "PUT")
        {
            std::string body(req.content().str());

            if (body.size() > cfg.max_content_size)
                return {.data = saucer::stash::from_str("Content too large"),
                        .mime = "text/plain", .status = 413};

            fs::create_directories(resolved.parent_path());
            std::ofstream f(resolved, std::ios::binary);
            if (!f)
                return {.data = saucer::stash::from_str("Write failed"),
                        .mime = "text/plain", .status = 500};
            f << body;
            f.close();

            // Remove orphaned images after document save
            auto doc_dir = fs::path(spath).parent_path().string();
            remove_orphaned_images(cfg, doc_dir);

            return {.data = saucer::stash::from_str("ok"),
                    .mime = "text/plain", .status = 200};
        }

        if (method == "DELETE")
        {
            if (!fs::exists(resolved))
                return {.data = saucer::stash::from_str("Not found"),
                        .mime = "text/plain", .status = 404};

            if (fs::is_directory(resolved))
                fs::remove_all(resolved);
            else
                fs::remove(resolved);

            // Remove orphaned images after document delete
            auto doc_dir = fs::path(spath).parent_path().string();
            remove_orphaned_images(cfg, doc_dir);

            auto parent = resolved.parent_path();
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

    // -- Image API: GET /uploads/{path} --

    const std::string uploads_prefix = "uploads/";
    if (path.size() > uploads_prefix.size() &&
        path.substr(0, uploads_prefix.size()) == uploads_prefix &&
        method == "GET")
    {
        auto rel_path = path.substr(uploads_prefix.size());
        auto qm = rel_path.find('?');
        if (qm != std::string::npos)
            rel_path = rel_path.substr(0, qm);
        return handle_serve_image(cfg, rel_path);
    }

    // -- Image API: POST /api/upload --

    if (path == "api/upload" && method == "POST")
    {
        auto headers = req.headers();
        std::string body(req.content().str());
        return handle_upload_image(cfg, body, headers);
    }

    // -- Image API: GET /api/images --

    if (path == "api/images" && method == "GET")
    {
        auto qs = extract_query(req_url.string());
        return handle_list_images(cfg, qs);
    }

    // -- Image API: DELETE /api/images/{name} --

    const std::string images_api_prefix = "api/images/";
    if (path.size() > images_api_prefix.size() &&
        path.substr(0, images_api_prefix.size()) == images_api_prefix &&
        method == "DELETE")
    {
        auto name = path.substr(images_api_prefix.size());
        name = url_decode(name);
        auto qs = extract_query(req_url.string());
        return handle_delete_image(cfg, name, qs);
    }

    // -- Static files --

    fs::path file_target;
    if (path.empty() || path == "index.html")
        file_target = fs::path(cfg.editor_root) / "index.html";
    else
        file_target = fs::path(cfg.editor_root) / path;

    fs::path file_resolved;
    if (!resolve_within(file_target, cfg.editor_root, file_resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    if (!fs::exists(file_resolved) || !fs::is_regular_file(file_resolved))
        return {.data = saucer::stash::from_str("Not Found"),
                .mime = "text/plain", .status = 404};

    return {.data = stash_from_file(file_resolved.string()),
            .mime = guess_mime(file_resolved.string()), .status = 200};
}
