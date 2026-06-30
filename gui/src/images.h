#pragma once
#include "config.h"
#include <string>
#include <map>
#include <filesystem>
#include <saucer/scheme.hpp>

/// Decode percent-encoded URL component (e.g. %20 -> space).
std::string url_decode(const std::string &s);

/// Check that `target` resolves within `base` (path traversal guard).
/// Sets `resolved` to the weakly-canonical target on success.
/// Returns false if target escapes base or canonicalization fails.
bool resolve_within(
    const std::filesystem::path &target,
    const std::filesystem::path &base,
    std::filesystem::path &resolved);

saucer::scheme::response handle_serve_image(
    const config &cfg,
    const std::string &rel_path);

saucer::scheme::response handle_upload_image(
    const config &cfg,
    const std::string &body,
    const std::map<std::string, std::string> &headers);

saucer::scheme::response handle_list_images(
    const config &cfg,
    const std::string &query_str);

saucer::scheme::response handle_delete_image(
    const config &cfg,
    const std::string &name,
    const std::string &query_str);

/// Remove image files in the image/ directory adjacent to doc_rel_path
/// that are not referenced by any .md file in the content tree.
/// Cleans up empty image/ directories and empty parent dirs.
void remove_orphaned_images(
    const config &cfg,
    const std::string &doc_rel_path);
