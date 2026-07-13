#include "security.h"
#include <algorithm>
#include <fstream>
#include <sstream>

namespace security
{

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

verdict check(const url_parts &url)
{
    if (url.scheme == "app")
        return verdict::allow;

    if (url.host.empty())
        return verdict::allow;

    if (url.host == "localhost" || url.host == "127.0.0.1")
        return verdict::allow;

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

} // namespace security
