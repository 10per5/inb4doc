#include "images.h"
#include "config.h"
#include "security.h"
#include "json.h"
#include <fstream>
#include <sstream>
#include <filesystem>
#include <map>
#include <vector>
#include <algorithm>
#include <random>
#include <cctype>

namespace fs = std::filesystem;

// ── Helpers ──────────────────────────────────────────────────────────────

static std::string guess_image_mime(const std::string &path)
{
    auto dot = path.rfind('.');
    if (dot == std::string::npos) return "application/octet-stream";
    auto ext = path.substr(dot);
    for (auto &c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (ext == ".png")  return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".gif")  return "image/gif";
    if (ext == ".svg")  return "image/svg+xml";
    if (ext == ".webp") return "image/webp";
    if (ext == ".bmp")  return "image/bmp";
    if (ext == ".ico")  return "image/x-icon";
    return "application/octet-stream";
}

static saucer::stash stash_from_file(const std::string &path)
{
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return saucer::stash::empty();
    auto sz = f.tellg();
    if (sz <= 0) return saucer::stash::empty();
    f.seekg(0);
    std::string content(static_cast<std::size_t>(sz), '\0');
    f.read(content.data(), sz);
    return saucer::stash::from_str(content);
}

std::string url_decode(const std::string &s)
{
    std::string out;
    for (size_t i = 0; i < s.size(); i++)
    {
        if (s[i] == '%' && i + 2 < s.size())
        {
            auto hi = s[i + 1];
            auto lo = s[i + 2];
            auto hex = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            auto h = hex(hi);
            auto l = hex(lo);
            if (h >= 0 && l >= 0)
            {
                out += static_cast<char>((h << 4) | l);
                i += 2;
                continue;
            }
        }
        out += s[i];
    }
    return out;
}

// Parse query string: "dir=foo/bar&refs=true" -> map
static std::map<std::string, std::string> parse_query(const std::string &qs)
{
    std::map<std::string, std::string> result;
    size_t start = 0;
    while (start < qs.size())
    {
        auto amp = qs.find('&', start);
        auto eq = qs.find('=', start);
        if (eq == std::string::npos || eq > amp) break;
        auto key = qs.substr(start, eq - start);
        auto val_start = eq + 1;
        auto val_end = (amp == std::string::npos) ? qs.size() : amp;
        auto val = qs.substr(val_start, val_end - val_start);
        result[url_decode(key)] = url_decode(val);
        start = (amp == std::string::npos) ? qs.size() : amp + 1;
    }
    return result;
}

// ── Filename sanitizer ──────────────────────────────────────────────────

