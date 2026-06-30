#pragma once
#include <string>
#include <vector>
#include <filesystem>

struct GitIgnorePattern
{
    std::string pattern;
    bool negate   = false;
    bool dir_only = false;
    bool anchored = false;
};

std::vector<GitIgnorePattern> load_gitignore(const std::filesystem::path &dir);

bool glob_match(const std::string &pat, std::size_t pi,
                const std::string &str, std::size_t si);

bool is_ignored(const std::string &name, bool is_dir,
                const std::vector<GitIgnorePattern> &patterns);
