#pragma once
#include "config.h"
#include <string>
#include <filesystem>
#include <saucer/scheme.hpp>

/// Decode percent-encoded URL component (e.g. %20 -> space).
std::string url_decode(const std::string &s);

saucer::scheme::response handle_serve_image(
    const config &cfg,
    const std::string &rel_path);

/// Save an uploaded image directly (shared by the native bridge and
/// formerly the multipart scheme handler). Filename is sanitized, target dir
/// is the `image/` folder next to doc_dir. Returns {"url": "..."} on success.
saucer::scheme::response save_uploaded_image(
    const config &cfg,
    const std::string &filename,
    const std::string &doc_dir,
    const std::string &file_content);

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