static std::string sanitize_image_name(const std::string &name)
{
    auto dot = name.rfind('.');
    auto ext = (dot != std::string::npos) ? name.substr(dot) : "";
    // Lowercase ext
    for (auto &c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

    // Validate extension
    bool valid_ext = false;
    {
        auto e = ext;
        if (!e.empty() && e[0] == '.') e = e.substr(1);
        std::string allowed[] = {"png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"};
        for (const auto &a : allowed)
            if (e == a) { valid_ext = true; break; }
    }
    if (!valid_ext) ext = ".png";

    auto base = (dot != std::string::npos) ? name.substr(0, dot) : name;
    // Lowercase and sanitize
    std::string clean;
    for (unsigned char c : base)
    {
        if (std::isalnum(c))
            clean += static_cast<char>(std::tolower(c));
        else if (!clean.empty() && clean.back() != '-')
            clean += '-';
    }
    // Trim leading/trailing hyphens
    auto cs = clean.find_first_not_of('-');
    if (cs != std::string::npos) clean = clean.substr(cs);
    auto ce = clean.find_last_not_of('-');
    if (ce != std::string::npos) clean = clean.substr(0, ce + 1);
    // Truncate to 40 chars
    if (clean.size() > 40) clean = clean.substr(0, 40);
    // Trim trailing hyphen again after truncation
    ce = clean.find_last_not_of('-');
    if (ce != std::string::npos) clean = clean.substr(0, ce + 1);

    // Random 6-char suffix
    static const char alpha[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    static std::mt19937 rng(std::random_device{}());
    std::uniform_int_distribution<int> dist(0, 35);
    char suffix[7];
    for (int i = 0; i < 6; i++) suffix[i] = alpha[dist(rng)];
    suffix[6] = '\0';

    return (clean.empty() ? "image" : clean) + "-" + suffix + ext;
}

// ── Handle: GET /uploads/{path} ─────────────────────────────────────────

saucer::scheme::response handle_serve_image(
    const config &cfg,
    const std::string &rel_path)
{
    if (rel_path.empty())
        return {.data = saucer::stash::from_str("Not Found"),
                .mime = "text/plain", .status = 404};

    auto target = fs::path(cfg.content_root) / rel_path;

    fs::path resolved;
    if (!security::within_base(target, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    // Check extension is allowed image type
    if (!security::is_image_file(resolved.string()))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    // Must contain /image/ or end with /image
    std::error_code rel_ec;
    auto rel = fs::relative(resolved, cfg.content_root, rel_ec).string();
    if (rel_ec)
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};
    if (rel.find("/image/") == std::string::npos && !rel.ends_with("/image"))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    std::error_code exist_ec;
    if (!fs::exists(resolved, exist_ec) || fs::is_directory(resolved, exist_ec))
        return {.data = saucer::stash::from_str("Not Found"),
                .mime = "text/plain", .status = 404};

    auto data = stash_from_file(resolved.string());
    auto mime = guess_image_mime(resolved.string());
    return {.data = data, .mime = mime, .status = 200};
}

saucer::scheme::response save_uploaded_image(
    const config &cfg,
    const std::string &filename,
    const std::string &doc_dir,
    const std::string &file_content)
{
    if (file_content.empty())
        return {.data = saucer::stash::from_str("No file"),
                .mime = "text/plain", .status = 400};

    if (file_content.size() > cfg.max_content_size)
        return {.data = saucer::stash::from_str("File too large"),
                .mime = "text/plain", .status = 413};

    auto safe_name = sanitize_image_name(filename.empty() ? "image.png" : filename);

    // Build target directory
    fs::path target_dir;
    if (!doc_dir.empty())
        target_dir = fs::path(cfg.content_root) / doc_dir / "image";
    else
        target_dir = fs::path(cfg.content_root) / "image";

    fs::path resolved;
    if (!security::within_base(target_dir, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    std::error_code ec;
    fs::create_directories(resolved, ec);
    if (ec)
        return {.data = saucer::stash::from_str("Write failed"),
                .mime = "text/plain", .status = 500};

    auto file_path = resolved / safe_name;
    {
        std::ofstream f(file_path, std::ios::binary);
        if (!f)
            return {.data = saucer::stash::from_str("Write failed"),
                    .mime = "text/plain", .status = 500};
        f.write(file_content.data(), static_cast<std::streamsize>(file_content.size()));
    }

    // Build URL response
    std::string url;
    if (!doc_dir.empty())
        url = "image/" + safe_name;
    else
        url = "/uploads/image/" + safe_name;

    std::ostringstream out;
    out << "{\"url\":\"" << json_escape(url) << "\"}";
    return {.data = saucer::stash::from_str(out.str()),
            .mime = "application/json", .status = 200};
}

// Find all .md files that reference a given image name
static std::vector<std::string> find_image_refs(
    const fs::path &content_root,
    const fs::path &image_dir,
    const std::string &image_name)
{
    std::vector<std::string> refs;
    auto scan_dir = image_dir.parent_path();
    {
        std::error_code exist_ec;
        if (!fs::exists(scan_dir, exist_ec)) return refs;
    }

    // Hard cap on entries scanned, so orphan checks exit early instead of
    // walking huge trees on every save.
    const std::size_t kMaxScanned = 10000;
    std::size_t scanned = 0;

    // True when `dir` resolves to a location strictly inside the content
    // tree, so a symlinked directory can never drag the scan outside the
    // content root (or back into the root itself via a self-symlink).
    // cfg.content_root is already canonical (see main.cpp), so the base
    // needs no re-resolution here.
    auto within_root = [&](const fs::path &dir) -> bool {
        std::error_code ec;
        auto canon = fs::canonical(dir, ec);
        if (ec) return false;
        auto rel = fs::relative(canon, content_root, ec);
        if (ec) return false;
        auto s = rel.string();
        return s != "." && s != ".." && !s.starts_with("../");
    };

    auto recurse = [&](const fs::path &dir, auto &self) -> void {
        std::error_code ec;
        fs::directory_iterator it(dir, ec), end;
        for (; !ec && it != end; it.increment(ec))
        {
            if (scanned >= kMaxScanned) break;
            scanned++;

            auto ename = it->path().filename().string();
            if (ename[0] == '.') continue;

            std::error_code status_ec;
            auto estatus = it->status(status_ec);
            if (status_ec) continue;
            if (fs::is_directory(estatus))
            {
                if (ename == "image") continue;
                if (!within_root(it->path())) continue;
                self(it->path(), self);
            }
            else if (ename.ends_with(".md"))
            {
                std::ifstream f(it->path());
                if (!f) continue;
                std::string content((std::istreambuf_iterator<char>(f)),
                                    std::istreambuf_iterator<char>());
                if (content.find(image_name) != std::string::npos)
                {
                    std::error_code rel_ec;
                    auto rel = fs::relative(it->path(), content_root, rel_ec).string();
                    if (!rel_ec) refs.push_back(rel);
                }
            }
        }
    };
    recurse(scan_dir, recurse);
    return refs;
}

// ── Handle: GET /api/images?dir=...&refs=... ───────────────────────────

saucer::scheme::response handle_list_images(
    const config &cfg,
    const std::string &query_str)
{
    auto params = parse_query(query_str);
    auto doc_dir = params["dir"];
    auto refs = params["refs"] == "true";

    fs::path image_dir;
    if (!doc_dir.empty())
        image_dir = fs::path(cfg.content_root) / doc_dir / "image";
    else
        image_dir = fs::path(cfg.content_root) / "image";

    fs::path resolved;
    if (!security::within_base(image_dir, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    std::error_code exist_ec;
    if (!fs::exists(resolved, exist_ec) || !fs::is_directory(resolved, exist_ec))
    {
        std::string empty = "{\"images\":[]}";
        return {.data = saucer::stash::from_str(empty),
                .mime = "application/json", .status = 200};
    }

    std::vector<std::string> names;
    std::error_code ec;
    fs::directory_iterator it(resolved, ec), end;
    for (; !ec && it != end; it.increment(ec))
    {
        std::error_code status_ec;
        auto estatus = it->status(status_ec);
        if (status_ec || !fs::is_regular_file(estatus)) continue;
        auto name = it->path().filename().string();
        if (security::is_image_file(name)) names.push_back(name);
    }
    std::sort(names.begin(), names.end());

    std::ostringstream out;
    out << "{\"images\":[";
    bool first = true;
    for (const auto &name : names)
    {
        if (!first) out << ",";
        first = false;
        auto rel_url = doc_dir.empty()
            ? "/uploads/image/" + name
            : "/uploads/" + doc_dir + "/image/" + name;
        out << "{\"name\":\"" << json_escape(name)
            << "\",\"url\":\"" << json_escape(rel_url) << "\"";

        if (refs)
        {
            out << ",\"usedIn\":[";
            auto ref_list = find_image_refs(cfg.content_root, resolved, name);
            bool rfirst = true;
            for (const auto &r : ref_list)
            {
                if (!rfirst) out << ",";
                rfirst = false;
                out << "\"" << json_escape(r) << "\"";
            }
            out << "]";
        }

        out << "}";
    }
    out << "]}\n";

    return {.data = saucer::stash::from_str(out.str()),
            .mime = "application/json", .status = 200};
}

// ── Handle: DELETE /api/images/{name}?dir=... ──────────────────────────

saucer::scheme::response handle_delete_image(
    const config &cfg,
    const std::string &name,
    const std::string &query_str)
{
    if (name.empty())
        return {.data = saucer::stash::from_str("Missing image name"),
                .mime = "text/plain", .status = 400};

    auto params = parse_query(query_str);
    auto doc_dir = params["dir"];

    // Only image files are deletable through the image API.
    if (!security::is_image_file(name))
        return {.data = saucer::stash::from_str("Not found"),
                .mime = "text/plain", .status = 404};

    fs::path image_dir;
    if (!doc_dir.empty())
        image_dir = fs::path(cfg.content_root) / doc_dir / "image";
    else
        image_dir = fs::path(cfg.content_root) / "image";

    fs::path resolved_base;
    if (!security::within_base(image_dir, cfg.content_root, resolved_base))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    auto target = resolved_base / name;
    fs::path resolved;
    if (!security::within_base(target, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    std::error_code exist_ec;
    if (!fs::exists(resolved, exist_ec) || fs::is_directory(resolved, exist_ec))
        return {.data = saucer::stash::from_str("Not found"),
                .mime = "text/plain", .status = 404};

    std::error_code ec;
    fs::remove(resolved, ec);
    if (ec)
        return {.data = saucer::stash::from_str("Delete failed"),
                .mime = "text/plain", .status = 500};

    std::string ok = "{\"ok\":true}";
    return {.data = saucer::stash::from_str(ok),
            .mime = "application/json", .status = 200};
}

// ── Orphaned image cleanup ──────────────────────────────────────────────

void remove_orphaned_images(
    const config &cfg,
    const std::string &doc_rel_path)
{
    fs::path image_dir;
    if (!doc_rel_path.empty())
        image_dir = fs::path(cfg.content_root) / doc_rel_path / "image";
    else
        image_dir = fs::path(cfg.content_root) / "image";

    // Refuse to act if the image dir (or anything a caller passes via
    // doc_rel_path) resolves outside the content root. Every delete/rm below
    // is then guaranteed to stay inside the user-chosen content directory.
    fs::path resolved_dir;
    if (!security::within_base(image_dir, cfg.content_root, resolved_dir))
        return;

    {
        std::error_code exist_ec;
        if (!fs::exists(resolved_dir, exist_ec) ||
            !fs::is_directory(resolved_dir, exist_ec))
            return;
    }

    // Remove unreferenced images
    std::error_code ec;
    fs::directory_iterator it(resolved_dir, ec), end;
    for (; !ec && it != end; it.increment(ec))
    {
        std::error_code status_ec;
        auto estatus = it->status(status_ec);
        if (status_ec || !fs::is_regular_file(estatus)) continue;
        auto name = it->path().filename().string();
        if (!security::is_image_file(name)) continue;

        auto refs = find_image_refs(cfg.content_root, resolved_dir, name);
        if (refs.empty())
        {
            std::error_code rm_ec;
            fs::remove(it->path(), rm_ec);
        }
    }

    // Remove empty image/ directory
    {
        std::error_code eec;
        if (fs::is_empty(resolved_dir, eec) && !eec)
        {
            std::error_code ec;
            fs::remove(resolved_dir, ec);

            // Clean empty parent directories up to content root
            auto parent = resolved_dir.parent_path();
            while (parent != fs::path(cfg.content_root))
            {
                std::error_code pec;
                if (!fs::is_empty(parent, pec) || pec) break;
                fs::remove(parent, pec);
                if (pec) break;
                parent = parent.parent_path();
            }
        }
    }
}
