#include "security.h"
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace security
{

namespace fs = std::filesystem;

static void parse_authority(std::string_view authority,
                            std::string &host,
                            std::optional<std::size_t> &port)
{
    auto colon = authority.find(':');
    if (colon != std::string_view::npos)
    {
        host = std::string(authority.substr(0, colon));
        try
        {
            port = static_cast<std::size_t>(
                std::stoul(std::string(authority.substr(colon + 1))));
        }
        catch (...) {}
    }
    else
    {
        host = std::string(authority);
    }
}

// ── ─────────────────────────────────────────────────────────────────────

url_parts parse_url(std::string_view url)
{
    url_parts result;

    if (url.empty())
        return result;

    // Relative path (no scheme, no authority)
    if (url[0] == '/')
    {
        result.path = std::string(url);
        return result;
    }

    // Protocol-relative: //host/path
    if (url.starts_with("//"))
    {
        auto rest = url.substr(2);
        auto slash = rest.find('/');
        if (slash != std::string_view::npos)
        {
            parse_authority(rest.substr(0, slash), result.host, result.port);
            result.path = std::string(rest.substr(slash));
        }
        else
        {
            parse_authority(rest, result.host, result.port);
        }
        return result;
    }

    // scheme://...
    auto scheme_end = url.find("://");
    if (scheme_end == std::string_view::npos)
    {
        result.path = std::string(url);
        return result;
    }

    result.scheme = std::string(url.substr(0, scheme_end));
    auto rest = url.substr(scheme_end + 3);

    auto slash = rest.find('/');
    if (slash != std::string_view::npos)
    {
        parse_authority(rest.substr(0, slash), result.host, result.port);
        result.path = std::string(rest.substr(slash));
    }
    else
    {
        parse_authority(rest, result.host, result.port);
    }

    return result;
}

// ── ─────────────────────────────────────────────────────────────────────

namespace
{
std::mutex g_remote_hosts_mutex;
std::vector<std::string> g_remote_hosts;
} // namespace

void allow_remote_host(std::string_view host)
{
    if (host.empty())
        return;
    std::lock_guard lock(g_remote_hosts_mutex);
    if (std::find(g_remote_hosts.begin(), g_remote_hosts.end(), host) ==
        g_remote_hosts.end())
    {
        g_remote_hosts.push_back(std::string(host));
    }
}

verdict check(const url_parts &url)
{
    if (url.scheme == "app")
        return verdict::allow;

    if (url.host.empty())
        return verdict::allow;

    if (url.host == "localhost" || url.host == "127.0.0.1")
        return verdict::allow;

    {
        std::lock_guard lock(g_remote_hosts_mutex);
        if (std::find(g_remote_hosts.begin(), g_remote_hosts.end(),
                      url.host) != g_remote_hosts.end())
        {
            return verdict::allow;
        }
    }

    return verdict::prompt;
}

// ── ─────────────────────────────────────────────────────────────────────

bool is_api_path(std::string_view path)
{
    return path.starts_with("/api/") ||
           path.starts_with("/content/") ||
           path.starts_with("/uploads/");
}

// ── whitelist ──────────────────────────────────────────────────────────

whitelist whitelist::load(const std::filesystem::path &path)
{
    whitelist wl;

    std::ifstream file(path);
    if (!file)
        return wl;

    std::string line;
    while (std::getline(file, line))
    {
        if (line.empty() || line[0] == '#')
            continue;

        auto start = line.find_first_not_of(" \t\r\n");
        auto end   = line.find_last_not_of(" \t\r\n");
        if (start == std::string::npos)
            continue;

        wl.domains_.push_back(line.substr(start, end - start + 1));
    }

    return wl;
}

void whitelist::save(const std::filesystem::path &path) const
{
    std::ofstream file(path);
    if (!file)
        return;

    file << "# inb4doc external domain whitelist\n";
    for (const auto &d : domains_)
        file << d << "\n";
}

bool whitelist::contains(std::string_view domain) const
{
    return std::find(domains_.begin(), domains_.end(), domain)
           != domains_.end();
}

void whitelist::add(std::string_view domain)
{
    if (!contains(domain))
        domains_.emplace_back(domain);
}

void whitelist::remove(std::string_view domain)
{
    domains_.erase(
        std::remove(domains_.begin(), domains_.end(), domain),
        domains_.end());
}

const std::vector<std::string> &whitelist::entries() const
{
    return domains_;
}

// ── Filesystem safety rules ─────────────────────────────────────────────

bool within_base(
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

bool is_image_file(const fs::path &path)
{
    auto dot = path.string().rfind('.');
    if (dot == std::string::npos) return false;
    auto ext = path.string().substr(dot);
    for (auto &c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return ext == ".png" || ext == ".jpg" || ext == ".jpeg" ||
           ext == ".gif" || ext == ".svg" || ext == ".webp" ||
           ext == ".bmp" || ext == ".ico";
}

bool dir_is_deletable(const fs::path &dir)
{
    std::error_code ec;
    fs::recursive_directory_iterator it(dir, ec), end;
    if (ec) return false;
    for (; it != end; it.increment(ec))
    {
        if (ec) return false;
        auto name = it->path().filename().string();
        if (!name.empty() && name[0] == '.') continue;

        std::error_code st_ec;
        auto estatus = it->status(st_ec);
        if (st_ec) return false;
        if (fs::is_directory(estatus)) continue;
        if (name.ends_with(".md")) continue;
        if (is_image_file(it->path())) continue;
        return false;
    }
    return true;
}

bool is_deletable(
    const fs::path &base,
    const fs::path &target,
    fs::path &resolved)
{
    if (!within_base(target, base, resolved))
        return false;
    std::error_code ec;
    if (fs::is_directory(resolved, ec) && !ec)
        return dir_is_deletable(resolved);
    return true;
}

bool dir_deletable(
    const fs::path &content_root,
    const fs::path &dir)
{
    auto rel = dir.lexically_relative(content_root);
    if (rel.empty())
        return false;

    auto rel_str = rel.string();
    auto &index = deletability::instance();
    if (index.is_undeletable(content_root, rel_str))
        return false;
    if (index.is_known_deletable(content_root, rel_str))
        return true;
    return dir_is_deletable(dir);
}

// ── deletability cache ──────────────────────────────────────────────────

deletability &deletability::instance()
{
    static deletability inst;
    return inst;
}

void deletability::update(
    const fs::path &content_root,
    std::unordered_set<std::string> undeletable,
    std::unordered_set<std::string> clean)
{
    std::lock_guard lock(mutex_);
    content_root_ = content_root;
    undeletable_ = std::move(undeletable);
    clean_ = std::move(clean);
}

bool deletability::is_undeletable(
    const fs::path &content_root,
    const std::string &rel_path) const
{
    std::lock_guard lock(mutex_);
    if (content_root != content_root_)
        return false;
    return undeletable_.contains(rel_path);
}

bool deletability::is_known_deletable(
    const fs::path &content_root,
    const std::string &rel_path) const
{
    std::lock_guard lock(mutex_);
    if (content_root != content_root_)
        return false;
    return clean_.contains(rel_path);
}

void deletability::clear(const fs::path &content_root)
{
    std::lock_guard lock(mutex_);
    if (content_root != content_root_)
        return;
    undeletable_.clear();
    clean_.clear();
}

} // namespace security
