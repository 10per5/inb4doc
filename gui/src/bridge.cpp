#include "bridge.h"
#include "config.h"
#include "platform.h"
#include "search.h"
#include "images.h"
#include "json.h"
#include "security.h"
#include <saucer/smartview.hpp>
#include <saucer/scheme.hpp>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <iterator>
#include <algorithm>
#include <cstdint>

namespace fs = std::filesystem;

namespace
{
    std::string ok_json()
    {
        return "{\"ok\":true}";
    }

    std::string err_json(int status, const std::string &msg)
    {
        std::ostringstream out;
        out << "{\"ok\":false,\"status\":" << status
            << ",\"error\":\"" << json_escape(msg) << "\"}";
        return out.str();
    }

    std::string data_json(const std::string &data)
    {
        return "{\"ok\":true,\"data\":" + data + "}";
    }

    // Strip leading slashes and normalize like the scheme's URL path.
    std::string normalize_path(const std::string &raw)
    {
        std::string p = raw;
        while (!p.empty() && p[0] == '/')
            p = p.substr(1);
        return p;
    }

    // Extract the JSON payload out of a scheme::response built with
    // stash::from_str (used by handle_search / save_uploaded_image).
    std::string response_data(const saucer::scheme::response &res)
    {
        if (res.status != 200)
            return {};
        return std::string(res.data.str());
    }

    std::string base64_decode(const std::string &in)
    {
        static const std::string b64 =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string out;
        int val = 0;
        int bits = -8;
        for (unsigned char c : in)
        {
            if (c == '=')
                break;
            auto pos = b64.find(static_cast<char>(c));
            if (pos == std::string::npos)
                continue;
            val = (val << 6) + static_cast<int>(pos);
            bits += 6;
            if (bits >= 0)
            {
                out.push_back(static_cast<char>((val >> bits) & 0xFF));
                bits -= 8;
            }
        }
        return out;
    }
} // namespace

