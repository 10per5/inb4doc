#include "scheme.h"
#include "config.h"
#include "gitignore.h"
#include "images.h"
#include "json.h"
#include "platform.h"
#include "security.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <print>
#include <filesystem>
#include <deque>
#include <vector>
#include <unordered_set>
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
                       std::unordered_set<std::string> &out_dirs,
                       std::unordered_set<std::string> &out_undeletable,
                       const std::string &rel_prefix = "")
{
    struct dir_entry { std::string name; std::string rel_path; int weight; };
    struct file_entry { std::string name; std::string rel_path; int weight; };

    // Dirs whose subtree is not content-only (contains stray non-md /
    // non-image files). Any ancestor of a flagged dir is also non-deletable.
    std::unordered_set<std::string> non_content;

    // Hard cap on directory entries scanned, so tree building exits early
    // instead of oversearching huge content trees.
    const std::size_t kMaxScanned = 10000;
    std::size_t scanned = 0;

    // Breadth-first walk: directories at lower depth are visited before
    // nested ones, so shallow files are prioritized over deeply nested ones.
    struct pending_dir
    {
        fs::path dir;
        std::string rel_prefix;
        std::vector<GitIgnorePattern> gi;
        int cur_depth;
    };
    std::deque<pending_dir> queue;
    queue.push_back({dir, rel_prefix, gi_patterns, current_depth});

    while (!queue.empty() && scanned < kMaxScanned)
    {
        auto pd = queue.front();
        queue.pop_front();

        if (!pd.rel_prefix.empty())
            out_dirs.insert(pd.rel_prefix);

        bool recurse = depth == 0 || pd.cur_depth < depth;

        std::vector<dir_entry> dirs;
        std::vector<file_entry> files;

        std::error_code ec;
        fs::directory_iterator it(pd.dir, ec), end;
        for (; !ec && it != end; it.increment(ec))
        {
            if (scanned >= kMaxScanned) break;
            scanned++;

            auto name = it->path().filename().string();
            auto rel_path = pd.rel_prefix.empty() ? name : pd.rel_prefix + "/" + name;

            if (name[0] == '.')
                continue;

            std::error_code status_ec;
            auto estatus = it->status(status_ec);
            if (status_ec) continue;
            auto is_dir = fs::is_directory(estatus);

            // Stray files (including gitignored ones) make this dir — and
            // every ancestor that would delete it — non-deletable.
            if (!is_dir && !name.ends_with(".md") &&
                !security::is_image_file(it->path()))
                non_content.insert(pd.rel_prefix);

            if (!no_ignore && is_ignored(rel_path, is_dir, pd.gi))
            {
                // Ignored dirs are never scanned, so their contents can't be
                // verified as content-only — keep the parent conservative.
                if (is_dir)
                    non_content.insert(pd.rel_prefix);
                continue;
            }

            if (is_dir)
            {
                if (!recurse)
                    continue;
                auto child_gi = load_gitignore(it->path());
                std::vector<GitIgnorePattern> merged = pd.gi;
                merged.insert(merged.end(), child_gi.begin(), child_gi.end());
                queue.push_back({it->path(), rel_path, merged, pd.cur_depth + 1});

                // Collect folder weight from _index.md if present
                int folder_weight = -1;
                auto index_file = it->path() / "_index.md";
                std::error_code fec;
                if (fs::exists(index_file, fec))
                    folder_weight = extract_weight(index_file);

                dirs.push_back({name, rel_path, folder_weight});
            }
            else if (name.ends_with(".md"))
            {
                auto w = extract_weight(it->path());
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
            out_paths << "    \"" << json_escape(page_path) << "\",\n";
        }

        // Emit folder weights for directories with _index.md
        for (auto &d : dirs)
        {
            if (d.weight >= 0)
                out_folder_weights << "    \"" << json_escape(d.rel_path)
                                   << "\": " << d.weight << ",\n";
        }

        // Sort and emit children for this prefix
        std::sort(dirs.begin(), dirs.end(), [](auto &a, auto &b) { return a.name < b.name; });
        std::sort(files.begin(), files.end(), [](auto &a, auto &b) { return a.name < b.name; });

        if (!dirs.empty() || !files.empty())
        {
            out_children << "    \"" << json_escape(pd.rel_prefix) << "\": [\n";
            bool first = true;
            for (auto &d : dirs)
            {
                if (!first) out_children << ",\n";
                first = false;
                int w = d.weight >= 0 ? d.weight : 0;
                out_children << "      {\"name\": \"" << json_escape(d.name)
                             << "\", \"path\": \"" << json_escape(d.rel_path)
                             << "\", \"isDir\": true, \"weight\": " << w << "}";
            }
            for (auto &f : files)
            {
                if (!first) out_children << ",\n";
                first = false;
                auto page_path = f.rel_path;
                if (page_path.size() > 3)
                    page_path = page_path.substr(0, page_path.size() - 3);
                int w = f.weight >= 0 ? f.weight : 0;
                out_children << "      {\"name\": \"" << json_escape(f.name)
                             << "\", \"path\": \"" << json_escape(page_path)
                             << "\", \"isDir\": false, \"weight\": " << w << "}";
            }
            out_children << "\n    ],\n";
        }
    }

    // Fold: any ancestor of a non-content dir is also non-deletable.
    for (const auto &rel : non_content)
    {
        std::string cur = rel;
        while (!cur.empty())
        {
            out_undeletable.insert(cur);
            auto slash = cur.rfind('/');
            if (slash == std::string::npos) break;
            cur = cur.substr(0, slash);
        }
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
        std::error_code exist_ec;
        if (!fs::exists(cfg.content_root, exist_ec))
        {
            security::deletability::instance().clear(cfg.content_root);
            return {.data = saucer::stash::from_str("{}"),
                    .mime = "application/json", .status = 200};
        }

        auto gi_patterns = cfg.no_ignore
            ? std::vector<GitIgnorePattern>{}
            : load_gitignore(cfg.content_root);

        std::ostringstream out_paths;
        std::ostringstream out_children;
        std::ostringstream out_folder_weights;
        std::unordered_set<std::string> visited_dirs;
        std::unordered_set<std::string> undeletable;
        build_tree(cfg.content_root, out_paths, out_children, out_folder_weights,
                   gi_patterns, cfg.depth, 0, cfg.no_ignore,
                   visited_dirs, undeletable);

        // Record the scanned dirs so delete paths decide O(1): clean dirs are
        // deletable, flagged dirs are refused, unscanned dirs fall back to a
        // live subtree scan.
        std::unordered_set<std::string> clean;
        for (const auto &d : visited_dirs)
            if (!undeletable.contains(d))
                clean.insert(d);
        security::deletability::instance().update(
            cfg.content_root, std::move(undeletable), std::move(clean));

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
        if (!security::within_base(fpath, cfg.content_root, resolved))
            return {.data = saucer::stash::from_str("Forbidden"),
                    .mime = "text/plain", .status = 403};

        if (method == "GET")
        {
            std::error_code stat_ec;
            if (!fs::exists(resolved, stat_ec) || fs::is_directory(resolved, stat_ec))
                return {.data = saucer::stash::from_str(""),
                        .mime = "text/markdown", .status = 404};

            return {.data = stash_from_file(resolved.string()),
                    .mime = "text/markdown; charset=utf-8", .status = 200};
        }

        if (method == "HEAD")
        {
            std::error_code stat_ec;
            if (!fs::exists(resolved, stat_ec) || !fs::is_regular_file(resolved, stat_ec))
                return {.data = saucer::stash::from_str(""),
                        .mime = "text/markdown", .status = 404};

            return {.data = saucer::stash::from_str(""),
                    .mime = "text/markdown; charset=utf-8", .status = 200};
        }

        if (method == "DELETE")
        {
            std::error_code del_ec;
            if (!fs::exists(resolved, del_ec))
                return {.data = saucer::stash::from_str("Not found"),
                        .mime = "text/plain", .status = 404};

            if (fs::is_directory(resolved, del_ec))
            {
                // Never wipe a folder that holds non-content files.
                if (!security::dir_deletable(cfg.content_root, resolved))
                    return {.data = saucer::stash::from_str(
                                    "Folder contains non-content files"),
                            .mime = "text/plain", .status = 403};
                fs::remove_all(resolved, del_ec);
            }
            else
                fs::remove(resolved, del_ec);
            security::deletability::instance().clear(cfg.content_root);

            // Remove orphaned images after document delete
            auto doc_dir = fs::path(spath).parent_path().string();
            remove_orphaned_images(cfg, doc_dir);

            auto parent = resolved.parent_path();
            while (parent != fs::path(cfg.content_root))
            {
                std::error_code pec;
                if (!fs::is_empty(parent, pec) || pec) break;
                fs::remove(parent, pec);
                if (pec) break;
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

    // -- Static files (Part C.1 W3) --
    //
    // The read-only install (cfg.editor_root, the thin shell) ships only the
    // boot set; the fetch updater downloads the live editor into the writable
    // data-dir copy (default_editor_data_dir) and this handler serves that
    // copy FIRST on every boot, so a populated data dir wins over the shipped
    // shell — updates take effect without touching the install. Both roots are
    // within_base-guarded.
    const auto resolve_root = [&](const fs::path &root, const std::string &p)
    {
        if (p.empty() || p == "index.html")
            return root / "index.html";
        return root / p;
    };

    fs::path file_resolved;
    auto updater_root = default_editor_data_dir();
    if (!updater_root.empty())
    {
        auto target = resolve_root(fs::path(updater_root), path);
        std::error_code within_ec;
        if (security::within_base(target, fs::path(updater_root), file_resolved) &&
            fs::is_regular_file(file_resolved, within_ec) && !within_ec)
        {
            return {.data = stash_from_file(file_resolved.string()),
                    .mime = guess_mime(file_resolved.string()), .status = 200};
        }
    }

    auto file_target = resolve_root(fs::path(cfg.editor_root), path);
    if (!security::within_base(file_target, cfg.editor_root, file_resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    std::error_code stat_ec;
    if (!fs::exists(file_resolved, stat_ec) || !fs::is_regular_file(file_resolved, stat_ec))
    {
        // Farm's dynamic chunk loader eval's whatever body it receives. A thin
        // shell ships without the lazy editor chunks, so their first-run fetch
        // misses here; a text/plain body ("Not Found") then parses as JS and
        // spams one `Unexpected identifier 'Found'` SyntaxError per chunk. An
        // empty body is valid JS — the loader fails cleanly with "module not
        // registered" and the boot's updater-wait path handles it.
        auto ext = file_resolved.extension().string();
        if (ext == ".js" || ext == ".mjs")
            return {.data = saucer::stash::from_str(""), .mime = "application/javascript", .status = 404};
        return {.data = saucer::stash::from_str("Not Found"),
                .mime = "text/plain", .status = 404};
    }

    return {.data = stash_from_file(file_resolved.string()),
            .mime = guess_mime(file_resolved.string()), .status = 200};
}
