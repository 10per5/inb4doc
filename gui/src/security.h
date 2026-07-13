#pragma once
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>
#include <filesystem>
#include <optional>

namespace security {

enum class verdict
{
    allow,
    block,
    prompt,
};

struct url_parts
{
    std::string scheme;
    std::string host;
    std::optional<std::size_t> port;
    std::string path;
};

url_parts parse_url(std::string_view url);

verdict check(const url_parts &url);

bool is_api_path(std::string_view path);

class whitelist
{
public:
    static whitelist load(const std::filesystem::path &path);
    void save(const std::filesystem::path &path) const;

    bool contains(std::string_view domain) const;
    void add(std::string_view domain);
    void remove(std::string_view domain);

    const std::vector<std::string> &entries() const;

private:
    std::vector<std::string> domains_;
};

} // namespace security