void register_bridge(saucer::smartview &wv, const std::shared_ptr<config> &cfg)
{
    // PUT /content/{path}.md — the GUI save hang was here.
    wv.expose("writeFile", [cfg](const std::string &path, const std::string &content)
    {
        auto p = normalize_path(path);
        auto fpath = fs::path(cfg->content_root) / p;
        if (fpath.extension().empty())
            fpath += ".md";
        if (fpath.extension() != ".md")
            return err_json(404, "Not Found");

        // Refuse paths whose parent segments end in `.md` (would create a
        // directory literally named `foo.md`).
        for (const auto &seg : fs::path(p).parent_path())
            if (seg.string().ends_with(".md"))
                return err_json(400, "Invalid path");

        fs::path resolved;
        if (!security::within_base(fpath, cfg->content_root, resolved))
            return err_json(403, "Forbidden");

        if (content.size() > cfg->max_content_size)
            return err_json(413, "Content too large");

        std::error_code mkdir_ec;
        fs::create_directories(resolved.parent_path(), mkdir_ec);
        if (mkdir_ec)
            return err_json(500, "Write failed");

        std::ofstream f(resolved, std::ios::binary);
        if (!f)
            return err_json(500, "Write failed");
        f << content;
        f.close();

        remove_orphaned_images(*cfg, fs::path(p).parent_path().string());
        security::deletability::instance().clear(cfg->content_root);
        return ok_json();
    });

    // POST /api/delete — bulk delete.
    wv.expose("deleteFiles", [cfg](const std::vector<std::string> &raw_paths)
    {
        if (raw_paths.empty())
            return err_json(400, "Missing paths");

        std::vector<std::string> doc_dirs;
        for (auto &raw : raw_paths)
        {
            auto p = normalize_path(raw);
            if (p.empty())
                continue;
            if (!p.ends_with(".md"))
                p += ".md";

            fs::path resolved;
            if (!security::within_base(fs::path(cfg->content_root) / p, cfg->content_root, resolved))
                continue;

            fs::path parent_to_prune;
            std::error_code del_ec;
            if (fs::is_directory(resolved, del_ec))
            {
                // Never wipe a folder that holds non-content files.
                if (!security::dir_deletable(cfg->content_root, resolved))
                    return err_json(403, "Folder contains non-content files");
                fs::remove_all(resolved, del_ec);
                parent_to_prune = resolved.parent_path();
            }
            else if (fs::exists(resolved, del_ec))
            {
                fs::remove(resolved, del_ec);
                parent_to_prune = resolved.parent_path();
            }
            else
            {
                // `/content/docs.md` for an existing folder `docs` -> delete the dir.
                auto dir_target = resolved;
                dir_target = fs::path(dir_target.string().substr(0, dir_target.string().size() - 3));
                fs::path dir_resolved;
                if (!security::within_base(dir_target, cfg->content_root, dir_resolved) ||
                    !fs::is_directory(dir_resolved, del_ec))
                    continue;
                if (!security::dir_deletable(cfg->content_root, dir_resolved))
                    return err_json(403, "Folder contains non-content files");
                fs::remove_all(dir_resolved, del_ec);
                parent_to_prune = dir_resolved.parent_path();
            }

            auto doc_dir = fs::path(p).parent_path().string();
            if (!doc_dir.empty())
                doc_dirs.push_back(doc_dir);

            while (parent_to_prune != fs::path(cfg->content_root))
            {
                std::error_code pec;
                if (!fs::is_empty(parent_to_prune, pec) || pec) break;
                fs::remove(parent_to_prune, pec);
                if (pec) break;
                parent_to_prune = parent_to_prune.parent_path();
            }
        }

        for (auto &dir : doc_dirs)
            remove_orphaned_images(*cfg, dir);

        security::deletability::instance().clear(cfg->content_root);
        return ok_json();
    });

    // POST /api/move — rename / move a file.
    wv.expose("moveFile", [cfg](const std::string &raw_from, const std::string &raw_to)
    {
        auto from = normalize_path(raw_from);
        auto to = normalize_path(raw_to);

        if (from.empty() || to.empty())
            return err_json(400, "Missing from/to");

        if (!from.ends_with(".md") || !to.ends_with(".md"))
            return err_json(400, "Invalid path");

        fs::path src, dst;
        if (!security::within_base(fs::path(cfg->content_root) / from, cfg->content_root, src) ||
            !security::within_base(fs::path(cfg->content_root) / to, cfg->content_root, dst))
            return err_json(403, "Invalid path");

        if (src == dst)
            return ok_json();

        std::error_code exist_ec;
        if (!fs::exists(src, exist_ec))
            return err_json(404, "Source not found");

        // Never silently overwrite an existing destination.
        std::error_code dst_exist_ec;
        if (fs::exists(dst, dst_exist_ec) && !dst_exist_ec)
            return err_json(409, "Destination exists");

        std::error_code mkdir_ec;
        fs::create_directories(dst.parent_path(), mkdir_ec);
        if (mkdir_ec)
            return err_json(500, "Write failed");

        std::error_code rename_ec;
        fs::rename(src, dst, rename_ec);
        if (rename_ec)
        {
            // Cross-device fallback: copy + delete (handles EXDEV).
            std::ifstream src_f(src, std::ios::binary);
            if (!src_f)
                return err_json(500, "Read failed");
            std::string content((std::istreambuf_iterator<char>(src_f)),
                                std::istreambuf_iterator<char>());
            src_f.close();
            std::ofstream dst_f(dst, std::ios::binary);
            if (!dst_f)
                return err_json(500, "Write failed");
            dst_f << content;
            dst_f.close();
            std::error_code rm_ec;
            fs::remove(src, rm_ec);
        }

        auto parent = src.parent_path();
        while (parent != fs::path(cfg->content_root))
        {
            std::error_code pec;
            if (!fs::is_empty(parent, pec) || pec) break;
            fs::remove(parent, pec);
            if (pec) break;
            parent = parent.parent_path();
        }

        security::deletability::instance().clear(cfg->content_root);
        return ok_json();
    });

    // POST /api/search — reuse the scheme's search handler.
    wv.expose("search", [cfg](const std::string &query)
    {
        std::string body = "{\"query\":\"" + json_escape(query) + "\"}";
        auto res = handle_search(*cfg, body);
        auto json = response_data(res);
        if (json.empty())
            return err_json(500, "Search failed");
        return data_json(json);
    });

    // POST /api/upload — receive base64 file bytes, save via shared handler.
    wv.expose("uploadImage", [cfg](const std::string &name,
                                   const std::string &dir,
                                   const std::string &data_b64)
    {
        auto content = base64_decode(data_b64);
        auto res = save_uploaded_image(*cfg, name, dir, content);
        auto json = response_data(res);
        if (json.empty())
            return err_json(res.status, "Upload failed");
        return data_json(json);
    });

    // ── Part C.1 W3 updater storage bridge ──
    //
    // The fetch updater (editor/src/services/updater.ts) downloads the live
    // editor into the writable data dir through these. `path` is the
    // app://-relative key the scheme serves (e.g. "assets/node_imports-abc.js");
    // updaterPut receives base64 bytes. All writes stay inside
    // default_data_dir()/editor via within_base.
    wv.expose("updaterPut", [](const std::string &path, const std::string &data_b64)
    {
        std::filesystem::path dir = default_editor_data_dir();
        if (dir.empty())
            return err_json(500, "No data directory");
        auto p = normalize_path(path);
        if (p.empty())
            return err_json(400, "Invalid path");
        fs::path resolved;
        if (!security::within_base(dir / p, dir, resolved))
            return err_json(403, "Forbidden");
        std::error_code mkdir_ec;
        fs::create_directories(resolved.parent_path(), mkdir_ec);
        if (mkdir_ec)
            return err_json(500, "Write failed");
        auto content = base64_decode(data_b64);
        std::ofstream f(resolved, std::ios::binary);
        if (!f)
            return err_json(500, "Write failed");
        f.write(content.data(), static_cast<std::streamsize>(content.size()));
        f.close();
        return ok_json();
    });

    wv.expose("updaterSizeOf", [](const std::string &path) -> std::string
    {
        std::filesystem::path dir = default_editor_data_dir();
        if (dir.empty())
            return data_json("0");
        fs::path resolved;
        if (!security::within_base(dir / normalize_path(path), dir, resolved))
            return data_json("0");
        std::error_code ec;
        auto sz = fs::file_size(resolved, ec);
        return data_json(ec ? "0" : std::to_string(sz));
    });

    wv.expose("updaterHas", [](const std::string &path) -> std::string
    {
        std::filesystem::path dir = default_editor_data_dir();
        if (dir.empty())
            return data_json("false");
        fs::path resolved;
        if (!security::within_base(dir / normalize_path(path), dir, resolved))
            return data_json("false");
        std::error_code ec;
        return data_json(fs::is_regular_file(resolved, ec) ? "true" : "false");
    });

    // Cold changes (entry/shell) can't be swapped — the updater reloads the
    // page after the transfer completes so it boots from the data-dir copy.
    wv.expose("reload", [&wv]()
    {
        static_cast<saucer::webview &>(wv).execute("location.reload()");
        return ok_json();
    });
}
