#include "images.h"
#include "config.h"
#include <fstream>
#include <sstream>
#include <filesystem>
#include <vector>
#include <algorithm>
#include <random>
#include <cctype>
#include <print>

namespace fs = std::filesystem;

// ── Helpers ──────────────────────────────────────────────────────────────

static bool is_image_ext(const std::string &path)
{
    auto dot = path.rfind('.');
    if (dot == std::string::npos) return false;
    auto ext = path.substr(dot);
    for (auto &c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return ext == ".png" || ext == ".jpg" || ext == ".jpeg" ||
           ext == ".gif" || ext == ".svg" || ext == ".webp" ||
           ext == ".bmp" || ext == ".ico";
}

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

bool resolve_within(
    const fs::path &target,
    const fs::path &base,
    fs::path &resolved)
{
    std::error_code ec;
    resolved = fs::weakly_canonical(target, ec);
    if (ec) return false;
    auto base_canon = fs::weakly_canonical(base, ec);
    if (ec) return false;
    auto rel = resolved.lexically_relative(base_canon);
    if (rel.empty()) return false;
    auto rel_str = rel.string();
    if (rel_str.find("..") != std::string::npos) return false;
    return true;
}

static std::string json_escape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 4);
    for (char c : s)
    {
        switch (c)
        {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n";  break;
        case '\r': out += "\\r";  break;
        case '\t': out += "\\t";  break;
        default:   out += c;      break;
        }
    }
    return out;
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

// ── Multipart/form-data parser ──────────────────────────────────────────

struct MultipartPart {
    std::map<std::string, std::string> headers;
    std::string content;
};

static std::vector<MultipartPart> parse_multipart(
    const std::string &body,
    const std::string &boundary)
{
    std::vector<MultipartPart> parts;
    if (boundary.empty() || body.empty()) return parts;

    std::string delim = "--" + boundary;

    size_t pos = 0;
    while (true)
    {
        // Find the next part boundary
        auto start = body.find(delim, pos);
        if (start == std::string::npos) break;

        // Advance past the boundary marker
        auto content_start = start + delim.size();

        // If followed by "--", this is the end boundary -- stop
        if (content_start + 1 < body.size() &&
            body[content_start] == '-' && body[content_start + 1] == '-')
            break;

        // Skip \r\n after the boundary
        if (content_start < body.size() && body[content_start] == '\r') content_start++;
        if (content_start < body.size() && body[content_start] == '\n') content_start++;

        // Find the next occurrence of delim (which marks the next part)
        auto next = body.find(delim, content_start);
        if (next == std::string::npos) break;

        auto part_data = body.substr(content_start, next - content_start);
        // Remove trailing \r\n before next boundary
        if (part_data.size() >= 2 && part_data.substr(part_data.size() - 2) == "\r\n")
            part_data = part_data.substr(0, part_data.size() - 2);

        // Split headers from content at \r\n\r\n
        auto hdr_end = part_data.find("\r\n\r\n");
        if (hdr_end == std::string::npos) { pos = next + delim.size(); continue; }

        MultipartPart part;
        auto hdr_section = part_data.substr(0, hdr_end);
        auto content_part_start = hdr_end + 4;

        // Parse headers
        size_t hpos = 0;
        while (hpos < hdr_section.size())
        {
            auto eol = hdr_section.find("\r\n", hpos);
            auto line = (eol == std::string::npos)
                ? hdr_section.substr(hpos)
                : hdr_section.substr(hpos, eol - hpos);
            auto colon = line.find(':');
            if (colon != std::string::npos)
            {
                auto key = line.substr(0, colon);
                auto val = line.substr(colon + 1);
                auto vs = val.find_first_not_of(" \t");
                if (vs != std::string::npos) val = val.substr(vs);
                part.headers[key] = val;
            }
            if (eol == std::string::npos) break;
            hpos = eol + 2;
        }

        part.content = part_data.substr(content_part_start);
        parts.push_back(std::move(part));

        pos = next + delim.size();
    }
    return parts;
}

