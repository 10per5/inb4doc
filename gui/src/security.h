#pragma once
#include <cstddef>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_set>
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

/// Allow `host` as a remote static origin — the updater's update-base, read
/// from the editor's `update-base` meta at startup (never a literal in this
/// repo). `check()` treats it like localhost / 127.0.0.1 / app. No-op for an
/// empty host. Thread-safe.
void allow_remote_host(std::string_view host);

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

// ── Filesystem safety rules ─────────────────────────────────────────────

/// Check that `target` resolves within `base` (path traversal guard).
/// Sets `resolved` to the weakly-canonical target on success.
/// Returns false if target escapes base or canonicalization fails.
bool within_base(
    const std::filesystem::path &target,
    const std::filesystem::path &base,
    std::filesystem::path &resolved);

/// True if the path's extension is a supported image type.
bool is_image_file(const std::filesystem::path &path);

/// True if `dir`'s subtree contains only content: `.md` documents, image
/// files, subdirectories, and dotfiles (tooling noise like .gitkeep or
/// .DS_Store). Any other entry (stray file, symlink, ...) makes the
/// directory — and every ancestor that would delete it — non-deletable.
/// Early-exits at the first offending entry.
bool dir_is_deletable(const std::filesystem::path &dir);

/// High-level deletion rule: `target` must resolve within `base`, and if it
/// is a directory its subtree must be content-only (see dir_is_deletable).
bool is_deletable(
    const std::filesystem::path &base,
    const std::filesystem::path &target,
    std::filesystem::path &resolved);

/// Whether `dir` (already resolved inside `content_root`) may be deleted.
/// Consults the cached tree scan when available and falls back to a live
/// subtree scan (dir_is_deletable) for directories the scan didn't cover.
bool dir_deletable(
    const std::filesystem::path &content_root,
    const std::filesystem::path &dir);

/// Cache of directory deletability, populated as a byproduct of the tree scan
/// (api/tree) so delete paths decide O(1) without rescanning. Rebuilt on each
/// tree build and invalidated after mutations. Thread-safe: the scheme and
/// bridge callbacks run on different threads.
class deletability
{
public:
    static deletability &instance();

    /// Replace the cached classification for `content_root`: dirs known to be
    /// non-deletable, and dirs known to be content-only.
    void update(
        const std::filesystem::path &content_root,
        std::unordered_set<std::string> undeletable,
        std::unordered_set<std::string> clean);

    /// True if `rel_path` (relative to `content_root`, no leading slash) is
    /// known to contain non-content files.
    bool is_undeletable(
        const std::filesystem::path &content_root,
        const std::string &rel_path) const;

    /// True if `rel_path` was scanned and found content-only.
    bool is_known_deletable(
        const std::filesystem::path &content_root,
        const std::string &rel_path) const;

    void clear(const std::filesystem::path &content_root);

private:
    deletability() = default;
    mutable std::mutex mutex_;
    std::filesystem::path content_root_;
    std::unordered_set<std::string> undeletable_;
    std::unordered_set<std::string> clean_;
};

} // namespace security