static std::string extract_boundary(const std::string &content_type)
{
    auto pos = content_type.find("boundary=");
    if (pos == std::string::npos) return "";
    auto bstart = pos + 9;
    auto bend = content_type.find_first_of("; \r\n", bstart);
    if (bend == std::string::npos)
        return content_type.substr(bstart);
    return content_type.substr(bstart, bend - bstart);
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
    if (!resolve_within(target, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    // Check extension is allowed image type
    if (!is_image_ext(resolved.string()))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    // Must contain /image/ or end with /image
    auto resolved_str = resolved.string();
    auto rel = resolved_str.substr(fs::weakly_canonical(cfg.content_root).string().size());
    if (rel.find("/image/") == std::string::npos && !rel.ends_with("/image"))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    if (!fs::exists(resolved) || fs::is_directory(resolved))
        return {.data = saucer::stash::from_str("Not Found"),
                .mime = "text/plain", .status = 404};

    auto data = stash_from_file(resolved.string());
    auto mime = guess_image_mime(resolved.string());
    return {.data = data, .mime = mime, .status = 200};
}

// ── Handle: POST /api/upload ────────────────────────────────────────────

saucer::scheme::response handle_upload_image(
    const config &cfg,
    const std::string &body,
    const std::map<std::string, std::string> &headers)
{
    // Extract boundary from Content-Type
    auto ct_it = headers.find("Content-Type");
    if (ct_it == headers.end())
        return {.data = saucer::stash::from_str("Missing Content-Type"),
                .mime = "text/plain", .status = 400};

    auto boundary = extract_boundary(ct_it->second);
    if (boundary.empty())
        return {.data = saucer::stash::from_str("Invalid Content-Type"),
                .mime = "text/plain", .status = 400};

    auto parts = parse_multipart(body, boundary);

    std::string file_content;
    std::string filename;
    std::string doc_dir;

    for (const auto &part : parts)
    {
        auto cd_it = part.headers.find("Content-Disposition");
        if (cd_it == part.headers.end()) continue;

        // Extract name parameter
        auto name_pos = cd_it->second.find("name=\"");
        if (name_pos == std::string::npos) continue;
        name_pos += 6;
        auto name_end = cd_it->second.find('"', name_pos);
        if (name_end == std::string::npos) continue;
        auto field_name = cd_it->second.substr(name_pos, name_end - name_pos);

        if (field_name == "file")
        {
            // Extract filename
            auto fn_pos = cd_it->second.find("filename=\"");
            if (fn_pos != std::string::npos)
            {
                fn_pos += 10;
                auto fn_end = cd_it->second.find('"', fn_pos);
                if (fn_end != std::string::npos)
                    filename = cd_it->second.substr(fn_pos, fn_end - fn_pos);
            }
            file_content = part.content;
        }
        else if (field_name == "dir")
        {
            doc_dir = part.content;
            // Trim trailing \r\n if present
            if (!doc_dir.empty() && doc_dir.back() == '\n')
                doc_dir.pop_back();
            if (!doc_dir.empty() && doc_dir.back() == '\r')
                doc_dir.pop_back();
        }
    }

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
    if (!resolve_within(target_dir, cfg.content_root, resolved))
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
    if (!fs::exists(scan_dir)) return refs;

    auto recurse = [&](const fs::path &dir, auto &self) -> void {
        for (const auto &e : fs::directory_iterator(dir))
        {
            auto ename = e.path().filename().string();
            if (ename[0] == '.') continue;
            if (fs::is_directory(e.path()))
            {
                if (ename == "image") continue;
                self(e.path(), self);
            }
            else if (ename.ends_with(".md"))
            {
                std::ifstream f(e.path());
                if (!f) continue;
                std::string content((std::istreambuf_iterator<char>(f)),
                                    std::istreambuf_iterator<char>());
                if (content.find(image_name) != std::string::npos)
                {
                    auto rel = fs::relative(e.path(), content_root).string();
                    refs.push_back(rel);
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
    if (!resolve_within(image_dir, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    if (!fs::exists(resolved) || !fs::is_directory(resolved))
    {
        std::string empty = "{\"images\":[]}";
        return {.data = saucer::stash::from_str(empty),
                .mime = "application/json", .status = 200};
    }

    std::vector<std::string> names;
    for (const auto &e : fs::directory_iterator(resolved))
    {
        if (!fs::is_regular_file(e.path())) continue;
        auto name = e.path().filename().string();
        if (is_image_ext(name)) names.push_back(name);
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

    fs::path image_dir;
    if (!doc_dir.empty())
        image_dir = fs::path(cfg.content_root) / doc_dir / "image";
    else
        image_dir = fs::path(cfg.content_root) / "image";

    fs::path resolved_base;
    if (!resolve_within(image_dir, cfg.content_root, resolved_base))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    auto target = resolved_base / name;
    fs::path resolved;
    if (!resolve_within(target, cfg.content_root, resolved))
        return {.data = saucer::stash::from_str("Forbidden"),
                .mime = "text/plain", .status = 403};

    if (!fs::exists(resolved) || fs::is_directory(resolved))
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

    if (!fs::exists(image_dir) || !fs::is_directory(image_dir)) return;

    // Remove unreferenced images
    for (const auto &e : fs::directory_iterator(image_dir))
    {
        if (!fs::is_regular_file(e.path())) continue;
        auto name = e.path().filename().string();
        if (!is_image_ext(name)) continue;

        auto refs = find_image_refs(cfg.content_root, image_dir, name);
        if (refs.empty())
        {
            std::error_code ec;
            fs::remove(e.path(), ec);
        }
    }

    // Remove empty image/ directory
    if (fs::is_empty(image_dir))
    {
        std::error_code ec;
        fs::remove(image_dir, ec);

        // Clean empty parent directories up to content root
        auto parent = image_dir.parent_path();
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
